'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import BuyerConsole from '@/app/category-manager/buyer-console';

export default function CategoryManagerBuyerConsolePage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <BuyerConsole
      onNavigateToMatrix={(rfq?: RFQItem) => {
        if (rfq) setSelectedRFQForMatrix(rfq);
        router.push('/category-manager/quote-matrix');
      }}
      onNavigateToEvaluation={() => router.push('/category-manager/vendor-evaluation-summary')}
    />
  );
}
