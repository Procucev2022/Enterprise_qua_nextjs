'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import VendorConsole from '@/app/category-manager/vendor-console';

export default function CategoryManagerVendorConsolePage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <VendorConsole
      onNavigateToMatrix={(rfq?: RFQItem) => {
        if (rfq) setSelectedRFQForMatrix(rfq);
        router.push('/category-manager/quote-matrix');
      }}
    />
  );
}
