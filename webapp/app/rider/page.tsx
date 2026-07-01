'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { useFleetState, DeviceState } from '../../hooks/useFleetState';
import { supabase } from '../../utils/supabase';
import {
  MapPin, Battery, ShieldAlert, Zap, Clock, CreditCard,
  PlusCircle, CheckCircle2, Lock, AlertTriangle, XCircle, ShieldOff
} from 'lucide-react';
import ClimateCard from '../../components/ClimateCard';

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

  // Cancel window tracking: 10% of total rental duration
  const [rentalTotalDuration, setRentalTotalDuration] = useState<number>(0);
  const [cancelDeadline, setCancelDeadline] = useState<number>(0); // epoch ms
  const [cancelTimeLeft, setCancelTimeLeft] = useState<number>(0); // seconds remaining

  // Simulated Wallet States (SAR currency for Saudi Arabia clients)
  const [walletBalance, setWalletBalance] = useState<number>(150.00);
  const [showTopUp, setShowTopUp] = useState<boolean>(false);
  const [topUpAmount, setTopUpAmount] = useState<string>("100");
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'bank' | 'applepay'>('card');

  // Load wallet balance from localStorage for persistent demo tracking
  useEffect(() => {
    const stored = localStorage.getItem('simulated_wallet_balance');
    if (stored) {
      setWalletBalance(parseFloat(stored));
    } else {
      localStorage.setItem('simulated_wallet_balance', '150.00');
    }
  }, []);

  const updateWalletBalance = (newBalance: number) => {
    setWalletBalance(newBalance);
    localStorage.setItem('simulated_wallet_balance', newBalance.toFixed(2));
  };

  // Filter for available chairs
  const availableChairs = deviceStates.filter(d => d.online && (!d.session_state || d.session_state === 'LOCKED' || d.session_state === 'AVAILABLE'));
  const selectedChair = deviceStates.find(d => d.wheelchair_id === selectedId);

  // Computed live states: prefer local countdown timer for smooth 1s ticks, sync from server only if no local rental active
  const rentedChair = activeRental ? deviceStates.find(d => d.wheelchair_id === activeRental.wheelchair_id) : null;
  const displayTimeLeft = activeRental ? timeLeft : (rentedChair?.time_left ?? 0);
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
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeRental, timeLeft]);

  // Cancel window countdown timer (10% of rental time)
  useEffect(() => {
    if (!activeRental || cancelDeadline <= 0) return;

    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.floor((cancelDeadline - Date.now()) / 1000));
      setCancelTimeLeft(remaining);
      if (remaining <= 0) clearInterval(tick);
    }, 250);

    return () => clearInterval(tick);
  }, [activeRental, cancelDeadline]);

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

  // Rent / Unlock trigger (checks wallet balance and calls payment webhook)
  const handleRent = async (durationMinutes: number) => {
    if (!selectedId) return;
    setActionLoading(true);

    const price = durationMinutes === 1 ? 0 : durationMinutes === 15 ? 5.00 : 10.00;

    if (walletBalance < price) {
      alert(`Insufficient Funds! The rental price is ${price.toFixed(2)} SAR, but your wallet balance is only ${walletBalance.toFixed(2)} SAR. Please top up your wallet.`);
      setActionLoading(false);
      return;
    }

    try {
      // 1. Create client rental intent (reserved state) via server API to bypass RLS securely
      const resRental = await fetch('/api/rentals/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          wheelchair_id: selectedId,
          duration_s: durationMinutes * 60
        })
      });

      if (!resRental.ok) {
        const errData = await resRental.json();
        throw new Error(errData.error || "Failed to create rental session");
      }

      const { rental } = await resRental.json();

      // 2. Trigger Mock Payment webhook route handler
      const res = await fetch('/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: 'mock',
          rental_id: rental.id,
          amount: price * 100, // in cents/fils
          provider_ref: `MOCK-REF-${Date.now()}`
        })
      });

      const paymentResult = await res.json();
      if (!res.ok) throw new Error(paymentResult.error || "Payment processing failed");

      // Deduct from simulated wallet
      updateWalletBalance(walletBalance - price);

      // Set active local session
      const totalSec = durationMinutes * 60;
      setActiveRental(rental);
      setTimeLeft(totalSec);
      setRentalTotalDuration(totalSec);

      // Set cancel window: 10% of total rental time (minimum 6s for demo)
      const cancelWindowSec = Math.max(6, Math.floor(totalSec * 0.1));
      setCancelDeadline(Date.now() + cancelWindowSec * 1000);
      setCancelTimeLeft(cancelWindowSec);
      
    } catch (err: any) {
      alert("Booking error: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel Rental Handler (optimistic UI — clears instantly, commands fire in background)
  const handleCancelRental = async () => {
    if (!activeRental || cancelTimeLeft <= 0) return;

    const targetId = activeRental.wheelchair_id;
    const durationMin = rentalTotalDuration / 60;
    const price = durationMin <= 1 ? 0 : durationMin <= 15 ? 5.00 : 10.00;

    // Optimistic: clear UI immediately so button feels instant
    if (price > 0) {
      updateWalletBalance(walletBalance + price);
    }
    setActiveRental(null);
    setTimeLeft(0);
    setCancelDeadline(0);
    setCancelTimeLeft(0);
    setRentalTotalDuration(0);

    // Fire commands to ESP32 in background (no await blocking UI)
    supabase.from('commands').insert([
      { wheelchair_id: targetId, cmd: 'LOCK', args: {}, status: 'pending', req_id: `cancel-lock-${Date.now()}` },
      { wheelchair_id: targetId, cmd: 'END_SESSION', args: {}, status: 'pending', req_id: `cancel-end-${Date.now()}` }
    ]).then(({ error }) => {
      if (error) console.error('Cancel command dispatch error:', error);
    });
  };

  // Dispatch SOS command directly from Rider Panel
  const triggerRiderCommand = async (cmd: string, args: any = {}) => {
    const targetId = selectedId || activeRental?.wheelchair_id;
    if (!targetId) return;
    
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('commands')
        .insert({
          wheelchair_id: targetId,
          cmd,
          args,
          status: 'pending',
          req_id: `cmd-${Date.now()}`
        });

      if (error) throw error;
    } catch (err: any) {
      alert("Command failure: " + err.message);
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
    <div className="flex flex-col md:flex-row h-screen w-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden relative">
      
      {/* Top panel/Map on mobile, Right panel on desktop */}
      <div className="flex-grow relative h-[40vh] md:h-full w-full order-1 md:order-2">
        <Map 
          deviceStates={deviceStates} 
          selectedId={selectedId} 
          onSelectDevice={setSelectedId} 
        />
      </div>

      {/* Bottom Panel: Rider Controls */}
      <div className="w-full h-[60vh] md:h-full md:w-[420px] border-t md:border-t-0 md:border-r border-zinc-900 bg-zinc-950/95 flex flex-col justify-between z-10 order-2 md:order-1 shadow-2xl">
        
        {/* Top Branding & Status */}
        <div className="p-6 border-b border-zinc-900 flex justify-between items-center bg-zinc-950/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white">W</div>
            <span className="font-bold text-lg tracking-tight">Rider Dashboard</span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
            Live
          </span>
        </div>

        {/* Simulated Wallet Card (SAR Currency) */}
        <div className="mx-6 mt-4 p-4 rounded-xl bg-zinc-900/60 border border-zinc-900/60 flex justify-between items-center hover:border-zinc-800 transition-all">
          <div className="space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Simulated Wallet</span>
            <div className="font-extrabold text-zinc-200 text-lg flex items-baseline gap-1">
              {walletBalance.toFixed(2)}
              <span className="text-[10px] font-normal text-zinc-500">SAR</span>
            </div>
          </div>
          <button 
            onClick={() => setShowTopUp(true)}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-lg"
          >
            Add Funds
          </button>
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

                {/* Cancel Booking Button — available for first 10% of rental time */}
                {!displayLocked && (
                  <div className="mt-3.5 space-y-2">
                    <button
                      onClick={handleCancelRental}
                      disabled={actionLoading || cancelTimeLeft <= 0}
                      className={`w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg border transition-all uppercase tracking-wider ${
                        cancelTimeLeft > 0
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 cursor-pointer'
                          : 'border-zinc-700/40 bg-zinc-800/30 text-zinc-600 cursor-not-allowed'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {cancelTimeLeft > 0
                        ? `Cancel Booking (${formatTime(cancelTimeLeft)} left)`
                        : 'Cancellation Window Expired'}
                    </button>
                    {/* Progress bar for cancel window */}
                    {rentalTotalDuration > 0 && (
                      <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            cancelTimeLeft > 0 ? 'bg-emerald-500' : 'bg-zinc-600'
                          }`}
                          style={{
                            width: `${Math.min(100, (cancelTimeLeft / Math.max(1, Math.floor(rentalTotalDuration * 0.1))) * 100)}%`
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Manual SOS Panic Trigger */}
                {!displayLocked && (
                  <button
                    onClick={() => triggerRiderCommand(rentedChair?.session_state === 'SAFE_FAULT' ? 'CLEAR_SOS' : 'SOS')}
                    disabled={actionLoading}
                    className={`mt-2 w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg border transition-all cursor-pointer uppercase tracking-wider ${
                      rentedChair?.session_state === 'SAFE_FAULT'
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                        : 'border-red-500/25 bg-red-500/10 text-red-500 hover:bg-red-500/20'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                    {rentedChair?.session_state === 'SAFE_FAULT' ? 'Clear Emergency SOS' : 'Trigger Emergency SOS'}
                  </button>
                )}

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

          {/* Ambient climate for the contextual chair (rented or selected) */}
          {(rentedChair || selectedChair) && (
            <ClimateCard
              tempC={(rentedChair || selectedChair)!.temp_amb}
              humidity={(rentedChair || selectedChair)!.humidity}
              compact
            />
          )}

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
                    { label: '1 Min', value: 1, price: 'Free Demo' },
                    { label: '15 Mins', value: 15, price: '5.00 SAR' },
                    { label: '30 Mins', value: 30, price: '10.00 SAR' }
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
                  Payments processed in SAR. Deducted directly from your simulated balance.
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

      {/* Simulated Deposit (Top Up) dialog modal */}
      {showTopUp && (
        <div className="absolute inset-0 bg-[#09090b]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-900 p-6 rounded-2xl max-w-sm w-full space-y-5 shadow-2xl">
            <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
              <h3 className="font-black text-sm uppercase tracking-wider text-zinc-200">Top Up Wallet</h3>
              <button 
                onClick={() => setShowTopUp(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Amount Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Top Up Amount (SAR)</label>
              <div className="relative">
                <input 
                  type="number" 
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-lg text-sm text-zinc-200 font-bold focus:outline-none focus:border-blue-500"
                  placeholder="100.00"
                />
                <span className="absolute right-3 top-3 text-xs font-bold text-zinc-500">SAR</span>
              </div>
            </div>

            {/* Payment Method selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setPaymentMethod('card')}
                  className={`p-2.5 rounded-lg border text-[10px] font-bold transition-all text-center cursor-pointer ${
                    paymentMethod === 'card' 
                      ? 'border-blue-500/50 bg-blue-500/5 text-blue-400' 
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                  }`}
                >
                  💳 Mada / Visa
                </button>
                <button
                  onClick={() => setPaymentMethod('bank')}
                  className={`p-2.5 rounded-lg border text-[10px] font-bold transition-all text-center cursor-pointer ${
                    paymentMethod === 'bank' 
                      ? 'border-blue-500/50 bg-blue-500/5 text-blue-400' 
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                  }`}
                >
                  🏦 Saudi Bank
                </button>
                <button
                  onClick={() => setPaymentMethod('applepay')}
                  className={`p-2.5 rounded-lg border text-[10px] font-bold transition-all text-center cursor-pointer ${
                    paymentMethod === 'applepay' 
                      ? 'border-blue-500/50 bg-blue-500/5 text-blue-400' 
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                  }`}
                >
                  🍏 Apple Pay
                </button>
              </div>
            </div>

            {/* Details mapping fields */}
            {paymentMethod === 'card' && (
              <div className="space-y-3 bg-zinc-900/30 p-3 rounded-lg border border-zinc-900 text-xs">
                <input 
                  type="text" 
                  placeholder="Cardholder Name" 
                  className="w-full bg-zinc-900 border border-zinc-800 p-2.5 rounded text-zinc-300 placeholder-zinc-600 focus:outline-none"
                  defaultValue="Ahmed Al-Otaibi"
                />
                <input 
                  type="text" 
                  placeholder="Card Number (4000 1234 5678 9010)" 
                  className="w-full bg-zinc-900 border border-zinc-800 p-2.5 rounded text-zinc-300 placeholder-zinc-600 focus:outline-none font-mono"
                  defaultValue="4000 1234 5678 9010"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="MM/YY" className="bg-zinc-900 border border-zinc-800 p-2.5 rounded text-zinc-300 placeholder-zinc-600 focus:outline-none" defaultValue="10/28" />
                  <input type="text" placeholder="CVV" className="bg-zinc-900 border border-zinc-800 p-2.5 rounded text-zinc-300 placeholder-zinc-600 focus:outline-none" defaultValue="321" />
                </div>
              </div>
            )}

            {paymentMethod === 'bank' && (
              <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-900 text-[10px] text-zinc-400 leading-relaxed font-mono">
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Al Rajhi Bank (Saudi Arabia)</span>
                <div className="mt-1">IBAN: SA80 8000 0000 9876 5432 1010</div>
                <div>Account: 987654321010</div>
                <div className="mt-2 text-zinc-500">Press button below once you complete the local bank transfer request.</div>
              </div>
            )}

            {paymentMethod === 'applepay' && (
              <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-900 text-xs text-center text-zinc-400 py-4">
                🍏 Apple Pay Secure Instant Authorization Available.
              </div>
            )}

            <button
              onClick={() => {
                const amount = parseFloat(topUpAmount);
                if (!isNaN(amount) && amount > 0) {
                  updateWalletBalance(walletBalance + amount);
                  setShowTopUp(false);
                  alert(`Successfully topped up ${amount.toFixed(2)} SAR using ${paymentMethod === 'card' ? 'Mada Card' : paymentMethod === 'bank' ? 'Al Rajhi Bank Transfer' : 'Apple Pay'}.`);
                }
              }}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer uppercase tracking-wider"
            >
              Confirm Deposit
            </button>
          </div>
        </div>
      )}

      {/* Emergency Alert HUD Overlay (Fall/Tilt/SOS) */}
      {rentedChair && (rentedChair.session_state === 'SAFE_FAULT' || rentedChair.tilt > 50) && (
        <div className="fixed inset-0 bg-[#09090b]/85 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-red-500/30 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500 animate-pulse">
              <AlertTriangle className="w-8 h-8 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-black text-red-500 uppercase tracking-wider">Emergency SOS Active</h2>
              <p className="text-zinc-400 text-xs font-semibold">
                {rentedChair.tilt > 50 ? "Automatic Tilt/Fall Detected!" : "Manual Emergency SOS Triggered!"}
              </p>
            </div>
            <div className="bg-zinc-900 p-3 rounded-lg border border-zinc-800 text-xs font-mono text-zinc-300">
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Broadcasting Live Location</div>
              Coordinates: {rentedChair.lat.toFixed(6)}, {rentedChair.lng.toFixed(6)}
            </div>
            <p className="text-[10px] text-zinc-500 leading-normal">
              📡 Sending live coordinates to nearest emergency rescue dispatchers (Saudi Red Crescent Authority).
            </p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                onClick={() => triggerRiderCommand('CLEAR_SOS')}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer uppercase tracking-wider"
              >
                Turn Off SOS
              </button>
              <button
                onClick={() => {
                  alert("Saudi Red Crescent dispatcher notified! Emergency assistance dispatched to Karachi coordinates.");
                }}
                className="w-full py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer uppercase tracking-wider"
              >
                Call Red Crescent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anti-Tamper Alarm Overlay (your locked chair is being moved) */}
      {rentedChair && rentedChair.tamper && rentedChair.session_state !== 'SAFE_FAULT' && (
        <div className="fixed inset-0 bg-[#09090b]/85 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-red-500/40 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center mx-auto text-red-500">
              <ShieldOff className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-black text-red-500 uppercase tracking-wider">Tamper Alarm</h2>
              <p className="text-zinc-400 text-xs font-semibold">
                Your locked wheelchair is being moved or tampered with.
              </p>
            </div>
            <div className="bg-zinc-900 p-3 rounded-lg border border-zinc-800 text-xs font-mono text-zinc-300">
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Continuous Siren Active</div>
              {rentedChair.tamper_count} disturbance{rentedChair.tamper_count === 1 ? '' : 's'} detected
            </div>
            <button
              onClick={() => triggerRiderCommand('CLEAR_TAMPER')}
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
