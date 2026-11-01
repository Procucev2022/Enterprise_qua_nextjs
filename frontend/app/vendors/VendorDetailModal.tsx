'use client';

import React, { useEffect, useState } from 'react';
import type { PublicVendor } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  Building2,
  Mail,
  Phone,
  Globe,
  MapPin,
  ShieldCheck,
  X,
  Copy,
  Check,
  Tag,
  Layers,
  FileText,
  Award,
  AlertCircle,
  ExternalLink,
  ClipboardList,
  BadgeCheck,
  Users,
  TrendingUp,
} from 'lucide-react';
import { avatarForName, getInitials, renderStars, maskPublicEmail, maskPublicPhone } from './vendorUtils';

const S = UI_STRINGS.publicVendorDirectory;

type ModalTab = 'overview' | 'categories' | 'compliance' | 'performance';

interface VendorDetailModalProps {
  vendor: PublicVendor;
  onClose: () => void;
}

export default function VendorDetailModal({ vendor, onClose }: VendorDetailModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('overview');
  const [emailCopied, setEmailCopied] = useState(false);
  const pal = avatarForName(vendor.name);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function copyEmail() {
    if (!vendor.email) return;
    const emailToCopy = maskPublicEmail(vendor.email);
    navigator.clipboard
      .writeText(emailToCopy)
      .then(() => {
        setEmailCopied(true);
        setTimeout(() => setEmailCopied(false), 2000);
      })
      .catch(() => {});
  }

  const tabs: { id: ModalTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: S.tabs.overview, icon: <Users size={14} /> },
    { id: 'categories', label: S.tabs.categories, icon: <Layers size={14} /> },
    { id: 'compliance', label: S.tabs.compliance, icon: <FileText size={14} /> },
    { id: 'performance', label: S.tabs.performance, icon: <TrendingUp size={14} /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Profile for ${vendor.name}`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`relative bg-gradient-to-r ${pal.bg} p-6 pb-5`}>
          <button
            id="vendor-detail-modal-close"
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
            aria-label={S.closeModal}
          >
            <X size={16} />
          </button>
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-2xl bg-white/20 ring-2 ring-white/40 flex items-center justify-center text-white font-bold text-xl filter blur-[2px] select-none`}
            >
              {getInitials(vendor.name)}
            </div>
            <div className="min-w-0">
              <h2 className="text-white font-bold text-lg leading-tight line-clamp-2 filter blur-[4px] select-none">
                {vendor.name}
              </h2>
              {vendor.brandName && vendor.brandName !== vendor.name && (
                <p className="text-white/80 text-sm mt-0.5 filter blur-[4px] select-none">{vendor.brandName}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {vendor.isVerified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold">
                    <BadgeCheck size={10} /> {S.labels.verified}
                  </span>
                )}
                {vendor.isProcucevNetwork && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold">
                    <ShieldCheck size={10} /> {S.labels.networkBadge}
                  </span>
                )}
                {vendor.majorCategory && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold">
                    <Layers size={10} /> {vendor.majorCategory}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`vendor-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400 dark:border-blue-400 bg-white dark:bg-slate-900'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800'
              }`}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Panel */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0" role="tabpanel">
          {activeTab === 'overview' && (
            <OverviewTab
              vendor={vendor}
              onCopyEmail={copyEmail}
              emailCopied={emailCopied}
            />
          )}
          {activeTab === 'categories' && <CategoriesTab vendor={vendor} />}
          {activeTab === 'compliance' && <ComplianceTab vendor={vendor} />}
          {activeTab === 'performance' && <PerformanceTab vendor={vendor} />}
        </div>
      </div>
    </div>
  );
}

// ── Tab 1: Overview & Contacts ───────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="shrink-0 mt-0.5 text-slate-400 dark:text-slate-500">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-0.5">
          {label}
        </p>
        <div className="text-sm text-slate-800 dark:text-slate-200 break-words">{value}</div>
      </div>
      {action && <div className="shrink-0 mt-0.5">{action}</div>}
    </div>
  );
}

function OverviewTab({
  vendor,
  onCopyEmail,
  emailCopied,
}: {
  vendor: PublicVendor;
  onCopyEmail: () => void;
  emailCopied: boolean;
}) {
  return (
    <div className="space-y-0">
      {vendor.contactPerson && (
        <InfoRow
          icon={<Users size={15} />}
          label={S.labels.contactPerson}
          value={
            <span className="filter blur-[4px] select-none inline-block">
              {vendor.contactPerson}
              {vendor.contactDesignation && (
                <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
                  ({vendor.contactDesignation})
                </span>
              )}
            </span>
          }
        />
      )}
      {vendor.email && (
        <InfoRow
          icon={<Mail size={15} />}
          label={S.labels.email}
          value={
            <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">
              {maskPublicEmail(vendor.email)}
            </span>
          }
          action={
            <button
              onClick={onCopyEmail}
              className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              title={emailCopied ? S.labels.copiedEmail : S.labels.copyEmail}
            >
              {emailCopied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>
          }
        />
      )}
      {vendor.phone && (
        <InfoRow
          icon={<Phone size={15} />}
          label={S.labels.phone}
          value={
            <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">
              {maskPublicPhone(vendor.phone)}
            </span>
          }
        />
      )}
      {vendor.website && (
        <InfoRow
          icon={<Globe size={15} />}
          label={S.labels.website}
          value={
            <a
              href={vendor.website.startsWith('http') ? vendor.website : `https://${vendor.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              {vendor.website}
              <ExternalLink size={11} />
            </a>
          }
        />
      )}
      {(vendor.city || vendor.state || vendor.location) && (
        <InfoRow
          icon={<MapPin size={15} />}
          label={S.labels.location}
          value={
            [vendor.city, vendor.state, vendor.country].filter(Boolean).join(', ') ||
            vendor.location ||
            '—'
          }
        />
      )}
      {vendor.factoryAddress && (
        <InfoRow
          icon={<Building2 size={15} />}
          label={S.labels.address}
          value={vendor.factoryAddress}
        />
      )}
      {vendor.pincode && (
        <InfoRow
          icon={<ClipboardList size={15} />}
          label={S.labels.pincode}
          value={vendor.pincode}
        />
      )}
    </div>
  );
}

// ── Tab 2: Categories & Products ─────────────────────────────────────────────

function CategoriesTab({ vendor }: { vendor: PublicVendor }) {
  return (
    <div className="space-y-5">
      {vendor.majorCategory && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-2">
            {S.labels.majorCategory}
          </p>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 text-sm font-semibold">
            <Layers size={14} />
            {vendor.majorCategory}
          </span>
        </div>
      )}

      {Array.isArray(vendor.minorCategories) && vendor.minorCategories.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-2">
            {S.labels.minorCategories}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {vendor.minorCategories.map((cat, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                <Tag size={9} />
                {cat}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          {S.labels.noMinorCategories}
        </p>
      )}

      {Array.isArray(vendor.products) && vendor.products.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-2">
            {S.labels.productsOffered}
          </p>
          <ul className="space-y-1.5">
            {vendor.products.map((p, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300"
              >
                <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          {S.labels.noProducts}
        </p>
      )}
    </div>
  );
}

// ── Tab 3: Compliance & Tax ──────────────────────────────────────────────────

function ComplianceRow({
  label,
  value,
  verified,
}: {
  label: string;
  value: string | null | undefined;
  verified?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">
          {label}
        </p>
        <p className="text-sm font-mono text-slate-800 dark:text-slate-200 mt-0.5">{value}</p>
      </div>
      {verified !== undefined && (
        <span
          className={`shrink-0 mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            verified
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
          }`}
        >
          {verified ? <BadgeCheck size={9} /> : <AlertCircle size={9} />}
          {verified ? S.labels.verified : S.labels.notVerified}
        </span>
      )}
    </div>
  );
}

function ComplianceTab({ vendor }: { vendor: PublicVendor }) {
  const hasAny =
    vendor.gstin || vendor.pan || vendor.msme || vendor.orgType || vendor.annualTurnover;

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
        <FileText size={28} className="text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-400 dark:text-slate-500">
          No compliance details available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <ComplianceRow
        label={S.labels.gstin}
        value={vendor.gstin}
        verified={Boolean(vendor.gstin)}
      />
      <ComplianceRow label={S.labels.pan} value={vendor.pan} />
      <ComplianceRow label={S.labels.msme} value={vendor.msme} />
      <ComplianceRow label={S.labels.orgType} value={vendor.orgType} />
      <ComplianceRow label={S.labels.annualTurnover} value={vendor.annualTurnover} />
    </div>
  );
}

// ── Tab 4: Performance & Rating ─────────────────────────────────────────────

function PerformanceTab({ vendor }: { vendor: PublicVendor }) {
  const rating = vendor.rating ?? 0;
  const pct = Math.min(100, (rating / 5) * 100);
  const createdStr = vendor.createdAt
    ? new Date(vendor.createdAt).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Rating Display */}
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-3">
          {S.labels.rating}
        </p>
        <div className="flex items-center gap-4">
          <div className="text-4xl font-bold text-amber-600 dark:text-amber-400">
            {rating > 0 ? rating.toFixed(1) : '—'}
          </div>
          <div className="flex-1">
            {renderStars(rating)}
            <div className="mt-2 h-2 rounded-full bg-amber-200 dark:bg-amber-900/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-400 dark:bg-amber-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Status */}
      {vendor.status && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-2">
            {S.labels.status}
          </p>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 text-sm font-semibold">
            <Award size={14} />
            {vendor.status}
          </span>
        </div>
      )}

      {/* Network Verification Badges */}
      <div className="flex flex-col gap-2">
        {vendor.isVerified && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60">
            <BadgeCheck size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                GSTIN / Tax Verified
              </p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
                Registered business entity with valid tax credentials.
              </p>
            </div>
          </div>
        )}
        {vendor.isProcucevNetwork && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/60">
            <ShieldCheck size={18} className="text-violet-600 dark:text-violet-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                {S.labels.networkBadge}
              </p>
              <p className="text-xs text-violet-600/70 dark:text-violet-400/70">
                Listed in the verified Procucev Enterprise Supplier Network.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Member Since */}
      {createdStr && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {S.labels.memberSince}:{' '}
          <span className="font-semibold text-slate-600 dark:text-slate-400">
            {createdStr}
          </span>
        </p>
      )}
    </div>
  );
}
