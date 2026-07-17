import { AlertTriangle, Clock3 } from 'lucide-react';
import type { SafetyEvent } from '../../../hooks/useFleetState';
import { formatAge } from '../lib/format';
import { EmptyState } from './EmptyState';

function eventTone(type: string) {
  if (['FALL', 'OVERTEMP', 'TAMPER', 'UNLOCK_FAILED', 'OTA_FAIL'].includes(type)) {
    return 'border-[#EF4444]/40 bg-[#EF4444]/10 text-[#FCA5A5]';
  }
  if (['TILT_WARN', 'OVERSPEED', 'GEOFENCE_EXIT', 'SESSION_END_OFFLINE', 'OTA_DEFERRED'].includes(type)) {
    return 'border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#FCD34D]';
  }
  return 'border-[#00A7B5]/30 bg-[#00A7B5]/10 text-[#67E8F9]';
}

export function SafetyTimeline({ events, compact = false }: { events: SafetyEvent[]; compact?: boolean }) {
  const visibleEvents = events.slice(0, compact ? 5 : 10);

  return (
    <section className="rounded-lg border border-[#263241] bg-[#0B1220] shadow-xl shadow-black/20">
      <div className="flex items-center justify-between gap-3 border-b border-[#263241] p-4">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#00A7B5]">Safety timeline</div>
          <div className="mt-1 text-sm font-bold text-slate-500">{events.length} recent events</div>
        </div>
        <AlertTriangle className="h-5 w-5 text-[#F59E0B]" />
      </div>

      <div className="space-y-2 p-3">
        {visibleEvents.map((event) => (
          <div key={event.id} className={`rounded-lg border p-3 ${eventTone(event.type)}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black">{event.type}</div>
                <div className="mt-1 text-xs font-bold opacity-80">{event.wheelchair_id}</div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold opacity-80">
                <Clock3 className="h-3.5 w-3.5" />
                {formatAge(event.ts)}
              </span>
            </div>
          </div>
        ))}

        {visibleEvents.length === 0 && (
          <EmptyState title="No events in the live feed" />
        )}
      </div>
    </section>
  );
}
