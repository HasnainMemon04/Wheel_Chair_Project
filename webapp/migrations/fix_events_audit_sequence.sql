-- Fix audit-event inserts through service-role API routes/Edge Functions.
-- events.id is bigserial, so table INSERT is not enough; the inserting role
-- also needs usage on the backing sequence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'events_id_seq'
      AND c.relkind = 'S'
  ) THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.events_id_seq TO service_role';
  END IF;
END $$;
