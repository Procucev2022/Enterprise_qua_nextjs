'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BuyerCommandCenterRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/buyer/dashboard');
  }, [router]);

  return null;
}

