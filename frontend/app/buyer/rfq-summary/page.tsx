'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import RFQSummary from '@/app/buyer/rfq-summary';
import type { RFQItem } from '@/lib/types';

export default function BuyerRFQSummaryPage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <RFQSummary
      onViewQuotes={(rfq: RFQItem) => {
        // The matrix reads the selected RFQ from the store, so it is set before
        // navigating to keep the deep view reload-safe within the session.
        setSelectedRFQForMatrix(rfq);
        router.push('/buyer/quote-matrix');
      }}
      onCreateRFQ={() => router.push('/buyer/ingestion-wizard')}
    />
  );
}
