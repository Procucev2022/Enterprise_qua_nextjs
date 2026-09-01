'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import VendorEvaluationSummary from '@/app/buyer/vendor-evaluation-summary';

export default function CategoryManagerEvaluationSummaryPage() {
  const router = useRouter();
  return <VendorEvaluationSummary onBack={() => router.push('/category-manager/kanban-board')} />;
}
