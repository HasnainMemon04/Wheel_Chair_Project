-- The ESP32 owns indoor fallback generation. The cloud only transports the
-- source flag so clients never mistake synthetic continuity data for a fix.
alter table public.device_state
  add column if not exists gps_simulated boolean default false;
