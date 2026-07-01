'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { useFleetState, DeviceState } from '../../hooks/useFleetState';
import { supabase } from '../../utils/supabase';
import { MapPin, Battery, ShieldAlert, Zap, Clock, CreditCard, PlusCircle, CheckCircle2, Lock } from 'lucide-react';

// Dynamically import Leaflet Map to avoid Next.js SSR "window is not defined" crashes
const Map = dynamic(() => import('../../components/Map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 gap-3">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium">Initializing Vector Map...</p>
    </div>
  )
});

export default function RiderPage() {
  const { deviceStates, loading: fleetLoading, error } = useFleetState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRental, setActiveRental] = useState<any | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Filter for available chairs
  const availableChairs = deviceStates.filter(d => d.online && (!d.session_state || d.session_state === 'LOCKED' || d.session_state === 'AVAILABLE'));
  const selectedChair = deviceStates.find(d => d.wheelchair_id === selectedId);

  // Computed live states (fall back to local timers if WebSocket drops)
  const rentedChair = activeRental ? deviceStates.find(d => d.wheelchair_id === activeRental.wheelchair_id) : null;
  const displayTimeLeft = rentedChair?.time_left !== undefined ? rentedChair.time_left : timeLeft;
  const displaySessionState = rentedChair?.session_state || (activeRental ? (timeLeft <= 120 ? (timeLeft <= 0 ? "LOCKED" : "EXPIRING") : "ACTIVE") : "AVAILABLE");
  const displayLocked = rentedChair?.locked !== undefined ? rentedChair.locked : (activeRental ? (timeLeft <= 0) : true);
  const displaySpeedLimit = rentedChair?.speed_limit || 6;

  // Session timer hook
  useEffect(() => {
    if (!activeRental || timeLeft <= 0) return;
    
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          // Maintain activeRental reference so the LOCKED banner is shown in the UI
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeRental, timeLeft]);

  // Seed a wheelchair for easy dev testing
  const handleSeedMockWheelchair = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/seed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to seed mock wheelchair");
      
      setSelectedId('WCHAIR-001');
      alert("Mock Wheelchair WCHAIR-001 successfully registered and online!");
    } catch (err: any) {
      alert("Error seeding device: " + err.message);
    } finally {
      setSeeding(false);
    }
  };

  // Rent / Unlock trigger (Mock payment Webhook call)
  const handleRent = async (durationMinutes: number) => {
    if (!selectedId) return;
    setActionLoading(true);

    try {
      // 1. Create client rental intent (reserved state)
      // Note: RLS allows riders to create own rentals.
      const { data: profile } = await supabase.from('profiles').select('id').limit(1).single();
      const userId = profile?.id || null;

      const { data: rental, error: rError } = await supabase
        .from('rentals')
        .insert({
          wheelchair_id: selectedId,
          user_id: userId,
          state: 'reserved',
          duration_s: durationMinutes * 60,
          speed_limit: 6
        })
        .select()
        .single();

      if (rError) throw rError;

      // 2. Trigger Mock Payment webhook route handler (Dev webhook call)
      const res = await fetch('/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: 'mock',
          rental_id: rental.id,
          amount: 500,
          provider_ref: `MOCK-REF-${Date.now()}`
        })
      });

      const paymentResult = await res.json();
      if (!res.ok) throw new Error(paymentResult.error || "Payment processing failed");

      // Set active local session
      setActiveRental(rental);
      setTimeLeft(durationMinutes * 60);
      
    } catch (err: any) {
      alert("Booking error: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden">
      
      {/* Left Panel: Rider Controls */}
      <div className="w-full md:w-[420px] border-r border-zinc-900 bg-zinc-950 flex flex-col justify-between z-10">
        
        {/* Top Branding & Status */}
        <div className="p-6 border-b border-zinc-900 flex justify-between items-center bg-zinc-950/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white">W</div>
            <span className="font-bold text-lg tracking-tight">Rider Dashboard</span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
            Live status
          </span>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-xs leading-normal">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                Database / Network Error
              </p>
              <p className="mt-1 font-mono">{error}</p>
            </div>
          )}

          {/* Active Session Indicator */}
          <AnimatePresence>
            {activeRental && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`glass-card p-5 border rounded-xl transition-all duration-300 ${
                  displayLocked
                    ? "border-red-500/30 bg-red-950/10"
                    : displaySessionState === "EXPIRING"
                    ? "border-amber-500/40 bg-amber-950/10 animate-pulse"
                    : "border-emerald-500/30 bg-emerald-950/10"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className={`font-semibold text-sm ${
                      displayLocked
                        ? "text-red-400"
                        : displaySessionState === "EXPIRING"
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}>
                      {displayLocked
                        ? "Session Expired & Locked"
                        : displaySessionState === "EXPIRING"
                        ? "Session Expiring Soon"
                        : "Active Rental Session"}
                    </h3>
                    <p className="text-zinc-500 text-xs mt-0.5">Device: {activeRental.wheelchair_id}</p>
                  </div>
                  <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                    displayLocked
                      ? "bg-red-500/10 text-red-400"
                      : displaySessionState === "EXPIRING"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-emerald-500/10 text-emerald-400"
                  }`}>
                    {displayLocked ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        Locked
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        Unlocked
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <div className="flex-1 bg-zinc-900 rounded-lg p-3 text-center">
                    <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Remaining</span>
                    <div className={`text-2xl font-bold font-mono mt-0.5 ${
                      displayLocked
                        ? "text-red-400"
                        : displaySessionState === "EXPIRING"
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}>
                      {formatTime(displayTimeLeft)}
                    </div>
                  </div>
                  <div className="flex-1 bg-zinc-900 rounded-lg p-3 text-center">
                    <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Speed Limit</span>
                    <div className="text-2xl font-bold font-mono text-zinc-300 mt-0.5">{displaySpeedLimit} km/h</div>
                  </div>
                </div>

                {displaySessionState === "EXPIRING" && !displayLocked && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-amber-500 font-medium bg-amber-500/10 p-2 rounded-lg">
                    <Clock className="w-4 h-4 animate-spin" />
                    Warning: Expiry in less than 2 mins!
                  </div>
                )}

                {displayLocked && (
                  <button
                    onClick={() => {
                      setActiveRental(null);
                      setTimeLeft(0);
                    }}
                    className="mt-4 w-full py-2 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg text-xs transition-all cursor-pointer text-center"
                  >
                    Dismiss / Book Another Chair
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Device List Section */}
          <div>
            <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">Chairs in Range</h2>
            
            {fleetLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 bg-zinc-900 animate-pulse rounded-xl border border-zinc-800/40" />
                ))}
              </div>
            ) : availableChairs.length === 0 ? (
              <div className="text-center p-6 border border-dashed border-zinc-800 rounded-xl">
                <p className="text-zinc-500 text-sm">No available chairs online.</p>
                <button 
                  onClick={handleSeedMockWheelchair}
                  disabled={seeding}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-400 font-semibold cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4" />
                  {seeding ? "Seeding..." : "Seed Mock Wheelchair (WCHAIR-001)"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {availableChairs.map((chair) => (
                  <div 
                    key={chair.wheelchair_id}
                    onClick={() => setSelectedId(chair.wheelchair_id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex justify-between items-center ${
                      selectedId === chair.wheelchair_id 
                        ? 'border-blue-500/60 bg-blue-500/5' 
                        : 'border-zinc-900 hover:border-zinc-800 bg-zinc-900/30'
                    }`}
                  >
                    <div>
                      <h3 className="font-semibold text-sm">{chair.wheelchair_id}</h3>
                      <p className="text-zinc-500 text-xs mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        Karachi, Central
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="flex items-center gap-1 text-xs text-zinc-400">
                        <Battery className="w-3.5 h-3.5 text-emerald-500" />
                        {chair.batt_pct}%
                      </span>
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-semibold">
                        Available
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rent Box for Selected Chair */}
          <AnimatePresence mode="wait">
            {selectedChair && !activeRental && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="glass-card p-5 rounded-xl space-y-4"
              >
                <div>
                  <h3 className="font-semibold text-sm">Rent {selectedChair.wheelchair_id}</h3>
                  <p className="text-zinc-500 text-xs mt-0.5">Select a rental duration to pay and unlock.</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '1 Min', value: 1, price: 'Mock Free' },
                    { label: '15 Mins', value: 15, price: '$5.00' },
                    { label: '30 Mins', value: 30, price: '$9.00' }
                  ].map((plan) => (
                    <button 
                      key={plan.value}
                      onClick={() => handleRent(plan.value)}
                      disabled={actionLoading}
                      className="flex flex-col items-center justify-center p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-blue-500/50 hover:bg-zinc-800/50 transition-all text-center cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-zinc-300">{plan.label}</span>
                      <span className="text-[10px] text-zinc-500 mt-1">{plan.price}</span>
                    </button>
                  ))}
                </div>

                <div className="text-[10px] text-zinc-500 leading-normal flex items-start gap-1.5 mt-2">
                  <CreditCard className="w-3.5 h-3.5 flex-shrink-0 text-zinc-400" />
                  Payments processed securely. Webhook directly instructs database cloud triggers.
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Bottom Navigation */}
        <div className="p-4 border-t border-zinc-900 flex justify-around items-center text-xs text-zinc-500 bg-zinc-950/80 backdrop-blur-md">
          <span>Rider Portal</span>
          <span>•</span>
          <Link href="/" className="hover:text-zinc-300">Home</Link>
          <span>•</span>
          <Link href="/operator" className="hover:text-zinc-300">Operator Dashboard</Link>
        </div>

      </div>

      {/* Right Panel: Map */}
      <div className="flex-1 relative h-full">
        <Map 
          deviceStates={deviceStates} 
          selectedId={selectedId} 
          onSelectDevice={setSelectedId} 
        />
      </div>

    </div>
  );
}
