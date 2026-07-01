import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize privileged service-role client to bypass RLS during webhook handling
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { provider, rental_id, amount, provider_ref } = body;

    // 1. Env-gate check: Reject mock payments if not explicitly configured in dev mode
    const configuredProvider = process.env.PAYMENT_PROVIDER || 'mock'; // Default to mock in scaffolding
    
    if (provider === 'mock' && configuredProvider !== 'mock') {
      return NextResponse.json({ error: 'Mock payments are disabled in production' }, { status: 403 });
    }

    if (!rental_id || !provider_ref) {
      return NextResponse.json({ error: 'Missing mandatory fields' }, { status: 400 });
    }

    // 2. Fetch the corresponding rental details
    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select('*')
      .eq('id', rental_id)
      .single();

    if (rentalError || !rental) {
      console.error(`Rental ${rental_id} not found.`, rentalError);
      return NextResponse.json({ error: 'Associated rental booking not found' }, { status: 404 });
    }

    // If already active or finished, return early
    if (rental.state === 'active') {
      return NextResponse.json({ ok: true, message: 'Rental already active' });
    }

    // 3. Create the payment record (Enforces idempotency on provider_ref)
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        rental_id: rental_id,
        amount: amount,
        currency: 'PKR',
        provider: provider,
        provider_ref: provider_ref,
        status: 'PAID',
        paid_at: new Date().toISOString()
      });

    if (paymentError) {
      // If error is unique constraint violation, it means webhook already processed successfully
      if (paymentError.code === '23505') {
        return NextResponse.json({ ok: true, message: 'Webhook already processed (idempotent)' });
      }
      throw paymentError;
    }

    // 4. Update the rental state to ACTIVE
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + rental.duration_s * 1000);

    const { error: updateRentalError } = await supabase
      .from('rentals')
      .update({
        state: 'active',
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString()
      })
      .eq('id', rental_id);

    if (updateRentalError) throw updateRentalError;

    // 5. Query latest position of the wheelchair to center geofence
    const { data: deviceState } = await supabase
      .from('device_state')
      .select('lat, lng')
      .eq('wheelchair_id', rental.wheelchair_id)
      .single();

    const currentLat = deviceState?.lat || 24.860731;
    const currentLng = deviceState?.lng || 67.001142;

    // 6. Insert Commands in the queue: UNLOCK + SET_SPEED_LIMIT + SET_GEOFENCE
    // Note: Device polls this commands table
    const commandsToInsert = [
      {
        wheelchair_id: rental.wheelchair_id,
        cmd: 'UNLOCK',
        args: { duration_s: rental.duration_s },
        status: 'pending',
        req_id: `unlock-${Date.now()}`
      },
      {
        wheelchair_id: rental.wheelchair_id,
        cmd: 'SET_SPEED_LIMIT',
        args: { kmh: rental.speed_limit || 6 },
        status: 'pending',
        req_id: `speed-${Date.now()}`
      },
      {
        wheelchair_id: rental.wheelchair_id,
        cmd: 'SET_GEOFENCE',
        args: { lat: currentLat, lng: currentLng, radius: 300 },
        status: 'pending',
        req_id: `geofence-${Date.now()}`
      }
    ];

    const { error: commandsError } = await supabase
      .from('commands')
      .insert(commandsToInsert);

    if (commandsError) throw commandsError;

    console.log(`Successfully unlocked wheelchair ${rental.wheelchair_id} for rental session ${rental_id}`);
    return NextResponse.json({ ok: true, unlocked: true });

  } catch (err: any) {
    console.error("Webhook processing error:", err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
