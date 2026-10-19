'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import BuyersDirectory from '@/app/category-manager/buyers-directory';

export default function CategoryManagerBuyersDirectoryPage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <BuyersDirectory
      onSelectRFQ={(rfq: RFQItem) => {
        setSelectedRFQForMatrix(rfq);
        router.push('/category-manager/quote-matrix');
      }}
    />
  );
}
