'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import SellersDirectory from '@/app/category-manager/sellers-directory';

export default function CategoryManagerSellersDirectoryPage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <SellersDirectory
      onSelectRFQ={(rfq: RFQItem) => {
        setSelectedRFQForMatrix(rfq);
        router.push(rfq?.rfqNumber ? `/category-manager/quote-matrix?rfq=${encodeURIComponent(rfq.rfqNumber)}` : '/category-manager/quote-matrix');
      }}
    />
  );
}
