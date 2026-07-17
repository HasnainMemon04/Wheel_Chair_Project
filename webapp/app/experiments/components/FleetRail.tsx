'use client';

import { useMemo, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import type { DeviceState } from '../../../hooks/useFleetState';
import { getDeviceTone, sortDevices, type StatusTone } from '../lib/deviceStatus';
import { EmptyState } from './EmptyState';
import { FleetRow } from './FleetRow';
import { LoadingState } from './LoadingState';

type FleetFilter = 'all' | StatusTone;

const filters: Array<{ label: string; value: FleetFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'Active', value: 'active' },
  { label: 'Ready', value: 'ready' },
  { label: 'Offline', value: 'offline' },
  { label: 'OTA', value: 'ota' }
];

export function FleetRail({
  devices,
  selectedId,
  onSelectDevice,
  loading = false,
  title = 'Fleet'
}: {
  devices: DeviceState[];
  selectedId: string | null;
  onSelectDevice: (id: string) => void;
  loading?: boolean;
  title?: string;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FleetFilter>('all');

  const filteredDevices = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sortDevices(devices).filter((device) => {
      const matchesQuery = !normalized || device.wheelchair_id.toLowerCase().includes(normalized);
      const matchesFilter = filter === 'all' || getDeviceTone(device) === filter;
      return matchesQuery && matchesFilter;
    });
  }, [devices, filter, query]);

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-[#263241] bg-[#0B1220] shadow-xl shadow-black/20">
      <div className="border-b border-[#263241] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#00A7B5]">{title}</div>
            <div className="mt-1 text-sm font-bold text-slate-400">{devices.length} chairs in snapshot</div>
          </div>
          <Filter className="h-5 w-5 text-slate-500" />
        </div>

        <label className="mt-4 flex min-h-11 items-center gap-2 rounded-lg border border-[#263241] bg-[#05070A] px-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chair ID"
            className="w-full bg-transparent text-sm font-semibold text-slate-100 placeholder:text-slate-600 focus:outline-none"
          />
        </label>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] transition ${
                filter === item.value
                  ? 'border-[#00A7B5] bg-[#00A7B5] text-[#031316]'
                  : 'border-[#263241] bg-[#111827] text-slate-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loading && <LoadingState />}
        {!loading && filteredDevices.map((device) => (
          <FleetRow
            key={device.wheelchair_id}
            device={device}
            selected={selectedId === device.wheelchair_id}
            onSelect={onSelectDevice}
          />
        ))}
        {!loading && filteredDevices.length === 0 && (
          <EmptyState title="No chairs match" detail="Change the filter or search text." />
        )}
      </div>
    </section>
  );
}

