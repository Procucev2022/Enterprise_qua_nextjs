'use client';

import React, { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import QuoteMatrix from '@/app/buyer/quote-matrix';

function BuyerQuoteMatrixView() {
  const router = useRouter();
  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/buyer/dashboard');
    }
  };
  return <QuoteMatrix onBackToDashboard={handleBack} scopeToOwnBuyerAccount />;
}

export default function BuyerQuoteMatrixPage() {
  return (
    <Suspense fallback={null}>
      <BuyerQuoteMatrixView />
    </Suspense>
  );
}
