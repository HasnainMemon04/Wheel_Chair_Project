import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id, x-device-signature',
}

// HMAC-SHA256 verification function using Web Crypto API
async function verifySignature(bodyText: string, key: string, signatureHex: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyBuf = encoder.encode(key);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    
    const sigBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    
    return await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      sigBytes,
      encoder.encode(bodyText)
    );
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Extract headers
    const deviceId = req.headers.get('x-device-id');
    const signatureHex = req.headers.get('x-device-signature');

    if (!deviceId || !signatureHex) {
      return new Response(JSON.stringify({ error: 'Missing authentication headers' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Read body text first to verify HMAC signature
    const bodyText = await req.text();

    // 2. Initialize Supabase Service Role client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? "";
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Query the registered wheelchair & its device key
    const { data: wheelchair, error: dbError } = await supabase
      .from('wheelchairs')
      .select('device_key, target_version, fw_version, ota_status, ota_progress, ota_last_error')
      .eq('id', deviceId)
      .single();

    if (dbError || !wheelchair || !wheelchair.device_key) {
      console.error(`Device ${deviceId} not found or has no key.`, dbError);
      return new Response(JSON.stringify({ error: 'Device not registered' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Verify HMAC-SHA256 signature
    const isSignatureValid = await verifySignature(bodyText, wheelchair.device_key, signatureHex);
    if (!isSignatureValid) {
      return new Response(JSON.stringify({ error: 'Invalid HMAC signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse JSON payload
    const payload = JSON.parse(bodyText);
    const ts = payload.ts ? new Date(payload.ts * 1000).toISOString() : new Date().toISOString();

    // 5. Route based on kind
    if (payload.kind === 'telemetry') {
      // H1: fw/OTA metadata only changes during an OTA. Compare against the
      // wheelchairs row we already fetched and UPDATE only when something
      // actually changed (was: an unconditional UPDATE on every 1Hz packet —
      // needless WAL churn and row locks at fleet scale).
      const newFw = payload.fw ?? null;
      const newOtaStatus = payload.ota_status || 'idle';
      const newOtaProgress = payload.ota_progress ?? 0;
      const newOtaError = payload.ota_last_error || null;
      const otaMetaChanged =
        (wheelchair.fw_version ?? null) !== newFw ||
        (wheelchair.ota_status || 'idle') !== newOtaStatus ||
        (wheelchair.ota_progress ?? 0) !== newOtaProgress ||
        (wheelchair.ota_last_error || null) !== newOtaError;

      if (otaMetaChanged) {
        const { error: fwError } = await supabase
          .from('wheelchairs')
          .update({
            fw_version: newFw,
            ota_status: newOtaStatus,
            ota_progress: newOtaProgress,
            ota_last_error: newOtaError
          })
          .eq('id', deviceId);

        if (fwError) {
          console.error("Error updating wheelchair OTA metadata:", fwError);
        }
      }

      // H2: gap-based history downsampling. device_state.hist_up remembers the
      // device uptime of the last persisted history row; we insert when >=10s
      // of DEVICE time has elapsed (or on the first sample / after a reboot).
      // A missed upload no longer permanently drops the slot (was `up % 10`),
      // and a missing `up` no longer writes a bogus t=0 row.
      const up = typeof payload.up === 'number' && isFinite(payload.up) ? payload.up : null;
      const { data: prevState } = await supabase
        .from('device_state')
        .select('hist_up')
        .eq('wheelchair_id', deviceId)
        .maybeSingle();
      const lastHistUp = prevState?.hist_up ?? null;
      const persistHistory =
        up !== null && (lastHistUp === null || up < lastHistUp /* reboot */ || up - lastHistUp >= 10);

      // Upsert device_state (HOT SNAPSHOT)
      const { error: stateError } = await supabase
        .from('device_state')
        .upsert({
          wheelchair_id: deviceId,
          ts: ts,
          online: true,
          lat: payload.lat,
          lng: payload.lng,
          speed: payload.spd,
          sats: payload.sats,
          hdop: payload.hdop,
          pitch: payload.pitch,
          roll: payload.roll,
          tilt: payload.tilt,
          yaw: payload.yaw,
          temp_motor: payload.temp_motor,
          temp_batt: payload.temp_batt,
          temp_amb: payload.temp_amb,
          humidity: payload.humidity,
          batt_v: payload.batt_v,
          batt_pct: payload.batt_pct,
          in_motion: payload.in_motion === 1,
          tamper: payload.tamper === 1,
          tamper_count: payload.tamper_count ?? 0,
          uptime: up,                                    // C1: uptime persisted (NOT a timestamp)
          hist_up: persistHistory ? up : lastHistUp,     // H2: downsampling state
          rssi: payload.rssi,
          power: payload.power === 1,
          locked: payload.locked === 1,
          session_state: payload.session_state,
          time_left: payload.time_left,
          speed_limit: payload.speed_limit,
          over_speed: payload.over_speed === 1,
          geofence: payload.gf,
          fw_version: payload.fw,
          target_version: wheelchair?.target_version || null,
          ota_status: payload.ota_status || 'idle',
          ota_progress: payload.ota_progress ?? 0,
          ota_last_error: payload.ota_last_error || null
        });

      if (stateError) {
        throw new Error(`State upsert error: ${stateError.message}`);
      }

      // Append to history (COLD HISTORY) using the gap-based decision above.
      if (persistHistory) {
        const { error: histError } = await supabase
          .from('telemetry_history')
          .insert({
            wheelchair_id: deviceId,
            ts: ts,
            data: payload
          });

        if (histError) {
          console.error("Error inserting telemetry history:", histError);
        }
      }

    } else if (payload.kind === 'event') {
      // H3: events.detail is a jsonb column whose contract is "object". If the
      // device sent a truncated/garbled detail (a bare string), wrap it so we
      // never silently store a jsonb scalar that breaks detail->>'field' reads.
      let detail = payload.detail;
      if (detail === null || detail === undefined) {
        detail = {};
      } else if (typeof detail !== 'object' || Array.isArray(detail)) {
        detail = { raw: String(detail) };
      }

      // Insert to events table
      const { error: eventError } = await supabase
        .from('events')
        .insert({
          wheelchair_id: deviceId,
          type: payload.event,
          detail: detail,
          lat: payload.lat,
          lng: payload.lng,
          ts: ts
        });

      if (eventError) {
        throw new Error(`Event insert error: ${eventError.message}`);
      }
    } else {
      return new Response(JSON.stringify({ error: 'Unknown payload kind' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Query any pending commands to return back in response for low latency
    let pendingCommands: any[] = [];
    if (payload.kind === 'telemetry') {
      const { data, error: cmdError } = await supabase
        .from('commands')
        .select('id, cmd, req_id, args')
        .eq('wheelchair_id', deviceId)
        .eq('status', 'pending');

      if (cmdError) {
        console.error("Error fetching pending commands:", cmdError);
      } else {
        pendingCommands = data || [];
      }
    }

    return new Response(JSON.stringify({ ok: true, commands: pendingCommands }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error("Ingest error:", err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
