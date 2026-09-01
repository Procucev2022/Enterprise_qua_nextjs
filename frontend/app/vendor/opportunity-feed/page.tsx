'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { VendorOpportunity } from '@/lib/types';
import OpportunityFeed from '@/app/vendor/opportunity-feed';

export default function VendorOpportunityFeedPage() {
  const router = useRouter();
  const { setSelectedVendorOpportunity } = useApp();

  return (
    <OpportunityFeed
      onNavigateToBidForm={(opp: VendorOpportunity) => {
        setSelectedVendorOpportunity(opp);
        router.push('/vendor/quotation-form');
      }}
      onNavigateToEvaluation={() => router.push('/vendor/qualification-form')}
      onNavigateToSubscription={() => router.push('/vendor/vendor-subscription')}
    />
  );
}
