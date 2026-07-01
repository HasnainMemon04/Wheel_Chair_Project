import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

// Service role client runs with elevated bypass privileges on backend
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    const { wheelchair_id, duration_s } = await request.json();

    if (!wheelchair_id || !duration_s) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Attempt to retrieve a default profile ID (fallback to null if none exists)
    const { data: profile } = await supabase.from('profiles').select('id').limit(1).single();
    const userId = profile?.id || null;

    const { data: rental, error } = await supabase
      .from('rentals')
      .insert({
        wheelchair_id,
        user_id: userId,
        state: 'reserved',
        duration_s,
        speed_limit: 6
      })
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rental });

  } catch (err: any) {
    console.error("Create rental API error:", err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
