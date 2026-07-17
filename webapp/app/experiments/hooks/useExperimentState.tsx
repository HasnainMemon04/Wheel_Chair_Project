'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { type DeviceState, type SafetyEvent, useFleetState } from '../../../hooks/useFleetState';
import { supabase } from '../../../utils/supabase';

type ExperimentRental = {
  id: string;
  wheelchair_id: string;
  duration_s: number;
  price_sar: number;
  started_at_ms: number;
  end_at_ms: number;
};

type ExperimentContextValue = {
  deviceStates: DeviceState[];
  events: SafetyEvent[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selectedDevice: DeviceState | null;
  setSelectedId: (id: string | null) => void;
  walletBalance: number;
  updateWalletBalance: (nextBalance: number) => void;
  activeRental: ExperimentRental | null;
  timeLeft: number;
  rentalBusy: boolean;
  rentalError: string | null;
  startRental: (durationMinutes: number, priceSar: number) => Promise<void>;
  endRental: () => Promise<void>;
  commandBusy: string | null;
  commandError: string | null;
  commandBlockReason: string | null;
  sendCommand: (cmd: string, args?: Record<string, unknown>, targetId?: string) => Promise<void>;
};

type RentalCreatePayload = {
  rental?: {
    id: string;
    wheelchair_id?: string;
    duration_s?: number;
    end_at?: string;
  };
  error?: string;
};

type PaymentPayload = {
  error?: string;
};

const WALLET_KEY = 'smartwheel_pulse_wallet';
const RENTAL_KEY = 'smartwheel_pulse_active_rental';

const ExperimentContext = createContext<ExperimentContextValue | null>(null);

function readStoredWallet() {
  if (typeof window === 'undefined') return 150;
  const stored = window.localStorage.getItem(WALLET_KEY);
  if (!stored) return 150;
  const parsed = Number.parseFloat(stored);
  return Number.isFinite(parsed) ? parsed : 150;
}

function readStoredRental(): ExperimentRental | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(RENTAL_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as ExperimentRental;
    if (!parsed.id || !parsed.wheelchair_id || !Number.isFinite(parsed.end_at_ms)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function ExperimentProvider({ children }: { children: ReactNode }) {
  const { deviceStates, events, loading, error } = useFleetState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState(150);
  const [activeRental, setActiveRental] = useState<ExperimentRental | null>(null);
  const [clockTick, setClockTick] = useState(Date.now());
  const [rentalBusy, setRentalBusy] = useState(false);
  const [rentalError, setRentalError] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  useEffect(() => {
    setWalletBalance(readStoredWallet());
    setActiveRental(readStoredRental());
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeRental) {
      window.localStorage.setItem(RENTAL_KEY, JSON.stringify(activeRental));
    } else {
      window.localStorage.removeItem(RENTAL_KEY);
    }
  }, [activeRental]);

  const selectedDevice = useMemo(() => {
    if (!selectedId) return null;
    return deviceStates.find((device) => device.wheelchair_id === selectedId) ?? null;
  }, [deviceStates, selectedId]);

  const timeLeft = activeRental
    ? Math.max(0, Math.ceil((activeRental.end_at_ms - clockTick) / 1000))
    : 0;

  const updateWalletBalance = useCallback((nextBalance: number) => {
    setWalletBalance(nextBalance);
    window.localStorage.setItem(WALLET_KEY, nextBalance.toFixed(2));
  }, []);

  const getCommandBlockReason = useCallback((targetId: string | null | undefined) => {
    if (!targetId) return 'Select a wheelchair before sending commands.';
    const target = deviceStates.find((device) => device.wheelchair_id === targetId);
    if (!target) {
      return `Wheelchair ${targetId} is not in the live fleet snapshot.`;
    }
    if (!target.online) {
      return `Wheelchair ${targetId} is offline. Commands are blocked to avoid doomed pending rows.`;
    }
    return null;
  }, [deviceStates]);

  const commandBlockReason = getCommandBlockReason(selectedId);

  const assertOnlineTarget = useCallback((targetId: string) => {
    const blockReason = getCommandBlockReason(targetId);
    if (blockReason) throw new Error(blockReason);
    return deviceStates.find((device) => device.wheelchair_id === targetId)!;
  }, [deviceStates, getCommandBlockReason]);

  const sendCommand = useCallback(async (
    cmd: string,
    args: Record<string, unknown> = {},
    targetId = selectedId ?? undefined
  ) => {
    const blockReason = getCommandBlockReason(targetId);
    if (blockReason) {
      setCommandError(blockReason);
      throw new Error(blockReason);
    }

    setCommandBusy(cmd);
    setCommandError(null);

    const { error: commandInsertError } = await supabase.from('commands').insert({
      wheelchair_id: targetId,
      cmd,
      args,
      status: 'pending',
      req_id: `pulse-${cmd.toLowerCase()}-${Date.now()}`
    });

    setCommandBusy(null);

    if (commandInsertError) {
      setCommandError(commandInsertError.message);
      throw commandInsertError;
    }
  }, [getCommandBlockReason, selectedId]);

  const startRental = useCallback(async (durationMinutes: number, priceSar: number) => {
    if (!selectedId) throw new Error('Select a wheelchair before starting a ride.');
    assertOnlineTarget(selectedId);
    if (walletBalance < priceSar) {
      throw new Error(`Wallet balance is ${walletBalance.toFixed(2)} SAR.`);
    }

    setRentalBusy(true);
    setRentalError(null);

    try {
      const createResponse = await fetch('/api/rentals/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wheelchair_id: selectedId,
          duration_s: durationMinutes * 60
        })
      });
      const createPayload = await createResponse.json() as RentalCreatePayload;
      if (!createResponse.ok || !createPayload.rental) {
        throw new Error(createPayload.error || 'Failed to create rental.');
      }

      const paymentResponse = await fetch('/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'mock',
          rental_id: createPayload.rental.id,
          amount: priceSar * 100,
          provider_ref: `PULSE-${Date.now()}`
        })
      });
      const paymentPayload = await paymentResponse.json() as PaymentPayload;

      if (!paymentResponse.ok) {
        await supabase
          .from('rentals')
          .update({ state: 'cancelled' })
          .eq('id', createPayload.rental.id)
          .eq('state', 'reserved');
        throw new Error(paymentPayload.error || 'Payment failed.');
      }

      const startedAtMs = Date.now();
      const durationS = durationMinutes * 60;
      setActiveRental({
        id: createPayload.rental.id,
        wheelchair_id: selectedId,
        duration_s: durationS,
        price_sar: priceSar,
        started_at_ms: startedAtMs,
        end_at_ms: startedAtMs + durationS * 1000
      });
      updateWalletBalance(walletBalance - priceSar);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRentalError(message);
      throw err;
    } finally {
      setRentalBusy(false);
    }
  }, [assertOnlineTarget, selectedId, updateWalletBalance, walletBalance]);

  const endRental = useCallback(async () => {
    if (!activeRental) return;
    setRentalBusy(true);
    setRentalError(null);

    try {
      await sendCommand('LOCK', {}, activeRental.wheelchair_id);
      await sendCommand('END_SESSION', {}, activeRental.wheelchair_id);
      setActiveRental(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRentalError(message);
      throw err;
    } finally {
      setRentalBusy(false);
    }
  }, [activeRental, sendCommand]);

  const value = useMemo<ExperimentContextValue>(() => ({
    deviceStates,
    events,
    loading,
    error,
    selectedId,
    selectedDevice,
    setSelectedId,
    walletBalance,
    updateWalletBalance,
    activeRental,
    timeLeft,
    rentalBusy,
    rentalError,
    startRental,
    endRental,
    commandBusy,
    commandError,
    commandBlockReason,
    sendCommand
  }), [
    activeRental,
    commandBlockReason,
    commandBusy,
    commandError,
    deviceStates,
    endRental,
    error,
    events,
    loading,
    rentalBusy,
    rentalError,
    selectedDevice,
    selectedId,
    sendCommand,
    startRental,
    timeLeft,
    updateWalletBalance,
    walletBalance
  ]);

  return (
    <ExperimentContext.Provider value={value}>
      {children}
    </ExperimentContext.Provider>
  );
}

export function useExperimentState() {
  const context = useContext(ExperimentContext);
  if (!context) throw new Error('useExperimentState must be used inside ExperimentProvider.');
  return context;
}

export function useSelectedDevice() {
  const { selectedId, selectedDevice, setSelectedId } = useExperimentState();
  return { selectedId, selectedDevice, setSelectedId };
}

export function useExperimentWallet() {
  const { walletBalance, updateWalletBalance } = useExperimentState();
  return { walletBalance, updateWalletBalance };
}

export function useRentalActions() {
  const { activeRental, timeLeft, rentalBusy, rentalError, startRental, endRental } = useExperimentState();
  return { activeRental, timeLeft, rentalBusy, rentalError, startRental, endRental };
}

export function useCommandDispatcher() {
  const { commandBusy, commandError, commandBlockReason, sendCommand } = useExperimentState();
  return { commandBusy, commandError, commandBlockReason, sendCommand };
}

