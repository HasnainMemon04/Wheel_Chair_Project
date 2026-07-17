'use client';

import { AlertTriangle, Battery, Radio, Siren } from 'lucide-react';
import { getDeviceLabel, isCriticalDevice } from '../lib/deviceStatus';
import { useExperimentState } from '../hooks/useExperimentState';
import { focusRing } from '../styles/tokens';
import { StatusPill } from './StatusPill';

export function OperatorSafetyAnchor() {
  const { deviceStates, selectedDevice, selectedId, sendCommand, commandBusy } = useExperimentState();

  const criticalCount = deviceStates.filter(isCriticalDevice).length;
  const offlineCount = deviceStates.filter((device) => !device.online).length;
  const onlineCount = deviceStates.filter((device) => device.online).length;

  const commandBlocked = !selectedId || !selectedDevice?.online;
  const blockReason = !selectedId
    ? 'Select a wheelchair first'
    : !selectedDevice?.online
      ? `${selectedId} is offline`
      : null;

  async function handleEmergencySos() {
    if (commandBlocked || !selectedId) return;
    const confirmed = window.confirm(
      `Send SOS command to ${selectedId}? This is a safety-critical action.`
    );
    if (!confirmed) return;
    await sendCommand('SOS', {}, selectedId);
  }

  return (
    <div className="sticky top-[150px] z-30 border-b border-[#263241] bg-[#111827]/95 backdrop-blur-xl sm:top-[132px] lg:hidden">
      <div className="mx-auto flex max-w-[1800px] items-center gap-2 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#10B981]/35 bg-[#10B981]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#6EE7B7]">
            <Radio className="h-3 w-3" />
            {onlineCount} online
          </span>
          {criticalCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#EF4444]/45 bg-[#EF4444]/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#FCA5A5]">
              <AlertTriangle className="h-3 w-3" />
              {criticalCount} critical
            </span>
          )}
          {offlineCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-300">
              {offlineCount} offline
            </span>
          )}
          {selectedDevice ? (
            <>
              <StatusPill device={selectedDevice} />
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#263241] bg-[#05070A] px-2.5 py-1 text-[10px] font-black text-slate-300">
                <Battery className="h-3 w-3 text-[#10B981]" />
                {selectedDevice.batt_pct}%
              </span>
              <span className="truncate text-[10px] font-bold text-slate-500">
                {getDeviceLabel(selectedDevice)} · {selectedId}
              </span>
            </>
          ) : (
            <span className="text-[10px] font-bold text-slate-500">No target armed</span>
          )}
        </div>

        <button
          type="button"
          disabled={commandBlocked || commandBusy === 'SOS'}
          onClick={handleEmergencySos}
          title={blockReason ?? 'Send SOS to selected wheelchair'}
          className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-[#EF4444]/50 bg-[#EF4444]/15 px-3 text-xs font-black uppercase tracking-[0.1em] text-[#FCA5A5] transition disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
        >
          <Siren className="h-4 w-4" />
          SOS
        </button>
      </div>
    </div>
  );
}
