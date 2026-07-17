import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST() {
  try {
    // 1. Upsert default wheelchair
    const { error: wError } = await supabase
      .from('wheelchairs')
      .upsert({
        id: 'WCHAIR-001',
        fw_version: '0.1.0',
        device_key: 'super-secret-key-123',
        status: 'available'
      });

    if (wError) throw wError;

    // 2. Upsert default device state snapshot
    const { error: sError } = await supabase
      .from('device_state')
      .upsert({
        wheelchair_id: 'WCHAIR-001',
        online: true,
        lat: 24.860048,
        lng: 67.063734,
        speed: 0.0,
        sats: 8,
        hdop: 1.2,
        pitch: null,
        roll: null,
        tilt: null,
        temp_batt: 31.2,
        batt_v: 4.1,
        batt_pct: 95,
        in_motion: false,
        rssi: -54,
        power: true,
        locked: true,
        session_state: 'LOCKED',
        time_left: 0,
        geofence: { on: 1, in: 1, dist: 0, r: 300, lat: 24.860048, lng: 67.063734 }
      });

    if (sError) throw sError;

    return NextResponse.json({ ok: true, message: 'Mock Wheelchair seeded successfully' });

  } catch (err: any) {
    console.error("Seeding API error:", err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
