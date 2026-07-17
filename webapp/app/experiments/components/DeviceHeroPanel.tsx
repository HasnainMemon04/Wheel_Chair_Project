import { MapPin, ShieldCheck } from 'lucide-react';
import type { DeviceState } from '../../../hooks/useFleetState';
import { formatAge, formatUptime } from '../lib/format';
import { EmptyState } from './EmptyState';
import { StatusPill } from './StatusPill';

export function DeviceHeroPanel({ device }: { device: DeviceState | null }) {
  if (!device) {
    return (
      <EmptyState
        title="No wheelchair targeted"
        detail="Select a chair before rental or operator commands become available."
      />
    );
  }

  return (
    <section className="rounded-lg border border-[#263241] bg-[#0B1220] p-4 shadow-xl shadow-black/20">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#00A7B5]">Selected wheelchair</div>
          <h2 className="mt-2 truncate text-3xl font-black tracking-tight text-white">{device.wheelchair_id}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[#F59E0B]" />
              {(device.lat ?? 0).toFixed(5)}, {(device.lng ?? 0).toFixed(5)}
            </span>
            <span>Last seen {formatAge(device.ts)}</span>
            <span>Uptime {formatUptime(device.uptime)}</span>
          </div>
        </div>
        <StatusPill device={device} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3">
        <div className="rounded-lg border border-[#263241] bg-[#05070A] p-3">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            <ShieldCheck className="h-4 w-4 text-[#10B981]" />
            Lock state
          </div>
          <div className="mt-2 text-xl font-black text-white">{device.locked ? 'Locked' : 'Unlocked'}</div>
        </div>
      </div>
    </section>
  );
}

