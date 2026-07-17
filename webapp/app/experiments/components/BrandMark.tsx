import Link from 'next/link';
import { RadioTower } from 'lucide-react';

export function BrandMark() {
  return (
    <Link href="/experiments" className="group flex min-w-0 items-center gap-3">
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#263241] bg-[#111827] shadow-lg shadow-black/30">
        <RadioTower className="h-5 w-5 text-[#00A7B5]" />
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-[#05070A] bg-[#10B981]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-black uppercase tracking-[0.22em] text-[#00A7B5]">SmartWheel</span>
        <span className="block truncate text-lg font-black tracking-tight text-slate-50 group-hover:text-white sm:text-xl">
          Pulse
        </span>
      </span>
    </Link>
  );
}

