'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { fetchRFQById } from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { useApp } from '@/lib/store';
import RFQDetails from '@/app/buyer/rfq-details';
import type { RFQItem } from '@/lib/types';

const DETAILS = UI_STRINGS.rfqDetails;

/** Query parameter carrying the RFQ number to display. */
const RFQ_PARAM = 'rfq';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; rfq: RFQItem }
  | { status: 'error'; message: string; canRetry: boolean };

function StatusPanel({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl mx-auto py-16 px-4 text-center space-y-3">
      <div className="flex justify-center text-slate-400 dark:text-gray-500">{icon}</div>
      <h1 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h1>
      <p className="text-sm text-slate-500 dark:text-gray-400">{message}</p>
      {action}
    </div>
  );
}

/**
 * Vendor read-only view of one RFQ, reached from the Bid Quotes ("View
 * Details") action.
 *
 * Renders the same detail component the buyer and category manager see, with
 * no edit/delete affordances — a vendor is never the owner of an RFQ. The RFQ
 * is fetched by number through `GET /api/rfqs/:id`, which for the vendor role
 * is scoped server-side by `canAccessRfq`/`vendorCoversRFQ` (only RFQs the
 * vendor was directly added for, or was invited to by a category manager) —
 * the same 404-for-out-of-scope behaviour as the buyer/CM routes, so this
 * page cannot be used to browse another vendor's RFQs.
 *
 * The RFQ record itself still carries every vendor's quote (the buyer/CM need
 * that), so before handing it to the shared RFQDetails component the quotes
 * list is narrowed to this vendor's own submission only — otherwise a vendor
 * would see every competitor's price, lead time and terms on the same RFQ.
 *
 * Addressable by RFQ number so the page survives a reload and can be linked to.
 */
function VendorRFQDetailsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rfqNumber = searchParams.get(RFQ_PARAM);
  const { currentUserSession } = useApp();

  const [state, setState] = useState<LoadState>({ status: 'idle' });

  const load = useCallback(
    async (identifier: string) => {
      setState({ status: 'loading' });
      const result = await fetchRFQById(identifier);
      if (!result.success) {
        setState({
          status: 'error',
          message: result.error,
          canRetry: result.reason !== 'NOT_FOUND',
        });
        return;
      }

      let myVendorId: string | null = null;
      const email = currentUserSession?.email;
      if (email) {
        try {
          const res = await fetch(`/api/vendors/${encodeURIComponent(email)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.data) myVendorId = data.data.id;
          }
        } catch {
          // No vendor record resolved: fall through and show zero quotes
          // rather than every vendor's, which is the safe default.
        }
      }

      const scopedRfq: RFQItem = {
        ...result.rfq,
        quotes: (result.rfq.quotes || []).filter((quote) => quote.vendorId === myVendorId),
      };
      setState({ status: 'loaded', rfq: scopedRfq });
    },
    [currentUserSession?.email]
  );

  useEffect(() => {
    if (!rfqNumber) {
      setState({ status: 'idle' });
      return;
    }
    void load(rfqNumber);
  }, [rfqNumber, load]);

  const onBack = () => router.push('/vendor/quotation-form');

  if (!rfqNumber) {
    return (
      <StatusPanel
        icon={<AlertCircle size={28} />}
        title={DETAILS.missingReferenceTitle}
        message={DETAILS.missingReferenceMessage}
        action={
          <button onClick={onBack} className="btn btn-secondary btn-sm font-bold">
            {DETAILS.backAction}
          </button>
        }
      />
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <StatusPanel
        icon={<Loader2 size={28} className="animate-spin" />}
        title={DETAILS.loadingTitle}
        message={DETAILS.loadingMessage}
      />
    );
  }

  if (state.status === 'error') {
    return (
      <StatusPanel
        icon={<AlertCircle size={28} className="text-rose-500" />}
        title={state.canRetry ? DETAILS.loadFailedTitle : DETAILS.notFoundTitle}
        message={state.message}
        action={
          <div className="flex items-center justify-center gap-2">
            {state.canRetry && (
              <button
                onClick={() => void load(rfqNumber)}
                className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5"
              >
                <RefreshCw size={13} /> {DETAILS.retryAction}
              </button>
            )}
            <button onClick={onBack} className="btn btn-secondary btn-sm font-bold">
              {DETAILS.backAction}
            </button>
          </div>
        }
      />
    );
  }

  return <RFQDetails rfq={state.rfq} onBack={onBack} />;
}

export default function VendorRFQDetailsPage() {
  // useSearchParams suspends during prerender, so the boundary is required for
  // `next build` to statically render this route.
  return (
    <Suspense fallback={null}>
      <VendorRFQDetailsView />
    </Suspense>
  );
}
