'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { ModeTabs } from './ModeTabs';
import { focusRing, surfaces } from '../styles/tokens';

export function ExperimentShell({ children }: { children: ReactNode }) {
  return (
    <div className={`min-h-screen ${surfaces.shell}`}>
      <div className="fixed inset-x-0 top-0 z-40 border-b border-[#263241] bg-[#05070A]/92 backdrop-blur-xl">
        <header className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-4">
            <BrandMark />
            <div className="lg:hidden">
              <ModeTabs />
            </div>
          </div>

          <div className="hidden lg:block">
            <ModeTabs />
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/rider"
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#263241] bg-[#0B1220] px-3 text-sm font-bold text-slate-300 transition hover:border-[#334155] hover:text-white ${focusRing}`}
            >
              Current Rider
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              href="/operator"
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#263241] bg-[#0B1220] px-3 text-sm font-bold text-slate-300 transition hover:border-[#334155] hover:text-white ${focusRing}`}
            >
              Current Operator
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </header>
      </div>

      <div className="pt-[150px] sm:pt-[132px] lg:pt-[76px]">
        {children}
      </div>
    </div>
  );
}

