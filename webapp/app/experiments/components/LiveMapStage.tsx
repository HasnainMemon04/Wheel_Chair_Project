'use client';

import dynamic from 'next/dynamic';
import { Crosshair, MousePointer2 } from 'lucide-react';
import type { DeviceState } from '../../../hooks/useFleetState';
import { formatAge } from '../lib/format';
import { getDeviceLabel } from '../lib/deviceStatus';
import { DeviceMarkerLegend } from './DeviceMarkerLegend';
import { DeviceVitalsGrid } from './DeviceVitalsGrid';
import { StatusPill } from './StatusPill';

const Map = dynamic(() => import('../../../components/Map'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#05070A]" />
});

export function LiveMapStage({
  devices,
  selectedId,
  selectedDevice,
  onSelectDevice,
  density = 'operator'
}: {
  devices: DeviceState[];
  selectedId: string | null;
  selectedDevice: DeviceState | null;
  onSelectDevice: (id: string) => void;
  density?: 'rider' | 'operator';
}) {
  return (
    <section className="relative min-h-[420px] overflow-hidden rounded-lg border border-[#263241] bg-[#05070A] shadow-2xl shadow-black/30 lg:min-h-0">
      <Map deviceStates={devices} selectedId={selectedId} onSelectDevice={onSelectDevice} />

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-3">
        <div className="pointer-events-auto rounded-lg border border-white/10 bg-[#05070A]/86 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#00A7B5]">
            <Crosshair className="h-4 w-4" />
            Target
          </div>
          <div className="mt-1 text-xl font-black text-white">
            {selectedDevice?.wheelchair_id ?? 'No target armed'}
          </div>
          <div className="mt-1 text-xs font-bold text-slate-400">
            {selectedDevice ? `${getDeviceLabel(selectedDevice)} · ${formatAge(selectedDevice.ts)}` : 'Select a chair from the fleet or map'}
          </div>
        </div>

        <div className="pointer-events-auto hidden lg:block">
          <DeviceMarkerLegend />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3">
        {selectedDevice ? (
          <div className="pointer-events-auto rounded-lg border border-white/10 bg-[#05070A]/90 p-3 shadow-xl shadow-black/30 backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-3">
              <StatusPill device={selectedDevice} />
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                {density === 'operator' ? 'Telemetry ribbon' : 'Ride telemetry'}
              </span>
            </div>
            <DeviceVitalsGrid device={selectedDevice} compact />
          </div>
        ) : (
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-dashed border-[#334155] bg-[#05070A]/88 px-4 py-3 text-sm font-bold text-slate-400 backdrop-blur">
            <MousePointer2 className="h-4 w-4 text-[#00A7B5]" />
            No wheelchair selected
          </div>
        )}
      </div>
    </section>
  );
}

