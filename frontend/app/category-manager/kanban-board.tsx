'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem } from '@/lib/types';
import { MultiChannelChaserModal, VendorSurveyModal, RFQFollowUpDeepDiveModal } from '@/app/components/Modals';
import {
  SlidersHorizontal,
  MessageSquare,
  Sparkles,
  Share2,
  AlertTriangle,
  FileCheck,
  Send,
  Layers,
  ChevronRight,
  Clock,
  CheckCircle2,
  Sliders,
  TrendingUp,
  Search,
  Zap,
  FileText,
  Download,
  Mail,
  Phone,
  Smartphone,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';
import { KANBAN_CARD_RFQ_REFS, FALLBACK_RFQ_TEMPLATE } from '@/lib/constants';

interface KanbanBoardProps {
  onNavigateToMatrix?: (rfq: RFQItem) => void;
  onNavigateToSpend?: () => void;
}

export default function KanbanBoard({ onNavigateToMatrix, onNavigateToSpend }: KanbanBoardProps) {
  const {
    rfqs,
    triggerChannelChaser,
    triggerBatchChannelChaser,
    addAuditLog,
    showToast,
    setSelectedRFQForMatrix,
    openRFQDeepDive,
    deepDiveModalOpen,
    setDeepDiveModalOpen,
    selectedRFQForDeepDive,
  } = useApp();

  const [chaserModalOpen, setChaserModalOpen] = useState(false);
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [selectedRfqForChaser, setSelectedRfqForChaser] = useState<string>('RFQ-2026-00421');
  const [targetVendor, setTargetVendor] = useState<string>('Apex Supplies Ltd.');
  const [chaserInitialChannel, setChaserInitialChannel] = useState<'call' | 'whatsapp' | 'sms'>('whatsapp');

  /**
   * Resolves a static pipeline card's RFQ reference against the live RFQ
   * collection. Falls back to a well-formed skeleton so card handlers and
   * navigation callbacks never receive `undefined` when the pipeline is empty
   * or still hydrating from the database.
   */
  const resolveCardRFQ = (ref: { rfqNumber: string; title: string }): RFQItem => {
    const matched = rfqs.find((r) => r.rfqNumber === ref.rfqNumber);
    return matched ?? { ...FALLBACK_RFQ_TEMPLATE, rfqNumber: ref.rfqNumber, title: ref.title };
  };

  // Group into 3 specification Kanban columns
  const col1_parsing = rfqs.filter((r) => r.status === 'Parsing');
  const col2_pending = rfqs.filter((r) => r.status === 'Quotes Pending');
  const col3_scored = rfqs.filter((r) => r.status === 'In Evaluation' || r.status === 'AI Recommended' || r.status === 'PO Generated');

  const handleOpenChaser = (rfqNumber: string, vendor: string, channel: 'call' | 'whatsapp' | 'sms' | 'email') => {
    setSelectedRfqForChaser(rfqNumber);
    setTargetVendor(vendor);
    setChaserInitialChannel(channel === 'email' ? 'whatsapp' : channel);
    if (channel === 'email') {
      triggerChannelChaser(rfqNumber, 'email', vendor);
    } else {
      setChaserModalOpen(true);
    }
  };

  const handleEscalateToBuyer = (rfqNumber: string) => {
    addAuditLog(`Category Manager escalated ${rfqNumber} to Enterprise Buyer review queue`, rfqNumber);
    showToast('Escalated to Buyer', `${rfqNumber} flagged for buyer intervention with priority notice.`, 'warning');
  };

  const handleApproveReport = (rfq: RFQItem) => {
    addAuditLog(`Approved Mode 3 AI Capability & Pricing Evaluation Report for ${rfq.rfqNumber}`, rfq.rfqNumber);
    showToast('AI Report Approved', `Autonomous scoring and vendor selection report validated for ${rfq.rfqNumber}.`, 'success');
  };

  const handleShareReport = (rfq: RFQItem) => {
    addAuditLog(`Shared AI Evaluation Report with client@procucev.com for ${rfq.rfqNumber}`, rfq.rfqNumber);
    showToast('Report Shared with Client', `Executive summary dispatched to client@procucev.com.`, 'info');
  };

  const handleBatchFollowUp = () => {
    triggerBatchChannelChaser('RFQ-2026-00421', ['call', 'whatsapp', 'sms']);
    addAuditLog('Executed Global Override: Multi-Channel Batch Follow-up (Call + WhatsApp + SMS) to pending suppliers');
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Top Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Operational Monitoring Kanban & Chasing Control
            </h1>
            <span className="badge badge-purple">Screen 2.1</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Category pipeline governance, Mode 1/2/3 AI chaser dispatch engine, and operational analytics controls.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onNavigateToSpend} className="btn btn-secondary btn-sm shadow-xs border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300">
            <TrendingUp size={14} /> Mode & Performance Analytics <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Category Manager Top Executive Analytics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">RFQs Received</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">12 Active</span>
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">Avg 2.4 / day</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">RFQs Downloaded</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">312 Total</span>
            <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-bold bg-sky-50 dark:bg-cyan-950/60 px-1.5 py-0.5 rounded border border-sky-200 dark:border-sky-800">Avg 15.6 / day</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Follow-Up SLA</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 mono">92.4%</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">&lt;24h Response</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Avg Vendors / RFQ</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-purple-600 dark:text-purple-400 mono">6.5 Vendors</span>
            <span className="text-[10px] text-purple-600 dark:text-purple-300 font-bold bg-purple-50 dark:bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">Downloaded / RFQ</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">24h Escalations</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-amber-600 dark:text-amber-400 mono">2 Active</span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">Email Reminders</span>
          </div>
        </div>
      </div>

      {/* Global Overrides Toolbar */}
      <div className="p-3.5 rounded-xl glass-panel flex flex-wrap items-center justify-between gap-3 text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 dark:text-gray-300 uppercase tracking-wider text-[11px]">GLOBAL OVERRIDES:</span>
          <span className="text-slate-300 dark:text-gray-500 hidden sm:inline">|</span>
          <span className="text-[11px] text-slate-500 dark:text-gray-400 hidden sm:inline">Managerial bypass & multi-vendor actions</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSurveyModalOpen(true)}
            className="btn btn-secondary btn-sm border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 font-semibold"
          >
            <Sliders size={13} /> Conduct Mode 3 Vendor Survey
          </button>
          <button
            onClick={() => {
              addAuditLog('Category Manager manually adjusted AI Quality Match Threshold to 80%');
              showToast('AI Threshold Updated', 'AI Quality Score threshold lowered from 85% to 80%.', 'info');
            }}
            className="btn btn-secondary btn-sm font-semibold"
          >
            ⚙️ Override AI Score
          </button>
          <button
            onClick={handleBatchFollowUp}
            className="btn btn-emerald btn-sm font-semibold shadow-xs"
          >
            <Zap size={13} /> Batch Multi-Channel Chaser
          </button>
        </div>
      </div>

      {/* 3-Column Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Column 1: Ingested / Parsing */}
        <div className="glass-panel p-4 rounded-2xl flex flex-col space-y-3 border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-gray-900/60">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200">
                Ingested / Parsing ({col1_parsing.length + 2})
              </h2>
            </div>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-bold">OCR Stage</span>
          </div>

          <div className="space-y-3 flex-1">
            {/* Card 1: RFQ-00425 */}
            <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 transition-all text-xs space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-white mono">RFQ-00425: Valves</span>
                <span className="badge badge-amber text-[10px]">OCR Parsing</span>
              </div>
              <p className="text-slate-700 dark:text-gray-300 text-[11px]">High Pressure Cryogenic Valves (16 Units)</p>
              <div className="p-2 rounded bg-slate-50 dark:bg-gray-950 text-[10px] text-slate-600 dark:text-gray-400 space-y-1 border border-slate-100 dark:border-transparent">
                <div className="flex justify-between">
                  <span>Confidence:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">94.2%</span>
                </div>
                <div className="flex justify-between">
                  <span>Entities:</span>
                  <span className="text-slate-900 dark:text-gray-200 font-medium">Globe Valve 2-in 600#</span>
                </div>
              </div>
            </div>

            {/* Card 2: RFQ-00426 */}
            <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 transition-all text-xs space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-white mono">RFQ-00426: Steel Pipe</span>
                <span className="badge badge-blue text-[10px]">Validating</span>
              </div>
              <p className="text-slate-700 dark:text-gray-300 text-[11px]">Seamless Carbon Steel Pipes (480m)</p>
              <div className="p-2 rounded bg-slate-50 dark:bg-gray-950 text-[10px] text-slate-600 dark:text-gray-400 border border-slate-100 dark:border-transparent">
                <span>BOQ Schema verification in progress</span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: Quotes Pending / AI Follow-up */}
        <div className="glass-panel p-4 rounded-2xl flex flex-col space-y-3 border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-gray-900/60 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200">
                Quotes Pending / AI Follow-up ({col2_pending.length + 3})
              </h2>
            </div>
            <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-mono font-bold">Multi-Channel Active</span>
          </div>

          <div className="space-y-3 flex-1">
            {/* Card 1: RFQ-00421 */}
            <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border border-indigo-200 dark:border-indigo-500/30 hover:border-indigo-400 dark:hover:border-indigo-500/60 transition-all text-xs space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-white mono">RFQ-00421: Pumps</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 flex items-center gap-1">
                  <span className="live-dot" /> Multi-Channel: Active
                </span>
              </div>
              <p className="text-slate-700 dark:text-gray-300 text-[11px]">Centrifugal Water Pumps (500 GPM) • 5 Quotes In</p>

              {/* 4-Channel Multi-Channel Follow-up telemetry pills */}
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-100 dark:border-gray-800/80 space-y-1.5 text-[10px]">
                <div className="flex justify-between items-center text-purple-700 dark:text-purple-300 font-semibold">
                  <span>📞 Voice Calls:</span>
                  <span className="mono">4/5 Connected (Avg 1m 48s)</span>
                </div>
                <div className="flex justify-between items-center text-emerald-700 dark:text-emerald-300 font-semibold">
                  <span>💬 WhatsApp Bot:</span>
                  <span className="mono">4 Read • 3 Bids In</span>
                </div>
                <div className="flex justify-between items-center text-sky-700 dark:text-cyan-300 font-semibold">
                  <span>📱 SMS Direct:</span>
                  <span className="mono">5 Delivered (100% DLT)</span>
                </div>
                <div className="flex justify-between items-center text-amber-700 dark:text-amber-300 font-semibold">
                  <span>✉️ 24h Email:</span>
                  <span className="mono">2 Reminders Dispatched</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 pt-1 flex-wrap">
                <button
                  onClick={() => handleOpenChaser('RFQ-2026-00421', 'Apex Supplies Ltd.', 'call')}
                  className="px-2 py-1 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 font-semibold text-[10px] flex items-center gap-1"
                >
                  <span>📞</span> Call
                </button>
                <button
                  onClick={() => handleOpenChaser('RFQ-2026-00421', 'Apex Supplies Ltd.', 'whatsapp')}
                  className="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 font-semibold text-[10px] flex items-center gap-1"
                >
                  <MessageSquare size={10} /> WA
                </button>
                <button
                  onClick={() => handleOpenChaser('RFQ-2026-00421', 'Apex Supplies Ltd.', 'sms')}
                  className="px-2 py-1 rounded bg-sky-50 dark:bg-cyan-950/60 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-800 hover:bg-sky-100 font-semibold text-[10px] flex items-center gap-1"
                >
                  <span>📱</span> SMS
                </button>
                <button
                  onClick={() => handleOpenChaser('RFQ-2026-00421', 'WPIL Pumps Ltd.', 'email')}
                  className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 font-semibold text-[10px] flex items-center gap-1"
                >
                  <span>✉️</span> 24h Email
                </button>
                <button
                  onClick={() => openRFQDeepDive(resolveCardRFQ(KANBAN_CARD_RFQ_REFS.FOLLOW_UP_DEEP_DIVE))}
                  className="btn btn-secondary btn-sm text-[10px] px-2 ml-auto"
                >
                  <Search size={10} /> Deep Dive
                </button>
              </div>
            </div>

            {/* Card 2: RFQ-00422 */}
            <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 transition-all text-xs space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-white mono">RFQ-00422: Cables</span>
                <span className="badge badge-rose text-[10px]">24h Overdue</span>
              </div>
              <p className="text-slate-700 dark:text-gray-300 text-[11px]">Armored Power Transmission Cables 33kV</p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => handleEscalateToBuyer('RFQ-2026-00422')}
                  className="btn btn-secondary btn-sm flex-1 text-rose-600 dark:text-rose-300 hover:text-rose-700 border-rose-300 dark:border-rose-500/30 font-semibold"
                >
                  <AlertTriangle size={12} /> Escalate to Buyer
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Column 3: AI Evaluation & Scored */}
        <div className="glass-panel p-4 rounded-2xl flex flex-col space-y-3 border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-gray-900/60">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200">
                AI Evaluation & Scored ({col3_scored.length})
              </h2>
            </div>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-bold">Ready for PO</span>
          </div>

          <div className="space-y-3 flex-1">
            {/* Card 1: RFQ-00418 */}
            <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border border-emerald-200 dark:border-emerald-500/40 hover:border-emerald-400 dark:hover:border-emerald-500/70 transition-all text-xs space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-white mono">RFQ-00418: Panels</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
                  Mode 3 Scored (&gt;80%)
                </span>
              </div>
              <p className="text-slate-700 dark:text-gray-300 text-[11px]">
                Low Voltage Switchgear Panels • <span className="text-emerald-600 dark:text-emerald-400 font-bold">96% AI Match</span>
              </p>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => handleApproveReport(resolveCardRFQ(KANBAN_CARD_RFQ_REFS.SCORED_REPORT))}
                  className="btn btn-secondary btn-sm text-[11px] font-semibold"
                >
                  <FileCheck size={12} /> Approve Report
                </button>
                <button
                  onClick={() => handleShareReport(resolveCardRFQ(KANBAN_CARD_RFQ_REFS.SCORED_REPORT))}
                  className="btn btn-primary btn-sm text-[11px] font-semibold"
                >
                  <Share2 size={12} /> Share Report
                </button>
              </div>
            </div>

            {/* Card 2: RFQ-00421 Link to matrix */}
            <div
              onClick={() => {
                const matrixRFQ = resolveCardRFQ(KANBAN_CARD_RFQ_REFS.MATRIX_READY);
                setSelectedRFQForMatrix(matrixRFQ);
                if (onNavigateToMatrix) onNavigateToMatrix(matrixRFQ);
              }}
              className="p-3.5 rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-all text-xs cursor-pointer group shadow-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-white mono">RFQ-00421: Matrix Ready</span>
                <ChevronRight size={14} className="text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-transform group-hover:translate-x-1" />
              </div>
              <p className="text-slate-500 dark:text-gray-400 text-[11px] mt-1">Vendor C scored 94% match. Click to inspect matrix.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Channel Chaser Modal */}
      <MultiChannelChaserModal
        isOpen={chaserModalOpen}
        onClose={() => setChaserModalOpen(false)}
        rfqNumber={selectedRfqForChaser}
        vendorName={targetVendor}
        initialChannel={chaserInitialChannel}
      />

      {/* Mode 3 Survey Modal */}
      <VendorSurveyModal
        isOpen={surveyModalOpen}
        onClose={() => setSurveyModalOpen(false)}
      />

      {/* RFQ Multi-Channel Follow-Up Deep Dive Modal */}
      <RFQFollowUpDeepDiveModal
        isOpen={deepDiveModalOpen}
        onClose={() => setDeepDiveModalOpen(false)}
        rfq={selectedRFQForDeepDive || rfqs[0]}
      />
    </div>
  );
}
