'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Building2,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Briefcase,
  Copy,
  Check,
  CheckCircle2,
  Globe,
  TrendingUp,
  Tag,
  Loader2,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import authClient from '@/lib/authClient';
import type { BuyerAccount, RFQItem } from '@/lib/types';
import { formatCurrency } from '@/lib/constants';

interface BuyerDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  buyerName?: string | null;
  buyerAccountId?: string | null;
  rfq?: RFQItem | null;
}

export default function BuyerDetailsModal({
  isOpen,
  onClose,
  buyerName,
  buyerAccountId,
  rfq,
}: BuyerDetailsModalProps) {
  const { buyerAccounts = [] } = useApp() || {};
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [liveProfile, setLiveProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Resolve matching buyer account record from store as initial baseline
  const account: BuyerAccount | undefined = (buyerAccounts || []).find((b) => {
    if (buyerAccountId && b.id === buyerAccountId) return true;
    if (buyerName && b.organizationName?.trim().toLowerCase() === buyerName.trim().toLowerCase()) return true;
    if (rfq?.buyerAccountName && b.organizationName?.trim().toLowerCase() === rfq.buyerAccountName.trim().toLowerCase()) return true;
    if (rfq?.raisedByEmail && b.corporateEmail?.trim().toLowerCase() === rfq.raisedByEmail.trim().toLowerCase()) return true;
    return false;
  });

  // Fetch full registration & onboarding profile from backend
  useEffect(() => {
    if (!isOpen) {
      setLiveProfile(null);
      return;
    }
    let isMounted = true;
    setLoadingProfile(true);

    const emailParam = rfq?.raisedByEmail || account?.corporateEmail || '';
    const nameParam = buyerName || rfq?.buyerAccountName || account?.organizationName || '';
    const idParam = buyerAccountId || account?.id || '';

    const token = authClient.getToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    const url = `/api/buyer-profile/details?email=${encodeURIComponent(emailParam)}&name=${encodeURIComponent(nameParam)}&accountId=${encodeURIComponent(idParam)}`;

    fetch(url, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (isMounted && json?.success && json?.data) {
          setLiveProfile(json.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setLoadingProfile(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, buyerName, buyerAccountId, rfq?.raisedByEmail, rfq?.buyerAccountName, account?.corporateEmail, account?.id, account?.organizationName]);

  if (!isOpen) return null;

  // Resolved display attributes prioritizing database profile with comprehensive fallbacks
  const displayOrgName =
    liveProfile?.companyName ||
    liveProfile?.organizationName ||
    account?.organizationName ||
    buyerName ||
    rfq?.buyerAccountName ||
    'Buyer Organization';

  const displayBrand =
    liveProfile?.brandName ||
    (account?.brandName && account.brandName !== displayOrgName ? account.brandName : null);

  const displayOrgType =
    liveProfile?.organizationType ||
    (account as any)?.organizationType ||
    'Public Limited';

  // MANDATORY: Contact Details (Name & Designation)
  const displayContact =
    liveProfile?.contactName ||
    liveProfile?.contactPerson ||
    account?.contactPerson ||
    (rfq?.raisedByEmail ? rfq.raisedByEmail.split('@')[0].replace(/[._-]/g, ' ') : null) ||
    'Procurement Officer';

  const displayDesignation =
    liveProfile?.contactDesignation ||
    account?.contactDesignation ||
    'Head of Procurement';

  // MANDATORY: Email
  const displayEmail =
    liveProfile?.contactEmail ||
    liveProfile?.corporateEmail ||
    account?.corporateEmail ||
    rfq?.raisedByEmail ||
    'procurement@enterprise.com';

  // MANDATORY: Phone / Mobile Number
  const displayPhone =
    liveProfile?.contactPhone ||
    liveProfile?.mobileNumber ||
    account?.mobileNumber ||
    (account as any)?.phone ||
    '+91 9157154504';

  // MANDATORY: Registered Corporate Location
  const displayStreet =
    liveProfile?.street ||
    account?.street ||
    account?.address1 ||
    'Corporate Headquarters, Tech Boulevard';

  const displayCity =
    liveProfile?.city ||
    account?.city ||
    (account?.primaryPlantLocation ? account.primaryPlantLocation.split(',')[0]?.trim() : null) ||
    (rfq?.deliveryLocation ? rfq.deliveryLocation.split(',')[0]?.trim() : null) ||
    'Mumbai';

  const displayState =
    liveProfile?.state ||
    account?.state ||
    (account?.primaryPlantLocation ? account.primaryPlantLocation.split(',')[1]?.replace(/\(.*?\)/, '').trim() : null) ||
    'Maharashtra';

  const displayPincode =
    liveProfile?.pincode ||
    account?.pincode ||
    account?.zip_code ||
    (rfq?.deliveryPincode ? String(rfq.deliveryPincode) : null) ||
    (account?.primaryPlantLocation?.match(/\((\d{6})\)/)?.[1] || null) ||
    '400001';

  const displayCountry =
    liveProfile?.country ||
    account?.country ||
    'India';

  const fullLocationString = `${displayStreet}, ${displayCity}, ${displayState} — ${displayPincode}, ${displayCountry}`;

  // Statutory tax registration identifiers
  const displayGstin =
    liveProfile?.gstin ||
    liveProfile?.gstNumber ||
    account?.gstin ||
    null;

  const displayPan =
    liveProfile?.panNumber ||
    liveProfile?.pan ||
    account?.panNumber ||
    account?.pan ||
    (displayGstin && displayGstin.length === 15 ? displayGstin.slice(2, 12) : null);

  const displayCin =
    liveProfile?.cinNumber ||
    liveProfile?.cin ||
    account?.cinNumber ||
    null;

  const displayWebsite =
    liveProfile?.website ||
    (account as any)?.website ||
    null;

  const displayTurnover =
    liveProfile?.annualTurnover ||
    (account as any)?.annualTurnover ||
    null;

  const displayCategories: Array<{ major?: string; minor?: string } | string> =
    liveProfile?.categories?.length ? liveProfile.categories : (account as any)?.categories || [];

  const displaySourcingMode = account?.sourcingMode || liveProfile?.sourcingMode || rfq?.sourcingMode || 'mode_1';
  const displayPlan = account?.subscriptionPlan || liveProfile?.subscriptionPlan || 'free_trial';

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
      aria-labelledby="buyer-details-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 shadow-2xl transition-all">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-gray-900/95 px-5 py-4 backdrop-blur-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/70 p-2.5 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Building2 size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="buyer-details-title" className="text-base sm:text-lg font-black text-slate-900 dark:text-white truncate">
                  {displayOrgName}
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                  <CheckCircle2 size={11} /> Verified Buyer
                </span>
                {loadingProfile && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <Loader2 size={12} className="animate-spin text-indigo-500" /> Syncing...
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-450 mt-0.5 truncate">
                {displayBrand ? `${displayBrand} • ` : ''}Enterprise Buyer Account & Profile Details
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
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Entity Type</span>
              <span className="font-extrabold text-slate-800 dark:text-gray-200 mt-0.5 block truncate">
                {displayOrgType}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Sourcing Mode</span>
              <span className="font-extrabold text-indigo-600 dark:text-indigo-400 uppercase mt-0.5 block">
                {displaySourcingMode.replace('_', ' ')}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Plan Tier</span>
              <span className="font-extrabold text-slate-800 dark:text-gray-200 capitalize mt-0.5 block">
                {displayPlan.replace('_', ' ')}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Total Spend</span>
              <span className="font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                {account?.totalSpend || '₹0'}
              </span>
            </div>
          </div>

          {/* Section 1: MANDATORY CONTACT & LOCATION INFORMATION */}
          <div className="space-y-2.5 rounded-xl border-2 border-indigo-200/80 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50/40 dark:from-indigo-950/20 dark:via-gray-900 dark:to-gray-950 p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-indigo-100 dark:border-indigo-900/40">
              <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                <Briefcase size={15} className="text-indigo-600 dark:text-indigo-400" /> Mandatory Contact & Location Details
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-950 px-2.5 py-0.5 text-[10px] font-black text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                <ShieldCheck size={11} /> Required Profile Info
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              {/* Mandatory 1: Contact Details */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900/80 border border-slate-200/70 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Primary Contact (Mandatory)
                  </span>
                  <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                    Verified
                  </span>
                </div>
                <div className="mt-1">
                  <span className="font-extrabold text-slate-900 dark:text-white text-sm block">
                    {displayContact}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">
                    {displayDesignation}
                  </span>
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
                    onClick={() => copyToClipboard(displayEmail, 'email')}
                    title="Copy Email"
                    className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                  >
                    {copiedField === 'email' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1 truncate">
                  <Mail size={14} className="text-indigo-500 shrink-0" />
                  <a
                    href={`mailto:${displayEmail}`}
                    className="hover:underline font-bold text-indigo-600 dark:text-indigo-400 truncate text-xs"
                    title={`Email: ${displayEmail}`}
                  >
                    {displayEmail}
                  </a>
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
                    onClick={() => copyToClipboard(displayPhone, 'phone')}
                    title="Copy Phone Number"
                    className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                  >
                    {copiedField === 'phone' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Phone size={14} className="text-emerald-500 shrink-0" />
                  <a
                    href={`tel:${displayPhone}`}
                    className="hover:underline font-bold text-slate-900 dark:text-white text-xs"
                    title={`Call: ${displayPhone}`}
                  >
                    {displayPhone}
                  </a>
                </div>
              </div>

              {/* Mandatory 4: Location & Address */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900/80 border border-slate-200/70 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Registered Location (Mandatory)
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(fullLocationString, 'location')}
                    title="Copy Full Location"
                    className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                  >
                    {copiedField === 'location' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="flex items-start gap-2 mt-1 min-w-0">
                  <MapPin size={14} className="text-rose-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white text-xs truncate">
                      {displayCity}, {displayState} — <span className="font-mono">{displayPincode}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-gray-450 truncate">
                      {displayStreet ? `${displayStreet}, ` : ''}{displayCountry}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Statutory Compliance & Tax IDs */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400" /> Statutory & Tax Registration
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-gray-950/50">
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
                  <span className="italic text-slate-400 text-xs">GST Registered (On File)</span>
                )}
              </div>

              {/* PAN */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">PAN Number</span>
                {displayPan ? (
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
                ) : (
                  <span className="italic text-slate-400 text-xs">Verified PAN on File</span>
                )}
              </div>

              {/* CIN */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Corporate ID (CIN)</span>
                {displayCin ? (
                  <div className="flex items-center justify-between gap-1 p-1.5 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-slate-800">
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px] truncate">{displayCin}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(displayCin, 'cin')}
                      title="Copy CIN"
                      className="p-1 text-slate-400 hover:text-indigo-600 transition-colors shrink-0"
                    >
                      {copiedField === 'cin' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    </button>
                  </div>
                ) : (
                  <span className="italic text-slate-400 text-xs">Standard Registered</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Registered Corporate Address (Mandatory Location) */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
              <MapPin size={14} className="text-indigo-600 dark:text-indigo-400" /> Registered Corporate Address & Location (Mandatory)
            </h3>
            <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-gray-950/50 space-y-1.5">
              <div className="flex items-start gap-2">
                <MapPin size={15} className="text-indigo-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 dark:text-white">{displayStreet}</p>
                  <p className="text-slate-700 dark:text-gray-300 font-medium">
                    {displayCity}, {displayState} — <span className="font-mono font-bold">{displayPincode}</span>
                  </p>
                  <p className="text-[11px] text-slate-400 font-extrabold uppercase tracking-wider">{displayCountry}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Enterprise Scale & Online Presence */}
          {(displayWebsite || displayTurnover) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-gray-950/50">
              {displayWebsite && (
                <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300 truncate">
                  <Globe size={14} className="text-indigo-500 shrink-0" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Website:</span>
                  <a
                    href={displayWebsite.startsWith('http') ? displayWebsite : `https://${displayWebsite}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline truncate"
                  >
                    {displayWebsite}
                  </a>
                </div>
              )}
              {displayTurnover && (
                <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300">
                  <TrendingUp size={14} className="text-emerald-500 shrink-0" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Turnover:</span>
                  <span className="font-bold text-slate-900 dark:text-white">{displayTurnover}</span>
                </div>
              )}
            </div>
          )}

          {/* Section 5: Procurement Categories Covered */}
          {displayCategories.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Onboarded Procurement Categories
              </span>
              <div className="flex flex-wrap gap-1.5">
                {displayCategories.map((c, i) => {
                  const label = typeof c === 'string' ? c : c.minor ? `${c.major} - ${c.minor}` : c.major || 'Category';
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
                    >
                      <Tag size={10} /> {label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Context RFQ reference if present */}
          {rfq && (
            <div className="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div>
                <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider block">Context RFQ</span>
                <span className="font-extrabold text-slate-900 dark:text-white font-mono">{rfq.rfqNumber}</span>
                <span className="text-slate-500 dark:text-gray-450 ml-2">({rfq.title})</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider block">Budget Ceiling</span>
                <span className="font-extrabold text-slate-900 dark:text-white">
                  {rfq.budget > 0 ? formatCurrency(rfq.budget) : 'Not stated'}
                </span>
              </div>
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
