'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { rfqAttachmentUrl, submitRFQInquiry } from '@/lib/rfqClient';
import { VendorOpportunity } from '@/lib/types';
import {
  ArrowLeft,
  Mail,
  Building,
  Building2,
  FileText,
  Info,
  Phone,
  User,
  ShieldCheck,
  CheckCircle2,
  Lock,
  X,
  Copy,
  IndianRupee,
  Send,
  Download,
  AlertCircle,
  MessageSquare,
  HelpCircle,
} from 'lucide-react';

interface QuotationFormProps {
  opportunity?: VendorOpportunity;
  onBack: () => void;
  onSubmitSuccess?: () => void;
}

interface BuyerContactInfo {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  source: 'buyer_uploaded' | 'quote_submitted';
}

const BUYER_CONTACTS_MAP: Record<string, Omit<BuyerContactInfo, 'source'>> = {
  'RFQ-2026-00421': {
    companyName: 'Larsen & Toubro Ltd. (L&T)',
    contactPerson: 'Rajesh Sharma (Lead Procurement)',
    email: 'client@procucev.com',
    phone: '+91 98201 44520',
  },
  'RFQ-2026-00420': {
    companyName: 'Reliance Industries Ltd. (RIL)',
    contactPerson: 'Sunil Mehta (Senior Sourcing Manager)',
    email: 's.mehta@ril.com',
    phone: '+91 98112 33490',
  },
  'RFQ-2026-00415': {
    companyName: 'Tata Steel Procurement',
    contactPerson: 'Anand Verma (Procurement Lead)',
    email: 'a.verma@tatasteel.com',
    phone: '+91 98450 11200',
  },
  'RFQ-2026-00418': {
    companyName: 'Larsen & Toubro Ltd. (L&T)',
    contactPerson: 'Rajesh Sharma (Lead Procurement)',
    email: 'client@procucev.com',
    phone: '+91 98201 44520',
  },
};

export default function QuotationForm({ opportunity, onBack, onSubmitSuccess }: QuotationFormProps) {
  const router = useRouter();
  const { rfqs, vendorOpportunities, buyerVendors, showToast, addAuditLog, vendorSubscription, currentUserSession, refreshFromDB, adoptCreatedRFQ } = useApp();
  const [selectedBuyerModal, setSelectedBuyerModal] = useState<(BuyerContactInfo & { rfqNumber: string }) | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // This vendor's own backend record id — needed to tell "my submitted quote"
  // apart from any other vendor's quote on the same RFQ, and to submit/download
  // as the real authenticated identity rather than a hardcoded fake vendor.
  const [myVendorId, setMyVendorId] = useState<string | null>(null);
  const [myVendorName, setMyVendorName] = useState<string>('');
  const [myAddedByBuyerCompany, setMyAddedByBuyerCompany] = useState<string | null>(null);
  const [freeCreditsRemaining, setFreeCreditsRemaining] = useState<number | null>(null);
  const myVendorRecord = buyerVendors?.find(
    (v) => v.email?.toLowerCase() === currentUserSession?.email?.toLowerCase()
  );
  const effectiveFreeCredits = freeCreditsRemaining ?? myVendorRecord?.freeQuotationCredits ?? (vendorSubscription === 'premium' ? 5 : 0);
  // isOwnBuyerRfq depends on myAddedByBuyerCompany, which only exists once
  // this fetch resolves — the deep-link auto-open effect below waits on this
  // flag so it doesn't judge a real direct-buyer RFQ as locked just because
  // the vendor record hadn't loaded yet.
  const [myVendorRecordLoaded, setMyVendorRecordLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadMyVendorRecord() {
      const email = currentUserSession?.email;
      if (!email) {
        setMyVendorRecordLoaded(true);
        return;
      }
      // Session arrived after an earlier no-session pass already flipped this
      // true — reset it so the flag's true->false->true transition still
      // fires the deep-link effect once the real fetch below resolves.
      setMyVendorRecordLoaded(false);
      try {
        // Unauthenticated (no Authorization header) requests to this endpoint
        // only ever resolve vendors with no buyerId/buyerAccountId at all —
        // any buyer-uploaded vendor (this.vendors entries with a buyerId set)
        // requires a resolved scope to be returned. Omitting the token here
        // meant myVendorId never resolved for a buyer-uploaded vendor, so
        // "my submitted quotes" (filtered by q.vendorId === myVendorId)
        // always came back empty for them — a real quote existed server-side
        // under the real vendor id, but the dashboard showed "0 Sent".
        const res = await fetch(`/api/vendors/${encodeURIComponent(email)}`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success && data.data) {
          setMyVendorId(data.data.id);
          setMyVendorName(data.data.name);
          setMyAddedByBuyerCompany(data.data.addedByBuyerCompany || null);
          if (data.data.freeQuotationCredits !== undefined) {
            setFreeCreditsRemaining(Number(data.data.freeQuotationCredits));
          }
        }
      } catch {
        // Leave myVendorId null — bidding/download actions will surface a
        // clear error rather than silently attributing them to nobody.
      } finally {
        if (!cancelled) setMyVendorRecordLoaded(true);
      }
    }
    loadMyVendorRecord();
    return () => {
      cancelled = true;
    };
  }, [currentUserSession?.email]);

  const authHeaders = (): Record<string, string> => {
    const token = authClient.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // Helper to map RFQs to Parent Companies
  const getParentCompany = (buyerName: string) => buyerName;

  // This vendor's real submitted quotes, read back from the actual RFQ
  // records (rfq.quotes[]) instead of a hardcoded 2-row placeholder list.
  const submittedQuotes = rfqs
    .filter((rfq) => (rfq.quotes || []).some((q) => q.vendorId === myVendorId))
    .map((rfq) => {
      const myQuote: any = (rfq.quotes || []).find((q: any) => q.vendorId === myVendorId);
      return {
        rfqNumber: rfq.rfqNumber,
        title: rfq.title,
        submittedDate: myQuote?.submittedAt ? new Date(myQuote.submittedAt).toLocaleString() : '-',
        status: rfq.status === 'PO Generated' ? 'PO Generated' : 'Quote Submitted',
        submissionMethod: 'Portal Submission',
      };
    });

  // Was a hardcoded list of 4 specific RFQ numbers standing in for "this
  // vendor's own buyer roster" — direct-vs-marketplace now reflects the real
  // relationship: this vendor's real addedByBuyerCompany against the RFQ's
  // real buyer (same real fields opportunity-feed.tsx and the backend's own
  // quota enforcement in GET /api/rfqs/:id/email-preview check).
  const isOwnBuyerRfq = (rfqNumber: string) => {
    if (!myAddedByBuyerCompany) return false;
    const rfq = vendorOpportunities.find((o) => o.rfqNumber === rfqNumber);
    return !!rfq && rfq.buyer === myAddedByBuyerCompany;
  };

  // Compile RFQ Bidding summaries
  const totalReceivedCount = vendorOpportunities.length;
  const totalSubmittedCount = submittedQuotes.length;

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    showToast('Copied to Clipboard', `${label} copied: ${text}`, 'info');
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ─── Real quote/bid submission ─────────────────────────────────────────
  const [biddingOn, setBiddingOn] = useState<VendorOpportunity | null>(null);
  const [bidUnitPrice, setBidUnitPrice] = useState('');
  // One unit price per RFQ line item, keyed by line item id — only rendered
  // (and only required) when the RFQ has more than one line item. For the
  // common single-item case the form stays exactly as it was: just
  // bidUnitPrice above.
  const [bidLineItemPrices, setBidLineItemPrices] = useState<Record<string, string>>({});
  const [bidLeadTimeDays, setBidLeadTimeDays] = useState('');
  const [bidWarrantyYears, setBidWarrantyYears] = useState('');
  const [bidPaymentTerms, setBidPaymentTerms] = useState('45 Days Net');
  const [bidRemarks, setBidRemarks] = useState('');
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);
  const [submitModalError, setSubmitModalError] = useState<string | null>(null);
  const [submitModalSuccess, setSubmitModalSuccess] = useState<{
    rfqNumber: string;
    totalPrice: number;
    unitPrice: number;
    leadTimeDays: number;
    buyerRevealed?: BuyerContactInfo | null;
  } | null>(null);

  // ─── Inquiry / Clarification modal ──────────────────────────────────────
  const [inquiryModal, setInquiryModal] = useState<VendorOpportunity | null>(null);
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [isInquiring, setIsInquiring] = useState(false);
  const [inquirySuccess, setInquirySuccess] = useState(false);

  const openBidForm = (opp: VendorOpportunity) => {
    setBiddingOn(opp);
    setBidUnitPrice('');
    setBidLineItemPrices({});
    setBidLeadTimeDays('');
    setBidWarrantyYears('');
    setBidPaymentTerms('45 Days Net');
    setBidRemarks('');
    setSubmitModalError(null);
    setSubmitModalSuccess(null);
  };

  const openInquiryModal = (opp: VendorOpportunity) => {
    setInquiryModal(opp);
    setInquiryMessage('');
    setInquirySuccess(false);
  };

  const handleSendInquiry = async () => {
    if (!inquiryModal || !inquiryMessage.trim()) return;
    setIsInquiring(true);
    try {
      const vendorName = myVendorName || currentUserSession?.name || 'Vendor Partner';
      const vendorEmail = currentUserSession?.email || null;

      const res = await submitRFQInquiry(inquiryModal.id || inquiryModal.rfqNumber, {
        message: inquiryMessage.trim(),
        vendorName,
        vendorEmail,
      });

      addAuditLog(
        `Inquiry / Clarification submitted by ${vendorName} on ${inquiryModal.rfqNumber}: "${inquiryMessage.trim().slice(0, 100)}..."`,
        inquiryModal.rfqNumber,
        vendorEmail || undefined
      );

      if (res.success && res.rfq) {
        adoptCreatedRFQ(res.rfq);
      }

      setInquiryMessage('');
      await refreshFromDB();
      showToast('Clarification Sent', 'Your query has been dispatched to the procurement officer.', 'success');
    } catch (err: any) {
      showToast('Inquiry Failed', err?.message || 'Could not dispatch clarification.', 'warning');
    } finally {
      setIsInquiring(false);
    }
  };

  // Landing here via "Submit Quote Now" (opportunity-feed's reminder banner)
  // passes the specific RFQ as `opportunity` — previously that prop was
  // received but never used, so the navigation just dropped the vendor on
  // the same undifferentiated table regardless of which RFQ they clicked.
  // Auto-open the bid form for it once, if it's actually biddable.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!opportunity || autoOpenedRef.current) return;
    // isOwnBuyerRfq needs myAddedByBuyerCompany, which only exists once the
    // vendor-record fetch resolves — deciding "locked" before that would
    // wrongly treat a real direct-buyer RFQ as marketplace-locked.
    if (!myVendorRecordLoaded) return;
    // vendorOpportunities is hydrated by its own independent fetch
    // (refreshRFQs, in store.tsx) that races the vendor-record fetch above —
    // isOwnBuyerRfq looks the RFQ up in that list, so deciding before it has
    // loaded would wrongly treat a real direct-buyer RFQ as locked forever
    // (autoOpenedRef below only ever fires once). The deep-linked RFQ is
    // always one that's actually in the feed, so waiting for the list to be
    // non-empty is a reliable "has loaded" signal here.
    if (vendorOpportunities.length === 0) return;
    autoOpenedRef.current = true;
    const alreadyQuoted = submittedQuotes.some((q) => q.rfqNumber === opportunity.rfqNumber);
    const locked = !isOwnBuyerRfq(opportunity.rfqNumber) && vendorSubscription !== 'connect' && vendorSubscription !== 'select';
    if (!alreadyQuoted && !locked) {
      openBidForm(opportunity);
    }
    // Intentionally not reacting to subsequent submittedQuotes/vendorSubscription
    // changes (which would otherwise re-open the modal right after a successful
    // submit) — autoOpenedRef ensures this only ever runs once, on the first
    // render after both the vendor record and the RFQ list have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myVendorRecordLoaded, vendorOpportunities.length]);

  const handleSubmitQuote = async () => {
    if (!biddingOn) return;
    setSubmitModalError(null);

    const rfqLineItems = biddingOn.lineItems || [];
    const isMultiItem = rfqLineItems.length > 1;

    // Multi-item RFQs price every line item individually; the single-item
    // case keeps today's one blanket-price field unchanged.
    let unitPrice: number;
    let totalPrice: number;
    let lineItemQuotes: Array<{
      lineItemId?: string;
      itemName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }> | undefined;

    if (isMultiItem) {
      const missing = rfqLineItems.some((li) => {
        const v = Number(bidLineItemPrices[li.id]);
        return !v || v <= 0;
      });
      if (missing) {
        setSubmitModalError('Please enter a valid unit price (greater than 0) for every line item.');
        showToast('Validation Error', 'Enter a unit price for every line item.', 'warning');
        return;
      }
      lineItemQuotes = rfqLineItems.map((li) => {
        const price = Number(bidLineItemPrices[li.id]);
        return {
          lineItemId: li.id,
          itemName: li.description,
          quantity: li.quantity,
          unitPrice: price,
          totalPrice: price * li.quantity,
        };
      });
      totalPrice = lineItemQuotes.reduce((sum, li) => sum + li.totalPrice, 0);
      const totalQty = rfqLineItems.reduce((sum, li) => sum + (li.quantity || 0), 0);
      unitPrice = totalQty > 0 ? totalPrice / totalQty : totalPrice;
    } else {
      unitPrice = Number(bidUnitPrice);
      if (!unitPrice || unitPrice <= 0) {
        setSubmitModalError('Please enter a valid unit price greater than 0.');
        showToast('Validation Error', 'Enter a valid unit price.', 'warning');
        return;
      }
      const quantity = rfqLineItems[0]?.quantity || 1;
      totalPrice = unitPrice * quantity;
    }

    setIsSubmittingQuote(true);
    try {
      const res = await fetch(`/api/rfqs/${encodeURIComponent(biddingOn.rfqNumber)}/quotes`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          unitPrice,
          totalPrice,
          ...(lineItemQuotes ? { lineItemQuotes } : {}),
          leadTimeDays: Number(bidLeadTimeDays) || 0,
          warrantyYears: Number(bidWarrantyYears) || 0,
          paymentTerms: bidPaymentTerms,
          remarks: bidRemarks,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const errorMsg = data.error || (data.upgradeRequired ? 'Your 5 free quotation credits have been used. Please upgrade your subscription plan to continue submitting quotations.' : 'Failed to submit quotation.');
        setSubmitModalError(errorMsg);
        if (data.upgradeRequired || res.status === 403) {
          showToast('Quotation Credits Exhausted', errorMsg, 'warning');
        } else {
          showToast('Submission Failed', errorMsg, 'warning');
        }
        return;
      }

      addAuditLog(
        `${myVendorName || currentUserSession?.name || 'Vendor'} submitted a quotation for ${biddingOn.rfqNumber} (Unit Price: ${unitPrice})`,
        biddingOn.rfqNumber,
        currentUserSession?.email
      );
      showToast('Quote Submitted', `Your quotation for ${biddingOn.rfqNumber} was submitted successfully.`, 'success');
      
      const isDirect = isOwnBuyerRfq(biddingOn.rfqNumber);
      const targetRfqNum = biddingOn.rfqNumber;
      const baseBuyer = BUYER_CONTACTS_MAP[biddingOn.rfqNumber] || {
        companyName: biddingOn.buyer,
        contactPerson: isDirect ? 'Rajesh Sharma (Lead Procurement)' : 'Strategic Procurement Lead',
        email: isDirect ? 'client@procucev.com' : `procurement@${(biddingOn.buyer || 'buyer').toLowerCase().replace(/[^a-z]/g, '')}.com`,
        phone: '+91 98201 44520',
      };
      const buyerDetails: BuyerContactInfo = {
        ...baseBuyer,
        source: isDirect ? 'buyer_uploaded' : 'quote_submitted',
      };
      setBiddingOn(null);
      setSelectedBuyerModal({ ...buyerDetails, rfqNumber: targetRfqNum });
      await refreshFromDB();
      if (onSubmitSuccess) onSubmitSuccess();
    } catch (err: any) {
      const msg = err?.message || 'Could not submit the quote. Please check your network and try again.';
      setSubmitModalError(msg);
      showToast('Submission Failed', msg, 'warning');
    } finally {
      setIsSubmittingQuote(false);
    }
  };

  // ─── Real RFQ document download ────────────────────────────────────────
  /** Saves a blob to disk via a throwaway object URL and anchor click. */
  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleDownloadRfq = async (opp: VendorOpportunity) => {
    try {
      const params = myVendorId ? `?vendorId=${encodeURIComponent(myVendorId)}` : '';
      // This route requires authentication (and, for a vendor, now enforces
      // their real download quota server-side) — the request was previously
      // sent with no Authorization header at all and would 401 for real.
      const res = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}/email-preview${params}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not generate the RFQ specification.');
      }

      // The RFQ text info (BOQ, deadline, budget etc.) as a real file, not
      // just a toast claiming an email was sent — a vendor without inbox
      // access to that address previously had no way to actually see it.
      const htmlBody: string = data.data?.htmlBody || '';
      triggerBlobDownload(new Blob([htmlBody], { type: 'text/html' }), `${opp.rfqNumber}-specification.html`);

      // Supporting documents the buyer attached. GET /api/rfqs/:id is scoped
      // server-side the same way as the details page (canAccessRfq /
      // vendorCoversRFQ), so this only ever returns attachments for an RFQ
      // this vendor can already see.
      try {
        const rfqRes = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}`, { headers: authHeaders() });
        const rfqData = await rfqRes.json();
        const attachments = rfqRes.ok && rfqData.success ? rfqData.data?.attachments || [] : [];
        for (const file of attachments) {
          const fileRes = await fetch(rfqAttachmentUrl(file.id), { headers: authHeaders() });
          if (!fileRes.ok) continue;
          const blob = await fileRes.blob();
          triggerBlobDownload(blob, file.fileName || `${opp.rfqNumber}-attachment`);
        }
      } catch {
        // The specification itself already downloaded; a failure fetching
        // attachments is surfaced by their absence, not a blocking error.
      }

      addAuditLog(
        `${myVendorName || currentUserSession?.name || 'Vendor'} downloaded RFQ specification for ${opp.rfqNumber}`,
        opp.rfqNumber,
        currentUserSession?.email
      );
      showToast('RFQ Downloaded', `RFQ specification for ${opp.rfqNumber} has been downloaded.`, 'success');
    } catch (err: any) {
      showToast('Download Failed', err?.message || 'Could not download the RFQ specification.', 'warning');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-10">
      {/* Title & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white mb-2 transition-colors font-medium"
          >
            <ArrowLeft size={14} /> Back to Opportunity Feed
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Sourcing Enquiries & Quotation Tracking
            </h1>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR SOURCING SUMMARY CARDS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-medium">
        <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 dark:text-gray-400 uppercase tracking-wider">RFQs Received (Active Enquiries)</div>
            <span className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{totalReceivedCount} Active</span>
          </div>
          <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            <Building size={16} />
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 dark:text-gray-400 uppercase tracking-wider">Quotations Submitted</div>
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 mono">{totalSubmittedCount} Sent</span>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <Mail size={16} />
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 dark:text-gray-400 uppercase tracking-wider">Quotation Credits</div>
            <span className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 mono">
              {vendorSubscription === 'connect' || vendorSubscription === 'select'
                ? 'Active Plan'
                : `${effectiveFreeCredits} Free Left`}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
            <ShieldCheck size={16} />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* CONSOLIDATED ACTIVE RFQS RECEIVED TABLE (ENQUIRIES & STATUS) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider flex items-center gap-2">
            <FileText size={14} className="text-indigo-600" />
            Active Sourcing Enquiries & Submitted Quotation Status
          </h3>
          <span className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center gap-1">
            <Info size={12} className="text-indigo-500" /> Click buyer icon to view contact details
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-gray-800 text-slate-400 uppercase tracking-wider text-[9px] font-bold">
                <th className="py-2">RFQ Number</th>
                <th className="py-2">Description / Title</th>
                <th className="py-2">Buyer Company</th>
                <th className="py-2 text-center">Deadline</th>
                <th className="py-2 text-center">Download RFQ</th>
                <th className="py-2">Submission Method</th>
                <th className="py-2">Submitted Time</th>
                <th className="py-2 text-right">Sourcing Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150/40 dark:divide-gray-850 text-[11px]">
              {vendorOpportunities.map((opp) => {
                const quote = submittedQuotes.find((q) => q.rfqNumber === opp.rfqNumber);
                const parentCompany = getParentCompany(opp.buyer);
                const isDirectBuyer = isOwnBuyerRfq(opp.rfqNumber);
                const freeCredits = effectiveFreeCredits;
                const isLocked = !isDirectBuyer && vendorSubscription !== 'connect' && vendorSubscription !== 'select' && freeCredits <= 0;
                
                // Condition: If buyer uploaded this vendor (isOwnBuyerRfq), show even before quote is submitted.
                // Otherwise, show only after quote is submitted and updated in the system (quote !== undefined || opp.status === 'submitted').
                const isUploadedByBuyer = isOwnBuyerRfq(opp.rfqNumber);
                const isQuoteSubmitted = !!quote || opp.status === 'submitted';
                const canViewBuyerDetails = isUploadedByBuyer || isQuoteSubmitted;

                const baseBuyerData = BUYER_CONTACTS_MAP[opp.rfqNumber] || {
                  companyName: parentCompany,
                  contactPerson: isUploadedByBuyer ? 'Rajesh Sharma (Lead Procurement)' : 'Strategic Procurement Lead',
                  email: isUploadedByBuyer ? 'client@procucev.com' : `procurement@${parentCompany.toLowerCase().replace(/[^a-z]/g, '')}.com`,
                  phone: '+91 98201 44520',
                };

                const buyerInfo: BuyerContactInfo = {
                  ...baseBuyerData,
                  source: isUploadedByBuyer ? 'buyer_uploaded' : 'quote_submitted',
                };

                return (
                  <tr key={opp.rfqNumber} className="hover:bg-slate-50/50 dark:hover:bg-gray-850/20">
                    {/* RFQ Number */}
                    <td className="py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {opp.rfqNumber}
                    </td>
                    
                    {/* Title */}
                    <td className="py-3 font-semibold text-slate-800 dark:text-gray-200">{opp.title}</td>
                    
                    {/* Buyer Company & Details Icon */}
                    <td className="py-3">
                      {canViewBuyerDetails ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-800 dark:text-gray-200">
                            {buyerInfo.companyName}
                          </span>
                          <button
                            onClick={() => setSelectedBuyerModal({ ...buyerInfo, rfqNumber: opp.rfqNumber })}
                            className="p-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 transition-all border border-indigo-200/50 dark:border-indigo-800/50 inline-flex items-center gap-0.5"
                            title={
                              isUploadedByBuyer 
                                ? 'Buyer Details (Client Uploaded Vendor)' 
                                : 'Buyer Details Unlocked (Quote Submitted)'
                            }
                          >
                            <Info size={12} className="text-indigo-600 dark:text-indigo-400" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500">
                          <span className="italic text-[10px]">Procucev Network Sourced</span>
                          <span
                            className="p-1 rounded-md bg-slate-100 dark:bg-gray-800 text-slate-400 cursor-help inline-flex items-center"
                            title="Buyer details will be revealed after quote is submitted and updated in the system."
                          >
                            <Lock size={11} />
                          </span>
                        </div>
                      )}
                    </td>
                    
                    {/* Deadline */}
                    <td className="py-3 text-center font-medium mono text-amber-600 dark:text-amber-400">{opp.deadline}</td>
                    
                    {/* Download RFQ */}
                    <td className="py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => router.push(`/vendor/rfq-details?rfq=${encodeURIComponent(opp.rfqNumber)}`)}
                          className="btn btn-secondary btn-xs py-1 px-2.5 flex items-center justify-center gap-1 text-[9px] font-bold border border-slate-200"
                          title="View RFQ Details"
                        >
                          <FileText size={11} className="text-indigo-655" />
                          <span>View Details</span>
                        </button>
                        <button
                          onClick={() => {
                            if (isLocked) {
                              showToast('Premium Locked', 'Please upgrade your subscription to download specifications for this external buyer.', 'warning');
                            } else {
                              handleDownloadRfq(opp);
                            }
                          }}
                          className="btn btn-secondary btn-xs py-1 px-2.5 flex items-center justify-center gap-1 text-[9px] font-bold border border-slate-200"
                          title="Download RFQ Specification"
                        >
                          <Download size={11} className="text-indigo-655" />
                          <span>Download RFQ</span>
                        </button>
                      </div>
                    </td>

                    {/* Submission Method */}
                    <td className="py-3">
                      {quote ? (
                        <span className="font-semibold text-slate-800 dark:text-gray-200">{quote.submissionMethod}</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    {/* Submitted Time */}
                    <td className="py-3">
                      {quote ? (
                        <span className="text-slate-500 font-medium">{quote.submittedDate}</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    
                    {/* Sourcing Status */}
                    <td className="py-3 text-right">
                      {quote ? (
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wide border inline-block ${
                          quote.status === 'PO Generated' 
                            ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200' 
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-250'
                        }`}>
                          {quote.status}
                        </span>
                      ) : (opp.status === 'Closed' || opp.status === 'Expired') ? (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-500 border border-slate-200 dark:border-gray-700">
                          🔒 RFQ Closed
                        </span>
                      ) : isLocked ? (
                        <span className="text-amber-500 font-bold text-[10px]">🔒 Premium Locked</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openInquiryModal(opp)}
                            className="btn btn-secondary btn-xs py-1 px-2 inline-flex items-center gap-1 text-[9px] font-semibold text-slate-600 dark:text-gray-300"
                            title="Ask a question or raise a clarification with the buyer"
                          >
                            <MessageSquare size={10} />
                            <span>Clarify</span>
                          </button>
                          <button
                            onClick={() => openBidForm(opp)}
                            className="btn btn-emerald btn-xs py-1 px-2.5 inline-flex items-center gap-1 text-[9px] font-bold"
                          >
                            <Send size={10} /> Submit Quote
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* INQUIRY / CLARIFICATION MODAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {inquiryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Raise Issue / Clarification</h3>
                  <span className="text-[10px] text-slate-400 mono">{inquiryModal.rfqNumber}</span>
                </div>
              </div>
              <button
                onClick={() => setInquiryModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {(() => {
                const rfqRecord = rfqs.find((r) => r.rfqNumber === inquiryModal.rfqNumber || r.id === inquiryModal.id);
                const rawInquiries = rfqRecord?.inquiries || [];
                const myInquiries = rawInquiries.filter(
                  (inq: any) =>
                    !inq.vendorEmail ||
                    !currentUserSession?.email ||
                    inq.vendorEmail.toLowerCase() === currentUserSession?.email.toLowerCase() ||
                    inq.vendorName === (myVendorName || currentUserSession?.name)
                );

                const messages = (myInquiries.length > 0 ? myInquiries : rawInquiries).flatMap((inq: any) => {
                  if (Array.isArray(inq.messages) && inq.messages.length > 0) {
                    return inq.messages;
                  }
                  return [
                    ...(inq.message
                      ? [
                          {
                            id: `msg-${inq.id}-vendor`,
                            senderRole: 'vendor' as const,
                            senderName: inq.vendorName || 'You',
                            message: inq.message,
                            timestamp: inq.createdAt || new Date().toISOString(),
                          },
                        ]
                      : []),
                    ...(inq.reply
                      ? [
                          {
                            id: `msg-${inq.id}-buyer`,
                            senderRole: 'buyer' as const,
                            senderName: inq.repliedBy || 'Buyer Procurement Team',
                            message: inq.reply,
                            timestamp: inq.repliedAt || inq.createdAt || new Date().toISOString(),
                          },
                        ]
                      : []),
                  ];
                }).sort((a: any, b: any) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

                return (
                  <div className="space-y-3">
                    <div className="space-y-2.5 max-h-64 overflow-y-auto p-3 rounded-xl bg-slate-50 dark:bg-gray-950/60 border border-slate-200 dark:border-gray-800">
                      {messages.length === 0 ? (
                        <div className="text-center py-4 space-y-1 text-slate-400">
                          <MessageSquare size={20} className="mx-auto opacity-50 text-blue-500" />
                          <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">No questions asked yet</p>
                          <p className="text-[10px]">Submit your first clarification below to start the direct thread with the buyer.</p>
                        </div>
                      ) : (
                        messages.map((msg: any, idx: number) => {
                          const isVendorMsg = msg.senderRole === 'vendor';
                          return (
                            <div
                              key={msg.id || idx}
                              className={`flex flex-col ${isVendorMsg ? 'items-end' : 'items-start'} space-y-1`}
                            >
                              <div className="flex items-center gap-1 text-[9px] text-slate-400 px-1">
                                <span className="font-bold text-slate-600 dark:text-gray-300">
                                  {isVendorMsg ? `${msg.senderName} (You)` : `${msg.senderName} (Buyer)`}
                                </span>
                                <span>•</span>
                                <span className="mono">
                                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently'}
                                </span>
                              </div>
                              <div
                                className={`p-2.5 rounded-xl text-xs leading-relaxed max-w-[85%] whitespace-pre-wrap break-words shadow-xs ${
                                  isVendorMsg
                                    ? 'bg-blue-600 text-white rounded-tr-xs'
                                    : 'bg-white dark:bg-gray-850 border border-slate-200 dark:border-gray-700 text-slate-900 dark:text-white rounded-tl-xs'
                                }`}
                              >
                                {msg.message}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Ask Question / Technical Clarification
                      </label>
                      <textarea
                        rows={2}
                        value={inquiryMessage}
                        onChange={(e) => setInquiryMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendInquiry();
                          }
                        }}
                        disabled={isInquiring}
                        placeholder="Type your question regarding specs, drawings, delivery, or terms... (Enter to send)"
                        className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-xs bg-white dark:bg-gray-950 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
                <button onClick={() => setInquiryModal(null)} className="btn btn-ghost btn-sm">
                  Close
                </button>
                <button
                  onClick={handleSendInquiry}
                  disabled={isInquiring || !inquiryMessage.trim()}
                  className="btn btn-primary btn-sm px-4 font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send size={12} />
                  <span>{isInquiring ? 'Sending...' : 'Send Clarification'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUYER CONTACT DETAILS MODAL (POPUP) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedBuyerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                    Buyer Contact Details
                  </h3>
                  <span className="text-[10px] text-slate-400 mono">{selectedBuyerModal.rfqNumber}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedBuyerModal(null)}
                title="Close Buyer Details Modal"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Access Badge */}
            <div>
              {selectedBuyerModal.source === 'buyer_uploaded' ? (
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-[11px] font-semibold">
                    Direct Client Roster: This buyer explicitly invited and uploaded your vendor profile.
                  </span>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/40 text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
                  <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="text-[11px] font-semibold">
                    Verified Reveal: Unlocked following official quotation submission and system ingestion.
                  </span>
                </div>
              )}
            </div>

            {/* Contact Details Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-850/60 border border-slate-200 dark:border-gray-800 space-y-3">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Buyer Enterprise</span>
                <div className="font-extrabold text-slate-900 dark:text-white text-xs mt-0.5 flex items-center justify-between">
                  <span>{selectedBuyerModal.companyName}</span>
                  <button
                    onClick={() => handleCopyText(selectedBuyerModal.companyName, 'Company Name')}
                    className="text-slate-400 hover:text-indigo-600 text-[10px] flex items-center gap-1 font-normal"
                    title="Copy Company Name"
                  >
                    <Copy size={11} /> {copiedField === 'Company Name' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Contact Person</span>
                <div className="font-bold text-slate-800 dark:text-gray-200 text-xs mt-0.5 flex items-center gap-1.5">
                  <User size={12} className="text-slate-400" />
                  <span>{selectedBuyerModal.contactPerson}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200/60 dark:border-gray-800">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Official Email</span>
                  <a
                    href={`mailto:${selectedBuyerModal.email}`}
                    className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 text-[11px] mt-0.5 truncate"
                  >
                    <Mail size={11} className="shrink-0" />
                    <span>{selectedBuyerModal.email}</span>
                  </a>
                </div>

                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Direct Mobile / Phone</span>
                  <a
                    href={`tel:${selectedBuyerModal.phone}`}
                    className="font-mono text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 text-[11px] mt-0.5"
                  >
                    <Phone size={11} className="shrink-0" />
                    <span>{selectedBuyerModal.phone}</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setSelectedBuyerModal(null);
                  if (onSubmitSuccess) onSubmitSuccess();
                }}
                className="btn btn-primary btn-sm px-4 text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BID / QUOTE SUBMISSION MODAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {biddingOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400">
                  <Send size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Submit Quotation</h3>
                  <span className="text-[10px] text-slate-400 mono">{biddingOn.rfqNumber} — {biddingOn.title}</span>
                </div>
              </div>
              <button
                onClick={() => !isSubmittingQuote && setBiddingOn(null)}
                title="Close"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Closed RFQ Check */}
            {(biddingOn.status === 'Closed' || biddingOn.status === 'Expired') && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <strong className="block text-xs font-bold">RFQ Bidding Concluded</strong>
                  <span className="text-[11px]">This RFQ has been closed or expired by the buyer. Quotations can no longer be submitted.</span>
                </div>
              </div>
            )}

                {/* Error Banner */}
                {submitModalError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span className="text-[11px] font-medium leading-relaxed">{submitModalError}</span>
                    </div>
                    {(submitModalError.toLowerCase().includes('credit') || submitModalError.toLowerCase().includes('upgrade')) && (
                      <div className="pt-1">
                        <a
                          href="/vendor/vendor-subscription"
                          className="btn btn-primary btn-xs font-bold inline-flex items-center gap-1 text-[10px]"
                        >
                          Upgrade Plan to Continue Quoting
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {(biddingOn.lineItems?.length || 0) > 1 ? (
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Unit Price (₹) per Line Item *
                      </label>
                      <div className="space-y-2">
                        {(biddingOn.lineItems || []).map((li) => (
                          <div key={li.id} className="flex items-center gap-2">
                            <span className="flex-1 text-[11px] text-slate-600 dark:text-gray-300 truncate" title={li.description}>
                              {li.description} <span className="text-slate-400">(Qty {li.quantity})</span>
                            </span>
                            <div className="relative w-28 shrink-0">
                              <IndianRupee size={11} className="absolute left-2.5 top-2 text-slate-400" />
                              <input
                                type="number"
                                min={0}
                                aria-label={`Unit price for ${li.description}`}
                                value={bidLineItemPrices[li.id] || ''}
                                onChange={(e) =>
                                  setBidLineItemPrices((prev) => ({ ...prev, [li.id]: e.target.value }))
                                }
                                disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                                placeholder="0"
                                className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-[11px] font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Unit Price (₹) *</label>
                      <div className="relative">
                        <IndianRupee size={12} className="absolute left-3 top-2.5 text-slate-400" />
                        <input
                          type="number"
                          min={0}
                          value={bidUnitPrice}
                          onChange={(e) => setBidUnitPrice(e.target.value)}
                          disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                          placeholder="e.g. 25000"
                          className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Lead Time (Days)</label>
                      <input
                        type="number"
                        min={0}
                        value={bidLeadTimeDays}
                        onChange={(e) => setBidLeadTimeDays(e.target.value)}
                        disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                        placeholder="e.g. 14"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Warranty (Years)</label>
                      <input
                        type="number"
                        min={0}
                        value={bidWarrantyYears}
                        onChange={(e) => setBidWarrantyYears(e.target.value)}
                        disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                        placeholder="e.g. 1"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Payment Terms</label>
                    <input
                      type="text"
                      value={bidPaymentTerms}
                      onChange={(e) => setBidPaymentTerms(e.target.value)}
                      disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                      placeholder="e.g. 45 Days Net, 100% Against Dispatch"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Remarks</label>
                    <textarea
                      value={bidRemarks}
                      onChange={(e) => setBidRemarks(e.target.value)}
                      disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                      rows={2}
                      placeholder="Special notes, inclusions, exclusions, or freight details..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white resize-none"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-gray-800">
                  <button onClick={() => setBiddingOn(null)} disabled={isSubmittingQuote} className="btn btn-ghost btn-sm">
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitQuote}
                    disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                    className="btn btn-primary btn-sm px-4 text-xs font-bold disabled:opacity-50"
                  >
                    <Send size={13} /> {isSubmittingQuote ? 'Submitting...' : 'Submit Quotation'}
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
    );
  }
