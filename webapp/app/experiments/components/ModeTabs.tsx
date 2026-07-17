'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Map, UserRound } from 'lucide-react';
import { focusRing } from '../styles/tokens';

const tabs = [
  { href: '/experiments', label: 'Overview', icon: Activity },
  { href: '/experiments/rider', label: 'Rider', icon: UserRound },
  { href: '/experiments/operator', label: 'Operator', icon: Map }
];

export function ModeTabs() {
  const pathname = usePathname();

  return (
    <nav className="grid grid-cols-3 rounded-lg border border-[#263241] bg-[#0B1220] p-1">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-black transition ${focusRing} ${
              active
                ? 'bg-[#00A7B5] text-[#031316] shadow-lg shadow-[#00A7B5]/20'
                : 'text-slate-300 hover:bg-[#111827] hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

