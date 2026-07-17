export function formatAge(ts?: string) {
  if (!ts) return '--';
  const age = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (age >= 86400) return `${Math.floor(age / 86400)}d ago`;
  if (age >= 3600) return `${Math.floor(age / 3600)}h ago`;
  if (age >= 60) return `${Math.floor(age / 60)}m ago`;
  return `${age}s ago`;
}

export function formatUptime(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatMetric(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toFixed(digits);
}

export function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

