'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/lib/store';
import QuotationForm from '@/app/vendor/quotation-form';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem, VendorOpportunity } from '@/lib/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The opportunity the quotation form shows for an RFQ that is not in the vendor feed.
 * It is built only from what the RFQ record carries. A value the record does not have
 * stays empty, so the screen shows a dash instead of a made-up figure. The bid-side
 * fields are placeholders that the quotation form does not display.
 */
function opportunityFromRfq(rfq: RFQItem): VendorOpportunity {
  const deadlineMs = Date.parse(rfq.targetDeliveryDate || '');
  return {
    id: `opp-${rfq.id}`,
    rfqNumber: rfq.rfqNumber,
    title: rfq.title,
    buyer: rfq.buyerAccountName || '',
    deadline: rfq.targetDeliveryDate || '',
    daysRemaining: Number.isFinite(deadlineMs) ? Math.ceil((deadlineMs - Date.now()) / MS_PER_DAY) : 0,
    type: rfq.sourcingMode === 'mode_3' ? 'network_marketplace' : 'direct_invitation',
    estimatedValue: rfq.budget > 0 ? `₹${rfq.budget.toLocaleString('en-IN')}` : undefined,
    deliveryLocation: rfq.deliveryLocation || '',
    status:
      rfq.status === 'Closed' || rfq.status === 'Expired'
        ? rfq.status
        : rfq.quotes && rfq.quotes.length > 0
        ? 'under_review'
        : 'pending_bid',
    majorCategory: rfq.category || '',
    minorCategory: rfq.extractedEntities?.[0]?.minorCategory || '',
    lineItems: (rfq.extractedEntities || []).map((ent, idx) => ({
      id: ent.id || `item-${idx}`,
      description: ent.itemName,
      quantity: ent.quantity,
      unitPrice: 0,
      leadTimeDays: 0,
      marketBandStatus: 'optimal',
      paymentTerms: '',
    })),
  };
}

function VendorQuotationFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetRfqParam = searchParams.get('rfq') || searchParams.get('id');
  const { vendorOpportunities, rfqs, refreshRFQs, ensureRFQs, isLoadingRFQs } = useApp();
  const backToFeed = () => router.push('/vendor/opportunity-feed');
  const backToBidQuotes = () => router.push('/vendor/quotation-form');

  const hasFetchedRef = React.useRef(false);
  React.useEffect(() => {
    if (!hasFetchedRef.current && vendorOpportunities.length === 0) {
      hasFetchedRef.current = true;
      if (typeof refreshRFQs === 'function') {
        void refreshRFQs();
      } else if (typeof ensureRFQs === 'function') {
        void ensureRFQs();
      }
    }
  }, [vendorOpportunities.length, refreshRFQs, ensureRFQs]);

  // Without an RFQ in the link, the page is the enquiry list and opens no bid form. The bid
  // form opens only for the RFQ the link names, so a vendor can never be put on another RFQ.
  if (!targetRfqParam) {
    return <QuotationForm onBack={backToFeed} onSubmitSuccess={backToBidQuotes} />;
  }

  let opportunity: VendorOpportunity | undefined = vendorOpportunities.find(
    (opp) => opp.rfqNumber === targetRfqParam || opp.id === targetRfqParam
  );
  if (!opportunity) {
    const matchedRfq = rfqs.find((r) => r.rfqNumber === targetRfqParam || r.id === targetRfqParam);
    if (matchedRfq) {
      opportunity = opportunityFromRfq(matchedRfq);
    }
  }

  if (opportunity) {
    return <QuotationForm opportunity={opportunity} onBack={backToFeed} onSubmitSuccess={backToBidQuotes} />;
  }

  // The list is only treated as complete once it has loaded. Until then the page shows a loading state.
  const listLoaded = !isLoadingRFQs && (hasFetchedRef.current || vendorOpportunities.length > 0 || rfqs.length > 0);
  if (!listLoaded) {
    return (
      <div className="p-6 text-xs text-slate-500 dark:text-gray-400">
        Loading quotation form...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 p-6 text-center">
      <h1 className="text-sm font-bold text-slate-900 dark:text-white">{UI_STRINGS.vendorWorkspace.rfqNotInEnquiriesTitle}</h1>
      <p className="text-xs text-slate-500 dark:text-gray-400">
        {formatString(UI_STRINGS.vendorWorkspace.rfqNotInEnquiriesMessage, { rfqNumber: targetRfqParam })}
      </p>
      <button type="button" onClick={backToBidQuotes} className="btn btn-secondary btn-sm font-bold">
        {UI_STRINGS.vendorWorkspace.viewAllEnquiriesAction}
      </button>
    </div>
  );
}

export default function VendorQuotationFormPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-xs text-slate-500 dark:text-gray-400">
          Loading quotation form...
        </div>
      }
    >
      <VendorQuotationFormContent />
    </Suspense>
  );
}
