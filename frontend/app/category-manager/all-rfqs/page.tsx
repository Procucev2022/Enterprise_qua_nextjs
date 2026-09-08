'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import AllRFQsConsole from '@/app/category-manager/all-rfqs';

export default function CategoryManagerAllRFQsPage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <AllRFQsConsole
      onNavigateToMatrix={(rfq: RFQItem) => {
        setSelectedRFQForMatrix(rfq);
        router.push('/category-manager/quote-matrix');
      }}
      onViewDetails={(rfq: RFQItem) => {
        // Addressable by RFQ number so the detail view survives a reload and can
        // be linked to, rather than depending on transient store state.
        router.push(`/category-manager/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`);
      }}
    />
  );
}
