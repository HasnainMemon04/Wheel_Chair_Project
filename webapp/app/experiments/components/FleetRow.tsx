import { Battery, Clock3, Gauge } from 'lucide-react';
import type { DeviceState } from '../../../hooks/useFleetState';
import { focusRing } from '../styles/tokens';
import { getDeviceTone } from '../lib/deviceStatus';
import { formatAge, formatMetric } from '../lib/format';
import { StatusPill } from './StatusPill';

const selectedToneRing = {
  ready: 'border-[#2563EB] shadow-[#2563EB]/20',
  active: 'border-[#10B981] shadow-[#10B981]/20',
  offline: 'border-slate-600 shadow-black/20',
  warning: 'border-[#F59E0B] shadow-[#F59E0B]/20',
  critical: 'border-[#EF4444] shadow-[#EF4444]/25',
  ota: 'border-[#7C3AED] shadow-[#7C3AED]/20',
  neutral: 'border-[#334155] shadow-black/20'
};

export function FleetRow({
  device,
  selected,
  onSelect
}: {
  device: DeviceState;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const tone = getDeviceTone(device);

  return (
    <button
      type="button"
      onClick={() => onSelect(device.wheelchair_id)}
      className={`w-full rounded-lg border p-3 text-left transition ${focusRing} ${
        selected
          ? `bg-[#101A2B] shadow-lg ${selectedToneRing[tone]}`
          : 'border-[#263241] bg-[#0B1220] hover:border-[#334155] hover:bg-[#111827]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-slate-50">{device.wheelchair_id}</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Clock3 className="h-3.5 w-3.5" />
            {formatAge(device.ts)}
          </div>
        </div>
        <StatusPill device={device} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-400">
        <span className="inline-flex items-center gap-1 rounded-md bg-[#05070A] px-2 py-1">
          <Battery className="h-3.5 w-3.5 text-[#10B981]" />
          {device.batt_pct}%
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-[#05070A] px-2 py-1">
          <Gauge className="h-3.5 w-3.5 text-[#00A7B5]" />
          {formatMetric(device.speed)} km/h
        </span>
      </div>
    </button>
  );
}

