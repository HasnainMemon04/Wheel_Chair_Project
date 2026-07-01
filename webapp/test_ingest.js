const crypto = require('crypto');

function calculateHMAC(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

async function run() {
  const supabaseUrl = 'https://txqjevrhedgsjltnflmg.supabase.co';
  const deviceId = 'WCHAIR-001';
  const deviceKey = 'super-secret-key-123';
  
  const payload = {
    kind: 'telemetry',
    id: deviceId,
    ts: Math.floor(Date.now() / 1000),
    fw: '0.1.0',
    up: 100,
    fix: 1,
    lat: 24.860731,
    lng: 67.001142,
    spd: 0.0,
    sats: 8,
    hdop: 1.2,
    pitch: 0.0,
    roll: 0.0,
    tilt: 0.0,
    temp_motor: 25.0,
    temp_batt: 25.0,
    temp_amb: 25.0,
    humidity: 60,
    batt_v: 4.1,
    batt_pct: 95,
    occupied: 0,
    rssi: -50,
    power: 1,
    locked: 1,
    session_state: 'LOCKED',
    time_left: 0,
    speed_limit: 6,
    over_speed: 0,
    gf: { on: 1, in: 1, dist: 0, r: 300 }
  };
  
  const bodyStr = JSON.stringify(payload);
  const signature = calculateHMAC(bodyStr, deviceKey);
  
  const url = `${supabaseUrl}/functions/v1/ingest`;
  console.log("Ingest URL:", url);
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        'x-device-signature': signature
      },
      body: bodyStr
    });
    
    console.log("Ingest Status:", res.status);
    const text = await res.text();
    console.log("Ingest Body:", text);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

run();
