'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { VendorEvaluationRecord } from '@/lib/types';
import {
  Search,
  Building2,
  FileCheck,
  Award,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Mail,
  Phone,
  MapPin,
  ExternalLink,
  Plus,
  ArrowRight,
  CheckCircle2,
  Lock,
  Star,
  Send,
  X,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  UserPlus,
  FileUp,
} from 'lucide-react';

interface VendorSummaryProps {
  onViewEvaluation: (record: VendorEvaluationRecord) => void;
  onNavigateToWizard?: () => void;
}

export default function VendorSummary({ onViewEvaluation, onNavigateToWizard }: VendorSummaryProps) {
  const {
    vendorEvaluations,
    currentMode,
    rfqs,
    showToast,
    buyerVendors,
    addBuyerVendor,
    updateBuyerVendor,
    deleteBuyerVendor,
    reviseVendorRating,
    openRatingRevisionEmailModal,
    activeBuyerAccount,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Modal States
  const [showAddSingleModal, setShowAddSingleModal] = useState(false);
  const [selectedVendorForDetails, setSelectedVendorForDetails] = useState<any | null>(null);
  const [selectedVendorForEdit, setSelectedVendorForEdit] = useState<any | null>(null);
  const [selectedVendorForDelete, setSelectedVendorForDelete] = useState<any | null>(null);

  // Single Vendor Add Form State
  const [newVendorForm, setNewVendorForm] = useState({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    location: '',
    majorCategory: 'Mechanical & Fluid Systems',
    minorCategories: '',
    rating: 4.5,
    status: 'REGISTERED / NOT EVALUATED' as const,
  });

  // Edit Vendor Form State
  const [editVendorForm, setEditVendorForm] = useState({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    location: '',
    majorCategory: '',
    minorCategories: '',
    rating: 4.5,
    status: 'REGISTERED / NOT EVALUATED' as const,
  });

  // Rating Revision Modal State
  const [selectedVendorForRevision, setSelectedVendorForRevision] = useState<any | null>(null);
  const [qualityScore, setQualityScore] = useState<number>(90);
  const [costScore, setCostScore] = useState<number>(85);
  const [deliveryScore, setDeliveryScore] = useState<number>(92);
  const [remarks, setRemarks] = useState<string>('');
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);

  // Check if vendor has been used by the buyer in any RFQ or was uploaded by the buyer
  const getVendorRfqEngagement = (vendor: any) => {
    const vName = (vendor.name || '').toLowerCase().trim();
    const vId = (vendor.id || '').toLowerCase().trim();

    // Check all buyer RFQs where this vendor is invited or has bids
    const matchingRfqs = rfqs.filter((r) => {
      const inQuotes = (r.quotes || []).some(
        (q) =>
          (q.vendorName && q.vendorName.toLowerCase().trim() === vName) ||
          (q.vendorId && q.vendorId.toLowerCase().trim() === vId)
      );
      const inFollowUps = (r.followUpData?.vendors || []).some(
        (f) =>
          (f.vendorName && f.vendorName.toLowerCase().trim() === vName) ||
          (f.vendorId && f.vendorId.toLowerCase().trim() === vId)
      );
      return inQuotes || inFollowUps;
    });

    const isUsedInRFQ = matchingRfqs.length > 0;
    const isUploaded =
      vendor.source === 'buyer_manual' ||
      vendor.source === 'buyer_excel' ||
      vendor.source === 'manual' ||
      vendor.source === 'excel' ||
      !!vendor.addedByBuyerCompany ||
      String(vendor.id || '').startsWith('v-');

    // Allowed if used in at least 1 RFQ OR uploaded by buyer
    const canRevise = isUsedInRFQ || isUploaded;

    let qualificationReason = 'No RFQ History & Not Uploaded';
    if (isUsedInRFQ && isUploaded) {
      qualificationReason = `Buyer Uploaded & Active in ${matchingRfqs.length} RFQs`;
    } else if (isUploaded) {
      qualificationReason = 'Buyer Empanelled / Uploaded Supplier';
    } else if (isUsedInRFQ) {
      qualificationReason = `Active in ${matchingRfqs.length} Buyer RFQs`;
    }

    return {
      isEngaged: canRevise,
      isUsedInRFQ,
      isUploaded,
      rfqCount: matchingRfqs.length,
      recentRfqNumber: matchingRfqs[0]?.rfqNumber || null,
      qualificationReason,
    };
  };

  const openRevisionModal = (vendor: any) => {
    const engagement = getVendorRfqEngagement(vendor);
    if (!engagement.isEngaged) {
      showToast(
        'Rating Revision Locked',
        `You cannot revise the rating for "${vendor.name}" because this supplier has neither been used in any of your RFQs nor uploaded by your organization.`,
        'warning'
      );
      return;
    }

    setSelectedVendorForRevision(vendor);
    const existingScore = vendor.score || (vendor.rating ? Math.round(vendor.rating * 20) : 88);
    setQualityScore(existingScore >= 90 ? 92 : 88);
    setCostScore(existingScore >= 90 ? 88 : 82);
    setDeliveryScore(existingScore >= 90 ? 95 : 85);

    const contextNote = engagement.isUsedInRFQ
      ? `Performance evaluated on procurement cycle (${engagement.recentRfqNumber}): Excellent technical adherence, competitive cost structure, and verified on-time delivery compliance.`
      : `Operational evaluation for buyer empanelled vendor (${vendor.name}): Verified commercial terms, factory audit compliance, and SLA terms.`;

    setRemarks(vendor.latestRatingRevision?.remarks || contextNote);
  };

  const handleSaveRatingRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForRevision || isSubmittingRevision) return;

    if (!remarks.trim()) {
      showToast('Remarks Required', 'Please provide performance remarks explaining the rating change.', 'warning');
      return;
    }

    setIsSubmittingRevision(true);
    const saved = await reviseVendorRating(
      selectedVendorForRevision.id,
      Number(qualityScore),
      Number(costScore),
      Number(deliveryScore),
      remarks
    );
    setIsSubmittingRevision(false);

    if (!saved) return;

    setSelectedVendorForRevision(null);
  };

  const handleAddSingleVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorForm.name.trim() || !newVendorForm.email.trim()) {
      showToast('Validation Error', 'Vendor name and email are required.', 'warning');
      return;
    }

    const minors = newVendorForm.minorCategories
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    addBuyerVendor({
      name: newVendorForm.name.trim(),
      contactPerson: newVendorForm.contactPerson.trim() || 'Procurement Representative',
      email: newVendorForm.email.trim(),
      phone: newVendorForm.phone.trim() || '+91 98765 43210',
      location: newVendorForm.location.trim() || 'India',
      majorCategory: newVendorForm.majorCategory || 'General Industrial',
      minorCategories: minors.length > 0 ? minors : [newVendorForm.majorCategory],
      rating: Number(newVendorForm.rating) || 4.5,
      source: 'buyer_manual',
      status: newVendorForm.status,
    });

    setNewVendorForm({
      name: '',
      contactPerson: '',
      email: '',
      phone: '',
      location: '',
      majorCategory: 'Mechanical & Fluid Systems',
      minorCategories: '',
      rating: 4.5,
      status: 'REGISTERED / NOT EVALUATED',
    });
    setShowAddSingleModal(false);
  };

  const handleOpenEdit = (vendor: any) => {
    setSelectedVendorForEdit(vendor);
    setEditVendorForm({
      name: vendor.name || '',
      contactPerson: vendor.contactPerson || '',
      email: vendor.email || '',
      phone: vendor.phone || '',
      location: vendor.location || '',
      majorCategory: vendor.majorCategory || 'Mechanical & Fluid Systems',
      minorCategories: (vendor.minorCategories || []).join(', '),
      rating: vendor.rating || 4.5,
      status: vendor.status || 'REGISTERED / NOT EVALUATED',
    });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForEdit) return;

    const minors = editVendorForm.minorCategories
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    updateBuyerVendor(selectedVendorForEdit.id, {
      name: editVendorForm.name.trim(),
      contactPerson: editVendorForm.contactPerson.trim(),
      email: editVendorForm.email.trim(),
      phone: editVendorForm.phone.trim(),
      location: editVendorForm.location.trim(),
      majorCategory: editVendorForm.majorCategory,
      minorCategories: minors.length > 0 ? minors : [editVendorForm.majorCategory],
      rating: Number(editVendorForm.rating) || 4.5,
      status: editVendorForm.status,
    });

    setSelectedVendorForEdit(null);
  };

  const handleConfirmDelete = () => {
    if (!selectedVendorForDelete) return;
    deleteBuyerVendor(selectedVendorForDelete.id);
    setSelectedVendorForDelete(null);
  };

  // Merge evaluations in store with buyerVendors from context
  const allEvaluations = [...vendorEvaluations];
  const mergedVendors = buyerVendors.map((bv) => {
    const storeEval = allEvaluations.find((e) => e.vendorName === bv.name || e.vendorId === bv.id);
    if (storeEval) {
      return {
        ...bv,
        status: storeEval.status,
        score: storeEval.overallScore,
        evaluated: true,
        hasRecord: true,
        storeRecord: storeEval,
      };
    }
    return {
      ...bv,
    };
  });

  // Filter categories dynamically
  const categories = ['ALL', ...Array.from(new Set(mergedVendors.map((v) => v.majorCategory || 'General Industrial')))];

  const filteredVendors = mergedVendors.filter((v) => {
    const vCategory = v.majorCategory || '';
    const vMinors = (v.minorCategories || []).join(' ');
    const matchesSearch =
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.contactPerson.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vCategory.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vMinors.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'ALL' || vCategory === selectedCategory;
    const matchesStatus =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'EVALUATED' && v.evaluated) ||
      (selectedStatus === 'NOT_EVALUATED' && !v.evaluated) ||
      (selectedStatus === 'PREFERRED' && v.status === 'PREFERRED ENTERPRISE SUPPLIER') ||
      (selectedStatus === 'CONDITIONAL' && v.status === 'CONDITIONAL / UNDER REVIEW');

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const getStatusStyle = (status: string) => {
    if (status === 'PREFERRED ENTERPRISE SUPPLIER') {
      return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    }
    if (status === 'CONDITIONAL / UNDER REVIEW') {
      return 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-gray-700';
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            Evaluated Vendor Directory &amp; Summary
          </h1>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
            Overview of qualified enterprise partners, active 360-degree ratings, and onboarding statuses.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowAddSingleModal(true)}
            className="btn btn-secondary btn-sm flex items-center gap-1 shadow-xs"
          >
            <Plus size={14} /> Add Single Vendor
          </button>
          {onNavigateToWizard && (
            <button
              type="button"
              onClick={onNavigateToWizard}
              className="btn btn-primary btn-sm flex items-center gap-1 shadow-xs"
            >
              <FileUp size={14} /> Add New Vendor / Ingestion
            </button>
          )}
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Total Registered</div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{mergedVendors.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">OCR & 360° Evaluated</div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {mergedVendors.filter(v => v.evaluated).length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Preferred Status</div>
          <div className="text-2xl font-black text-indigo-700 dark:text-indigo-300 mt-1">
            {mergedVendors.filter(v => v.status === 'PREFERRED ENTERPRISE SUPPLIER').length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Pending Evaluation</div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {mergedVendors.filter(v => !v.evaluated).length}
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search vendors by name, contact, category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="has-leading-icon text-xs"
          />
        </div>

        {/* Category Selector */}
        <div className="w-full md:w-56">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs font-semibold"
          >
            <option value="ALL">All Categories</option>
            {categories.filter(c => c !== 'ALL').map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {/* Status Selector */}
        <div className="w-full md:w-48">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="text-xs font-semibold"
          >
            <option value="ALL">All Statuses</option>
            <option value="EVALUATED">Evaluated Only</option>
            <option value="NOT_EVALUATED">Pending / Registered</option>
            <option value="PREFERRED">Preferred Enterprise</option>
            <option value="CONDITIONAL">Conditional / Under Review</option>
          </select>
        </div>
      </div>

      {/* Vendors Directory Card List */}
      <div className="space-y-3">
        {filteredVendors.map((vendor) => {
          const isUploaded = vendor.source === 'buyer_manual' || vendor.source === 'buyer_excel';
          
          // Check if this vendor has submitted a quote in any RFQ
          const hasSubmittedQuote = rfqs.some(r => 
            r.quotes.some(q => q.vendorName.toLowerCase().includes(vendor.name.toLowerCase()) || 
                               vendor.name.toLowerCase().includes(q.vendorName.toLowerCase()))
          );

          // Version Rules
          let showEvaluation = false;
          let showTrigger = false;
          let isLockedForProcucevV2 = false;

          if (currentMode === 'mode_1') {
            showEvaluation = !!(vendor.evaluated && isUploaded);
            showTrigger = false;
          } else if (currentMode === 'mode_2') {
            const hasOverlap = (vendor as any).overlap === true;
            if (vendor.source === 'procucev_network' || hasOverlap) {
              // Procucev network vendor or Overlap vendor
              if (hasSubmittedQuote) {
                showEvaluation = !!vendor.evaluated;
                showTrigger = !vendor.evaluated;
              } else {
                // Locked until quote received
                isLockedForProcucevV2 = true;
                showEvaluation = false;
                showTrigger = false;
              }
            } else {
              // Buyer vendor (no overlap)
              showEvaluation = false;
              showTrigger = false;
            }
          } else {
            // Version 3: AI Sourcing Engine
            showEvaluation = !!vendor.evaluated;
            showTrigger = !vendor.evaluated;
          }

          const getSourceLabel = () => {
            if (vendor.source === 'procucev_network') {
              return (vendor as any).overlap 
                ? 'Overlap (Buyer + Procucev)' 
                : 'Procucev Network Partner';
            }
            return vendor.source === 'buyer_excel' || vendor.source === 'excel'
              ? 'Buyer Excel Ingest' 
              : 'Buyer Manual Entry';
          };
          
          const engagement = getVendorRfqEngagement(vendor);

          return (
            <div
              key={vendor.id}
              className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm hover:border-indigo-500/40 dark:hover:border-indigo-400/40 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              {/* Left: Vendor Brand & Info */}
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 border border-indigo-200/40">
                    {vendor.id}
                  </span>
                  <span className="text-xs text-slate-500 font-semibold">{vendor.majorCategory}</span>
                  <span className="text-slate-400">•</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-700">
                    {getSourceLabel()}
                  </span>

                  {/* RFQ Engagement & Upload Status Badge */}
                  {engagement.isEngaged ? (
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-1">
                      <CheckCircle2 size={10} /> {engagement.qualificationReason}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-400 border border-slate-200 dark:border-gray-700 flex items-center gap-1" title="Vendor neither uploaded nor used in any RFQs by your organization">
                      <Lock size={10} /> No RFQs / Not Uploaded
                    </span>
                  )}

                  {isLockedForProcucevV2 && (
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 flex items-center gap-1">
                      <Lock size={10} /> Quote Submission Pending
                    </span>
                  )}
                </div>

                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                  {vendor.name}
                  {showEvaluation && vendor.score && vendor.score >= 80 && (
                    <ShieldCheck className="text-emerald-500" size={16} />
                  )}
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-500 dark:text-gray-400">
                  <span className="truncate">👤 Contact: {vendor.contactPerson}</span>
                  <span className="truncate">✉️ {vendor.email}</span>
                  <span className="truncate">📞 {vendor.phone}</span>
                  <span className="flex items-center gap-1"><MapPin size={12} /> {vendor.location}</span>
                </div>

                {vendor.minorCategories && vendor.minorCategories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <span className="text-[10px] text-slate-400 font-semibold">Minors:</span>
                    {vendor.minorCategories.map((m) => (
                      <span
                        key={m}
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
                {/* Performance Rating Revision Badge / History Line */}
                {vendor.latestRatingRevision && (
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-300">
                        <Star size={12} className="fill-amber-500 text-amber-500" />
                        <span>Buyer Rating Revision: {vendor.latestRatingRevision.newRating} ★ ({vendor.latestRatingRevision.newCompositeScore}%)</span>
                        <span className="text-[10px] font-normal text-slate-500">by {vendor.latestRatingRevision.buyerCompany} ({vendor.latestRatingRevision.timestamp.split(' ')[0]})</span>
                      </div>
                      <p className="text-slate-600 dark:text-gray-300 italic text-[10.5px]">
                        &ldquo;{vendor.latestRatingRevision.remarks}&rdquo; (Quality: {vendor.latestRatingRevision.qualityScore}, Cost: {vendor.latestRatingRevision.costScore}, Delivery: {vendor.latestRatingRevision.deliveryScore})
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => vendor.latestRatingRevision && openRatingRevisionEmailModal(vendor.latestRatingRevision)}
                      className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 shrink-0"
                    >
                      <Mail size={11} /> View Dispatched Email Notice
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Score Gauge & View Actions */}
              <div className="flex items-center gap-4 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 dark:border-gray-800">
                <div className="text-right">
                  {showEvaluation && vendor.score ? (
                    <>
                      <div className="text-[10px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
                      <div className="text-xl font-mono font-black text-indigo-600 dark:text-indigo-400">{vendor.score}%</div>
                      <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-end gap-0.5">
                        <Star size={10} className="fill-amber-500 text-amber-500" /> {vendor.rating || (vendor.score / 20).toFixed(1)} / 5.0
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
                      <div className="text-xs font-semibold text-slate-400 italic">
                        {currentMode === 'mode_1' && !isUploaded 
                          ? 'Hidden (V1 Restriction)' 
                          : isLockedForProcucevV2 
                          ? 'Locked (Awaiting Quote)' 
                          : currentMode === 'mode_2' && isUploaded && !(vendor as any).overlap
                          ? 'Locked (Buyer Roster Only)'
                          : 'Not Evaluated'}
                      </div>
                      {vendor.rating && (
                        <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-end gap-0.5">
                          <Star size={10} className="fill-amber-500 text-amber-500" /> {vendor.rating} / 5.0
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    currentMode === 'mode_1' && !isUploaded 
                      ? 'bg-slate-100 dark:bg-gray-800 text-slate-500 border-slate-200' 
                      : getStatusStyle(vendor.status || '')
                  }`}>
                    {currentMode === 'mode_1' && !isUploaded 
                      ? 'UNAVAILABLE IN V1' 
                      : isLockedForProcucevV2
                      ? 'LOCKED (PENDING BID)'
                      : currentMode === 'mode_2' && isUploaded && !(vendor as any).overlap
                      ? 'BUYER ROSTER (NO EVAL)'
                      : vendor.status}
                  </span>

                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {/* Revise Rating Button (Active if vendor was uploaded by buyer OR used in RFQs) */}
                    {engagement.isEngaged ? (
                      <button
                        type="button"
                        onClick={() => openRevisionModal(vendor)}
                        className="btn btn-amber btn-xs font-bold flex items-center gap-1 shadow-xs"
                        title={`Revise supplier rating (${engagement.qualificationReason})`}
                      >
                        <Star size={11} className="fill-current" /> Revise Rating
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openRevisionModal(vendor)}
                        className="btn btn-secondary btn-xs flex items-center gap-1 opacity-50 cursor-not-allowed text-slate-400 border-dashed"
                        title="Rating revision locked: Buyers can only revise performance ratings for suppliers who have been uploaded or engaged in at least one RFQ."
                      >
                        <Lock size={10} /> Rating Locked
                      </button>
                    )}

                    {/* View Details Button */}
                    <button
                      type="button"
                      onClick={() => setSelectedVendorForDetails(vendor)}
                      className="btn btn-secondary btn-xs flex items-center gap-1"
                      title="View complete supplier details & parameters"
                    >
                      <Eye size={11} /> Details
                    </button>

                    {/* Edit Vendor Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(vendor)}
                      className="btn btn-secondary btn-xs flex items-center gap-1"
                      title="Edit vendor profile and categories"
                    >
                      <Edit size={11} /> Edit
                    </button>

                    {/* Delete Vendor Button */}
                    <button
                      type="button"
                      onClick={() => setSelectedVendorForDelete(vendor)}
                      className="btn btn-ghost btn-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1"
                      title="Delete vendor from directory"
                    >
                      <Trash2 size={11} />
                    </button>

                    {showEvaluation ? (
                      <button
                        onClick={() => {
                          const evalRec = (vendor as any).storeRecord || vendorEvaluations.find((e) => e.vendorId === vendor.id) || {
                            id: `eval-${vendor.id}`,
                            vendorId: vendor.id,
                            vendorName: vendor.name,
                            contactPerson: vendor.contactPerson,
                            email: vendor.email,
                            phone: vendor.phone,
                            category: vendor.majorCategory,
                            submissionDate: '2026-08-18 14:30 UTC',
                            status: vendor.status as any,
                            overallScore: vendor.score || 88,
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
                          };
                          onViewEvaluation(evalRec);
                        }}
                        className="btn btn-secondary btn-xs flex items-center gap-1"
                      >
                        <FileCheck size={11} /> View 360° Evaluation <ChevronRight size={11} />
                      </button>
                    ) : showTrigger ? (
                      <button
                        onClick={() => showToast('Triggering AI Evaluation Request', `Verification request email dispatched to ${vendor.email}. Sourcing Bot initiated.`, 'info')}
                        className="btn btn-primary btn-xs flex items-center gap-1"
                      >
                        <Plus size={11} /> Trigger Evaluation
                      </button>
                    ) : isLockedForProcucevV2 ? (
                      <button
                        disabled
                        className="btn btn-secondary btn-xs flex items-center gap-1 opacity-50 cursor-not-allowed"
                        title="Quote submission is required from this Procucev network partner before evaluation can be triggered."
                      >
                        <Lock size={10} /> Evaluation Locked (Pending Quote)
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {filteredVendors.length === 0 && (
          <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-gray-800 rounded-2xl">
            No vendors found matching query filters.
          </div>
        )}
      </div>



      {/* ========================================================================= */}
      {/* ADD SINGLE VENDOR MODAL */}
      {/* ========================================================================= */}
      {showAddSingleModal && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 animate-fade-in max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Add New Supplier</h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">Register a vendor to your active roster</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddSingleModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSingleVendor} className="overflow-y-auto my-3 space-y-3.5 pr-1 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                  Company / Supplier Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Industrial Solutions Ltd."
                  value={newVendorForm.name}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, name: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Vikram Verma"
                    value={newVendorForm.contactPerson}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, contactPerson: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                    Official Email <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. sales@apexvalves.com"
                    value={newVendorForm.email}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, email: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +91 98200 12345"
                    value={newVendorForm.phone}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, phone: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                    Location / City
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Pune, Maharashtra"
                    value={newVendorForm.location}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, location: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                  Major Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={newVendorForm.majorCategory}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, majorCategory: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                >
                  <option value="Mechanical & Fluid Systems">Mechanical &amp; Fluid Systems</option>
                  <option value="Electrical & Power Systems">Electrical &amp; Power Systems</option>
                  <option value="Instrumentation & Process Automation">Instrumentation &amp; Process Automation</option>
                  <option value="Civil & Structural Steel">Civil &amp; Structural Steel</option>
                  <option value="General Industrial">General Industrial</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                  Minor Categories (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Industrial Valves, Centrifugal Pumps, Gaskets"
                  value={newVendorForm.minorCategories}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, minorCategories: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                    Initial Rating (out of 5)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="5"
                    value={newVendorForm.rating}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, rating: Number(e.target.value) })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">
                    Status
                  </label>
                  <select
                    value={newVendorForm.status}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, status: e.target.value as any })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  >
                    <option value="REGISTERED / NOT EVALUATED">Registered / Pending</option>
                    <option value="PREFERRED ENTERPRISE SUPPLIER">Preferred Enterprise</option>
                    <option value="CONDITIONAL / UNDER REVIEW">Conditional / Under Review</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowAddSingleModal(false)}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm font-bold">
                  Save &amp; Dispatch Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VENDOR DETAILS MODAL */}
      {/* ========================================================================= */}
      {selectedVendorForDetails && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 animate-fade-in max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                  <Building2 size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    {selectedVendorForDetails.name}
                    {selectedVendorForDetails.score && selectedVendorForDetails.score >= 80 && (
                      <ShieldCheck className="text-emerald-500" size={18} />
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Vendor ID: <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{selectedVendorForDetails.id}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedVendorForDetails(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto my-4 space-y-4 pr-1 text-xs">
              {/* Primary Contact & Location Strip */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Contact Person</span>
                  <strong className="text-slate-800 dark:text-gray-200">{selectedVendorForDetails.contactPerson}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Email</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono break-all">{selectedVendorForDetails.email}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Phone</span>
                  <span className="text-slate-700 dark:text-gray-300 font-mono">{selectedVendorForDetails.phone}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Location</span>
                  <span className="text-slate-700 dark:text-gray-300">{selectedVendorForDetails.location}</span>
                </div>
              </div>

              {/* Status & Scores */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Sourcing Status</span>
                  <span className={`inline-block mt-1 px-2.5 py-0.5 rounded text-[10px] font-bold border ${getStatusStyle(selectedVendorForDetails.status || '')}`}>
                    {selectedVendorForDetails.status || 'REGISTERED'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Platform Rating</span>
                  <div className="text-base font-bold text-amber-600 dark:text-amber-400 mt-0.5 flex items-center justify-center gap-1">
                    <Star size={14} className="fill-amber-500 text-amber-500" />
                    {selectedVendorForDetails.rating || 4.5} / 5.0
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">360° AI Score</span>
                  <div className="text-base font-mono font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
                    {selectedVendorForDetails.score ? `${selectedVendorForDetails.score}%` : 'Pending'}
                  </div>
                </div>
              </div>

              {/* Category Hierarchy */}
              <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block">
                  Category Alignment &amp; Product Lines
                </span>
                <div className="text-xs">
                  <span className="text-slate-400 font-semibold">Major Category:</span>{' '}
                  <strong className="text-slate-800 dark:text-gray-200">{selectedVendorForDetails.majorCategory}</strong>
                </div>
                {selectedVendorForDetails.minorCategories && selectedVendorForDetails.minorCategories.length > 0 && (
                  <div>
                    <span className="text-slate-400 font-semibold block mb-1">Approved Minor Lines:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedVendorForDetails.minorCategories.map((m: string) => (
                        <span
                          key={m}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Onboarding & Telemetry */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Source:</span>
                  <strong className="text-slate-700 dark:text-gray-300 capitalize">{selectedVendorForDetails.source || 'buyer_manual'}</strong>
                </div>
                {selectedVendorForDetails.addedByBuyerCompany && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Empanelled By:</span>
                    <span className="text-slate-700 dark:text-gray-300">{selectedVendorForDetails.addedByBuyerCompany}</span>
                  </div>
                )}
                {selectedVendorForDetails.onboardingEmailStatus && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Onboarding Email:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold capitalize">{selectedVendorForDetails.onboardingEmailStatus}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  const vendor = selectedVendorForDetails;
                  setSelectedVendorForDetails(null);
                  handleOpenEdit(vendor);
                }}
                className="btn btn-secondary btn-sm flex items-center gap-1"
              >
                <Edit size={13} /> Edit Profile
              </button>
              <button
                type="button"
                onClick={() => setSelectedVendorForDetails(null)}
                className="btn btn-primary btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* EDIT VENDOR MODAL */}
      {/* ========================================================================= */}
      {selectedVendorForEdit && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 animate-fade-in max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                  <Edit size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Edit Vendor Profile</h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">Update supplier details for {selectedVendorForEdit.name}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedVendorForEdit(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="overflow-y-auto my-3 space-y-3.5 pr-1 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Company Name</label>
                <input
                  type="text"
                  required
                  value={editVendorForm.name}
                  onChange={(e) => setEditVendorForm({ ...editVendorForm, name: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={editVendorForm.contactPerson}
                    onChange={(e) => setEditVendorForm({ ...editVendorForm, contactPerson: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={editVendorForm.email}
                    onChange={(e) => setEditVendorForm({ ...editVendorForm, email: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Phone</label>
                  <input
                    type="text"
                    value={editVendorForm.phone}
                    onChange={(e) => setEditVendorForm({ ...editVendorForm, phone: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Location</label>
                  <input
                    type="text"
                    value={editVendorForm.location}
                    onChange={(e) => setEditVendorForm({ ...editVendorForm, location: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Major Category</label>
                <input
                  type="text"
                  value={editVendorForm.majorCategory}
                  onChange={(e) => setEditVendorForm({ ...editVendorForm, majorCategory: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Minor Categories (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Industrial Valves, Centrifugal Pumps"
                  value={editVendorForm.minorCategories}
                  onChange={(e) => setEditVendorForm({ ...editVendorForm, minorCategories: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Rating</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="5"
                    value={editVendorForm.rating}
                    onChange={(e) => setEditVendorForm({ ...editVendorForm, rating: Number(e.target.value) })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-gray-300 block mb-1">Status</label>
                  <select
                    value={editVendorForm.status}
                    onChange={(e) => setEditVendorForm({ ...editVendorForm, status: e.target.value as any })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  >
                    <option value="REGISTERED / NOT EVALUATED">Registered / Pending</option>
                    <option value="PREFERRED ENTERPRISE SUPPLIER">Preferred Enterprise</option>
                    <option value="CONDITIONAL / UNDER REVIEW">Conditional / Under Review</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setSelectedVendorForEdit(null)}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm font-bold">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {selectedVendorForDelete && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-rose-300 dark:border-rose-900/60 animate-fade-in">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-gray-800">
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Supplier</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400">This action cannot be undone</p>
              </div>
            </div>

            <div className="my-4 text-xs text-slate-600 dark:text-gray-300 space-y-2">
              <p>
                Are you sure you want to remove <strong>{selectedVendorForDelete.name}</strong> from your vendor directory?
              </p>
              <p className="text-[11px] text-slate-400">
                Vendor ID: <span className="font-mono">{selectedVendorForDelete.id}</span> · Email: {selectedVendorForDelete.email}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setSelectedVendorForDelete(null)}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700 text-white font-bold"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BUYER VENDOR RATING REVISION MODAL */}
      {/* ========================================================================= */}
      {selectedVendorForRevision && (() => {
        const vendor = selectedVendorForRevision;
        const previousScore = vendor.score || (vendor.rating ? Math.round(vendor.rating * 20) : 88);
        const previousRating = vendor.rating || Number((previousScore / 20).toFixed(1));
        const buyerAverage = Math.round((Number(qualityScore) + Number(costScore) + Number(deliveryScore)) / 3);
        const newCompositeScore = Math.round((previousScore + buyerAverage) / 2);
        const newRating = Number((newCompositeScore / 20).toFixed(1));
        const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';

        return (
          <div className="modal-overlay !z-[1100]">
            <div className="modal-content max-w-xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-amber-300 dark:border-amber-500/40 animate-fade-in max-h-[92vh] flex flex-col">
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-600/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
                    <Star size={22} className="fill-amber-500 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Revise Supplier Performance Rating
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      Submit operational ratings &amp; feedback for <strong>{vendor.name}</strong>.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedVendorForRevision(null)}
                  className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body Form */}
              <form onSubmit={handleSaveRatingRevision} className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
                {/* Vendor & Buyer Context Bar */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Supplier</span>
                    <strong className="text-slate-800 dark:text-gray-200">{vendor.name}</strong>
                    <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">{vendor.email}</div>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Reviewing Buyer</span>
                    <strong className="text-slate-800 dark:text-gray-200">{buyerCompany}</strong>
                    <div className="text-[10px] text-slate-500 font-mono">Current: {previousRating} ★ ({previousScore}%)</div>
                  </div>
                </div>

                {/* Performance Criteria Inputs (Quality, Cost, Delivery against 100) */}
                <div className="space-y-3.5 p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block">
                    1. Enter Performance Scores (0 to 100 Scale)
                  </span>

                  {/* Quality Score */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 dark:text-gray-200">Quality Compliance &amp; Specs adherence:</span>
                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-200">
                        {qualityScore} / 100
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={qualityScore}
                        onChange={(e) => setQualityScore(Number(e.target.value))}
                        className="w-full accent-indigo-600"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={qualityScore}
                        onChange={(e) => setQualityScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                        className="w-16 text-center font-mono font-bold text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                      />
                    </div>
                  </div>

                  {/* Cost Score */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 dark:text-gray-200">Cost Competitiveness &amp; Pricing Fairness:</span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200">
                        {costScore} / 100
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={costScore}
                        onChange={(e) => setCostScore(Number(e.target.value))}
                        className="w-full accent-emerald-600"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={costScore}
                        onChange={(e) => setCostScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                        className="w-16 text-center font-mono font-bold text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                      />
                    </div>
                  </div>

                  {/* Delivery Score */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 dark:text-gray-200">Delivery Timeliness &amp; OTIF Lead Time:</span>
                      <span className="font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded border border-amber-200">
                        {deliveryScore} / 100
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={deliveryScore}
                        onChange={(e) => setDeliveryScore(Number(e.target.value))}
                        className="w-full accent-amber-600"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={deliveryScore}
                        onChange={(e) => setDeliveryScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                        className="w-16 text-center font-mono font-bold text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                      />
                    </div>
                  </div>
                </div>

                {/* Two-Tier Average Formula Preview Box */}
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-50 to-indigo-50/50 dark:from-gray-950 dark:to-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-2 text-[11px]">
                  <div className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center justify-between">
                    <span>2. Rating Calculation Preview:</span>
                    <span className="font-mono text-[10px]">Avg(Q,C,D) → Avg(Prev, BuyerAvg)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                      <span className="text-[9.5px] text-slate-400 block uppercase">Buyer Input Avg</span>
                      <div className="font-bold font-mono text-indigo-600 text-xs mt-0.5">{buyerAverage}%</div>
                      <span className="text-[9px] text-slate-400">({qualityScore}+{costScore}+{deliveryScore})/3</span>
                    </div>
                    <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                      <span className="text-[9.5px] text-slate-400 block uppercase">Actual Previous</span>
                      <div className="font-bold font-mono text-slate-700 dark:text-gray-300 text-xs mt-0.5">{previousScore}%</div>
                      <span className="text-[9px] text-slate-400">{previousRating} ★</span>
                    </div>
                    <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800">
                      <span className="text-[9.5px] text-emerald-700 dark:text-emerald-300 font-bold block uppercase">New Composite</span>
                      <div className="font-extrabold font-mono text-emerald-700 dark:text-emerald-300 text-sm mt-0.5">{newRating} ★</div>
                      <span className="text-[9px] text-emerald-600 font-bold">{newCompositeScore}% Score</span>
                    </div>
                  </div>
                </div>

                {/* Remarks & Accolades Textarea */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-800 dark:text-gray-200 flex items-center justify-between">
                    <span>3. Remarks / Accolades / Performance Notes <span className="text-rose-500">*</span></span>
                    <span className="text-[10px] text-slate-400 font-normal">Shared directly with vendor</span>
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Describe specific delivery delays, quality rejection rates, pricing negotiations, or exceptional accolades for this vendor..."
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                  />
                </div>

                {/* Mandatory Transparency Notice to Buyer */}
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800/80 text-[10.5px] text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                    <AlertCircle size={13} className="shrink-0 text-amber-600" />
                    <span>MANDATORY BUYER TRANSPARENCY NOTICE:</span>
                  </div>
                  <p className="leading-relaxed text-slate-700 dark:text-gray-300">
                    These revised ratings (Quality: {qualityScore}, Cost: {costScore}, Delivery: {deliveryScore}) and your remarks will be <strong>officially emailed to {vendor.email}</strong>. Once submitted, the new aggregate rating ({newRating} ★) will update the platform master directory and will be <strong>visible to all other enterprise buyers</strong>.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setSelectedVendorForRevision(null)}
                    className="btn btn-ghost btn-sm"
                    disabled={isSubmittingRevision}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-amber btn-sm font-bold flex items-center gap-1.5 shadow-md"
                    disabled={isSubmittingRevision}
                  >
                    <Send size={13} /> {isSubmittingRevision ? 'Submitting...' : 'Submit Revision & Dispatch Email'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
