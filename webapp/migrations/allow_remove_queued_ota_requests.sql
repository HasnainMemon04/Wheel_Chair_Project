-- The operator UI may remove only browser-originated OTA request notices.
-- Device safety events and real ESP32 OTA logs remain immutable to anon clients.
grant delete on public.events to anon, authenticated;

drop policy if exists "remove queued ota requests" on public.events;
create policy "remove queued ota requests"
  on public.events
  for delete
  using (
    type = 'OTA_REQUESTED'
    and coalesce(detail ->> 'source', '') = 'operator_console'
  );
