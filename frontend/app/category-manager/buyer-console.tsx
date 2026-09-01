'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem } from '@/lib/types';
import { SOURCING_MODES } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  Building2,
  Users,
  Search,
  ChevronRight,
  TrendingUp,
  Clock,
  DollarSign,
  Layers,
  ArrowRight,
  ShieldCheck,
  FileCheck,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

interface BuyerConsoleProps {
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToEvaluation: () => void;
}

export default function BuyerConsole({ onNavigateToMatrix, onNavigateToEvaluation }: BuyerConsoleProps) {
  const { rfqs } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null);
  const [expandedRfqNumber, setExpandedRfqNumber] = useState<string | null>(null);
  // Tracks an explicit user collapse ("Hide Details") so dropdown-driven
  // expansion cannot silently re-open a panel the user just dismissed.
  const [drillDownDismissed, setDrillDownDismissed] = useState(false);

  // Dropdown context filter states
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedBuyerFilterId, setSelectedBuyerFilterId] = useState<string>('all');

  // Static list of buyer profiles with associated companies and parameters
  const BUYERS = [
    {
      id: 'buyer-1',
      name: 'Rajesh Nair',
      email: 'rajesh.nair@ltindia.com',
      company: 'Larsen & Toubro Ltd. (L&T)',
      logoLetter: 'L',
      logoBg: 'bg-indigo-600 text-white',
      avatarColor: 'bg-indigo-100 text-indigo-800',
      avgSlaDays: 4.1,
      preferredMode: 'mode_3', // Version 3
      rfqKeywords: ['RFQ-2026-00421', 'RFQ-2026-00423', 'RFQ-2026-00425', 'RFQ-2026-00427'],
    },
    {
      id: 'buyer-2',
      name: 'Sunita Sharma',
      email: 'sunita.sharma@reliance.com',
      company: 'Reliance Industries Ltd. (RIL)',
      logoLetter: 'R',
      logoBg: 'bg-orange-500 text-white',
      avatarColor: 'bg-orange-100 text-orange-850',
      avgSlaDays: 3.8,
      preferredMode: 'mode_2', // Version 2
      rfqKeywords: ['RFQ-2026-00422', 'RFQ-2026-00424'],
    },
    {
      id: 'buyer-3',
      name: 'Amit Kumar Tata',
      email: 'amit.tata@tata.com',
      company: 'Tata Steel Procurement',
      logoLetter: 'T',
      logoBg: 'bg-purple-500 text-white',
      avatarColor: 'bg-purple-100 text-purple-800',
      avgSlaDays: 4.5,
      preferredMode: 'mode_3', // Version 3
      rfqKeywords: ['RFQ-2026-00428', 'RFQ-2026-00429'],
    },
    {
      id: 'buyer-4',
      name: 'Vikram Adani',
      email: 'vikram.adani@adani.com',
      company: 'Adani Group Sourcing',
      logoLetter: 'A',
      logoBg: 'bg-cyan-500 text-white',
      avatarColor: 'bg-cyan-100 text-cyan-800',
      avgSlaDays: 5.2,
      preferredMode: 'mode_1', // Version 1
      rfqKeywords: ['RFQ-2026-00426'],
    },
  ];

  // Helper to map RFQs dynamically based on number/keyword match
  const getBuyerRfqs = (buyerKeywords: string[]) => {
    // If the RFQ matches the keywords, or if it is newly created (e.g. not in keywords but created in session),
    // default-assign it to L&T (Rajesh Nair) who is our logged-in demo user.
    return rfqs.filter((r) => {
      const isMatchedKeyword = buyerKeywords.includes(r.rfqNumber);
      const isNewRfq = !BUYERS.some((b) => b.rfqKeywords.includes(r.rfqNumber));
      if (isMatchedKeyword) return true;
      if (isNewRfq && buyerKeywords.includes('RFQ-2026-00421')) return true; // Default assign to Rajesh Nair
      return false;
    });
  };

  // Compile Buyer Summary Data
  const compiledBuyers = BUYERS.map((buyer) => {
    const buyerRfqs = getBuyerRfqs(buyer.rfqKeywords);
    const totalSpend = buyerRfqs.reduce((sum, r) => sum + r.budget, 0);
    const activeCount = buyerRfqs.filter((r) => r.status !== 'PO Generated').length;
    
    return {
      ...buyer,
      rfqsList: buyerRfqs,
      totalSpend,
      activeCount,
    };
  });

  // Filter buyers based on dropdown context selection
  const filteredByDropdownBuyers = compiledBuyers.filter((b) => {
    const matchCompany = selectedCompany === 'all' || b.company === selectedCompany;
    const matchBuyer = selectedBuyerFilterId === 'all' || b.id === selectedBuyerFilterId;
    return matchCompany && matchBuyer;
  });

  // Filter buyers based on search term (name, company)
  const filteredBuyers = filteredByDropdownBuyers.filter(
    (b) =>
      b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.company.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Overall Analytics computations based on dropdown filter scope
  const grandTotalSpend = filteredByDropdownBuyers.reduce((sum, b) => sum + b.totalSpend, 0);
  const totalRfqCount = filteredByDropdownBuyers.reduce((sum, b) => sum + b.rfqsList.length, 0);
  
  const avgSystemSla = filteredByDropdownBuyers.length > 0 
    ? (filteredByDropdownBuyers.reduce((sum, b) => sum + b.avgSlaDays, 0) / filteredByDropdownBuyers.length).toFixed(1)
    : '0.0';

  // Dynamic context drill down precedence:
  //  1. An explicit "Hide Details" collapse always wins and keeps the panel closed,
  //     even if the dropdown selection changes afterwards. Clicking a card's
  //     expand action clears the dismissal.
  //  2. Otherwise a specific dropdown selection drives the expansion.
  //  3. Otherwise fall back to the manually expanded card.
  const dropdownDrivenBuyerId = selectedBuyerFilterId !== 'all' ? selectedBuyerFilterId : null;
  const activeBuyerId = drillDownDismissed ? null : dropdownDrivenBuyerId ?? selectedBuyerId;
  const selectedBuyer = compiledBuyers.find((b) => b.id === activeBuyerId);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Buyer Wise Command Console & Analytics
            </h1>
            <span className="badge badge-purple">Screen 2.3</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Category Manager Central Command: check buyer wise status of RFQ summaries, drill down into line-item details, and inspect company analytics.
          </p>
        </div>
      </div>

      {/* Dynamic Sourcing Selector Bar */}
      <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/60 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-gray-300">
          <Building2 size={16} className="text-indigo-500" />
          <span>Active Context Selection:</span>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto text-xs">
          {/* Company Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Company</label>
            <select
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setSelectedBuyerFilterId('all'); // Reset buyer on company change
              }}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
            >
              <option value="all">🌐 All Companies</option>
              {Array.from(new Set(BUYERS.map((b) => b.company))).map((company) => (
                <option key={company} value={company}>
                  🏢 {company}
                </option>
              ))}
            </select>
          </div>

          {/* Dependent Buyer Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Buyer</label>
            <select
              value={selectedBuyerFilterId}
              onChange={(e) => setSelectedBuyerFilterId(e.target.value)}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
              disabled={selectedCompany === 'all'}
            >
              {selectedCompany === 'all' ? (
                <option value="all">👥 Select Company First</option>
              ) : (
                <>
                  <option value="all">👥 All Buyers in Company</option>
                  {BUYERS.filter((b) => b.company === selectedCompany).map((b) => (
                    <option key={b.id} value={b.id}>
                      👤 {b.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUYER WISE & BUYER COMPANY WISE ANALYTICS SECTION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Analytics Left Pane: Key Aggregated SLA & Volume Metrics */}
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">Total Active Spend Sourced</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">${grandTotalSpend.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-650 dark:text-indigo-400 shrink-0">
              <DollarSign size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Total Sourcing Volume</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{totalRfqCount} RFQs Live</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Layers size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Average System Turnaround SLA</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{avgSystemSla} Days</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
              <Clock size={20} />
            </div>
          </div>
        </div>

        {/* Analytics Right Pane: Company Wise Spend & SLA Breakdowns */}
        <div className="lg:col-span-2 glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-100 dark:border-gray-800 pb-2 flex items-center justify-between">
            <span>Buyer Company Wise Spend & RFQ Volume Distribution</span>
            <span className="text-[10px] text-slate-400 lowercase normal-case">Live Category Distribution</span>
          </h3>

          <div className="space-y-3.5">
            {compiledBuyers.map((b) => {
              const spendPercentage = grandTotalSpend > 0 ? ((b.totalSpend / grandTotalSpend) * 100).toFixed(0) : '0';
              return (
                <div key={b.id} className="text-xs">
                  <div className="flex justify-between items-center text-slate-700 dark:text-gray-300 font-semibold mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-md ${b.logoBg} font-mono font-bold text-[9px] flex items-center justify-center`}>
                        {b.logoLetter}
                      </span>
                      <span>{b.company}</span>
                    </span>
                    <span className="mono font-bold text-slate-900 dark:text-white text-[11px]">
                      ${b.totalSpend.toLocaleString()} ({spendPercentage}% · {b.rfqsList.length} RFQs)
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex-grow bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div className="bg-indigo-650 h-full rounded-full" style={{ width: `${spendPercentage}%` }} />
                    </div>
                    <span className="text-[9px] mono text-slate-400 dark:text-gray-500 shrink-0">
                      SLA: {b.avgSlaDays}d
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUYER WISE RFQ CONSOLE GRID */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider flex items-center gap-2">
            <Users size={15} className="text-indigo-600 dark:text-indigo-400" />
            Buyer wise Status & Sourcing Summaries ({filteredBuyers.length} Buyers)
          </h3>

          {/* Search Box */}
          <div className="relative max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Search size={13} />
            </span>
            <input
              type="text"
              placeholder="Search Buyer name or company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-8 py-1.5 text-xs w-full sm:w-64"
            />
          </div>
        </div>

        {/* Buyers List Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBuyers.map((b) => {
            // Reflect the resolved panel state so the toggle label always matches
            // what is actually on screen, including dropdown-driven expansion.
            const isSelected = activeBuyerId === b.id;
            const preferredModeObj = SOURCING_MODES.find(m => m.id === b.preferredMode);
            
            return (
              <div
                key={b.id}
                className={`glass-panel p-5 rounded-2xl border-2 transition-all flex flex-col justify-between space-y-4 ${
                  isSelected
                    ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-md'
                    : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 bg-white dark:bg-gray-900/80 shadow-sm'
                }`}
              >
                {/* Upper Block: Buyer Profile & Company */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${b.avatarColor} font-bold text-xs flex items-center justify-center`}>
                      {b.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs">{b.name}</h4>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500">{b.email}</p>
                      
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className={`w-4 h-4 rounded ${b.logoBg} font-mono font-bold text-[8px] flex items-center justify-center shrink-0`}>
                          {b.logoLetter}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-700 dark:text-gray-300">
                          <CompanyHoverTooltip name={b.company} type="buyer" />
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {preferredModeObj && (
                    <span
                      className="px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider shrink-0"
                      style={{
                        backgroundColor: `${preferredModeObj.badgeColor}15`,
                        color: preferredModeObj.badgeColor,
                        border: `1px solid ${preferredModeObj.badgeColor}35`,
                      }}
                    >
                      {preferredModeObj.code} Sourcing
                    </span>
                  )}
                </div>

                {/* Mid Block: Metrics */}
                <div className="grid grid-cols-3 gap-2 py-3 border-t border-b border-slate-100 dark:border-gray-800 text-center text-xs">
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Total RFQs</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{b.rfqsList.length}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Active RFQs</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{b.activeCount}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Sourced Spend</div>
                    <div className="font-black text-indigo-600 dark:text-indigo-400 mt-0.5 mono">${b.totalSpend.toLocaleString()}</div>
                  </div>
                </div>

                {/* Action Block */}
                <div className="flex justify-between items-center pt-1.5">
                  <span className="text-[9px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock size={10} /> Avg turnaround: {b.avgSlaDays} days
                  </span>
                  
                  <button
                    onClick={() => {
                      if (isSelected) {
                        setSelectedBuyerId(null);
                        setDrillDownDismissed(true);
                      } else {
                        setSelectedBuyerId(b.id);
                        setDrillDownDismissed(false);
                        setExpandedRfqNumber(null);
                      }
                    }}
                    className="btn btn-secondary btn-xs font-bold flex items-center gap-1"
                  >
                    <span>{isSelected ? UI_STRINGS.actions.hideDetails : UI_STRINGS.actions.reviewRfqDetails}</span>
                    <ChevronRight size={12} className={`transform transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DETAILED DRILL DOWN SECTION (EXPANDS ON SELECTION) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedBuyer && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md space-y-4 animate-slide-up">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 size={16} className="text-indigo-650 dark:text-indigo-400" />
                Sourcing Details for {selectedBuyer.company} ({selectedBuyer.name})
              </h3>
              <p className="text-[10px] text-slate-450 dark:text-gray-500">
                Live drill-down. Double-click or expand specific RFQ rows below to inspect item specifications and quotes list.
              </p>
            </div>
            <span className="text-[11px] mono text-slate-500 font-bold bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-200/20">
              {selectedBuyer.rfqsList.length} total dispatches
            </span>
          </div>

          {selectedBuyer.rfqsList.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400 dark:text-gray-550">
              No active RFQ records found for this buyer profile in the category database.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedBuyer.rfqsList.map((rfq) => {
                const isRfqExpanded = expandedRfqNumber === rfq.rfqNumber;
                const rfqModeObj = SOURCING_MODES.find(m => m.id === rfq.sourcingMode);

                return (
                  <div
                    key={rfq.rfqNumber}
                    className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-gray-950/40"
                  >
                    {/* RFQ Row Title Header */}
                    <div
                      onClick={() => setExpandedRfqNumber(isRfqExpanded ? null : rfq.rfqNumber)}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-md ${selectedBuyer.logoBg} font-mono font-bold text-[9px] flex items-center justify-center shrink-0`}>
                          {selectedBuyer.logoLetter}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">{rfq.title}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-505 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.25 rounded border border-slate-200 dark:border-gray-700">
                              {rfq.rfqNumber}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-450 dark:text-gray-500 mt-1">
                            <span>Sourced Spend: <strong>${rfq.budget.toLocaleString()}</strong></span>
                            <span>Line Items: <strong>{rfq.extractedEntities.length}</strong></span>
                            <span>Quotes Recd: <strong>{rfq.quotesCount}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {rfqModeObj && (
                          <span
                            className="px-2 py-0.5 rounded text-[8px] font-bold"
                            style={{
                              backgroundColor: `${rfqModeObj.badgeColor}15`,
                              color: rfqModeObj.badgeColor,
                              border: `1px solid ${rfqModeObj.badgeColor}35`,
                            }}
                          >
                            {rfqModeObj.code} Sourcing
                          </span>
                        )}
                        
                        <span className={`badge text-[9px] ${
                          rfq.status === 'Parsing' ? 'badge-amber' : 
                          rfq.status === 'In Evaluation' ? 'badge-blue' : 'badge-emerald'
                        }`}>
                          {rfq.status}
                        </span>

                        <ChevronDown size={14} className="text-slate-450 transition-transform" style={{ transform: isRfqExpanded ? 'rotate(180deg)' : 'none' }} />
                      </div>
                    </div>

                    {/* RFQ Expanded Body Section */}
                    {isRfqExpanded && (
                      <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-4 animate-fade-in text-xs">
                        
                        {/* 1. Line Item Table */}
                        <div className="space-y-1.5">
                          <h4 className="text-[10px] font-extrabold uppercase text-slate-450 dark:text-gray-500 tracking-wider">
                            BOQ Specifications & Item Roster ({rfq.extractedEntities.length} items)
                          </h4>
                          <div className="border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                            <table className="w-full text-[11px] text-left">
                              <thead>
                                <tr className="bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 text-slate-505 dark:text-gray-405 font-bold">
                                  <th className="p-2.5">Item Name / Description</th>
                                  <th className="p-2.5">Category</th>
                                  <th className="p-2.5 text-center">Quantity</th>
                                  <th className="p-2.5">Technical Specifications Spec</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rfq.extractedEntities.map((ent) => (
                                  <tr key={ent.id} className="border-b border-slate-100 dark:border-gray-850 text-slate-800 dark:text-gray-300">
                                    <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{ent.itemName}</td>
                                    <td className="p-2.5">{ent.category}</td>
                                    <td className="p-2.5 text-center font-mono font-bold text-slate-900 dark:text-white">{ent.quantity} {ent.unit}</td>
                                    <td className="p-2.5 text-slate-500 dark:text-gray-400">{ent.technicalSpecs}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* 2. Dispatch / Quotes Evaluation Status Card */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px] leading-relaxed text-slate-500 dark:text-gray-400">
                          <div>
                            💡 <strong>Category Control Action</strong>: RFQ was created on <span className="text-slate-800 dark:text-white font-semibold">{rfq.createdAt}</span> via Mode: <strong>{rfqModeObj?.name}</strong>.
                            {rfq.sourcingMode === 'mode_3' ? (
                              <span className="block mt-1 text-indigo-650 dark:text-indigo-400 font-semibold">
                                🔒 Version 3 Rule: 10 Recommended Procucev Vendors invited anonymously. Double-blind verification active.
                              </span>
                            ) : (
                              <span className="block mt-1">
                                Standard bidding is open. Chasing follow-up efficacy stands at {rfq.aiScore}%.
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            {rfq.quotesCount > 0 && (
                              <button
                                onClick={() => onNavigateToMatrix(rfq)}
                                className="btn btn-primary btn-xs font-bold flex items-center gap-1"
                              >
                                <span>Go to Quote Matrix</span>
                                <ArrowRight size={10} />
                              </button>
                            )}
                            {rfq.sourcingMode === 'mode_3' && (
                              <button
                                onClick={onNavigateToEvaluation}
                                className="btn btn-secondary btn-xs font-bold"
                              >
                                Review Survey Evaluation
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
