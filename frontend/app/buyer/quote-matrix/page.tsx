'use client';

import React, { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import QuoteMatrix from '@/app/buyer/quote-matrix';
import { QuoteMatrixErrorBoundary } from '@/app/components/QuoteMatrixErrorBoundary';

function BuyerQuoteMatrixView() {
  const router = useRouter();
  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/buyer/dashboard');
    }
  };
  return (
    <QuoteMatrixErrorBoundary onBack={handleBack}>
      <QuoteMatrix onBackToDashboard={handleBack} scopeToOwnBuyerAccount />
    </QuoteMatrixErrorBoundary>
  );
}

export default function BuyerQuoteMatrixPage() {
  return (
    <Suspense fallback={null}>
      <BuyerQuoteMatrixView />
    </Suspense>
  );
}
