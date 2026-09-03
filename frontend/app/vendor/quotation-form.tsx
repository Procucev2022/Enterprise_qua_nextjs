'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
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
  const { rfqs, vendorOpportunities, showToast, addAuditLog, vendorSubscription, currentUserSession, refreshFromDB } = useApp();
  const [selectedBuyerModal, setSelectedBuyerModal] = useState<(BuyerContactInfo & { rfqNumber: string }) | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // This vendor's own backend record id — needed to tell "my submitted quote"
  // apart from any other vendor's quote on the same RFQ, and to submit/download
  // as the real authenticated identity rather than a hardcoded fake vendor.
  const [myVendorId, setMyVendorId] = useState<string | null>(null);
  const [myVendorName, setMyVendorName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function loadMyVendorRecord() {
      const email = currentUserSession?.email;
      if (!email) return;
      try {
        const res = await fetch(`/api/vendors/${encodeURIComponent(email)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success && data.data) {
          setMyVendorId(data.data.id);
          setMyVendorName(data.data.name);
        }
      } catch {
        // Leave myVendorId null — bidding/download actions will surface a
        // clear error rather than silently attributing them to nobody.
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
        status: rfq.status === 'PO Generated' ? 'PO Generated' : 'Under Evaluation',
        submissionMethod: 'Portal Submission',
      };
    });

  // Rajesh Nair (L&T) uploaded Apex Supplies, so their RFQs are free to bid on.
  // Other buyer RFQs require premium vendor subscription.
  const isOwnBuyerRfq = (rfqNumber: string) => {
    return ['RFQ-2026-00421', 'RFQ-2026-00423', 'RFQ-2026-00425', 'RFQ-2026-00427'].includes(rfqNumber);
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
  const [bidLeadTimeDays, setBidLeadTimeDays] = useState('');
  const [bidWarrantyYears, setBidWarrantyYears] = useState('');
  const [bidPaymentTerms, setBidPaymentTerms] = useState('45 Days Net');
  const [bidRemarks, setBidRemarks] = useState('');
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);

  const openBidForm = (opp: VendorOpportunity) => {
    setBiddingOn(opp);
    setBidUnitPrice('');
    setBidLeadTimeDays('');
    setBidWarrantyYears('');
    setBidPaymentTerms('45 Days Net');
    setBidRemarks('');
  };

  // Landing here via "Submit Quote Now" (opportunity-feed's reminder banner)
  // passes the specific RFQ as `opportunity` — previously that prop was
  // received but never used, so the navigation just dropped the vendor on
  // the same undifferentiated table regardless of which RFQ they clicked.
  // Auto-open the bid form for it once, if it's actually biddable.
  useEffect(() => {
    if (!opportunity) return;
    const alreadyQuoted = submittedQuotes.some((q) => q.rfqNumber === opportunity.rfqNumber);
    const locked = !isOwnBuyerRfq(opportunity.rfqNumber) && vendorSubscription !== 'connect' && vendorSubscription !== 'select';
    if (!alreadyQuoted && !locked) {
      openBidForm(opportunity);
    }
    // Intentionally mount-only: this is "deep link" landing behavior, not a
    // reaction to subsequent submittedQuotes/vendorSubscription changes
    // (which would otherwise re-open the modal right after a successful submit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmitQuote = async () => {
    if (!biddingOn) return;
    const unitPrice = Number(bidUnitPrice);
    if (!unitPrice || unitPrice <= 0) {
      showToast('Validation Error', 'Enter a valid unit price.', 'warning');
      return;
    }
    const quantity = biddingOn.lineItems?.[0]?.quantity || 1;

    setIsSubmittingQuote(true);
    try {
      const res = await fetch(`/api/rfqs/${encodeURIComponent(biddingOn.rfqNumber)}/quotes`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          unitPrice,
          totalPrice: unitPrice * quantity,
          leadTimeDays: Number(bidLeadTimeDays) || 0,
          warrantyYears: Number(bidWarrantyYears) || 0,
          paymentTerms: bidPaymentTerms,
          remarks: bidRemarks,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit quote.');
      }
      addAuditLog(
        `${myVendorName || currentUserSession?.name || 'Vendor'} submitted a quotation for ${biddingOn.rfqNumber} (Unit Price: ${unitPrice})`,
        biddingOn.rfqNumber,
        currentUserSession?.email
      );
      showToast('Quote Submitted', `Your quotation for ${biddingOn.rfqNumber} was submitted successfully.`, 'success');
      setBiddingOn(null);
      await refreshFromDB();
    } catch (err: any) {
      showToast('Submission Failed', err?.message || 'Could not submit the quote. Please try again.', 'warning');
    } finally {
      setIsSubmittingQuote(false);
    }
  };

  // ─── Real RFQ document download ────────────────────────────────────────
  const handleDownloadRfq = async (opp: VendorOpportunity) => {
    try {
      const params = myVendorId ? `?vendorId=${encodeURIComponent(myVendorId)}` : '';
      const res = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}/email-preview${params}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not generate the RFQ specification.');
      }
      addAuditLog(
        `${myVendorName || currentUserSession?.name || 'Vendor'} downloaded RFQ specification for ${opp.rfqNumber}`,
        opp.rfqNumber,
        currentUserSession?.email
      );
      showToast('RFQ Downloaded', `📨 RFQ specification for ${opp.rfqNumber} sent to ${currentUserSession?.email || 'your registered email'}.`, 'success');
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
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Sourcing Enquiries & Quotation Tracking
            </h1>
            <span className="badge badge-emerald">Screen 3.2</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Review active RFQs received from eligible buyers, download specifications, and track submitted email quotation status.
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR SOURCING SUMMARY CARDS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
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
                // 'connect'/'select' are the real marketplace-unlock tiers (see
                // vendor-subscription.tsx's own plan copy) — 'premium_network'
                // is a value nothing in the app ever sets, so this used to be
                // permanently locked outside the 4-item isOwnBuyerRfq allow-list.
                const isLocked = !isOwnBuyerRfq(opp.rfqNumber) && vendorSubscription !== 'connect' && vendorSubscription !== 'select';
                
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
                      <button
                        onClick={() => {
                          if (isLocked) {
                            showToast('Premium Locked', 'Please upgrade your subscription to download specifications for this external buyer.', 'warning');
                          } else {
                            handleDownloadRfq(opp);
                          }
                        }}
                        className="btn btn-secondary btn-xs py-1 px-2.5 flex items-center justify-center gap-1 text-[9px] font-bold mx-auto border border-slate-200"
                        title="Download RFQ Specification"
                      >
                        <Download size={11} className="text-indigo-655" />
                        <span>Download RFQ</span>
                      </button>
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
                      ) : isLocked ? (
                        <span className="text-amber-500 font-bold text-[10px]">🔒 Premium Locked</span>
                      ) : (
                        <button
                          onClick={() => openBidForm(opp)}
                          className="btn btn-emerald btn-xs py-1 px-2.5 inline-flex items-center gap-1 text-[9px] font-bold"
                        >
                          <Send size={10} /> Submit Quote
                        </button>
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

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Unit Price (₹) *</label>
                <div className="relative">
                  <IndianRupee size={12} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="number"
                    min={0}
                    value={bidUnitPrice}
                    onChange={(e) => setBidUnitPrice(e.target.value)}
                    disabled={isSubmittingQuote}
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Lead Time (Days)</label>
                  <input
                    type="number"
                    min={0}
                    value={bidLeadTimeDays}
                    onChange={(e) => setBidLeadTimeDays(e.target.value)}
                    disabled={isSubmittingQuote}
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
                    disabled={isSubmittingQuote}
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
                  disabled={isSubmittingQuote}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Remarks</label>
                <textarea
                  value={bidRemarks}
                  onChange={(e) => setBidRemarks(e.target.value)}
                  disabled={isSubmittingQuote}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-gray-800">
              <button onClick={() => setBiddingOn(null)} disabled={isSubmittingQuote} className="btn btn-ghost btn-sm">
                Cancel
              </button>
              <button onClick={handleSubmitQuote} disabled={isSubmittingQuote} className="btn btn-primary btn-sm px-4 text-xs font-bold">
                <Send size={13} /> {isSubmittingQuote ? 'Submitting...' : 'Submit Quotation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
