const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://txqjevrhedgsjltnflmg.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODcyNDIsImV4cCI6MjA5ODQ2MzI0Mn0.y8vhajDI0f2p2dbDbdmN82WNs7x6jf9rbU_ojsGvP54';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log("Usage: node queue_command.js <cmd_name> [key1 value1 key2 value2 ...]");
        console.log("Example: node queue_command.js UNLOCK duration_s 60");
        console.log("Example: node queue_command.js SET_SPEED_LIMIT kmh 4");
        console.log("Example: node queue_command.js OTA url http://192.168.100.13:8000/firmware_v2.bin version 0.2.0 size 1015792");
        process.exit(1);
    }

    const cmdName = args[0];
    let cmdArgs = {};
    for (let i = 1; i < args.length; i += 2) {
        const key = args[i];
        let val = args[i + 1];
        if (val !== undefined) {
            // Convert to number if applicable
            if (!isNaN(val) && val.trim() !== '') {
                val = Number(val);
            }
            cmdArgs[key] = val;
        }
    }

    const reqId = 'req_' + Math.floor(Math.random() * 100000);
    console.log(`Queueing command ${cmdName} with args:`, cmdArgs);

    const { data, error } = await supabase
        .from('commands')
        .insert([
            {
                wheelchair_id: 'WCHAIR-001',
                cmd: cmdName,
                req_id: reqId,
                args: cmdArgs,
                status: 'pending'
            }
        ])
        .select();

    if (error) {
        console.error("Failed to queue command:", error);
    } else {
        console.log("Command queued successfully! DB row:", data);
    }
}

run();
