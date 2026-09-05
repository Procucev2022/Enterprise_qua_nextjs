'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import QuoteMatrix from '@/app/buyer/quote-matrix';

export default function CategoryManagerQuoteMatrixPage() {
  const router = useRouter();
  return <QuoteMatrix onBackToDashboard={() => router.push('/category-manager/kanban-board')} />;
}
