'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { VendorEvaluationRecord } from '@/lib/types';
import VendorSummary from '@/app/buyer/vendor-summary';

export default function BuyerVendorSummaryPage() {
  const router = useRouter();
  const { setActiveEvaluationRecord, setInitialSetupModalOpen } = useApp();

  return (
    <VendorSummary
      onViewEvaluation={(record: VendorEvaluationRecord) => {
        setActiveEvaluationRecord(record);
        router.push('/buyer/vendor-evaluation-summary');
      }}
      onNavigateToWizard={() => setInitialSetupModalOpen(true)}
    />
  );
}
