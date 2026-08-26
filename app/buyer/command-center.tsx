'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { SOURCING_MODES } from '@/lib/mock-data';
import { RFQItem } from '@/lib/types';
import { RFQFollowUpDeepDiveModal, MultiChannelChaserModal } from '@/app/components/Modals';
import {
  TrendingUp,
  FileText,
  Clock,
  Plus,
  UploadCloud,
  Sparkles,
  Bot,
  Layers,
  ChevronRight,
  Download,
  Search,
  MessageSquare,
  Phone,
  Smartphone,
  Mail,
} from 'lucide-react';

interface CommandCenterProps {
  onNavigateToWizard: () => void;
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToSubscription?: () => void;
}

export default function CommandCenter({ onNavigateToWizard, onNavigateToMatrix, onNavigateToSubscription }: CommandCenterProps) {
  const {
    rfqs,
    aiFeed,
    currentMode,
    setSelectedRFQForMatrix,
    showToast,
    selectedRFQForDeepDive,
    setSelectedRFQForDeepDive,
    deepDiveModalOpen,
    setDeepDiveModalOpen,
    openRFQDeepDive,
    remainingFreeRFQs,
    activeSubscription,
  } = useApp();

  const [feedChannelFilter, setFeedChannelFilter] = useState<'all' | 'call' | 'whatsapp' | 'sms' | 'email' | 'system'>('all');
  const [quickChaserModalOpen, setQuickChaserModalOpen] = useState(false);
  const [quickChaserData, setQuickChaserData] = useState<{ rfqNumber: string; vendorName: string }>({
    rfqNumber: 'RFQ-2026-00421',
    vendorName: 'Apex Supplies Ltd.',
  });

  const totalActiveRFQs = rfqs.length;
  const totalPendingQuotes = rfqs.reduce((acc, r) => acc + (r.quotesCount || 0), 0) + 24;
  const totalSpend = '$1.24M';

  // Multi-channel totals calculation
  const totalCalls = rfqs.reduce((acc, r) => acc + (r.followUpData?.callStats.total || 0), 0);
  const connectedCalls = rfqs.reduce((acc, r) => acc + (r.followUpData?.callStats.connected || 0), 0);
  const totalWhatsApp = rfqs.reduce((acc, r) => acc + (r.followUpData?.whatsappStats.total || 0), 0);
  const readWhatsApp = rfqs.reduce((acc, r) => acc + (r.followUpData?.whatsappStats.read || 0), 0);
  const totalSMS = rfqs.reduce((acc, r) => acc + (r.followUpData?.smsStats.total || 0), 0);
  const totalFollowupsToday = totalCalls + totalWhatsApp + totalSMS;

  const getModeBadge = (modeId: string) => {
    const mode = SOURCING_MODES.find((m) => m.id === modeId);
    if (!mode) return null;
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
        style={{
          backgroundColor: `${mode.badgeColor}15`,
          color: mode.badgeColor,
          border: `1px solid ${mode.badgeColor}35`,
        }}
      >
        {mode.code}
      </span>
    );
  };

  const getStatusBadge = (status: RFQItem['status']) => {
    switch (status) {
      case 'AI Recommended':
        return <span className="badge badge-emerald">AI Recommended</span>;
      case 'In Evaluation':
        return <span className="badge badge-blue">In Evaluation</span>;
      case 'PO Generated':
        return <span className="badge badge-purple">PO Generated</span>;
      case 'Parsing':
        return <span className="badge badge-amber">OCR Parsing</span>;
      default:
        return <span className="badge badge-blue">{status}</span>;
    }
  };

  const filteredFeed = aiFeed.filter((item) => {
    if (feedChannelFilter === 'all') return true;
    if (feedChannelFilter === 'call') return item.type === 'call' || item.channel === 'call';
    if (feedChannelFilter === 'whatsapp') return item.type === 'whatsapp' || item.channel === 'whatsapp';
    if (feedChannelFilter === 'sms') return item.type === 'sms' || item.channel === 'sms';
    if (feedChannelFilter === 'email') return item.type === 'email' || item.channel === 'email';
    if (feedChannelFilter === 'system') return item.type === 'scoring' || item.type === 'ingestion' || item.type === 'escalation' || item.type === 'approval';
    return true;
  });

  const channelFilterTabs = [
    { key: 'all' as const, label: 'All', count: aiFeed.length, activeClass: 'bg-slate-800 dark:bg-white text-white dark:text-slate-900' },
    { key: 'call' as const, label: 'Calls', icon: <Phone size={11} />, activeClass: 'bg-purple-600 text-white' },
    { key: 'whatsapp' as const, label: 'WA', icon: <MessageSquare size={11} />, activeClass: 'bg-emerald-600 text-white' },
    { key: 'sms' as const, label: 'SMS', icon: <Smartphone size={11} />, activeClass: 'bg-sky-600 text-white' },
    { key: 'email' as const, label: 'Email (24h)', icon: <Mail size={11} />, activeClass: 'bg-amber-600 text-white' },
    { key: 'system' as const, label: 'System', activeClass: 'bg-indigo-600 text-white' },
  ];

  return (
    <div className="space-y-5 animate-fade-in pb-10">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Buyer Command Center
          </h1>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
            Pipeline overview · Multi-channel follow-ups · Spend metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onNavigateToWizard} className="btn btn-primary btn-sm">
            <Plus size={14} /> New RFQ
          </button>
          <button
            onClick={() => {
              onNavigateToWizard();
              showToast('Upload BOQ Ready', 'Drag and drop your BOQ spreadsheet for automated entity extraction.', 'info');
            }}
            className="btn btn-secondary btn-sm"
          >
            <UploadCloud size={13} /> Upload BOQ
          </button>
          <button
            onClick={() => showToast('Analytics Exported', 'Executive spend & procurement pipeline exported to Excel.', 'info')}
            className="btn btn-secondary btn-sm"
          >
            <Download size={13} />
          </button>
        </div>
      </div>

      {/* Subscription Quota Banner */}
      <div className="glass-panel p-4 rounded-2xl border border-indigo-200/40 dark:border-indigo-950/40 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 dark:from-indigo-950/20 dark:to-purple-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/10 dark:bg-indigo-400/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-2">
              Sourcing Plan: {activeSubscription === 'free_trial' ? 'Free Trial (Version 1)' : activeSubscription === 'version_1' ? 'Version 1 (Client Roster)' : activeSubscription === 'version_2' ? 'Version 2 (Hybrid Sourcing)' : 'Version 3 (AI Autonomous Sourcing)'}
              {activeSubscription === 'free_trial' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300">
                  {remainingFreeRFQs} of 5 free V1 RFQs left
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
              {activeSubscription === 'free_trial' 
                ? 'Your free trial lets you experience Version 1 (Client Roster sourcing) for up to 5 RFQs. Upgrade to subscribe to other modes.' 
                : 'Your premium sourcing plan is active. All dispatch features for this mode are fully unlocked.'}
            </p>
          </div>
        </div>
        {onNavigateToSubscription && (
          <button
            onClick={onNavigateToSubscription}
            className="btn btn-primary btn-xs flex items-center gap-1 shrink-0"
          >
            Manage Subscription <ChevronRight size={10} />
          </button>
        )}
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Active RFQs */}
        <div className="rounded-2xl p-5 bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 relative overflow-hidden hover:border-indigo-400 dark:hover:border-indigo-500 transition-all shadow-xs flex flex-col justify-between min-h-[124px]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Active RFQs</span>
            <FileText size={16} className="text-indigo-500 dark:text-indigo-400" />
          </div>
          <div className="flex items-baseline justify-between mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900 dark:text-white mono">{totalActiveRFQs}</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                <TrendingUp size={11} /> +3 this week
              </span>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-cyan-500" />
        </div>

        {/* Pending Quotes */}
        <div className="rounded-2xl p-5 bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 relative overflow-hidden hover:border-sky-400 dark:hover:border-sky-500 transition-all shadow-xs flex flex-col justify-between min-h-[124px]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Pending Quotes</span>
            <Clock size={16} className="text-sky-500 dark:text-cyan-400" />
          </div>
          <div className="flex items-baseline justify-between mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900 dark:text-white mono">{totalPendingQuotes}</span>
              <span className="text-xs text-sky-600 dark:text-cyan-400 font-bold bg-sky-50 dark:bg-cyan-950/60 px-2 py-0.5 rounded-full border border-sky-200 dark:border-cyan-800">
                8 in review
              </span>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
        </div>

        {/* Follow Ups Today */}
        <div
          onClick={() => openRFQDeepDive(rfqs[0])}
          className="rounded-2xl p-5 bg-white dark:bg-gray-900/80 border border-emerald-200 dark:border-emerald-500/30 relative overflow-hidden hover:border-emerald-400 dark:hover:border-emerald-400 cursor-pointer transition-all shadow-xs flex flex-col justify-between min-h-[124px]"
          title="Click to open multi-channel deep dive"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Follow Ups Today</span>
              <span className="live-dot" style={{ width: 6, height: 6 }} />
            </div>
            <div className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
              <span>Deep Dive</span>
              <ChevronRight size={12} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-3xl font-black text-slate-900 dark:text-white mono">{totalFollowupsToday || 31}</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center gap-1">
                📞 {totalCalls || 9}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                💬 {totalWhatsApp || 14}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 dark:bg-cyan-950/60 text-sky-600 dark:text-cyan-300 border border-sky-200 dark:border-cyan-800 flex items-center gap-1">
                📱 {totalSMS || 6}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                ✉️ 2
              </span>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-emerald-500 to-amber-500" />
        </div>
      </div>

      {/* ── Main Grid: Pipeline + Vendor Follow Up Status ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* ── Left: Pipeline Table (3 cols) ── */}
        <div className="lg:col-span-3 rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          {/* Table Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-gray-200">Active Procurement Pipeline</h2>
            </div>
            <span className="text-[10px] text-slate-400 dark:text-gray-500">{rfqs.length} events</span>
          </div>

          {/* Pipeline Cards */}
          <div className="divide-y divide-slate-100 dark:divide-gray-800/60">
            {rfqs.map((rfq) => (
              <div
                key={rfq.id}
                className="px-5 py-3.5 hover:bg-slate-50/80 dark:hover:bg-gray-800/30 transition-colors cursor-pointer group"
                onClick={() => openRFQDeepDive(rfq)}
              >
                {/* Row 1: RFQ Number + Status + Actions */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white mono group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                      {rfq.rfqNumber}
                    </span>
                    {rfq.aiScore && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
                        {rfq.aiScore}%
                      </span>
                    )}
                    {getModeBadge(rfq.sourcingMode)}
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(rfq.status)}
                    {rfq.status === 'AI Recommended' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRFQForMatrix(rfq);
                          onNavigateToMatrix(rfq);
                        }}
                        className="btn btn-emerald text-[10px] px-2 py-1"
                        style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px' }}
                      >
                        <Sparkles size={10} /> Matrix
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openRFQDeepDive(rfq);
                        }}
                        className="text-slate-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Row 2: Title & Category */}
                <p className="text-xs text-slate-700 dark:text-gray-300 font-medium leading-snug">{rfq.title}</p>
                <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">{rfq.category}</p>

                {/* Row 3: Channel stats + Quotes */}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    {rfq.followUpData ? (
                      <>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-300 border border-purple-100 dark:border-purple-800">
                          📞 {rfq.followUpData.callStats.connected}/{rfq.followUpData.callStats.total}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800">
                          💬 {rfq.followUpData.whatsappStats.read}/{rfq.followUpData.whatsappStats.total}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-sky-50 dark:bg-cyan-950/50 text-sky-600 dark:text-cyan-300 border border-sky-100 dark:border-cyan-800">
                          📱 {rfq.followUpData.smsStats.delivered}
                        </span>
                        <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-medium ml-1">
                          {rfq.followUpData.respondedCount}/{rfq.followUpData.totalInvited} responded
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-slate-300 dark:text-gray-600 italic">Queued</span>
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-gray-400 mono bg-slate-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                    {rfq.quotesCount} quotes
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: Vendor Follow Up Status (2 cols) ── */}
        <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <span className="live-dot" style={{ width: 6, height: 6 }} />
              <h2 className="text-sm font-bold text-slate-800 dark:text-gray-200">
                Vendor Follow Up Status
              </h2>
            </div>
            <span className="text-[9px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/20 font-bold">
              Live
            </span>
          </div>

          {/* Channel Filters */}
          <div className="flex items-center gap-1 px-4 py-2.5 border-b border-slate-50 dark:border-gray-800/60 overflow-x-auto">
            {channelFilterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFeedChannelFilter(tab.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1 ${
                  feedChannelFilter === tab.key
                    ? tab.activeClass
                    : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.count !== undefined && ` (${tab.count})`}
              </button>
            ))}
          </div>

          {/* Feed Stream */}
          <div className="flex-1 overflow-y-auto max-h-[480px] px-3 py-2 space-y-2">
            {filteredFeed.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-lg bg-slate-50/80 dark:bg-gray-900/60 border border-slate-100 dark:border-gray-800 hover:border-slate-200 dark:hover:border-gray-700 transition-all group"
              >
                {/* Title + Timestamp */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[11px] font-bold leading-tight">
                    {item.type === 'call' || item.channel === 'call' ? (
                      <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1">
                        <Phone size={11} /> {item.title}
                      </span>
                    ) : item.type === 'whatsapp' || item.channel === 'whatsapp' ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <MessageSquare size={11} /> {item.title}
                      </span>
                    ) : item.type === 'sms' || item.channel === 'sms' ? (
                      <span className="text-sky-600 dark:text-cyan-400 flex items-center gap-1">
                        <Smartphone size={11} /> {item.title}
                      </span>
                    ) : item.type === 'email' || item.channel === 'email' ? (
                      <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <Mail size={11} /> {item.title}
                      </span>
                    ) : (
                      <span className="text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                        <Sparkles size={11} /> {item.title}
                      </span>
                    )}
                  </span>
                  <span className="mono text-[9px] text-slate-400 dark:text-gray-500 shrink-0">{item.timestamp}</span>
                </div>

                {/* Message */}
                <p className="text-[11px] text-slate-600 dark:text-gray-400 leading-relaxed line-clamp-2">{item.message}</p>

                {/* Call Duration */}
                {item.channelDetails?.duration && (
                  <div className="mt-1.5 text-[9px] text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2 py-1 rounded inline-flex items-center gap-1">
                    ⏱️ <span className="font-bold mono">{item.channelDetails.duration}</span> · Transcript logged
                  </div>
                )}

                {/* Footer: Target + RFQ link */}
                <div className="flex items-center justify-between mt-1.5 text-[9px] text-slate-400 dark:text-gray-500">
                  {item.recipient && (
                    <span>
                      Target: <span className="text-slate-600 dark:text-gray-300 font-medium">{item.recipient}</span>
                    </span>
                  )}
                  {item.rfqNumber && (
                    <button
                      onClick={() => {
                        const targetRfq = rfqs.find((r) => r.rfqNumber === item.rfqNumber);
                        if (targetRfq) openRFQDeepDive(targetRfq);
                      }}
                      className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline mono"
                    >
                      {item.rfqNumber} ↗
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-gray-800 text-[10px] text-slate-400 dark:text-gray-500 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span className="live-dot" style={{ width: 5, height: 5 }} /> Voice, WhatsApp & SMS
            </span>
            <span className="text-indigo-500 dark:text-indigo-400 font-semibold">24/7 Active</span>
          </div>
        </div>
      </div>

      {/* RFQ Follow-Up Multi-Channel Deep Dive Modal */}
      <RFQFollowUpDeepDiveModal
        isOpen={deepDiveModalOpen}
        onClose={() => setDeepDiveModalOpen(false)}
        rfq={selectedRFQForDeepDive}
      />

      {/* Multi-Channel Quick Chaser Modal */}
      <MultiChannelChaserModal
        isOpen={quickChaserModalOpen}
        onClose={() => setQuickChaserModalOpen(false)}
        rfqNumber={quickChaserData.rfqNumber}
        vendorName={quickChaserData.vendorName}
      />
    </div>
  );
}
