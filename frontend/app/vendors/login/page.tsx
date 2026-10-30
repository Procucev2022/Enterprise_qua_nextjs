'use client';

import React, { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isVendorDirectoryAuthenticated } from '@/lib/vendorAuthClient';
import VendorDirectoryLoginGate from '../VendorDirectoryLoginGate';

export default function VendorDirectoryLoginPage() {
  const router = useRouter();

  const handleAuthenticated = useCallback(() => {
    router.replace('/vendors');
  }, [router]);

  useEffect(() => {
    if (isVendorDirectoryAuthenticated()) {
      handleAuthenticated();
    }
  }, [handleAuthenticated]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center">
      <VendorDirectoryLoginGate onAuthenticated={handleAuthenticated} />
    </div>
  );
}
