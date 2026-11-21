'use client';

import React, { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import QuoteMatrix from '@/app/buyer/quote-matrix';

function CategoryManagerQuoteMatrixView() {
  const router = useRouter();
  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/category-manager/all-rfqs');
    }
  };
  return <QuoteMatrix onBackToDashboard={handleBack} />;
}

export default function CategoryManagerQuoteMatrixPage() {
  return (
    <Suspense fallback={null}>
      <CategoryManagerQuoteMatrixView />
    </Suspense>
  );
}

