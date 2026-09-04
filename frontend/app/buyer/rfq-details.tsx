'use client';
import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import {
  SOURCING_MODES,
  formatCurrency,
  formatFileSize,
  formatIndianDate,
  formatIndianDateTime,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { rfqAttachmentUrl } from '@/lib/rfqClient';
import type { ExtractedEntity, QuoteComparison, RFQAttachment, RFQItem, RFQSource } from '@/lib/types';
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
  Search,
  Download,
  Paperclip,
  Trash2,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Inbox,
  ArrowUp,
  ArrowDown,
  X,
} from 'lucide-react';

const DETAILS = UI_STRINGS.rfqDetails;
const EDIT = UI_STRINGS.rfqEdit;

/** Sentinel meaning "no minor-category filter applied". */
const ALL_MINORS = 'all';

/** Confidence at or above this is reported as high rather than needing review. */
const HIGH_CONFIDENCE = 90;

/** Human label for each intake channel an RFQ can arrive through. */
const SOURCE_LABELS: Record<RFQSource, string> = {
  web_portal: DETAILS.sourceWebPortal,
  email_gateway: DETAILS.sourceEmailGateway,
  email_upload: DETAILS.sourceEmailUpload,
  manual_entry: DETAILS.sourceManualEntry,
};

/** Line-item columns the buyer can order the table by. */
type SortKey = 'item' | 'category' | 'quantity' | 'targetDate';
type SortDirection = 'asc' | 'desc';

export interface RFQDetailsProps {
  /** The RFQ to render, or null when the number in the URL matches nothing. */
  rfq: RFQItem | null;
  onBack: () => void;
  /**
   * Open the edit dialog. Optional so the screen can be rendered read-only, and
   * the button is left out entirely rather than shown disabled when it is absent.
   */
  onEdit?: () => void;
  /** Open the delete confirmation. Optional for the same reason. */
  onDelete?: () => void;
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
        {meta && <span className="shrink-0 truncate max-w-[40%]">{meta}</span>}
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
  /** Omitted by panels that are not a list of anything, such as the summary. */
  count?: number;
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
          {count !== undefined && (
            <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[11px] mono font-bold">
              {count}
            </span>
          )}
          {subtitle && <span className="text-[11px] text-slate-400 dark:text-gray-500">{subtitle}</span>}
        </div>
        {toolbar}
      </header>
      {children}
      {footer && (
        <footer className="px-4 py-3 bg-slate-50 dark:bg-gray-950/60 border-t border-slate-200 dark:border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-gray-400 text-center sm:text-left">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * A column header that orders the table by its column.
 *
 * `aria-sort` carries the current state for assistive technology, while the
 * button's own label names what pressing it will do next — announcing "sort
 * descending" on a column already sorted ascending, rather than restating what
 * the header visually shows.
 */
function SortableHeader({
  column,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
}: {
  column: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const isActive = activeKey === sortKey;
  const nextDirection: SortDirection = isActive && direction === 'asc' ? 'desc' : 'asc';
  return (
    <th
      scope="col"
      aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-2.5 font-bold ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={formatString(
          nextDirection === 'asc' ? DETAILS.sortAscAria : DETAILS.sortDescAria,
          { column }
        )}
        className={`inline-flex items-center gap-1 uppercase tracking-wider font-bold transition-colors hover:text-indigo-700 dark:hover:text-indigo-300 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${isActive ? 'text-indigo-700 dark:text-indigo-300' : ''}`}
      >
        {column}
        {isActive &&
          (direction === 'asc' ? (
            <ArrowUp size={11} className="shrink-0" />
          ) : (
            <ArrowDown size={11} className="shrink-0" />
          ))}
      </button>
    </th>
  );
}

/** Small "label: value" pair used inside mobile item/quote cards. */
function CardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-slate-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-semibold text-slate-900 dark:text-white min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Confidence pill shared by the desktop table cell and the mobile card. */
function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence <= 0) {
    // A keyed row carries no AI confidence, so it says so instead of claiming a
    // score that was never computed.
    return <span className="text-[10px] text-slate-400 dark:text-gray-500">{DETAILS.manualConfidence}</span>;
  }
  const highConfidence = confidence >= HIGH_CONFIDENCE;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
        highConfidence
          ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${highConfidence ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {formatString(highConfidence ? DETAILS.confidenceHigh : DETAILS.confidenceReview, { confidence })}
    </span>
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
 *
 * Below the `md` breakpoint, the line-item and quote tables give way to a
 * stacked card list — a fixed-column table forces a horizontal scroll on a
 * phone-width viewport, which hides columns off-screen rather than reflowing
 * them, so a card per row is used instead of `overflow-x-auto` there.
 */
export default function RFQDetails({ rfq, onBack, onEdit, onDelete }: RFQDetailsProps) {
  const { showToast } = useApp();
  const [itemSearch, setItemSearch] = useState('');
  const [minorFilter, setMinorFilter] = useState<string>(ALL_MINORS);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // GET /api/rfqs/attachments/:id requires authentication, and this app's
  // session token lives only in localStorage (never a cookie) — a plain
  // `<a href>` navigation carries no Authorization header, so it always 401s
  // regardless of whether the user is logged in. Fetching it manually with
  // the header and opening the resulting blob preserves the original inline
  // PDF/image preview behavior while actually authenticating the request.
  const handleViewAttachment = async (file: RFQAttachment) => {
    try {
      const token = authClient.getToken();
      const res = await fetch(rfqAttachmentUrl(file.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error('Could not load the attachment.');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      // The opened tab has its own reference to the blob; safe to release
      // this one once the browser has had a chance to load it.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    } catch (err: any) {
      showToast('Could Not Open Attachment', err?.message || 'Could not load the attachment.', 'warning');
    }
  };

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
   * Sorted view of the filtered rows.
   *
   * Unsorted by default, because a BOQ's own order carries meaning the buyer put
   * there. Comparisons are stable: `sort` on a copy, and equal keys keep their
   * document order so re-sorting on one column never scrambles the rest.
   */
  const visibleItems = useMemo(() => {
    if (!sortKey) return filteredItems;
    const direction = sortDirection === 'asc' ? 1 : -1;
    const compare = (a: ExtractedEntity, b: ExtractedEntity): number => {
      if (sortKey === 'quantity') return (a.quantity - b.quantity) * direction;
      if (sortKey === 'targetDate') {
        // Rows with no date sort last in either direction, so an unanswered field
        // never displaces a real deadline from the top of the list.
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate.localeCompare(b.targetDate) * direction;
      }
      const left = sortKey === 'item' ? a.itemName : `${a.majorCategory} ${a.minorCategory}`;
      const right = sortKey === 'item' ? b.itemName : `${b.majorCategory} ${b.minorCategory}`;
      return left.localeCompare(right) * direction;
    };
    return [...filteredItems].sort(compare);
  }, [filteredItems, sortKey, sortDirection]);

  /** Click a column: sort ascending, then flip, on the same column. */
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  /** Sort control for the mobile card list, where there is no column to click. */
  const sortSelectValue = sortKey ? `${sortKey}:${sortDirection}` : '';
  const onSortSelectChange = (value: string) => {
    if (!value) {
      setSortKey(null);
      return;
    }
    const [key, direction] = value.split(':') as [SortKey, SortDirection];
    setSortKey(key);
    setSortDirection(direction);
  };

  const filtersApplied = itemSearch.trim() !== '' || minorFilter !== ALL_MINORS;
  const clearFilters = () => {
    setItemSearch('');
    setMinorFilter(ALL_MINORS);
  };

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
      <div className="max-w-3xl mx-auto p-8 sm:p-12 text-center rounded-2xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
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
  const countdown = deliveryCountdown(daysUntil(rfq.targetDeliveryDate));
  const autoClassified = lineItems.filter((i) => i.confidence >= HIGH_CONFIDENCE).length;
  const classifiedPercent = lineItems.length === 0 ? 0 : Math.round((autoClassified / lineItems.length) * 100);
  const totalQuantity = filteredItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="max-w-7xl mx-auto space-y-4 px-3 sm:px-4 lg:px-0 animate-fade-in pb-10">
      {/* Provenance strip */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 transition-colors"
        >
          <ArrowLeft size={14} /> {DETAILS.backAction}
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-gray-400">
          <span className="mono">{formatString(DETAILS.raisedOnStrip, { timestamp: formatIndianDateTime(rfq.createdAt) })}</span>
          {/* Only when it differs: an unedited RFQ showing an "edited" timestamp
              reads as a change nobody made. */}
          {rfq.updatedAt && rfq.updatedAt !== rfq.createdAt && (
            <span className="mono">
              {formatString(DETAILS.updatedOnStrip, { timestamp: formatIndianDateTime(rfq.updatedAt) })}
            </span>
          )}
        </div>
      </div>

      {/* Header bar */}
      <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm p-4 sm:p-5 space-y-2">
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
            {rfq.status}
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 min-w-0">
            <h1 className="text-lg sm:text-xl lg:text-2xl font-black text-slate-900 dark:text-white mono tracking-tight break-all">
              {rfq.rfqNumber}
            </h1>
            <span className="text-xs text-slate-600 dark:text-gray-300 font-medium">{rfq.title}</span>
          </div>
          {/* Left out entirely rather than shown disabled when the screen is
              rendered without them, so nothing offers an action it cannot do. */}
          {(onEdit || onDelete) && (
            <div className="flex items-center gap-2 shrink-0">
              {onEdit && (
                <button
                  onClick={onEdit}
                  aria-label={formatString(EDIT.editAria, { rfqNumber: rfq.rfqNumber })}
                  className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Pencil size={12} /> {EDIT.editAction}
                </button>
              )}
              {onDelete && (
                <button
                  onClick={onDelete}
                  aria-label={formatString(EDIT.deleteAria, { rfqNumber: rfq.rfqNumber })}
                  className="btn btn-xs font-bold inline-flex items-center gap-1.5 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 size={12} /> {EDIT.deleteAction}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          title={DETAILS.submittedHeading}
          icon={<ClipboardList size={15} className="text-indigo-600 dark:text-indigo-400" />}
          meta={<span className="text-[10px] mono text-slate-400 dark:text-gray-500">{rfq.id}</span>}
        >
          <Row label={DETAILS.sourceLabel}>
            <span className="inline-flex items-center gap-1.5">
              {rfq.source === 'email_gateway' ? (
                <Mail size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              ) : rfq.source === 'manual_entry' ? (
                <Pencil size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <Globe size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              )}
              {rfq.source ? SOURCE_LABELS[rfq.source] : DETAILS.unsetValue}
            </span>
          </Row>
          <Row label={DETAILS.createdLabel}>
            <span className="mono">{formatIndianDateTime(rfq.createdAt)}</span>
          </Row>
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
              <Layers size={12} className="text-slate-400 shrink-0" />
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
            <span>
              <span className="inline-flex items-center gap-1.5 mono">
                <CalendarDays size={12} className="text-slate-400 shrink-0" />
                {orUnset(formatIndianDate(rfq.targetDeliveryDate))}
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
            </span>
          </Row>
          <Row label={DETAILS.deliveryLocationLabel}>
            <span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={12} className="text-rose-500 shrink-0" />
                {orUnset(rfq.deliveryLocation)}
              </span>
              {rfq.deliveryPincode && (
                <span className="block text-[10px] mono text-slate-400 dark:text-gray-500 mt-0.5">
                  {formatString(DETAILS.deliveryPincodeLabel, { pincode: rfq.deliveryPincode })}
                </span>
              )}
            </span>
          </Row>
        </Card>
      </div>

      {/* Line items */}
      <Panel
        title={DETAILS.lineItemsHeading}
        count={lineItems.length}
        subtitle={DETAILS.lineItemsSubtitle}
        toolbar={
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
            <div className="flex flex-col xs:flex-row sm:flex-row gap-2">
              <div className="relative flex items-center flex-1 sm:flex-none">
                <Search size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder={DETAILS.lineItemSearchPlaceholder}
                  aria-label={DETAILS.lineItemSearchAria}
                  className="text-xs w-full sm:w-48 lg:w-56 !py-1.5 !pl-8 !pr-2.5 rounded-lg border border-slate-200 dark:border-gray-800"
                />
              </div>
              <select
                value={minorFilter}
                onChange={(e) => setMinorFilter(e.target.value)}
                aria-label={DETAILS.minorFilterAria}
                className="text-xs font-semibold rounded-lg border border-slate-200 dark:border-gray-800 !py-1.5 !px-2.5 w-full sm:w-auto sm:max-w-[13rem]"
              >
                <option value={ALL_MINORS}>{DETAILS.allMinorCategories}</option>
                {minorCategories.map((minor) => (
                  <option key={minor} value={minor}>
                    {minor}
                  </option>
                ))}
              </select>
              {/* Sort control only renders on the mobile card list, where there are
                  no column headers to click. It mirrors the same sortKey/direction
                  state the desktop table's SortableHeader buttons drive. */}
              <select
                value={sortSelectValue}
                onChange={(e) => onSortSelectChange(e.target.value)}
                aria-label={DETAILS.colItem}
                className="md:hidden text-xs font-semibold rounded-lg border border-slate-200 dark:border-gray-800 !py-1.5 !px-2.5 w-full"
              >
                <option value="">Default order</option>
                <option value="item:asc">{DETAILS.colItem} A–Z</option>
                <option value="item:desc">{DETAILS.colItem} Z–A</option>
                <option value="category:asc">{DETAILS.colCategory} A–Z</option>
                <option value="quantity:desc">{DETAILS.colQty} ↓</option>
                <option value="quantity:asc">{DETAILS.colQty} ↑</option>
                <option value="targetDate:asc">{DETAILS.colTargetDate} ↑</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              {filtersApplied && (
                <button
                  onClick={clearFilters}
                  className="btn btn-ghost btn-xs font-bold inline-flex items-center gap-1 text-slate-500 dark:text-gray-400"
                >
                  <X size={12} /> {DETAILS.clearFiltersAction}
                </button>
              )}
              <a
                href={csvHref}
                download={`${rfq.rfqNumber}-line-items.csv`}
                aria-label={formatString(DETAILS.exportCsvAria, { rfqNumber: rfq.rfqNumber })}
                className="btn btn-secondary btn-xs font-bold flex items-center gap-1.5 flex-1 sm:flex-none justify-center"
              >
                <Download size={12} /> {DETAILS.exportCsvAction}
              </a>
            </div>
          </div>
        }
        footer={
          lineItems.length > 0 ? (
            <>
              <span>
                {formatString(DETAILS.displayingCount, { shown: filteredItems.length, total: lineItems.length })}
              </span>
              <span className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                <span className="inline-flex items-center gap-1">
                  {DETAILS.totalQuantityLabel}
                  <span className="mono font-bold text-slate-900 dark:text-white tabular-nums">
                    {totalQuantity}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck size={12} />
                  {formatString(DETAILS.parsedSuccessfully, { percent: classifiedPercent })}
                </span>
              </span>
            </>
          ) : undefined
        }
      >
        {lineItems.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-slate-500 dark:text-gray-400">{DETAILS.noLineItems}</p>
        ) : (
          <>
            {/* Desktop / tablet: full table, no horizontal scroll needed once it
                fits four columns instead of eight (spec sits under the item it
                describes, unit under the quantity it counts). */}
            <div className="hidden md:block border-t border-slate-200 dark:border-gray-800">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[640px]">
                  <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-gray-950/95 text-slate-600 dark:text-gray-400 text-[10px] uppercase tracking-wider font-bold">
                    <tr>
                      <th scope="col" className="w-10 px-3 py-2.5 text-right font-bold">
                        {DETAILS.colIndex}
                      </th>
                      <SortableHeader
                        column={DETAILS.colItem}
                        sortKey="item"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                      />
                      <SortableHeader
                        column={DETAILS.colCategory}
                        sortKey="category"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                      />
                      <SortableHeader
                        column={DETAILS.colQty}
                        sortKey="quantity"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                        align="right"
                      />
                      <SortableHeader
                        column={DETAILS.colTargetDate}
                        sortKey="targetDate"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                      />
                      <th scope="col" className="px-4 py-2.5 text-center font-bold">
                        {DETAILS.colConfidence}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item, index) => (
                      <tr
                        key={item.id}
                        className="align-top border-t border-slate-100 dark:border-gray-800/70 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors"
                      >
                        <td className="px-3 py-3 text-right mono text-[10px] text-slate-400 dark:text-gray-600 tabular-nums">
                          {index + 1}
                        </td>
                        <td className="px-4 py-3 max-w-md">
                          <span className="block font-semibold text-slate-900 dark:text-white leading-snug">
                            {item.itemName}
                          </span>
                          {item.technicalSpecs?.trim() && (
                            <span className="block mt-0.5 text-[11px] text-slate-500 dark:text-gray-400 leading-snug">
                              <span className="text-slate-400 dark:text-gray-600">{DETAILS.specsInlineLabel}: </span>
                              {item.technicalSpecs}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold whitespace-nowrap">
                            {item.minorCategory}
                          </span>
                          <span className="block mt-1 text-[10px] text-slate-500 dark:text-gray-500 leading-snug">
                            {item.majorCategory}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className="mono font-bold text-slate-900 dark:text-white tabular-nums">
                            {item.quantity}
                          </span>
                          <span className="block text-[10px] text-slate-500 dark:text-gray-400">{item.unit}</span>
                        </td>
                        <td className="px-4 py-3 mono whitespace-nowrap tabular-nums">{orUnset(formatIndianDate(item.targetDate))}</td>
                        <td className="px-4 py-3 text-center">
                          <ConfidenceBadge confidence={item.confidence} />
                        </td>
                      </tr>
                    ))}

                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center space-y-2">
                          <span className="block text-slate-400 dark:text-gray-500">{DETAILS.noLineItemMatches}</span>
                          <button
                            onClick={clearFilters}
                            className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1"
                          >
                            <X size={12} /> {DETAILS.clearFiltersAction}
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile: one card per row instead of a table forced into horizontal
                scroll, which would hide columns off-screen rather than reflow them. */}
            <div className="md:hidden border-t border-slate-200 dark:border-gray-800 divide-y divide-slate-100 dark:divide-gray-800/70">
              {visibleItems.length === 0 ? (
                <div className="px-4 py-10 text-center space-y-2">
                  <span className="block text-slate-400 dark:text-gray-500 text-xs">{DETAILS.noLineItemMatches}</span>
                  <button
                    onClick={clearFilters}
                    className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1"
                  >
                    <X size={12} /> {DETAILS.clearFiltersAction}
                  </button>
                </div>
              ) : (
                visibleItems.map((item, index) => (
                  <div key={item.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] mono text-slate-400 dark:text-gray-600 tabular-nums shrink-0 pt-0.5">
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-900 dark:text-white leading-snug text-xs">
                          {item.itemName}
                        </span>
                        {item.technicalSpecs?.trim() && (
                          <span className="block mt-0.5 text-[11px] text-slate-500 dark:text-gray-400 leading-snug">
                            <span className="text-slate-400 dark:text-gray-600">{DETAILS.specsInlineLabel}: </span>
                            {item.technicalSpecs}
                          </span>
                        )}
                      </div>
                      <ConfidenceBadge confidence={item.confidence} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold whitespace-nowrap">
                        {item.minorCategory}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-gray-500">{item.majorCategory}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-slate-100 dark:border-gray-800/70">
                      <CardField label={DETAILS.colQty}>
                        {item.quantity} <span className="font-normal text-slate-400">{item.unit}</span>
                      </CardField>
                      <CardField label={DETAILS.colTargetDate}>
                        <span className="mono">{orUnset(formatIndianDate(item.targetDate))}</span>
                      </CardField>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
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
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40"
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
                              date: formatIndianDate(file.uploadedAt),
                            })}`
                          : ''}
                      </span>
                    </span>
                  </span>
                  {/* Fetched with the session's Authorization header and opened as a
                      blob URL — a plain <a href> can't carry that header, and this
                      endpoint requires it. The browser still previews a PDF or image
                      inline from the blob exactly as it would from a direct URL. */}
                  <button
                    type="button"
                    onClick={() => handleViewAttachment(file)}
                    aria-label={formatString(DETAILS.attachmentViewAria, { fileName: file.fileName })}
                    className="btn btn-secondary btn-xs font-bold flex items-center justify-center gap-1 shrink-0 self-start sm:self-auto"
                  >
                    <ExternalLink size={11} /> {DETAILS.attachmentViewAction}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* Vendor quotations. No state tabs: quotation states are not modelled, so
          "Under Review" and "Shortlisted" could only ever show a hardcoded zero. */}
      <Panel title={DETAILS.quotesHeading} count={quotes.length}>
        {quotes.length === 0 ? (
          <div className="px-4 pb-10 pt-4 flex flex-col items-center text-center max-w-xl mx-auto space-y-3">
            <span className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
              <Inbox size={26} className="text-indigo-600 dark:text-indigo-400" />
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{DETAILS.noQuotes}</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400">{DETAILS.noQuotesMessage}</p>
          </div>
        ) : (
          <>
            {/* Desktop / tablet: comparison table. */}
            <div className="hidden md:block overflow-x-auto border-t border-slate-200 dark:border-gray-800">
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
                  {quotes.map((quote: QuoteComparison, index: number) => (
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

            {/* Mobile: one card per vendor. */}
            <div className="md:hidden border-t border-slate-200 dark:border-gray-800 divide-y divide-slate-100 dark:divide-gray-800/70">
              {quotes.map((quote: QuoteComparison) => (
                <div key={quote.vendorId} className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">{quote.vendorName}</span>
                    <span className="mono font-bold text-emerald-700 dark:text-emerald-400 text-xs shrink-0">
                      {quote.aiMatchScore}% {DETAILS.colMatchScore}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <CardField label={DETAILS.colUnitPrice}>
                      <span className="mono">{formatCurrency(quote.unitPrice)}</span>
                    </CardField>
                    <CardField label={DETAILS.colTotalPrice}>
                      <span className="mono">{formatCurrency(quote.totalPrice)}</span>
                    </CardField>
                    <CardField label={DETAILS.colLeadTime}>
                      {formatString(DETAILS.leadTimeDays, { days: quote.leadTimeDays })}
                    </CardField>
                    <CardField label={DETAILS.colCompliance}>{quote.complianceStatus}</CardField>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}