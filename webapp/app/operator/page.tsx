'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { type SafetyEvent, useFleetState } from '../../hooks/useFleetState';
import { supabase } from '../../utils/supabase';
import {
  Zap, Battery, ShieldAlert, Thermometer, Radio,
  MapPin, Sliders, Play, Square, Unlock, Lock, RefreshCw, AlertTriangle, ShieldOff, Trash2, Activity
} from 'lucide-react';
import Link from 'next/link';

const DISMISSED_FEED_EVENTS_KEY = 'wheelchair-console-dismissed-feed-events';

// Dynamic import to bypass Next.js SSR window check
const Map = dynamic(() => import('../../components/Map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 gap-3">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium">Initializing Fleet Map...</p>
    </div>
  )
});

function isQueuedOtaRequest(event: SafetyEvent) {
  if (event.type !== 'OTA_REQUESTED' || !event.detail || typeof event.detail !== 'object' || Array.isArray(event.detail)) {
    return false;
  }

  return (event.detail as Record<string, unknown>).source === 'operator_console';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatSensorValue(value: unknown, digits = 2, fallback = '--') {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : fallback;
}

function DiagnosticResult({
  event,
  pending,
  error
}: {
  event?: SafetyEvent;
  pending: boolean;
  error: string | null;
}) {
  if (pending) {
    return (
      <div className="flex items-center justify-center gap-2 border-t border-zinc-900 py-3 text-[10px] font-semibold text-blue-300">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Waiting for live ESP32 sensor snapshot...
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-zinc-900 pt-2.5 text-[10px] font-semibold text-red-300">
        {error}
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-1 text-[10px] text-zinc-500">
        No diagnostics run yet.
      </div>
    );
  }

  const detail = asRecord(event.detail);
  const gps = asRecord(detail.gps);
  const imu = asRecord(detail.imu);
  const accel = asRecord(imu.accel_g);
  const gyro = asRecord(imu.gyro_dps);
  const orientation = asRecord(imu.orientation_deg);
  const nmea = Array.isArray(gps.nmea)
    ? gps.nmea.filter((line): line is string => typeof line === 'string' && line.length > 0)
    : [];

  const realSnapshot =
    detail.source === 'esp32s3' &&
    typeof detail.schema_version === 'number' &&
    detail.schema_version >= 2;
  const gpsConnected = gps.connected === true;
  const gpsFix = gps.fix === true;
  const imuConnected = imu.connected === true || detail.imu_status === 'OK';
  const gpsStatus = gpsFix ? '3D FIX' : !gpsConnected ? 'NO DATA' : 'NO FIX';

  return (
    <div className="space-y-3 border-t border-zinc-900 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Live sensor snapshot</span>
        <span className={`rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${
          realSnapshot ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
        }`}>
          {realSnapshot ? 'Real ESP32' : 'Legacy result'}
        </span>
      </div>

      <section className="space-y-2 border-b border-zinc-900 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-wider text-zinc-300">NEO-M8N GPS</span>
          <span className={`text-[9px] font-black ${
            gpsFix ? 'text-emerald-300' : gpsConnected ? 'text-amber-300' : 'text-red-300'
          }`}>
            {gpsStatus}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[9px]">
          <div><span className="block text-zinc-600">Latitude</span><span className="text-zinc-200">{gpsFix ? formatSensorValue(gps.latitude, 6) : '--'}</span></div>
          <div><span className="block text-zinc-600">Longitude</span><span className="text-zinc-200">{gpsFix ? formatSensorValue(gps.longitude, 6) : '--'}</span></div>
          <div><span className="block text-zinc-600">Satellites</span><span className="text-zinc-200">{formatSensorValue(gps.satellites, 0)}</span></div>
          <div><span className="block text-zinc-600">HDOP</span><span className="text-zinc-200">{formatSensorValue(gps.hdop)}</span></div>
          <div><span className="block text-zinc-600">Speed km/h</span><span className="text-zinc-200">{formatSensorValue(gps.speed_kmh)}</span></div>
          <div><span className="block text-zinc-600">Altitude m</span><span className="text-zinc-200">{formatSensorValue(gps.altitude_m)}</span></div>
          <div><span className="block text-zinc-600">Course deg</span><span className="text-zinc-200">{formatSensorValue(gps.course_deg)}</span></div>
          <div><span className="block text-zinc-600">Data age</span><span className="text-zinc-200">{formatSensorValue(gps.data_age_ms, 0)} ms</span></div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8px] font-semibold text-zinc-500">
          <span>Chars {formatSensorValue(gps.chars_processed, 0)}</span>
          <span>Valid {formatSensorValue(gps.sentences_valid, 0)}</span>
          <span>Checksum errors {formatSensorValue(gps.checksum_failures, 0)}</span>
        </div>

        <div>
          <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-zinc-600">Raw NMEA from UART</div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-zinc-800 bg-black/30 p-2 font-mono text-[8px] leading-relaxed text-cyan-200">
            {nmea.length > 0 ? nmea.join('\n') : 'No GGA/RMC sentence received from the GPS UART.'}
          </pre>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-wider text-zinc-300">MPU6500 IMU</span>
          <span className={`text-[9px] font-black ${imuConnected ? 'text-emerald-300' : 'text-red-300'}`}>
            {imuConnected ? 'STREAMING' : 'NO DATA'}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1 font-mono text-[8px]">
          {(['pitch', 'roll', 'yaw', 'tilt'] as const).map((axis) => (
            <div key={axis} className="min-w-0 border-l border-zinc-800 pl-1.5">
              <span className="block uppercase text-zinc-600">{axis}</span>
              <span className="text-zinc-200">{formatSensorValue(orientation[axis])}°</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 font-mono text-[8px]">
          <div>
            <span className="mb-1 block font-sans font-bold uppercase tracking-wider text-zinc-600">Acceleration (g)</span>
            <div className="flex justify-between text-zinc-300"><span>X {formatSensorValue(accel.x, 3)}</span><span>Y {formatSensorValue(accel.y, 3)}</span><span>Z {formatSensorValue(accel.z, 3)}</span></div>
          </div>
          <div>
            <span className="mb-1 block font-sans font-bold uppercase tracking-wider text-zinc-600">Gyroscope (°/s)</span>
            <div className="flex justify-between text-zinc-300"><span>X {formatSensorValue(gyro.x, 2)}</span><span>Y {formatSensorValue(gyro.y, 2)}</span><span>Z {formatSensorValue(gyro.z, 2)}</span></div>
          </div>
        </div>
      </section>

      <div className="text-right text-[8px] font-semibold text-zinc-600">
        Captured {new Date(event.ts).toLocaleTimeString()}
      </div>
    </div>
  );
}

export default function OperatorPage() {
  const { deviceStates, events, loading, error, removeEvents } = useFleetState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'fleet' | 'alerts' | 'firmware'>('fleet');
  const [actionLoading, setActionLoading] = useState(false);

  // OTA management states
  const [uploading, setUploading] = useState(false);
  const [fwVersionInput, setFwVersionInput] = useState("");
  const [fwNotesInput, setFwNotesInput] = useState("");
  const [releases, setReleases] = useState<any[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string>("");
  const [otaError, setOtaError] = useState<string | null>(null);
  const [otaRolloutFleetWide, setOtaRolloutFleetWide] = useState(false);
  const [removingEvents, setRemovingEvents] = useState(false);
  const [dismissedFeedEventIds, setDismissedFeedEventIds] = useState<Set<string>>(new Set());
  const [diagnosticPending, setDiagnosticPending] = useState(false);
  const [diagnosticBaselineId, setDiagnosticBaselineId] = useState<string | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);

  // Custom inputs for commands
  const [gfRadius, setGfRadius] = useState<number>(300);
  const [gfLat, setGfLat] = useState<string>("24.860048");
  const [gfLng, setGfLng] = useState<string>("67.063734");

  // Track pending command states for each chair to support Optimistic UI
  const [pendingStates, setPendingStates] = useState<Record<string, { power?: boolean; locked?: boolean; ts?: number }>>({});
  // Seconds since the selected chair's last telemetry (ts is real wall-clock
  // now that the firmware syncs SNTP). Updated at 1 Hz — not 10 Hz.
  const [lastSeenS, setLastSeenS] = useState<number | null>(null);

  const selectedChair = deviceStates.find((d) => d.wheelchair_id === selectedId);
  const latestDiagnosticEvent = selectedChair
    ? events.find((event) =>
        event.wheelchair_id === selectedChair.wheelchair_id &&
        event.type === 'DIAGNOSTIC_RESULT'
      )
    : undefined;
  const queuedOtaRequestEvents = events.filter(isQueuedOtaRequest);
  const selectedQueuedOtaRequestEvents = selectedChair
    ? queuedOtaRequestEvents.filter((event) => event.wheelchair_id === selectedChair.wheelchair_id)
    : [];
  const visibleFeedEvents = events.filter((event) => !dismissedFeedEventIds.has(String(event.id)));
  const handleDeviceRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedId(id);
    }
  };

  useEffect(() => {
    try {
      const storedIds = window.localStorage.getItem(DISMISSED_FEED_EVENTS_KEY);
      if (!storedIds) return;

      const parsedIds: unknown = JSON.parse(storedIds);
      if (Array.isArray(parsedIds)) {
        setDismissedFeedEventIds(new Set(parsedIds.map(String)));
      }
    } catch (storageError) {
      console.warn('Could not restore dismissed feed notifications:', storageError);
    }
  }, []);

  // Prefill geofence coordinates when a new device is selected
  useEffect(() => {
    if (selectedId) {
      const chair = deviceStates.find((d) => d.wheelchair_id === selectedId);
      if (chair) {
        setGfLat((chair.lat ?? 0).toFixed(6));
        setGfLng((chair.lng ?? 0).toFixed(6));
        if (chair.geofence) {
          setGfRadius(chair.geofence.r);
        } else {
          setGfRadius(300); // default fallback
        }
      }
    }
  }, [selectedId]);

  // Reconcile optimistic states with incoming DB updates
  useEffect(() => {
    setPendingStates((prev) => {
      const next = { ...prev };
      let changed = false;

      deviceStates.forEach((d) => {
        const pending = next[d.wheelchair_id];
        if (!pending) return;

        // Clear pending flags if the reported state matches the desired value
        const clearPower = pending.power === undefined || d.power === pending.power;
        const clearLocked = pending.locked === undefined || d.locked === pending.locked;

        // Or clear if the update is older than 5 seconds
        const isStale = pending.ts ? (Date.now() - pending.ts > 5000) : true;

        if ((clearPower && clearLocked) || isStale) {
          delete next[d.wheelchair_id];
          changed = true;
        } else {
          if (clearPower) delete pending.power;
          if (clearLocked) delete pending.locked;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [deviceStates]);

  // Age of the selected chair's last telemetry update, refreshed once per
  // second (was a 10Hz interval driving full-page re-renders for an unused value).
  const lastUpdate = selectedChair ? new Date(selectedChair.ts).getTime() : 0;
  useEffect(() => {
    if (!lastUpdate) {
      setLastSeenS(null);
      return;
    }
    const tick = () => setLastSeenS(Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lastUpdate]);

  useEffect(() => {
    setDiagnosticPending(false);
    setDiagnosticBaselineId(null);
    setDiagnosticError(null);
  }, [selectedId]);

  useEffect(() => {
    if (
      diagnosticPending &&
      latestDiagnosticEvent &&
      String(latestDiagnosticEvent.id) !== diagnosticBaselineId
    ) {
      setDiagnosticPending(false);
      setDiagnosticBaselineId(String(latestDiagnosticEvent.id));
      setDiagnosticError(null);
    }
  }, [diagnosticBaselineId, diagnosticPending, latestDiagnosticEvent]);

  useEffect(() => {
    if (!diagnosticPending) return;

    const timeout = setTimeout(() => {
      setDiagnosticPending(false);
      setDiagnosticError('The ESP32 did not return a diagnostic snapshot within 15 seconds.');
    }, 15000);

    return () => clearTimeout(timeout);
  }, [diagnosticPending]);

  // Human-readable device uptime (real uptime from telemetry `up`, persisted
  // in device_state.uptime — the old header mislabeled the ts time-of-day).
  const formatUptime = (s: number | null | undefined) => {
    if (s == null || isNaN(s)) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  };
  const formatLastSeen = (s: number | null) => {
    if (s == null) return '—';
    if (s > 3600) return '>1h ago';
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
    return `${s}s ago`;
  };

  const pending = pendingStates[selectedId || ''];
  const displayPower = pending?.power !== undefined ? pending.power : (selectedChair?.power ?? false);
  const displayLocked = pending?.locked !== undefined ? pending.locked : (selectedChair?.locked ?? false);
  const isPowerPending = pending?.power !== undefined;
  const isLockedPending = pending?.locked !== undefined;

  // Send command helper
  const triggerCommand = async (cmd: string, args: any = {}) => {
    if (!selectedId) return false;
    setActionLoading(true);

    // Write to optimistic state immediately
    if (cmd === 'LOCK') {
      setPendingStates(prev => ({ ...prev, [selectedId]: { ...prev[selectedId], locked: true, ts: Date.now() } }));
    } else if (cmd === 'UNLOCK') {
      setPendingStates(prev => ({ ...prev, [selectedId]: { ...prev[selectedId], locked: false, ts: Date.now() } }));
    } else if (cmd === 'POWER_OFF') {
      setPendingStates(prev => ({ ...prev, [selectedId]: { ...prev[selectedId], power: false, ts: Date.now() } }));
    } else if (cmd === 'POWER_ON') {
      setPendingStates(prev => ({ ...prev, [selectedId]: { ...prev[selectedId], power: true, ts: Date.now() } }));
    }

    try {
      const { error } = await supabase
        .from('commands')
        .insert({
          wheelchair_id: selectedId,
          cmd,
          args,
          status: 'pending',
          req_id: `cmd-${Date.now()}`
        });

      if (error) throw error;
      return true;
    } catch (err: any) {
      alert("Command failure: " + err.message);
      // Clear optimistic state on error
      setPendingStates(prev => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const runDiagnosticCheck = async () => {
    if (!selectedChair || !selectedChair.online || diagnosticPending) return;

    setDiagnosticBaselineId(latestDiagnosticEvent ? String(latestDiagnosticEvent.id) : null);
    setDiagnosticError(null);
    setDiagnosticPending(true);

    const queued = await triggerCommand('DIAGNOSTIC_RUN');
    if (!queued) {
      setDiagnosticPending(false);
      setDiagnosticError('Could not queue the diagnostic command.');
    }
  };

  const fetchReleases = async () => {
    const { data, error } = await supabase
      .from('firmware_releases')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setReleases(data);
      if (data.length > 0) {
        setSelectedReleaseId(data[0].id.toString());
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'firmware') {
      fetchReleases();
    }
  }, [activeTab]);

  // Browser-based emergency audio alarm player (oscillator synth)
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let interval: any = null;

    const hasCriticalOvertemp = selectedChair && selectedChair.temp_batt != null && selectedChair.temp_batt > 55.0;
    const hasCriticalFall = selectedChair && selectedChair.tilt != null && selectedChair.tilt > 50.0;
    const hasCriticalSOS = selectedChair && selectedChair.session_state === 'SAFE_FAULT';

    const alarmActive = selectedChair && (hasCriticalOvertemp || hasCriticalFall || hasCriticalSOS);

    if (alarmActive) {
      // Start browser audio synthesis loop
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        
        interval = setInterval(() => {
          if (!audioCtx || audioCtx.state === 'suspended') return;
          
          try {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.type = 'sawtooth';
            // Pulsing alternating frequencies (high pitched rescue sweep sound)
            const time = audioCtx.currentTime;
            osc.frequency.setValueAtTime(880, time);
            osc.frequency.linearRampToValueAtTime(1200, time + 0.25);
            
            gainNode.gain.setValueAtTime(0.08, time);
            gainNode.gain.exponentialRampToValueAtTime(0.005, time + 0.28);
            
            osc.start(time);
            osc.stop(time + 0.3);
          } catch (e) {
            console.error("Audio beep synthesis error:", e);
          }
        }, 600);
      }
    }

    return () => {
      if (interval) clearInterval(interval);
      if (audioCtx) {
        try {
          audioCtx.close();
        } catch (e) {}
      }
    };
  }, [selectedChair?.session_state, selectedChair?.tilt, selectedChair?.temp_batt]);

  const handleFwUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!fwVersionInput) {
      alert("Please enter a target release version string (e.g. 0.2.0) first.");
      return;
    }

    try {
      setUploading(true);
      setOtaError(null);

      // Upload binary to Supabase storage firmware bucket
      const filePath = `releases/${fwVersionInput}/${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('firmware')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('firmware')
        .getPublicUrl(filePath);

      // Save release metadata (using upsert to allow overwriting of same version)
      const { error: dbError } = await supabase
        .from('firmware_releases')
        .upsert({
          version: fwVersionInput,
          url: publicUrl,
          size: file.size,
          notes: fwNotesInput || null
        }, { onConflict: 'version' });

      if (dbError) throw dbError;

      alert("Firmware release successfully uploaded and registered!");
      setFwVersionInput("");
      setFwNotesInput("");
      fetchReleases();
    } catch (err: any) {
      console.error("Error uploading firmware:", JSON.stringify(err));
      setOtaError(err?.message || err?.error_description || err?.statusText || JSON.stringify(err) || "Failed to upload firmware binary.");
    } finally {
      setUploading(false);
    }
  };

  const handlePushOTA = async () => {
    if (!selectedId) {
      alert("Please select a wheelchair from the list first.");
      return;
    }

    const rel = releases.find(r => r.id.toString() === selectedReleaseId);
    if (!rel) {
      alert("Please select a valid release to push.");
      return;
    }

    // W3: build the target set EXPLICITLY. The selected chair is always
    // included (the old `deviceStates.slice(0, 2)` could silently skip it),
    // then fill remaining canary slots (max 2 total) from the rest of the fleet.
    const targetIds = otaRolloutFleetWide
      ? Array.from(new Set([selectedId, ...deviceStates.map(d => d.wheelchair_id)])).slice(0, 2)
      : [selectedId];

    // The device is the final authority, but reject an obvious no-op before
    // creating a command. A real OTA feed must begin with a device event, not
    // with a browser-side assumption that the download has started.
    const upToDateTargets = targetIds.filter((targetId) =>
      deviceStates.find((device) => device.wheelchair_id === targetId)?.fw_version === rel.version
    );
    if (upToDateTargets.length > 0) {
      setOtaError(
        `${upToDateTargets.join(', ')} already runs firmware v${rel.version}. ` +
        'Upload a higher version before starting an OTA update.'
      );
      return;
    }

    if (otaRolloutFleetWide) {
      const confirmPush = confirm(
        `Staged canary rollout: firmware v${rel.version} will be pushed to exactly these chairs:\n\n` +
        `  ${targetIds.join('\n  ')}\n\nProceed?`
      );
      if (!confirmPush) return;
    }

    try {
      setActionLoading(true);
      setOtaError(null);

      for (const targetId of targetIds) {
        // Set target_version
        const { error: fwError } = await supabase
          .from('wheelchairs')
          .update({
            target_version: rel.version,
            ota_status: 'pending',
            ota_progress: 0,
            ota_last_error: null
          })
          .eq('id', targetId);

        if (fwError) throw fwError;

        // Insert command
        const reqId = 'req-ota-' + Math.random().toString(36).substr(2, 9);
        const { error: cmdError } = await supabase
          .from('commands')
          .insert({
            wheelchair_id: targetId,
            cmd: 'OTA',
            req_id: reqId,
            status: 'pending',
            args: {
              url: rel.url,
              version: rel.version,
              size: rel.size
            }
          });

        if (cmdError) throw cmdError;
      }

      alert('OTA command queued. The live log starts only after the ESP32 acknowledges it.');
    } catch (err: any) {
      console.error("Error pushing OTA:", JSON.stringify(err));
      setOtaError(err?.message || err?.error_description || err?.statusText || JSON.stringify(err) || "Failed to trigger OTA upgrade.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteRelease = async (releaseId: string, version: string) => {
    const confirmDelete = confirm(`Delete firmware release v${version}? This will remove the binary from storage and the database record.`);
    if (!confirmDelete) return;

    try {
      setActionLoading(true);
      setOtaError(null);

      // Find release to get storage path
      const rel = releases.find(r => r.id.toString() === releaseId);

      // Delete from storage (best effort — file may not exist)
      if (rel) {
        const urlParts = rel.url.split('/firmware/');
        if (urlParts[1]) {
          await supabase.storage.from('firmware').remove([urlParts[1]]);
        }
      }

      // Delete from database
      const { error } = await supabase
        .from('firmware_releases')
        .delete()
        .eq('id', releaseId);

      if (error) throw error;

      fetchReleases();
    } catch (err: any) {
      console.error('Error deleting release:', JSON.stringify(err));
      setOtaError(err?.message || JSON.stringify(err) || 'Failed to delete release.');
    } finally {
      setActionLoading(false);
    }
  };

  const removeQueuedOtaEvents = async (eventIds: string[]) => {
    if (eventIds.length === 0 || removingEvents) return;

    const label = eventIds.length === 1 ? 'this queued OTA message' : `${eventIds.length} queued OTA messages`;
    if (!confirm(`Remove ${label}? Real ESP32 safety and OTA logs are kept.`)) return;

    try {
      setRemovingEvents(true);
      const { error: deleteError } = await supabase
        .from('events')
        .delete()
        .in('id', eventIds);

      if (deleteError) throw deleteError;
      removeEvents(eventIds);
    } catch (err: any) {
      console.error('Error removing queued OTA messages:', err);
      setOtaError(err?.message || 'Could not remove the queued OTA messages.');
    } finally {
      setRemovingEvents(false);
    }
  };

  const dismissFeedEvents = (eventIds: string[]) => {
    if (eventIds.length === 0) return;

    setDismissedFeedEventIds((previousIds) => {
      const nextIds = new Set(previousIds);
      eventIds.forEach((eventId) => nextIds.add(String(eventId)));

      try {
        window.localStorage.setItem(
          DISMISSED_FEED_EVENTS_KEY,
          JSON.stringify(Array.from(nextIds).slice(-500))
        );
      } catch (storageError) {
        console.warn('Could not persist dismissed feed notifications:', storageError);
      }

      return nextIds;
    });
  };

  const clearFeed = () => {
    if (visibleFeedEvents.length === 0) return;
    if (!confirm(`Clear ${visibleFeedEvents.length} feed notifications? Safety audit records will remain in Supabase.`)) {
      return;
    }

    dismissFeedEvents(visibleFeedEvents.map((event) => String(event.id)));
  };

  const getEventBadgeClass = (type: string) => {
    if (['FALL', 'OVERTEMP', 'TAMPER', 'OTA_FAIL', 'UNLOCK_FAILED'].includes(type)) {
      return 'bg-red-500/10 text-red-400 border border-red-500/20';
    }
    if (['TILT_WARN', 'OVERSPEED', 'GEOFENCE_EXIT', 'OTA_DEFERRED', 'SESSION_END_OFFLINE'].includes(type)) {
      return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
    }
    if (['OTA_SUCCESS', 'OTA_READY'].includes(type)) {
      return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    }
    return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
  };

  const selectedOtaEvents = selectedChair
    ? events
        .filter((ev) =>
          ev.wheelchair_id === selectedChair.wheelchair_id &&
          ev.type.startsWith('OTA_') &&
          ev.type !== 'OTA_REQUESTED'
        )
        .slice(0, 100)
    : [];

  const getOtaEventDetail = (ev: { detail: unknown }) => {
    return ev.detail && typeof ev.detail === 'object' && !Array.isArray(ev.detail)
      ? ev.detail as Record<string, unknown>
      : {};
  };

  const getOtaEventTitle = (ev: { type: string; detail: unknown }) => {
    const detail = getOtaEventDetail(ev);
    if (ev.type === 'OTA_STAGE') return String(detail.message || detail.stage || 'OTA stage update');
    if (ev.type === 'OTA_PROGRESS') return `Downloading firmware ${detail.progress ?? 0}%`;
    if (ev.type === 'OTA_STARTED') return 'Download initiated';
    if (ev.type === 'OTA_READY') return 'Installed and rebooting';
    if (ev.type === 'OTA_SUCCESS') return 'New firmware validated';
    if (ev.type === 'OTA_DEFERRED') {
      if (detail.reason === 'already_on_version') return `Skipped: firmware v${detail.target_version || detail.version || 'current'} is already active`;
      if (detail.reason === 'already_in_progress') return 'Deferred: another OTA is already in progress';
      return `Deferred: ${detail.reason || 'waiting for safe state'}`;
    }
    if (ev.type === 'OTA_ROLLED_BACK') return `Rolled back: ${detail.reason || 'validation failed'}`;
    if (ev.type === 'OTA_FAIL') return `Failed: ${detail.reason || detail.message || 'OTA error'}`;
    return ev.type;
  };

  const getOtaEventClass = (type: string) => {
    if (type === 'OTA_FAIL' || type === 'OTA_ROLLED_BACK') {
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    }
    if (type === 'OTA_DEFERRED') {
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    }
    if (type === 'OTA_READY' || type === 'OTA_SUCCESS') {
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    }
    return 'border-blue-500/25 bg-blue-500/10 text-blue-300';
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden relative">

      {/* Top panel/Map on mobile, Right panel on desktop */}
      <div className="flex-grow relative h-[40vh] md:h-full w-full order-1 md:order-2">
        <Map
          deviceStates={deviceStates}
          selectedId={selectedId}
          onSelectDevice={setSelectedId}
        />
      </div>

      {/* Bottom console on mobile, Left sidebar on desktop */}
      <div className="w-full h-[60vh] md:h-full md:w-[480px] border-t md:border-t-0 md:border-r border-zinc-900 bg-zinc-950/95 flex flex-col justify-between z-10 order-2 md:order-1 shadow-2xl">

        {/* Tab Headers */}
        <div className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md">
          <div className="p-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white">W</div>
              <span className="font-extrabold text-lg">Fleet Console</span>
            </div>
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Operator Mode</span>
          </div>

          <div className="flex px-4 pb-2 gap-2">
            <button
              onClick={() => setActiveTab('fleet')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'fleet' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Fleet ({deviceStates.length})
            </button>
            <button
              onClick={() => setActiveTab('alerts')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer relative ${
                activeTab === 'alerts' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Feed ({visibleFeedEvents.length})
              {visibleFeedEvents.length > 0 && (
                <span className="absolute top-1.5 right-4 w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('firmware')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'firmware' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              OTA
            </button>
          </div>
        </div>

        {/* Dynamic tab contents */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-xs leading-normal">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                Database / Network Error
              </p>
              <p className="mt-1 font-mono">{error}</p>
            </div>
          )}

          <AnimatePresence mode="wait">
            {activeTab === 'fleet' ? (
              <motion.div
                key="fleet-tab"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                {/* List Grid */}
                {loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-20 bg-zinc-900 animate-pulse rounded-xl" />
                    ))}
                  </div>
                ) : deviceStates.length === 0 ? (
                  <div className="text-center p-8 border border-dashed border-zinc-800 rounded-xl">
                    <p className="text-zinc-500 text-sm">No devices connected to cloud. Run the simulator to start.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {deviceStates.map((d) => (
                      <div
                        key={d.wheelchair_id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selectedId === d.wheelchair_id}
                        onClick={() => setSelectedId(d.wheelchair_id)}
                        onKeyDown={(event) => handleDeviceRowKeyDown(event, d.wheelchair_id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          selectedId === d.wheelchair_id
                            ? 'border-blue-500/60 bg-blue-500/5'
                            : 'border-zinc-900 hover:border-zinc-800 bg-zinc-900/20'
                        } ${!d.online ? 'opacity-50 grayscale' : ''}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{d.wheelchair_id}</span>
                            <span className={`w-2 h-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            lat: {d.lat?.toFixed(4)}, lng: {d.lng?.toFixed(4)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {d.tamper && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/25">
                              <ShieldAlert className="w-3 h-3 animate-pulse" />
                              TAMPER
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-zinc-400">
                            <Battery className="w-3.5 h-3.5 text-emerald-500" />
                            {d.batt_pct}%
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            d.session_state === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}>
                            {d.session_state}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Selected Chair Controls */}
                {selectedChair && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card p-5 rounded-xl space-y-5"
                  >
                    <div className="flex justify-between items-start border-b border-zinc-900 pb-3">
                      <div>
                        <h3 className="font-bold text-base flex items-center gap-2">
                          {selectedChair.wheelchair_id}
                        </h3>
                        <p className="text-zinc-500 text-xs mt-0.5">
                          {selectedChair.uptime != null && selectedChair.uptime > 0 ? (
                            <>Uptime: {formatUptime(selectedChair.uptime)} · </>
                          ) : null}
                          Last seen: {formatLastSeen(lastSeenS)}
                        </p>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        selectedChair.online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {selectedChair.online ? "Online" : "Offline"}
                      </span>
                    </div>

                    {!selectedChair.online && (
                      <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0" />
                        <span className="font-semibold uppercase tracking-wider text-[10px]">Disconnected</span>
                      </div>
                    )}

                    <div className={selectedChair.online ? "space-y-5" : "space-y-5 opacity-40 grayscale pointer-events-none transition-all"}>

                      {/* Sensor Data Grid */}
                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      {/* Speed Indicator */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Speed</span>
                          <Zap className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5 flex items-baseline gap-0.5">
                          {selectedChair.speed != null ? selectedChair.speed.toFixed(1) : '0.0'}
                          <span className="text-[9px] font-normal text-zinc-500">km/h</span>
                        </div>
                      </div>

                      {/* Battery Indicator */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Battery</span>
                          <Battery className="w-3.5 h-3.5 text-emerald-400" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5 flex items-baseline gap-0.5">
                          {selectedChair.batt_pct}%
                          <span className="text-[9px] font-normal text-zinc-500">({(selectedChair.batt_v ?? 0).toFixed(1)}V)</span>
                        </div>
                      </div>



                      {/* Battery Temperature */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Battery Temp</span>
                          <Thermometer className="w-3.5 h-3.5 text-rose-400" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5 flex items-baseline gap-0.5">
                          {selectedChair.temp_batt != null ? selectedChair.temp_batt.toFixed(1) : '—'}
                          <span className="text-[9px] font-normal text-zinc-500">°C</span>
                        </div>
                      </div>

                      {/* Tilt Sensor Angle */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Tilt</span>
                          <Sliders className="w-3.5 h-3.5 text-purple-400" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5">
                          {selectedChair.tilt != null ? `${selectedChair.tilt.toFixed(1)}°` : '—'}
                        </div>
                      </div>

                      {/* Network Link RSSI */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Network Link</span>
                          <Radio className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5 flex items-baseline gap-0.5">
                          {selectedChair.rssi}
                          <span className="text-[9px] font-normal text-zinc-500">dBm</span>
                        </div>
                                   {/* Geofence Status */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Geofence</span>
                          <MapPin className="w-3.5 h-3.5 text-pink-400" />
                        </div>
                        <div className={`font-extrabold text-sm mt-1.5 ${selectedChair.geofence?.in ? 'text-emerald-400' : 'text-red-400'}`}>
                          {selectedChair.geofence?.on ? (selectedChair.geofence.in ? 'INSIDE' : 'OUTSIDE') : 'OFF'}
                        </div>
                      </div>
                    </div>            </div>

                    {/* Anti-Tamper Security (SW-520D tilt, armed while LOCKED) */}
                    {(() => {
                      const armed = selectedChair.locked && selectedChair.session_state === 'LOCKED';
                      const alarm = !!selectedChair.tamper;
                      const warns = selectedChair.tamper_count ?? 0;
                      return (
                        <div className={`rounded-xl p-4 border transition-all ${
                          alarm
                            ? 'border-red-500/40 bg-red-950/20'
                            : armed
                            ? 'border-zinc-800 bg-zinc-900/40'
                            : 'border-zinc-900 bg-zinc-900/20'
                        }`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {alarm ? (
                                <ShieldAlert className="w-4 h-4 text-red-500 animate-pulse" />
                              ) : armed ? (
                                <Lock className="w-4 h-4 text-blue-400" />
                              ) : (
                                <ShieldOff className="w-4 h-4 text-zinc-600" />
                              )}
                              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                                Anti-Tamper Security
                              </span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                              alarm ? 'bg-red-500/15 text-red-400' : armed ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                            }`}>
                              {alarm ? 'ALARM' : armed ? 'ARMED' : 'DISARMED'}
                            </span>
                          </div>

                          {/* Warning escalation dots (3 chirps, 4th = siren) */}
                          <div className="mt-3 flex items-center gap-2">
                            {[1, 2, 3].map((n) => (
                              <div
                                key={n}
                                className={`h-1.5 flex-1 rounded-full transition-all ${
                                  alarm ? 'bg-red-500' : warns >= n ? 'bg-amber-400' : 'bg-zinc-800'
                                }`}
                              />
                            ))}
                            <div
                              className={`h-1.5 flex-1 rounded-full transition-all ${
                                alarm ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'
                              }`}
                            />
                          </div>
                          <p className="mt-2 text-[10px] text-zinc-500 leading-relaxed">
                            {alarm
                              ? 'Continuous siren active — the locked chair is being tampered with.'
                              : armed
                              ? warns > 0
                                ? `${warns} disturbance${warns > 1 ? 's' : ''} detected. 3 chirp warnings, then a full siren.`
                                : 'Monitoring the locked chair. Movement triggers escalating warnings.'
                              : 'Arms automatically when the chair is locked.'}
                          </p>

                          {(alarm || warns > 0) && (
                            <button
                              onClick={() => triggerCommand('CLEAR_TAMPER')}
                              disabled={actionLoading}
                              className={`mt-3 w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold rounded-lg border transition-all cursor-pointer uppercase tracking-wider ${
                                alarm
                                  ? 'border-red-500/30 bg-red-600 hover:bg-red-500 text-white'
                                  : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                              }`}
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              {alarm ? 'Silence Alarm & Re-arm' : 'Reset Warnings'}
                            </button>
                          )}
                        </div>
                      );
                    })()}



                    {/* Actuation Command buttons */}
                    <div className="space-y-3 border-t border-zinc-900 pt-4">
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Actuate Device</h4>

                      <div className="grid grid-cols-1">
                        <button
                          onClick={() => triggerCommand(displayLocked ? 'UNLOCK' : 'LOCK')}
                          disabled={actionLoading}
                          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                            displayLocked
                              ? 'border-blue-500/20 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                              : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                          }`}
                        >
                          {isLockedPending ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Pending...
                            </>
                          ) : displayLocked ? (
                            <>
                              <Unlock className="w-3.5 h-3.5" />
                              Unlock Motion
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5" />
                              Lock Motion
                            </>
                          )}
                        </button>
                      </div>

                      <button
                        onClick={() => triggerCommand(selectedChair.session_state === 'SAFE_FAULT' ? 'CLEAR_SOS' : 'SOS')}
                        disabled={actionLoading}
                        className={`w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg border transition-all cursor-pointer uppercase tracking-wider ${
                          selectedChair.session_state === 'SAFE_FAULT'
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                            : 'border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20'
                        }`}
                      >
                        <AlertTriangle className="w-4 h-4 animate-pulse" />
                        {selectedChair.session_state === 'SAFE_FAULT' ? 'Clear SOS Alarm' : 'Trigger Manual SOS'}
                      </button>



                      {/* Geofence adjust */}
                      <div className="space-y-3 bg-zinc-900/30 p-3 rounded-lg border border-zinc-900">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500 font-bold uppercase tracking-wider text-[10px]">Geofence settings</span>
                          <span className="font-semibold text-zinc-300 text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded">{gfRadius} meters</span>
                        </div>

                        {/* Manual coordinates input */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] uppercase font-bold text-zinc-500">Center Latitude</label>
                            <input
                              type="text"
                              value={gfLat}
                              onChange={(e) => setGfLat(e.target.value)}
                              className="w-full bg-zinc-900 border border-zinc-800 p-2 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
                              placeholder="24.860048"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] uppercase font-bold text-zinc-500">Center Longitude</label>
                            <input
                              type="text"
                              value={gfLng}
                              onChange={(e) => setGfLng(e.target.value)}
                              className="w-full bg-zinc-900 border border-zinc-800 p-2 rounded text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
                              placeholder="67.063734"
                            />
                          </div>
                        </div>

                        {/* Radius Slider */}
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase font-bold text-zinc-500">Radius</label>
                          <input
                            type="range"
                            min="50"
                            max="2000"
                            step="50"
                            value={gfRadius}
                            onChange={(e) => setGfRadius(parseInt(e.target.value))}
                            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                        </div>

                        <button
                          onClick={() => {
                            const latVal = parseFloat(gfLat);
                            const lngVal = parseFloat(gfLng);
                            if (isNaN(latVal) || isNaN(lngVal)) {
                              alert("Please enter valid decimal coordinates for latitude and longitude.");
                              return;
                            }
                            triggerCommand('SET_GEOFENCE', {
                              lat: latVal,
                              lng: lngVal,
                              radius: gfRadius
                            });
                          }}
                          disabled={actionLoading}
                          className="w-full py-2 text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-all cursor-pointer uppercase tracking-wider"
                        >
                          Apply Custom Geofence
                        </button>
                      </div>

                      {/* Device Diagnostics */}
                      <div className="space-y-3 bg-zinc-900/30 p-3 rounded-lg border border-zinc-900">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500 font-bold uppercase tracking-wider text-[10px]">Diagnostics</span>
                          <span className="font-semibold text-zinc-300 text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded">Hardware Test</span>
                        </div>

                        <button
                          onClick={runDiagnosticCheck}
                          disabled={actionLoading || diagnosticPending || !selectedChair.online}
                          className="w-full py-2.5 text-[10px] font-bold bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 rounded transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          {diagnosticPending ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                          ) : (
                            <Activity className="w-3.5 h-3.5 text-blue-500" />
                          )}
                          {!selectedChair.online
                            ? 'Device Offline'
                            : diagnosticPending
                              ? 'Reading Live Sensors'
                              : 'Run Diagnostic Check'}
                        </button>

                        <DiagnosticResult
                          event={latestDiagnosticEvent}
                          pending={diagnosticPending}
                          error={diagnosticError}
                        />
                      </div>
                    </div>
                  </div>

                  </motion.div>
                )}
              </motion.div>
            ) : activeTab === 'alerts' ? (
              <motion.div
                key="alerts-tab"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-3"
              >
                <div className="flex min-h-7 items-center justify-between gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">
                    Notifications
                  </span>
                  {visibleFeedEvents.length > 0 && (
                    <button
                      type="button"
                      onClick={clearFeed}
                      title="Clear feed notifications"
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear feed
                    </button>
                  )}
                </div>

                {visibleFeedEvents.length === 0 ? (
                  <div className="text-center p-8 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-sm">
                    No feed notifications.
                  </div>
                ) : (
                  visibleFeedEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 bg-zinc-900/40 border border-zinc-900 rounded-xl flex gap-3 items-start"
                    >
                      <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                        ['FALL', 'OVERTEMP', 'TAMPER', 'OTA_FAIL', 'UNLOCK_FAILED'].includes(ev.type) ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'
                      }`}>
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-zinc-200">{ev.wheelchair_id}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-zinc-500">{new Date(ev.ts).toLocaleTimeString()}</span>
                            <button
                              type="button"
                              onClick={() => dismissFeedEvents([String(ev.id)])}
                              title="Remove notification"
                              aria-label={`Remove ${ev.type} notification for ${ev.wheelchair_id}`}
                              className="rounded p-1 text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getEventBadgeClass(ev.type)}`}>
                            {ev.type}
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {({
                              FALL: 'Fall Interlock Triggered',
                              OVERTEMP: 'Overtemperature Threshold Exceeded',
                              TAMPER: 'Locked Chair Tampered / Moved',
                              OVERSPEED: 'Speed Limit Exceeded',
                              GEOFENCE_EXIT: 'Left Allowed Geofence',
                              GEOFENCE_ENTER: 'Returned Inside Geofence',
                              TILT_WARN: 'High Tilt Angle Warning',
                              SOS: 'Manual Emergency SOS',
                              SESSION_END_OFFLINE: 'Session Expired While Device OFFLINE — Verify Chair!',
                              UNLOCK_FAILED: 'Paid Rental: Device REFUSED Unlock',
                              OTA_REQUESTED: 'OTA Command Queued - Awaiting ESP32',
                              OTA_STARTED: 'OTA Firmware Download Initiated',
                              OTA_STAGE: 'OTA Live Stage Update',
                              OTA_PROGRESS: 'OTA Download Progress',
                              OTA_READY: 'OTA Write Completed, Rebooting',
                              OTA_SUCCESS: 'Firmware Upgraded & Validated',
                              OTA_FAIL: 'Firmware Flash/Download Failed',
                              OTA_DEFERRED: 'OTA Update Deferral Pending',
                              OTA_ROLLED_BACK: 'Firmware Rollback Recovered'
                            } as Record<string, string>)[ev.type] || 'Status Alert'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            ) : (
              <motion.div
                key="firmware-tab"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4 text-xs"
              >
                {/* Upload Section */}
                <div className="bg-zinc-900/30 p-4 rounded-xl border border-zinc-900 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold uppercase text-[10px] text-zinc-400 tracking-wider">Register Release (.bin)</span>
                    {uploading && <span className="text-blue-400 font-bold text-[9px] animate-pulse">Uploading...</span>}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-zinc-500">Release Version</label>
                      <input
                        type="text"
                        value={fwVersionInput}
                        onChange={(e) => setFwVersionInput(e.target.value)}
                        placeholder="e.g. 0.2.0"
                        className="w-full bg-zinc-900 border border-zinc-800 p-2 rounded text-zinc-200 focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-zinc-500">Upload Binary</label>
                      <input
                        type="file"
                        accept=".bin"
                        onChange={handleFwUpload}
                        disabled={uploading}
                        className="w-full text-[10px] text-zinc-400 file:mr-2 file:py-1.5 file:px-2 file:rounded file:border-0 file:text-[9px] file:font-bold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 file:cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-zinc-500">Release Notes / Changelog</label>
                    <textarea
                      value={fwNotesInput}
                      onChange={(e) => setFwNotesInput(e.target.value)}
                      placeholder="Dev updates notes..."
                      rows={2}
                      className="w-full bg-zinc-900 border border-zinc-800 p-2 rounded text-zinc-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* OTA Push Section */}
                <div className="bg-zinc-900/30 p-4 rounded-xl border border-zinc-900 space-y-3">
                  <span className="font-extrabold uppercase text-[10px] text-zinc-400 tracking-wider block">Trigger Firmware OTA</span>

                  {releases.length === 0 ? (
                    <div className="text-zinc-500 text-center py-2 border border-dashed border-zinc-800 rounded-lg">
                      No firmware releases registered.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">Select Release</label>
                        <div className="space-y-1.5">
                          {releases.map((r) => (
                            <div
                              key={r.id}
                              onClick={() => setSelectedReleaseId(r.id.toString())}
                              className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all group ${
                                selectedReleaseId === r.id.toString()
                                  ? 'bg-blue-600/10 border-blue-500/40 text-blue-300'
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                              }`}
                            >
                              <div className="flex items-center gap-2 font-mono text-xs">
                                <div className={`w-2 h-2 rounded-full ${selectedReleaseId === r.id.toString() ? 'bg-blue-500' : 'bg-zinc-700'}`} />
                                v{r.version}
                                <span className="text-zinc-600 text-[10px]">({(r.size / 1024 / 1024).toFixed(2)} MB)</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteRelease(r.id.toString(), r.version); }}
                                disabled={actionLoading}
                                className="p-1.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all"
                                title={`Delete v${r.version}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Staged Rollout Protection */}
                      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900 space-y-2">
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            id="fleetwide"
                            checked={otaRolloutFleetWide}
                            onChange={(e) => setOtaRolloutFleetWide(e.target.checked)}
                            className="mt-0.5 cursor-pointer accent-blue-500"
                          />
                          <div className="space-y-0.5">
                            <label htmlFor="fleetwide" className="font-bold text-zinc-300 cursor-pointer text-[10px]">
                              Stage 1 Rollout (Fleet-wide limit: 2 chairs)
                            </label>
                            <p className="text-[9px] text-zinc-500 leading-normal">
                              Warning: Updates are pushed to 1 target device by default. Checking this stages a safe canary release to a maximum of 2 devices.
                            </p>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={handlePushOTA}
                        disabled={actionLoading || !selectedId}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded font-bold transition-all uppercase tracking-wider text-[10px] cursor-pointer"
                      >
                        {!selectedId
                          ? "Select device first"
                          : otaRolloutFleetWide
                            ? "Push Staged Rollout (Max 2 Devices)"
                            : `Push OTA to ${selectedId}`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Selected Chair Live OTA Telemetry Status */}
                {selectedChair && (
                  <div className="bg-zinc-900/30 p-4 rounded-xl border border-zinc-900 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5">
                      <span className="font-extrabold uppercase text-[10px] text-zinc-400 tracking-wider">Live OTA Status: {selectedChair.wheelchair_id}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold tracking-wider uppercase ${
                        selectedChair.ota_status === 'preparing' ? 'bg-cyan-500/10 text-cyan-400 animate-pulse' :
                        selectedChair.ota_status === 'downloading' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                        selectedChair.ota_status === 'installing' ? 'bg-violet-500/10 text-violet-400 animate-pulse' :
                        selectedChair.ota_status === 'deferred' ? 'bg-amber-500/10 text-amber-400' :
                        selectedChair.ota_status === 'failed' ? 'bg-red-500/10 text-red-400' :
                        selectedChair.ota_status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                        selectedChair.ota_status === 'rebooting' ? 'bg-indigo-500/10 text-indigo-400 animate-pulse' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        {selectedChair.ota_status || 'idle'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div>
                        <span className="text-zinc-500 block font-bold uppercase tracking-wider text-[9px]">Active Version</span>
                        <span className="font-mono text-zinc-200 font-bold">v{selectedChair.fw_version || '0.1.0'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block font-bold uppercase tracking-wider text-[9px]">Target Version</span>
                        <span className="font-mono text-zinc-200 font-bold">
                          {selectedChair.target_version ? `v${selectedChair.target_version}` : 'None'}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {['preparing', 'downloading', 'installing', 'rebooting', 'success'].includes(selectedChair.ota_status || '') && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-zinc-400 font-bold">
                          <span>
                            {selectedChair.ota_status === 'preparing' ? 'Closing system and preparing OTA...' :
                             selectedChair.ota_status === 'installing' ? 'Installing firmware image...' :
                             selectedChair.ota_status === 'rebooting' ? 'Installed. Rebooting ESP32-S3...' :
                             selectedChair.ota_status === 'success' ? 'Firmware validated successfully.' :
                             'Downloading stream to OTA partition...'}
                          </span>
                          <span>{selectedChair.ota_progress || 0}%</span>
                        </div>
                        <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden border border-zinc-800/80">
                          <div
                            className={`h-full transition-all duration-300 ${
                              selectedChair.ota_status === 'success' ? 'bg-emerald-500' :
                              selectedChair.ota_status === 'installing' ? 'bg-violet-500' :
                              selectedChair.ota_status === 'rebooting' ? 'bg-indigo-500' :
                              'bg-blue-500'
                            }`}
                            style={{ width: `${selectedChair.ota_progress || 0}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Error display */}
                    {selectedChair.ota_last_error && (
                      <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-lg flex items-start gap-1.5 text-[9px] leading-normal font-mono">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Last Error:</span> {selectedChair.ota_last_error}
                        </div>
                      </div>
                    )}

                    <div className="border-t border-zinc-900 pt-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold uppercase text-[9px] text-zinc-500 tracking-wider">Real ESP32 OTA Logs</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-bold text-zinc-600">{selectedOtaEvents.length} event{selectedOtaEvents.length === 1 ? '' : 's'}</span>
                          {selectedQueuedOtaRequestEvents.length > 0 && (
                            <button
                              type="button"
                              onClick={() => removeQueuedOtaEvents(selectedQueuedOtaRequestEvents.map((event) => String(event.id)))}
                              disabled={removingEvents}
                              title="Remove old queued OTA messages"
                              aria-label="Remove old queued OTA messages"
                              className="rounded p-1 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {selectedOtaEvents.length === 0 ? (
                        <div className="border border-dashed border-zinc-800 rounded-lg p-3 text-[9px] text-zinc-500 font-semibold">
                          No OTA logs from this ESP32 yet. Push OTA and wait for the device to acknowledge.
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                          {selectedOtaEvents.map((ev) => {
                            const detail = getOtaEventDetail(ev);
                            const progress = typeof detail.progress === 'number' ? detail.progress : null;
                            return (
                              <div
                                key={`${ev.id}-${ev.ts}`}
                                className={`rounded-lg border p-2.5 text-[9px] font-mono ${getOtaEventClass(ev.type)}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="font-extrabold uppercase tracking-wider text-[8px] opacity-80">{ev.type}</div>
                                    <div className="mt-0.5 text-[10px] font-bold break-words">{getOtaEventTitle(ev)}</div>
                                  </div>
                                  <span className="shrink-0 text-[8px] opacity-70">{new Date(ev.ts).toLocaleTimeString()}</span>
                                </div>
                                {progress !== null && (
                                  <div className="mt-2 h-1.5 rounded-full bg-black/30 overflow-hidden">
                                    <div
                                      className="h-full bg-current transition-all duration-300"
                                      style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                                    />
                                  </div>
                                )}
                                {Boolean(detail.reason || detail.code || detail.stage || detail.version) && (
                                  <div className="mt-1.5 text-[8px] opacity-75 break-words">
                                    {detail.stage ? `stage=${detail.stage} ` : ''}
                                    {detail.reason ? `reason=${detail.reason} ` : ''}
                                    {detail.code ? `code=${detail.code} ` : ''}
                                    {detail.version ? `version=${detail.version}` : ''}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {otaError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-[9px] font-mono">
                    {otaError}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-zinc-900 flex justify-between items-center text-xs text-zinc-500 bg-zinc-950/80 backdrop-blur-md">
          <span>Operator Portal</span>
          <Link href="/" className="hover:text-zinc-300">Home</Link>
          <Link href="/rider" className="hover:text-zinc-300">Rider Area</Link>
        </div>

      </div>

      {/* Emergency Alert HUD Overlay (Fall/Tilt/SOS/Overtemp) */}
      {selectedChair && (
        selectedChair.session_state === 'SAFE_FAULT' || 
        (selectedChair.tilt != null && selectedChair.tilt > 50) ||
        (selectedChair.temp_batt != null && selectedChair.temp_batt > 55.0)
      ) && (
        <div className="fixed inset-0 bg-[#09090b]/85 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-red-500/30 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500 animate-pulse">
              <AlertTriangle className="w-8 h-8 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-black text-red-500 uppercase tracking-wider">Emergency Alarm Active</h2>
              <p className="text-zinc-400 text-xs font-semibold">
                {selectedChair.temp_batt != null && selectedChair.temp_batt > 55.0
                  ? `CRITICAL BATTERY OVERTEMP: ${selectedChair.temp_batt.toFixed(1)}°C (Limit: 55°C)!`
                  : selectedChair.tilt > 50
                  ? "Automatic Tilt/Fall Detected!"
                  : "Manual Emergency SOS Triggered!"}
              </p>
            </div>
            <div className="bg-zinc-900 p-3 rounded-lg border border-zinc-800 text-xs font-mono text-zinc-300 space-y-1.5 text-left">
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-0.5 text-center">Live Location</div>
              <div>Coordinates: {(selectedChair.lat ?? 0).toFixed(6)}, {(selectedChair.lng ?? 0).toFixed(6)}</div>
              <div className="pt-1 text-center">
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=${selectedChair.lat},${selectedChair.lng}`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded border border-zinc-700 text-[10px] uppercase transition-all cursor-pointer"
                >
                  <MapPin className="w-3 h-3 text-pink-400" />
                  Open in Google Maps
                </a>
              </div>
            </div>
            <p className="text-[10px] text-zinc-500 leading-normal">
              Live coordinates are available to the emergency response workflow.
            </p>
            <button
              onClick={() => triggerCommand('CLEAR_SOS')}
              className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer uppercase tracking-wider"
            >
              Clear SOS / Turn Off Siren
            </button>
          </div>
        </div>
      )}

      {/* Anti-Tamper Alarm Overlay (locked chair being tampered with) */}
      {selectedChair && selectedChair.tamper && selectedChair.session_state !== 'SAFE_FAULT' && (
        <div className="fixed inset-0 bg-[#09090b]/85 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-red-500/40 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center mx-auto text-red-500">
              <ShieldAlert className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-black text-red-500 uppercase tracking-wider">Tamper Alarm</h2>
              <p className="text-zinc-400 text-xs font-semibold">
                {selectedChair.wheelchair_id} is locked and being moved/tampered with.
              </p>
            </div>
            <div className="bg-zinc-900 p-3 rounded-lg border border-zinc-800 text-xs font-mono text-zinc-300">
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Continuous Siren Active</div>
              {selectedChair.tamper_count} disturbance{selectedChair.tamper_count === 1 ? '' : 's'} · {(selectedChair.lat ?? 0).toFixed(6)}, {(selectedChair.lng ?? 0).toFixed(6)}
            </div>
            <p className="text-[10px] text-zinc-500 leading-normal">
              🔒 The tilt sensor detected repeated movement of the parked, locked wheelchair.
            </p>
            <button
              onClick={() => triggerCommand('CLEAR_TAMPER')}
              className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5"
            >
              <ShieldOff className="w-4 h-4" />
              Silence Alarm & Re-arm
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
