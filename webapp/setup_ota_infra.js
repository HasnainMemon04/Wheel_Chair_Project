const { createClient } = require('@supabase/supabase-js');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cWpldnJoZWRnc2psdG5mbG1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg4NzI0MiwiZXhwIjoyMDk4NDYzMjQyfQ.u8hh_MYE3tq2JgHLJTUWXKbea33Lwcy3y-Dax_MmWHc';
const PROJECT_REF = 'txqjevrhedgsjltnflmg';

const supabase = createClient(
  `https://${PROJECT_REF}.supabase.co`,
  SERVICE_KEY
);

async function runSQL(sql) {
  // Use the Supabase pg-meta / SQL query endpoint
  const resp = await fetch(`https://${PROJECT_REF}.supabase.co/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql })
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

async function setup() {
  // 1. Update bucket to remove MIME restrictions & confirm public
  console.log("=== Updating firmware bucket (remove MIME restriction) ===");
  const { data: uBucket, error: uErr } = await supabase.storage.updateBucket('firmware', {
    public: true,
    allowedMimeTypes: null,
    fileSizeLimit: 16777216  // 16 MB
  });
  if (uErr) console.log("Update bucket error:", uErr.message);
  else console.log("Bucket updated OK:", uBucket);

  // 2. Create firmware_releases table
  console.log("\n=== Creating firmware_releases table ===");
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS public.firmware_releases (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      version text NOT NULL UNIQUE,
      url text NOT NULL,
      size bigint,
      notes text,
      created_at timestamptz DEFAULT now()
    );
  `;
  let r = await runSQL(createTableSQL);
  console.log("Create table:", r.status, r.body.substring(0, 200));

  // 3. Enable RLS + policies
  console.log("\n=== Setting RLS policies on firmware_releases ===");
  r = await runSQL(`ALTER TABLE public.firmware_releases ENABLE ROW LEVEL SECURITY;`);
  console.log("Enable RLS:", r.status);

  r = await runSQL(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_releases' AND policyname='anon_read_releases') THEN
        CREATE POLICY anon_read_releases ON public.firmware_releases FOR SELECT USING (true);
      END IF;
    END $$;
  `);
  console.log("Read policy:", r.status);

  r = await runSQL(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_releases' AND policyname='anon_insert_releases') THEN
        CREATE POLICY anon_insert_releases ON public.firmware_releases FOR INSERT WITH CHECK (true);
      END IF;
    END $$;
  `);
  console.log("Insert policy:", r.status);

  // 4. Storage policies — allow anon to read and upload to firmware bucket
  console.log("\n=== Setting storage RLS policies ===");
  r = await runSQL(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='firmware_public_read') THEN
        CREATE POLICY firmware_public_read ON storage.objects FOR SELECT USING (bucket_id = 'firmware');
      END IF;
    END $$;
  `);
  console.log("Storage read policy:", r.status);

  r = await runSQL(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='firmware_public_upload') THEN
        CREATE POLICY firmware_public_upload ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'firmware');
      END IF;
    END $$;
  `);
  console.log("Storage upload policy:", r.status);

  // 5. Verify
  console.log("\n=== Final verification ===");
  const { data, error } = await supabase.from('firmware_releases').select('*').limit(1);
  if (error) console.log("firmware_releases table ERROR:", error.message);
  else console.log("firmware_releases table OK, rows:", data.length);

  // Test storage upload
  const testBuf = Buffer.from('hello');
  const { error: upErr } = await supabase.storage
    .from('firmware')
    .upload('test/ping.bin', testBuf, { upsert: true, contentType: 'application/octet-stream' });
  if (upErr) console.log("Storage upload test ERROR:", upErr.message);
  else {
    console.log("Storage upload test OK");
    await supabase.storage.from('firmware').remove(['test/ping.bin']);
    console.log("Cleaned up test file");
  }
}

setup();
