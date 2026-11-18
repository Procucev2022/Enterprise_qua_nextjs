'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { isBuyerUploadedVendor } from '@/lib/constants';
import type { VendorEvaluationRecord } from '@/lib/types';
import VendorSummary from '@/app/buyer/vendor-summary';

export default function BuyerVendorSummaryPage() {
  const router = useRouter();
  const {
    setActiveEvaluationRecord,
    setInitialSetupModalOpen,
    initialSetupCompleted,
    currentUserSession,
    activeBuyerAccount,
    buyerVendors,
  } = useApp();

  const hasCompletedInitialUpload = Boolean(
    initialSetupCompleted ||
    currentUserSession?.vendorMasterUploaded === true ||
    activeBuyerAccount?.initialSetupCompleted === true ||
    (Array.isArray(buyerVendors) && buyerVendors.some((v) => isBuyerUploadedVendor(v)))
  );

  return (
    <VendorSummary
      onViewEvaluation={(record: VendorEvaluationRecord) => {
        setActiveEvaluationRecord(record);
        router.push('/buyer/vendor-evaluation-summary');
      }}
      onNavigateToWizard={hasCompletedInitialUpload ? undefined : () => setInitialSetupModalOpen(true)}
    />
  );
}
