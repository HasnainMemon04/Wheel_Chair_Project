-- ===========================================================================
--  Smart Rental Wheelchair — Supabase schema (starting migration)
--  Implements the data model in docs/API.md with the hot/cold split from
--  docs/PRODUCTION.md §2 for scalability. Run in the Supabase SQL editor.
-- ===========================================================================

-- profiles: extends Supabase auth.users with a role
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  phone       text,
  role        text not null default 'rider' check (role in ('rider','operator')),
  created_at  timestamptz default now()
);

create table if not exists wheelchairs (
  id          text primary key,                 -- e.g. WCHAIR-001
  fw_version  text,
  device_key  text not null,                    -- per-device key for HMAC verification
  status      text default 'available',
  created_at  timestamptz default now()
);

-- HOT: one row per chair, upserted every telemetry. The live map subscribes here.
create table if not exists device_state (
  wheelchair_id text primary key references wheelchairs(id) on delete cascade,
  ts            timestamptz not null default now(),
  online        boolean default false,
  lat double precision, lng double precision,
  speed real, sats int, hdop real,
  pitch real, roll real, tilt real,
  temp_motor real, temp_batt real, temp_amb real, humidity real,
  batt_v real, batt_pct int, occupied boolean, rssi int,
  power boolean, locked boolean,
  session_state text, time_left int, speed_limit int, over_speed boolean,
  geofence jsonb
);

-- COLD: append-only history. DOWNSAMPLE on ingest + apply retention (30-90d).
-- Consider monthly partitioning at scale.
create table if not exists telemetry_history (
  id            bigserial primary key,
  wheelchair_id text not null references wheelchairs(id) on delete cascade,
  ts            timestamptz not null default now(),
  data          jsonb not null
);
create index if not exists idx_hist_chair_ts on telemetry_history (wheelchair_id, ts desc);

create table if not exists events (
  id            bigserial primary key,
  wheelchair_id text not null references wheelchairs(id) on delete cascade,
  type          text not null,
  detail        jsonb,
  lat double precision, lng double precision,
  ts            timestamptz not null default now()
);
create index if not exists idx_events_chair_ts on events (wheelchair_id, ts desc);

create table if not exists rentals (
  id            uuid primary key default gen_random_uuid(),
  wheelchair_id text not null references wheelchairs(id),
  user_id       uuid references profiles(id),
  state         text not null default 'reserved',
  start_at      timestamptz,
  end_at        timestamptz,
  duration_s    int,
  speed_limit   int default 6,
  created_at    timestamptz default now()
);
create index if not exists idx_rentals_user_state on rentals (user_id, state);

create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  rental_id     uuid not null references rentals(id) on delete cascade,
  amount        int, currency text default 'PKR',
  provider      text, provider_ref text unique,      -- unique => idempotent webhooks
  status        text default 'pending',
  paid_at       timestamptz
);

-- Command queue: operator/web inserts; device polls pending; device writes ack.
create table if not exists commands (
  id            uuid primary key default gen_random_uuid(),
  wheelchair_id text not null references wheelchairs(id) on delete cascade,
  cmd           text not null,
  args          jsonb default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','acked','failed')),
  req_id        text,
  ack           jsonb,
  created_at    timestamptz default now(),
  acked_at      timestamptz
);
create index if not exists idx_cmd_chair_status on commands (wheelchair_id, status);

-- ---------------------------------------------------------------------------
-- Realtime: expose the small/live tables to the website.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table device_state;
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table rentals;
alter publication supabase_realtime add table commands;

-- ---------------------------------------------------------------------------
-- Row Level Security (tighten before production — see docs/SECURITY.md).
--  * riders: read their own rentals/payments; read available wheelchairs + state.
--  * operators: full fleet read + command insert.
--  * devices: NOT direct table writers — they go through the /ingest Edge Function
--    (service role), which validates the device key + HMAC.
-- ---------------------------------------------------------------------------
alter table device_state       enable row level security;
alter table events             enable row level security;
alter table rentals            enable row level security;
alter table payments           enable row level security;
alter table commands           enable row level security;
alter table wheelchairs        enable row level security;

-- Example policies (expand per SECURITY.md):
create policy "read available chairs" on wheelchairs for select using (true);
create policy "read device_state"     on device_state for select using (true);
create policy "read events"           on events for select using (true);
create policy "rider reads own rentals" on rentals for select
  using (auth.uid() = user_id);
create policy "operator reads fleet" on rentals for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'operator'));
-- TODO(prod): Restrict to authenticated rider/operator roles in M7
create policy "anyone can insert rentals" on rentals for insert with check (true);
-- TODO(prod): Restrict to authenticated rider/operator roles in M7
create policy "anyone can update rentals" on rentals for update using (true);

-- TODO(prod): Restrict to authenticated operator roles in M7
create policy "anyone can insert commands" on commands for insert with check (true);
-- TODO(prod): Restrict to authenticated devices/operators in M7
create policy "anyone can read commands"   on commands for select using (true);
-- TODO(prod): Restrict to authenticated devices/operators in M7
create policy "anyone can update commands" on commands for update using (true);

-- TODO(prod): Restrict to authenticated gateway/stripe webhooks in M7
create policy "anyone can insert payments" on payments for insert with check (true);
-- TODO(prod): Restrict to authenticated rider/operator roles in M7
create policy "anyone can read payments"   on payments for select using (true);

-- ---------------------------------------------------------------------------
-- Table Grants: Allow anon and authenticated roles to query tables
-- ---------------------------------------------------------------------------
grant select on public.profiles to anon, authenticated;
grant select on public.wheelchairs to anon, authenticated;
grant select on public.device_state to anon, authenticated;
grant select on public.events to anon, authenticated;
grant select, insert, update on public.rentals to anon, authenticated;
grant select on public.payments to anon, authenticated;
grant select, insert, update on public.commands to anon, authenticated;

-- Allow service_role (Edge Functions) full control over tables
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.wheelchairs to service_role;
grant select, insert, update, delete on public.device_state to service_role;
grant select, insert, update, delete on public.events to service_role;
grant select, insert, update, delete on public.rentals to service_role;
grant select, insert, update, delete on public.payments to service_role;
grant select, insert, update, delete on public.commands to service_role;

-- ---------------------------------------------------------------------------
-- Rental State Session Supervisor Task (Cron Engine Backend Authority)
-- ---------------------------------------------------------------------------
create or replace function check_rental_sessions()
returns void as $$
declare
  r record;
  req_id_str text;
  time_left_s int;
begin
  -- 1. Check for expired rentals that are still active or expiring (Defensive time drift catch-all)
  for r in 
    select id, wheelchair_id, end_at
    from rentals
    where state in ('active', 'expiring') and end_at <= now()
  loop
    req_id_str := 'cron-' || substring(gen_random_uuid()::text from 1 for 8);
    
    -- Transition rental state
    update rentals set state = 'ended' where id = r.id;
    
    -- Insert END_SESSION command to trigger device deceleration and locking
    insert into commands (wheelchair_id, cmd, req_id, status, args)
    values (r.wheelchair_id, 'END_SESSION', req_id_str, 'pending', '{}'::jsonb);
    
    -- Insert events history entry
    insert into events (wheelchair_id, type, detail, lat, lng)
    select wheelchair_id, 'SESSION_LOCKED', '{}'::jsonb, lat, lng
    from device_state
    where wheelchair_id = r.wheelchair_id;
  end loop;

  -- 2. Check for rentals entering warning window (<= 120s left)
  for r in 
    select id, wheelchair_id, end_at
    from rentals
    where state = 'active' and end_at <= now() + interval '120 seconds' and end_at > now()
  loop
    req_id_str := 'cron-' || substring(gen_random_uuid()::text from 1 for 8);
    time_left_s := extract(epoch from (r.end_at - now()))::int;
    
    -- Transition rental state
    update rentals set state = 'expiring' where id = r.id;
    
    -- Insert WARN_EXPIRY command
    insert into commands (wheelchair_id, cmd, req_id, status, args)
    values (r.wheelchair_id, 'WARN_EXPIRY', req_id_str, 'pending', jsonb_build_object('time_left', time_left_s));
    
    -- Insert warning event
    insert into events (wheelchair_id, type, detail, lat, lng)
    select wheelchair_id, 'EXPIRY_WARNING', jsonb_build_object('time_left', time_left_s), lat, lng
    from device_state
    where wheelchair_id = r.wheelchair_id;
  end loop;
end;
$$ language plpgsql;

-- Enable pg_cron and schedule task (default schedule runs every minute)
create extension if not exists pg_cron;
select cron.schedule('check-sessions', '* * * * *', 'select check_rental_sessions()');
