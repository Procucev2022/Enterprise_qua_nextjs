'use client';

import React from 'react';
import { Building2 } from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';

const S = UI_STRINGS.publicVendorDirectory;

interface VendorEmptyStateProps {
  onClear: () => void;
}

export default function VendorEmptyState({ onClear }: VendorEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <Building2 size={28} className="text-slate-400 dark:text-slate-500" />
      </div>
      <div>
        <p className="font-semibold text-slate-600 dark:text-slate-300 text-base">
          {S.noVendorsFound}
        </p>
        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
          {S.noVendorsFoundSubtitle}
        </p>
      </div>
      <button
        id="vendor-directory-clear-filters"
        onClick={onClear}
        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
      >
        {S.clearFilters}
      </button>
    </div>
  );
}
