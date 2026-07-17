'use client';

import { useExperimentState } from '../hooks/useExperimentState';
import { useSelectedDevice } from '../hooks/useSelectedDevice';
import { useExperimentWallet } from '../hooks/useExperimentWallet';
import { DeviceHeroPanel } from '../components/DeviceHeroPanel';
import { DeviceVitalsGrid } from '../components/DeviceVitalsGrid';
import { EmptyState } from '../components/EmptyState';
import { FleetRail } from '../components/FleetRail';
import { LiveMapStage } from '../components/LiveMapStage';
import { LoadingState } from '../components/LoadingState';

export default function ExperimentsRiderPage() {
  const { deviceStates, loading, error } = useExperimentState();
  const { selectedId, selectedDevice, setSelectedId } = useSelectedDevice();
  const { walletBalance } = useExperimentWallet();

  return (
    <main className="mx-auto max-w-[1800px] space-y-4 px-4 pb-8 sm:px-5">
      <section className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[#263241] bg-[#111827] p-4 shadow-xl shadow-black/20">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#00A7B5]">Rider experiment</div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Nearby chairs and live map</h1>
          <p className="mt-2 text-sm font-semibold text-slate-400">
            Select a wheelchair deliberately before rental actions unlock in Phase 3.
          </p>
        </div>
        <div className="rounded-lg border border-[#263241] bg-[#05070A] px-4 py-3 text-right">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Wallet</div>
          <div className="text-2xl font-black text-[#10B981]">{walletBalance.toFixed(2)} SAR</div>
        </div>
      </section>

      {error && <EmptyState title="Fleet feed unavailable" detail={error} />}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-stretch">
        <div className="order-2 lg:order-1 lg:max-h-[calc(100vh-220px)]">
          <FleetRail
            devices={deviceStates}
            selectedId={selectedId}
            onSelectDevice={setSelectedId}
            loading={loading}
            title="Nearby chairs"
          />
        </div>

        <div className="order-1 flex min-h-0 flex-col gap-4 lg:order-2">
          <div className="h-[42vh] min-h-[320px] lg:h-[calc(100vh-320px)] lg:min-h-[480px]">
            {loading ? (
              <LoadingState label="Loading map stage" />
            ) : (
              <LiveMapStage
                devices={deviceStates}
                selectedId={selectedId}
                selectedDevice={selectedDevice}
                onSelectDevice={setSelectedId}
                density="rider"
              />
            )}
          </div>

          <DeviceHeroPanel device={selectedDevice} />

          {selectedDevice && (
            <section className="rounded-lg border border-[#263241] bg-[#111827] p-4 shadow-xl shadow-black/20">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#00A7B5]">Chair vitals</div>
              <div className="mt-3">
                <DeviceVitalsGrid device={selectedDevice} />
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
