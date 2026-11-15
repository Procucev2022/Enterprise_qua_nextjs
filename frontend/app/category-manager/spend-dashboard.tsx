'use client';

import React from 'react';
import { useApp } from '@/lib/store';
import { rfqsInWindow, growthPercentFor, GrowthBadge } from './category-summary-dashboard';
import {
  ArrowLeft,
  BarChart3,
  Download,
  FileText,
  Layers,
  Mail,
  MessageSquare,
  Phone,
  PieChart,
  Smartphone,
  Users,
  Zap,
} from 'lucide-react';

import type { AuditLogEntry, RFQFollowUpBreakdown, RFQItem } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';

const QUARTER_DAYS = 90;

// Shown wherever a figure cannot be computed from the records, for example a
// rate with no invitations behind it. Never a substitute number.
const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

interface ModeMetrics {
  rfqs: RFQItem[];
  downloads: number;
  efficiency: number | null;
  ratio: number | null;
}

export function normalizeModeToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Average days from RFQ creation to each vendor quote submission. A quote or
 * RFQ without a valid timestamp is left out. Returns a dash when no pair of
 * timestamps is usable.
 */
export function calculateTurnaround(modeRfqs: RFQItem[]): string {
  if (modeRfqs.length === 0) return EMPTY_VALUE;
  const durations: number[] = [];
  modeRfqs.forEach((r) => {
    const created = r.createdAt ? new Date(r.createdAt).getTime() : Number.NaN;
    if (Number.isNaN(created)) return;
    (r.quotes || []).forEach((q) => {
      const submitted = q.submittedAt ? new Date(q.submittedAt).getTime() : Number.NaN;
      if (!Number.isNaN(submitted) && submitted > created) {
        durations.push((submitted - created) / (1000 * 60 * 60 * 24));
      }
    });
  });
  if (durations.length === 0) return EMPTY_VALUE;
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return `${avg.toFixed(1)} Days`;
}

export function calculateModeMetrics(rfqs: RFQItem[], auditLogs: AuditLogEntry[], modeToken: string): ModeMetrics {
  const normTarget = normalizeModeToken(modeToken);
  const modeRfqs = rfqs.filter((r) => {
    const rawMode = r.sourcingMode || '';
    const norm = normalizeModeToken(rawMode);
    return norm.includes(normTarget) || (normTarget === 'MODE1' && (norm.includes('MODE0') || norm.includes('V0')));
  });
  const rfqIdSet = new Set(modeRfqs.flatMap((r) => [r.rfqNumber, r.id]).filter(Boolean));
  const downloads = auditLogs.filter((l) => {
    if (!/downloaded RFQ specification/i.test(l.action)) return false;
    if (l.rfqNumber && rfqIdSet.has(l.rfqNumber as string)) return true;
    return modeRfqs.some((r) => (r.rfqNumber && l.action.includes(r.rfqNumber)) || (r.id && l.action.includes(r.id)));
  }).length;
  const invited = modeRfqs.reduce((sum, r) => sum + (r.followUpData?.totalInvited || 0), 0);
  const responded = modeRfqs.reduce((sum, r) => sum + (r.followUpData?.respondedCount || 0), 0);
  const efficiency = invited > 0 ? Number(((responded / invited) * 100).toFixed(1)) : null;
  const ratio = modeRfqs.length > 0 ? Number((downloads / modeRfqs.length).toFixed(1)) : null;

  return { rfqs: modeRfqs, downloads, efficiency, ratio };
}

/** Adds up one numeric follow-up counter across every RFQ. A missing counter adds nothing. */
function sumFollowUp(
  followUps: RFQFollowUpBreakdown[],
  pick: (followUp: RFQFollowUpBreakdown) => number | undefined
): number {
  return followUps.reduce((sum, followUp) => sum + (pick(followUp) || 0), 0);
}

/** Share of attempts that got a response, or null when no attempts were recorded. */
function rateOf(hits: number, total: number): number | null {
  return total > 0 ? (hits / total) * 100 : null;
}

function formatRate(rate: number | null): string {
  return rate === null ? EMPTY_VALUE : `${rate.toFixed(1)}%`;
}

interface SpendDashboardProps {
  onBackToKanban: () => void;
  onNavigateToAllRfqs?: () => void;
  onNavigateToVendorConsole?: () => void;
  onNavigateToKanban?: () => void;
}

export default function SpendDashboard({
  onBackToKanban,
  onNavigateToAllRfqs,
  onNavigateToVendorConsole,
  onNavigateToKanban,
}: SpendDashboardProps) {
  const { rfqs, auditLogs } = useApp();

  // Quarter-scoped RFQ count and quarter-over-quarter growth, from the same
  // helpers category-summary-dashboard.tsx uses.
  const totalRfqsRaised = rfqsInWindow(rfqs, QUARTER_DAYS, 0).length;
  const rfqGrowth = growthPercentFor(rfqs, QUARTER_DAYS);
  const avgRfqsPerDay = (totalRfqsRaised / QUARTER_DAYS).toFixed(1);

  // Downloads are counted from the audit-log entries the vendor download
  // actions write (quotation-form.tsx / opportunity-feed.tsx).
  const totalRfqsDownloaded = auditLogs.filter((l) => /downloaded RFQ specification/.test(l.action)).length;
  const avgDownloadsPerDay = (totalRfqsDownloaded / QUARTER_DAYS).toFixed(1);
  const avgDownloadsPerRfq = totalRfqsRaised > 0 ? (totalRfqsDownloaded / totalRfqsRaised).toFixed(1) : EMPTY_VALUE;

  // Average vendors invited per RFQ. assignedVendors is the only list of
  // vendors associated with an RFQ.
  const avgVendorsPerRfq =
    rfqs.length > 0
      ? (rfqs.reduce((sum, r) => sum + (r.assignedVendors?.length || 0), 0) / rfqs.length).toFixed(1)
      : EMPTY_VALUE;

  // Vendor response rate across every RFQ's recorded follow-up counts.
  const followUps = rfqs.flatMap((r) => (r.followUpData ? [r.followUpData] : []));
  const vendorsInvited = sumFollowUp(followUps, (f) => f.totalInvited);
  const vendorsResponded = sumFollowUp(followUps, (f) => f.respondedCount);
  const vendorResponseRate = formatRate(rateOf(vendorsResponded, vendorsInvited));

  // Sourcing mode breakdown, computed from the RFQs and audit logs of each mode.
  const m1 = calculateModeMetrics(rfqs, auditLogs, 'MODE 1');
  const m2 = calculateModeMetrics(rfqs, auditLogs, 'MODE 2');
  const m3 = calculateModeMetrics(rfqs, auditLogs, 'MODE 3');

  const modePerformance = [
    {
      id: 'mode-1',
      modeCode: 'MODE 1',
      title: 'Private Client Roster',
      description: 'Exclusive buyer-uploaded vendor pool. Vendors enjoy unlimited RFQ views & downloads.',
      badgeColor: '#4f46e5',
      rfqsRaised: m1.rfqs.length,
      rfqsDownloaded: m1.downloads,
      downloadRatio: m1.ratio === null ? EMPTY_VALUE : `${m1.ratio.toFixed(1)} downloads / RFQ`,
      followUpEfficiency: m1.efficiency,
      avgTurnaround: calculateTurnaround(m1.rfqs),
    },
    {
      id: 'mode-2',
      modeCode: 'MODE 2',
      title: 'Hybrid Base Network',
      description: 'Hybrid sourcing combining client roster with pre-vetted marketplace suppliers.',
      badgeColor: '#0284c7',
      rfqsRaised: m2.rfqs.length,
      rfqsDownloaded: m2.downloads,
      downloadRatio: m2.ratio === null ? EMPTY_VALUE : `${m2.ratio.toFixed(1)} downloads / RFQ`,
      followUpEfficiency: m2.efficiency,
      avgTurnaround: calculateTurnaround(m2.rfqs),
    },
    {
      id: 'mode-3',
      modeCode: 'MODE 3',
      title: '360° AI Evaluated Roster',
      description: 'Open network marketplace with autonomous OCR extraction & multi-tier scoring.',
      badgeColor: '#9333ea',
      rfqsRaised: m3.rfqs.length,
      rfqsDownloaded: m3.downloads,
      downloadRatio: m3.ratio === null ? EMPTY_VALUE : `${m3.ratio.toFixed(1)} downloads / RFQ`,
      followUpEfficiency: m3.efficiency,
      avgTurnaround: calculateTurnaround(m3.rfqs),
    },
  ];

  const shareOfDownloads = (downloads: number): string | null =>
    totalRfqsDownloaded > 0 ? ((downloads / totalRfqsDownloaded) * 100).toFixed(1) : null;
  const mode1Share = shareOfDownloads(m1.downloads);
  const mode2Share = shareOfDownloads(m2.downloads);
  const mode3Share = shareOfDownloads(m3.downloads);

  // Recorded follow-up attempts and responses per channel, summed across RFQs.
  // A channel with no recorded attempts shows a dash rather than a rate.
  const channelRows = [
    {
      id: 'whatsapp',
      label: 'WhatsApp replies',
      Icon: MessageSquare,
      hits: sumFollowUp(followUps, (f) => f.whatsappStats?.replied),
      total: sumFollowUp(followUps, (f) => f.whatsappStats?.total),
      panelClass: 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-500/30',
      textClass: 'text-emerald-800 dark:text-emerald-300',
      valueClass: 'text-emerald-700 dark:text-emerald-400',
      barClass: 'bg-emerald-600',
    },
    {
      id: 'calls',
      label: 'Voice call connections',
      Icon: Phone,
      hits: sumFollowUp(followUps, (f) => f.callStats?.connected),
      total: sumFollowUp(followUps, (f) => f.callStats?.total),
      panelClass: 'bg-purple-50/60 dark:bg-purple-950/20 border-purple-200 dark:border-purple-500/30',
      textClass: 'text-purple-800 dark:text-purple-300',
      valueClass: 'text-purple-700 dark:text-purple-400',
      barClass: 'bg-purple-600',
    },
    {
      id: 'email',
      label: 'Email opens',
      Icon: Mail,
      hits: sumFollowUp(followUps, (f) => f.emailStats?.opened),
      total: sumFollowUp(followUps, (f) => f.emailStats?.total),
      panelClass: 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/30',
      textClass: 'text-amber-800 dark:text-amber-300',
      valueClass: 'text-amber-700 dark:text-amber-400',
      barClass: 'bg-amber-500',
    },
    {
      id: 'sms',
      label: 'SMS link clicks',
      Icon: Smartphone,
      hits: sumFollowUp(followUps, (f) => f.smsStats?.clicked),
      total: sumFollowUp(followUps, (f) => f.smsStats?.total),
      panelClass: 'bg-sky-50/60 dark:bg-cyan-950/20 border-sky-200 dark:border-cyan-500/30',
      textClass: 'text-sky-800 dark:text-cyan-300',
      valueClass: 'text-sky-700 dark:text-cyan-400',
      barClass: 'bg-sky-500',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Back button */}
      <div className="flex items-center justify-between pb-1">
        <button
          onClick={onBackToKanban}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors font-medium"
        >
          <ArrowLeft size={14} /> Back to Operational Monitoring Kanban
        </button>
      </div>

      {/* Top KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* RFQs Received */}
        <button
          type="button"
          onClick={onNavigateToAllRfqs}
          disabled={!onNavigateToAllRfqs}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-indigo-300 dark:enabled:hover:border-indigo-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>RFQs Received (Raised)</span>
            <FileText size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-3xl font-extrabold text-slate-900 dark:text-white mono">{totalRfqsRaised}</p>
            <span className="text-[11px] text-indigo-700 dark:text-indigo-300 font-extrabold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
              Avg {avgRfqsPerDay} / day
            </span>
          </div>
          <div className="mt-1 text-[11px] font-semibold">
            <GrowthBadge value={rfqGrowth} /> <span className="text-slate-500 dark:text-gray-400">vs previous quarter</span>
          </div>
        </button>

        {/* RFQs Downloaded */}
        <button
          type="button"
          onClick={onNavigateToAllRfqs}
          disabled={!onNavigateToAllRfqs}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-sky-300 dark:enabled:hover:border-sky-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>RFQs Downloaded</span>
            <Download size={16} className="text-sky-600 dark:text-cyan-400" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-3xl font-extrabold text-slate-900 dark:text-white mono">{totalRfqsDownloaded}</p>
            <span className="text-[11px] text-sky-700 dark:text-cyan-300 font-extrabold bg-sky-50 dark:bg-cyan-950/60 px-2 py-0.5 rounded-md border border-sky-200 dark:border-sky-800">
              Avg {avgDownloadsPerDay} / day
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-gray-400 font-semibold">
            Avg {avgDownloadsPerRfq} downloads per RFQ
          </div>
        </button>

        {/* Avg Vendors Invited Per RFQ */}
        <button
          type="button"
          onClick={onNavigateToVendorConsole}
          disabled={!onNavigateToVendorConsole}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-purple-300 dark:enabled:hover:border-purple-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>Avg Vendors / RFQ</span>
            <Users size={16} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-3xl font-extrabold text-slate-900 dark:text-white mono">{avgVendorsPerRfq}</p>
            <span className="text-[11px] text-purple-700 dark:text-purple-300 font-extrabold bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800">
              Vendors / RFQ
            </span>
          </div>
          <div className="mt-1 text-[11px] text-purple-600 dark:text-purple-400 font-semibold">
            Average vendors invited per RFQ
          </div>
        </button>

        {/* Vendor Response Rate */}
        <button
          type="button"
          onClick={onNavigateToKanban}
          disabled={!onNavigateToKanban}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-amber-300 dark:enabled:hover:border-amber-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>Vendor Response Rate</span>
            <Zap size={16} className="text-amber-500 dark:text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-amber-600 dark:text-amber-400 mono mt-2">{vendorResponseRate}</p>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-gray-400">
            Vendors who responded to outreach
          </div>
        </button>
      </div>

      {/* ── Mode-by-Mode RFQ & Follow-Up Performance Matrix ── */}
      <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Sourcing Mode Efficiency & RFQ Performance Comparison
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-gray-400 font-semibold">Mode 1 vs Mode 2 vs Mode 3</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modePerformance.map((mode) => (
            <div
              key={mode.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/70 dark:bg-gray-950/60 hover:border-indigo-300 dark:hover:border-indigo-700/50 transition-all space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className="px-2.5 py-1 rounded text-xs font-bold tracking-wider"
                    style={{
                      backgroundColor: `${mode.badgeColor}15`,
                      color: mode.badgeColor,
                      border: `1px solid ${mode.badgeColor}35`,
                    }}
                  >
                    {mode.modeCode}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 dark:text-gray-400">
                    Avg turnaround: <strong className="text-slate-900 dark:text-white">{mode.avgTurnaround}</strong>
                  </span>
                </div>
                <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">{mode.title}</h4>
                <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                  {mode.description}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-gray-800 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-gray-400 font-medium">RFQs Raised</span>
                  <span className="font-extrabold text-slate-900 dark:text-white mono">{mode.rfqsRaised} RFQs</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-gray-400 font-medium">RFQs Downloaded</span>
                  <span className="font-extrabold text-sky-700 dark:text-cyan-300 mono">{mode.rfqsDownloaded} RFQs</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-gray-400 font-medium font-mono text-[11px]">Download Ratio</span>
                  <span className="font-semibold text-slate-700 dark:text-gray-300 text-[11px]">{mode.downloadRatio}</span>
                </div>

                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-slate-700 dark:text-gray-300">Follow-Up Response Rate</span>
                    <span className="font-black text-emerald-600 dark:text-emerald-400 mono">
                      {mode.followUpEfficiency === null ? EMPTY_VALUE : `${mode.followUpEfficiency}%`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all"
                      style={{ width: `${mode.followUpEfficiency ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Download share and channel response breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sourcing Engine RFQ Download Share */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <PieChart size={16} className="text-indigo-600 dark:text-indigo-400" /> Sourcing Engine RFQ Download Share
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-gray-400">Total {totalRfqsDownloaded} Downloads</span>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <div className="flex justify-between text-slate-700 dark:text-gray-300 font-semibold mb-1">
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block" /> Mode 1 (Private Client Roster)
                </span>
                <span className="mono text-slate-900 dark:text-white font-bold">
                  {m1.downloads} Downloads ({mode1Share === null ? EMPTY_VALUE : `${mode1Share}%`})
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${mode1Share ?? 0}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-slate-700 dark:text-gray-300 font-semibold mb-1">
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" /> Mode 2 (Hybrid Base Network)
                </span>
                <span className="mono text-slate-900 dark:text-white font-bold">
                  {m2.downloads} Downloads ({mode2Share === null ? EMPTY_VALUE : `${mode2Share}%`})
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                <div className="bg-sky-500 h-full rounded-full" style={{ width: `${mode2Share ?? 0}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-slate-700 dark:text-gray-300 font-semibold mb-1">
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" /> Mode 3 (360° AI Evaluated Roster)
                </span>
                <span className="mono text-slate-900 dark:text-white font-bold">
                  {m3.downloads} Downloads ({mode3Share === null ? EMPTY_VALUE : `${mode3Share}%`})
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                <div className="bg-purple-600 h-full rounded-full" style={{ width: `${mode3Share ?? 0}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Recorded follow-up responses by channel */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BarChart3 size={16} className="text-emerald-600 dark:text-emerald-400" /> Multi-Channel Follow-Up Conversion Rate
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-gray-400">Recorded attempts</span>
          </div>

          <div className="space-y-3 text-xs">
            {channelRows.map((channel) => {
              const rate = rateOf(channel.hits, channel.total);
              return (
                <div key={channel.id} className={`p-2.5 rounded-xl border ${channel.panelClass}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className={`font-bold flex items-center gap-1.5 ${channel.textClass}`}>
                      <channel.Icon size={13} /> {channel.label}
                    </span>
                    <span className={`text-sm font-extrabold mono ${channel.valueClass}`}>{formatRate(rate)}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400">
                    {channel.total > 0
                      ? `${channel.hits} of ${channel.total} recorded attempts`
                      : 'No attempts recorded for this channel'}
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden my-1">
                    <div className={`${channel.barClass} h-full rounded-full`} style={{ width: `${rate ?? 0}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
