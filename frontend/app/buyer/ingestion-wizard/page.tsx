'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import IngestionWizard from '@/app/buyer/ingestion-wizard';

export default function BuyerIngestionWizardPage() {
  const router = useRouter();
  const backToCommandCenter = () => router.push('/buyer/command-center');

  return <IngestionWizard onComplete={backToCommandCenter} onCancel={backToCommandCenter} />;
}
