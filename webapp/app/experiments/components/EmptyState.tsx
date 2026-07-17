import { CircleDashed } from 'lucide-react';

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#334155] bg-[#0B1220] p-5 text-center">
      <CircleDashed className="mx-auto h-6 w-6 text-slate-500" />
      <div className="mt-3 text-sm font-black text-slate-200">{title}</div>
      {detail && <div className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">{detail}</div>}
    </div>
  );
}

