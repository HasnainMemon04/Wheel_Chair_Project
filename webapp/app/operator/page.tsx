'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { useFleetState } from '../../hooks/useFleetState';
import { supabase } from '../../utils/supabase';
import { 
  Zap, Battery, ShieldAlert, Thermometer, Radio, 
  MapPin, Sliders, Play, Square, Unlock, Lock, RefreshCw, AlertTriangle
} from 'lucide-react';
import Link from 'next/link';

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

export default function OperatorPage() {
  const { deviceStates, events, loading, error } = useFleetState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'fleet' | 'alerts'>('fleet');
  const [actionLoading, setActionLoading] = useState(false);
  
  // Custom inputs for commands
  const [speedLimit, setSpeedLimit] = useState<number>(6);
  const [gfRadius, setGfRadius] = useState<number>(300);
  const [gfLat, setGfLat] = useState<string>("24.860048");
  const [gfLng, setGfLng] = useState<string>("67.063734");

  // Track pending command states for each chair to support Optimistic UI
  const [pendingStates, setPendingStates] = useState<Record<string, { power?: boolean; locked?: boolean; ts?: number }>>({});
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const selectedChair = deviceStates.find((d) => d.wheelchair_id === selectedId);

  // Prefill geofence coordinates when a new device is selected
  useEffect(() => {
    if (selectedChair) {
      setGfLat(selectedChair.lat.toFixed(6));
      setGfLng(selectedChair.lng.toFixed(6));
      if (selectedChair.geofence) {
        setGfRadius(selectedChair.geofence.r);
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

  // Calculate latency based on age of the last update
  const lastUpdate = selectedChair ? new Date(selectedChair.ts).getTime() : 0;
  useEffect(() => {
    if (!lastUpdate) {
      setLatencyMs(null);
      return;
    }
    const interval = setInterval(() => {
      const age = Date.now() - lastUpdate;
      setLatencyMs(age > 0 ? age : 0);
    }, 100);
    return () => clearInterval(interval);
  }, [lastUpdate]);

  const pending = pendingStates[selectedId || ''];
  const displayPower = pending?.power !== undefined ? pending.power : (selectedChair?.power ?? false);
  const displayLocked = pending?.locked !== undefined ? pending.locked : (selectedChair?.locked ?? false);
  const isPowerPending = pending?.power !== undefined;
  const isLockedPending = pending?.locked !== undefined;

  // Send command helper
  const triggerCommand = async (cmd: string, args: any = {}) => {
    if (!selectedId) return;
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
    } catch (err: any) {
      alert("Command failure: " + err.message);
      // Clear optimistic state on error
      setPendingStates(prev => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getEventBadgeClass = (type: string) => {
    if (['FALL', 'OVERTEMP', 'TAMPER'].includes(type)) {
      return 'bg-red-500/10 text-red-400 border border-red-500/20';
    }
    if (['TILT_WARN', 'OVERSPEED', 'GEOFENCE_EXIT'].includes(type)) {
      return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
    }
    return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
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
              Wheelchairs ({deviceStates.length})
            </button>
            <button 
              onClick={() => setActiveTab('alerts')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer relative ${
                activeTab === 'alerts' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Safety Feed ({events.length})
              {events.length > 0 && (
                <span className="absolute top-1.5 right-4 w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
              )}
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
                        onClick={() => setSelectedId(d.wheelchair_id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          selectedId === d.wheelchair_id
                            ? 'border-blue-500/60 bg-blue-500/5'
                            : 'border-zinc-900 hover:border-zinc-800 bg-zinc-900/20'
                        }`}
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
                        <p className="text-zinc-500 text-xs mt-0.5">Uptime: {selectedChair.ts.split('T')[1].slice(0, 8)}</p>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        selectedChair.online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {selectedChair.online ? "Online" : "Offline"}
                      </span>
                    </div>

                    {/* Sensor Data Grid */}
                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      {/* Speed Indicator */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Speed</span>
                          <Zap className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5 flex items-baseline gap-0.5">
                          {selectedChair.speed !== undefined ? selectedChair.speed.toFixed(1) : '0.0'}
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
                          <span className="text-[9px] font-normal text-zinc-500">({selectedChair.batt_v.toFixed(1)}V)</span>
                        </div>
                      </div>

                      {/* Motor Temperature */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">Motor</span>
                          <Thermometer className="w-3.5 h-3.5 text-orange-400" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5 flex items-baseline gap-0.5">
                          {selectedChair.temp_motor.toFixed(1)}
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
                          {selectedChair.tilt.toFixed(1)}°
                        </div>
                      </div>

                      {/* WiFi Link RSSI */}
                      <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-900/60 flex flex-col justify-between min-h-[64px] hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between text-zinc-500">
                          <span className="text-[10px] uppercase font-bold tracking-wider">WiFi Link</span>
                          <Radio className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <div className="font-extrabold text-zinc-100 text-sm mt-1.5 flex items-baseline gap-0.5">
                          {selectedChair.rssi}
                          <span className="text-[9px] font-normal text-zinc-500">dBm</span>
                        </div>
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
                    </div>

                    {/* Actuation Command buttons */}
                    <div className="space-y-3 border-t border-zinc-900 pt-4">
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Actuate Device</h4>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => triggerCommand(displayPower ? 'POWER_OFF' : 'POWER_ON')}
                          disabled={actionLoading}
                          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                            displayPower
                              ? 'border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                          }`}
                        >
                          {isPowerPending ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : displayPower ? (
                            <Square className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                          Power {displayPower ? 'OFF' : 'ON'}
                        </button>

                        <button
                          onClick={() => triggerCommand(displayLocked ? 'UNLOCK' : 'LOCK')}
                          disabled={actionLoading}
                          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                            displayLocked
                              ? 'border-blue-500/20 bg-blue-500/10 text-blue-400 hover:bg-red-500/20' // wait, border-blue and text-blue but hover-bg-blue
                              : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                          }`}
                        >
                          {isLockedPending ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : displayLocked ? (
                            <Unlock className="w-3.5 h-3.5" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
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

                      {/* Speed limit slider */}
                      <div className="space-y-1.5 bg-zinc-900/30 p-3 rounded-lg border border-zinc-900">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500">Speed Limit</span>
                          <span className="font-semibold text-zinc-300">{speedLimit} km/h</span>
                        </div>
                        <input
                          type="range"
                          min="2"
                          max="12"
                          step="1"
                          value={speedLimit}
                          onChange={(e) => setSpeedLimit(parseInt(e.target.value))}
                          className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <button
                          onClick={() => triggerCommand('SET_SPEED_LIMIT', { kmh: speedLimit })}
                          disabled={actionLoading}
                          className="w-full mt-2 py-1 text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-all cursor-pointer"
                        >
                          Update Speed Limit
                        </button>
                      </div>

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

                    </div>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="alerts-tab"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-3"
              >
                {events.length === 0 ? (
                  <div className="text-center p-8 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-sm">
                    No safety events recorded.
                  </div>
                ) : (
                  events.map((ev) => (
                    <div 
                      key={ev.id}
                      className="p-3 bg-zinc-900/40 border border-zinc-900 rounded-xl flex gap-3 items-start"
                    >
                      <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                        ['FALL', 'OVERTEMP', 'TAMPER'].includes(ev.type) ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'
                      }`}>
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="space-y-1 flex-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-xs text-zinc-200">{ev.wheelchair_id}</span>
                          <span className="text-[10px] text-zinc-500">{new Date(ev.ts).toLocaleTimeString()}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getEventBadgeClass(ev.type)}`}>
                            {ev.type}
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {ev.type === 'FALL' ? 'Fall Interlock Triggered' : ev.type === 'OVERTEMP' ? 'Overtemperature Threshold Exceeded' : 'Status Alert'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
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

      {/* Emergency Alert HUD Overlay (Fall/Tilt/SOS) */}
      {selectedChair && (selectedChair.session_state === 'SAFE_FAULT' || selectedChair.tilt > 50) && (
        <div className="absolute inset-0 bg-[#09090b]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-red-500/30 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500 animate-pulse">
              <AlertTriangle className="w-8 h-8 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-black text-red-500 uppercase tracking-wider">Emergency Alarm Active</h2>
              <p className="text-zinc-400 text-xs font-semibold">
                {selectedChair.tilt > 50 ? "Automatic Tilt/Fall Detected!" : "Manual Emergency SOS Triggered!"}
              </p>
            </div>
            <div className="bg-zinc-900 p-3 rounded-lg border border-zinc-800 text-xs font-mono text-zinc-300">
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Broadcasting Live Location</div>
              Coordinates: {selectedChair.lat.toFixed(6)}, {selectedChair.lng.toFixed(6)}
            </div>
            <p className="text-[10px] text-zinc-500 leading-normal">
              📡 Sending live coordinates to nearest emergency rescue dispatchers (Trauma & EMS services).
            </p>
            <button
              onClick={() => triggerCommand('CLEAR_SOS')}
              className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer uppercase tracking-wider"
            >
              Acknowledge & Clear SOS
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
