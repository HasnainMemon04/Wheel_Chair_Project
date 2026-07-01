'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Shield, MapPin, Zap, Compass, Activity, ArrowRight } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col justify-between overflow-hidden">
      
      {/* Background Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/30">
            W
          </div>
          <span className="font-extrabold text-lg sm:text-xl tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            SmartWheel
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/rider" className="text-xs sm:text-sm font-medium text-zinc-400 hover:text-white transition-colors px-2 py-1.5">
            Rider
          </Link>
          <Link href="/operator" className="glass px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold hover:bg-zinc-800/80 transition-all">
            Operator
          </Link>
        </div>
      </header>

      {/* Main Section */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 flex flex-col lg:flex-row items-center justify-center gap-12 z-10 py-12">
        
        {/* Left Copy */}
        <div className="flex-1 flex flex-col items-start text-left max-w-xl">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold mb-6"
          >
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            Next-Gen IoT Mobility
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight"
          >
            Urban Mobility, <br/>
            <span className="bg-gradient-to-r from-blue-500 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
              Redefined.
            </span>
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-zinc-400 mt-6 text-base md:text-lg leading-relaxed"
          >
            Experience the world's most advanced smart wheelchair rental network. Premium comfort, micro-second GPS geofencing, multi-sensor safety overlays, and secure cloud actuation.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 mt-10 w-full sm:w-auto"
          >
            <Link 
              href="/rider" 
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3.5 rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all group"
            >
              Rent a Wheelchair
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              href="/operator" 
              className="flex items-center justify-center gap-2 glass hover:bg-zinc-800/80 font-semibold px-6 py-3.5 rounded-xl transition-all"
            >
              Monitor Fleet
            </Link>
          </motion.div>
        </div>

        {/* Right Cards/Features */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
          <div className="flex flex-col gap-4">
            <motion.div 
              whileHover={{ y: -4 }}
              className="glass-card p-6 flex flex-col justify-between min-h-[160px]"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                <Compass className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Live GPS & Geofence</h3>
                <p className="text-zinc-400 text-xs mt-1">Precise path tracking with sub-meter circular boundaries.</p>
              </div>
            </motion.div>

            <motion.div 
              whileHover={{ y: -4 }}
              className="glass-card p-6 flex flex-col justify-between min-h-[160px]"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Safety Override</h3>
                <p className="text-zinc-400 text-xs mt-1">Immediate gyro tip-over and motor temperature cutoffs.</p>
              </div>
            </motion.div>
          </div>

          <div className="flex flex-col gap-4 sm:translate-y-6">
            <motion.div 
              whileHover={{ y: -4 }}
              className="glass-card p-6 flex flex-col justify-between min-h-[160px]"
            >
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Instant Unlock</h3>
                <p className="text-zinc-400 text-xs mt-1">Scan QR, verify payment on Vercel, and unlock in &lt; 3s.</p>
              </div>
            </motion.div>

            <div className="glass-card p-6 flex flex-col justify-center items-center text-center border-dashed border-zinc-800">
              <span className="text-3xl font-extrabold text-blue-500">60fps</span>
              <span className="text-zinc-400 text-xs uppercase font-semibold mt-1 tracking-wider">Smooth Maps</span>
              <div className="flex gap-1 mt-3">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span className="w-2 h-2 rounded-full bg-emerald-500 absolute" />
              </div>
            </div>
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-6 border-t border-zinc-900/60 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-zinc-500 z-10">
        <span>© 2026 Smart Rental Wheelchair Project. All rights reserved.</span>
        <div className="flex gap-4">
          <span className="hover:text-zinc-300 cursor-pointer">Security Spec v1.0</span>
          <span>•</span>
          <span className="hover:text-zinc-300 cursor-pointer">Hardware-in-Loop</span>
        </div>
      </footer>

    </div>
  );
}
