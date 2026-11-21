'use client';

import React, { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import QuoteMatrix from '@/app/buyer/quote-matrix';
import { QuoteMatrixErrorBoundary } from '@/app/components/QuoteMatrixErrorBoundary';

function CategoryManagerQuoteMatrixView() {
  const router = useRouter();
  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/category-manager/all-rfqs');
    }
  };
  return (
    <QuoteMatrixErrorBoundary onBack={handleBack}>
      <QuoteMatrix onBackToDashboard={handleBack} />
    </QuoteMatrixErrorBoundary>
  );
}

export default function CategoryManagerQuoteMatrixPage() {
  return (
    <Suspense fallback={null}>
      <CategoryManagerQuoteMatrixView />
    </Suspense>
  );
}

