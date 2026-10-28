'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function BuyerRfqsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const rfq = searchParams?.get('rfq');
    if (rfq) {
      router.replace(`/buyer/rfq-details?rfq=${encodeURIComponent(rfq)}`);
    } else {
      router.replace('/buyer/rfq-summary');
    }
  }, [router, searchParams]);

  return null;
}

export default function BuyerRfqsPage() {
  return (
    <Suspense fallback={null}>
      <BuyerRfqsRedirect />
    </Suspense>
  );
}
