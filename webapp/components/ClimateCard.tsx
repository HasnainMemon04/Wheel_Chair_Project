'use client';

import { Droplets, Thermometer, Wind, Gauge, ShieldCheck, TriangleAlert } from 'lucide-react';
import { deriveClimate } from '../utils/climate';

interface ClimateCardProps {
  tempC?: number | null;
  humidity?: number | null;
  /** compact hides the derived comfort/advice paragraph (used on the rider view) */
  compact?: boolean;
}

// Ambient climate (DHT22) panel. Shows the raw sensor pair plus the dew point,
// heat index, and comfort guidance derived with the exact firmware formulas.
export default function ClimateCard({ tempC, humidity, compact = false }: ClimateCardProps) {
  const hasReading =
    typeof tempC === 'number' && !isNaN(tempC) && typeof humidity === 'number' && !isNaN(humidity);

  if (!hasReading) {
    return (
      <div className="glass-card p-4 rounded-xl border border-zinc-900/60">
        <div className="flex items-center gap-2 text-zinc-500 text-xs">
          <Wind className="w-3.5 h-3.5" />
          <span className="uppercase font-bold tracking-wider text-[10px]">Ambient Climate</span>
        </div>
        <p className="text-zinc-600 text-xs mt-2">Waiting for DHT22 reading…</p>
      </div>
    );
  }

  const c = deriveClimate(tempC as number, humidity as number);

  const accent =
    c.severity === 2
      ? { ring: 'border-red-500/30', chip: 'bg-red-500/10 text-red-400', icon: 'text-red-400' }
      : c.severity === 1
      ? { ring: 'border-amber-500/30', chip: 'bg-amber-500/10 text-amber-400', icon: 'text-amber-400' }
      : { ring: 'border-emerald-500/25', chip: 'bg-emerald-500/10 text-emerald-400', icon: 'text-emerald-400' };

  return (
    <div className={`glass-card p-4 rounded-xl border ${accent.ring} transition-all`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400">
          <Wind className={`w-3.5 h-3.5 ${accent.icon}`} />
          <span className="uppercase font-bold tracking-wider text-[10px]">Ambient Climate · DHT22</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 ${accent.chip}`}>
          {c.severity === 0 ? <ShieldCheck className="w-3 h-3" /> : <TriangleAlert className="w-3 h-3" />}
          {c.severity === 0 ? 'Comfortable' : c.severity === 1 ? 'Caution' : 'Heat Risk'}
        </span>
      </div>

      {/* Primary pair: air temperature + humidity */}
      <div className="grid grid-cols-2 gap-2.5 mt-3">
        <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-900">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-[9px] uppercase font-bold tracking-wider">Air Temp</span>
            <Thermometer className="w-3.5 h-3.5 text-orange-400" />
          </div>
          <div className="font-extrabold text-zinc-100 text-lg mt-1 flex items-baseline gap-0.5">
            {c.tempC.toFixed(1)}
            <span className="text-[10px] font-normal text-zinc-500">°C</span>
          </div>
        </div>
        <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-900">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-[9px] uppercase font-bold tracking-wider">Humidity</span>
            <Droplets className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="font-extrabold text-zinc-100 text-lg mt-1 flex items-baseline gap-0.5">
            {c.humidity.toFixed(1)}
            <span className="text-[10px] font-normal text-zinc-500">%</span>
          </div>
        </div>
      </div>

      {/* Derived pair: dew point + heat index (feels-like) */}
      <div className="grid grid-cols-2 gap-2.5 mt-2.5">
        <div className="bg-zinc-900/30 rounded-lg p-2.5 border border-zinc-900/60">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-[9px] uppercase font-bold tracking-wider">Dew Point</span>
            <Droplets className="w-3 h-3 text-cyan-400" />
          </div>
          <div className="font-bold text-zinc-200 text-sm mt-0.5">{c.dewPointC.toFixed(1)}°C</div>
        </div>
        <div className="bg-zinc-900/30 rounded-lg p-2.5 border border-zinc-900/60">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-[9px] uppercase font-bold tracking-wider">Feels Like</span>
            <Gauge className={`w-3 h-3 ${accent.icon}`} />
          </div>
          <div className="font-bold text-zinc-200 text-sm mt-0.5">{c.heatIndexC.toFixed(1)}°C</div>
        </div>
      </div>

      {!compact && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] text-zinc-300 font-semibold">{c.comfort}</p>
          <p className="text-[10px] text-zinc-500 leading-relaxed">{c.advice}</p>
        </div>
      )}
    </div>
  );
}
