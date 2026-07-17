'use client';

import Link from 'next/link';
import { Activity, AlertTriangle, ArrowRight, Battery, Map, UserRound } from 'lucide-react';
import { useExperimentState } from './hooks/useExperimentState';
import { isCriticalDevice } from './lib/deviceStatus';
import { focusRing } from './styles/tokens';
import { EmptyState } from './components/EmptyState';
import { LoadingState } from './components/LoadingState';

function HealthMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-[#263241] bg-[#05070A] p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-black tracking-tight ${tone}`}>{value}</div>
    </div>
  );
}

function ModeCard({
  href,
  title,
  description,
  icon: Icon,
  accent
}: {
  href: string;
  title: string;
  description: string;
  icon: typeof UserRound;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-[220px] flex-col justify-between rounded-lg border border-[#263241] bg-[#111827] p-5 shadow-xl shadow-black/25 transition hover:border-[#334155] hover:bg-[#0B1220] ${focusRing}`}
    >
      <div>
        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-lg border border-[#263241] bg-[#05070A] ${accent}`}>
          <Icon className="h-6 w-6" />
        </span>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-white">{title}</h2>
        <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-400">{description}</p>
      </div>
      <span className="mt-6 inline-flex items-center gap-2 text-sm font-black text-[#00A7B5]">
        Open experiment
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export default function ExperimentsHomePage() {
  const { deviceStates, events, loading, error } = useExperimentState();

  const onlineCount = deviceStates.filter((device) => device.online).length;
  const criticalCount = deviceStates.filter(isCriticalDevice).length;
  const activeCount = deviceStates.filter(
    (device) => device.online && (!device.locked || device.session_state === 'ACTIVE')
  ).length;
  const avgBattery = deviceStates.length
    ? Math.round(deviceStates.reduce((sum, device) => sum + device.batt_pct, 0) / deviceStates.length)
    : 0;

  return (
    <main className="mx-auto max-w-[1800px] space-y-6 px-4 pb-8 sm:px-5">
      <section className="rounded-lg border border-[#263241] bg-[#111827] p-5 shadow-xl shadow-black/20 sm:p-6">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#00A7B5]">SmartWheel Pulse</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Experimental mobility cockpit</h1>
        <p className="mt-3 max-w-3xl text-sm font-semibold leading-relaxed text-slate-400">
          Review the next-generation rider and operator experiences beside the current production app.
          All routes use live fleet data without modifying production pages.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_320px]">
        <ModeCard
          href="/experiments/rider"
          title="Rider Experience"
          description="Calm rental flow with live chair discovery, wallet state, and safety-first ride controls."
          icon={UserRound}
          accent="text-[#2563EB]"
        />
        <ModeCard
          href="/experiments/operator"
          title="Operator Cockpit"
          description="Dense fleet command center with map stage, telemetry ribbon, and persistent safety anchors."
          icon={Map}
          accent="text-[#00A7B5]"
        />

        <section className="rounded-lg border border-[#263241] bg-[#111827] p-5 shadow-xl shadow-black/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#00A7B5]">Live health</div>
              <div className="mt-1 text-sm font-bold text-slate-500">Fleet snapshot</div>
            </div>
            <Activity className="h-5 w-5 text-[#10B981]" />
          </div>

          {loading && <div className="mt-4"><LoadingState label="Syncing fleet" /></div>}
          {!loading && error && (
            <div className="mt-4">
              <EmptyState title="Fleet unavailable" detail={error} />
            </div>
          )}
          {!loading && !error && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <HealthMetric label="Online" value={onlineCount} tone="text-[#10B981]" />
              <HealthMetric label="Active" value={activeCount} tone="text-[#00A7B5]" />
              <HealthMetric label="Alerts" value={criticalCount} tone="text-[#EF4444]" />
              <HealthMetric label="Avg batt" value={`${avgBattery}%`} tone="text-[#F59E0B]" />
            </div>
          )}

          {!loading && !error && events.length > 0 && (
            <div className="mt-4 rounded-lg border border-[#263241] bg-[#05070A] p-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                <AlertTriangle className="h-3.5 w-3.5 text-[#F59E0B]" />
                Latest event
              </div>
              <div className="mt-2 text-sm font-black text-slate-200">{events[0].type}</div>
              <div className="mt-1 text-xs font-bold text-slate-500">{events[0].wheelchair_id}</div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-[#263241] bg-[#0B1220] p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Battery className="h-4 w-4 text-[#10B981]" />
            {deviceStates.length} chairs in snapshot
          </span>
          <span>Unified dark cockpit · Core Ink + Graphite surfaces</span>
          <span>No auto-target · deliberate chair selection required</span>
        </div>
      </section>
    </main>
  );
}
