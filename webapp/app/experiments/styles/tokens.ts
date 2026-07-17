/** Unified low-glare dark cockpit palette for all experiment routes. */
export const cockpit = {
  ink: '#05070A',
  graphite: '#111827',
  panel: '#0B1220',
  panelSoft: '#101A2B',
  border: '#263241',
  borderStrong: '#334155',
  text: '#F8FAFC',
  muted: '#94A3B8',
  cyan: '#00A7B5',
  blue: '#2563EB',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  violet: '#7C3AED'
} as const;

export const surfaces = {
  shell: 'bg-[#05070A] text-slate-100',
  panel: 'bg-[#111827] border-[#263241]',
  panelRaised: 'bg-[#0B1220] border-[#263241]',
  inset: 'bg-[#05070A] border-[#263241]'
} as const;

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00A7B5] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070A]';

