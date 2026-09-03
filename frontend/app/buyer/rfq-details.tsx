'use client';
import React, { useMemo, useState } from 'react';
import { SOURCING_MODES, formatCurrency, formatFileSize } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { rfqAttachmentUrl } from '@/lib/rfqClient';
import type { ExtractedEntity, QuoteComparison, RFQItem, RFQSource } from '@/lib/types';
import {
  ArrowLeft,
  ClipboardList,
  MapPin,
  Wallet,
  CalendarDays,
  Layers,
  FileText,
  Mail,
  Globe,
  Pencil,
  Share2,
  Phone,
  MessageSquare,
  Smartphone,
  Search,
  Download,
  Paperclip,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Inbox,
} from 'lucide-react';

const DETAILS = UI_STRINGS.rfqDetails;

/** Sentinel meaning "no minor-category filter applied". */
const ALL_MINORS = 'all';

/** Confidence at or above this is reported as high rather than needing review. */
const HIGH_CONFIDENCE = 90;

/** Human label for each intake channel an RFQ can arrive through. */
const SOURCE_LABELS: Record<RFQSource, string> = {
  web_portal: 'Web Portal Upload',
  email_gateway: 'Email Gateway',
  email_upload: 'Emailed Document',
  manual_entry: 'Manual Entry',
};

/** Quotation states the filter tabs offer. */
type QuoteTab = 'all' | 'review' | 'shortlisted';

export interface RFQDetailsProps {
  /** The RFQ to render, or null when the number in the URL matches nothing. */
  rfq: RFQItem | null;
  onBack: () => void;
}

/** Blank optional values read as explicitly unset rather than as empty cells. */
function orUnset(value: string | undefined): string {
  return value && value.trim() !== '' ? value : DETAILS.unsetValue;
}

/**
 * Whole days between today and a target date, or null when no date is set.
 *
 * Compared at date granularity so a delivery later today counts as due today
 * rather than as already overdue by a fraction of a day.
 */
export function daysUntil(targetDate: string, today = new Date()): number | null {
  if (!targetDate || Number.isNaN(Date.parse(targetDate))) return null;

  const target = new Date(targetDate);
  const startOfTarget = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

/** How the remaining time to delivery reads, and whether it is a warning. */
function deliveryCountdown(days: number | null): { label: string; overdue: boolean } | null {
  if (days === null) return null;
  if (days === 0) return { label: DETAILS.dueToday, overdue: false };
  if (days < 0) return { label: formatString(DETAILS.overdueBy, { days: Math.abs(days) }), overdue: true };
  return { label: formatString(DETAILS.daysRemaining, { days }), overdue: false };
}

/**
 * Line items as CSV.
 *
 * Every field is quoted and embedded quotes are doubled, so a specification
 * containing a comma or a quote cannot break the column alignment.
 */
export function lineItemsToCsv(items: ExtractedEntity[]): string {
  const headers = [
    DETAILS.colItem,
    DETAILS.colSpecs,
    DETAILS.colMajor,
    DETAILS.colMinor,
    DETAILS.colQty,
    DETAILS.colUnit,
    DETAILS.colTargetDate,
    DETAILS.colConfidence,
  ];
  // Every ExtractedEntity field this exports is a required, non-nullable string or
  // number, so no nullish fallback is needed. Doubling embedded quotes is the RFC
  // 4180 escape, which keeps commas and newlines inside a field intact.
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

  return [
    headers.map(cell).join(','),
    ...items.map((item) =>
      [
        item.itemName,
        item.technicalSpecs,
        item.majorCategory,
        item.minorCategory,
        item.quantity,
        item.unit,
        item.targetDate,
        item.confidence,
      ]
        .map(cell)
        .join(',')
    ),
  ].join('\n');
}

/** One label/value pair inside an overview card. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-right font-semibold text-slate-900 dark:text-white min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Overview card with a tinted header strip, a body, and a footer summary line. */
function Card({
  title,
  icon,
  meta,
  footer,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3 rounded-t-2xl bg-slate-50 dark:bg-gray-950/60 border-b border-slate-200 dark:border-gray-800">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
          {icon}
          {title}
        </h2>
        {meta}
      </header>
      <div className="p-4 space-y-3 text-xs flex-1">{children}</div>
      {footer && (
        <footer className="px-4 py-2.5 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-gray-400">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Full-width section with a heading, a count pill and optional toolbar. */
function Panel({
  title,
  count,
  subtitle,
  toolbar,
  footer,
  children,
}: {
  title: string;
  count: number;
  subtitle?: string;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm overflow-hidden">
      <header className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[11px] mono font-bold">
            {count}
          </span>
          {subtitle && <span className="text-[11px] text-slate-400 dark:text-gray-500">{subtitle}</span>}
        </div>
        {toolbar}
      </header>
      {children}
      {footer && (
        <footer className="px-4 py-3 bg-slate-50 dark:bg-gray-950/60 border-t border-slate-200 dark:border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-gray-400">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * Screen 1.4 — Buyer RFQ Details.
 *
 * Everything submitted for one RFQ: how it arrived, its commercial and delivery
 * terms, outreach telemetry, every line item with its classification, the
 * supporting documents, and any quotations received.
 *
 * The RFQ is resolved by the caller from the number in the URL rather than held
 * in store state, so the page survives a reload and can be linked to directly.
 */
export default function RFQDetails({ rfq, onBack }: RFQDetailsProps) {
  const [itemSearch, setItemSearch] = useState('');
  const [minorFilter, setMinorFilter] = useState<string>(ALL_MINORS);
  const [quoteTab, setQuoteTab] = useState<QuoteTab>('all');

  // Memoised because the `|| []` fallback would otherwise hand every dependent
  // memo a fresh array on each render, recomputing the filter and the CSV needlessly.
  const lineItems = useMemo(() => rfq?.extractedEntities || [], [rfq?.extractedEntities]);

  /** Minor categories actually present, so the filter never offers an empty option. */
  const minorCategories = useMemo(
    () => Array.from(new Set(lineItems.map((i) => i.minorCategory).filter(Boolean))).sort(),
    [lineItems]
  );

  const filteredItems = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    return lineItems.filter((item) => {
      const matchesMinor = minorFilter === ALL_MINORS || item.minorCategory === minorFilter;
      const matchesTerm =
        term === '' ||
        `${item.itemName} ${item.technicalSpecs} ${item.majorCategory} ${item.minorCategory} ${item.unit}`
          .toLowerCase()
          .includes(term);
      return matchesMinor && matchesTerm;
    });
  }, [lineItems, itemSearch, minorFilter]);

  /**
   * A data URL rather than a generated blob and a synthetic click: the anchor is
   * declarative, so React owns the DOM and the export needs no direct DOM calls.
   */
  const csvHref = useMemo(
    () => `data:text/csv;charset=utf-8,${encodeURIComponent(lineItemsToCsv(lineItems))}`,
    [lineItems]
  );

  if (!rfq) {
    return (
      <div className="max-w-3xl mx-auto p-12 text-center rounded-2xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
        <AlertCircle size={32} className="mx-auto text-amber-500" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white">{DETAILS.notFoundTitle}</h2>
        <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">{DETAILS.notFoundMessage}</p>
        <button onClick={onBack} className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5">
          <ArrowLeft size={13} /> {DETAILS.backAction}
        </button>
      </div>
    );
  }

  const mode = SOURCING_MODES.find((m) => m.id === rfq.sourcingMode);
  const attachments = rfq.attachments || [];
  const quotes = rfq.quotes || [];
  const followUps = rfq.followUpData;
  const countdown = deliveryCountdown(daysUntil(rfq.targetDeliveryDate));
  const autoClassified = lineItems.filter((i) => i.confidence >= HIGH_CONFIDENCE).length;
  const classifiedPercent = lineItems.length === 0 ? 0 : Math.round((autoClassified / lineItems.length) * 100);

  // Quotation states are not modelled yet, so only the "all" tab can hold rows.
  // Showing the other two with a zero count is honest about what exists.
  const visibleQuotes = quoteTab === 'all' ? quotes : [];
  const quoteTabs: { id: QuoteTab; label: string }[] = [
    { id: 'all', label: formatString(DETAILS.quotesTabAll, { count: quotes.length }) },
    { id: 'review', label: formatString(DETAILS.quotesTabUnderReview, { count: 0 }) },
    { id: 'shortlisted', label: formatString(DETAILS.quotesTabShortlisted, { count: 0 }) },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-4 animate-fade-in pb-10">
      {/* Provenance strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 transition-colors"
        >
          <ArrowLeft size={14} /> {DETAILS.backAction}
        </button>
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 font-semibold">
            <ShieldCheck size={12} /> {DETAILS.auditImmutable}
          </span>
          <span className="mono">{formatString(DETAILS.raisedOnStrip, { timestamp: rfq.createdAt })}</span>
        </div>
      </div>

      {/* Header bar */}
      <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm p-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-wider">
            {DETAILS.documentTypeBadge}
          </span>
          {/* badgeColor is a Tailwind class string, so it is applied as a class.
              Passing it to style={{ backgroundColor }} silently rendered nothing. */}
          {mode && (
            <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${mode.badgeColor}`}>
              {mode.code}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {rfq.status}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mono tracking-tight">
            {rfq.rfqNumber}
          </h1>
          <span className="text-xs text-slate-600 dark:text-gray-300 font-medium">{rfq.title}</span>
        </div>
      </header>

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card
          title={DETAILS.submittedHeading}
          icon={<ClipboardList size={15} className="text-indigo-600 dark:text-indigo-400" />}
          meta={<span className="text-[10px] mono text-slate-400 dark:text-gray-500">{rfq.id}</span>}
        >
          <Row label={DETAILS.sourceLabel}>
            <span className="inline-flex items-center gap-1.5">
              {rfq.source === 'email_gateway' ? (
                <Mail size={12} className="text-indigo-600 dark:text-indigo-400" />
              ) : rfq.source === 'manual_entry' ? (
                <Pencil size={12} className="text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Globe size={12} className="text-indigo-600 dark:text-indigo-400" />
              )}
              {rfq.source ? SOURCE_LABELS[rfq.source] : DETAILS.unsetValue}
            </span>
          </Row>
          <Row label={DETAILS.createdLabel}>
            <span className="mono">{rfq.createdAt}</span>
          </Row>
          <Row label={DETAILS.sourceFileLabel}>{orUnset(rfq.sourceFileName)}</Row>
          <Row label={DETAILS.sourceEmailLabel}>{orUnset(rfq.sourceEmail)}</Row>
        </Card>

        <Card
          title={DETAILS.commercialHeading}
          icon={<Wallet size={15} className="text-emerald-600 dark:text-emerald-400" />}
          footer={
            <>
              <span>{DETAILS.statusLabel}</span>
              <span className="font-bold text-amber-700 dark:text-amber-300">{rfq.status}</span>
            </>
          }
        >
          <Row label={DETAILS.categoryLabel}>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={12} className="text-slate-400" />
              {rfq.category}
            </span>
          </Row>
          <Row label={DETAILS.budgetLabel}>
            {rfq.budget > 0 ? (
              <span className="mono">{formatCurrency(rfq.budget)}</span>
            ) : (
              <span className="text-slate-400 dark:text-gray-500 font-normal">{DETAILS.unsetValue}</span>
            )}
          </Row>
          <Row label={DETAILS.targetDateLabel}>
            <span className="inline-flex items-center gap-1.5 mono">
              <CalendarDays size={12} className="text-slate-400" />
              {orUnset(rfq.targetDeliveryDate)}
            </span>
            {countdown && (
              <span
                className={`block text-[10px] font-semibold mt-0.5 ${
                  countdown.overdue ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {countdown.label}
              </span>
            )}
          </Row>
          <Row label={DETAILS.deliveryLocationLabel}>
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={12} className="text-rose-500" />
              {orUnset(rfq.deliveryLocation)}
            </span>
            {rfq.deliveryPincode && (
              <span className="block text-[10px] mono text-slate-400 dark:text-gray-500 mt-0.5">
                {formatString(DETAILS.deliveryPincodeLabel, { pincode: rfq.deliveryPincode })}
              </span>
            )}
          </Row>
        </Card>

        <Card
          title={DETAILS.followUpsHeading}
          icon={<Share2 size={15} className="text-purple-600 dark:text-purple-400" />}
          meta={
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 font-semibold">
              {DETAILS.followUpsTag}
            </span>
          }
          footer={<span className="italic">{DETAILS.awaitingTrigger}</span>}
        >
          {!followUps ? (
            <p className="text-slate-500 dark:text-gray-400">{DETAILS.noFollowUps}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: DETAILS.invitedLabel, value: followUps.totalInvited },
                  { label: DETAILS.respondedLabel, value: followUps.respondedCount },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    className="rounded-xl bg-slate-50 dark:bg-gray-950/60 p-2.5 text-center border border-slate-100 dark:border-gray-800"
                  >
                    <div className="text-[10px] text-slate-500 dark:text-gray-400 font-semibold">{tile.label}</div>
                    <div className="text-lg font-black mono text-slate-900 dark:text-white">{tile.value}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5 pt-1">
                {[
                  {
                    label: DETAILS.callsLabel,
                    icon: <Phone size={12} className="text-indigo-600 dark:text-indigo-400" />,
                    done: followUps.callStats.connected,
                    total: followUps.callStats.total,
                  },
                  {
                    label: DETAILS.whatsappLabel,
                    icon: <MessageSquare size={12} className="text-emerald-600 dark:text-emerald-400" />,
                    done: followUps.whatsappStats.read,
                    total: followUps.whatsappStats.total,
                  },
                  {
                    label: DETAILS.smsLabel,
                    icon: <Smartphone size={12} className="text-sky-600 dark:text-sky-400" />,
                    done: followUps.smsStats.delivered,
                    total: followUps.smsStats.total,
                  },
                ].map((channel) => (
                  <div
                    key={channel.label}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-50/80 dark:bg-gray-950/40"
                  >
                    <span className="flex items-center gap-1.5 text-slate-700 dark:text-gray-300">
                      {channel.icon}
                      {channel.label}
                    </span>
                    <span className="mono font-bold text-slate-900 dark:text-white">
                      {channel.done} / {channel.total}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Line items */}
      <Panel
        title={DETAILS.lineItemsHeading}
        count={lineItems.length}
        subtitle={DETAILS.lineItemsSubtitle}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder={DETAILS.lineItemSearchPlaceholder}
                aria-label={DETAILS.lineItemSearchAria}
                className="text-xs w-56 !py-1.5 !pl-8 !pr-2.5 rounded-lg border border-slate-200 dark:border-gray-800"
              />
            </div>
            <select
              value={minorFilter}
              onChange={(e) => setMinorFilter(e.target.value)}
              aria-label={DETAILS.minorFilterAria}
              className="text-xs font-semibold rounded-lg border border-slate-200 dark:border-gray-800 !py-1.5 !px-2.5"
            >
              <option value={ALL_MINORS}>{DETAILS.allMinorCategories}</option>
              {minorCategories.map((minor) => (
                <option key={minor} value={minor}>
                  {minor}
                </option>
              ))}
            </select>
            <a
              href={csvHref}
              download={`${rfq.rfqNumber}-line-items.csv`}
              aria-label={formatString(DETAILS.exportCsvAria, { rfqNumber: rfq.rfqNumber })}
              className="btn btn-secondary btn-xs font-bold flex items-center gap-1.5"
            >
              <Download size={12} /> {DETAILS.exportCsvAction}
            </a>
          </div>
        }
        footer={
          lineItems.length > 0 ? (
            <>
              <span>
                {formatString(DETAILS.displayingCount, { shown: filteredItems.length, total: lineItems.length })}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck size={12} />
                {formatString(DETAILS.parsedSuccessfully, { percent: classifiedPercent })}
              </span>
            </>
          ) : undefined
        }
      >
        {lineItems.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-slate-500 dark:text-gray-400">{DETAILS.noLineItems}</p>
        ) : (
          <div className="overflow-x-auto border-t border-slate-200 dark:border-gray-800">
            <table className="w-full text-left text-xs min-w-[980px]">
              <thead className="bg-slate-50 dark:bg-gray-950/60 text-slate-600 dark:text-gray-400 text-[10px] uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-4 py-2.5">{DETAILS.colItem}</th>
                  <th className="px-4 py-2.5">{DETAILS.colSpecs}</th>
                  <th className="px-4 py-2.5">{DETAILS.colMajor}</th>
                  <th className="px-4 py-2.5">{DETAILS.colMinor}</th>
                  <th className="px-4 py-2.5 text-right">{DETAILS.colQty}</th>
                  <th className="px-4 py-2.5">{DETAILS.colUnit}</th>
                  <th className="px-4 py-2.5">{DETAILS.colTargetDate}</th>
                  <th className="px-4 py-2.5 text-center">{DETAILS.colConfidence}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, index) => (
                  <tr
                    key={item.id}
                    className={`align-top border-t border-slate-100 dark:border-gray-800/70 ${
                      index % 2 === 1 ? 'bg-slate-50/50 dark:bg-gray-950/30' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">{item.itemName}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-gray-400">
                      {item.technicalSpecs?.trim() ? (
                        item.technicalSpecs
                      ) : (
                        <span className="italic text-slate-400 dark:text-gray-600">{DETAILS.unsetValue}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-gray-300">{item.majorCategory}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                        {item.minorCategory}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right mono font-bold text-slate-900 dark:text-white">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-2.5 mono text-slate-500 dark:text-gray-400">{item.unit}</td>
                    <td className="px-4 py-2.5 mono">{orUnset(item.targetDate)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {/* A keyed row carries no AI confidence, so it says so instead
                          of claiming a score that was never computed. */}
                      {item.confidence <= 0 ? (
                        <span className="text-[10px] text-slate-400 dark:text-gray-500">
                          {DETAILS.manualConfidence}
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.confidence >= HIGH_CONFIDENCE
                              ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              item.confidence >= HIGH_CONFIDENCE ? 'bg-emerald-500' : 'bg-amber-500'
                            }`}
                          />
                          {formatString(
                            item.confidence >= HIGH_CONFIDENCE ? DETAILS.confidenceHigh : DETAILS.confidenceReview,
                            { confidence: item.confidence }
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500">
                      {DETAILS.noLineItemMatches}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Supporting documents */}
      <Panel
        title={DETAILS.attachmentsHeading}
        count={attachments.length}
        toolbar={<Paperclip size={14} className="text-slate-400" />}
      >
        <div className="px-4 pb-4">
          {attachments.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-gray-400">{DETAILS.noAttachments}</p>
          ) : (
            <ul className="space-y-2">
              {attachments.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <FileText size={15} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {file.fileName}
                      </span>
                      <span className="block text-[10px] text-slate-400 dark:text-gray-500 mono">
                        {formatFileSize(file.size)}
                        {file.uploadedAt
                          ? ` · ${formatString(DETAILS.attachmentUploadedOn, {
                              date: file.uploadedAt.slice(0, 10),
                            })}`
                          : ''}
                      </span>
                    </span>
                  </span>
                  {/* A plain link, so the browser previews a PDF or image inline and
                      the endpoint supplies the name and type from its own metadata. */}
                  <a
                    href={rfqAttachmentUrl(file.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={formatString(DETAILS.attachmentViewAria, { fileName: file.fileName })}
                    className="btn btn-secondary btn-xs font-bold flex items-center gap-1 shrink-0"
                  >
                    <ExternalLink size={11} /> {DETAILS.attachmentViewAction}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* Vendor quotations */}
      <Panel
        title={DETAILS.quotesHeading}
        count={quotes.length}
        toolbar={
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
            {quoteTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setQuoteTab(tab.id)}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  quoteTab === tab.id
                    ? 'bg-white dark:bg-gray-800 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      >
        {visibleQuotes.length === 0 ? (
          <div className="px-4 pb-10 pt-4 flex flex-col items-center text-center max-w-xl mx-auto space-y-3">
            <span className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
              <Inbox size={26} className="text-indigo-600 dark:text-indigo-400" />
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {quoteTab === 'all' ? DETAILS.noQuotes : DETAILS.noQuotesTabMessage}
            </h3>
            {quoteTab === 'all' && (
              <p className="text-xs text-slate-500 dark:text-gray-400">{DETAILS.noQuotesMessage}</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-200 dark:border-gray-800">
            <table className="w-full text-left text-xs min-w-[760px]">
              <thead className="bg-slate-50 dark:bg-gray-950/60 text-slate-600 dark:text-gray-400 text-[10px] uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-4 py-2.5">{DETAILS.colVendor}</th>
                  <th className="px-4 py-2.5 text-right">{DETAILS.colUnitPrice}</th>
                  <th className="px-4 py-2.5 text-right">{DETAILS.colTotalPrice}</th>
                  <th className="px-4 py-2.5">{DETAILS.colLeadTime}</th>
                  <th className="px-4 py-2.5">{DETAILS.colCompliance}</th>
                  <th className="px-4 py-2.5 text-center">{DETAILS.colMatchScore}</th>
                </tr>
              </thead>
              <tbody>
                {visibleQuotes.map((quote: QuoteComparison, index: number) => (
                  <tr
                    key={quote.vendorId}
                    className={`border-t border-slate-100 dark:border-gray-800/70 ${
                      index % 2 === 1 ? 'bg-slate-50/50 dark:bg-gray-950/30' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">{quote.vendorName}</td>
                    <td className="px-4 py-2.5 text-right mono">{formatCurrency(quote.unitPrice)}</td>
                    <td className="px-4 py-2.5 text-right mono font-bold">{formatCurrency(quote.totalPrice)}</td>
                    <td className="px-4 py-2.5">{formatString(DETAILS.leadTimeDays, { days: quote.leadTimeDays })}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-gray-400">{quote.complianceStatus}</td>
                    <td className="px-4 py-2.5 text-center mono font-bold text-emerald-700 dark:text-emerald-400">
                      {quote.aiMatchScore}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
