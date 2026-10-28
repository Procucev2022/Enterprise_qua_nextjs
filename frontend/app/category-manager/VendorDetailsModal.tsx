'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Store,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Briefcase,
  DollarSign,
  Clock,
  Award,
  Star,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  FileText,
  Tag,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import type { QuoteComparison, RFQAssignedVendor, RFQItem, VendorEntry } from '@/lib/types';
import { formatCurrency, formatIndianDateTime } from '@/lib/constants';

interface VendorDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendorName?: string | null;
  vendorId?: string | null;
  quote?: QuoteComparison | null;
  assignedVendor?: RFQAssignedVendor | null;
  rfq?: RFQItem | null;
  onNavigateToMatrix?: (rfq: RFQItem) => void;
}

export default function VendorDetailsModal({
  isOpen,
  onClose,
  vendorName,
  vendorId,
  quote: directQuote,
  assignedVendor,
  rfq,
  onNavigateToMatrix,
}: VendorDetailsModalProps) {
  const { buyerVendors = [] } = useApp() || {};
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [remoteVendor, setRemoteVendor] = useState<VendorEntry | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setRemoteVendor(null);
      return;
    }
    const resolvedId = vendorId || directQuote?.vendorId || assignedVendor?.id || (assignedVendor as any)?.vendorId;
    if (resolvedId) {
      fetch(`/api/vendors/${encodeURIComponent(resolvedId)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.success && data.data) {
            setRemoteVendor(data.data);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, vendorId, directQuote, assignedVendor]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Resolve matching vendor record from store or remote fetch
  const matchedVendor: VendorEntry | undefined =
    remoteVendor ||
    (buyerVendors || []).find((v) => {
      if (vendorId && v.id === vendorId) return true;
      if (directQuote?.vendorId && v.id === directQuote.vendorId) return true;
      if (vendorName && v.name?.trim().toLowerCase() === vendorName.trim().toLowerCase()) return true;
      if (directQuote?.vendorName && v.name?.trim().toLowerCase() === directQuote.vendorName.trim().toLowerCase()) return true;
      if (assignedVendor?.name && v.name?.trim().toLowerCase() === assignedVendor.name.trim().toLowerCase()) return true;
      return false;
    });

  // Resolve matching assigned vendor from RFQ invite list
  const matchedAssignedVendor: RFQAssignedVendor | undefined =
    assignedVendor ||
    (rfq?.assignedVendors || []).find((av) => {
      if (vendorId && av.id === vendorId) return true;
      if (directQuote?.vendorId && av.id === directQuote.vendorId) return true;
      if (vendorName && av.name?.trim().toLowerCase() === vendorName.trim().toLowerCase()) return true;
      if (directQuote?.vendorName && av.name?.trim().toLowerCase() === directQuote.vendorName.trim().toLowerCase()) return true;
      if (matchedVendor?.id && av.id === matchedVendor.id) return true;
      if (matchedVendor?.name && av.name?.trim().toLowerCase() === matchedVendor.name.trim().toLowerCase()) return true;
      return false;
    });

  // Resolve quote if not passed directly, but available in rfq.quotes
  const resolvedQuote: QuoteComparison | undefined =
    directQuote ||
    (rfq?.quotes || []).find((q) => {
      if (vendorId && q.vendorId === vendorId) return true;
      if (matchedVendor?.id && q.vendorId === matchedVendor.id) return true;
      if (vendorName && q.vendorName?.trim().toLowerCase() === vendorName.trim().toLowerCase()) return true;
      if (matchedVendor?.name && q.vendorName?.trim().toLowerCase() === matchedVendor.name.trim().toLowerCase()) return true;
      if (matchedAssignedVendor?.name && q.vendorName?.trim().toLowerCase() === matchedAssignedVendor.name.trim().toLowerCase()) return true;
      return false;
    });

  const displayVendorName =
    matchedVendor?.name ||
    resolvedQuote?.vendorName ||
    matchedAssignedVendor?.name ||
    vendorName ||
    'Vendor Organization';

  // Key Contact Details
  const displayContact =
    matchedVendor?.contactPerson ||
    matchedAssignedVendor?.contactPerson ||
    null;

  const displayDesignation =
    matchedVendor?.contactDesignation ||
    (matchedAssignedVendor as any)?.contactDesignation ||
    (displayContact ? 'Representative' : null);

  // Official Email
  const displayEmail =
    matchedVendor?.email ||
    matchedAssignedVendor?.email ||
    null;

  // Contact Phone / Mobile Number
  const displayPhone =
    matchedVendor?.phone ||
    matchedAssignedVendor?.phone ||
    (matchedVendor as any)?.mobile ||
    null;

  // Registered Location
  const displayLocation =
    matchedVendor?.location ||
    (matchedVendor?.city ? `${matchedVendor.city}${matchedVendor.state ? ', ' + matchedVendor.state : ''}` : null) ||
    matchedAssignedVendor?.location ||
    matchedAssignedVendor?.city ||
    (rfq?.deliveryLocation ? rfq.deliveryLocation.split(',')[0]?.trim() : null) ||
    null;

  const displayMajorCategory =
    matchedVendor?.majorCategory ||
    assignedVendor?.majorCategory ||
    (matchedAssignedVendor as any)?.majorCategory ||
    (matchedVendor as any)?.category ||
    'General Supplies';

  const displayMinorCategories =
    matchedVendor?.minorCategories && matchedVendor.minorCategories.length > 0
      ? matchedVendor.minorCategories
      : [];

  const displayRating = matchedVendor?.rating !== undefined && matchedVendor?.rating !== null ? Number(matchedVendor.rating) : null;
  const displayScore = matchedVendor?.score ?? resolvedQuote?.aiMatchScore ?? null;
  const displayStatus = matchedVendor?.status || 'PREFERRED ENTERPRISE SUPPLIER';

  const displayGstin =
    matchedVendor?.gstin ||
    matchedVendor?.gst ||
    null;

  const displayPan =
    (matchedVendor as any)?.panNumber ||
    (matchedVendor as any)?.pan ||
    (displayGstin && displayGstin.length === 15 ? displayGstin.slice(2, 12) : null);

  const isEmpanelled = Boolean(
    matchedVendor?.status === 'PREFERRED ENTERPRISE SUPPLIER' ||
    matchedVendor?.source === 'procucev_network' ||
    matchedVendor?.isExistingInDatabase ||
    displayGstin
  );
  const copyToClipboard = (text: string, fieldKey: string) => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-details-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 shadow-2xl transition-all">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-gray-900/95 px-5 py-4 backdrop-blur-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-xl bg-teal-50 dark:bg-teal-950/70 p-2.5 text-teal-600 dark:text-teal-400 shrink-0">
              <Store size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="vendor-details-title" className="text-base sm:text-lg font-black text-slate-900 dark:text-white truncate">
                  {displayVendorName}
                </h2>
                {isEmpanelled ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-950/60 px-2.5 py-0.5 text-[10px] font-bold text-teal-700 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800/60">
                    <CheckCircle2 size={11} /> Empanelled Vendor
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/60 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60">
                    <AlertCircle size={11} /> Registered Supplier
                  </span>
                )}
                {resolvedQuote?.isBestPrice && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                    <Award size={11} /> L1 Best Price
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-450 mt-0.5 truncate">
                {displayMajorCategory} • Vendor Profile & Quotation Details
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Quick Stats Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-gray-950/70 border border-slate-200/70 dark:border-slate-800/80">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Vendor Rating</span>
              <div className="flex items-center gap-1 mt-0.5">
                {displayRating !== null ? (
                  <>
                    <Star size={13} className="text-amber-500 fill-amber-500" />
                    <span className="font-extrabold text-slate-800 dark:text-gray-200">{displayRating.toFixed(1)} / 5.0</span>
                  </>
                ) : (
                  <span className="font-bold text-slate-400 dark:text-gray-500">Unrated</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Match Score</span>
              <span className="font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5 block">
                {displayScore ? `${displayScore}%` : 'High Match'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Network Status</span>
              <span className="font-extrabold text-slate-800 dark:text-gray-200 mt-0.5 block truncate text-[11px]">
                {displayStatus}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">RFQ Participation</span>
              <span className="font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                {resolvedQuote ? 'Quotation Submitted' : assignedVendor ? 'Invited' : 'Available'}
              </span>
            </div>
          </div>

          {/* Section 1: RFQ Quotation Details (if quote present) */}
          {resolvedQuote ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                  <DollarSign size={14} className="text-teal-600 dark:text-teal-400" /> Submitted Quotation Breakdown
                </h3>
                {resolvedQuote.submittedAt && (
                  <span className="text-[11px] text-slate-500 dark:text-gray-450">
                    Submitted: {formatIndianDateTime(resolvedQuote.submittedAt)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 rounded-xl border border-teal-200/80 dark:border-teal-900/60 bg-teal-50/30 dark:bg-teal-950/20">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Quoted</span>
                  <span className="text-sm font-black text-slate-900 dark:text-white mt-0.5 block">
                    {formatCurrency(resolvedQuote.totalPrice)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Unit Price</span>
                  <span className="text-sm font-bold text-slate-800 dark:text-gray-200 mt-0.5 block">
                    {formatCurrency(resolvedQuote.unitPrice)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lead Time</span>
                  <div className="flex items-center gap-1 mt-0.5 font-bold text-slate-800 dark:text-gray-200">
                    <Clock size={12} className="text-slate-500" />
                    <span>{resolvedQuote.leadTimeDays} days</span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Warranty</span>
                  <span className="font-bold text-slate-800 dark:text-gray-200 mt-0.5 block">
                    {resolvedQuote.warrantyYears ? `${resolvedQuote.warrantyYears} Year(s)` : 'Standard'}
                  </span>
                </div>

                <div className="col-span-2 pt-2 border-t border-teal-100 dark:border-teal-900/40">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Payment Terms</span>
                  <span className="font-semibold text-slate-800 dark:text-gray-200 mt-0.5 block">
                    {resolvedQuote.paymentTerms || 'Net 30 days upon inspection'}
                  </span>
                </div>
                <div className="col-span-2 pt-2 border-t border-teal-100 dark:border-teal-900/40">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Compliance</span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold mt-0.5">
                    <CheckCircle2 size={11} /> {resolvedQuote.complianceStatus || 'Fully Compliant'}
                  </span>
                </div>

                {resolvedQuote.remarks && (
                  <div className="col-span-2 sm:col-span-4 pt-2 border-t border-teal-100 dark:border-teal-900/40">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vendor Remarks</span>
                    <p className="text-xs text-slate-700 dark:text-gray-300 mt-0.5 italic">
                      {`"${resolvedQuote.remarks}"`}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-gray-950/50 flex items-center gap-2.5">
              <AlertCircle size={16} className="text-amber-500 shrink-0" />
              <div className="text-xs text-slate-600 dark:text-gray-450">
                {assignedVendor
                  ? `Invited to quote against this RFQ. Awaiting commercial quotation submission.`
                  : 'Empanelled vendor in this category. Has not submitted a quote for this RFQ yet.'}
              </div>
            </div>
          )}

          {/* Section 2: MANDATORY CONTACT & LOCATION INFORMATION */}
          <div className="space-y-2.5 rounded-xl border-2 border-teal-200/80 dark:border-teal-900/60 bg-gradient-to-br from-teal-50/40 via-white to-slate-50/40 dark:from-teal-950/20 dark:via-gray-900 dark:to-gray-950 p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-teal-100 dark:border-teal-900/40">
              <h3 className="text-xs font-black uppercase tracking-wider text-teal-950 dark:text-teal-200 flex items-center gap-1.5">
                <Briefcase size={15} className="text-teal-600 dark:text-teal-400" /> Mandatory Contact & Location Details
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 dark:bg-teal-950 px-2.5 py-0.5 text-[10px] font-black text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                <ShieldCheck size={11} /> Required Profile Info
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              {/* Mandatory 1: Key Contact Details */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900/80 border border-slate-200/70 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Key Contact (Mandatory)
                  </span>
                  <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded ${
                    displayContact
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60'
                      : 'bg-slate-100 dark:bg-gray-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {displayContact ? 'Verified' : 'Unavailable'}
                  </span>
                </div>
                <div className="mt-1">
                  {displayContact ? (
                    <>
                      <span className="font-extrabold text-slate-900 dark:text-white text-sm block">
                        {displayContact}
                      </span>
                      {displayDesignation && (
                        <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">
                          {displayDesignation}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-400 dark:text-gray-500 italic text-xs block">
                      Not Provided
                    </span>
                  )}
                </div>
              </div>

              {/* Mandatory 2: Official Corporate Email */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900/80 border border-slate-200/70 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Email Address (Mandatory)
                  </span>
                  <button
                    type="button"
                    disabled={!displayEmail} onClick={() => displayEmail && copyToClipboard(displayEmail, 'v-email')}
                    title="Copy Email"
                    className="p-1 text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer"
                  >
                    {copiedField === 'v-email' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1 truncate">
                  <Mail size={14} className="text-teal-500 shrink-0" />
                  {displayEmail ? (
                    <a
                      href={`mailto:${displayEmail}`}
                      className="hover:underline font-bold text-teal-600 dark:text-teal-400 truncate text-xs"
                      title={`Email: ${displayEmail}`}
                    >
                      {displayEmail}
                    </a>
                  ) : (
                    <span className="text-slate-400 dark:text-gray-500 italic text-xs">Not Provided</span>
                  )}
                </div>
              </div>

              {/* Mandatory 3: Phone / Mobile Number */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900/80 border border-slate-200/70 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Phone / Mobile Number (Mandatory)
                  </span>
                  <button
                    type="button"
                    disabled={!displayPhone} onClick={() => displayPhone && copyToClipboard(displayPhone, 'v-phone')}
                    title="Copy Phone Number"
                    className="p-1 text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer"
                  >
                    {copiedField === 'v-phone' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Phone size={14} className="text-emerald-500 shrink-0" />
                  {displayPhone ? (
                    <a
                      href={`tel:${displayPhone}`}
                      className="hover:underline font-bold text-slate-900 dark:text-white text-xs"
                      title={`Call: ${displayPhone}`}
                    >
                      {displayPhone}
                    </a>
                  ) : (
                    <span className="text-slate-400 dark:text-gray-500 italic text-xs">Not Provided</span>
                  )}
                </div>
              </div>

              {/* Mandatory 4: Location & Operating Territory */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900/80 border border-slate-200/70 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Operating Location (Mandatory)
                  </span>
                  <button
                    type="button"
                    disabled={!displayLocation} onClick={() => displayLocation && copyToClipboard(displayLocation, 'v-location')}
                    title="Copy Vendor Location"
                    className="p-1 text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer"
                  >
                    {copiedField === 'v-location' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="flex items-start gap-2 mt-1 min-w-0">
                  <MapPin size={14} className="text-rose-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {displayLocation ? (
                      <>
                        <p className="font-bold text-slate-900 dark:text-white text-xs truncate">
                          {displayLocation}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-gray-450 truncate">
                          Operating facility & delivery coverage
                        </p>
                      </>
                    ) : (
                      <span className="text-slate-400 dark:text-gray-500 italic text-xs">Location Not Provided</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Statutory & Categories */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400" /> Statutory & Specialization
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-gray-950/50">
              {/* GSTIN */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">GSTIN</span>
                {displayGstin ? (
                  <div className="flex items-center justify-between gap-1 p-1.5 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-slate-800">
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px] truncate">{displayGstin}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(displayGstin, 'gstin')}
                      title="Copy GSTIN"
                      className="p-1 text-slate-400 hover:text-indigo-600 transition-colors shrink-0"
                    >
                      {copiedField === 'gstin' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    </button>
                  </div>
                ) : (
                  <span className="italic text-slate-400 text-xs">Not Provided</span>
                )}
              </div>

              {/* PAN */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">PAN</span>
                <div className="flex items-center justify-between gap-1 p-1.5 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-slate-800">
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px] truncate">{displayPan}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(displayPan, 'pan')}
                    title="Copy PAN"
                    className="p-1 text-slate-400 hover:text-indigo-600 transition-colors shrink-0"
                  >
                    {copiedField === 'pan' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* Categories */}
              <div className="col-span-1 sm:col-span-2 pt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Covered Categories
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                    <Tag size={10} /> {displayMajorCategory}
                  </span>
                  {displayMinorCategories.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Context RFQ Reference */}
          {rfq && (
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-gray-950/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Context RFQ</span>
                <span className="font-extrabold text-slate-900 dark:text-white font-mono">{rfq.rfqNumber}</span>
                <span className="text-slate-500 dark:text-gray-450 ml-2">({rfq.title})</span>
              </div>
              {onNavigateToMatrix && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToMatrix(rfq);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                >
                  <FileText size={12} /> View Comparative Matrix
                </button>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-gray-950/80 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
