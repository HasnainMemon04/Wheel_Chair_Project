const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://txqjevrhedgsjltnflmg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg4NzI0MiwiZXhwIjoyMDk4NDYzMjQyfQ.u8hh_MYE3tq2JgHLJTUWXKbea33Lwcy3y-Dax_MmWHc'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("Subscribing to device_state Realtime changes...");

const channel = supabase
  .channel('test-realtime')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'device_state' },
    (payload) => {
      console.log("\n--- Realtime Change Received ---");
      console.log("Event Type:", payload.eventType);
      console.log("Timestamp:", payload.new.ts);
      console.log("Locked State:", payload.new.locked);
      console.log("Session State:", payload.new.session_state);
      console.log("Tamper Alarm:", payload.new.tamper);
      console.log("Tamper Count:", payload.new.tamper_count);
      console.log("Tilt Angle:", payload.new.tilt);
    }
  )
  .subscribe((status) => {
    console.log("Realtime status changed:", status);
  });

// Keep process alive for 60 seconds
setTimeout(() => {
  console.log("Closing subscription.");
  process.exit(0);
}, 60000);
