const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://txqjevrhedgsjltnflmg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg4NzI0MiwiZXhwIjoyMDk4NDYzMjQyfQ.u8hh_MYE3tq2JgHLJTUWXKbea33Lwcy3y-Dax_MmWHc'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey);

async function testClear() {
  console.log("Inserting CLEAR_TAMPER command...");
  const { data, error } = await supabase.from('commands').insert({
    wheelchair_id: 'WCHAIR-001',
    cmd: 'CLEAR_TAMPER',
    args: {},
    status: 'pending'
  });

  if (error) {
    console.error("Failed to insert command:", error);
  } else {
    console.log("Success! CLEAR_TAMPER command inserted.");
  }
}

testClear();
