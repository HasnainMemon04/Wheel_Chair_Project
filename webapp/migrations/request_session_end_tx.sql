create or replace function public.request_session_end_tx(
  p_wheelchair_id text,
  p_reason text default 'operator_cancel'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_command_id uuid;
  v_command text;
  v_locked boolean;
  v_rental_id uuid;
  v_req_id text;
  v_session_state text;
begin
  select ds.locked, ds.session_state
  into v_locked, v_session_state
  from public.device_state ds
  where ds.wheelchair_id = p_wheelchair_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'device_not_found');
  end if;

  if coalesce(v_locked, false)
     and coalesce(v_session_state, 'LOCKED') in ('LOCKED', 'AVAILABLE') then
    return jsonb_build_object('ok', true, 'message', 'already_available');
  end if;

  select r.id
  into v_rental_id
  from public.rentals r
  where r.wheelchair_id = p_wheelchair_id
    and r.state in ('active', 'expiring', 'ending')
  order by r.created_at desc
  limit 1
  for update;

  if v_rental_id is not null then
    update public.rentals
    set state = 'ending'
    where id = v_rental_id
      and state in ('active', 'expiring', 'ending');

    v_req_id := 'end-' || v_rental_id::text;
  else
    v_req_id := 'operator-end-' || gen_random_uuid()::text;
  end if;

  select c.id
  into v_command_id
  from public.commands c
  where c.wheelchair_id = p_wheelchair_id
    and c.status = 'pending'
    and c.created_at > now() - interval '2 minutes'
    and (
      c.req_id = v_req_id
      or c.req_id like 'operator-end-%'
    )
  order by c.created_at desc
  limit 1;

  if v_command_id is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'already_pending',
      'command_id', v_command_id,
      'rental_id', v_rental_id
    );
  end if;

  -- WCHAIR-001 runs the legacy command set. LOCK is its supported safe
  -- session terminator; modern firmware performs a controlled END_SESSION.
  v_command := case
    when p_wheelchair_id = 'WCHAIR-001' then 'LOCK'
    else 'END_SESSION'
  end;

  insert into public.commands (
    wheelchair_id,
    cmd,
    args,
    status,
    req_id
  )
  values (
    p_wheelchair_id,
    v_command,
    jsonb_build_object('reason', p_reason),
    'pending',
    v_req_id
  )
  returning id into v_command_id;

  insert into public.events (wheelchair_id, type, detail)
  values (
    p_wheelchair_id,
    'SESSION_END_REQUESTED',
    jsonb_build_object(
      'reason', p_reason,
      'rental_id', v_rental_id,
      'command_id', v_command_id,
      'command', v_command
    )
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'queued',
    'command_id', v_command_id,
    'rental_id', v_rental_id,
    'command', v_command
  );
end;
$$;

revoke all on function public.request_session_end_tx(text, text)
from public, anon, authenticated;

grant execute on function public.request_session_end_tx(text, text)
to service_role;
