'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
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
  const { rfqs, vendorOpportunities, showToast, addAuditLog, vendorSubscription } = useApp();
  const [selectedBuyerModal, setSelectedBuyerModal] = useState<(BuyerContactInfo & { rfqNumber: string }) | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Helper to map RFQs to Parent Companies
  const getParentCompany = (buyerName: string) => buyerName;

  // Baseline submitted quotes details (Method, Date, and Sourcing status details)
  const submittedQuotes = [
    {
      rfqNumber: 'RFQ-2026-00421',
      title: 'Centrifugal Water Pumps (500 GPM) & Valves',
      submittedDate: '20-Aug-2026 11:20 UTC',
      status: 'Under Evaluation',
      submissionMethod: 'Email Submission',
    },
    {
      rfqNumber: 'RFQ-2026-00423',
      title: 'High Pressure Gate Valve System',
      submittedDate: '18-Aug-2026 09:45 UTC',
      status: 'PO Generated',
      submissionMethod: 'Email Submission',
    }
  ];

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
                const isLocked = !isOwnBuyerRfq(opp.rfqNumber) && vendorSubscription !== 'premium_network';
                
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
                            addAuditLog(`Apex Supplies downloaded RFQ for ${opp.rfqNumber} again via email`, opp.rfqNumber, 'vendor@apex.com');
                            showToast('RFQ Downloaded', `📨 RFQ for ${opp.rfqNumber} successfully sent to your email (vendor@apex.com).`, 'success');
                          }
                        }}
                        className="btn btn-secondary btn-xs py-1 px-2.5 flex items-center justify-center gap-1 text-[9px] font-bold mx-auto border border-slate-200"
                        title="Download RFQ Details on Email"
                      >
                        <Mail size={11} className="text-indigo-655" />
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
                        <span className="text-slate-400 font-medium">Pending Quote</span>
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
    </div>
  );
}
