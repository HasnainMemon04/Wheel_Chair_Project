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
  temp_motor: number;
  temp_batt: number;
  temp_amb: number;
  humidity: number;
  batt_v: number;
  batt_pct: number;
  occupied: boolean;
  rssi: number;
  power: boolean;
  locked: boolean;
  session_state: string;
  time_left: number;
  speed_limit: number;
  over_speed: boolean;
  geofence: {
    on: number;
    in: number;
    dist: number;
    r: number;
  } | null;
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

    // 1. Fetch initial states
    const fetchInitialData = async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      if (!url || url.includes('YOUR-PROJECT') || url.includes('placeholder-project')) {
        setLoading(false);
        setError("Supabase URL is not configured. Please copy webapp/.env.example to webapp/.env.local and set your real NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        return;
      }

      try {
        setLoading(true);
        
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
          setDeviceStates(statesData || []);
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

    fetchInitialData();

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
              next[index] = updatedRow;
              return next;
            } else {
              return [...prev, updatedRow];
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
        // console.log("Realtime subscription status:", status);
      });

    // Cleanup
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return { deviceStates, events, loading, error };
}
