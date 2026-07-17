-- ---------------------------------------------------------------------------
-- Atomic payment -> activation -> unlock (without SET_SPEED_LIMIT command).
-- Run this in the Supabase Dashboard SQL Editor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_rental_tx(
  p_rental_id   uuid,
  p_amount      int,
  p_provider    text,
  p_provider_ref text,
  p_currency    text default 'PKR'
) RETURNS jsonb AS $$
DECLARE
  v_rental rentals%ROWTYPE;
  v_lat double precision;
  v_lng double precision;
  v_unlock_dispatched boolean;
BEGIN
  -- Serialize concurrent webhook retries for the same rental.
  SELECT * INTO v_rental FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rental_not_found');
  END IF;

  IF v_rental.state = 'active' THEN
    -- Idempotency guard: only short-circuit if an UNLOCK was actually dispatched.
    SELECT exists (
      SELECT 1 FROM commands c
      WHERE c.wheelchair_id = v_rental.wheelchair_id
        AND c.cmd = 'UNLOCK'
        AND c.req_id = 'unlock-' || p_rental_id::text
    ) INTO v_unlock_dispatched;
    IF v_unlock_dispatched THEN
      RETURN jsonb_build_object('ok', true, 'message', 'already_active');
    END IF;
  ELSIF v_rental.state <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_state', 'state', v_rental.state);
  END IF;

  -- 1. Payment record (idempotent on the unique provider_ref).
  INSERT INTO payments (rental_id, amount, currency, provider, provider_ref, status, paid_at)
  VALUES (p_rental_id, p_amount, p_currency, p_provider, p_provider_ref, 'PAID', now())
  ON CONFLICT (provider_ref) DO NOTHING;

  -- 2. Activate the rental.
  UPDATE rentals
  SET state    = 'active',
      start_at = coalesce(start_at, now()),
      end_at   = coalesce(end_at, now() + make_interval(secs => duration_s))
  WHERE id = p_rental_id;

  -- 3. Geofence center from the chair's last known position.
  SELECT ds.lat, ds.lng INTO v_lat, v_lng
  from device_state ds WHERE ds.wheelchair_id = v_rental.wheelchair_id;

  -- 4. Enqueue UNLOCK + SET_GEOFENCE (idempotent req_ids). -- NO SPEED LIMIT COMMAND!
  INSERT INTO commands (wheelchair_id, cmd, args, status, req_id)
  SELECT v_rental.wheelchair_id, c.cmd, c.args, 'pending', c.req_id
  FROM (VALUES
    ('UNLOCK',
     jsonb_build_object('duration_s', v_rental.duration_s),
     'unlock-' || p_rental_id::text),
    ('SET_GEOFENCE',
     jsonb_build_object('lat', coalesce(v_lat, 24.860731),
                        'lng', coalesce(v_lng, 67.001142),
                        'radius', 300),
     'geofence-' || p_rental_id::text)
  ) AS c(cmd, args, req_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM commands k
    WHERE k.wheelchair_id = v_rental.wheelchair_id and k.req_id = c.req_id
  );

  RETURN jsonb_build_object('ok', true, 'unlocked', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution rights to public/anon/authenticated roles for local booking flow
GRANT EXECUTE ON FUNCTION public.activate_rental_tx(uuid, int, text, text, text) TO public, anon, authenticated, service_role;
