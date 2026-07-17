import { Battery, Clock3, Sliders, Gauge, Radio, Thermometer } from 'lucide-react';
import type { DeviceState } from '../../../hooks/useFleetState';
import { formatMetric, formatUptime } from '../lib/format';

type Vital = {
  label: string;
  value: string;
  unit?: string;
  icon: typeof Battery;
  tone: string;
};

export function DeviceVitalsGrid({ device, compact = false }: { device: DeviceState | null; compact?: boolean }) {
  const vitals: Vital[] = [
    {
      label: 'Battery',
      value: device ? `${device.batt_pct}` : '--',
      unit: '%',
      icon: Battery,
      tone: device && device.batt_pct <= 20 ? 'text-[#F59E0B]' : 'text-[#10B981]'
    },
    {
      label: 'Speed',
      value: formatMetric(device?.speed),
      unit: 'km/h',
      icon: Gauge,
      tone: 'text-[#00A7B5]'
    },
    {
      label: 'Tilt',
      value: formatMetric(device?.tilt),
      unit: 'deg',
      icon: Sliders,
      tone: device && device.tilt > 50 ? 'text-[#EF4444]' : 'text-[#93C5FD]'
    },
    {
      label: 'Battery Temp',
      value: formatMetric(device?.temp_batt),
      unit: 'C',
      icon: Thermometer,
      tone: device && device.temp_batt > 60 ? 'text-[#EF4444]' : 'text-[#F59E0B]'
    },
    {
      label: 'Signal',
      value: device ? `${device.rssi}` : '--',
      unit: 'dBm',
      icon: Radio,
      tone: 'text-[#7C3AED]'
    },
    {
      label: 'Uptime',
      value: formatUptime(device?.uptime),
      icon: Clock3,
      tone: 'text-slate-300'
    }
  ];

  return (
    <div className={compact ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-3 xl:grid-cols-3'}>
      {vitals.map(({ label, value, unit, icon: Icon, tone }) => (
        <div key={label} className="rounded-lg border border-[#263241] bg-[#0B1220] p-3 shadow-lg shadow-black/15">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
            <Icon className={`h-4 w-4 ${tone}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className={`text-2xl font-black tracking-tight ${tone}`}>{value}</span>
            {unit && <span className="text-xs font-bold text-slate-500">{unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

