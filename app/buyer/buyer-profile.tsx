'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import categoriesData from '@/lib/categories.json';
import {
  Building2,
  FileCheck,
  ShieldCheck,
  CheckCircle2,
  MapPin,
  User,
  Mail,
  Phone,
  Search,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Save,
  Globe,
  Sliders,
  Layers,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

export default function BuyerProfilePage() {
  const { addAuditLog, showToast } = useApp();

  // Organization Form State
  const [companyName, setCompanyName] = useState('Larsen & Toubro Limited');
  const [brandName, setBrandName] = useState('L&T Heavy Engineering & Construction');
  const [orgType, setOrgType] = useState<'Private Limited' | 'Public Limited' | 'Partnership' | 'Sole Proprietorship' | 'LLP'>('Public Limited');
  const [panNumber, setPanNumber] = useState('AAACL1234F');
  const [gstNumber, setGstNumber] = useState('27AAACL1234F1Z5');
  const [cinNumber, setCinNumber] = useState('L28920MH1946PLC004768');
  const [website, setWebsite] = useState('https://www.larsentoubro.com');
  const [annualTurnover, setAnnualTurnover] = useState('₹ 1,80,000 Cr+');

  // Address State
  const [street, setStreet] = useState('L&T House, Ballard Estate, N.M. Marg');
  const [city, setCity] = useState('Mumbai');
  const [state, setState] = useState('Maharashtra');
  const [pincode, setPincode] = useState('400001');
  const [country, setCountry] = useState('India');

  // Contact Person State
  const [contactName, setContactName] = useState('Rajesh Sharma');
  const [contactDesignation, setContactDesignation] = useState('Chief Procurement Officer (CPO)');
  const [contactEmail, setContactEmail] = useState('buyer@procucev.com');
  const [contactPhone, setContactPhone] = useState('+91 98201 44820');

  // Category Selection State: Selected Major Categories and Minor Categories
  const [selectedMajor, setSelectedMajor] = useState<string[]>([
    'Civil Works',
    'Engineering Spares - Electrical',
    'Engineering Spares - Mechanical',
    'IT',
  ]);

  const [selectedMinor, setSelectedMinor] = useState<Record<string, string[]>>({
    'Civil Works': ['Piling', 'Excavation', 'Waterproofing', 'PEB Structure', 'Roofing Sheets'],
    'Engineering Spares - Electrical': ['Cables', 'Circuit Breakers', 'Panels', 'DG Parts', 'Transformers'],
    'Engineering Spares - Mechanical': ['Bearings & Accessories', 'Compressors & Accessories', 'Pipes & Pipe Fittings', 'Pumps & Accessories', 'Valves & Fittings'],
    'IT': ['Computer', 'Laptop', 'Servers', 'Software', 'Networking Equipment'],
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({
    'Civil Works': true,
    'Engineering Spares - Electrical': true,
    'Engineering Spares - Mechanical': true,
    'IT': true,
  });

  // PAN Validation Helper
  const isPanValid = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.toUpperCase());
  // GST Validation Helper
  const isGstValid = (gst: string) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gst.toUpperCase());

  // Toggle Major Category
  const toggleMajorCategory = (majorName: string) => {
    if (selectedMajor.includes(majorName)) {
      setSelectedMajor((prev) => prev.filter((m) => m !== majorName));
      setSelectedMinor((prev) => {
        const next = { ...prev };
        delete next[majorName];
        return next;
      });
    } else {
      setSelectedMajor((prev) => [...prev, majorName]);
      // Select all minor by default when major is turned on
      const allMinor = categoriesData.find((c) => c.majorCategory === majorName)?.minorCategories || [];
      setSelectedMinor((prev) => ({ ...prev, [majorName]: allMinor }));
    }
  };

  // Toggle Minor Category
  const toggleMinorCategory = (majorName: string, minorName: string) => {
    if (!selectedMajor.includes(majorName)) {
      setSelectedMajor((prev) => [...prev, majorName]);
    }

    const currentList = selectedMinor[majorName] || [];
    let updated: string[] = [];
    if (currentList.includes(minorName)) {
      updated = currentList.filter((m) => m !== minorName);
    } else {
      updated = [...currentList, minorName];
    }

    setSelectedMinor((prev) => ({ ...prev, [majorName]: updated }));

    // If no minor selected, deselect major
    if (updated.length === 0) {
      setSelectedMajor((prev) => prev.filter((m) => m !== majorName));
    }
  };

  // Select all minor for a major
  const selectAllMinorInMajor = (majorName: string) => {
    const allMinor = categoriesData.find((c) => c.majorCategory === majorName)?.minorCategories || [];
    if (!selectedMajor.includes(majorName)) {
      setSelectedMajor((prev) => [...prev, majorName]);
    }
    setSelectedMinor((prev) => ({ ...prev, [majorName]: allMinor }));
  };

  // Clear minor for a major
  const clearMinorInMajor = (majorName: string) => {
    setSelectedMinor((prev) => {
      const next = { ...prev };
      delete next[majorName];
      return next;
    });
    setSelectedMajor((prev) => prev.filter((m) => m !== majorName));
  };

  // Calculate totals
  const totalSelectedMinorCount = Object.values(selectedMinor).reduce((acc, curr) => acc + curr.length, 0);

  // Filtered Categories based on search
  const filteredCategories = categoriesData.filter((cat) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesMajor = cat.majorCategory.toLowerCase().includes(term);
    const matchesMinor = cat.minorCategories.some((m) => m.toLowerCase().includes(term));
    return matchesMajor || matchesMinor;
  });

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !panNumber.trim() || !gstNumber.trim()) {
      showToast('Validation Error', 'Company Name, PAN, and GSTIN are required.', 'warning');
      return;
    }

    addAuditLog(`Updated Buyer Organization Profile & Procurement Categories for ${companyName}`);
    showToast(
      'Profile Saved Successfully',
      `Organization details and ${totalSelectedMinorCount} procurement categories updated.`,
      'success'
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="text-indigo-600 dark:text-indigo-400" /> Buyer Organization Profile
            </h1>
            <span className="badge badge-purple font-mono">Enterprise Buyer</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Manage organization legal governance, GSTIN/PAN tax compliance, and multi-tier procurement categories.
          </p>
        </div>

        <button
          onClick={handleSaveProfile}
          className="btn btn-primary btn-md shadow-lg shadow-indigo-600/20 font-bold flex items-center gap-2"
        >
          <Save size={16} /> Save Organization Profile
        </button>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Section 1: Legal Entity & Tax Compliance */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="text-indigo-600 dark:text-indigo-400" size={18} /> Section 1: Organization & Tax Registration
            </h2>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 size={12} /> Tax Verified
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Company Name */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Legal Entity Name *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>

            {/* Brand / Division */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Brand / Procurement Division
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>

            {/* Org Type */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Organization Constitution *
              </label>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              >
                <option value="Public Limited">Public Limited Company</option>
                <option value="Private Limited">Private Limited Company</option>
                <option value="LLP">Limited Liability Partnership (LLP)</option>
                <option value="Partnership">Partnership Firm</option>
                <option value="Sole Proprietorship">Sole Proprietorship</option>
              </select>
            </div>

            {/* PAN Number */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                  PAN Number *
                </label>
                {isPanValid(panNumber) ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ Valid PAN</span>
                ) : (
                  <span className="text-[10px] font-bold text-rose-500">Invalid Format</span>
                )}
              </div>
              <input
                type="text"
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                maxLength={10}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase tracking-widest"
              />
            </div>

            {/* GST Number */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                  GSTIN / GST Number *
                </label>
                {isGstValid(gstNumber) ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ State 27 Verified</span>
                ) : (
                  <span className="text-[10px] font-bold text-rose-500">Invalid GSTIN</span>
                )}
              </div>
              <input
                type="text"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                maxLength={15}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase tracking-widest"
              />
            </div>

            {/* CIN Number */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                CIN (Corporate ID Number)
              </label>
              <input
                type="text"
                value={cinNumber}
                onChange={(e) => setCinNumber(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase"
              />
            </div>

            {/* Website */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Corporate Website
              </label>
              <div className="relative">
                <Globe size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Annual Turnover */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Annual Procurement Volume
              </label>
              <input
                type="text"
                value={annualTurnover}
                onChange={(e) => setAnnualTurnover(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Address & Primary Contact */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Registered Address */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-3">
              <MapPin className="text-indigo-600 dark:text-indigo-400" size={18} /> Registered Corporate Address
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Street Address</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">State</label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">PIN Code</label>
                  <input
                    type="text"
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Country</label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Primary Contact Person */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-3">
              <User className="text-indigo-600 dark:text-indigo-400" size={18} /> Key Procurement Contact Person
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Full Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Designation</label>
                <input
                  type="text"
                  value={contactDesignation}
                  onChange={(e) => setContactDesignation(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email Address</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mobile Number</label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Consolidated Major & Minor Categories Selector */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="text-indigo-600 dark:text-indigo-400" size={18} /> Section 3: Relevant Procurement Categories (13 Major & 120+ Minor)
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Select your organization&apos;s active procurement scopes. This governs automated AI vendor matching &amp; RFQ distribution.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="badge badge-purple font-mono text-xs">
                {selectedMajor.length} Major • {totalSelectedMinorCount} Minor Selected
              </span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search across all 13 Major and 120+ Minor categories (e.g. Cables, Valves, Pumps, IT, Logistics)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
            />
          </div>

          {/* Categories Accordion / Selector Grid */}
          <div className="space-y-3 pt-1">
            {filteredCategories.map((cat) => {
              const isMajorSelected = selectedMajor.includes(cat.majorCategory);
              const selectedMinorsInCat = selectedMinor[cat.majorCategory] || [];
              const isExpanded = expandedMajor[cat.majorCategory] || false;

              return (
                <div
                  key={cat.majorCategory}
                  className={`rounded-2xl border transition-all ${
                    isMajorSelected
                      ? 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/30 dark:bg-indigo-950/20'
                      : 'border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/60'
                  }`}
                >
                  {/* Major Category Bar */}
                  <div className="p-3.5 flex items-center justify-between gap-3 cursor-pointer">
                    <div className="flex items-center gap-3 flex-1" onClick={() => toggleMajorCategory(cat.majorCategory)}>
                      <button type="button" className="text-indigo-600 dark:text-indigo-400">
                        {isMajorSelected ? <CheckSquare size={18} /> : <Square size={18} className="text-slate-400" />}
                      </button>
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                          {cat.majorCategory}
                        </h3>
                        <p className="text-[10px] text-slate-500 dark:text-gray-400">
                          {cat.minorCategories.length} Minor Categories available
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300 mono bg-white dark:bg-gray-900 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                        {selectedMinorsInCat.length} / {cat.minorCategories.length} Selected
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedMajor((prev) => ({ ...prev, [cat.majorCategory]: !prev[cat.majorCategory] }))
                        }
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Minor Categories Grid */}
                  {isExpanded && (
                    <div className="p-3.5 pt-0 border-t border-slate-200/60 dark:border-gray-800/80 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] pt-2">
                        <span className="font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                          Minor Procurement Categories
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => selectAllMinorInMajor(cat.majorCategory)}
                            className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            Select All
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={() => clearMinorInMajor(cat.majorCategory)}
                            className="text-[10px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-gray-300 hover:underline"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {cat.minorCategories.map((minor) => {
                          const isMinorChecked = selectedMinorsInCat.includes(minor);
                          return (
                            <label
                              key={minor}
                              className={`p-2 rounded-xl border text-[11px] font-medium flex items-center gap-2 cursor-pointer transition-colors ${
                                isMinorChecked
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                  : 'bg-slate-50 dark:bg-gray-950 text-slate-700 dark:text-gray-300 border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isMinorChecked}
                                onChange={() => toggleMinorCategory(cat.majorCategory, minor)}
                                className="sr-only"
                              />
                              <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border ${isMinorChecked ? 'bg-white text-indigo-600 border-white' : 'border-slate-400'}`}>
                                {isMinorChecked && <span className="text-[10px] font-bold">✓</span>}
                              </div>
                              <span className="truncate" title={minor}>{minor}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="btn btn-primary btn-lg shadow-xl shadow-indigo-600/20 font-bold flex items-center gap-2 px-8"
          >
            <Save size={18} /> Save Buyer Organization Profile
          </button>
        </div>
      </form>
    </div>
  );
}
