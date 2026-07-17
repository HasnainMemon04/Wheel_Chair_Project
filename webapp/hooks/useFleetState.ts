import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

export interface DeviceState {
  wheelchair_id: string;
  ts: string;
  online: boolean;
  lat: number;
  lng: number;
  speed: number;
  sats: number;
  hdop: number;
  pitch: number;
  roll: number;
  tilt: number;
  yaw: number;
  temp_batt: number;
  batt_v: number;
  batt_pct: number;
  in_motion: boolean;
  tamper: boolean;
  tamper_count: number;
  uptime: number | null;
  rssi: number;
  power: boolean;
  locked: boolean;
  session_state: string;
  time_left: number;
  fw_version?: string;
  target_version?: string;
  ota_status?: string;
  ota_progress?: number;
  ota_last_error?: string;
  geofence: {
    on: number;
    in: number;
    dist: number;
    r: number;
  } | null;
  last_seen_local?: number;
}

export interface SafetyEvent {
  id: string;
  wheelchair_id: string;
  type: string;
  detail: any;
  lat: number;
  lng: number;
  ts: string;
}

export function useFleetState() {
  const [deviceStates, setDeviceStates] = useState<DeviceState[]>([]);
  const [events, setEvents] = useState<SafetyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Full fleet snapshot fetch. Called on mount AND on every Realtime
    // (re)subscribe: postgres_changes does NOT replay rows changed while the
    // websocket was down, so a refetch is the only way to heal stale state
    // after a network blip (W1).
    const fetchFleetData = async (isInitial: boolean) => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      if (!url || url.includes('YOUR-PROJECT') || url.includes('placeholder-project')) {
        setLoading(false);
        setError("Supabase URL is not configured. Please copy webapp/.env.example to webapp/.env.local and set your real NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        return;
      }

      try {
        if (isInitial) setLoading(true);

        // Fetch current snapshot of device states
        const { data: statesData, error: statesError } = await supabase
          .from('device_state')
          .select('*');

        if (statesError) throw statesError;

        // Fetch recent safety events (last 30)
        const { data: eventsData, error: eventsError } = await supabase
          .from('events')
          .select('*')
          .order('ts', { ascending: false })
          .limit(30);

        if (eventsError) throw eventsError;

        if (active) {
          const now = Date.now();
          const enriched = (statesData || []).map(d => {
            if (!d.ts) return { ...d, last_seen_local: now, online: false };
            const age = now - new Date(d.ts).getTime();
            const shouldBeOnline = age < 5000;
            return {
              ...d,
              last_seen_local: now - age,
              online: shouldBeOnline
            };
          });

          setDeviceStates(enriched);
          setEvents(eventsData || []);
          setError(null);
        }
      } catch (err: any) {
        console.error("Error fetching initial fleet data:", err);
        console.error("Error properties:", {
          message: err?.message,
          code: err?.code,
          details: err?.details,
          hint: err?.hint,
          stack: err?.stack
        });
        const detailedError = err && typeof err === 'object' 
          ? `Message: ${err.message || 'unknown'}, Code: ${err.code || 'none'}, Details: ${err.details || 'none'}, Hint: ${err.hint || 'none'}`
          : String(err);
        if (active) {
          setError(detailedError);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchFleetData(true);

    // 2. Subscribe to Supabase Realtime changes
    const channel = supabase
      .channel('fleet-realtime')
      // Monitor all database operations on device_state
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_state' },
        (payload) => {
          if (!active) return;
          
          const updatedRow = payload.new as DeviceState;
          const oldRow = payload.old as { wheelchair_id: string };
          
          setDeviceStates((prev) => {
            if (payload.eventType === 'DELETE') {
              return prev.filter((d) => d.wheelchair_id !== oldRow.wheelchair_id);
            }
            
            const index = prev.findIndex((d) => d.wheelchair_id === updatedRow.wheelchair_id);
            if (index !== -1) {
              const next = [...prev];
              next[index] = { ...updatedRow, last_seen_local: Date.now(), online: true };
              return next;
            } else {
              return [...prev, { ...updatedRow, last_seen_local: Date.now(), online: true }];
            }
          });
        }
      )
      // Monitor new safety events
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          if (!active) return;
          const newEvent = payload.new as SafetyEvent;
          setEvents((prev) => [newEvent, ...prev].slice(0, 50));
        }
      )
      .subscribe((status) => {
        // W1: refetch the full snapshot on every successful (re)subscribe —
        // changes that happened while disconnected are never replayed.
        if (status === 'SUBSCRIBED') {
          fetchFleetData(false);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`Realtime channel state: ${status}. Awaiting auto-reconnect; data may be stale until resubscribe.`);
        }
      });

    // Cleanup
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // 3. Periodic timer to detect device offline state reactively based on local last_seen_local age
  useEffect(() => {
    const timer = setInterval(() => {
      setDeviceStates((prev) => {
        let changed = false;
        const now = Date.now();
        const next = prev.map((d) => {
          if (!d.last_seen_local) return d;
          const age = now - d.last_seen_local;
          const shouldBeOnline = age < 5000; // 5 seconds offline threshold
          if (d.online !== shouldBeOnline) {
            changed = true;
            return { ...d, online: shouldBeOnline };
          }
          return d;
        });
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return { deviceStates, events, loading, error };
}
