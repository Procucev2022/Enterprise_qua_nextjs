'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import QuoteMatrix from '@/app/buyer/quote-matrix';

export default function BuyerQuoteMatrixPage() {
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
