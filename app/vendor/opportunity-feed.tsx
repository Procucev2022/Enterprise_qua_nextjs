'use client';

import React from 'react';
import { useApp } from '@/lib/store';
import { VendorOpportunity } from '@/lib/types';
import {
  Truck,
  ShieldCheck,
  Star,
  Clock,
  AlertTriangle,
  Send,
  Building,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Zap,
  Mail,
  Search,
  Sparkles,
  Package,
} from 'lucide-react';

interface OpportunityFeedProps {
  onNavigateToBidForm: (opp: VendorOpportunity) => void;
}

export default function OpportunityFeed({ onNavigateToBidForm }: OpportunityFeedProps) {
  const { 
    vendorOpportunities, 
    showToast, 
    addAuditLog, 
    vendorSubscription, 
    setVendorSubscription,
    vendorRfqDownloadsUsed,
    setVendorRfqDownloadsUsed,
    vendorCatalogue,
  } = useApp();

  const [showUpgradeModal, setShowUpgradeModal] = React.useState(false);

  // Cross-match: find catalogue products matching an RFQ by keyword comparison
  const getCatalogueMatchesForRfq = (opp: VendorOpportunity) => {
    const rfqText = `${opp.title} ${opp.lineItems?.map(li => li.description).join(' ') || ''}`.toLowerCase();
    const matchKeywords = ['pump', 'valve', 'pipe', 'fitting', 'sensor', 'flow', 'expansion', 'joint', 'centrifugal', 'gate', 'ball', 'hvac', 'control', 'steel', 'beam', 'motor', 'meter', 'flanged', 'bellows'];

    return vendorCatalogue.filter((prod: any) => {
      const prodWords = `${prod.name} ${prod.category} ${prod.specs || ''}`.toLowerCase().split(/\W+/);
      // Check if any product keyword appears in the RFQ text
      return prodWords.some((word: string) => word.length > 3 && rfqText.includes(word));
    });
  };

  // 1. Direct Invitations Filter States
  const [selectedBuyerCompanyDirect, setSelectedBuyerCompanyDirect] = React.useState('all');
  const [selectedBuyerNameDirect, setSelectedBuyerNameDirect] = React.useState('all');
  const [selectedMajorCategoryDirect, setSelectedMajorCategoryDirect] = React.useState('all');
  const [selectedMinorCategoryDirect, setSelectedMinorCategoryDirect] = React.useState('all');
  const [rfqSearchTermDirect, setRfqSearchTermDirect] = React.useState('');
  const [filterCatalogueMatchesDirect, setFilterCatalogueMatchesDirect] = React.useState(false);

  // 2. Open Network Marketplace Filter States (Buyers list removed as they are not applicable here)
  const [selectedMajorCategoryNet, setSelectedMajorCategoryNet] = React.useState('all');
  const [selectedMinorCategoryNet, setSelectedMinorCategoryNet] = React.useState('all');
  const [rfqSearchTermNet, setRfqSearchTermNet] = React.useState('');
  const [filterCatalogueMatchesNet, setFilterCatalogueMatchesNet] = React.useState(false);

  // Buyer Companies Roster Ingestion Status
  const BUYER_ROSTER_UPLOAD_STATUS: Record<string, boolean> = {
    'Larsen & Toubro Ltd. (L&T)': true,
    'Tata Steel Procurement': true,
    'Reliance Industries Ltd. (RIL)': false,
    'Adani Group Sourcing': false,
  };

  const getParentCompany = (buyerName: string) => {
    if (buyerName.includes('Energy') || buyerName.includes('Global Client')) {
      return 'Larsen & Toubro Ltd. (L&T)';
    }
    if (buyerName.includes('Consortium') || buyerName.includes('Real Estate')) {
      return 'Reliance Industries Ltd. (RIL)';
    }
    if (buyerName.includes('Marketplace') || buyerName.includes('Network')) {
      return 'Tata Steel Procurement';
    }
    return 'Larsen & Toubro Ltd. (L&T)'; // Default
  };

  const getBuyerName = (buyerName: string) => {
    if (buyerName.includes('Energy') || buyerName.includes('Global Client')) {
      return 'Rajesh Nair';
    }
    if (buyerName.includes('Consortium') || buyerName.includes('Real Estate')) {
      return 'Sunita Sharma';
    }
    if (buyerName.includes('Marketplace') || buyerName.includes('Network')) {
      return 'Amit Kumar Tata';
    }
    return 'Rajesh Nair'; // Default
  };

  // Helper to map RFQs to Major and Minor Sourcing categories dynamically
  const getOpportunityCategories = (opp: VendorOpportunity) => {
    const title = opp.title.toLowerCase();
    if (title.includes('pump') || title.includes('valve') || title.includes('fluid')) {
      return { major: 'Mechanical & Fluid Equipment', minor: 'Pumps & Valves' };
    }
    if (title.includes('hvac') || title.includes('control') || title.includes('building')) {
      return { major: 'Building & Infrastructure', minor: 'Building Automation & HVAC' };
    }
    if (title.includes('steel') || title.includes('beam') || title.includes('structure')) {
      return { major: 'Mechanical & Fluid Equipment', minor: 'Structural Steel & Beams' };
    }
    return { major: 'Mechanical & Fluid Equipment', minor: 'Pumps & Valves' }; // Default
  };

  // Rajesh Nair (L&T) uploaded Apex Supplies, so their RFQs are free to bid on.
  // Other buyer RFQs require premium vendor subscription.
  const isOwnBuyerRfq = (rfqNumber: string) => {
    return ['RFQ-2026-00421', 'RFQ-2026-00423', 'RFQ-2026-00425', 'RFQ-2026-00427'].includes(rfqNumber);
  };

  const handleExpressInterest = (opp: VendorOpportunity) => {
    if (!isOwnBuyerRfq(opp.rfqNumber) && vendorSubscription !== 'premium_network') {
      setShowUpgradeModal(true);
      return;
    }
    addAuditLog(`Apex Supplies Ltd. expressed interest in open marketplace opportunity ${opp.rfqNumber}`, opp.rfqNumber, 'vendor@apex.com');
    showToast('Interest Expressed', `Express of interest submitted for ${opp.rfqNumber}. Buyer notified.`, 'success');
  };

  const handleDownloadRfq = (opp: VendorOpportunity) => {
    const isDirect = isOwnBuyerRfq(opp.rfqNumber);

    // 1. Premium Model (Client Uploaded)
    if (vendorSubscription === 'premium') {
      if (!isDirect) {
        setShowUpgradeModal(true);
        showToast('Upgrade Required', 'Marketplace RFQs outside client roster require Connect (50 RFQs/3mo) or Select (100 RFQs/3mo) plan.', 'info');
        return;
      }
      addAuditLog(`Apex Supplies Ltd. downloaded technical BOQ specs for ${opp.rfqNumber} via email (Direct Buyer RFQ)`, opp.rfqNumber, 'vendor@apex.com');
      showToast('Document Emailed', `📨 Technical specifications & BOQ Excel for ${opp.rfqNumber} sent to vendor@apex.com. (Unlimited Direct Buyer Access)`, 'success');
      return;
    }

    // 2. Connect Model (50 RFQs / 3 Months)
    if (vendorSubscription === 'connect') {
      if (vendorRfqDownloadsUsed >= 50 && !isDirect) {
        setShowUpgradeModal(true);
        showToast('Quarterly Quota Reached', 'You have reached your limit of 50 RFQ downloads for this 3-month period. Upgrade to Select Model for 100 downloads.', 'warning');
        return;
      }

      if (!isDirect) {
        const nextUsed = vendorRfqDownloadsUsed + 1;
        setVendorRfqDownloadsUsed(nextUsed);
        addAuditLog(`Apex Supplies Ltd. downloaded technical BOQ specs for ${opp.rfqNumber} via email (${nextUsed}/50 used)`, opp.rfqNumber, 'vendor@apex.com');
        showToast('Document Emailed', `📨 Specs & BOQ for ${opp.rfqNumber} sent to vendor@apex.com. Quota: ${nextUsed}/50 RFQs downloaded in 3 months.`, 'success');
      } else {
        addAuditLog(`Apex Supplies Ltd. downloaded direct buyer RFQ specs for ${opp.rfqNumber}`, opp.rfqNumber, 'vendor@apex.com');
        showToast('Document Emailed', `📨 Specs & BOQ for ${opp.rfqNumber} sent to vendor@apex.com.`, 'success');
      }
      return;
    }

    // 3. Select Model (100 RFQs / 3 Months + Catalogue)
    if (vendorSubscription === 'select') {
      if (vendorRfqDownloadsUsed >= 100 && !isDirect) {
        setShowUpgradeModal(true);
        showToast('Quarterly Quota Reached', 'You have reached your limit of 100 RFQ downloads for this 3-month period.', 'warning');
        return;
      }

      if (!isDirect) {
        const nextUsed = vendorRfqDownloadsUsed + 1;
        setVendorRfqDownloadsUsed(nextUsed);
        addAuditLog(`Apex Supplies Ltd. downloaded technical BOQ specs for ${opp.rfqNumber} via email (${nextUsed}/100 used)`, opp.rfqNumber, 'vendor@apex.com');
        showToast('Document Emailed', `📨 Specs & BOQ for ${opp.rfqNumber} sent to vendor@apex.com. Quota: ${nextUsed}/100 RFQs downloaded in 3 months.`, 'success');
      } else {
        addAuditLog(`Apex Supplies Ltd. downloaded direct buyer RFQ specs for ${opp.rfqNumber}`, opp.rfqNumber, 'vendor@apex.com');
        showToast('Document Emailed', `📨 Specs & BOQ for ${opp.rfqNumber} sent to vendor@apex.com.`, 'success');
      }
      return;
    }
  };

  // Reorder / Sort RFQs:
  // RFQs pertaining to the vendor's primary category (Pumps & Valves / Mechanical Fluid Equipment) appear FIRST!
  const sortOpportunitiesByCategoryMatch = (list: VendorOpportunity[]) => {
    return [...list].sort((a, b) => {
      const catA = getOpportunityCategories(a);
      const catB = getOpportunityCategories(b);
      
      const matchA = catA.minor === 'Pumps & Valves' || catA.major === 'Mechanical & Fluid Equipment';
      const matchB = catB.minor === 'Pumps & Valves' || catB.major === 'Mechanical & Fluid Equipment';
      
      if (matchA && !matchB) return -1;
      if (!matchA && matchB) return 1;
      return 0;
    });
  };

  // FILTER DIRECT INVITATIONS
  const eligibleDirectOpportunities = vendorOpportunities.filter((opp) => {
    if (opp.type !== 'direct_invitation') return false;
    const parentCompany = getParentCompany(opp.buyer);
    const buyerName = getBuyerName(opp.buyer);
    const cats = getOpportunityCategories(opp);
    
    // Check roster upload status first
    if (!BUYER_ROSTER_UPLOAD_STATUS[parentCompany]) {
      return false; 
    }

    // Filter by buyer context (Direct)
    const matchCompany = selectedBuyerCompanyDirect === 'all' || parentCompany === selectedBuyerCompanyDirect;
    const matchBuyer = selectedBuyerNameDirect === 'all' || buyerName === selectedBuyerNameDirect;
    if (!matchCompany || !matchBuyer) return false;

    // Filter by categories (Direct)
    const matchMajor = selectedMajorCategoryDirect === 'all' || cats.major === selectedMajorCategoryDirect;
    const matchMinor = selectedMinorCategoryDirect === 'all' || cats.minor === selectedMinorCategoryDirect;
    if (!matchMajor || !matchMinor) return false;

    // Search query matching (Direct)
    if (rfqSearchTermDirect.trim()) {
      const term = rfqSearchTermDirect.toLowerCase();
      const inTitle = opp.title.toLowerCase().includes(term);
      const inRfq = opp.rfqNumber.toLowerCase().includes(term);
      const inLoc = opp.deliveryLocation.toLowerCase().includes(term);
      const inCat = cats.major.toLowerCase().includes(term) || cats.minor.toLowerCase().includes(term);
      const inItems = opp.lineItems?.some(li => li.description.toLowerCase().includes(term)) || false;
      if (!inTitle && !inRfq && !inLoc && !inCat && !inItems) return false;
    }

    // Filter by Catalogue Product Matches if summary button clicked
    if (filterCatalogueMatchesDirect && getCatalogueMatchesForRfq(opp).length === 0) {
      return false;
    }

    return true;
  });

  // FILTER NETWORK OPPORTUNITIES (OPEN MARKETPLACE)
  const eligibleNetworkOpportunities = vendorOpportunities.filter((opp) => {
    if (opp.type !== 'network_marketplace') return false;
    const parentCompany = getParentCompany(opp.buyer);
    const cats = getOpportunityCategories(opp);
    
    // Check roster upload status first
    if (!BUYER_ROSTER_UPLOAD_STATUS[parentCompany]) {
      return false; 
    }

    // Filter by categories (Net)
    const matchMajor = selectedMajorCategoryNet === 'all' || cats.major === selectedMajorCategoryNet;
    const matchMinor = selectedMinorCategoryNet === 'all' || cats.minor === selectedMinorCategoryNet;
    if (!matchMajor || !matchMinor) return false;

    // Search query matching (Net)
    if (rfqSearchTermNet.trim()) {
      const term = rfqSearchTermNet.toLowerCase();
      const inTitle = opp.title.toLowerCase().includes(term);
      const inRfq = opp.rfqNumber.toLowerCase().includes(term);
      const inLoc = opp.deliveryLocation.toLowerCase().includes(term);
      const inCat = cats.major.toLowerCase().includes(term) || cats.minor.toLowerCase().includes(term);
      const inItems = opp.lineItems?.some(li => li.description.toLowerCase().includes(term)) || false;
      if (!inTitle && !inRfq && !inLoc && !inCat && !inItems) return false;
    }

    // Filter by Catalogue Product Matches if summary button clicked
    if (filterCatalogueMatchesNet && getCatalogueMatchesForRfq(opp).length === 0) {
      return false;
    }

    return true;
  });

  // Total summary counts of RFQs matching vendor's item catalogue
  const directCatalogueMatchesCount = vendorOpportunities.filter(
    (opp) => opp.type === 'direct_invitation' && getCatalogueMatchesForRfq(opp).length > 0
  ).length;

  const netCatalogueMatchesCount = vendorOpportunities.filter(
    (opp) => opp.type === 'network_marketplace' && getCatalogueMatchesForRfq(opp).length > 0
  ).length;

  const directInvites = sortOpportunitiesByCategoryMatch(eligibleDirectOpportunities);
  const networkOpps = sortOpportunitiesByCategoryMatch(eligibleNetworkOpportunities);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Vendor Workspace & Opportunity Feed
            </h1>
            <span className="badge badge-purple">Screen 3.1</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Exclusive enterprise buyer RFQ invitations, active bidding countdowns, and network sourcing feed.
          </p>
        </div>
      </div>

      {/* Vendor Profile Header Card */}
      <div className="glass-panel p-5 rounded-2xl flex flex-wrap items-center justify-between gap-4 border border-emerald-200 dark:border-emerald-500/30 bg-white dark:bg-gray-900/80 shadow-md">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md">
            <Truck size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Apex Supplies Ltd.</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/40 flex items-center gap-1">
                <ShieldCheck size={13} /> Verified Supplier
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/40 flex items-center gap-1">
                <Star size={12} className="fill-amber-400 text-amber-400" /> 4.8 / 5.0 Rating
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 border ${
                vendorSubscription === 'select'
                  ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/40'
                  : vendorSubscription === 'connect'
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/40'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200'
              }`}>
                {vendorSubscription === 'select' ? '👑 Select Partner' : vendorSubscription === 'connect' ? '🔗 Connect Partner' : '📋 Premium (Client Uploaded)'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
              Vendor ID: <span className="mono text-indigo-600 dark:text-indigo-300 font-semibold">VN-APEX-4920</span> • Primary Category: Heavy Industrial Fluid Dynamics & Valves
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-center">
            <span className="text-[10px] text-slate-500 dark:text-gray-450 block uppercase">Active Bids</span>
            <span className="text-base font-bold text-slate-900 dark:text-white mono">3 Live</span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-905 border border-slate-200 dark:border-gray-800 text-center">
            <span className="text-[10px] text-slate-500 dark:text-gray-450 block uppercase">Awarded POs</span>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 mono">14 Contracts</span>
          </div>
        </div>
      </div>

      {/* Automated System Urgent Reminder Banner */}
      <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-955/45 border border-amber-300 dark:border-amber-500/50 flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200 shadow-sm">
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <div>
            <span className="font-bold text-slate-900 dark:text-white">AUTOMATED SYSTEM REMINDER:</span>{' '}
            <span>1 quotation requires action within 24 hours (<span className="mono font-bold text-slate-900 dark:text-white">RFQ-2026-00421</span>). High win probability based on your stock readiness.</span>
          </div>
        </div>
        <button
          onClick={() => {
            const opp = vendorOpportunities.find((o) => o.rfqNumber === 'RFQ-2026-00421') || vendorOpportunities[0];
            onNavigateToBidForm(opp);
          }}
          className="btn btn-amber btn-sm font-bold shrink-0"
        >
          Submit Quote Now
        </button>
      </div>

      {/* Sourcing Sections: Direct Invitations vs Open Network */}
      <div className="space-y-8">
        {/* ========================================================================= */}
        {/* SECTION 1: DIRECT INVITATIONS (CLIENT EXCLUSIVE POOL) */}
        {/* ========================================================================= */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                DIRECT INVITATIONS (CLIENT EXCLUSIVE POOL)
              </h3>
            </div>
            <span className="badge badge-blue">{directInvites.length} Targeted RFQs</span>
          </div>

          {/* Independent Filter Area: Direct Invitations */}
          <div className="bg-slate-50/50 dark:bg-gray-950/20 p-4 rounded-xl border border-slate-200/60 dark:border-gray-850 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-bold text-slate-700 dark:text-gray-300">
              <div className="flex items-center gap-1.5">
                <Building size={14} className="text-indigo-500" />
                <span>Direct Exclusive Sourcing Filters:</span>
              </div>

              {/* Bidirectional Cross-Highlight Summary Filter Button */}
              <button
                type="button"
                onClick={() => setFilterCatalogueMatchesDirect(!filterCatalogueMatchesDirect)}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border shadow-sm cursor-pointer ${
                  filterCatalogueMatchesDirect
                    ? 'bg-violet-600 text-white border-violet-500 ring-2 ring-violet-400/30'
                    : 'bg-violet-50/80 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40 hover:bg-violet-100'
                }`}
                title="Click to filter only RFQs matching items in your vendor catalogue"
              >
                <Package size={13} />
                <span>📦 Summary: {directCatalogueMatchesCount} Catalogue Match{directCatalogueMatchesCount !== 1 ? 'es' : ''}</span>
                {filterCatalogueMatchesDirect ? (
                  <span className="text-[9px] bg-white/25 text-white px-1.5 py-0.25 rounded font-black uppercase">Filtered (Click to show all)</span>
                ) : (
                  <span className="text-[9px] bg-violet-200/60 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200 px-1.5 py-0.25 rounded font-bold">Filter RFQs</span>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-[11px]">
              {/* Buyer Company Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Buyer Company</span>
                <select
                  value={selectedBuyerCompanyDirect}
                  onChange={(e) => {
                    setSelectedBuyerCompanyDirect(e.target.value);
                    setSelectedBuyerNameDirect('all'); 
                  }}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">🌐 All Eligible Companies</option>
                  {Object.keys(BUYER_ROSTER_UPLOAD_STATUS)
                    .filter((company) => BUYER_ROSTER_UPLOAD_STATUS[company])
                    .map((company) => (
                      <option key={company} value={company}>
                        🏢 {company.split(' ')[0]}
                      </option>
                    ))}
                </select>
              </div>

              {/* Dependent Buyer Name Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Buyer Name</span>
                <select
                  value={selectedBuyerNameDirect}
                  onChange={(e) => setSelectedBuyerNameDirect(e.target.value)}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                  disabled={selectedBuyerCompanyDirect === 'all'}
                >
                  {selectedBuyerCompanyDirect === 'all' ? (
                    <option value="all">Select Company First</option>
                  ) : (
                    <>
                      <option value="all">All Buyers in Company</option>
                      {selectedBuyerCompanyDirect === 'Larsen & Toubro Ltd. (L&T)' ? (
                        <option value="Rajesh Nair">👤 Rajesh Nair</option>
                      ) : (
                        <option value="Amit Kumar Tata">👤 Amit Kumar Tata</option>
                      )}
                    </>
                  )}
                </select>
              </div>

              {/* Major Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Major Category</span>
                <select
                  value={selectedMajorCategoryDirect}
                  onChange={(e) => {
                    setSelectedMajorCategoryDirect(e.target.value);
                    setSelectedMinorCategoryDirect('all'); 
                  }}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">🌐 All Major Categories</option>
                  <option value="Mechanical & Fluid Equipment">⚙️ Mechanical & Fluid</option>
                  <option value="Building & Infrastructure">🏢 Building & Infra</option>
                </select>
              </div>

              {/* Minor Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Minor Category</span>
                <select
                  value={selectedMinorCategoryDirect}
                  onChange={(e) => setSelectedMinorCategoryDirect(e.target.value)}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                  disabled={selectedMajorCategoryDirect === 'all'}
                >
                  {selectedMajorCategoryDirect === 'all' ? (
                    <option value="all">Select Major First</option>
                  ) : selectedMajorCategoryDirect === 'Mechanical & Fluid Equipment' ? (
                    <>
                      <option value="all">All Mechanical & Fluid</option>
                      <option value="Pumps & Valves">⚙️ Pumps & Valves</option>
                      <option value="Structural Steel & Beams">🏗️ Structural Steel</option>
                    </>
                  ) : (
                    <>
                      <option value="all">All Building & Infra</option>
                      <option value="Building Automation & HVAC">❄️ HVAC Control</option>
                    </>
                  )}
                </select>
              </div>

              {/* Sourcing Intelligence Search Bar */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-405">Search Specs</span>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-slate-400">
                    <Search size={12} />
                  </span>
                  <input
                    type="text"
                    placeholder="Specs, location, keywords..."
                    value={rfqSearchTermDirect}
                    onChange={(e) => setRfqSearchTermDirect(e.target.value)}
                    className="input pl-7 py-1 text-[11px] w-full bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {directInvites.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No matching targeted RFQ invitations found for this selection.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {directInvites.map((opp) => {
                const isLocked = !isOwnBuyerRfq(opp.rfqNumber) && vendorSubscription !== 'premium_network';
                const categories = getOpportunityCategories(opp);
                const isCategoryMatch = categories.minor === 'Pumps & Valves' || categories.major === 'Mechanical & Fluid Equipment';
                const catalogueMatches = getCatalogueMatchesForRfq(opp);
                const hasCatalogueMatch = catalogueMatches.length > 0;

                return (
                  <div
                    key={opp.id}
                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                      isLocked
                        ? 'bg-slate-100/50 dark:bg-gray-950/20 border-slate-200 dark:border-gray-900 opacity-90'
                        : isCategoryMatch
                        ? 'bg-emerald-50/10 dark:bg-emerald-950/10 border-emerald-300 dark:border-emerald-700/50 hover:border-emerald-500 shadow-sm shadow-emerald-500/5'
                        : 'bg-slate-50 dark:bg-gray-900/90 border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1 flex-wrap gap-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-slate-900 dark:text-white mono text-sm">{opp.rfqNumber}</span>
                          {isCategoryMatch && (
                            <span className="px-1.5 py-0.25 rounded text-[8px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 flex items-center gap-0.5 animate-pulse shrink-0">
                              ⚡ Primary Category Match
                            </span>
                          )}
                          {hasCatalogueMatch && (
                            <span
                              className="px-1.5 py-0.25 rounded text-[8px] font-black bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/40 flex items-center gap-0.5 shrink-0"
                              title={`Matching products: ${catalogueMatches.map((p: any) => p.sku).join(', ')}`}
                            >
                              <Package size={9} /> {catalogueMatches.length} Catalogue Match{catalogueMatches.length > 1 ? 'es' : ''}
                            </span>
                          )}
                        </div>
                        
                        {isLocked ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-250/20 flex items-center gap-0.5">
                            🔒 Premium Locked
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
                            Client Exclusive
                          </span>
                        )}
                      </div>
                      
                      <h4 className="text-xs font-bold text-slate-800 dark:text-gray-100">{opp.title}</h4>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">{opp.buyer}</p>
                      
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-850 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-800">
                          {categories.major}
                        </span>
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-850 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-800">
                          {categories.minor}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] p-2.5 rounded-lg bg-white dark:bg-gray-955 border border-slate-200 dark:border-gray-800/85 font-bold">
                      <div>
                        <span className="text-slate-400 dark:text-gray-500 block text-[10px]">Deadline</span>
                        <span className="font-bold text-amber-600 dark:text-amber-300 mono flex items-center gap-1">
                          <Clock size={11} /> {opp.deadline}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 dark:text-gray-500 block text-[10px]">Est. Value</span>
                        {opp.estimatedValue ? (
                          <span className="font-bold text-slate-900 dark:text-white mono">{opp.estimatedValue}</span>
                        ) : (
                          <span className="text-[10px] italic text-slate-400 dark:text-gray-500">Not Disclosed</span>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 dark:text-gray-400">
                        Location: <span className="text-slate-800 dark:text-gray-300 font-medium">{opp.deliveryLocation.split('/')[0]}</span>
                      </span>
                      
                      <div className="flex gap-2">
                        {/* Download RFQ on Email */}
                        <button
                          onClick={() => handleDownloadRfq(opp)}
                          className="btn btn-secondary btn-xs p-1.5 flex items-center justify-center gap-1 border border-slate-200 text-slate-700 dark:text-gray-355 hover:border-slate-300"
                          title="Download RFQ Technical BOQ Spreadsheet on Email"
                        >
                          <Mail size={12} className="text-indigo-650 dark:text-indigo-400" />
                          <span>Download RFQ</span>
                        </button>

                        {isLocked && (
                          <button
                            onClick={() => setShowUpgradeModal(true)}
                            className="btn btn-amber btn-xs font-bold flex items-center gap-1 py-1.5 px-3 text-[11px]"
                          >
                            <span>🔒 Upgrade</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* SECTION 2: PROCUCEV NETWORK OPPORTUNITIES (OPEN MARKETPLACE) */}
        {/* ========================================================================= */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Building size={18} className="text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                PROCUCEV NETWORK OPPORTUNITIES (OPEN MARKETPLACE)
              </h3>
            </div>
            <span className="badge badge-emerald">Open Discovery</span>
          </div>

          {/* Independent Filter Area: Network Opportunities / Marketplace (Buyer filter removed as not applicable) */}
          <div className="bg-slate-50/50 dark:bg-gray-950/20 p-4 rounded-xl border border-slate-200/60 dark:border-gray-850 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-bold text-slate-700 dark:text-gray-300">
              <div className="flex items-center gap-1.5">
                <Building size={14} className="text-emerald-500" />
                <span>Open Sourcing Network & Marketplace Filters:</span>
              </div>

              {/* Bidirectional Cross-Highlight Summary Filter Button */}
              <button
                type="button"
                onClick={() => setFilterCatalogueMatchesNet(!filterCatalogueMatchesNet)}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border shadow-sm cursor-pointer ${
                  filterCatalogueMatchesNet
                    ? 'bg-violet-600 text-white border-violet-500 ring-2 ring-violet-400/30'
                    : 'bg-violet-50/80 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40 hover:bg-violet-100'
                }`}
                title="Click to filter only marketplace RFQs matching items in your vendor catalogue"
              >
                <Package size={13} />
                <span>📦 Summary: {netCatalogueMatchesCount} Catalogue Match{netCatalogueMatchesCount !== 1 ? 'es' : ''}</span>
                {filterCatalogueMatchesNet ? (
                  <span className="text-[9px] bg-white/25 text-white px-1.5 py-0.25 rounded font-black uppercase">Filtered (Click to show all)</span>
                ) : (
                  <span className="text-[9px] bg-violet-200/60 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200 px-1.5 py-0.25 rounded font-bold">Filter RFQs</span>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
              {/* Major Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Major Category</span>
                <select
                  value={selectedMajorCategoryNet}
                  onChange={(e) => {
                    setSelectedMajorCategoryNet(e.target.value);
                    setSelectedMinorCategoryNet('all'); 
                  }}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">🌐 All Major Categories</option>
                  <option value="Mechanical & Fluid Equipment">⚙️ Mechanical & Fluid</option>
                  <option value="Building & Infrastructure">🏢 Building & Infra</option>
                </select>
              </div>

              {/* Minor Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Minor Category</span>
                <select
                  value={selectedMinorCategoryNet}
                  onChange={(e) => setSelectedMinorCategoryNet(e.target.value)}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                  disabled={selectedMajorCategoryNet === 'all'}
                >
                  {selectedMajorCategoryNet === 'all' ? (
                    <option value="all">Select Major First</option>
                  ) : selectedMajorCategoryNet === 'Mechanical & Fluid Equipment' ? (
                    <>
                      <option value="all">All Mechanical & Fluid</option>
                      <option value="Pumps & Valves">⚙️ Pumps & Valves</option>
                      <option value="Structural Steel & Beams">🏗️ Structural Steel</option>
                    </>
                  ) : (
                    <>
                      <option value="all">All Building & Infra</option>
                      <option value="Building Automation & HVAC">❄️ HVAC Control</option>
                    </>
                  )}
                </select>
              </div>

              {/* Sourcing Intelligence Search Bar */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-405">Search Specs</span>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-slate-400">
                    <Search size={12} />
                  </span>
                  <input
                    type="text"
                    placeholder="Specs, location, keywords..."
                    value={rfqSearchTermNet}
                    onChange={(e) => setRfqSearchTermNet(e.target.value)}
                    className="input pl-7 py-1 text-[11px] w-full bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {networkOpps.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No matching open network opportunities found for this selection.
              </div>
            ) : (
              networkOpps.map((opp) => {
                const isLocked = !isOwnBuyerRfq(opp.rfqNumber) && vendorSubscription === 'premium';
                const categories = getOpportunityCategories(opp);
                const isCategoryMatch = categories.minor === 'Pumps & Valves' || categories.major === 'Mechanical & Fluid Equipment';
                const catalogueMatches = getCatalogueMatchesForRfq(opp);
                const hasCatalogueMatch = catalogueMatches.length > 0;

                return (
                  <div
                    key={opp.id}
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs transition-all ${
                      isLocked
                        ? 'bg-slate-100/50 dark:bg-gray-950/20 border-slate-200 dark:border-gray-900'
                        : isCategoryMatch
                        ? 'bg-emerald-50/10 dark:bg-emerald-950/10 border-emerald-300 dark:border-emerald-700/50 hover:border-emerald-500 shadow-sm shadow-emerald-500/5'
                        : 'bg-slate-50 dark:bg-gray-900/80 border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-white mono">{opp.rfqNumber}</span>
                        {isCategoryMatch && (
                          <span className="px-1.5 py-0.25 rounded text-[8px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 flex items-center gap-0.5 animate-pulse shrink-0">
                            ⚡ Primary Category Match
                          </span>
                        )}
                        {hasCatalogueMatch && (
                          <span
                            className="px-1.5 py-0.25 rounded text-[8px] font-black bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/40 flex items-center gap-0.5 shrink-0"
                            title={`Matching products: ${catalogueMatches.map((p: any) => p.sku).join(', ')}`}
                          >
                            <Package size={9} /> {catalogueMatches.length} Catalogue Match{catalogueMatches.length > 1 ? 'es' : ''}
                          </span>
                        )}
                        {isLocked ? (
                          <span className="px-1.5 py-0.25 rounded text-[8px] font-extrabold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-250/20 flex items-center gap-0.5">
                            🔒 Premium Locked
                          </span>
                        ) : (
                          <span className="badge badge-purple text-[10px]">Open Network</span>
                        )}
                      </div>
                      
                      <h4 className="font-semibold text-slate-800 dark:text-gray-200 text-xs">{opp.title}</h4>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        Delivery: <span className="text-slate-700 dark:text-gray-300">{opp.deliveryLocation}</span>{opp.estimatedValue && (<> • Value: <span className="mono text-emerald-600 dark:text-emerald-400 font-bold">{opp.estimatedValue}</span></>)}
                      </p>

                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-850 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-850">
                          {categories.major}
                        </span>
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-855 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-855">
                          {categories.minor}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto font-bold text-slate-900 dark:text-white">
                      <div className="text-right text-[11px] text-slate-500 dark:text-gray-450 hidden sm:block">
                        <span>Deadline: {opp.deadline}</span>
                      </div>

                      <div className="flex gap-2">
                        {/* Download RFQ on Email */}
                        <button
                          onClick={() => handleDownloadRfq(opp)}
                          className="btn btn-secondary btn-xs p-1.5 flex items-center justify-center gap-1 border border-slate-200 text-slate-700 dark:text-gray-355 hover:border-slate-300"
                          title="Download RFQ Technical BOQ Spreadsheet on Email"
                        >
                          <Mail size={12} className="text-indigo-650 dark:text-indigo-400" />
                          <span>Download RFQ</span>
                        </button>

                        {isLocked && (
                          <button
                            onClick={() => setShowUpgradeModal(true)}
                            className="btn btn-amber btn-xs font-bold flex items-center gap-1 py-1.5 px-3 text-[11px]"
                          >
                            <span>🔒 Upgrade</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* VENDOR PREMIUM SUBSCRIPTION UPGRADE MODAL */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 text-xs text-slate-800 dark:text-gray-250 animate-scale-up">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Zap size={18} className="text-orange-500 animate-pulse" />
                  Upgrade to Premium Sourcing Plan
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Ingest specifications, download buyer BOQ spreadsheets, and submit quotes.
                </p>
              </div>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="text-slate-450 hover:text-slate-600 dark:hover:text-white font-extrabold text-sm border-none bg-transparent cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Current Context Alert */}
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-955/40 text-amber-800 dark:text-amber-300 border border-amber-250/20 leading-relaxed">
              ⚠️ <strong>Roster Account Limit</strong>: Your vendor profile was uploaded by <strong>Larsen & Toubro Ltd. (L&T)</strong>. Bidding or downloading technical specs for other buyers is restricted.
            </div>

            {/* Plan Options */}
            <div className="space-y-3">
              {/* Option 1: Premium */}
              <div className={`p-3 rounded-2xl border-2 flex justify-between items-center ${
                vendorSubscription === 'premium' ? 'border-emerald-500 bg-emerald-50/10' : 'border-slate-200 dark:border-gray-800'
              }`}>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">Premium Model (Client Uploaded)</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Free with Buyer Upload. Unlimited direct buyer RFQs.</p>
                </div>
                {vendorSubscription === 'premium' ? (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    onClick={() => {
                      setVendorSubscription('premium');
                      setShowUpgradeModal(false);
                      showToast('Premium Model Selected', 'Client Uploaded Vendor Premium Plan active.', 'info');
                    }}
                    className="btn btn-secondary text-[10px] font-bold py-1 px-2.5"
                  >
                    Select
                  </button>
                )}
              </div>

              {/* Option 2: Connect */}
              <div className={`p-3 rounded-2xl border-2 flex justify-between items-center relative ${
                vendorSubscription === 'connect' ? 'border-indigo-500 bg-indigo-50/10' : 'border-indigo-200 dark:border-indigo-900/60'
              }`}>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-xs flex items-center gap-1">
                    Connect Model ($149 / 3 mo)
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Download up to 50 RFQs in 3 months from Marketplace.</p>
                </div>
                {vendorSubscription === 'connect' ? (
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    onClick={() => {
                      setVendorSubscription('connect');
                      setShowUpgradeModal(false);
                      showToast('Connect Plan Activated!', 'Download up to 50 RFQs in 3 months.', 'success');
                      addAuditLog('Apex Supplies upgraded to Connect Model Plan', 'VN-APEX-4920', 'vendor@apex.com');
                    }}
                    className="btn btn-primary text-[10px] font-bold py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700"
                  >
                    Upgrade
                  </button>
                )}
              </div>

              {/* Option 3: Select */}
              <div className={`p-3 rounded-2xl border-2 flex justify-between items-center relative ${
                vendorSubscription === 'select' ? 'border-purple-500 bg-purple-50/10' : 'border-purple-200 dark:border-purple-900/60'
              }`}>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-xs flex items-center gap-1">
                    Select Model ($349 / 3 mo)
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Item Catalogue (100 products) + 100 RFQs / 3 months.</p>
                </div>
                {vendorSubscription === 'select' ? (
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-100 dark:bg-purple-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    onClick={() => {
                      setVendorSubscription('select');
                      setShowUpgradeModal(false);
                      showToast('Select Plan Activated!', 'Item Catalogue created & 100 RFQs/3mo unlocked.', 'success');
                      addAuditLog('Apex Supplies upgraded to Select Model Plan', 'VN-APEX-4920', 'vendor@apex.com');
                    }}
                    className="btn btn-primary text-[10px] font-bold py-1 px-2.5 bg-purple-600 hover:bg-purple-700"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
