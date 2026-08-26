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
} from 'lucide-react';

interface VendorSummaryProps {
  onViewEvaluation: (record: VendorEvaluationRecord) => void;
  onNavigateToWizard?: () => void;
}

export default function VendorSummary({ onViewEvaluation, onNavigateToWizard }: VendorSummaryProps) {
  const { vendorEvaluations, currentMode, rfqs, showToast } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Vendor list including evaluated and registered ones
  const baseVendors = [
    {
      id: 'v-1',
      name: 'Apex Supplies Ltd.',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apexsupplies.in',
      phone: '+91 98201 44820',
      category: 'Heavy Mechanical & Fluid Dynamics',
      location: 'Mumbai, MH',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      score: 95,
      evaluated: true,
      hasRecord: true,
      source: 'buyer_manual',
      overlap: true,
    },
    {
      id: 'v-2',
      name: 'Kiran Valve Industries',
      contactPerson: 'Amit Kumar',
      email: 'amit@kiranvalves.com',
      phone: '+91 97653 21098',
      category: 'Valves & Flow Control',
      location: 'Pune, MH',
      status: 'CONDITIONAL / UNDER REVIEW',
      score: 72,
      evaluated: true,
      hasRecord: true,
      source: 'buyer_excel',
      overlap: false,
    },
    {
      id: 'v-3',
      name: 'TechnoForce Engineering',
      contactPerson: 'Sunita Reddy',
      email: 'sunita@technoforce.in',
      phone: '+91 87654 32109',
      category: 'Electrical & Switchgear Control Panels',
      location: 'Hyderabad, TS',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      score: 92,
      evaluated: true,
      hasRecord: true,
      source: 'procucev',
      overlap: false,
    },
    {
      id: 'v-4',
      name: 'Global Pipe Solutions',
      contactPerson: 'John Doe',
      email: 'john@globalpipes.com',
      phone: '+1 415 555 2671',
      category: 'Pipes & Fittings',
      location: 'Houston, TX',
      status: 'REGISTERED / NOT EVALUATED',
      score: null,
      evaluated: false,
      hasRecord: false,
      source: 'procucev',
      overlap: false,
    },
    {
      id: 'v-5',
      name: 'Titanium Castings Corp',
      contactPerson: 'Sarah Jenkins',
      email: 'sarah@titaniumcast.com',
      phone: '+44 20 7946 0958',
      category: 'Heavy Mechanical & Fluid Dynamics',
      location: 'Sheffield, UK',
      status: 'REGISTERED / NOT EVALUATED',
      score: null,
      evaluated: false,
      hasRecord: false,
      source: 'procucev',
      overlap: true,
    },
  ];

  // Merge evaluations in store (to support newly qualification-submitted records)
  const allEvaluations = [...vendorEvaluations];
  const mergedVendors = baseVendors.map(bv => {
    const storeEval = allEvaluations.find(e => e.vendorName === bv.name || e.vendorId === bv.id);
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
    return bv;
  });

  // Filter categories dynamically
  const categories = ['ALL', ...Array.from(new Set(mergedVendors.map(v => v.category)))];

  const filteredVendors = mergedVendors.filter(v => {
    const matchesSearch = v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.contactPerson.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.category.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'ALL' || v.category === selectedCategory;
    const matchesStatus = selectedStatus === 'ALL' ||
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
            Evaluated Vendor Directory & Summary
          </h1>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
            Overview of qualified enterprise partners, active 360-degree ratings, and onboarding statuses.
          </p>
        </div>
        {onNavigateToWizard && (
          <button onClick={onNavigateToWizard} className="btn btn-primary btn-sm flex items-center gap-1">
            <Plus size={14} /> Add New Vendor / Ingestion
          </button>
        )}
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
            className="pl-9 text-xs"
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
            showEvaluation = vendor.evaluated && isUploaded;
            showTrigger = false;
          } else if (currentMode === 'mode_2') {
            if (vendor.source === 'procucev' || vendor.overlap === true) {
              // Procucev network vendor or Overlap vendor
              if (hasSubmittedQuote) {
                showEvaluation = vendor.evaluated;
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
            showEvaluation = vendor.evaluated;
            showTrigger = !vendor.evaluated;
          }

          const getSourceLabel = () => {
            if (vendor.source === 'procucev') {
              return vendor.overlap 
                ? 'Overlap (Buyer + Procucev)' 
                : 'Procucev Network Partner';
            }
            return vendor.source === 'buyer_excel' 
              ? 'Buyer Excel Ingest' 
              : 'Buyer Manual Entry';
          };

          return (
            <div
              key={vendor.id}
              className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm hover:border-indigo-500/40 dark:hover:border-indigo-400/40 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              {/* Left: Vendor Brand & Info */}
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 border border-indigo-200/40">
                    {vendor.id}
                  </span>
                  <span className="text-xs text-slate-500 font-semibold">{vendor.category}</span>
                  <span className="text-slate-400">•</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-700">
                    {getSourceLabel()}
                  </span>
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
              </div>

              {/* Right: Score Gauge & View Actions */}
              <div className="flex items-center gap-4 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 dark:border-gray-800">
                <div className="text-right">
                  {showEvaluation && vendor.score ? (
                    <>
                      <div className="text-[10px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
                      <div className="text-xl font-mono font-black text-indigo-600 dark:text-indigo-400">{vendor.score}%</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
                      <div className="text-xs font-semibold text-slate-400 italic">
                        {currentMode === 'mode_1' && !isUploaded 
                          ? 'Hidden (V1 Restriction)' 
                          : isLockedForProcucevV2 
                          ? 'Locked (Awaiting Quote)' 
                          : currentMode === 'mode_2' && isUploaded && !vendor.overlap
                          ? 'Locked (Buyer Roster Only)'
                          : 'Not Evaluated'}
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    currentMode === 'mode_1' && !isUploaded 
                      ? 'bg-slate-100 dark:bg-gray-800 text-slate-500 border-slate-200' 
                      : getStatusStyle(vendor.status)
                  }`}>
                    {currentMode === 'mode_1' && !isUploaded 
                      ? 'UNAVAILABLE IN V1' 
                      : isLockedForProcucevV2
                      ? 'LOCKED (PENDING BID)'
                      : currentMode === 'mode_2' && isUploaded && !vendor.overlap
                      ? 'BUYER ROSTER (NO EVAL)'
                      : vendor.status}
                  </span>

                  {showEvaluation ? (
                    <button
                      onClick={() => {
                        const evalRec = (vendor as any).storeRecord || vendorEvaluations.find(e => e.vendorId === vendor.id) || {
                          id: `eval-${vendor.id}`,
                          vendorId: vendor.id,
                          vendorName: vendor.name,
                          contactPerson: vendor.contactPerson,
                          email: vendor.email,
                          phone: vendor.phone,
                          category: vendor.category,
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
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">No Actions Available</span>
                  )}
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
    </div>
  );
}
