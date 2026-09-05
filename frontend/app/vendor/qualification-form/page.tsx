'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import VendorQualificationForm from '@/app/vendor/qualification-form';

export default function VendorQualificationFormPage() {
  const router = useRouter();
  const backToFeed = () => router.push('/vendor/opportunity-feed');
  return <VendorQualificationForm onBack={backToFeed} onSuccess={backToFeed} />;
}
