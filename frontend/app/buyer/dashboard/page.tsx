'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import CommandCenter from '@/app/buyer/command-center';

export default function BuyerDashboardPage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <CommandCenter
      onNavigateToWizard={() => router.push('/buyer/ingestion-wizard')}
      onNavigateToMatrix={(rfq?: RFQItem) => {
        if (rfq) setSelectedRFQForMatrix(rfq);
        router.push('/buyer/quote-matrix');
      }}
      onNavigateToSubscription={() => router.push('/buyer/subscription-center')}
      onNavigateToDirectory={() => router.push('/buyer/buyer-directory')}
    />
  );
}
