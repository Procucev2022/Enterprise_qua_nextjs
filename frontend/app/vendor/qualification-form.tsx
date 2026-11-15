'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { QuestionEvaluationItem, VendorEntry, VendorEvaluationRecord } from '@/lib/types';
import {
  FileCheck,
  Award,
  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  FileText,
  Building2,
  ShieldCheck,
  Zap,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Lock,
  Cpu,
  Clock,
  Briefcase,
  HelpCircle,
  X,
  FileCode,
  Send,
  Paperclip,
  Check,
  Layers,
  Eye,
  Star,
  Pencil,
} from 'lucide-react';

interface VendorQualificationFormProps {
  onBack: () => void;
  onSuccess: (evaluationRecord: VendorEvaluationRecord) => void;
}

interface QuestionFormState {
  refId: string;
  pillarId: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6';
  pillarName: string;
  criteria: string;
  attachmentName: string;
  score: number;
  weightedScore: number;
  maxWeight: number;
  remarks: string;
  options: { label: string; value: number }[];
}

/**
 * Stored with each self-assessment in place of an automated action. Saving the record
 * does not dispatch RFQs or change any roster, so the record must not say that it did.
 */
const SELF_ASSESSMENT_SYSTEM_ACTION = 'Self-assessment recorded. No RFQ dispatch was triggered by this submission.';

const MODULE_TABS = [
  { id: 'M1', code: 'Module 1', name: 'Commercial Terms', weight: 25, activeColor: 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' },
  { id: 'M2', code: 'Module 2', name: 'Technical Capabilities', weight: 15, activeColor: 'bg-sky-600 text-white shadow-md shadow-sky-600/30' },
  { id: 'M3', code: 'Module 3', name: 'Quality & Warranty', weight: 20, activeColor: 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' },
  { id: 'M4', code: 'Module 4', name: 'Operational Delivery', weight: 20, activeColor: 'bg-purple-600 text-white shadow-md shadow-purple-600/30' },
  { id: 'M5', code: 'Module 5', name: 'Financial Stability', weight: 10, activeColor: 'bg-amber-600 text-white shadow-md shadow-amber-600/30' },
  { id: 'M6', code: 'Module 6', name: 'Governance & ESG', weight: 10, activeColor: 'bg-rose-600 text-white shadow-md shadow-rose-600/30' },
] as const;

export default function VendorQualificationForm({ onBack, onSuccess }: VendorQualificationFormProps) {
  const {
    addVendorEvaluation,
    addAuditLog,
    addFeedItem,
    showToast,
    setVendorSelfEvaluationCompleted,
    setVendorSelfEvaluationScore,
    currentUserSession,
  } = useApp();

  // The evaluation is attributed to the logged-in vendor. This loads that vendor's own
  // record, so the saved identity is the real one and not a fixed placeholder.
  const [myVendorRecord, setMyVendorRecord] = useState<VendorEntry | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function loadMyVendorRecord() {
      const email = currentUserSession?.email;
      if (!email) return;
      try {
        const token = authClient.getToken();
        const res = await fetch(`/api/vendors/${encodeURIComponent(email)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success && data.data) setMyVendorRecord(data.data);
      } catch {
        // Leave myVendorRecord null — falls back to session-derived identity below.
      }
    }
    loadMyVendorRecord();
    return () => {
      cancelled = true;
    };
  }, [currentUserSession?.email]);

  const [activeTab, setActiveTab] = useState<'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'>('M1');
  const [viewAllModules, setViewAllModules] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<VendorEvaluationRecord | null>(null);
  const [showDetailedReportModal, setShowDetailedReportModal] = useState(false);

  // 24 Detailed Question States with their specific descriptive options
  const [qState, setQState] = useState<Record<string, QuestionFormState>>({
    // Every question below used to start pre-filled with a fake attachment, a
    // near-max score, and a fabricated "verified" remark — a vendor could
    // submit without touching anything and score ~94% on fictitious evidence
    // (BUGS.md #50). Defaults now start at the *lowest* value actually offered
    // by that question's own options (the "unproven / no evidence" answer,
    // since not every question offers a literal 0), with no attachment and no
    // remarks, so a genuine compliance claim requires the vendor to actually
    // make it.
    'M1-Q1': {
      refId: 'M1-Q1', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Commercial Payment Terms', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 6.25, remarks: '',
      options: [
        { label: 'Net 60+ Days (5 pts - Optimal)', value: 5 },
        { label: 'Net 30 Days (4 pts - Standard)', value: 4 },
        { label: 'Net 15 Days (2 pts)', value: 2 },
        { label: '100% Advance Payment (0 pts)', value: 0 }
      ]
    },
    'M1-Q2': {
      refId: 'M1-Q2', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Fixed Price Contract (12 Mo)', attachmentName: '', score: 1, weightedScore: 1.25, maxWeight: 6.25, remarks: '',
      options: [
        { label: 'Yes (Fixed 12 Months - 5 pts)', value: 5 },
        { label: 'No (Variable Pricing - 1 pt)', value: 1 }
      ]
    },
    'M1-Q3': {
      refId: 'M1-Q3', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Inclusivity of Freight (DDP)', attachmentName: '', score: 1, weightedScore: 1.25, maxWeight: 6.25, remarks: '',
      options: [
        { label: 'Full DDP / Door Delivery Included (5 pts)', value: 5 },
        { label: 'FOR Destination Only (3 pts)', value: 3 },
        { label: 'Ex-Works Only (Freight Extra - 1 pt)', value: 1 }
      ]
    },
    'M1-Q4': {
      refId: 'M1-Q4', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Volume Tier Discounting', attachmentName: '', score: 1, weightedScore: 1.25, maxWeight: 6.25, remarks: '',
      options: [
        { label: '> 5% Volume Discount (5 pts)', value: 5 },
        { label: '2% - 5% Volume Discount (3 pts)', value: 3 },
        { label: '0% / No Volume Discount (1 pt)', value: 1 }
      ]
    },

    'M2-Q1': {
      refId: 'M2-Q1', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: 'BOQ Spec Compliance', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 3.75, remarks: '',
      options: [
        { label: '100% Full Spec Compliance (5 pts)', value: 5 },
        { label: 'Partial Compliance / Deviations (2 pts)', value: 2 },
        { label: 'Non-Compliant (0 pts)', value: 0 }
      ]
    },
    'M2-Q2': {
      refId: 'M2-Q2', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: 'Equipment Automation', attachmentName: '', score: 1, weightedScore: 0.75, maxWeight: 3.75, remarks: '',
      options: [
        { label: 'Fully Automated / Robotic CNC Lines (5 pts)', value: 5 },
        { label: 'Semi-Automated Lines (3 pts)', value: 3 },
        { label: 'Manual Machining Lines (1 pt)', value: 1 }
      ]
    },
    'M2-Q3': {
      refId: 'M2-Q3', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: 'In-House R&D / Testing', attachmentName: '', score: 1, weightedScore: 0.75, maxWeight: 3.75, remarks: '',
      options: [
        { label: 'Yes + Lab Accreditation Cert (5 pts)', value: 5 },
        { label: 'No In-House Lab (1 pt)', value: 1 }
      ]
    },
    'M2-Q4': {
      refId: 'M2-Q4', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: '24/7 Technical Support', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 3.75, remarks: '',
      options: [
        { label: '24/7 On-Site Engineering Support (5 pts)', value: 5 },
        { label: 'Remote Engineering Support Only (3 pts)', value: 3 },
        { label: 'No Post-Sales Support (0 pts)', value: 0 }
      ]
    },

    'M3-Q1': {
      refId: 'M3-Q1', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'ISO 9001:2015 Certification', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 5.00, remarks: '',
      options: [
        { label: 'ISO 9001:2015 Verified Upload (5 pts)', value: 5 },
        { label: 'No ISO Quality Certification (0 pts)', value: 0 }
      ]
    },
    'M3-Q2': {
      refId: 'M3-Q2', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'Defect Rate (PPM History)', attachmentName: '', score: 1, weightedScore: 1.00, maxWeight: 5.00, remarks: '',
      options: [
        { label: '< 500 PPM Defect Rate (5 pts - Six Sigma)', value: 5 },
        { label: '500 - 1000 PPM (3 pts)', value: 3 },
        { label: '> 1000 PPM (1 pt)', value: 1 }
      ]
    },
    'M3-Q3': {
      refId: 'M3-Q3', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'Comprehensive Warranty', attachmentName: '', score: 1, weightedScore: 1.00, maxWeight: 5.00, remarks: '',
      options: [
        { label: '≥ 24 Months Warranty (5 pts)', value: 5 },
        { label: '12 - 23 Months Warranty (3 pts)', value: 3 },
        { label: '< 12 Months Warranty (1 pt)', value: 1 }
      ]
    },
    'M3-Q4': {
      refId: 'M3-Q4', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'Batch Traceability (RFID)', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 5.00, remarks: '',
      options: [
        { label: 'RFID batch tracing (5 pts)', value: 5 },
        { label: 'Manual log tracking (3 pts)', value: 3 },
        { label: 'No traceability (0 pts)', value: 0 }
      ]
    },

    'M4-Q1': {
      refId: 'M4-Q1', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Verified OTIF Rate', attachmentName: '', score: 1, weightedScore: 1.00, maxWeight: 5.00, remarks: '',
      options: [
        { label: '≥ 95% OTIF delivery rate (5 pts)', value: 5 },
        { label: '90% - 94% OTIF (3 pts)', value: 3 },
        { label: '< 90% OTIF (1 pt)', value: 1 }
      ]
    },
    'M4-Q2': {
      refId: 'M4-Q2', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Manufacturing Lead Time', attachmentName: '', score: 1, weightedScore: 1.00, maxWeight: 5.00, remarks: '',
      options: [
        { label: 'Standard lead time <= 12 days (SLA) (5 pts)', value: 5 },
        { label: '13-15 days (3 pts)', value: 3 },
        { label: '> 15 days (1 pt)', value: 1 }
      ]
    },
    'M4-Q3': {
      refId: 'M4-Q3', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Capacity Utilization Rate', attachmentName: '', score: 1, weightedScore: 1.00, maxWeight: 5.00, remarks: '',
      options: [
        { label: '60% - 85% capacity utilization (5 pts - Optimal)', value: 5 },
        { label: '86% - 95% capacity (3 pts)', value: 3 },
        { label: '> 95% or < 60% capacity (1 pt)', value: 1 }
      ]
    },
    'M4-Q4': {
      refId: 'M4-Q4', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Disaster Recovery (BCP)', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 5.00, remarks: '',
      options: [
        { label: 'Active tested BCP Plan (5 pts)', value: 5 },
        { label: 'No active BCP Plan (0 pts)', value: 0 }
      ]
    },

    'M5-Q1': {
      refId: 'M5-Q1', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Annual Financial Turnover', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 2.50, remarks: '',
      options: [
        { label: '>= 3x turnover (5 pts)', value: 5 },
        { label: '1.5x - 3x turnover (3 pts)', value: 3 },
        { label: '< 1.5x turnover (0 pts)', value: 0 }
      ]
    },
    'M5-Q2': {
      refId: 'M5-Q2', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Credit Rating Score', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 2.50, remarks: '',
      options: [
        { label: 'Investment Grade (AAA/A/BBB) (5 pts)', value: 5 },
        { label: 'Non-Investment Grade (0 pts)', value: 0 }
      ]
    },
    'M5-Q3': {
      refId: 'M5-Q3', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Current Liquidity Ratio', attachmentName: '', score: 2, weightedScore: 1.00, maxWeight: 2.50, remarks: '',
      options: [
        { label: 'Current ratio >= 1.5 (5 pts)', value: 5 },
        { label: 'Current ratio < 1.5 (2 pts)', value: 2 }
      ]
    },
    'M5-Q4': {
      refId: 'M5-Q4', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Active Litigation Claims', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 2.50, remarks: '',
      options: [
        { label: 'No active litigation claims (5 pts)', value: 5 },
        { label: 'Active litigation claims (0 pts)', value: 0 }
      ]
    },

    'M6-Q1': {
      refId: 'M6-Q1', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'Statutory KYC & Tax Uploads', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 2.50, remarks: '',
      options: [
        { label: 'GSTIN, PAN & statutory compliance verified (5 pts)', value: 5 },
        { label: 'Pending verification (0 pts)', value: 0 }
      ]
    },
    'M6-Q2': {
      refId: 'M6-Q2', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'ISO 14001 / ISO 45001 Certs', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 2.50, remarks: '',
      options: [
        { label: 'ISO 14001 + 45001 certificates (5 pts)', value: 5 },
        { label: 'Single certificate only (3 pts)', value: 3 },
        { label: 'No certifications (0 pts)', value: 0 }
      ]
    },
    'M6-Q3': {
      refId: 'M6-Q3', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'Anti-Bribery & Ethics Policy', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 2.50, remarks: '',
      options: [
        { label: 'Signed Code of Conduct & Ethics (5 pts)', value: 5 },
        { label: 'Pending Code signing (0 pts)', value: 0 }
      ]
    },
    'M6-Q4': {
      refId: 'M6-Q4', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'ISO 27001 / GDPR Privacy', attachmentName: '', score: 0, weightedScore: 0, maxWeight: 2.50, remarks: '',
      options: [
        { label: 'ISO 27001 / GDPR Privacy (5 pts)', value: 5 },
        { label: 'GDPR compliance only (3 pts)', value: 3 },
        { label: 'No active privacy framework (0 pts)', value: 0 }
      ]
    }
  });

  const updateQuestionScore = (refId: string, value: number) => {
    setQState((prev) => {
      const q = prev[refId];
      const newWeighted = Math.round((value / 5.0) * q.maxWeight * 100) / 100;
      return {
        ...prev,
        [refId]: { ...q, score: value, weightedScore: newWeighted }
      };
    });
  };

  const updateQuestionRemarks = (refId: string, text: string) => {
    setQState((prev) => ({
      ...prev,
      [refId]: { ...prev[refId], remarks: text }
    }));
  };

  const handleFileUpload = (refId: string, filename: string) => {
    setQState((prev) => ({
      ...prev,
      [refId]: { ...prev[refId], attachmentName: filename }
    }));
    // Was claiming "AI OCR verified" here — this only ever reads the picked
    // file's name, never its contents, and there is no OCR/verification
    // backend anywhere in this app to have actually checked it.
    showToast('File Attached', `Document "${filename}" attached to ${refId}.`, 'success');
  };

  // Stepper calculations
  const currentTabIndex = MODULE_TABS.findIndex(t => t.id === activeTab);
  const activeModuleMeta = MODULE_TABS[currentTabIndex];

  const getPillarTotal = (pillarId: string) => {
    const qList = Object.values(qState).filter(q => q.pillarId === pillarId);
    if (qList.length === 0) return { avg: 0, weighted: 0 };
    const scoreSum = qList.reduce((acc, q) => acc + q.score, 0);
    const weightedSum = qList.reduce((acc, q) => acc + q.weightedScore, 0);
    return {
      avg: Math.round((scoreSum / qList.length) * 10) / 10,
      weighted: Math.round(weightedSum * 10) / 10
    };
  };

  const activeTotal = getPillarTotal(activeTab);

  // Overall totals
  const totalScorePercent = Math.round(
    Object.values(qState).reduce((acc, q) => acc + q.weightedScore, 0)
  );

  const getQualificationStatus = (score: number) => {
    if (score >= 80) return 'PREFERRED ENTERPRISE SUPPLIER';
    if (score >= 65) return 'CONDITIONAL / UNDER REVIEW';
    return 'DISQUALIFIED SUPPLIER';
  };

  const currentStatus = getQualificationStatus(totalScorePercent);

  const handleNextTab = () => {
    if (currentTabIndex < MODULE_TABS.length - 1) {
      setActiveTab(MODULE_TABS[currentTabIndex + 1].id);
    }
  };

  const handlePrevTab = () => {
    if (currentTabIndex > 0) {
      setActiveTab(MODULE_TABS[currentTabIndex - 1].id);
    }
  };

  const isFirstTab = currentTabIndex === 0;
  const isLastTab = currentTabIndex === MODULE_TABS.length - 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Issue 3: Make all document attachments optional.
    // Accept even 0 or a single attachment instead of requiring all 24 documents.
    // Do not block submission because of missing documents or unanswered optional fields.
    setSubmitting(true);

    const questionItems: QuestionEvaluationItem[] = Object.values(qState).map((q) => ({
      refId: q.refId,
      pillarId: q.pillarId,
      pillarName: q.pillarName,
      criteria: q.criteria,
      attachmentName: q.attachmentName || '',
      attachmentVerified: false,
      score: q.score,
      weightedScore: q.weightedScore,
      remarks: q.remarks || '',
    }));

    const record: VendorEvaluationRecord = {
      id: `eval-${Date.now()}`,
      vendorId: myVendorRecord?.id || '',
      vendorName: myVendorRecord?.name || currentUserSession?.orgName || currentUserSession?.name || 'Vendor',
      contactPerson: myVendorRecord?.contactPerson || currentUserSession?.name || '',
      email: currentUserSession?.email || myVendorRecord?.email || '',
      phone: myVendorRecord?.phone || '',
      category: myVendorRecord?.majorCategory || '',
      submissionDate: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      status: currentStatus,
      overallScore: totalScorePercent,
      systemAction: SELF_ASSESSMENT_SYSTEM_ACTION,
      moduleScores: {
        commercial: { score: getPillarTotal('M1').avg, maxScore: 5, weight: 25, weightedScore: getPillarTotal('M1').weighted, remarks: qState['M1-Q1']?.remarks || '' },
        technical: { score: getPillarTotal('M2').avg, maxScore: 5, weight: 15, weightedScore: getPillarTotal('M2').weighted, remarks: qState['M2-Q1']?.remarks || '' },
        quality: { score: getPillarTotal('M3').avg, maxScore: 5, weight: 20, weightedScore: getPillarTotal('M3').weighted, remarks: qState['M3-Q1']?.remarks || '' },
        delivery: { score: getPillarTotal('M4').avg, maxScore: 5, weight: 20, weightedScore: getPillarTotal('M4').weighted, remarks: qState['M4-Q1']?.remarks || '' },
        financial: { score: getPillarTotal('M5').avg, maxScore: 5, weight: 10, weightedScore: getPillarTotal('M5').weighted, remarks: qState['M5-Q1']?.remarks || '' },
        governance: { score: getPillarTotal('M6').avg, maxScore: 5, weight: 10, weightedScore: getPillarTotal('M6').weighted, remarks: qState['M6-Q1']?.remarks || '' },
      },
      documents: Object.values(qState).map((q) => ({
        id: `doc-${q.refId}`,
        name: q.attachmentName || 'Not Provided (Optional)',
        type: q.criteria,
        uploadDate: new Date().toISOString().substring(0, 10),
        verified: false,
        status: (q.attachmentName ? 'Pending Review' : 'Missing') as 'Verified' | 'Pending Review' | 'Missing',
      })),
      questionBreakdown: questionItems,
    };

    // The evaluation is saved through the real endpoint. Success is shown only when
    // that call confirms the save. The server stores the record as sent and does not
    // dispatch RFQs, so no dispatch is reported here.
    const saved = await addVendorEvaluation(record);
    setSubmitting(false);
    if (!saved) {
      showToast(
        'Submission Failed',
        'Could not save your qualification evaluation. Please try again.',
        'warning'
      );
      return;
    }

    addAuditLog(
      `Mode 3 Vendor Qualification Survey submitted by ${record.vendorName}. Score: ${totalScorePercent}% (${currentStatus})`
    );

    void addFeedItem(
      `Mode 3 Qualification Score: ${totalScorePercent}%`,
      `${record.vendorName} scored ${totalScorePercent}% in Mode 3 AI Evaluation. Status: ${currentStatus}.`,
      'scoring',
      undefined,
      record.vendorName
    );

    setVendorSelfEvaluationCompleted(true);
    setVendorSelfEvaluationScore(totalScorePercent);
    setEvaluationResult(record);
    onSuccess(record);

    showToast(
      `AI Evaluation Complete (${totalScorePercent}%)`,
      `Your evaluation was saved. Status: ${currentStatus}.`,
      totalScorePercent >= 80 ? 'success' : 'warning'
    );
  };

  const activeQuestions = Object.values(qState).filter((q) => q.pillarId === activeTab);
  const vendorName = myVendorRecord?.name || currentUserSession?.orgName || currentUserSession?.name || 'Vendor';
  const vendorInitials = vendorName.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'VE';

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xl">⭐</span>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Premium Vendor: 360-Degree AI Self-Evaluation
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              Multi-Section Assessment
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Complete your 360° AI Self-Evaluation (Commercial, Technical, Quality, Delivery, Financial & ESG). {UI_STRINGS.vendorWorkspace.evaluationSavedNotice}
          </p>
        </div>
        <button onClick={onBack} className="btn btn-secondary btn-sm self-start sm:self-auto cursor-pointer">
          ← Back to Workspace
        </button>
      </div>

      {/* Floating Executive Score Bar matching Image 1 */}
      <div className="p-4 rounded-2xl bg-slate-900 dark:bg-gray-950 text-white shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/40 text-blue-300 font-black text-xs flex items-center justify-center shrink-0 shadow-inner">
            {vendorInitials}
          </div>
          <div>
            <div className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <Sparkles size={14} className="text-emerald-400 shrink-0" />
              <span>{vendorName} — Live AI Capability Rating</span>
              <span className="text-slate-400 font-normal">•</span>
              <span className="text-blue-400">LEVEL 4 (COMPREHENSIVE RATING)</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Current Module: <strong className="text-slate-200">{activeModuleMeta.name}</strong> ({activeModuleMeta.weight}% weighting)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 shrink-0 self-end md:self-auto">
          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase font-extrabold tracking-wider">Latest Completion Score</div>
            <div className="text-2xl font-black mono text-emerald-400">{totalScorePercent}%</div>
          </div>

          <button
            type="button"
            onClick={() => setShowDetailedReportModal(true)}
            className="btn btn-sm bg-rose-950/90 hover:bg-rose-900 text-rose-200 border border-rose-850 rounded-xl px-3.5 py-2 flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider cursor-pointer shadow-sm transition-all"
          >
            <Eye size={13} className="text-rose-400" />
            <span>View Detailed Report</span>
          </button>
        </div>
      </div>

      {/* ── MODULE TABS BAR ── */}
      <div className="flex items-center gap-2 overflow-x-auto p-1.5 rounded-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-xs">
        <button
          type="button"
          onClick={() => setViewAllModules(!viewAllModules)}
          className="sr-only"
        >
          <span>{viewAllModules ? '✓ All 6 Modules (Single Window)' : 'View All 6 Modules (Single Window)'}</span>
        </button>

        {MODULE_TABS.map((tab, idx) => {
          const isSelected = !viewAllModules && activeTab === tab.id;
          const pTotal = getPillarTotal(tab.id);
          const scorePercent = Math.round((pTotal.weighted / tab.weight) * 100);
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={`${idx + 1} ${tab.name}`}
              onClick={() => {
                setViewAllModules(false);
                setActiveTab(tab.id);
              }}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-50 dark:bg-gray-850/60 text-slate-700 dark:text-gray-300 border border-slate-200/80 dark:border-gray-800 hover:bg-slate-100 dark:hover:bg-gray-800'
              }`}
            >
              <span>{idx + 1}. {tab.name}</span>
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                isSelected
                  ? 'bg-blue-700/80 text-white'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
              }`}>
                {scorePercent}%
              </span>
            </button>
          );
        })}
      </div>

      {/* ── TABULAR MODULE EVALUATION VIEW ── */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {MODULE_TABS.map((tabMeta) => {
          if (!viewAllModules && activeTab !== tabMeta.id) return null;
          const questions = Object.values(qState).filter((q) => q.pillarId === tabMeta.id);
          const pTotal = getPillarTotal(tabMeta.id);
          const sectionPercent = Math.round((pTotal.weighted / tabMeta.weight) * 100);

          return (
            <div
              key={tabMeta.id}
              id={`module-${tabMeta.id}`}
              className="p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs"
            >
              {/* Module Header Card matching Image 1 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-gray-800">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono font-bold text-xs flex items-center justify-center border border-blue-200 dark:border-blue-800">
                    {tabMeta.id}
                  </span>
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                      {tabMeta.code}: {tabMeta.name}
                    </h2>
                    <span className="text-[11px] text-slate-400">
                      Module Weight: {tabMeta.weight}% of comprehensive score
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    Section Score: {sectionPercent}% • Pillar Score: {pTotal.weighted} / {tabMeta.weight} pts
                  </span>
                </div>
              </div>

              {/* Table matching Image 1 */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-gray-950 text-[11px] font-bold text-slate-700 dark:text-gray-300 border-b border-slate-200 dark:border-gray-800">
                      <th className="px-3.5 py-3 w-12 text-center whitespace-nowrap">S.No</th>
                      <th className="px-3.5 py-3 w-28 text-center whitespace-nowrap">Question ID</th>
                      <th className="px-3.5 py-3 min-w-[200px]">Parameter</th>
                      <th className="px-3.5 py-3 min-w-[240px]">Compliance Option (Selection)</th>
                      <th className="px-3.5 py-3 min-w-[200px]">Evidence (Attachment)</th>
                      <th className="px-3.5 py-3 min-w-[240px]">Justification Remarks / Compliance Clarification</th>
                      <th className="px-3.5 py-3 w-28 text-center whitespace-nowrap">Score (Earned / Max)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                    {questions.map((q, idx) => (
                      <tr key={q.refId} className="hover:bg-slate-50/70 dark:hover:bg-gray-850/40 transition-colors">
                        <td className="px-3.5 py-3.5 font-bold text-slate-700 dark:text-gray-300 text-center align-middle whitespace-nowrap">
                          {idx + 1}
                        </td>
                        <td className="px-3.5 py-3.5 align-middle text-center whitespace-nowrap w-28">
                          <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-bold font-mono text-xs border border-blue-200 dark:border-blue-800/60 whitespace-nowrap">
                            {q.refId}
                          </span>
                        </td>
                        <td className="px-3.5 py-3.5 align-middle font-bold text-slate-900 dark:text-white">
                          <div>{q.criteria}</div>
                          <div className="text-[10px] text-slate-400 font-normal mt-0.5">Max Weight: {q.maxWeight} pts</div>
                        </td>
                        <td className="px-3.5 py-3.5 align-middle">
                          <select
                            value={q.score}
                            onChange={(e) => updateQuestionScore(q.refId, Number(e.target.value))}
                            className="w-full text-xs font-semibold py-2 px-3 rounded-lg border border-slate-200 dark:border-gray-750 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/20"
                          >
                            {q.options.map((opt, oIdx) => (
                              <option key={oIdx} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3.5 py-3.5 align-middle">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
                              <Paperclip size={13} className="shrink-0 text-slate-400" />
                              {q.attachmentName ? (
                                <div className="space-y-0.5">
                                  <span className="text-[10px] font-mono font-semibold text-slate-800 dark:text-gray-200 block truncate max-w-[140px]">
                                    {q.attachmentName}
                                  </span>
                                  <span className="text-[9px] font-bold text-amber-700 dark:text-amber-300 block">
                                    📎 File Attached (Not OCR-Verified)
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">No File Attached</span>
                              )}
                            </div>
                            <label className="btn btn-secondary btn-xs cursor-pointer inline-flex items-center gap-1 text-[11px] py-1 px-2.5 font-bold rounded-lg border border-slate-200 dark:border-gray-700">
                              <UploadCloud size={12} />
                              <span>{q.attachmentName ? 'Change File' : 'Attach File'}</span>
                              <input
                                type="file"
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    handleFileUpload(q.refId, e.target.files[0].name);
                                  }
                                }}
                              />
                            </label>
                          </div>
                        </td>
                        <td className="px-3.5 py-3.5 align-middle">
                          <div className="relative">
                            <input
                              type="text"
                              value={q.remarks}
                              onChange={(e) => updateQuestionRemarks(q.refId, e.target.value)}
                              placeholder="Write compliance remarks or audit justification notes..."
                              className="w-full text-xs font-medium py-2 pl-3 pr-8 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 placeholder:text-slate-400 text-slate-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/20"
                            />
                            <Pencil size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>
                        </td>
                        <td className="px-3.5 py-3.5 text-center align-middle whitespace-nowrap">
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-xs">
                            +{q.weightedScore} pts ({q.score}/5.0)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* ── STEPPER NAVIGATION FOOTER BAR ── */}
        <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <button
            type="button"
            onClick={handlePrevTab}
            disabled={isFirstTab && !viewAllModules}
            className={`btn btn-secondary btn-sm flex items-center gap-1.5 font-bold ${isFirstTab && !viewAllModules ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <ChevronLeft size={15} /> Previous Module
          </button>

          <div className="text-xs font-bold text-slate-600 dark:text-gray-300">
            {viewAllModules ? 'Viewing All 6 Evaluation Modules' : `Step ${currentTabIndex + 1} of ${MODULE_TABS.length}: ${activeModuleMeta.name}`}
          </div>

          <div className="flex items-center gap-2">
            {!isLastTab && !viewAllModules && (
              <button
                type="button"
                onClick={handleNextTab}
                className="btn btn-primary btn-sm flex items-center gap-1.5 font-bold cursor-pointer"
              >
                Next Module ({MODULE_TABS[currentTabIndex + 1].name}) <ChevronRight size={15} />
              </button>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary btn-sm flex items-center gap-1.5 font-bold cursor-pointer"
            >
              {submitting ? (
                <>
                  <Clock className="animate-spin" size={15} /> Evaluating...
                </>
              ) : (
                <>
                  <Send size={14} /> Submit Final Qualification
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Detailed Report Modal */}
      {showDetailedReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 dark:border-gray-800 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <FileCheck className="text-blue-600" size={20} />
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  360° AI Evaluation Comprehensive Report
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDetailedReportModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Vendor Organization</span>
                <span className="text-base font-extrabold text-white">{vendorName}</span>
                <span className="block text-xs text-blue-300 font-semibold mt-0.5">{currentStatus}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Live Completion Score</span>
                <span className="text-3xl font-black text-emerald-400 mono">{totalScorePercent}%</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-gray-300 uppercase tracking-wider">Module Breakdown</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {MODULE_TABS.map((tab, idx) => {
                  const pTotal = getPillarTotal(tab.id);
                  const pct = Math.round((pTotal.weighted / tab.weight) * 100);
                  return (
                    <div key={tab.id} className="p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-850/50 flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-bold text-slate-800 dark:text-gray-200 block">
                          {idx + 1}. {tab.name}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-gray-400">
                          Weight: {tab.weight}% • {pTotal.weighted}/{tab.weight} pts
                        </span>
                      </div>
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setShowDetailedReportModal(false)}
                className="btn btn-secondary btn-sm font-bold cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
