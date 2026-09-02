'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { VendorEvaluationRecord, QuestionEvaluationItem } from '@/lib/types';
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
    vendorSubscription,
    isVendorEvaluationFeeWaived,
    setVendorSelfEvaluationCompleted,
    setVendorSelfEvaluationScore,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6'>('M1');
  const [submitting, setSubmitting] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<VendorEvaluationRecord | null>(null);

  // 24 Detailed Question States with their specific descriptive options
  const [qState, setQState] = useState<Record<string, QuestionFormState>>({
    'M1-Q1': {
      refId: 'M1-Q1', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Commercial Payment Terms', attachmentName: 'Terms_Net60.pdf', score: 5.0, weightedScore: 6.25, maxWeight: 6.25, remarks: 'Agreed to Net 60 payment terms without price escalation penalty.',
      options: [
        { label: 'Net 60+ Days (5 pts - Optimal)', value: 5 },
        { label: 'Net 30 Days (4 pts - Standard)', value: 4 },
        { label: 'Net 15 Days (2 pts)', value: 2 },
        { label: '100% Advance Payment (0 pts)', value: 0 }
      ]
    },
    'M1-Q2': {
      refId: 'M1-Q2', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Fixed Price Contract (12 Mo)', attachmentName: 'Rate_Contract_Agreement_12Mo.pdf', score: 5.0, weightedScore: 6.25, maxWeight: 6.25, remarks: 'Signed 12-month fixed rate agreement attached; no commodity indexation.',
      options: [
        { label: 'Yes (Fixed 12 Months - 5 pts)', value: 5 },
        { label: 'No (Variable Pricing - 1 pt)', value: 1 }
      ]
    },
    'M1-Q3': {
      refId: 'M1-Q3', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Inclusivity of Freight (DDP)', attachmentName: 'Freight_Policy.pdf', score: 4.0, weightedScore: 5.00, maxWeight: 6.25, remarks: 'DDP terms confirmed for regional sites; remote sites capped at 2%.',
      options: [
        { label: 'Full DDP / Door Delivery Included (5 pts)', value: 5 },
        { label: 'FOR Destination Only (3 pts)', value: 3 },
        { label: 'Ex-Works Only (Freight Extra - 1 pt)', value: 1 }
      ]
    },
    'M1-Q4': {
      refId: 'M1-Q4', pillarId: 'M1', pillarName: 'Commercial Terms (25%)', criteria: 'Volume Tier Discounting', attachmentName: 'Volume_Discount_Matrix_Tier.xlsx', score: 5.0, weightedScore: 6.25, maxWeight: 6.25, remarks: 'Verified tier structure: 6.5% discount unlocked on volumes >500 units.',
      options: [
        { label: '> 5% Volume Discount (5 pts)', value: 5 },
        { label: '2% - 5% Volume Discount (3 pts)', value: 3 },
        { label: '0% / No Volume Discount (1 pt)', value: 1 }
      ]
    },

    'M2-Q1': {
      refId: 'M2-Q1', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: 'BOQ Spec Compliance', attachmentName: 'Technical_BOQ_Compliance_Datasheet.pdf', score: 5.0, weightedScore: 3.75, maxWeight: 3.75, remarks: 'Technical datasheet verified via OCR; 100% parameter compliance.',
      options: [
        { label: '100% Full Spec Compliance (5 pts)', value: 5 },
        { label: 'Partial Compliance / Deviations (2 pts)', value: 2 },
        { label: 'Non-Compliant (0 pts)', value: 0 }
      ]
    },
    'M2-Q2': {
      refId: 'M2-Q2', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: 'Equipment Automation', attachmentName: 'Factory_Equipment_Automation_Log.pdf', score: 5.0, weightedScore: 3.75, maxWeight: 3.75, remarks: 'Multi-axis CNC machines and robotic welding verified via audit log.',
      options: [
        { label: 'Fully Automated / Robotic CNC Lines (5 pts)', value: 5 },
        { label: 'Semi-Automated Lines (3 pts)', value: 3 },
        { label: 'Manual Machining Lines (1 pt)', value: 1 }
      ]
    },
    'M2-Q3': {
      refId: 'M2-Q3', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: 'In-House R&D / Testing', attachmentName: 'NABL_Lab_Accreditation_Certificate.pdf', score: 5.0, weightedScore: 3.75, maxWeight: 3.75, remarks: 'In-house NABL-accredited metallurgical testing laboratory confirmed.',
      options: [
        { label: 'Yes + Lab Accreditation Cert (5 pts)', value: 5 },
        { label: 'No In-House Lab (1 pt)', value: 1 }
      ]
    },
    'M2-Q4': {
      refId: 'M2-Q4', pillarId: 'M2', pillarName: 'Technical Capabilities (15%)', criteria: '24/7 Technical Support', attachmentName: 'Technical_Service_SLA_Agreement.pdf', score: 4.0, weightedScore: 3.00, maxWeight: 3.75, remarks: 'Dedicated field service team available in key regions; 4-hour SLA.',
      options: [
        { label: '24/7 On-Site Engineering Support (5 pts)', value: 5 },
        { label: 'Remote Engineering Support Only (3 pts)', value: 3 },
        { label: 'No Post-Sales Support (0 pts)', value: 0 }
      ]
    },

    'M3-Q1': {
      refId: 'M3-Q1', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'ISO 9001:2015 Certification', attachmentName: 'ISO_9001_TUV_Certificate.pdf', score: 5.0, weightedScore: 5.00, maxWeight: 5.00, remarks: 'ISO 9001:2015 certificate valid through Nov 2028 (TÜV SÜD).',
      options: [
        { label: 'ISO 9001:2015 Verified Upload (5 pts)', value: 5 },
        { label: 'No ISO Quality Certification (0 pts)', value: 0 }
      ]
    },
    'M3-Q2': {
      refId: 'M3-Q2', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'Defect Rate (PPM History)', attachmentName: 'Historical_12M_Quality_Defect_Log.pdf', score: 5.0, weightedScore: 5.00, maxWeight: 5.00, remarks: 'Past 12-month quality log verified: 280 PPM recorded.',
      options: [
        { label: '< 500 PPM Defect Rate (5 pts - Six Sigma)', value: 5 },
        { label: '500 - 1000 PPM (3 pts)', value: 3 },
        { label: '> 1000 PPM (1 pt)', value: 1 }
      ]
    },
    'M3-Q3': {
      refId: 'M3-Q3', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'Comprehensive Warranty', attachmentName: 'Enterprise_Warranty_Policy_24Mo.pdf', score: 5.0, weightedScore: 5.00, maxWeight: 5.00, remarks: 'Standard 24-month warranty provided; 36-month option available.',
      options: [
        { label: '≥ 24 Months Warranty (5 pts)', value: 5 },
        { label: '12 - 23 Months Warranty (3 pts)', value: 3 },
        { label: '< 12 Months Warranty (1 pt)', value: 1 }
      ]
    },
    'M3-Q4': {
      refId: 'M3-Q4', pillarId: 'M3', pillarName: 'Quality & Warranty (20%)', criteria: 'Batch Traceability (RFID)', attachmentName: 'RFID_Batch_Traceability_Manual.pdf', score: 5.0, weightedScore: 5.00, maxWeight: 5.00, remarks: 'RFID tracking active at receiving, assembly, and dispatch stages.',
      options: [
        { label: 'RFID batch tracing (5 pts)', value: 5 },
        { label: 'Manual log tracking (3 pts)', value: 3 },
        { label: 'No traceability (0 pts)', value: 0 }
      ]
    },

    'M4-Q1': {
      refId: 'M4-Q1', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Verified OTIF Rate', attachmentName: '4_Quarter_OTIF_Audit_Report.pdf', score: 3.0, weightedScore: 3.00, maxWeight: 5.00, remarks: 'Verified average OTIF of 92.4% over past 4 quarters (Q2 port delay).',
      options: [
        { label: '≥ 95% OTIF delivery rate (5 pts)', value: 5 },
        { label: '90% - 94% OTIF (3 pts)', value: 3 },
        { label: '< 90% OTIF (1 pt)', value: 1 }
      ]
    },
    'M4-Q2': {
      refId: 'M4-Q2', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Manufacturing Lead Time', attachmentName: 'Production_SLA_Timeline_Doc.pdf', score: 5.0, weightedScore: 5.00, maxWeight: 5.00, remarks: 'Standard lead time is 12 days, well within the 15-day SLA requirement.',
      options: [
        { label: 'Standard lead time <= 12 days (SLA) (5 pts)', value: 5 },
        { label: '13-15 days (3 pts)', value: 3 },
        { label: '> 15 days (1 pt)', value: 1 }
      ]
    },
    'M4-Q3': {
      refId: 'M4-Q3', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Capacity Utilization Rate', attachmentName: 'Plant_Capacity_Utilization_Audit.pdf', score: 5.0, weightedScore: 5.00, maxWeight: 5.00, remarks: 'Plant operating at 74% capacity, leaving room for surge demand.',
      options: [
        { label: '60% - 85% capacity utilization (5 pts - Optimal)', value: 5 },
        { label: '86% - 95% capacity (3 pts)', value: 3 },
        { label: '> 95% or < 60% capacity (1 pt)', value: 1 }
      ]
    },
    'M4-Q4': {
      refId: 'M4-Q4', pillarId: 'M4', pillarName: 'Operational Delivery (20%)', criteria: 'Disaster Recovery (BCP)', attachmentName: 'Business_Continuity_Plan_BCP.pdf', score: 5.0, weightedScore: 5.00, maxWeight: 5.00, remarks: 'BCP document attached; includes dual-sourcing & generator backup.',
      options: [
        { label: 'Active tested BCP Plan (5 pts)', value: 5 },
        { label: 'No active BCP Plan (0 pts)', value: 0 }
      ]
    },

    'M5-Q1': {
      refId: 'M5-Q1', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Annual Financial Turnover', attachmentName: '3_Year_Audited_Financial_Statements.pdf', score: 5.0, weightedScore: 2.50, maxWeight: 2.50, remarks: 'Audited statements confirm turnover of $18.5M (≥ 5x contract value).',
      options: [
        { label: '>= 3x turnover (5 pts)', value: 5 },
        { label: '1.5x - 3x turnover (3 pts)', value: 3 },
        { label: '< 1.5x turnover (0 pts)', value: 0 }
      ]
    },
    'M5-Q2': {
      refId: 'M5-Q2', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Credit Rating Score', attachmentName: 'CRISIL_Credit_Rating_Report.pdf', score: 5.0, weightedScore: 2.50, maxWeight: 2.50, remarks: 'CRISIL A+ rating verified; low default risk profile.',
      options: [
        { label: 'Investment Grade (AAA/A/BBB) (5 pts)', value: 5 },
        { label: 'Non-Investment Grade (0 pts)', value: 0 }
      ]
    },
    'M5-Q3': {
      refId: 'M5-Q3', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Current Liquidity Ratio', attachmentName: 'Certified_Liquidity_Solvency_Sheet.pdf', score: 5.0, weightedScore: 2.50, maxWeight: 2.50, remarks: 'Liquidity ratio stands at 1.82; sufficient working capital.',
      options: [
        { label: 'Current ratio >= 1.5 (5 pts)', value: 5 },
        { label: 'Current ratio < 1.5 (2 pts)', value: 2 }
      ]
    },
    'M5-Q4': {
      refId: 'M5-Q4', pillarId: 'M5', pillarName: 'Financial Stability (10%)', criteria: 'Active Litigation Claims', attachmentName: 'Legal_Compliance_Non_Insolvency_Cert.pdf', score: 5.0, weightedScore: 2.50, maxWeight: 2.50, remarks: 'Legal compliance check clear; no outstanding bankruptcy or litigation.',
      options: [
        { label: 'No active litigation claims (5 pts)', value: 5 },
        { label: 'Active litigation claims (0 pts)', value: 0 }
      ]
    },

    'M6-Q1': {
      refId: 'M6-Q1', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'Statutory KYC & Tax Uploads', attachmentName: 'GSTIN_PAN_Incorporation_KYC.pdf', score: 5.0, weightedScore: 2.50, maxWeight: 2.50, remarks: 'GSTIN, PAN, and Tax Incorporation verified against govt database.',
      options: [
        { label: 'GSTIN, PAN & statutory compliance verified (5 pts)', value: 5 },
        { label: 'Pending verification (0 pts)', value: 0 }
      ]
    },
    'M6-Q2': {
      refId: 'M6-Q2', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'ISO 14001 / ISO 45001 Certs', attachmentName: 'ISO_14001_EHS_Certificate.pdf', score: 3.0, weightedScore: 1.50, maxWeight: 2.50, remarks: 'ISO 14001 verified; ISO 45001 pending renewal in 3 months.',
      options: [
        { label: 'ISO 14001 + 45001 certificates (5 pts)', value: 5 },
        { label: 'Single certificate only (3 pts)', value: 3 },
        { label: 'No certifications (0 pts)', value: 0 }
      ]
    },
    'M6-Q3': {
      refId: 'M6-Q3', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'Anti-Bribery & Ethics Policy', attachmentName: 'Signed_Anti_Bribery_Code_of_Conduct.pdf', score: 5.0, weightedScore: 2.50, maxWeight: 2.50, remarks: 'Code of Conduct & Anti-Bribery agreement signed by MD.',
      options: [
        { label: 'Signed Code of Conduct & Ethics (5 pts)', value: 5 },
        { label: 'Pending Code signing (0 pts)', value: 0 }
      ]
    },
    'M6-Q4': {
      refId: 'M6-Q4', pillarId: 'M6', pillarName: 'Governance & ESG (10%)', criteria: 'ISO 27001 / GDPR Privacy', attachmentName: 'ISO_27001_Information_Security.pdf', score: 5.0, weightedScore: 2.50, maxWeight: 2.50, remarks: 'ISO 27001 certification active; enterprise security standards met.',
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
    showToast('File Attached', `Document "${filename}" attached to ${refId}. AI OCR verified.`, 'success');
  };

  // Stepper calculations
  const currentTabIndex = MODULE_TABS.findIndex(t => t.id === activeTab);
  const activeModuleMeta = MODULE_TABS[currentTabIndex];

  const getPillarTotal = (pillarId: string) => {
    const qList = Object.values(qState).filter(q => q.pillarId === pillarId);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    setTimeout(() => {
      const questionItems: QuestionEvaluationItem[] = Object.values(qState).map(q => ({
        refId: q.refId,
        pillarId: q.pillarId,
        pillarName: q.pillarName,
        criteria: q.criteria,
        attachmentName: q.attachmentName,
        attachmentVerified: true,
        score: q.score,
        weightedScore: q.weightedScore,
        remarks: q.remarks
      }));

      const record: VendorEvaluationRecord = {
        id: `eval-${Date.now()}`,
        vendorId: 'v-1',
        vendorName: 'Apex Supplies Ltd.',
        contactPerson: 'Rajesh Nair',
        email: 'rajesh@apexsupplies.in',
        phone: '+91 98201 44820',
        category: 'Heavy Mechanical & Fluid Dynamics',
        submissionDate: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
        status: currentStatus,
        overallScore: totalScorePercent,
        systemAction:
          totalScorePercent >= 80
            ? 'AUTOMATIC DIRECT RFQ DISPATCH TO VENDOR INBOX. 24/24 mandatory attachments verified via AI OCR engine. Vendor added to Mode 3 active bidding roster.'
            : totalScorePercent >= 65
            ? 'RFQ DISPATCH HELD. System triggered Corrective Action Plan (CAPA) or requested document clarification.'
            : 'EXCLUDED FROM ACTIVE RFQ DISPATCH. Re-audit option unlocked after 90 days.',
        moduleScores: {
          commercial: { score: getPillarTotal('M1').avg, maxScore: 5, weight: 25, weightedScore: getPillarTotal('M1').weighted, remarks: qState['M1-Q1'].remarks },
          technical: { score: getPillarTotal('M2').avg, maxScore: 5, weight: 15, weightedScore: getPillarTotal('M2').weighted, remarks: qState['M2-Q1'].remarks },
          quality: { score: getPillarTotal('M3').avg, maxScore: 5, weight: 20, weightedScore: getPillarTotal('M3').weighted, remarks: qState['M3-Q1'].remarks },
          delivery: { score: getPillarTotal('M4').avg, maxScore: 5, weight: 20, weightedScore: getPillarTotal('M4').weighted, remarks: qState['M4-Q1'].remarks },
          financial: { score: getPillarTotal('M5').avg, maxScore: 5, weight: 10, weightedScore: getPillarTotal('M5').weighted, remarks: qState['M5-Q1'].remarks },
          governance: { score: getPillarTotal('M6').avg, maxScore: 5, weight: 10, weightedScore: getPillarTotal('M6').weighted, remarks: qState['M6-Q1'].remarks },
        },
        documents: Object.values(qState).map((q, idx) => ({
          id: `doc-${q.refId}`,
          name: q.attachmentName,
          type: q.criteria,
          uploadDate: '2026-08-22',
          verified: true,
          status: 'Verified'
        })),
        questionBreakdown: questionItems
      };

      addVendorEvaluation(record);
      addAuditLog(
        `Mode 3 Vendor Qualification Survey submitted by Apex Supplies Ltd. Score: ${totalScorePercent}% (${currentStatus})`,
        'Mode-3-Audit',
        'rajesh@apexsupplies.in'
      );

      addFeedItem(
        `Mode 3 Qualification Score: ${totalScorePercent}%`,
        `Apex Supplies Ltd. scored ${totalScorePercent}% in Mode 3 AI Evaluation. Status: ${currentStatus}. ${record.systemAction}`,
        'scoring',
        'RFQ-2026-00421',
        'Apex Supplies Ltd.'
      );

      setSubmitting(false);
      setVendorSelfEvaluationCompleted(true);
      setVendorSelfEvaluationScore(totalScorePercent);
      setEvaluationResult(record);
      onSuccess(record);

      showToast(
        `AI Evaluation Complete (${totalScorePercent}%)`,
        currentStatus === 'PREFERRED ENTERPRISE SUPPLIER'
          ? 'Congratulations! You are unlocked as a Preferred Enterprise Supplier. Active RFQs dispatched to your inbox.'
          : 'Evaluation submitted. Review detailed score breakdown below.',
        totalScorePercent >= 80 ? 'success' : 'warning'
      );
    }, 1200);
  };

  const activeQuestions = Object.values(qState).filter(q => q.pillarId === activeTab);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              ⭐ Premium Vendor: 360-Degree AI Self-Evaluation
            </h1>
            <span className="badge badge-emerald">Multi-Buyer Certified</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Complete your 360° AI Self-Evaluation (Commercial, Technical, Quality, Delivery, Financial & ESG) to get certified and receive RFQs from all enterprise buyers.
          </p>
        </div>
        <button onClick={onBack} className="btn btn-secondary btn-sm">
          ← Back to Workspace
        </button>
      </div>

      {/* Floating Executive Score Bar */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xl border border-indigo-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-indigo-300 font-bold uppercase tracking-wider">
            <Sparkles size={14} className="text-emerald-400" /> Apex Supplies Ltd. — Live AI Capability Rating
          </div>
          <div className="text-xs text-indigo-200/80">
            Step {currentTabIndex + 1} of {MODULE_TABS.length}: <strong className="text-white">{activeModuleMeta.name}</strong> ({activeModuleMeta.weight}% weight)
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-[10px] text-indigo-300 uppercase font-bold">Live Computed Score</div>
            <div className="text-2xl font-black mono text-emerald-400">{totalScorePercent}%</div>
          </div>
          <span
            className={`px-3 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wide ${
              totalScorePercent >= 80
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : totalScorePercent >= 65
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
            }`}
          >
            {currentStatus}
          </span>
        </div>
      </div>

      {/* Infra & AI Evaluation Fee Banner ($5 or $0 with Connect/Select) */}
      <div className="p-3.5 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-between gap-3 text-xs flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center font-black">
            💳
          </div>
          <div>
            <span className="font-bold text-slate-900 dark:text-white">
              360° AI Self-Evaluation Infrastructure Fee:
            </span>{' '}
            {isVendorEvaluationFeeWaived ? (
              <span className="text-emerald-700 dark:text-emerald-300 font-bold">
                $0 FREE (100% Waived under your active {vendorSubscription === 'connect' ? 'Connect' : 'Select'} Tier)
              </span>
            ) : (
              <span className="text-amber-800 dark:text-amber-300 font-bold">
                $5 Nominal Fee (Towards Cloud Infrastructure & AI Compute Costs) • Fee is $0 if you take any subscription (Connect or Select)
              </span>
            )}
          </div>
        </div>

        {!isVendorEvaluationFeeWaived && (
          <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-white dark:bg-gray-800 px-3 py-1 rounded-full border border-indigo-200 dark:border-indigo-800">
            Cost = $0 with Connect / Select Plan
          </span>
        )}
      </div>

      {/* ── MODULE TABS BAR ── */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-gray-800 shadow-sm overflow-x-auto">
        {MODULE_TABS.map((tab, idx) => {
          const isSelected = activeTab === tab.id;
          const pTotal = getPillarTotal(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                isSelected
                  ? tab.activeColor
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/60'
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-gray-800 text-slate-500'}`}>
                {idx + 1}
              </span>
              <span>{tab.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isSelected ? 'bg-black/20 text-white' : 'bg-slate-100 dark:bg-gray-800 text-slate-500'}`}>
                {pTotal.weighted}/{tab.weight} pts
              </span>
            </button>
          );
        })}
      </div>

      {/* Visual Helper: Next tab indicator */}
      {!isLastTab && (
        <div className="px-4 py-2 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-900/30 rounded-xl text-xs font-bold flex items-center justify-between animate-pulse">
          <span>Complete this module to proceed.</span>
          <span>Next Tab Available: {MODULE_TABS[currentTabIndex + 1].name} →</span>
        </div>
      )}

      {/* ── ACTIVE MODULE CARD VIEW ── */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="glass-panel p-6 rounded-2xl space-y-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md">
          {/* Active Module Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-gray-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                  {activeTab}
                </span>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {activeModuleMeta.code}: {activeModuleMeta.name}
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Evaluation Weight: <strong>{activeModuleMeta.weight}%</strong> of overall score • Select your descriptive compliance rating, upload file attachments, and write justification remarks for each parameter.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                Pillar Score: {activeTotal.weighted} / {activeModuleMeta.weight} pts
              </span>
            </div>
          </div>

          {/* 4 Questions Grid for Active Module */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {activeQuestions.map((q) => (
              <div key={q.refId} className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-3 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                      {q.refId}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                      +{q.weightedScore} pts ({q.score}/5.0)
                    </span>
                  </div>

                  <div>
                    <label className="font-bold text-slate-800 dark:text-gray-200 block text-xs leading-relaxed">
                      {q.criteria}
                    </label>
                  </div>

                  {/* Rating Selector */}
                  <div>
                    <label className="text-[10px] text-slate-400 dark:text-gray-500 uppercase font-bold block mb-1">
                      Choose Compliance Options:
                    </label>
                    <select
                      value={q.score}
                      onChange={(e) => updateQuestionScore(q.refId, Number(e.target.value))}
                      className="text-xs font-semibold w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800"
                    >
                      {q.options.map((opt, oIdx) => (
                        <option key={oIdx} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Attachment Option against each question */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1">
                        <Paperclip size={11} className="text-indigo-600" /> Attached Evidence File:
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        ✓ OCR Verified
                      </span>
                    </div>
                    <div className="text-[11px] font-mono font-semibold text-slate-700 dark:text-gray-300 truncate">
                      {q.attachmentName}
                    </div>
                    <div className="flex gap-2">
                      <label className="btn btn-secondary btn-xs cursor-pointer flex items-center gap-1 text-[9px]">
                        <UploadCloud size={10} /> Change File
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
                      <button
                        type="button"
                        onClick={() => showToast('OCR Re-run Initiated', 'Comparing file parameters against enterprise specification.', 'info')}
                        className="btn btn-ghost btn-xs text-[9px] text-indigo-600 dark:text-indigo-400 font-bold"
                      >
                        Re-scan Document
                      </button>
                    </div>
                  </div>

                  {/* Remarks input field against each question */}
                  <div>
                    <label className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold block mb-1">
                      💬 Justification Remarks / Compliance Clarification:
                    </label>
                    <textarea
                      rows={2}
                      value={q.remarks}
                      onChange={(e) => updateQuestionRemarks(q.refId, e.target.value)}
                      className="text-xs font-medium w-full p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800/80"
                      placeholder="Write compliance remarks or audit justification notes..."
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── STEPPER NAVIGATION FOOTER BAR ── */}
        <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-md">
          <button
            type="button"
            onClick={handlePrevTab}
            disabled={isFirstTab}
            className={`btn btn-secondary btn-sm flex items-center gap-1.5 ${isFirstTab ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <ChevronLeft size={15} /> Previous Module
          </button>

          <div className="text-xs font-bold text-slate-600 dark:text-gray-300 hidden sm:block">
            Step {currentTabIndex + 1} of {MODULE_TABS.length}: {activeModuleMeta.name}
          </div>

          {!isLastTab ? (
            <button
              type="button"
              onClick={handleNextTab}
              className="btn btn-primary btn-sm flex items-center gap-1.5 font-bold"
            >
              Next Module ({MODULE_TABS[currentTabIndex + 1].name}) <ChevronRight size={15} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-emerald btn-sm flex items-center gap-1.5 font-bold text-white shadow-md shadow-emerald-500/20"
            >
              {submitting ? (
                <>
                  <Clock className="animate-spin" size={15} /> Evaluating...
                </>
              ) : (
                <>
                  <Send size={15} /> Submit Final Qualification
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
