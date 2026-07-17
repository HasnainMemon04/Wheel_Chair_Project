import { getDeviceLabel, getDeviceTone, type StatusTone } from '../lib/deviceStatus';
import type { DeviceState } from '../../../hooks/useFleetState';

const toneClasses: Record<StatusTone, string> = {
  ready: 'border-[#2563EB]/40 bg-[#2563EB]/12 text-[#93C5FD]',
  active: 'border-[#10B981]/40 bg-[#10B981]/12 text-[#6EE7B7]',
  offline: 'border-slate-600 bg-slate-800/80 text-slate-300',
  warning: 'border-[#F59E0B]/45 bg-[#F59E0B]/12 text-[#FCD34D]',
  critical: 'border-[#EF4444]/50 bg-[#EF4444]/15 text-[#FCA5A5]',
  ota: 'border-[#7C3AED]/50 bg-[#7C3AED]/15 text-[#C4B5FD]',
  neutral: 'border-slate-700 bg-slate-900 text-slate-300'
};

export function StatusPill({
  device,
  tone,
  label
}: {
  device?: DeviceState | null;
  tone?: StatusTone;
  label?: string;
}) {
  const resolvedTone = tone ?? getDeviceTone(device);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${toneClasses[resolvedTone]}`}>
      {label ?? getDeviceLabel(device)}
    </span>
  );
}

