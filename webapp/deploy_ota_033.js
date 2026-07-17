const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg4NzI0MiwiZXhwIjoyMDk4NDYzMjQyfQ.u8hh_MYE3tq2JgHLJTUWXKbea33Lwcy3y-Dax_MmWHc';
const PROJECT_REF = 'txqjevrhedgsjltnflmg';
const BUCKET = 'firmware';
const VERSION = '0.3.3';

const supabase = createClient(
  `https://${PROJECT_REF}.supabase.co`,
  SERVICE_KEY
);

async function deploy() {
  console.log(`--- Deploying Firmware version ${VERSION} OTA binary ---`);

  const binPath = path.join(__dirname, '../firmware/builds/firmware_v0.3.3.bin');
  if (!fs.existsSync(binPath)) {
    console.error(`Binary not found at: ${binPath}`);
    process.exit(1);
  }

  const fileData = fs.readFileSync(binPath);
  const fileSize = fileData.length;
  console.log(`Loaded binary successfully. Size: ${fileSize} bytes`);

  const storagePath = `releases/${VERSION}/firmware_v0.3.3.bin`;
  console.log(`Uploading to storage bucket '${BUCKET}' at: ${storagePath}...`);

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileData, {
      upsert: true,
      contentType: 'application/octet-stream'
    });

  if (uploadErr) {
    console.error("Storage upload failed:", uploadErr.message);
    process.exit(1);
  }
  console.log("Uploaded successfully to storage:", uploadData);

  const publicUrl = `https://${PROJECT_REF}.supabase.co/storage/v1/object/public/${BUCKET}/${storagePath}`;
  console.log(`Public URL: ${publicUrl}`);

  console.log("Registering release in firmware_releases table...");
  const { data: releaseData, error: releaseErr } = await supabase
    .from('firmware_releases')
    .upsert(
      {
        version: VERSION,
        url: publicUrl,
        size: fileSize,
        notes: 'Diagnostics update (IMU and GPS status checks + raw NMEA console support)'
      },
      { onConflict: 'version' }
    )
    .select();

  if (releaseErr) {
    console.error("Database registration failed:", releaseErr.message);
    process.exit(1);
  }

  console.log("Successfully registered release:", releaseData);
  console.log("\nOTA binary deployment COMPLETE!");
}

deploy();
