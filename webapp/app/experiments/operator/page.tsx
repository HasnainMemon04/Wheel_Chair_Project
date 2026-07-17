'use client';

import { useState } from 'react';
import { Map, Radio, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useExperimentState } from '../hooks/useExperimentState';
import { useSelectedDevice } from '../hooks/useSelectedDevice';
import { isCriticalDevice } from '../lib/deviceStatus';
import { focusRing } from '../styles/tokens';
import { DeviceHeroPanel } from '../components/DeviceHeroPanel';
import { DeviceVitalsGrid } from '../components/DeviceVitalsGrid';
import { EmptyState } from '../components/EmptyState';
import { FleetRail } from '../components/FleetRail';
import { LiveMapStage } from '../components/LiveMapStage';
import { LoadingState } from '../components/LoadingState';
import { OperatorSafetyAnchor } from '../components/OperatorSafetyAnchor';
import { SafetyTimeline } from '../components/SafetyTimeline';

type OperatorTab = 'map' | 'fleet' | 'details';

const tabs: Array<{ id: OperatorTab; label: string; icon: typeof Map }> = [
  { id: 'map', label: 'Map', icon: Map },
  { id: 'fleet', label: 'Fleet', icon: Radio },
  { id: 'details', label: 'Details', icon: SlidersHorizontal }
];

function FleetMetricsBar() {
  const { deviceStates } = useExperimentState();
  const onlineCount = deviceStates.filter((device) => device.online).length;
  const criticalCount = deviceStates.filter(isCriticalDevice).length;
  const activeCount = deviceStates.filter(
    (device) => device.online && (!device.locked || device.session_state === 'ACTIVE')
  ).length;
  const avgBattery = deviceStates.length
    ? Math.round(deviceStates.reduce((sum, device) => sum + device.batt_pct, 0) / deviceStates.length)
    : 0;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        { label: 'Online', value: onlineCount, tone: 'text-[#10B981]' },
        { label: 'Active', value: activeCount, tone: 'text-[#00A7B5]' },
        { label: 'Critical', value: criticalCount, tone: 'text-[#EF4444]' },
        { label: 'Avg batt', value: `${avgBattery}%`, tone: 'text-[#F59E0B]' }
      ].map((metric) => (
        <div key={metric.label} className="rounded-lg border border-[#263241] bg-[#05070A] px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{metric.label}</div>
          <div className={`mt-1 text-xl font-black ${metric.tone}`}>{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function ExperimentsOperatorPage() {
  const { deviceStates, events, loading, error, commandError } = useExperimentState();
  const { selectedId, selectedDevice, setSelectedId } = useSelectedDevice();
  const [mobileTab, setMobileTab] = useState<OperatorTab>('map');

  return (
    <>
      <OperatorSafetyAnchor />

      <main className="mx-auto max-w-[1800px] space-y-4 px-4 pb-8 sm:px-5">
        <section className="rounded-lg border border-[#263241] bg-[#111827] p-4 shadow-xl shadow-black/20">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#00A7B5]">Operator cockpit</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Fleet command center</h1>
              <p className="mt-2 text-sm font-semibold text-slate-400">
                Live map, fleet rail, and telemetry. Commands arrive in Phase 4.
              </p>
            </div>
            <div className="hidden w-full max-w-xl lg:block">
              <FleetMetricsBar />
            </div>
          </div>

          <div className="mt-4 lg:hidden">
            <FleetMetricsBar />
          </div>

          {commandError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3 text-sm font-bold text-[#FCA5A5]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {commandError}
            </div>
          )}
        </section>

        {error && <EmptyState title="Fleet feed unavailable" detail={error} />}

        <nav className="grid grid-cols-3 rounded-lg border border-[#263241] bg-[#0B1220] p-1 lg:hidden">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMobileTab(id)}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-black transition ${focusRing} ${
                mobileTab === id
                  ? 'bg-[#00A7B5] text-[#031316]'
                  : 'text-slate-300 hover:bg-[#111827] hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="hidden gap-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:items-stretch">
          <FleetRail
            devices={deviceStates}
            selectedId={selectedId}
            onSelectDevice={setSelectedId}
            loading={loading}
          />

          <div className="min-h-[520px]">
            {loading ? (
              <LoadingState label="Loading map stage" />
            ) : (
              <LiveMapStage
                devices={deviceStates}
                selectedId={selectedId}
                selectedDevice={selectedDevice}
                onSelectDevice={setSelectedId}
                density="operator"
              />
            )}
          </div>

          <div className="space-y-4">
            <DeviceHeroPanel device={selectedDevice} />
            {selectedDevice && <DeviceVitalsGrid device={selectedDevice} />}
          </div>
        </div>

        <div className="space-y-4 lg:hidden">
          {mobileTab === 'map' && (
            <div className="h-[46vh] min-h-[300px]">
              {loading ? (
                <LoadingState label="Loading map stage" />
              ) : (
                <LiveMapStage
                  devices={deviceStates}
                  selectedId={selectedId}
                  selectedDevice={selectedDevice}
                  onSelectDevice={setSelectedId}
                  density="operator"
                />
              )}
            </div>
          )}

          {mobileTab === 'fleet' && (
            <FleetRail
              devices={deviceStates}
              selectedId={selectedId}
              onSelectDevice={setSelectedId}
              loading={loading}
            />
          )}

          {mobileTab === 'details' && (
            <div className="space-y-4">
              <DeviceHeroPanel device={selectedDevice} />
              {selectedDevice ? (
                <DeviceVitalsGrid device={selectedDevice} />
              ) : (
                <EmptyState
                  title="No wheelchair targeted"
                  detail="Choose a chair from the Fleet tab or map before details appear."
                />
              )}
            </div>
          )}
        </div>

        <SafetyTimeline events={events} />
      </main>
    </>
  );
}
