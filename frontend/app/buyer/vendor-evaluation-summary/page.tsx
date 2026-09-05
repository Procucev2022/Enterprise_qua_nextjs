'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import VendorEvaluationSummary from '@/app/buyer/vendor-evaluation-summary';

export default function BuyerVendorEvaluationSummaryPage() {
  const router = useRouter();
  const { activeEvaluationRecord, setActiveEvaluationRecord } = useApp();

  return (
    <VendorEvaluationSummary
      evaluationRecord={activeEvaluationRecord}
      onBack={() => {
        setActiveEvaluationRecord(null);
        router.push('/buyer/vendor-summary');
      }}
    />
  );
}
