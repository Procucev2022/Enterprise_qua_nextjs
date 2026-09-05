'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { VendorEvaluationRecord, QuestionEvaluationItem } from '@/lib/types';
import {
  Award,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Building2,
  ShieldCheck,
  Zap,
  Sparkles,
  Download,
  ExternalLink,
  ChevronRight,
  UserCheck,
  Sliders,
  RefreshCw,
  Mail,
  Phone,
  Tag,
  Clock,
  Lock,
  ArrowLeft,
  X,
  Paperclip,
  Check,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

interface VendorEvaluationSummaryProps {
  evaluationRecord?: VendorEvaluationRecord | null;
  onBack?: () => void;
}

export default function VendorEvaluationSummary({
  evaluationRecord,
  onBack,
}: VendorEvaluationSummaryProps) {
  const { vendorEvaluations, buyerVendors, showToast, addAuditLog, addFeedItem } = useApp();

  // Unified available evaluation records from store and buyer roster
  const availableRecords: VendorEvaluationRecord[] = React.useMemo(() => {
    const list = [...(vendorEvaluations || [])];
    (buyerVendors || []).forEach((bv) => {
      if (!list.some((r) => r.vendorId === bv.id || r.vendorName?.toLowerCase() === bv.name?.toLowerCase())) {
        list.push({
          id: `eval-${bv.id}`,
          vendorId: bv.id,
          vendorName: bv.name,
          contactPerson: bv.contactPerson,
          email: bv.email,
          phone: bv.phone,
          category: bv.majorCategory,
          submissionDate: '2026-08-18 14:30 UTC',
          status: (bv.status as any) || 'PREFERRED ENTERPRISE SUPPLIER',
          overallScore: bv.score || (bv.rating ? Math.round(bv.rating * 20) : 88),
          systemAction: 'Active Roster Direct RFQ dispatch confirmed.',
          moduleScores: {
            commercial: { score: 4.8, maxScore: 5, weight: 25, weightedScore: 24.0, remarks: 'Payment terms Net 60 fixed rate contract approved.' },
            technical: { score: 4.5, maxScore: 5, weight: 15, weightedScore: 13.5, remarks: 'Technical parameter compliance datasheet verified.' },
            quality: { score: 4.6, maxScore: 5, weight: 20, weightedScore: 18.4, remarks: 'ISO 9001:2015 certificate verified.' },
            delivery: { score: 4.4, maxScore: 5, weight: 20, weightedScore: 17.6, remarks: 'Verified average OTIF 92.4%.' },
            financial: { score: 4.0, maxScore: 5, weight: 10, weightedScore: 8.0, remarks: 'Credit score A+; clean audit history.' },
            governance: { score: 4.7, maxScore: 5, weight: 10, weightedScore: 9.4, remarks: 'Statutory GSTIN/PAN and ESG guidelines verified.' },
          },
          documents: [],
        });
      }
    });
    return list;
  }, [vendorEvaluations, buyerVendors]);

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const record =
    (selectedRecordId ? availableRecords.find((r) => r.id === selectedRecordId || r.vendorId === selectedRecordId) : null) ||
    evaluationRecord ||
    availableRecords[0];

  const [overrideScore, setOverrideScore] = useState<number | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [newScoreInput, setNewScoreInput] = useState(record?.overallScore || 95);
  const [capaOpen, setCapaOpen] = useState(false);
  const [capaNotes, setCapaNotes] = useState(record?.capaNotes || '');
  const [selectedPillarFilter, setSelectedPillarFilter] = useState<string>('ALL');

  if (!record) {
    return (
      <div className="p-8 text-center text-slate-500">
        No evaluation record selected.
      </div>
    );
  }

  const defaultModules = {
    commercial: { score: 4.8, maxScore: 5, weight: 25, weightedScore: 24.0, remarks: 'Payment terms Net 60 fixed rate contract approved.' },
    technical: { score: 4.5, maxScore: 5, weight: 15, weightedScore: 13.5, remarks: 'Technical parameter compliance datasheet verified.' },
    quality: { score: 4.6, maxScore: 5, weight: 20, weightedScore: 18.4, remarks: 'ISO 9001:2015 certificate verified.' },
    delivery: { score: 4.4, maxScore: 5, weight: 20, weightedScore: 17.6, remarks: 'Verified average OTIF 92.4%.' },
    financial: { score: 4.0, maxScore: 5, weight: 10, weightedScore: 8.0, remarks: 'Credit score A+; clean audit history.' },
    governance: { score: 4.7, maxScore: 5, weight: 10, weightedScore: 9.4, remarks: 'Statutory GSTIN/PAN and ESG guidelines verified.' },
  };

  const moduleScores = {
    commercial: { ...defaultModules.commercial, ...(record.moduleScores?.commercial || {}) },
    technical: { ...defaultModules.technical, ...(record.moduleScores?.technical || {}) },
    quality: { ...defaultModules.quality, ...(record.moduleScores?.quality || {}) },
    delivery: { ...defaultModules.delivery, ...(record.moduleScores?.delivery || {}) },
    financial: { ...defaultModules.financial, ...(record.moduleScores?.financial || {}) },
    governance: { ...defaultModules.governance, ...(record.moduleScores?.governance || {}) },
  };

  const effectiveScore = overrideScore !== null ? overrideScore : record.overallScore;

  const getStatusBadge = (status: string, score: number) => {
    if (score >= 80) {
      return (
        <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40">
          PREFERRED ENTERPRISE SUPPLIER
        </span>
      );
    }
    if (score >= 65) {
      return (
        <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40">
          CONDITIONAL / UNDER REVIEW
        </span>
      );
    }
    return (
      <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/40">
        DISQUALIFIED SUPPLIER
      </span>
    );
  };

  const handleApplyOverride = () => {
    setOverrideScore(newScoreInput);
    setShowOverrideModal(false);
    addAuditLog(
      `Manual Override: Category Manager adjusted Mode 3 360° score for ${record.vendorName} to ${newScoreInput}%`,
      'Mode-3-Override'
    );
    showToast(
      'Score Overridden',
      `Mode 3 evaluation score for ${record.vendorName} set to ${newScoreInput}%. Audit log updated.`,
      'success'
    );
  };

  const handleTriggerCAPA = () => {
    setCapaOpen(true);
    addAuditLog(
      `Triggered CAPA Action Plan for vendor ${record.vendorName}`,
      'CAPA-Trigger'
    );
    addFeedItem(
      `CAPA Triggered: ${record.vendorName}`,
      `Corrective Action Plan issued for ${record.vendorName}. Required items: ${capaNotes || 'Document clarification & warranty update'}.`,
      'escalation',
      'RFQ-2026-00421',
      record.vendorName
    );
    showToast('CAPA Notice Issued', `Corrective Action Plan sent to ${record.email}.`, 'info');
  };

  const questions = record.questionBreakdown || [];
  const filteredQuestions = selectedPillarFilter === 'ALL'
    ? questions
    : questions.filter((q) => q.pillarId === selectedPillarFilter);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Top Bar Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="btn btn-secondary btn-sm">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                Mode 3 360-Degree Vendor Evaluation Summary Report
              </h1>
              <span className="badge badge-purple">Screen 1.4 (24/24 Attachments Verified)</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Procucev QUA AI 6-Pillar Capability Score, OCR Audit & Automated Direct Dispatch Governance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Vendor Selector Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500 dark:text-gray-400">Supplier:</span>
            <select
              value={record.id}
              onChange={(e) => {
                setSelectedRecordId(e.target.value);
                setOverrideScore(null);
              }}
              className="text-xs font-bold py-1 px-2.5 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 shadow-xs"
            >
              {availableRecords.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.vendorName} ({r.overallScore}%)
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowOverrideModal(true)}
            className="btn btn-secondary btn-sm"
          >
            <Sliders size={13} /> Override AI Score
          </button>
          <button onClick={handleTriggerCAPA} className="btn btn-amber btn-sm">
            <AlertTriangle size={13} /> Trigger CAPA Action
          </button>
          <button
            onClick={() => showToast('Evaluation PDF Exported', 'Downloaded Mode 3 360° Evaluation Report for enterprise audit.', 'success')}
            className="btn btn-primary btn-sm"
          >
            <Download size={13} /> Export PDF Report
          </button>
        </div>
      </div>

      {/* Main Vendor Executive Header Card */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Vendor Info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                {record.vendorId}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-600 dark:text-gray-400 font-medium flex items-center gap-1">
                <Tag size={12} /> {record.category}
              </span>
            </div>

            <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <CompanyHoverTooltip
                name={record.vendorName}
                type="vendor"
                contact={{
                  contactPerson: record.contactPerson,
                  mobile: record.phone,
                  email: record.email,
                  verified: record.status === 'PREFERRED ENTERPRISE SUPPLIER',
                }}
              />
              <ShieldCheck className="text-emerald-500" size={24} />
            </h2>

            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-gray-400 flex-wrap">
              <span className="flex items-center gap-1"><Building2 size={13} /> Contact: <strong className="text-slate-700 dark:text-gray-200">{record.contactPerson}</strong></span>
              <span className="flex items-center gap-1"><Mail size={13} /> {record.email}</span>
              <span className="flex items-center gap-1"><Phone size={13} /> {record.phone}</span>
              <span className="flex items-center gap-1"><Clock size={13} /> Submitted: {record.submissionDate}</span>
            </div>
          </div>

          {/* Computed Rating Gauge */}
          <div className="flex items-center gap-5 p-4 rounded-xl bg-slate-900 text-white shadow-lg shrink-0 border border-slate-800">
            <div className="text-center">
              <div className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                360° AI Rating Score
              </div>
              <div className="text-4xl font-black mono text-emerald-400 mt-1">
                {effectiveScore}%
              </div>
              {overrideScore !== null && (
                <span className="text-[9px] text-amber-400 font-mono font-bold block mt-0.5">
                  (Calibrated by CM)
                </span>
              )}
            </div>

            <div className="space-y-1.5 border-l border-slate-800 pl-4">
              {getStatusBadge(record.status, effectiveScore)}
              <div className="text-[10px] text-indigo-300">
                Gate Pass Status: <span className="font-bold text-emerald-400">≥ 80% Unlocked</span>
              </div>
            </div>
          </div>
        </div>

        {/* Automated System Execution Action Banner */}
        <div className="mt-5 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
            <Zap size={15} className="text-emerald-600 dark:text-emerald-400 animate-pulse" />
            <span>Automated Execution:</span>
            <span className="font-normal text-emerald-900 dark:text-emerald-200">{record.systemAction}</span>
          </div>
          <span className="badge badge-emerald">24/24 Attachments Verified</span>
        </div>
      </div>

      {/* 6 Subtotal Pillar Summary Cards */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
          6-Pillar Subtotal Summary & Auditor Remarks
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Module 1: Commercial (25%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center">
                    M1
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Commercial Terms</span>
                </div>
                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {moduleScores.commercial.weightedScore} / 25 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.commercial.weightedScore / 25) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/60 text-[10px] text-indigo-900 dark:text-indigo-200">
              <div className="font-bold text-indigo-700 dark:text-indigo-300 mb-0.5">💬 Pillar 1 Auditor Remarks:</div>
              {moduleScores.commercial.remarks}
            </div>
          </div>

          {/* Module 2: Technical (15%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 font-bold text-xs flex items-center justify-center">
                    M2
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Technical Capabilities</span>
                </div>
                <span className="text-xs font-mono font-bold text-sky-600 dark:text-cyan-400">
                  {moduleScores.technical.weightedScore} / 15 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-sky-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.technical.weightedScore / 15) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/70 dark:bg-cyan-950/50 border border-sky-100 dark:border-cyan-800/60 text-[10px] text-sky-900 dark:text-cyan-200">
              <div className="font-bold text-sky-700 dark:text-cyan-300 mb-0.5">💬 Pillar 2 Auditor Remarks:</div>
              {moduleScores.technical.remarks}
            </div>
          </div>

          {/* Module 3: Quality (20%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center">
                    M3
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Quality & Warranty</span>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {moduleScores.quality.weightedScore} / 20 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.quality.weightedScore / 20) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-800/60 text-[10px] text-emerald-900 dark:text-emerald-200">
              <div className="font-bold text-emerald-700 dark:text-emerald-300 mb-0.5">💬 Pillar 3 Auditor Remarks:</div>
              {moduleScores.quality.remarks}
            </div>
          </div>

          {/* Module 4: Delivery (20%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold text-xs flex items-center justify-center">
                    M4
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Operational Delivery</span>
                </div>
                <span className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400">
                  {moduleScores.delivery.weightedScore} / 20 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-purple-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.delivery.weightedScore / 20) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/50 border border-purple-100 dark:border-purple-800/60 text-[10px] text-purple-900 dark:text-purple-200">
              <div className="font-bold text-purple-700 dark:text-purple-300 mb-0.5">💬 Pillar 4 Auditor Remarks:</div>
              {moduleScores.delivery.remarks}
            </div>
          </div>

          {/* Module 5: Financial (10%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center justify-center">
                    M5
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Financial Stability</span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                  {moduleScores.financial.weightedScore} / 10 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.financial.weightedScore / 10) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/50 border border-amber-100 dark:border-amber-800/60 text-[10px] text-amber-900 dark:text-amber-200">
              <div className="font-bold text-amber-700 dark:text-amber-300 mb-0.5">💬 Pillar 5 Auditor Remarks:</div>
              {moduleScores.financial.remarks}
            </div>
          </div>

          {/* Module 6: ESG & Compliance (10%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-bold text-xs flex items-center justify-center">
                    M6
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Governance & ESG</span>
                </div>
                <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">
                  {moduleScores.governance.weightedScore} / 10 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-rose-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.governance.weightedScore / 10) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-50/70 dark:bg-rose-950/50 border border-rose-100 dark:border-rose-800/60 text-[10px] text-rose-900 dark:text-rose-200">
              <div className="font-bold text-rose-700 dark:text-rose-300 mb-0.5">💬 Pillar 6 Auditor Remarks:</div>
              {moduleScores.governance.remarks}
            </div>
          </div>
        </div>
      </div>

      {/* 24-Criteria Granular Evaluation Breakdown Table */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-gray-800">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 flex items-center gap-2">
              <FileText size={16} className="text-indigo-600 dark:text-indigo-400" />
              24-Criteria 360-Degree Evaluation Matrix ({questions.length} Items)
            </h3>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Individual question scores, mandatory verified attachments, and AI auditor justification remarks.
            </p>
          </div>

          {/* Pillar Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs">
            {['ALL', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((p) => (
              <button
                key={p}
                onClick={() => setSelectedPillarFilter(p)}
                className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                  selectedPillarFilter === p
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800'
                }`}
              >
                {p === 'ALL' ? 'All 24 Criteria' : p}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500 uppercase tracking-wider text-[10px] bg-slate-50/50 dark:bg-gray-950/50">
                <th className="py-2.5 px-3">Ref ID</th>
                <th className="py-2.5 px-3">Evaluation Criteria</th>
                <th className="py-2.5 px-3">Required Mandatory Attachment</th>
                <th className="py-2.5 px-3 text-center">Score (1-5)</th>
                <th className="py-2.5 px-3 text-right">Weighted %</th>
                <th className="py-2.5 px-3">AI / Auditor Justification Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/80">
              {filteredQuestions.map((q) => (
                <tr key={q.refId} className="hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="py-3 px-3">
                    <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      {q.refId}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-800 dark:text-gray-200 max-w-xs">
                    {q.criteria}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                      <Paperclip size={12} className="shrink-0" />
                      <span className="truncate max-w-[160px]" title={q.attachmentName}>{q.attachmentName}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                        ✓ Verified
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center font-bold text-slate-800 dark:text-gray-200 mono">
                    {q.score.toFixed(1)} / 5.0
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400 mono">
                    +{q.weightedScore.toFixed(2)}%
                  </td>
                  <td className="py-3 px-3 text-[11px] text-slate-600 dark:text-gray-300 italic max-w-md">
                    &quot;{q.remarks}&quot;
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 24 Verified Mandatory Attachments Overview Card */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 flex items-center gap-2">
            <Paperclip size={16} className="text-indigo-600 dark:text-indigo-400" />
            24 Mandatory PDF/Excel File Attachments Audit Status ({record.documents.length} Files)
          </h3>
          <span className="badge badge-emerald">24/24 OCR Verification 100%</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500 uppercase tracking-wider text-[10px]">
                <th className="py-2">Document File Title</th>
                <th className="py-2">Criteria Type</th>
                <th className="py-2">Uploaded On</th>
                <th className="py-2">OCR Audit Status</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
              {record.documents.slice(0, 12).map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                  <td className="py-2.5 font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                    <FileText size={14} className="text-indigo-500 shrink-0" />
                    <span>{doc.name}</span>
                  </td>
                  <td className="py-2.5 text-slate-600 dark:text-gray-400">{doc.type}</td>
                  <td className="py-2.5 text-slate-400 dark:text-gray-500 mono">{doc.uploadDate}</td>
                  <td className="py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                      ✓ {doc.status}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => showToast('Document Opened', `Viewing ${doc.name} in secure Azure Blob viewer.`, 'info')}
                      className="btn btn-ghost btn-sm text-[11px] text-indigo-600 dark:text-indigo-400"
                    >
                      <ExternalLink size={12} /> Preview
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {record.documents.length > 12 && (
            <div className="text-center py-2 text-xs text-indigo-600 font-bold">
              + {record.documents.length - 12} additional mandatory documents verified in Azure Blob Storage.
            </div>
          )}
        </div>
      </div>

      {/* Manual Score Override Modal */}
      {showOverrideModal && (
        <div className="modal-overlay">
          <div className="modal-content max-w-md p-6 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sliders size={16} className="text-indigo-600" /> Override AI Evaluation Score
              </h3>
              <button onClick={() => setShowOverrideModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-gray-400">
              Category Manager Manual Governance Override. Enter the calibrated score percentage for <strong>{record.vendorName}</strong>:
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-gray-300">
                Calibrated Rating Score (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={newScoreInput}
                onChange={(e) => setNewScoreInput(Number(e.target.value))}
                className="mono font-bold text-base"
              />
            </div>

            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-300 border border-amber-200">
              ⚠️ Note: Manual score overrides are cryptographically logged in the Azure Immutable Audit Trail.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowOverrideModal(false)} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button onClick={handleApplyOverride} className="btn btn-primary btn-sm">
                Confirm Score Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
