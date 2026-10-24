'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginBuyerRfqsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const rfq = searchParams?.get('rfq');
    if (rfq) {
      router.replace(`/login?redirect=${encodeURIComponent(`/buyer/rfq-details?rfq=${rfq}`)}`);
    } else {
      router.replace('/login?redirect=/buyer/rfq-summary');
    }
  }, [router, searchParams]);

  return null;
}

export default function LoginBuyerRfqsPage() {
  return (
    <Suspense fallback={null}>
      <LoginBuyerRfqsRedirect />
    </Suspense>
  );
}
