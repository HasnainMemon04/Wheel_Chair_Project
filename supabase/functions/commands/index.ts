import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id, x-device-signature',
}

// HMAC-SHA256 verification function using Web Crypto API
async function verifySignature(messageText: string, key: string, signatureHex: string): Promise<boolean> {
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
      encoder.encode(messageText)
    );
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Authenticate Request headers
    const deviceId = req.headers.get('x-device-id');
    const signatureHex = req.headers.get('x-device-signature');

    if (!deviceId || !signatureHex) {
      return new Response(JSON.stringify({ error: 'Missing authentication headers' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Initialize Supabase Service Role client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? "";
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Query the registered wheelchair & its device key
    const { data: wheelchair, error: dbError } = await supabase
      .from('wheelchairs')
      .select('device_key')
      .eq('id', deviceId)
      .single();

    if (dbError || !wheelchair || !wheelchair.device_key) {
      console.error(`Device ${deviceId} not found or has no key.`, dbError);
      return new Response(JSON.stringify({ error: 'Device not registered' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(req.url);

    // 4. Handle Route GET: Polling pending commands
    if (req.method === 'GET') {
      // Verify signature on query parameters: "device=WCHAIR-001&status=pending"
      const queryString = url.search.slice(1);
      const isSigValid = await verifySignature(queryString, wheelchair.device_key, signatureHex);
      
      if (!isSigValid) {
        return new Response(JSON.stringify({ error: 'Invalid HMAC signature on query parameters' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Fetch pending commands from commands table
      const { data: pendingCommands, error: cmdError } = await supabase
        .from('commands')
        .select('id, cmd, req_id, args')
        .eq('wheelchair_id', deviceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (cmdError) throw cmdError;

      return new Response(JSON.stringify(pendingCommands || []), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 5. Handle Route POST: Acknowledging execution
    if (req.method === 'POST') {
      const bodyText = await req.text();
      const isSigValid = await verifySignature(bodyText, wheelchair.device_key, signatureHex);
      
      if (!isSigValid) {
        return new Response(JSON.stringify({ error: 'Invalid HMAC signature on body' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const body = JSON.parse(bodyText);
      const { id, req_id, ok, state } = body;
      const epochToIso = (value: unknown): string | null => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 1672531200) {
          return null;
        }
        return new Date(value * 1000).toISOString();
      };

      if (!id || !req_id) {
        return new Response(JSON.stringify({ error: 'Missing mandatory ack fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Update command row in DB
      const { error: ackError } = await supabase
        .from('commands')
        .update({
          status: ok ? 'acked' : 'failed',
          ack: body,
          acked_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('wheelchair_id', deviceId);

      if (ackError) throw ackError;

      // C3: rental lifecycle reconciliation driven by DEVICE acks. The cron
      // supervisor and payment transaction use deterministic req_ids keyed on
      // the rental id: 'unlock-<uuid>' and 'end-<uuid>'.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof req_id === 'string') {
        if (req_id.startsWith('end-') && UUID_RE.test(req_id.slice(4))) {
          const rentalId = req_id.slice(4);
          if (ok) {
            // Device confirmed the session end — only NOW is the rental ended.
            const endedAt = epochToIso(body.session_end_ts) || new Date().toISOString();
            await supabase
              .from('rentals')
              .update({ state: 'ended', end_at: endedAt })
              .eq('id', rentalId)
              .eq('state', 'ending');
          }
        } else if (req_id.startsWith('unlock-') && UUID_RE.test(req_id.slice(7))) {
          const rentalId = req_id.slice(7);
          if (ok) {
            // Device consumed UNLOCK now — reconcile the cloud's wall-clock
            // window to when the countdown ACTUALLY started (the command may
            // have sat pending while the device was faulted or offline).
            const { data: rentalRow } = await supabase
              .from('rentals')
              .select('duration_s')
              .eq('id', rentalId)
              .maybeSingle();
            if (rentalRow?.duration_s) {
              const reportedStartAt = epochToIso(body.session_start_ts);
              const startAt = reportedStartAt ? new Date(reportedStartAt) : new Date();
              const endAt = new Date(startAt.getTime() + rentalRow.duration_s * 1000);
              await supabase
                .from('rentals')
                .update({ start_at: startAt.toISOString(), end_at: endAt.toISOString() })
                .eq('id', rentalId)
                .eq('state', 'active');
            }
          } else {
            // M5: the device REFUSED to unlock (e.g. active safety fault).
            // Surface it and cancel the companion commands so speed-limit /
            // geofence changes are never applied to a chair that never unlocked.
            await supabase
              .from('rentals')
              .update({ state: 'unlock_failed' })
              .eq('id', rentalId)
              .eq('state', 'active');
            await supabase
              .from('commands')
              .update({ status: 'failed', acked_at: new Date().toISOString() })
              .eq('wheelchair_id', deviceId)
              .in('req_id', [`speed-${rentalId}`, `geofence-${rentalId}`])
              .eq('status', 'pending');
            await supabase.from('events').insert({
              wheelchair_id: deviceId,
              type: 'UNLOCK_FAILED',
              detail: { rental_id: rentalId, reason: 'device rejected UNLOCK (active safety fault?)' }
            });
          }
        }
      }

      // Optimistically update device_state with the command result if applicable
      // This ensures desired state matches reported state in DB shadow
      if (ok && state) {
        const updates: any = { ts: new Date().toISOString() };
        if (state.locked !== undefined) updates.locked = state.locked;
        if (state.power !== undefined) updates.power = state.power;
        if (state.speed_limit !== undefined) updates.speed_limit = state.speed_limit;
        if (state.geofence !== undefined) updates.geofence = state.geofence;
        if (state.session_state !== undefined) updates.session_state = state.session_state;

        await supabase
          .from('device_state')
          .update(updates)
          .eq('wheelchair_id', deviceId);
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error("Commands error:", err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
