'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/lib/store';
import RFQDetails from '@/app/buyer/rfq-details';

/** Query parameter carrying the RFQ number to display. */
const RFQ_PARAM = 'rfq';

/**
 * Resolves the RFQ from the number in the URL rather than from store state.
 *
 * The alternative — stashing the selected RFQ in the store before navigating, as
 * the quote matrix does — loses the selection on reload and cannot be linked to
 * or shared. Reading it from the query string keeps the page addressable.
 */
function BuyerRFQDetailsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { rfqs } = useApp();

  const rfqNumber = searchParams.get(RFQ_PARAM);
  const rfq = rfqNumber ? rfqs.find((r) => r.rfqNumber === rfqNumber) || null : null;

  return <RFQDetails rfq={rfq} onBack={() => router.push('/buyer/rfq-summary')} />;
}

export default function BuyerRFQDetailsPage() {
  // useSearchParams suspends during prerender, so the boundary is required for
  // `next build` to statically render this route.
  return (
    <Suspense fallback={null}>
      <BuyerRFQDetailsView />
    </Suspense>
  );
}
