'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import IngestionWizard from '@/app/buyer/ingestion-wizard';

export default function BuyerIngestionWizardPage() {
  const router = useRouter();
  const backToDashboard = () => router.push('/buyer/dashboard');

  return <IngestionWizard onComplete={backToDashboard} onCancel={backToDashboard} />;
}
