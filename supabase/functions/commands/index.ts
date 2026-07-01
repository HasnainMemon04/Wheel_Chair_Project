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
    
    console.log("Supabase URL:", supabaseUrl);
    console.log("Service Key Length:", supabaseServiceKey.length);
    console.log("Service Key Prefix:", supabaseServiceKey.substring(0, 10));
    
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
