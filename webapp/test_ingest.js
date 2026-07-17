const crypto = require('crypto');
// fetch is globally available in modern Node.js

const DEVICE_ID = 'WCHAIR-001';
const DEVICE_KEY = 'super-secret-key-123';
const SUPABASE_URL = 'https://txqjevrhedgsjltnflmg.supabase.co';
const INGEST_URL = `${SUPABASE_URL}/functions/v1/ingest`;

function generateHMAC(message, key) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

async function testIngest() {
  console.log("--- Testing Supabase Ingest Edge Function ---");

  // Create a realistic telemetry payload with tamper_count: 2
  const telemetryPayload = {
    kind: "telemetry",
    id: DEVICE_ID,
    ts: Math.floor(Date.now() / 1000),
    fw: "0.1.0",
    up: 120,
    fix: 1,
    lat: 24.86007239,
    lng: 67.06373067,
    spd: 0.0,
    sats: 8,
    hdop: 1.1,
    pitch: 0.0,
    roll: 0.0,
    tilt: 4.2,
    temp_batt: 34.5,
    batt_v: 4.18,
    batt_pct: 98,
    in_motion: 0,
    tamper: 0,
    tamper_count: 2,
    rssi: -82,
    power: 1,
    locked: 1,
    session_state: "LOCKED",
    time_left: 0,
    gf: {
      on: 1,
      in: 0,
      dist: 6315.06,
      r: 300,
      lat: 24.860731,
      lng: 67.001142
    }
  };

  const bodyText = JSON.stringify(telemetryPayload);
  const signature = generateHMAC(bodyText, DEVICE_KEY);

  console.log("Sending payload...");
  try {
    const response = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': DEVICE_ID,
        'x-device-signature': signature
      },
      body: bodyText
    });

    const status = response.status;
    const responseText = await response.text();
    console.log(`HTTP Status: ${status}`);
    console.log(`Response: ${responseText}`);
  } catch (err) {
    console.error("Request failed:", err);
  }
}

testIngest();
