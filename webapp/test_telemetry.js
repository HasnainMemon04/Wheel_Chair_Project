const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://txqjevrhedgsjltnflmg.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODcyNDIsImV4cCI6MjA5ODQ2MzI0Mn0.y8vhajDI0f2p2dbDbdmN82WNs7x6jf9rbU_ojsGvP54';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log("--- Fetching recent telemetry history ---");
  const { data, error } = await supabase
    .from('telemetry_history')
    .select('*')
    .order('ts', { ascending: false })
    .limit(5);

  if (error) {
    console.error("Failed:", error);
  } else {
    console.log("SUCCESS:", data);
  }
}

test();
