import type { DeviceState } from '../../../hooks/useFleetState';

export type StatusTone = 'ready' | 'active' | 'offline' | 'warning' | 'critical' | 'ota' | 'neutral';

export function getDeviceTone(device: DeviceState | null | undefined): StatusTone {
  if (!device) return 'neutral';
  if (!device.online) return 'offline';
  if (device.session_state === 'SAFE_FAULT' || device.tamper) return 'critical';
  if (device.geofence?.on && device.geofence.in === 0) return 'critical';
  if (device.ota_status && !['idle', 'success'].includes(device.ota_status)) return 'ota';
  if ((device.time_left > 0 && device.time_left <= 120)) return 'warning';
  if (!device.locked || device.session_state === 'ACTIVE') return 'active';
  return 'ready';
}

export function getDeviceLabel(device: DeviceState | null | undefined) {
  const tone = getDeviceTone(device);
  if (!device) return 'No target';
  if (tone === 'offline') return 'Offline';
  if (device.session_state === 'SAFE_FAULT') return 'Emergency';
  if (device.tamper) return 'Tamper';
  if (device.geofence?.on && device.geofence.in === 0) return 'Boundary';
  if (tone === 'ota') return 'OTA';
  if (tone === 'warning') return 'Warning';
  if (tone === 'active') return 'Active';
  return 'Ready';
}

export function isCriticalDevice(device: DeviceState) {
  return getDeviceTone(device) === 'critical';
}

export function sortDevices(devices: DeviceState[]) {
  return [...devices].sort((a, b) => {
    const toneOrder: Record<StatusTone, number> = {
      critical: 0,
      warning: 1,
      active: 2,
      ready: 3,
      ota: 4,
      offline: 5,
      neutral: 6
    };
    const toneDelta = toneOrder[getDeviceTone(a)] - toneOrder[getDeviceTone(b)];
    if (toneDelta !== 0) return toneDelta;
    return a.wheelchair_id.localeCompare(b.wheelchair_id);
  });
}

