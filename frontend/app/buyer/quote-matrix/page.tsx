'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import QuoteMatrix from '@/app/buyer/quote-matrix';

export default function BuyerQuoteMatrixPage() {
  const router = useRouter();
  return <QuoteMatrix onBackToDashboard={() => router.push('/buyer/command-center')} />;
}
