const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://txqjevrhedgsjltnflmg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODcyNDIsImV4cCI6MjA5ODQ2MzI0Mn0.y8vhajDI0f2p2dbDbdmN82WNs7x6jf9rbU_ojsGvP54'
);

async function check() {
  console.log("=== Checking current device_state for WCHAIR-001 ===");
  const { data, error } = await supabase
    .from('device_state')
    .select('*')
    .eq('wheelchair_id', 'WCHAIR-001')
    .single();
  
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log("Telemetry details from Supabase database:");
  console.log(" - Temp Battery:", data.temp_batt);
  console.log(" - Temp Ambient:", data.temp_amb);
  console.log(" - Humidity:", data.humidity);
  console.log(" - Pitch:", data.pitch);
  console.log(" - Roll:", data.roll);
  console.log(" - Tilt:", data.tilt);
  console.log(" - Yaw:", data.yaw);
  console.log(" - Speed Limit:", data.speed_limit);
  console.log(" - Over Speed:", data.over_speed);
  console.log(" - Live Timestamp:", data.ts);
}

check();
