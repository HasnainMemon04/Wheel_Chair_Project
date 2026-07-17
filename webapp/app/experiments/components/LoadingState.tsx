export function LoadingState({ label = 'Loading live fleet' }: { label?: string }) {
  return (
    <div className="rounded-lg border border-[#263241] bg-[#0B1220] p-5">
      <div className="h-3 w-32 rounded-full bg-slate-800" />
      <div className="mt-4 grid gap-3">
        <div className="h-14 rounded-lg bg-slate-900/90" />
        <div className="h-14 rounded-lg bg-slate-900/70" />
        <div className="h-14 rounded-lg bg-slate-900/50" />
      </div>
      <div className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
    </div>
  );
}
