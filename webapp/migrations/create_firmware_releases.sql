-- Create firmware_releases table
CREATE TABLE IF NOT EXISTS public.firmware_releases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  version text NOT NULL UNIQUE,
  url text NOT NULL,
  size bigint,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.firmware_releases ENABLE ROW LEVEL SECURITY;

-- Grant table-level privileges (required in addition to RLS policies)
GRANT ALL ON public.firmware_releases TO anon, authenticated, service_role;

-- Allow anyone to read releases
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_releases' AND policyname='anon_read_releases') THEN
    CREATE POLICY anon_read_releases ON public.firmware_releases FOR SELECT USING (true);
  END IF;
END $$;

-- Allow anyone to insert releases (operator panel)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_releases' AND policyname='anon_insert_releases') THEN
    CREATE POLICY anon_insert_releases ON public.firmware_releases FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Allow anyone to delete releases (operator panel)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_releases' AND policyname='anon_delete_releases') THEN
    CREATE POLICY anon_delete_releases ON public.firmware_releases FOR DELETE USING (true);
  END IF;
END $$;

-- Storage: allow public read on firmware bucket
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='firmware_public_read') THEN
    CREATE POLICY firmware_public_read ON storage.objects FOR SELECT USING (bucket_id = 'firmware');
  END IF;
END $$;

-- Storage: allow public upload to firmware bucket
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='firmware_public_upload') THEN
    CREATE POLICY firmware_public_upload ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'firmware');
  END IF;
END $$;
