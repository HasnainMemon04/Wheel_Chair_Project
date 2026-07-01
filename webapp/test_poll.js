const crypto = require('crypto');

function calculateHMAC(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

async function run() {
  const supabaseUrl = 'https://txqjevrhedgsjltnflmg.supabase.co';
  const deviceId = 'WCHAIR-001';
  const deviceKey = 'super-secret-key-123';
  
  const query = `device=${deviceId}&status=pending`;
  const signature = calculateHMAC(query, deviceKey);
  
  const url = `${supabaseUrl}/functions/v1/commands?${query}`;
  console.log("Polling URL:", url);
  console.log("Signature:", signature);
  
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-device-id': deviceId,
        'x-device-signature': signature
      }
    });
    
    console.log("Response Status:", res.status);
    const text = await res.text();
    console.log("Response Body:", text);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

run();
