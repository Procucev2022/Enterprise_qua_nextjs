'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export default function Footer() {
  const pathname = usePathname();

  // The login page has its own dedicated integrated bottom banner and must fit on a single screen
  if (pathname === '/login') {
    return null;
  }

  return (
    <footer className="w-full bg-white dark:bg-[#0b0f19] border-t border-slate-200 dark:border-slate-800 py-2.5 text-[11px] text-slate-600 dark:text-slate-400">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-10 xl:px-16 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          <span className="font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">
            Procucev Enterprise Solutions Private Limited
          </span>{' '}
          <span className="text-slate-400 mx-1">•</span>{' '}
          <span>Enterprise QUA AI Production Release 2.0</span>
        </div>
      </div>
    </footer>
  );
}
