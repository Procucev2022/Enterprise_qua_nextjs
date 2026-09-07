'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import {
  expandCategorySelection,
  fetchBuyerProfile,
  fetchCategoryTaxonomy,
  flattenCategorySelection,
  saveBuyerProfile,
} from '@/lib/buyerProfileClient';
import { BUYER_PROFILE_LIMITS, ORGANIZATION_TYPE_OPTIONS } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { FORM_SCHEMAS, validateFormData } from '@/lib/validationSchemas';
import { logger } from '@/lib/logger';
import AccountSecurityPanel from '@/app/components/AccountSecurityPanel';
import type { BuyerProfileUpdatePayload, MajorMinorCategory, OrganizationType } from '@/lib/types';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  KeyRound,
  MapPin,
  User,
  Search,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Save,
  Globe,
  Sliders,
} from 'lucide-react';

/**
 * Buyer Organization Profile.
 *
 * Every field on this screen is a column of the buyer's own `organization` row in
 * the shared Procucev database, and every category checkbox is a row of
 * `org_division_category`. Nothing is seeded, defaulted from a fixture, or held
 * in memory between sessions: the form is populated by GET /api/buyer-profile/me
 * on mount and persisted by PUT /api/buyer-profile/me on save.
 *
 * The organisation is resolved server-side from the session token, so the screen
 * never names an organisation and a buyer can only ever reach their own record.
 */
export default function BuyerProfilePage() {
  const { addAuditLog, showToast } = useApp();

  const { MAX_MAJOR_CATEGORIES, MAX_MINOR_CATEGORIES } = BUYER_PROFILE_LIMITS;

  // Organization Form State
  const [companyName, setCompanyName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [orgType, setOrgType] = useState<OrganizationType>('Public Limited');
  const [panNumber, setPanNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [cinNumber, setCinNumber] = useState('');
  const [website, setWebsite] = useState('');
  const [annualTurnover, setAnnualTurnover] = useState('');

  // Address State
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [country, setCountry] = useState('');

  // Contact Person State. Email and mobile belong to the signed-in account's
  // `user` row and are shown as loaded; the save endpoint ignores them so a
  // profile edit can never reassign the login identity.
  const [contactName, setContactName] = useState('');
  const [contactDesignation, setContactDesignation] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Category Selection State: Selected Major Categories and Minor Categories
  const [selectedMajor, setSelectedMajor] = useState<string[]>([]);
  const [selectedMinor, setSelectedMinor] = useState<Record<string, string[]>>({});

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({});

  // The major/minor taxonomy, read from the `category_division` master table.
  // Starts empty because there is no offline copy to show: an unreachable API
  // means the buyer is told the tree could not be loaded, not offered categories
  // that might not exist.
  const [taxonomy, setTaxonomy] = useState<MajorMinorCategory[]>([]);

  // Request state. `isLoaded` gates saving: without a resolved organisation there
  // is nothing to patch, and submitting would post a form the buyer never saw
  // filled in.
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  /**
   * Latest `showToast`, read through a ref.
   *
   * The store recreates `showToast` on every provider render, so it must not be a
   * dependency of the load below. It used to be, and the result was an unbounded
   * request loop: reporting a failed load calls `showToast`, which sets state in
   * the provider, which re-renders it, which yields a new `showToast` identity,
   * which re-creates the loader, which re-runs the mount effect, which requests
   * again. A failing endpoint drove that round indefinitely, and the toast's own
   * auto-dismiss timer would have driven it even on success.
   *
   * A ref keeps the loader's identity stable while still calling the current
   * function, so the profile is fetched once per mount.
   */
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  /** Set once the component unmounts, so a late response cannot set state. */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Load the taxonomy and the buyer's stored profile.
   *
   * Both are requested together because the category tree cannot be rendered
   * without the taxonomy and the selection cannot be shown without the profile,
   * so serialising them would only add a round trip.
   *
   * Deliberately has no dependencies: it reads the store callback through a ref
   * and only ever calls state setters, whose identities React guarantees are
   * stable. That is what keeps the mount effect from re-firing.
   */
  const loadProfile = useCallback(async () => {
    setIsLoading(true);

    const [taxonomyResult, profileResult] = await Promise.all([
      fetchCategoryTaxonomy(),
      fetchBuyerProfile(),
    ]);

    if (!isMountedRef.current) return;

    setTaxonomy(taxonomyResult.data);
    if (!taxonomyResult.success) {
      showToastRef.current(UI_STRINGS.buyerProfile.loadFailedTitle, taxonomyResult.error || '', 'warning');
    }

    if (!profileResult.success || !profileResult.data) {
      setIsLoaded(false);
      setIsLoading(false);
      showToastRef.current(UI_STRINGS.buyerProfile.loadFailedTitle, profileResult.error || '', 'warning');
      return;
    }

    const profile = profileResult.data;
    setCompanyName(profile.companyName);
    setBrandName(profile.brandName);
    // Guard against a stored constitution outside the offered set, which would
    // leave the select bound to a value none of its options carry.
    setOrgType(
      ORGANIZATION_TYPE_OPTIONS.includes(profile.organizationType as OrganizationType)
        ? (profile.organizationType as OrganizationType)
        : 'Public Limited'
    );
    setPanNumber(profile.panNumber);
    setGstNumber(profile.gstNumber);
    setCinNumber(profile.cinNumber);
    setWebsite(profile.website);
    setAnnualTurnover(profile.annualTurnover);
    setStreet(profile.street);
    setCity(profile.city);
    setState(profile.state);
    setPincode(profile.pincode);
    setCountry(profile.country);
    setContactName(profile.contactName);
    setContactDesignation(profile.contactDesignation);
    setContactEmail(profile.contactEmail);
    setContactPhone(profile.contactPhone);

    const { selectedMajor: majors, selectedMinor: minors } = expandCategorySelection(profile.categories);
    setSelectedMajor(majors);
    setSelectedMinor(minors);
    // Open the majors the buyer already sources in, so their existing scope is
    // visible without hunting for it.
    setExpandedMajor(majors.reduce<Record<string, boolean>>((acc, major) => ({ ...acc, [major]: true }), {}));

    setIsLoaded(true);
    setIsLoading(false);
  }, []);

  // Runs once per mount: `loadProfile` is dependency-free, so this effect has a
  // stable dependency and cannot be re-triggered by a provider re-render.
  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // PAN Validation Helper
  const isPanValid = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.toUpperCase());
  // GST Validation Helper
  const isGstValid = (gst: string) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gst.toUpperCase());

  // Calculate totals
  const totalSelectedMinorCount = Object.values(selectedMinor).reduce((acc, curr) => acc + curr.length, 0);

  /** Minors of a major, from the taxonomy the database returned. */
  const minorsOf = (majorName: string) =>
    taxonomy.find((c) => c.majorCategory === majorName)?.minorCategories || [];

  /**
   * Report that a cardinality cap blocked a selection.
   *
   * The caps exist because the RFQ distribution engine fans out per selected
   * category, so an unbounded scope would broadcast every RFQ to the whole vendor
   * base. The old screen let "Select All" bypass them; here every path goes
   * through these checks.
   */
  const rejectForMajorCap = () => {
    showToast(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      formatString(UI_STRINGS.buyerProfile.maxMajorReached, { max: MAX_MAJOR_CATEGORIES }),
      'warning'
    );
  };

  const rejectForMinorCap = () => {
    showToast(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      formatString(UI_STRINGS.buyerProfile.maxMinorReached, {
        count: totalSelectedMinorCount,
        max: MAX_MINOR_CATEGORIES,
      }),
      'warning'
    );
  };

  // Toggle Major Category
  const toggleMajorCategory = (majorName: string) => {
    if (selectedMajor.includes(majorName)) {
      setSelectedMajor((prev) => prev.filter((m) => m !== majorName));
      setSelectedMinor((prev) => {
        const next = { ...prev };
        delete next[majorName];
        return next;
      });
      return;
    }

    if (selectedMajor.length >= MAX_MAJOR_CATEGORIES) {
      rejectForMajorCap();
      return;
    }

    const remainingSlots = MAX_MINOR_CATEGORIES - totalSelectedMinorCount;
    if (remainingSlots <= 0) {
      rejectForMinorCap();
      return;
    }

    setSelectedMajor((prev) => [...prev, majorName]);
    // Select as many minors as the remaining allowance permits, rather than all
    // of them and then silently discarding the overflow at save time.
    setSelectedMinor((prev) => ({ ...prev, [majorName]: minorsOf(majorName).slice(0, remainingSlots) }));
  };

  // Toggle Minor Category
  const toggleMinorCategory = (majorName: string, minorName: string) => {
    const currentList = selectedMinor[majorName] || [];
    const isChecked = currentList.includes(minorName);

    if (isChecked) {
      const updated = currentList.filter((m) => m !== minorName);
      setSelectedMinor((prev) => {
        const next = { ...prev, [majorName]: updated };
        if (updated.length === 0) delete next[majorName];
        return next;
      });
      // If no minor selected, deselect major
      if (updated.length === 0) {
        setSelectedMajor((prev) => prev.filter((m) => m !== majorName));
      }
      return;
    }

    if (totalSelectedMinorCount >= MAX_MINOR_CATEGORIES) {
      rejectForMinorCap();
      return;
    }
    if (!selectedMajor.includes(majorName) && selectedMajor.length >= MAX_MAJOR_CATEGORIES) {
      rejectForMajorCap();
      return;
    }

    if (!selectedMajor.includes(majorName)) {
      setSelectedMajor((prev) => [...prev, majorName]);
    }
    setSelectedMinor((prev) => ({ ...prev, [majorName]: [...(prev[majorName] || []), minorName] }));
  };

  // Select all minor for a major
  const selectAllMinorInMajor = (majorName: string) => {
    const alreadySelected = selectedMinor[majorName] || [];
    if (!selectedMajor.includes(majorName) && selectedMajor.length >= MAX_MAJOR_CATEGORIES) {
      rejectForMajorCap();
      return;
    }

    // Room left once this major's current selection is set aside, since those
    // minors are being replaced rather than added to.
    const remainingSlots = MAX_MINOR_CATEGORIES - (totalSelectedMinorCount - alreadySelected.length);
    if (remainingSlots <= 0) {
      rejectForMinorCap();
      return;
    }

    const allMinor = minorsOf(majorName);
    if (allMinor.length > remainingSlots) {
      rejectForMinorCap();
    }

    if (!selectedMajor.includes(majorName)) {
      setSelectedMajor((prev) => [...prev, majorName]);
    }
    setSelectedMinor((prev) => ({ ...prev, [majorName]: allMinor.slice(0, remainingSlots) }));
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

  // Filtered Categories based on search
  const filteredCategories = taxonomy.filter((cat) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesMajor = cat.majorCategory.toLowerCase().includes(term);
    const matchesMinor = cat.minorCategories.some((m) => m.toLowerCase().includes(term));
    return matchesMajor || matchesMinor;
  });

  /**
   * Persist the profile.
   *
   * Validated against FORM_SCHEMAS.buyerProfile first so a malformed statutory
   * identifier is reported before a request is made, then re-validated by the
   * server, which owns the `organization` row. The response is applied back to the
   * form so the buyer sees exactly what was stored, including the server-side
   * uppercasing of PAN/GSTIN/CIN and the currency-symbol rewrite.
   */
  const handleSaveProfile = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    if (isSaving) return;

    if (!isLoaded) {
      showToast(UI_STRINGS.buyerProfile.saveFailedTitle, UI_STRINGS.buyerProfile.loadUnreachable, 'warning');
      return;
    }

    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.buyerProfile, {
      companyName,
      panNumber,
      gstNumber,
      cinNumber,
      website,
      pincode,
    });

    if (!isValid) {
      showToast(
        UI_STRINGS.buyerProfile.validationErrorTitle,
        Object.values(fieldErrors).join(' '),
        'warning'
      );
      return;
    }

    const categories = flattenCategorySelection(selectedMajor, selectedMinor);
    if (categories.length === 0) {
      showToast(
        UI_STRINGS.buyerProfile.validationErrorTitle,
        UI_STRINGS.buyerProfile.categoriesRequired,
        'warning'
      );
      return;
    }

    const payload: BuyerProfileUpdatePayload = {
      companyName,
      brandName,
      organizationType: orgType,
      panNumber,
      gstNumber,
      cinNumber,
      website,
      annualTurnover,
      street,
      city,
      state,
      pincode,
      country,
      contactName,
      contactDesignation,
      categories,
    };

    setIsSaving(true);
    logger.info('Saving buyer organization profile', { categoryCount: categories.length }, 'BUYER_PROFILE');
    const result = await saveBuyerProfile(payload);
    setIsSaving(false);

    if (!result.success) {
      showToast(UI_STRINGS.buyerProfile.saveFailedTitle, result.error || '', 'warning');
      return;
    }

    // Re-apply the stored record: the server normalises several fields, and
    // leaving the pre-save text on screen would misrepresent what was persisted.
    if (result.data) {
      setCompanyName(result.data.companyName);
      setBrandName(result.data.brandName);
      setPanNumber(result.data.panNumber);
      setGstNumber(result.data.gstNumber);
      setCinNumber(result.data.cinNumber);
      setAnnualTurnover(result.data.annualTurnover);
      setContactName(result.data.contactName);
    }

    addAuditLog(`Updated Buyer Organization Profile & Procurement Categories for ${companyName}`);
    showToast(
      UI_STRINGS.buyerProfile.savedTitle,
      formatString(UI_STRINGS.buyerProfile.savedMessage, {
        categoryCount: result.categoryCount ?? categories.length,
      }),
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
          disabled={isLoading || isSaving}
          aria-busy={isSaving}
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
                onChange={(e) => setOrgType(e.target.value as OrganizationType)}
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
            disabled={isLoading || isSaving}
            aria-busy={isSaving}
            className="btn btn-primary btn-lg shadow-xl shadow-indigo-600/20 font-bold flex items-center gap-2 px-8"
          >
            <Save size={18} /> Save Buyer Organization Profile
          </button>
        </div>
      </form>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Section 4: Account & Security                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Sits outside the organisation form above on purpose. The panel has its  */}
      {/* own submit handlers, and nesting a <form> inside another is invalid     */}
      {/* HTML — the inner one is dropped during parsing, which would wire the    */}
      {/* password button up to the profile save instead.                        */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <KeyRound className="text-indigo-600 dark:text-indigo-400" size={18} />{' '}
              {UI_STRINGS.accountSecurity.sectionTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              {UI_STRINGS.accountSecurity.sectionDescription}
            </p>
          </div>
        </div>

        <AccountSecurityPanel />
      </div>
    </div>
  );
}
