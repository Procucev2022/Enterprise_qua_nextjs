'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import QuotationForm from '@/app/vendor/quotation-form';

export default function VendorQuotationFormPage() {
  const router = useRouter();
  const { selectedVendorOpportunity, vendorOpportunities } = useApp();
  const backToFeed = () => router.push('/vendor/opportunity-feed');

  // Opened directly by URL without a selection: fall back to the first open
  // opportunity so the route is still usable after a refresh.
  const opportunity = selectedVendorOpportunity || vendorOpportunities[0];

  if (!opportunity) {
    return (
      <div className="p-6 text-xs text-slate-500 dark:text-gray-400">
        No open opportunity is available to quote on right now.
      </div>
    );
  }

  return <QuotationForm opportunity={opportunity} onBack={backToFeed} onSubmitSuccess={backToFeed} />;
}
