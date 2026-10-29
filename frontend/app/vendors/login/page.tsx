'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isVendorDirectoryAuthenticated } from '@/lib/vendorAuthClient';
import VendorDirectoryLoginGate from '../VendorDirectoryLoginGate';

export default function VendorDirectoryLoginPage() {
  const router = useRouter();

  useEffect(() => {
    if (isVendorDirectoryAuthenticated()) {
      router.replace('/vendors');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center">
      <VendorDirectoryLoginGate onAuthenticated={() => router.replace('/vendors')} />
    </div>
  );
}
