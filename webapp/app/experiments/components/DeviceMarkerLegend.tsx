import { Activity, AlertTriangle, Circle, Radio, Zap } from 'lucide-react';

const items = [
  { label: 'Ready', color: 'bg-[#2563EB]', icon: Circle },
  { label: 'Active', color: 'bg-[#10B981]', icon: Zap },
  { label: 'Warning', color: 'bg-[#F59E0B]', icon: Activity },
  { label: 'Critical', color: 'bg-[#EF4444]', icon: AlertTriangle },
  { label: 'Offline', color: 'bg-slate-500', icon: Radio }
];

export function DeviceMarkerLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ label, color, icon: Icon }) => (
        <div
          key={label}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#05070A]/80 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-300 backdrop-blur"
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded-full ${color}`}>
            <Icon className="h-3 w-3 text-white" />
          </span>
          {label}
        </div>
      ))}
    </div>
  );
}

