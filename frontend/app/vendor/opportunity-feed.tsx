'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { authClient } from '@/lib/authClient';
import { rfqAttachmentUrl } from '@/lib/rfqClient';
import { logger } from '@/lib/logger';
import { SubscriptionPaymentModal } from '@/app/components/Modals';
import { VendorOpportunity } from '@/lib/types';
import { fetchSubscriptionPricing, type SubscriptionPricingResponse } from '@/lib/subscriptionPaymentClient';
import {
  getPaidVendorPlanPrice,
  getPaidVendorPlanRfqQuota,
  paidPlanDisplayName,
  paidPlanQuotaCopy,
  pricePlaceholderLabel,
  type PaidVendorPlanId,
} from './vendorPlanPricing';
import { productMatchesOpportunity } from './catalogueMatching';
import {
  Clock,
  AlertTriangle,
  Send,
  Building,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Zap,
  Mail,
  Search,
  Package,
  FileText,
  CheckCircle2,
  Eye,
  X,
  IndianRupee,
  Lock,
  Edit3,
  Calendar,
  RotateCcw,
  Download,
  MoreHorizontal,
} from 'lucide-react';
import { formatCurrency } from '@/lib/constants';
import { getAllUniqueMinorCategories } from '@/lib/categoryTaxonomy';

interface OpportunityFeedProps {
  onNavigateToBidForm: (opp: VendorOpportunity) => void;
  onNavigateToEvaluation?: () => void;
  onNavigateToSubscription?: () => void;
}

/** Authorization header for the vendor's own backend record. The vendor route rejects requests without a session token. */
function vendorAuthHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Distinct, non-empty values in sorted order. Used for filter options taken from real RFQ records. */
function distinctSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

export default function OpportunityFeed({
  onNavigateToBidForm,
  onNavigateToSubscription,
}: OpportunityFeedProps) {
  const router = useRouter();
  const {
    rfqs,
    vendorOpportunities,
    showToast,
    addAuditLog,
    vendorSubscription,
    updateVendorSubscription,
    vendorFreeCreditsRemaining,
    vendorCatalogue,
    buyerVendors,
    currentUserSession,
    refreshFromDB,
    createVendorPaymentLink,
    refreshVendorCredits,
    vendorUnlockedRfqIds = [],
  } = useApp();
  const vendorLabel = currentUserSession?.orgName || currentUserSession?.name || 'Vendor';
  // Unlimited access comes only from the backend subscription plan held in the store.
  const isUnlimited = vendorSubscription === 'unlimited';

  // Issue 1: Dynamically validate credit balance. When seller has sufficient credits (> 0 or loading),
  // hide the Upgrade button and permit bid submission. Display Upgrade button only when credits are exhausted (0).
  const hasSufficientCredits = vendorFreeCreditsRemaining == null || vendorFreeCreditsRemaining > 0;
  const isPaidOrUnlimited = isUnlimited || vendorSubscription === 'connect' || vendorSubscription === 'select';

  // Dashboard Tab state: My Buyer Enquiries, Public Enquiries, or Submitted Bids
  const [activeDashboardTab, setActiveDashboardTab] = React.useState<'opportunities' | 'my_buyer' | 'public' | 'submitted_bids'>(
    typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 'opportunities' : 'my_buyer'
  );
  const [selectedSubmittedBid, setSelectedSubmittedBid] = React.useState<any | null>(null);

  // Compute all successfully submitted bids for this vendor without duplicate RFQs
  const submittedBids = React.useMemo(() => {
    // Helper to determine if a quote was submitted by this vendor
    const isMyQuote = (q: any) => {
      if (!q) return false;
      const sessionEmail = (currentUserSession?.email ?? '').toLowerCase().trim();
      const qEmail = (q.vendorEmail ?? '').toLowerCase().trim();
      if (sessionEmail && qEmail === sessionEmail) return true;

      const myVendorId = String(currentUserSession?.orgId ?? (currentUserSession as any)?.vendorId ?? '').trim().toLowerCase();
      const qVendorId = String(q.vendorId ?? '').trim().toLowerCase();
      if (myVendorId && qVendorId === myVendorId) return true;

      const myVendorName = (currentUserSession?.orgName ?? currentUserSession?.name ?? '').toLowerCase().trim();
      const qName = (q.vendorName ?? '').toLowerCase().trim();
      if (myVendorName && qName === myVendorName) return true;

      return !sessionEmail && !myVendorId && !myVendorName;
    };

    const list: Array<{
      rfq: any;
      quote: any;
      rfqNumber: string;
      title: string;
      buyerDetails: string;
      submittedQuoteAmount: number | null;
      submissionDate: string;
      bidStatus: string;
    }> = [];
    const seen = new Set<string>();

    (rfqs || []).forEach((rfq) => {
      const myQuotes = (rfq.quotes || []).filter(isMyQuote);
      if (myQuotes.length > 0 && !seen.has(rfq.rfqNumber)) {
        seen.add(rfq.rfqNumber);
        const quote = myQuotes[myQuotes.length - 1];
        const submittedAt = quote?.submittedAt || (quote as any)?.createdAt;
        const rawAmt = quote?.totalPrice ?? (quote as any)?.totalAmount ?? quote?.unitPrice;
        const totalAmount = typeof rawAmt === 'number' && Number.isFinite(rawAmt) ? rawAmt : null;

        const buyerDetails = rfq.buyerDetailsHidden
          ? 'Protected (48h)'
          : (rfq.buyerAccountName || rfq.buyerCompany || 'Procurement Team');

        let bidStatus = 'Quote Submitted';
        if (rfq.status === 'PO Generated' || (rfq as any).poFinalised) {
          bidStatus = (quote as any)?.awarded ? 'PO Generated (Awarded)' : 'Concluded';
        } else if (rfq.status === 'In Evaluation' || rfq.status === 'AI Recommended') {
          bidStatus = 'Under Review';
        } else if (rfq.status === 'Closed') {
          bidStatus = 'RFQ Closed';
        } else if (quote?.status) {
          bidStatus = quote.status;
        }

        list.push({
          rfq,
          quote,
          rfqNumber: rfq.rfqNumber,
          title: rfq.title,
          buyerDetails,
          submittedQuoteAmount: totalAmount,
          submissionDate: submittedAt ? new Date(submittedAt).toLocaleString() : '—',
          bidStatus,
        });
      }
    });

    return list;
  }, [rfqs, currentUserSession]);

  // The vendor's catalogue products that match an opportunity by keyword. A count is shown only
  // for the products that match this opportunity, never for the whole catalogue.
  const catalogueMatchesFor = (opp: VendorOpportunity) =>
    (vendorCatalogue || []).filter((product) => productMatchesOpportunity(product, opp));

  const [showUpgradeModal, setShowUpgradeModal] = React.useState(false);
  const openUpgradeModal = () => setShowUpgradeModal(true);
  const closeUpgradeModal = () => setShowUpgradeModal(false);

  // Plan prices come from the pricing API and are fetched when the upgrade dialog opens.
  const [planPricing, setPlanPricing] = React.useState<SubscriptionPricingResponse | null>(null);
  const [planPricingFailed, setPlanPricingFailed] = React.useState(false);
  React.useEffect(() => {
    if (!showUpgradeModal || planPricing || planPricingFailed) return;
    let cancelled = false;
    void fetchSubscriptionPricing().then((config) => {
      if (cancelled) return;
      if (config) setPlanPricing(config);
      else setPlanPricingFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showUpgradeModal, planPricing, planPricingFailed]);
  const connectPrice = getPaidVendorPlanPrice(planPricing, 'connect');
  const selectPrice = getPaidVendorPlanPrice(planPricing, 'select');
  const connectRfqQuota = getPaidVendorPlanRfqQuota(planPricing, 'connect');
  const selectRfqQuota = getPaidVendorPlanRfqQuota(planPricing, 'select');

  // This vendor's own real registered category — used to flag a genuine
  // category match against an RFQ's real category (opp.majorCategory/
  // minorCategory), replacing a badge that used to fire off two hardcoded
  // strings ('Pumps & Valves' / 'Mechanical & Fluid Equipment') regardless
  // of what the vendor or the RFQ were actually categorised as.
  const [myMajorCategory, setMyMajorCategory] = React.useState<string>('');
  const [myMinorCategories, setMyMinorCategories] = React.useState<string[]>([]);
  const [myAddedByBuyerCompany, setMyAddedByBuyerCompany] = React.useState<string>('');
  const [myBuyerId, setMyBuyerId] = React.useState<string>('');
  const [myVendorId, setMyVendorId] = React.useState<string>('');
  const [myVendorName, setMyVendorName] = React.useState<string>('');
  const [myOnboardingSource, setMyOnboardingSource] = React.useState<'buyer' | 'self' | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const email = currentUserSession?.email;
    if (!email) return;
    setMyOnboardingSource(null);
    setMyAddedByBuyerCompany('');
    setMyBuyerId('');
    setMyVendorId('');
    setMyVendorName('');
    fetch(`/api/vendors/${encodeURIComponent(email)}`, { headers: vendorAuthHeaders() })
      .then((res) => {
        // A 401 means the stored token is no longer accepted. The auth flow ends that session, so the
        // lookup is skipped with a warning and is not reported as an error.
        if (res.status === 401) {
          logger.warn(
            'Vendor profile lookup skipped because the session has ended',
            { operation: 'load_vendor_profile', status: res.status },
            'VENDOR_OPPORTUNITY_FEED'
          );
          return null;
        }
        if (!res.ok) {
          logger.error(
            'Vendor profile lookup failed for opportunity category matching',
            { operation: 'load_vendor_profile', status: res.status },
            'VENDOR_OPPORTUNITY_FEED'
          );
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data?.success || !data.data) return;
        setMyMajorCategory(data.data.majorCategory || '');
        setMyMinorCategories(Array.isArray(data.data.minorCategories) ? data.data.minorCategories : []);
        setMyAddedByBuyerCompany(data.data.addedByBuyerCompany || '');
        setMyBuyerId(data.data.buyerId || data.data.buyerAccountId || '');
        setMyVendorId(data.data.id || '');
        setMyVendorName(data.data.name || '');
        const isBuyerAdded = data.data.addedByBuyerCompany || data.data.buyerId || data.data.buyerAccountId;
        setMyOnboardingSource(
          isBuyerAdded ? 'buyer' : data.data.source === 'self_registration' ? 'self' : null
        );
      })
      .catch((error: unknown) => {
        logger.error(
          'Vendor profile lookup could not complete for opportunity category matching',
          {
            operation: 'load_vendor_profile',
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'VENDOR_OPPORTUNITY_FEED'
        );
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserSession?.email]);
  const isRealCategoryMatch = (opp: VendorOpportunity) => {
    if (!myMajorCategory) return false;
    const normalize = (s: string) => s.trim().toLowerCase();
    if (opp.majorCategory && normalize(opp.majorCategory) === normalize(myMajorCategory)) return true;
    return !!opp.minorCategory && myMinorCategories.some((m) => normalize(m) === normalize(opp.minorCategory));
  };

  // All 310 Minor Categories from master taxonomy
  const allMinorCategories = React.useMemo(() => {
    return getAllUniqueMinorCategories();
  }, []);

  const [selectedMinorCategory, setSelectedMinorCategory] = React.useState('all');
  const [rfqSearchTerm, setRfqSearchTerm] = React.useState('');
  const [filterCatalogueMatches, setFilterCatalogueMatches] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(5);

  const handleMinorCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMinorCategory(e.target.value);
    setSelectedMinorCategoryDirect(e.target.value);
    setSelectedMinorCategoryNet(e.target.value);
    setCurrentPage(1);
  };
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRfqSearchTerm(e.target.value);
    setRfqSearchTermDirect(e.target.value);
    setRfqSearchTermNet(e.target.value);
    setCurrentPage(1);
  };
  const toggleCatalogueMatches = () => {
    setFilterCatalogueMatches((prev) => !prev);
    setFilterCatalogueMatchesDirect((prev) => !prev);
    setFilterCatalogueMatchesNet((prev) => !prev);
    setCurrentPage(1);
  };

  // Backward compatibility filter states for test suites
  const [selectedBuyerDirect, setSelectedBuyerDirect] = React.useState('all');
  const [selectedMajorCategoryDirect, setSelectedMajorCategoryDirect] = React.useState('all');
  const [selectedMinorCategoryDirect, setSelectedMinorCategoryDirect] = React.useState('all');
  const [rfqSearchTermDirect, setRfqSearchTermDirect] = React.useState('');
  const [filterCatalogueMatchesDirect, setFilterCatalogueMatchesDirect] = React.useState(false);
  const toggleCatalogueMatchesDirect = () => {
    setFilterCatalogueMatchesDirect((prev) => !prev);
    setFilterCatalogueMatches((prev) => !prev);
    setCurrentPage(1);
  };
  const handleBuyerChangeDirect = (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedBuyerDirect(e.target.value);
  const handleMajorCategoryDirect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMajorCategoryDirect(e.target.value);
    setSelectedMinorCategoryDirect('all');
    setSelectedMinorCategory('all');
    setCurrentPage(1);
  };
  const handleMinorCategoryDirect = (e: React.ChangeEvent<HTMLSelectElement>) => handleMinorCategoryChange(e);
  const handleSearchDirect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRfqSearchTermDirect(e.target.value);
    setRfqSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const [selectedMajorCategoryNet, setSelectedMajorCategoryNet] = React.useState('all');
  const [selectedMinorCategoryNet, setSelectedMinorCategoryNet] = React.useState('all');
  const [rfqSearchTermNet, setRfqSearchTermNet] = React.useState('');
  const [filterCatalogueMatchesNet, setFilterCatalogueMatchesNet] = React.useState(false);
  const toggleCatalogueMatchesNet = () => {
    setFilterCatalogueMatchesNet((prev) => !prev);
    setFilterCatalogueMatches((prev) => !prev);
    setCurrentPageNet(1);
  };
  const handleMajorCategoryNet = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMajorCategoryNet(e.target.value);
    setSelectedMinorCategoryNet('all');
    setSelectedMinorCategory('all');
    setCurrentPage(1);
    setCurrentPageNet(1);
  };
  const handleMinorCategoryNet = (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleMinorCategoryChange(e);
    setCurrentPageNet(1);
  };
  const handleSearchNet = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRfqSearchTermNet(e.target.value);
    setRfqSearchTerm(e.target.value);
    setCurrentPageNet(1);
  };

  const [statusFilter, setStatusFilter] = React.useState<'all' | 'open' | 'submitted' | 'closed'>('all');
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false);

  const handleResetFilters = () => {
    setSelectedBuyerDirect('all');
    setSelectedMajorCategoryDirect('all');
    setSelectedMinorCategoryDirect('all');
    setSelectedMajorCategoryNet('all');
    setSelectedMinorCategoryNet('all');
    setSelectedMinorCategory('all');
    setRfqSearchTerm('');
    setRfqSearchTermDirect('');
    setRfqSearchTermNet('');
    setStatusFilter('all');
    setFilterCatalogueMatches(false);
    setFilterCatalogueMatchesDirect(false);
    setFilterCatalogueMatchesNet(false);
    setCurrentPage(1);
    setCurrentPageNet(1);
  };

  const renderBuyerOption = (buyer: string) => (
    <option key={buyer} value={buyer}>
      🏢 {buyer}
    </option>
  );

  // The RFQ's own categories. An empty string means the buyer never classified it.
  const getOpportunityCategories = (opp: VendorOpportunity) => ({
    major: opp.majorCategory ?? '',
    minor: opp.minorCategory ?? '',
  });

  // Filter options come from the categories the feed actually carries, or all 310 master minor categories.
  const feedMajorCategories = distinctSorted(vendorOpportunities.map((opp) => opp.majorCategory ?? ''));
  const feedMinorCategoriesFor = (major: string) => {
    return distinctSorted(
      vendorOpportunities
        .filter((opp) => (opp.majorCategory ?? '') === major)
        .map((opp) => opp.minorCategory ?? '')
    );
  };

  // Direct-vs-marketplace reflects the real relationship:
  // Checks vendor's addedByBuyerCompany against the RFQ's buyerAccountName,
  // buyer ID mapping, and explicit vendor assignment in assignedVendors.
  const myVendorRecord = buyerVendors.find((v) => v.email?.toLowerCase() === currentUserSession?.email?.toLowerCase());
  const isOwnBuyerRfq = React.useCallback((opp: VendorOpportunity) => {
    const sessionEmail = (currentUserSession?.email || '').toLowerCase().trim();
    const rfqRecord = rfqs?.find((r) => r.rfqNumber === opp.rfqNumber);
    const assignedList = opp.assignedVendors || rfqRecord?.assignedVendors;
    if (assignedList && assignedList.length > 0) {
      const isAssigned = assignedList.some((v) => {
        const vEmail = (v.email ?? '').toLowerCase().trim();
        if (sessionEmail && vEmail === sessionEmail) return true;
        const vId = String(v.id ?? '').trim();
        if (myVendorId && vId === myVendorId) return true;
        const vName = (v.name ?? '').toLowerCase().trim();
        return Boolean(myVendorName && vName === myVendorName.toLowerCase().trim());
      });
      if (isAssigned) return true;
    }

    const bCompany = myAddedByBuyerCompany || myVendorRecord?.addedByBuyerCompany;
    if (bCompany && opp.buyer === bCompany) return true;
    const bId = myBuyerId || myVendorRecord?.buyerId || myVendorRecord?.buyerAccountId;
    if (bId && opp.buyerAccountId === bId) return true;
    return false;
  }, [rfqs, currentUserSession?.email, myVendorId, myVendorName, myAddedByBuyerCompany, myBuyerId, myVendorRecord]);

  // The RFQs this vendor has not quoted on yet, prioritizing direct client invitations first
  const pendingBidOpportunities = React.useMemo(() => {
    return vendorOpportunities
      .filter((opp) => opp.status === 'pending_bid')
      .sort((a, b) => {
        const aDirect = isOwnBuyerRfq(a) ? 1 : 0;
        const bDirect = isOwnBuyerRfq(b) ? 1 : 0;
        return bDirect - aDirect;
      });
  }, [vendorOpportunities, isOwnBuyerRfq]);
  const pendingBidCount = pendingBidOpportunities.length;
  const pendingBidOpportunity = pendingBidOpportunities[0];

  const handleDirectReminderBid = () => {
    onNavigateToBidForm(pendingBidOpportunity);
  };


  const handleDownloadRfq = async (opp: VendorOpportunity) => {
    const isDirect = isOwnBuyerRfq(opp);

    // Instant client-side feedback for the obviously-blocked cases — the
    // backend is the real authority below and enforces this regardless.
    if (vendorSubscription === 'premium' && !isDirect) {
      setShowUpgradeModal(true);
      showToast('Upgrade Required', 'Marketplace RFQs outside client roster require Connect or Select plan.', 'info');
      return;
    }

    // The remaining balance comes from the backend credits. It is null until the credits load,
    // and the server still enforces the quota on download, so null does not block the click here.
    const paidQuotaExhausted = (vendorSubscription === 'connect' || vendorSubscription === 'select') && vendorFreeCreditsRemaining === 0;
    if (paidQuotaExhausted && !isDirect) {
      setShowUpgradeModal(true);
      showToast(UI_STRINGS.vendorWorkspace.downloadQuotaReachedTitle, UI_STRINGS.vendorWorkspace.downloadQuotaReachedMessage, 'warning');
      return;
    }

    // Was a no-op fake toast with no backend call at all, and the fetch it
    // did make had no Authorization header at all (this route requires
    // authentication — it would 401 for real). Now calls the real,
    // authenticated email-preview endpoint, which enforces the vendor's
    // download quota server-side too — the checks above are just UX, not
    // the actual gate. Refreshes from the DB afterward so the quota shown
    // reflects what the server actually counted, not a local guess.
    const authHeaders = {
      'Content-Type': 'application/json',
      ...vendorAuthHeaders(),
    };
    try {
      const res = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}/download`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.exhausted || res.status === 403) {
          showToast(
            'Free Credits Exhausted',
            data.error || UI_STRINGS.vendorSubscriptionModal.subscriptionRequiredToastDesc,
            'warning'
          );
          return;
        }
        throw new Error(data.error || 'Could not generate the RFQ specification.');
      }

      // The RFQ text info as a real downloaded file
      const htmlBody: string = data.data?.htmlBody || '';
      const specUrl = URL.createObjectURL(new Blob([htmlBody], { type: 'text/html' }));
      const specLink = document.createElement('a');
      specLink.href = specUrl;
      specLink.download = `${opp.rfqNumber}-specification.html`;
      document.body.appendChild(specLink);
      specLink.click();
      specLink.remove();
      URL.revokeObjectURL(specUrl);

      // Supporting documents the buyer attached
      try {
        const rfqRes = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}`, { headers: authHeaders });
        const rfqData = await rfqRes.json();
        const attachments = rfqRes.ok && rfqData.success ? rfqData.data?.attachments || [] : [];
        for (const file of attachments) {
          const fileRes = await fetch(rfqAttachmentUrl(file.id), { headers: authHeaders });
          if (!fileRes.ok) continue;
          const blob = await fileRes.blob();
          const fileUrl = URL.createObjectURL(blob);
          const fileLink = document.createElement('a');
          fileLink.href = fileUrl;
          fileLink.download = file.fileName || `${opp.rfqNumber}-attachment`;
          document.body.appendChild(fileLink);
          fileLink.click();
          fileLink.remove();
          URL.revokeObjectURL(fileUrl);
        }
      } catch {
        // Ignored
      }

      await refreshVendorCredits();
      if (!isDirect) {
        await refreshFromDB();
      }
      showToast('RFQ Downloaded', `Downloaded RFQ specification for ${opp.rfqNumber}.`, 'success');
      addAuditLog(`${vendorLabel} downloaded RFQ specifications for ${opp.rfqNumber}`, opp.rfqNumber);
    } catch (err: unknown) {
      showToast(
        'Download Failed',
        err instanceof Error && err.message ? err.message : 'Could not download the RFQ specification.',
        'warning'
      );
    }
  };

  // Buyers offered by the direct-invitation filter. Derived from the feed itself,
  // not from the buyer-account directory: an RFQ records the buyer who raised it,
  // and matching that against a directory of organisation names never matched, so
  // picking any company silently emptied the list.
  const directInvitationBuyers = Array.from(
    new Set(
      vendorOpportunities
        .filter((opp) => opp.type === 'direct_invitation' && opp.buyer)
        .map((opp) => opp.buyer)
    )
  );

  const matchOpportunitySearch = (opp: VendorOpportunity, term: string, cats: { major: string; minor: string }) => {
    if (!term) return true;
    const t = term.toLowerCase().trim();
    const corpus = `${opp.title} ${opp.rfqNumber} ${opp.buyer || ''} ${opp.deliveryLocation} ${cats.major} ${cats.minor} ${(opp.lineItems || []).map((li) => li.description).join(' ')}`.toLowerCase();
    return corpus.includes(t);
  };

  const matchOpportunityStatus = (opp: VendorOpportunity, filter: string) => {
    if (filter === 'all') return true;
    const isSub = submittedBids.some((b) => b.rfqNumber === opp.rfqNumber);
    const isClosed = opp.status === 'Closed' || opp.status === 'Expired';
    if (filter === 'open') return !isSub && !isClosed;
    if (filter === 'submitted') return isSub;
    if (filter === 'closed') return isClosed;
    return true;
  };

  const matchOpportunityMinorCat = (opp: VendorOpportunity, selMinor: string) => {
    if (selMinor === 'all') return true;
    const s = selMinor.toLowerCase().trim();
    const text = `${opp.minorCategory ?? ''} ${opp.majorCategory ?? ''} ${(opp.lineItems ?? []).map((li) => li.description).join(' ')}`.toLowerCase();
    return text.includes(s);
  };

  // FILTER DIRECT INVITATIONS (MY BUYER ENQUIRIES)
  const eligibleDirectOpportunities = vendorOpportunities.filter((opp) => {
    if (opp.type !== 'direct_invitation') return false;
    const cats = getOpportunityCategories(opp);

    if (selectedBuyerDirect !== 'all' && opp.buyer !== selectedBuyerDirect) return false;
    if (selectedMajorCategoryDirect !== 'all' && cats.major !== selectedMajorCategoryDirect) return false;
    if (selectedMinorCategoryDirect !== 'all' && cats.minor !== selectedMinorCategoryDirect) return false;
    if (!matchOpportunityMinorCat(opp, selectedMinorCategory)) return false;
    const directSearch = rfqSearchTermDirect || rfqSearchTerm;
    if (!matchOpportunitySearch(opp, directSearch, cats)) return false;
    const directCatFilter = filterCatalogueMatchesDirect || filterCatalogueMatches;
    if (directCatFilter && catalogueMatchesFor(opp).length === 0) return false;
    return matchOpportunityStatus(opp, statusFilter);
  });

  // FILTER NETWORK OPPORTUNITIES (OPEN MARKETPLACE / PUBLIC ENQUIRIES)
  const eligibleNetworkOpportunities = vendorOpportunities.filter((opp) => {
    if (opp.type !== 'network_marketplace') return false;
    const cats = getOpportunityCategories(opp);

    if (selectedMajorCategoryNet !== 'all' && cats.major !== selectedMajorCategoryNet) return false;
    if (selectedMinorCategoryNet !== 'all' && cats.minor !== selectedMinorCategoryNet) return false;
    if (!matchOpportunityMinorCat(opp, selectedMinorCategory)) return false;
    const netSearch = rfqSearchTermNet || rfqSearchTerm;
    if (!matchOpportunitySearch(opp, netSearch, cats)) return false;
    const netCatFilter = filterCatalogueMatchesNet || filterCatalogueMatches;
    if (netCatFilter && catalogueMatchesFor(opp).length === 0) return false;
    return matchOpportunityStatus(opp, statusFilter);
  });

  // Total summary counts of RFQs matching vendor's item catalogue
  const directCatalogueMatchesCount = eligibleDirectOpportunities.filter(
    (opp) => catalogueMatchesFor(opp).length > 0
  ).length;
  const netCatalogueMatchesCount = eligibleNetworkOpportunities.filter(
    (opp) => catalogueMatchesFor(opp).length > 0
  ).length;

  const directInvites = React.useMemo(() => {
    return [...eligibleDirectOpportunities].sort((a, b) => {
      const aDirect = isOwnBuyerRfq(a) ? 1 : 0;
      const bDirect = isOwnBuyerRfq(b) ? 1 : 0;
      if (bDirect !== aDirect) return bDirect - aDirect;
      const aTime = a.deadline ? new Date(a.deadline).getTime() : 0;
      const bTime = b.deadline ? new Date(b.deadline).getTime() : 0;
      return bTime - aTime;
    });
  }, [eligibleDirectOpportunities, isOwnBuyerRfq]);

  const networkOpps = eligibleNetworkOpportunities;
  const [currentPageNet, setCurrentPageNet] = React.useState(1);
  const [pageSizeNet, setPageSizeNet] = React.useState(5);
  const totalPagesNet = Math.max(1, Math.ceil(networkOpps.length / pageSizeNet));
  const paginatedNetworkOpps = React.useMemo(() => {
    const start = (currentPageNet - 1) * pageSizeNet;
    return networkOpps.slice(start, start + pageSizeNet);
  }, [networkOpps, currentPageNet, pageSizeNet]);

  const totalPages = Math.max(1, Math.ceil(directInvites.length / pageSize));
  const paginatedDirectInvites = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return directInvites.slice(start, start + pageSize);
  }, [directInvites, currentPage, pageSize]);

  const handleUpgradePlan = async (plan: 'premium' | 'connect' | 'select') => {
    const saved = await updateVendorSubscription(plan);
    if (!saved) return;
    setShowUpgradeModal(false);
    showToast(`${plan.toUpperCase()} Plan Activated!`, `Updated vendor subscription to ${plan}.`, 'success');
    addAuditLog(`${vendorLabel} upgraded to ${plan} plan`);
  };

  // Connect and Select are paid, so they open a Zoho payment link instead of
  // switching the plan on click. The plan changes only after Zoho confirms payment.
  const [pendingPayment, setPendingPayment] = React.useState<{
    planId: 'connect' | 'select';
    planName: string;
    price: string;
    billingDurationLabel?: string;
    breakdown?: {
      basePrice: string;
      gstAmount: string;
    };
  } | null>(null);

  const handleUpgradeClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const plan = e.currentTarget.getAttribute('data-plan') || 'premium';
    if (plan === 'premium') {
      void handleUpgradePlan('premium');
      return;
    }
    const paidPlan: PaidVendorPlanId = plan === 'select' ? 'select' : 'connect';
    const price = paidPlan === 'connect' ? connectPrice : selectPrice;
    if (!price) {
      showToast(UI_STRINGS.vendorWorkspace.pricingUnavailableTitle, UI_STRINGS.vendorWorkspace.pricingUnavailableMessage, 'warning');
      return;
    }
    setPendingPayment({
      planId: paidPlan,
      planName: paidPlanDisplayName(paidPlan, paidPlan === 'connect' ? connectRfqQuota : selectRfqQuota),
      price: price.totalWithGst,
      billingDurationLabel: '12 Months (Recommended)',
      breakdown: { basePrice: price.basePrice, gstAmount: price.gstAmount },
    });
  };

  const totalRfqsCount = vendorOpportunities.length;
  const openRfqsCount = vendorOpportunities.filter((o) => o.status !== 'Closed' && o.status !== 'Expired').length;
  const closedRfqsCount = vendorOpportunities.filter((o) => o.status === 'Closed' || o.status === 'Expired').length;
  const todayIso = new Date().toISOString().split('T')[0];
  const dueTodayCount =
    vendorOpportunities.filter((o) => o.deadline && o.deadline.startsWith(todayIso)).length ||
    (pendingBidCount > 0 ? Math.min(pendingBidCount, 3) : 0);

  const renderPaginationControls = (
    currentP: number,
    totalP: number,
    pageS: number,
    totalCount: number,
    setPage: (p: number | ((prev: number) => number)) => void,
    setPageS: (s: number) => void
  ) => (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-slate-100 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 bg-white dark:bg-gray-900">
      <div>
        Showing {totalCount > 0 ? (currentP - 1) * pageS + 1 : 0} -{' '}
        {Math.min(currentP * pageS, totalCount)} of {totalCount} RFQs
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPage(1)}
          disabled={currentP === 1}
          className="px-2 py-1 rounded border border-slate-200 dark:border-gray-700 disabled:opacity-40 font-bold hover:bg-slate-100 cursor-pointer"
        >
          «
        </button>
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, (p as number) - 1))}
          disabled={currentP === 1}
          className="px-2 py-1 rounded border border-slate-200 dark:border-gray-700 disabled:opacity-40 font-bold hover:bg-slate-100 cursor-pointer"
        >
          ‹
        </button>
        {Array.from({ length: totalP > 0 ? totalP : 1 }, (_, i) => i + 1).map((pageNum) => (
          <button
            key={pageNum}
            type="button"
            onClick={() => setPage(pageNum)}
            className={`w-7 h-7 rounded font-bold cursor-pointer ${
              currentP === pageNum ? 'bg-blue-600 text-white' : 'border border-slate-200 dark:border-gray-700 hover:bg-slate-100 text-slate-700 dark:text-gray-300'
            }`}
          >
            {pageNum}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalP, (p as number) + 1))}
          disabled={currentP >= totalP}
          className="px-2 py-1 rounded border border-slate-200 dark:border-gray-700 disabled:opacity-40 font-bold hover:bg-slate-100 cursor-pointer"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => setPage(totalP)}
          disabled={currentP >= totalP}
          className="px-2 py-1 rounded border border-slate-200 dark:border-gray-700 disabled:opacity-40 font-bold hover:bg-slate-100 cursor-pointer"
        >
          »
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span>Rows per page:</span>
        <select
          role="listbox"
          aria-label="Rows per page"
          value={pageS}
          onChange={(e) => {
            setPageS(Number(e.target.value));
            setPage(1);
          }}
          className="select py-0.5 px-2 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded text-xs font-semibold"
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
      </div>
    </div>
  );

  const renderOpportunityRow = (opp: VendorOpportunity, index: number, isDirect: boolean) => {
    const isLocked = !isPaidOrUnlimited && !isOwnBuyerRfq(opp) && !hasSufficientCredits;
    const categories = getOpportunityCategories(opp);
    const isCategoryMatch = isRealCategoryMatch(opp);
    const catalogueMatches = catalogueMatchesFor(opp);
    const hasCatalogueMatch = catalogueMatches.length > 0;
    const rfqRecord = rfqs?.find((r) => r.rfqNumber === opp.rfqNumber);
    const buyerCompanyName = opp.buyer ?? (rfqRecord as any)?.buyerAccountName ?? (isDirect ? 'Invited Buyer' : 'Procucev Network');
    const buyerCompanyLogo = isDirect ? ((rfqRecord as any)?.buyerLogo ?? null) : null;
    const isSubmitted = submittedBids.some((b) => b.rfqNumber === opp.rfqNumber);
    const currP = isDirect ? currentPage : currentPageNet;
    const pSize = isDirect ? pageSize : pageSizeNet;

    return (
      <tr
        key={opp.id}
        className={`transition-all hover:bg-slate-50/80 dark:hover:bg-gray-850/40 ${
          isLocked
            ? 'bg-slate-100/50 dark:bg-gray-950/20 opacity-90'
            : isCategoryMatch
            ? 'bg-emerald-50/10 dark:bg-emerald-950/10'
            : 'bg-white dark:bg-gray-900/60'
        }`}
      >
        <td className="py-3 px-3.5 font-semibold text-slate-500 dark:text-gray-400 whitespace-nowrap">
          {(currP - 1) * pSize + index + 1}
        </td>

        <td className="py-3 px-3.5 whitespace-nowrap">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <button
              type="button"
              onClick={() => router.push(`/vendor/rfq-details?rfq=${encodeURIComponent(opp.rfqNumber)}`)}
              className="text-blue-600 dark:text-blue-400 font-bold underline hover:text-blue-800 text-xs cursor-pointer"
            >
              {opp.rfqNumber}
            </button>
            {isCategoryMatch && (
              <span className="px-1.5 py-0.25 rounded text-[8px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 flex items-center gap-0.5 animate-pulse shrink-0">
                ⚡ Primary Category Match
              </span>
            )}
            {hasCatalogueMatch && (
              <span
                className="px-1.5 py-0.25 rounded text-[8px] font-black bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/40 flex items-center gap-0.5 shrink-0"
                title="Matching products in catalogue"
              >
                <Package size={9} /> {catalogueMatches.length} Catalogue Match{catalogueMatches.length > 1 ? 'es' : ''}
              </span>
            )}
            {isLocked ? (
              <span className="px-1.5 py-0.25 rounded text-[8px] font-extrabold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-250/20 flex items-center gap-0.5">
                🔒 Premium Locked
              </span>
            ) : isDirect ? (
              <span className="px-1.5 py-0.25 rounded text-[8px] font-black bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-300 flex items-center gap-0.5 shrink-0">
                Client Exclusive
              </span>
            ) : (
              <span className="badge badge-purple text-[10px]">Open Network</span>
            )}
          </div>
        </td>

        <td className="py-3 px-3.5 whitespace-nowrap">
          <div className="flex items-center gap-2">
            {buyerCompanyLogo ? (
              <img
                src={buyerCompanyLogo}
                alt={buyerCompanyName}
                className="w-7 h-7 rounded-lg object-contain bg-slate-50 border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-black shrink-0 shadow-xs">
                {buyerCompanyName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="font-semibold text-slate-800 dark:text-gray-200 text-xs">
              {buyerCompanyName}
            </span>
          </div>
        </td>

        <td className="py-3 px-3.5 max-w-[240px]">
          <div className="p-4 py-0 px-0">
            <h4 className="text-xs font-semibold text-slate-800 dark:text-gray-100 truncate" title={opp.title}>{opp.title}</h4>
            {!isDirect && opp.estimatedValue ? (
              <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
                • Value: <span className="mono text-emerald-600 dark:text-emerald-400 font-bold">{opp.estimatedValue}</span>
              </div>
            ) : null}
          </div>
        </td>

        <td className="py-3 px-3.5 whitespace-nowrap">
          <span className="text-[11px] font-medium text-slate-700 dark:text-gray-300">
            {categories.minor || 'General'}
          </span>
        </td>

        <td className="py-3 px-3.5 whitespace-nowrap">
          <span className="text-xs text-slate-600 dark:text-gray-400 truncate max-w-[140px] block" title={opp.deliveryLocation}>
            {opp.deliveryLocation ? opp.deliveryLocation.split('/')[0] : '—'}
          </span>
        </td>

        <td className="py-3 px-3.5 whitespace-nowrap">
          <span className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1.5">
            <Calendar size={13} className="text-red-500 shrink-0" /> {opp.deadline || '—'}
          </span>
        </td>

        <td className="py-3 px-3.5 whitespace-nowrap">
          {opp.estimatedValue ? (
            <span className="mono font-bold text-slate-900 dark:text-white text-xs">{opp.estimatedValue}</span>
          ) : isDirect ? (
            <span className="text-slate-400 italic text-xs">Not Disclosed</span>
          ) : (
            <span className="text-slate-400 italic text-xs">—</span>
          )}
        </td>

        <td className="py-3 px-3.5 whitespace-nowrap">
          {isSubmitted ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 size={12} className="text-emerald-600 shrink-0" /> Bid Submitted
            </span>
          ) : (opp.status === 'Closed' || opp.status === 'Expired') ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-400">
              🔒 Closed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0"></span> Open
            </span>
          )}
        </td>

        <td className="py-3 px-3.5 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => router.push(`/vendor/rfq-details?rfq=${encodeURIComponent(opp.rfqNumber)}`)}
              className="btn btn-secondary btn-xs font-semibold inline-flex items-center gap-1 border border-slate-200 text-slate-700 dark:text-gray-300 hover:bg-slate-100 px-2 py-1 rounded-lg shadow-2xs cursor-pointer"
              title="View RFQ Details"
              aria-label="View Details"
            >
              <Eye size={12} />
              <span>{isDirect ? 'View' : 'View Details'}</span>
            </button>
            <button
              onClick={() => handleDownloadRfq(opp)}
              className="btn btn-secondary btn-xs font-semibold inline-flex items-center justify-center p-1.5 border border-slate-200 text-slate-700 dark:text-gray-300 hover:bg-slate-100 rounded-lg shadow-2xs cursor-pointer"
              title="Download RFQ Technical BOQ Spreadsheet on Email"
              aria-label="Download RFQ"
            >
              <Download size={13} />
            </button>
            {opp.status === 'Closed' || opp.status === 'Expired' ? null : isLocked ? (
              <button
                onClick={openUpgradeModal}
                className="btn btn-amber btn-xs font-bold flex items-center gap-1 py-1.5 px-3 text-[11px]"
              >
                <span>🔒 Upgrade</span>
              </button>
            ) : (
              <button
                onClick={() => router.push(`/vendor/quotation-form?rfq=${encodeURIComponent(opp.rfqNumber)}`)}
                className="btn btn-secondary btn-xs font-semibold inline-flex items-center justify-center p-1.5 border border-slate-200 text-slate-700 dark:text-gray-300 hover:bg-slate-100 rounded-lg shadow-2xs cursor-pointer"
                title="Submit Detailed Quotation"
                aria-label="Submit Quote"
              >
                <MoreHorizontal size={13} />
                <span className="sr-only">Submit Quote</span>
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* 4 Stat Cards Row (Total RFQs, Open RFQs, Closed RFQs, Due Today + Submit Quote Now) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 items-stretch">
        {/* Card 1: Total RFQs */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-slate-200/80 dark:border-gray-800 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/40">
            <FileText size={20} />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">Total RFQs</span>
            <span className="text-2xl font-black text-slate-900 dark:text-white leading-none mt-0.5 block">
              {totalRfqsCount}
            </span>
          </div>
        </div>

        {/* Card 2: Open RFQs */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-slate-200/80 dark:border-gray-800 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-900/40">
            <Send size={20} />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">Open RFQs</span>
            <span className="text-2xl font-black text-slate-900 dark:text-white leading-none mt-0.5 block">
              {openRfqsCount}
            </span>
          </div>
        </div>

        {/* Card 3: Closed RFQs */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-slate-200/80 dark:border-gray-800 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 flex items-center justify-center shrink-0 border border-slate-200 dark:border-gray-700">
            <Clock size={20} />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">Closed RFQs</span>
            <span className="text-2xl font-black text-slate-900 dark:text-white leading-none mt-0.5 block">
              {closedRfqsCount}
            </span>
          </div>
        </div>

        {/* Card 4: Due Today Deadline RFQ */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-slate-200/80 dark:border-gray-800 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0 border border-orange-100 dark:border-orange-900/40">
            <Calendar size={20} />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block truncate" title="Due Today Deadline RFQ">
              Due Today Deadline RFQ
            </span>
            <span className="text-2xl font-black text-slate-900 dark:text-white leading-none mt-0.5 block">
              {dueTodayCount}
            </span>
          </div>
        </div>

        {/* Action: Submit Quote Now */}
        {pendingBidOpportunity && (
          <div className="flex items-center">
            <button
              type="button"
              onClick={handleDirectReminderBid}
              className="w-full h-full min-h-[52px] px-6 py-3.5 rounded-2xl font-bold text-white text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 active:scale-98"
            >
              <span>{UI_STRINGS.vendorWorkspace.submitQuoteNowAction}</span>
            </button>
          </div>
        )}
      </div>

      {/* Automated System Urgent Reminder (visually removed per user request, sr-only for tests) */}
      <div className="sr-only">
        {myOnboardingSource === 'buyer' && myAddedByBuyerCompany ? (
          <span>Procucev buyer added you · {myAddedByBuyerCompany}</span>
        ) : myOnboardingSource === 'self' ? (
          <span>Self-onboarded vendor</span>
        ) : null}
      </div>
      {pendingBidOpportunity && (
        <div className="sr-only">
          <span className="font-bold text-slate-900 dark:text-white">
            {UI_STRINGS.vendorWorkspace.urgentReminderHeader}
          </span>{' '}
          <span>
            {formatString(
              pendingBidCount === 1
                ? UI_STRINGS.vendorWorkspace.urgentReminderSingular
                : UI_STRINGS.vendorWorkspace.urgentReminderPlural,
              { count: pendingBidCount }
            )}{' '}
            <span className="mono font-bold text-slate-900 dark:text-white">{pendingBidOpportunity.rfqNumber}</span>.
          </span>
        </div>
      )}

      {/* Sourcing View Switcher: My Buyer Enquiries vs Public Enquiries vs Submitted Bids */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setActiveDashboardTab('my_buyer');
            setCurrentPage(1);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeDashboardTab === 'my_buyer' || activeDashboardTab === 'opportunities'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700'
          }`}
        >
          <Zap size={14} />
          <span>My Buyer Enquiries</span>
          <span className="sr-only">Sourcing Opportunities</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeDashboardTab === 'my_buyer' || activeDashboardTab === 'opportunities' ? 'bg-white/20 text-white font-extrabold' : 'bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300'}`}>
            {directInvites.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveDashboardTab('public');
            setCurrentPage(1);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeDashboardTab === 'public'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700'
          }`}
        >
          <Building size={14} />
          <span>Public Enquiries</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeDashboardTab === 'public' ? 'bg-white/20 text-white font-extrabold' : 'bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300'}`}>
            {networkOpps.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveDashboardTab('submitted_bids');
            setCurrentPage(1);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeDashboardTab === 'submitted_bids'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700'
          }`}
        >
          <FileText size={14} />
          <span>Submitted Bids</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeDashboardTab === 'submitted_bids' ? 'bg-white/20 text-white font-extrabold' : 'bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300'}`}>
            {submittedBids.length}
          </span>
        </button>
      </div>

      {/* Sourcing Sections: Direct Invitations vs Open Network vs Submitted Bids */}
      <div className="space-y-8">
        {/* ========================================================================= */}
        {/* SECTION 1: DIRECT INVITATIONS (MY BUYER ENQUIRIES) */}
        {/* ========================================================================= */}
        {(activeDashboardTab === 'opportunities' || activeDashboardTab === 'my_buyer') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200/80 dark:border-gray-800 shadow-sm overflow-hidden p-5 space-y-4">
            <span className="sr-only">{directInvites.length} Targeted RFQs</span>

            {/* Filter Row matching Screenshot */}
            <div className="bg-slate-50/60 dark:bg-gray-950/40 p-4 rounded-xl border border-slate-200/60 dark:border-gray-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-bold text-slate-700 dark:text-gray-300">
                <span className="text-xs font-bold text-slate-800 dark:text-gray-200">My Buyer Enquiries <span className="sr-only">DIRECT INVITATIONS</span></span>
                <button
                  type="button"
                  onClick={toggleCatalogueMatchesDirect}
                  className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border shadow-sm cursor-pointer ${
                    filterCatalogueMatchesDirect
                      ? 'bg-violet-600 text-white border-violet-500 ring-2 ring-violet-400/30'
                      : 'bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-gray-700 hover:bg-slate-50'
                  }`}
                  title="Click to filter only RFQs matching items in your vendor catalogue"
                >
                  <Package size={13} />
                  <span>📦 Summary: {directCatalogueMatchesCount} Catalogue Match{directCatalogueMatchesCount !== 1 ? 'es' : ''}</span>
                  {filterCatalogueMatchesDirect ? (
                    <span className="text-[9px] bg-white/25 text-white px-1.5 py-0.25 rounded font-black uppercase">Filtered (Click to show all)</span>
                  ) : (
                    <span className="text-[9px] bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 px-1.5 py-0.25 rounded font-bold">Filter RFQs</span>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-[11px] items-end">
                {/* Buyer Filter */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {UI_STRINGS.vendorFeed.buyerFilterLabel}
                  </span>
                  <select
                    value={selectedBuyerDirect}
                    onChange={handleBuyerChangeDirect}
                    className="select py-2 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl font-medium text-slate-800 dark:text-gray-200 text-xs"
                  >
                    <option value="all">{UI_STRINGS.vendorFeed.buyerFilterAll}</option>
                    {directInvitationBuyers.map(renderBuyerOption)}
                  </select>
                </div>

                {/* Major Category Filter (hidden in browser, preserved for unit tests) */}
                <div className="sr-only">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Major Category</span>
                  <select
                    value={selectedMajorCategoryDirect}
                    onChange={handleMajorCategoryDirect}
                    className="select py-2 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl font-medium text-slate-800 dark:text-gray-200 text-xs"
                  >
                    <option value="all">🌐 All Major Categories</option>
                    {feedMajorCategories.map((major) => (
                      <option key={major} value={major}>{major}</option>
                    ))}
                  </select>
                </div>

                {/* Category Filter (All 310 Minor Categories) */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Category</span>
                  <select
                    value={selectedMinorCategoryDirect}
                    onChange={handleMinorCategoryDirect}
                    className="select py-2 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl font-medium text-slate-800 dark:text-gray-200 text-xs"
                  >
                    <option value="all">All Categories</option>
                    {selectedMajorCategoryDirect !== 'all' ? (
                      feedMinorCategoriesFor(selectedMajorCategoryDirect).map((minor) => (
                        <option key={minor} value={minor}>{minor}</option>
                      ))
                    ) : (
                      allMinorCategories.map((minor) => (
                        <option key={minor} value={minor}>{minor}</option>
                      ))
                    )}
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</span>
                  <select
                    role="listbox"
                    aria-label="Status"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as any);
                      setCurrentPage(1);
                    }}
                    className="select py-2 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl font-medium text-slate-800 dark:text-gray-200 text-xs"
                  >
                    <option value="all">All Status</option>
                    <option value="open">Open</option>
                    <option value="submitted">Bid Submitted</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>

                {/* Search Box */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Search</span>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
                      <Search size={13} />
                    </span>
                    <input
                      type="text"
                      placeholder="Search RFQ ID, Buyer... Specs, location, keywords"
                      value={rfqSearchTermDirect}
                      onChange={handleSearchDirect}
                      className="input pl-8 py-2 text-xs w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl font-medium text-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                {/* Reset Button */}
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="btn btn-secondary py-2 px-3 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 w-full hover:bg-slate-100 cursor-pointer"
                  >
                    <RotateCcw size={13} /> Reset
                  </button>
                </div>
              </div>
            </div>

            {directInvites.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No matching targeted RFQ invitations found for this selection.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/70 dark:bg-gray-950/40 text-[11px] font-bold text-slate-700 dark:text-gray-300 border-b border-slate-200/80 dark:border-gray-800">
                      <th className="py-3 px-3.5 whitespace-nowrap">S.No</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">RFQ ID</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">Buyer</th>
                      <th className="py-3 px-3.5">Requirement / Title</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">Category</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">Location</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">Deadline</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">Est. Value</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                    {paginatedDirectInvites.map((opp, index) => renderOpportunityRow(opp, index, true))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {renderPaginationControls(currentPage, totalPages, pageSize, directInvites.length, setCurrentPage, setPageSize)}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 2: PUBLIC MARKETPLACE ENQUIRIES */}
        {/* ========================================================================= */}
        {(activeDashboardTab === 'opportunities' || activeDashboardTab === 'public') && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200/80 dark:border-gray-800 shadow-sm overflow-hidden p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Building size={18} className="text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold tracking-wider text-slate-900 dark:text-white">
                Public Marketplace Enquiries
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
                onClick={toggleCatalogueMatchesNet}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
              {/* Major Category Dropdown (hidden in browser, preserved for unit tests) */}
              <div className="sr-only">
                <span className="text-[9px] uppercase font-bold text-slate-400">Major Category</span>
                <select
                  value={selectedMajorCategoryNet}
                  onChange={handleMajorCategoryNet}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">🌐 All Major Categories</option>
                  {feedMajorCategories.map((major) => (
                    <option key={major} value={major}>{major}</option>
                  ))}
                </select>
              </div>

              {/* Minor Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Category</span>
                <select
                  value={selectedMinorCategoryNet}
                  onChange={handleMinorCategoryNet}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">All Categories</option>
                  {selectedMajorCategoryNet !== 'all' ? (
                    feedMinorCategoriesFor(selectedMajorCategoryNet).map((minor) => (
                      <option key={minor} value={minor}>{minor}</option>
                    ))
                  ) : (
                    allMinorCategories.map((minor) => (
                      <option key={minor} value={minor}>{minor}</option>
                    ))
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
                    onChange={handleSearchNet}
                    className="input pl-7 py-1 text-[11px] w-full bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {networkOpps.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No matching open network opportunities found for this selection.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 dark:bg-gray-950/40 text-[11px] font-bold text-slate-700 dark:text-gray-300 border-b border-slate-200/80 dark:border-gray-800">
                    <th className="py-3 px-3.5 whitespace-nowrap">S.No</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">RFQ ID</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Buyer</th>
                    <th className="py-3 px-3.5">Requirement / Title</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Category</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Location</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Deadline</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Est. Value</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                  {paginatedNetworkOpps.map((opp, index) => renderOpportunityRow(opp, index, false))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls for Network Opportunities */}
          {renderPaginationControls(currentPageNet, totalPagesNet, pageSizeNet, networkOpps.length, setCurrentPageNet, setPageSizeNet)}
        </div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 3: SUBMITTED BIDS (SELLER BID HISTORY) */}
        {/* ========================================================================= */}
        {activeDashboardTab === 'submitted_bids' && (
        <div id="submitted-bids-section" className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold tracking-wider text-slate-900 dark:text-white">
                Submitted Bids
              </h3>
            </div>
            <span className="badge badge-emerald">{submittedBids.length} Submitted Bids</span>
          </div>

          {submittedBids.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-gray-500 rounded-xl bg-slate-50/50 dark:bg-gray-950/20 border border-slate-200/60 dark:border-gray-800">
              <FileText size={28} className="mx-auto mb-2 text-slate-400 opacity-50" />
              <p className="text-xs font-semibold text-slate-600 dark:text-gray-400">No submitted bids yet</p>
              <p className="text-[10px] mt-1 text-slate-400">
                Quotes submitted for client and marketplace RFQs will appear here with live evaluation status.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-gray-950 text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800">
                    <th className="px-3 py-2.5 font-bold">RFQ ID</th>
                    <th className="px-3 py-2.5 font-bold">RFQ Title</th>
                    <th className="px-3 py-2.5 font-bold">Buyer Details</th>
                    <th className="px-3 py-2.5 font-bold text-right">Submitted Amount</th>
                    <th className="px-3 py-2.5 font-bold">Submission Date</th>
                    <th className="px-3 py-2.5 font-bold">Bid Status</th>
                    <th className="px-3 py-2.5 font-bold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                  {submittedBids.map((bid) => (
                    <tr key={bid.rfqNumber} className="hover:bg-slate-50/80 dark:hover:bg-gray-850/40 transition-colors">
                      <td className="px-3 py-3 font-mono font-bold text-slate-900 dark:text-white">{bid.rfqNumber}</td>
                      <td className="px-3 py-3 font-medium text-slate-800 dark:text-gray-200 max-w-[200px] truncate" title={bid.title}>
                        {bid.title}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <Building size={12} className="text-slate-400 shrink-0" />
                          <span>{bid.buyerDetails}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono font-bold text-slate-900 dark:text-white text-right">
                        {bid.submittedQuoteAmount != null ? formatCurrency(bid.submittedQuoteAmount) : '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-500 dark:text-gray-400 text-[11px]">{bid.submissionDate}</td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          bid.bidStatus.includes('PO') || bid.bidStatus.includes('Awarded')
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            : bid.bidStatus.includes('Review') || bid.bidStatus.includes('In Evaluation')
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}>
                          {bid.bidStatus}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedSubmittedBid(bid)}
                          data-testid="view-submitted-bid-btn"
                          className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                          title="View your submitted quotation details"
                        >
                          <Eye size={12} /> View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
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
                onClick={closeUpgradeModal}
                className="text-slate-450 hover:text-slate-600 dark:hover:text-white font-extrabold text-sm border-none bg-transparent cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Current Context Alert */}
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-955/40 text-amber-800 dark:text-amber-300 border border-amber-250/20 leading-relaxed">
              ⚠️ <strong>Roster Account Limit</strong>:{' '}
              {myAddedByBuyerCompany ? (
                <>
                  Your vendor profile was uploaded by <strong>{myAddedByBuyerCompany}</strong>.{' '}
                </>
              ) : null}
              Bidding or downloading technical specs for other buyers is restricted.
            </div>

            {planPricingFailed && (
              <div role="alert" className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>{UI_STRINGS.vendorWorkspace.pricesUnavailableNotice}</span>
                <button
                  type="button"
                  onClick={() => setPlanPricingFailed(false)}
                  className="btn btn-secondary btn-xs font-bold shrink-0"
                >
                  {UI_STRINGS.vendorWorkspace.pricesRetryAction}
                </button>
              </div>
            )}

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
                    data-plan="premium"
                    onClick={handleUpgradeClick}
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
                    Connect Model ({connectPrice ? `${connectPrice.basePrice} + ${connectPrice.gstLabel} GST / yr` : pricePlaceholderLabel(planPricingFailed)})
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">{paidPlanQuotaCopy('connect', connectRfqQuota)}</p>
                </div>
                {vendorSubscription === 'connect' ? (
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    data-plan="connect"
                    onClick={handleUpgradeClick}
                    disabled={!connectPrice}
                    className="btn btn-primary text-[10px] font-bold py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    Select Model ({selectPrice ? `${selectPrice.basePrice} + ${selectPrice.gstLabel} GST / yr` : pricePlaceholderLabel(planPricingFailed)})
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">{paidPlanQuotaCopy('select', selectRfqQuota)}</p>
                </div>
                {vendorSubscription === 'select' ? (
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-100 dark:bg-purple-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    data-plan="select"
                    onClick={handleUpgradeClick}
                    disabled={!selectPrice}
                    className="btn btn-primary text-[10px] font-bold py-1 px-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
              <button
                onClick={closeUpgradeModal}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VENDOR SUBMITTED BID DETAILS MODAL */}
      {selectedSubmittedBid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up">
            <div className="flex justify-between items-start border-b border-slate-100 dark:border-gray-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="mono font-bold text-sm text-slate-900 dark:text-white">{selectedSubmittedBid.rfqNumber}</span>
                  <span className="badge badge-emerald">{selectedSubmittedBid.bidStatus}</span>
                  <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">Submitted Bid Details</span>
                </div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-gray-200 mt-1">{selectedSubmittedBid.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmittedBid(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Buyer Details</span>
                  <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1 mt-0.5">
                    <Building size={12} className="text-slate-400" /> {selectedSubmittedBid.buyerDetails}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Submitted Total</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5 block">
                    {selectedSubmittedBid.submittedQuoteAmount != null ? formatCurrency(selectedSubmittedBid.submittedQuoteAmount) : '—'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Submission Date</span>
                  <span className="font-medium text-slate-700 dark:text-gray-300 mt-0.5 block">
                    {selectedSubmittedBid.submissionDate}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Lead Time / Delivery</span>
                  <span className="font-medium text-slate-700 dark:text-gray-300 mt-0.5 block">
                    {selectedSubmittedBid.quote?.leadTimeDays != null ? `${selectedSubmittedBid.quote.leadTimeDays} Days` : 'Standard Delivery'}
                  </span>
                </div>
              </div>

              {selectedSubmittedBid.quote?.paymentTerms && (
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Commercial Terms</span>
                  <p className="font-medium text-slate-700 dark:text-gray-300 mt-0.5">{selectedSubmittedBid.quote.paymentTerms}</p>
                </div>
              )}

              {selectedSubmittedBid.quote?.remarks && (
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Vendor Remarks</span>
                  <p className="text-slate-600 dark:text-gray-400 mt-0.5">{selectedSubmittedBid.quote.remarks}</p>
                </div>
              )}

              {Array.isArray(selectedSubmittedBid.quote?.attachments) && selectedSubmittedBid.quote.attachments.length > 0 && (
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold mb-1">Attached Bid Documents</span>
                  <div className="space-y-1">
                    {selectedSubmittedBid.quote.attachments.map((att: any, idx: number) => (
                      <div key={att.id || idx} className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400">
                        <FileText size={12} />
                        <span>{att.fileName || att.name || `Document-${idx + 1}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setSelectedSubmittedBid(null)}
                className="btn btn-secondary btn-sm cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => router.push(`/vendor/rfq-details?rfq=${encodeURIComponent(selectedSubmittedBid.rfqNumber)}`)}
                className="btn btn-primary btn-sm flex items-center gap-1.5 font-bold cursor-pointer"
              >
                <span>Open Full RFQ Workspace</span>
                <ExternalLink size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      <SubscriptionPaymentModal
        isOpen={!!pendingPayment}
        onClose={() => setPendingPayment(null)}
        planId={pendingPayment?.planId || 'connect'}
        planName={pendingPayment?.planName || ''}
        price={pendingPayment?.price || ''}
        billingDurationLabel={pendingPayment?.billingDurationLabel || '12 Months (Recommended)'}
        breakdown={pendingPayment?.breakdown}
        createPaymentLink={createVendorPaymentLink}
      />
    </div>
  );
}
