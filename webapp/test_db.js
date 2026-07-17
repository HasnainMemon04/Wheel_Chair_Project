const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://txqjevrhedgsjltnflmg.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODcyNDIsImV4cCI6MjA5ODQ2MzI0Mn0.y8vhajDI0f2p2dbDbdmN82WNs7x6jf9rbU_ojsGvP54';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log("--- Supabase Live Connection Test ---");
  
  console.log("\n1. Querying 'wheelchairs'...");
  const { data: wData, error: wError } = await supabase.from('wheelchairs').select('*');
  if (wError) {
    console.error("  FAILED:", wError);
  } else {
    console.log("  SUCCESS:", wData);
  }

  console.log("\n2. Querying 'device_state'...");
  const { data: sData, error: sError } = await supabase.from('device_state').select('*');
  if (sError) {
    console.error("  FAILED:", sError);
  } else {
    console.log("  SUCCESS:", sData);
  }

  console.log("\n3. Querying 'events'...");
  const { data: eData, error: eError } = await supabase.from('events').select('*');
  if (eError) {
    console.error("  FAILED:", eError);
  } else {
    console.log("  SUCCESS:", eData);
  }
}

test();
