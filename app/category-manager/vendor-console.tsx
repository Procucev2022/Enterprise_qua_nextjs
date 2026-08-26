'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem } from '@/lib/types';
import { SOURCING_MODES } from '@/lib/mock-data';
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
  Award,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

interface VendorConsoleProps {
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToEvaluation: () => void;
}

export default function VendorConsole({ onNavigateToMatrix, onNavigateToEvaluation }: VendorConsoleProps) {
  const { rfqs } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [expandedQuoteNumber, setExpandedQuoteNumber] = useState<string | null>(null);

  // Dropdown filter states
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedContactFilterId, setSelectedContactFilterId] = useState<string>('all');

  // Static list of vendor profiles with their associated metrics and parameters
  const VENDORS = [
    {
      id: 'vendor-1',
      name: 'Rajesh Nair',
      email: 'rajesh@apexsupplies.in',
      company: 'Apex Supplies Ltd.',
      logoLetter: 'A',
      logoBg: 'bg-emerald-600 text-white',
      avatarColor: 'bg-emerald-100 text-emerald-800',
      category: 'Heavy Mechanical & Pumps',
      location: 'Mumbai, MH',
      rating: 4.8,
      leadTimeDays: 12,
      whatsappSla: 94.2,
      awardedSpend: 420000,
      rfqBids: ['RFQ-2026-00421', 'RFQ-2026-00423', 'RFQ-2026-00425'],
    },
    {
      id: 'vendor-2',
      name: 'Amit Kumar',
      email: 'amit@kiranvalves.com',
      company: 'Kiran Valve Industries',
      logoLetter: 'K',
      logoBg: 'bg-indigo-650 text-white',
      avatarColor: 'bg-indigo-100 text-indigo-800',
      category: 'Valves & Flow Control',
      location: 'Ahmedabad, GJ',
      rating: 4.5,
      leadTimeDays: 14,
      whatsappSla: 88.0,
      awardedSpend: 280000,
      rfqBids: ['RFQ-2026-00421', 'RFQ-2026-00424'],
    },
    {
      id: 'vendor-3',
      name: 'Sunita Reddy',
      email: 'sunita@technoforce.in',
      company: 'TechnoForce Engineering',
      logoLetter: 'T',
      logoBg: 'bg-purple-600 text-white',
      avatarColor: 'bg-purple-100 text-purple-800',
      category: 'Electrical & Switchgear',
      location: 'Hyderabad, TS',
      rating: 4.7,
      leadTimeDays: 10,
      whatsappSla: 91.5,
      awardedSpend: 310000,
      rfqBids: ['RFQ-2026-00422', 'RFQ-2026-00425'],
    },
    {
      id: 'vendor-4',
      name: 'Vikram Shah',
      email: 'vikram@precisionpumps.co.in',
      company: 'Precision Pumps Pvt Ltd',
      logoLetter: 'P',
      logoBg: 'bg-cyan-600 text-white',
      avatarColor: 'bg-cyan-100 text-cyan-800',
      category: 'Heavy Mechanical & Pumps',
      location: 'Pune, MH',
      rating: 4.3,
      leadTimeDays: 15,
      whatsappSla: 85.4,
      awardedSpend: 130000,
      rfqBids: ['RFQ-2026-00423', 'RFQ-2026-00426'],
    },
    {
      id: 'vendor-5',
      name: 'Priya Menon',
      email: 'priya@coolairsys.com',
      company: 'CoolAir Systems',
      logoLetter: 'C',
      logoBg: 'bg-orange-600 text-white',
      avatarColor: 'bg-orange-100 text-orange-850',
      category: 'Building Automation & HVAC',
      location: 'Chennai, TN',
      rating: 4.6,
      leadTimeDays: 16,
      whatsappSla: 89.2,
      awardedSpend: 90000,
      rfqBids: ['RFQ-2026-00424'],
    },
  ];

  // Helper to map RFQs where this vendor submitted a bid
  const getVendorRfqs = (vendorId: string, bids: string[]) => {
    return rfqs.filter((r) => bids.includes(r.rfqNumber));
  };

  // Compile Vendor Summary Data
  const compiledVendors = VENDORS.map((vendor) => {
    const vendorRfqs = getVendorRfqs(vendor.id, vendor.rfqBids);
    const activeBidsCount = vendorRfqs.filter((r) => r.status !== 'PO Generated').length;
    
    return {
      ...vendor,
      rfqsList: vendorRfqs,
      activeBidsCount,
    };
  });

  // Filter vendors based on dropdown selector values
  const filteredByDropdownVendors = compiledVendors.filter((v) => {
    const matchCompany = selectedCompany === 'all' || v.company === selectedCompany;
    const matchContact = selectedContactFilterId === 'all' || v.id === selectedContactFilterId;
    return matchCompany && matchContact;
  });

  // Filter vendors based on search input (name, company, category)
  const filteredVendors = filteredByDropdownVendors.filter(
    (v) =>
      v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Overall Analytics computations based on dropdown filter scope
  const totalAwardedSpend = filteredByDropdownVendors.reduce((sum, v) => sum + v.awardedSpend, 0);
  const totalBidsCount = filteredByDropdownVendors.reduce((sum, v) => sum + v.rfqsList.length, 0);
  const avgSlaDays = filteredByDropdownVendors.length > 0
    ? (filteredByDropdownVendors.reduce((sum, v) => sum + v.leadTimeDays, 0) / filteredByDropdownVendors.length).toFixed(1)
    : '0.0';
  const avgResponseSla = filteredByDropdownVendors.length > 0
    ? (filteredByDropdownVendors.reduce((sum, v) => sum + v.whatsappSla, 0) / filteredByDropdownVendors.length).toFixed(1)
    : '0.0';

  // Dynamic context drill down: if vendor is selected via dropdown, expand it. Otherwise use click-selected ID.
  const activeVendorId = selectedContactFilterId !== 'all' ? selectedContactFilterId : selectedVendorId;
  const selectedVendor = compiledVendors.find((v) => v.id === activeVendorId);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Vendor Summary & Performance Analytics
            </h1>
            <span className="badge badge-purple">Screen 2.5</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Category Manager Central Command: check vendor performance metrics, response SLAs, awarded spend share, and drill down into bid details.
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DYNAMIC VENDOR SELECTOR BAR */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/60 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-gray-300">
          <Building2 size={16} className="text-indigo-500" />
          <span>Active Context Selection:</span>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto text-xs">
          {/* Vendor Company Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Vendor Company</label>
            <select
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setSelectedContactFilterId('all'); // Reset contact on company change
              }}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
            >
              <option value="all">🌐 All Vendor Companies</option>
              {Array.from(new Set(VENDORS.map((v) => v.company))).map((company) => (
                <option key={company} value={company}>
                  🏢 {company}
                </option>
              ))}
            </select>
          </div>

          {/* Dependent Contact Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Contact Person</label>
            <select
              value={selectedContactFilterId}
              onChange={(e) => setSelectedContactFilterId(e.target.value)}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
              disabled={selectedCompany === 'all'}
            >
              {selectedCompany === 'all' ? (
                <option value="all">👥 Select Company First</option>
              ) : (
                <>
                  <option value="all">👥 All Contacts in Company</option>
                  {VENDORS.filter((v) => v.company === selectedCompany).map((v) => (
                    <option key={v.id} value={v.id}>
                      👤 {v.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR PERFORMANCE ANALYTICS PANEL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Pane: Aggructured performance stats */}
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-850 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Awarded Spend Contracts</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">${totalAwardedSpend.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
              <DollarSign size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-855 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Response Efficacy SLA</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{avgResponseSla}%</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Clock size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-860 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Average Lead Time</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{avgSlaDays} Days</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Layers size={20} />
            </div>
          </div>
        </div>

        {/* Right Pane: Company Wise Performance & Scorecard */}
        <div className="lg:col-span-2 glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-100 dark:border-gray-800 pb-2 flex items-center justify-between">
            <span>Vendor Company performance SLA scorecard</span>
            <span className="text-[10px] text-slate-400 lowercase normal-case">Average WhatsApp & Lead SLA</span>
          </h3>

          <div className="space-y-3.5">
            {filteredByDropdownVendors.map((v) => {
              return (
                <div key={v.id} className="text-xs">
                  <div className="flex justify-between items-center text-slate-700 dark:text-gray-300 font-semibold mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-md ${v.logoBg} font-mono font-bold text-[9px] flex items-center justify-center`}>
                        {v.logoLetter}
                      </span>
                      <span>{v.company} ({v.name})</span>
                    </span>
                    <span className="mono font-bold text-slate-900 dark:text-white text-[11px]">
                      SLA: {v.whatsappSla}% · Lead: {v.leadTimeDays}d · Rating: ⭐ {v.rating}
                    </span>
                  </div>
                  
                  <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${v.whatsappSla}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDORS PERFORMANCE LIST */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider flex items-center gap-2">
            <Users size={15} className="text-indigo-600 dark:text-indigo-400" />
            Vendor wise Performance & Bid Summary ({filteredVendors.length} Vendors)
          </h3>

          {/* Search Box */}
          <div className="relative max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Search size={13} />
            </span>
            <input
              type="text"
              placeholder="Search Vendor name or category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-8 py-1.5 text-xs w-full sm:w-64"
            />
          </div>
        </div>

        {/* Vendors Performance Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredVendors.map((v) => {
            const isSelected = selectedVendorId === v.id;
            
            return (
              <div
                key={v.id}
                className={`glass-panel p-5 rounded-2xl border-2 transition-all flex flex-col justify-between space-y-4 ${
                  isSelected
                    ? 'border-emerald-650 dark:border-emerald-500 bg-emerald-50/10 dark:bg-emerald-950/10 shadow-md'
                    : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 bg-white dark:bg-gray-900/80 shadow-sm'
                }`}
              >
                {/* Upper Block: Profile */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${v.avatarColor} font-bold text-xs flex items-center justify-center shrink-0`}>
                      {v.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                        <CompanyHoverTooltip name={v.company} type="vendor" />
                      </h4>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500">{v.name} · {v.email}</p>
                      
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 text-[9px] font-semibold border border-slate-200 dark:border-gray-700">
                          {v.category}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <span className="px-2 py-0.5 rounded text-[9px] font-extrabold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/30 flex items-center gap-0.5">
                    ⭐ {v.rating} Rating
                  </span>
                </div>

                {/* Mid Block: Metrics */}
                <div className="grid grid-cols-3 gap-2 py-3 border-t border-b border-slate-100 dark:border-gray-850 text-center text-xs">
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-500 font-bold uppercase">Total Bids</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{v.rfqBids.length}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-500 font-bold uppercase">WhatsApp SLA</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{v.whatsappSla}%</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Awarded Spend</div>
                    <div className="font-black text-emerald-600 dark:text-emerald-400 mt-0.5 mono">${v.awardedSpend.toLocaleString()}</div>
                  </div>
                </div>

                {/* Lower Block: Actions */}
                <div className="flex justify-between items-center pt-1.5">
                  <span className="text-[9px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock size={10} /> Lead time SLA: {v.leadTimeDays} days
                  </span>
                  
                  <button
                    onClick={() => {
                      if (isSelected) {
                        setSelectedVendorId(null);
                      } else {
                        setSelectedVendorId(v.id);
                        setExpandedQuoteNumber(null);
                      }
                    }}
                    className="btn btn-secondary btn-xs font-bold flex items-center gap-1"
                  >
                    <span>{isSelected ? 'Hide Details' : 'Review Performance'}</span>
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
      {selectedVendor && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md space-y-4 animate-slide-up">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                Sourcing Bid Roster for {selectedVendor.company} ({selectedVendor.name})
              </h3>
              <p className="text-[10px] text-slate-450 dark:text-gray-500">
                Performance Audit. Inspect line-item quote values submitted by this vendor for active RFQ items below.
              </p>
            </div>
            <span className="text-[11px] mono text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200/20">
              {selectedVendor.rfqsList.length} total bids submitted
            </span>
          </div>

          {selectedVendor.rfqsList.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400 dark:text-gray-500">
              No active bids or quotes found in category database for this vendor.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedVendor.rfqsList.map((rfq) => {
                const isQuoteExpanded = expandedQuoteNumber === rfq.rfqNumber;
                
                // Find matching quote from this vendor inside the RFQ list
                const matchingQuote = rfq.quotes.find((q) => q.vendorName.toLowerCase().includes(selectedVendor.company.toLowerCase()) || selectedVendor.company.toLowerCase().includes(q.vendorName.toLowerCase())) || {
                  unitPrice: rfq.budget / 12,
                  totalPrice: rfq.budget,
                  leadTimeDays: selectedVendor.leadTimeDays,
                  complianceStatus: 'Fully Compliant',
                  paymentTerms: 'Net 30 Days',
                  remarks: 'Standard quotation ingested via email attachment.',
                };

                return (
                  <div
                    key={rfq.rfqNumber}
                    className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-gray-950/40"
                  >
                    {/* Header Row */}
                    <div
                      onClick={() => setExpandedQuoteNumber(isQuoteExpanded ? null : rfq.rfqNumber)}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-md ${selectedVendor.logoBg} font-mono font-bold text-[9px] flex items-center justify-center shrink-0`}>
                          {selectedVendor.logoLetter}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">{rfq.title}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-550 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.25 rounded border border-slate-200 dark:border-gray-700">
                              {rfq.rfqNumber}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-450 dark:text-gray-500 mt-1">
                            <span>Sourced Spend: <strong>${rfq.budget.toLocaleString()}</strong></span>
                            <span>Line Items: <strong>{rfq.extractedEntities.length}</strong></span>
                            <span>Total Quote Value: <strong className="text-emerald-600">${matchingQuote.totalPrice?.toLocaleString() || rfq.budget.toLocaleString()}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-750 dark:text-indigo-300 border border-indigo-200/30">
                          Lead: {matchingQuote.leadTimeDays} days
                        </span>
                        <span className={`badge text-[9px] ${
                          matchingQuote.complianceStatus?.includes('Fully') ? 'badge-emerald' : 'badge-amber'
                        }`}>
                          {matchingQuote.complianceStatus || 'Compliant'}
                        </span>
                        <ChevronDown size={14} className="text-slate-455 transition-transform" style={{ transform: isQuoteExpanded ? 'rotate(180deg)' : 'none' }} />
                      </div>
                    </div>

                    {/* Expanded Block */}
                    {isQuoteExpanded && (
                      <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-4 animate-fade-in text-xs">
                        {/* Quote summary card details */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-250/60 dark:border-gray-850 space-y-2">
                            <h4 className="text-[10px] font-bold uppercase text-slate-450 dark:text-gray-500 tracking-wider">Quotation Parameters</h4>
                            <div className="space-y-1.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-slate-500">Unit Sourced Price:</span>
                                <span className="font-bold text-slate-900 dark:text-white">${matchingQuote.unitPrice?.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500">Total Bidded Price:</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-450 font-mono">${matchingQuote.totalPrice?.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-500">Payment Terms:</span>
                                <span className="font-bold text-slate-800 dark:text-white">{matchingQuote.paymentTerms}</span>
                              </div>
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-250/60 dark:border-gray-850 space-y-2">
                            <h4 className="text-[10px] font-bold uppercase text-slate-450 dark:text-gray-500 tracking-wider">Remarks & Compliance Audit</h4>
                            <p className="text-slate-650 dark:text-gray-300 text-[11px] leading-relaxed">
                              {matchingQuote.remarks || 'Ingested automatically from mail inbox quote attachment.'}
                            </p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/30 text-[11px] text-indigo-750 dark:text-indigo-300">
                          <span>
                            🚀 <strong>Category Manager Action</strong>: You can check the overall ranking of this quote in the central Quote Matrix.
                          </span>
                          <button
                            onClick={() => onNavigateToMatrix(rfq)}
                            className="btn btn-primary btn-xs font-bold"
                          >
                            Go to Central Quote Matrix
                          </button>
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
