'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { findMajorForMinor, getMinorCategories } from '@/lib/categoryTaxonomy';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
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
  CreditCard,
  AlertCircle,
  Loader2,
  Plus,
  X,
  KeyRound,
  Lock,
  Eye,
  Trash2,
} from 'lucide-react';
import AccountSecurityPanel from '@/app/components/AccountSecurityPanel';
import { validatePincode, PostOfficeDetail, PINCODE_PATTERN, isDummyPincode } from '@/lib/validationSchemas';

export default function VendorProfilePage() {
  const {
    addAuditLog,
    showToast,
    vendorSubscription,
    vendorSelectedCategories,
    saveVendorProfileCategories,
    currentUserSession,
    // The category master, read from the database rather than a bundled copy.
    categoryTaxonomy,
    categoryTaxonomyError,
    ensureCategoryTaxonomy,
  } = useApp();

  const MAX_CATEGORIES = 10;

  // Loads the category master once. The store function is recreated on every render, so
  // listing it as a dependency would refetch on each render while the request fails.
  useEffect(() => {
    if (typeof ensureCategoryTaxonomy === 'function') {
      void ensureCategoryTaxonomy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vendor Organization State — starts blank; populated from the authenticated
  // vendor's own backend record once it loads (see the profile-load effect below).
  // Nothing is pre-selected for the vendor: an unset constitution is saved as unset.
  const [companyName, setCompanyName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [orgType, setOrgType] = useState<'' | 'Private Limited' | 'Public Limited' | 'Partnership' | 'Sole Proprietorship' | 'LLP'>('');
  const [panNumber, setPanNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [msmeNumber, setMsmeNumber] = useState('');
  const [website, setWebsite] = useState('');
  const [annualTurnover, setAnnualTurnover] = useState('');

  // Address State
  const [factoryAddress, setFactoryAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [pincodeValidating, setPincodeValidating] = useState(false);
  const [pincodePostOffices, setPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const pincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const raw = pincode.trim();
    if (pincodeDebounceRef.current) clearTimeout(pincodeDebounceRef.current);
    if (!raw) {
      setPincodeError(null);
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (isDummyPincode(raw)) {
      setPincodeError('Invalid or dummy PIN code');
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setPincodeError('Invalid PIN code format');
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (/^\d{6}$/.test(raw)) {
      setPincodeValidating(true);
      pincodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await validatePincode(raw);
          if (!res.isValid) {
            setPincodeError(res.message || 'Invalid PIN code');
            setPincodePostOffices([]);
          } else {
            setPincodeError(null);
            const pos = res.postOffices || [];
            setPincodePostOffices(pos);
            if (pos.length > 0) {
              const primaryPo = pos[0];
              const matchedCity = primaryPo.District || primaryPo.Division || primaryPo.Name || '';
              const matchedState = primaryPo.State || '';
              if (matchedCity) setCity(matchedCity);
              if (matchedState) setState(matchedState);
            }
          }
        } catch {
          setPincodeError(null);
        } finally {
          setPincodeValidating(false);
        }
      }, 350);
    } else {
      setPincodeError(null);
      setPincodeValidating(false);
      setPincodePostOffices([]);
    }
  }, [pincode]);
  const [country, setCountry] = useState('');

  // Contact Person State. Email is the vendor's own login identity (see the
  // read-only field below) — it's what the backend uses to find this vendor's
  // record and to authorize edits to it, so it can't be freely retyped here.
  const [contactName, setContactName] = useState('');
  const [contactDesignation, setContactDesignation] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Category Selection State: Selected Major Categories and Minor Categories (Max 10)
  const [selectedMajor, setSelectedMajor] = useState<string[]>([]);
  const [selectedMinor, setSelectedMinor] = useState<Record<string, string[]>>({});

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({});

  // Backend load/save state
  const [vendorRecordId, setVendorRecordId] = useState<string | null>(null);
  const [loadedClientCats, setLoadedClientCats] = useState<string[]>([]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Set when the saved profile could not be read. The form then stays blocked, because
  // saving a blank form would create a second vendor record instead of updating this one.
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  const CUSTOM_CATEGORY_GROUP = UI_STRINGS.vendorProfile.customCategoryGroup;
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [viewCategory, setViewCategory] = useState<{ name: string; major: string; status: string } | null>(null);
  const categorySearchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (categorySearchContainerRef.current && !categorySearchContainerRef.current.contains(event.target as Node)) {
        setShowCategorySuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Groups a flat list of minor category names (as persisted by the backend)
  // back into the major->minor shape this screen's selector state uses.
  // Preserves unknown or custom categories under the custom categories group.
  const groupMinorCategories = useCallback((flat: string[]) => {
    const majors: string[] = [];
    const minorMap: Record<string, string[]> = {};
    flat.forEach((minorName) => {
      const trimmed = (minorName || '').trim();
      if (!trimmed) return;
      const major = findMajorForMinor(trimmed) || CUSTOM_CATEGORY_GROUP;
      if (!minorMap[major]) {
        minorMap[major] = [];
        majors.push(major);
      }
      if (!minorMap[major].includes(trimmed)) {
        minorMap[major].push(trimmed);
      }
    });
    return { majors, minorMap };
  }, [CUSTOM_CATEGORY_GROUP]);

  useEffect(() => {
    let cancelled = false;

    async function loadVendorProfile() {
      const email = currentUserSession?.email;
      if (!email) {
        setIsLoadingProfile(false);
        return;
      }
      setProfileLoadError(null);
      try {
        const token = authClient.getToken();
        const res = await fetch(`/api/vendors/${encodeURIComponent(email)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 404) {
          // No backend record yet for this vendor — first-time profile, blank form.
          if (!cancelled) setContactEmail(email);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success || !data.data) {
          setProfileLoadError(
            typeof data?.error === 'string' && data.error
              ? data.error
              : `Your supplier profile could not be loaded (server responded with HTTP ${res.status}).`
          );
          return;
        }

        const v = data.data;
        setVendorRecordId(v.id);
        setCompanyName(v.name || '');
        setBrandName(v.brandName || '');
        if (v.orgType) setOrgType(v.orgType);
        setPanNumber(v.pan || '');
        setGstNumber(v.gst || v.gstin || '');
        setMsmeNumber(v.msme || '');
        setWebsite(v.website || '');
        setAnnualTurnover(v.annualTurnover || '');
        setFactoryAddress(v.factoryAddress || v.address || '');
        setCity(v.city || '');
        setState(v.state || '');
        setPincode(v.pincode || '');
        setCountry(v.country || '');
        setContactName(v.contactPerson || '');
        setContactDesignation(v.contactDesignation || '');
        setContactEmail(email);
        setContactPhone(v.phone || v.mobile || '');
        setLoadedClientCats(v.clientMappedCategories || []);

        const { majors, minorMap } = groupMinorCategories(v.vendorSelectedCategories || []);
        setSelectedMajor(majors);
        setSelectedMinor(minorMap);
        setExpandedMajor(Object.fromEntries(majors.map((m) => [m, true])));
      } catch {
        // Network failure: the form stays blank and the error is shown above it, so a
        // blank form is never read as a profile that does not exist yet.
        if (!cancelled) {
          setContactEmail(email);
          setProfileLoadError('Your supplier profile could not be reached. Check your connection and reload this page.');
        }
      } finally {
        if (!cancelled) setIsLoadingProfile(false);
      }
    }

    loadVendorProfile();
    return () => {
      cancelled = true;
    };
  }, [currentUserSession?.email, groupMinorCategories]);

  // Calculate totals
  const totalSelectedMinorCount = Object.values(selectedMinor).reduce((acc, curr) => acc + curr.length, 0);

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
      const allMinor = getMinorCategories(majorName);
      const remainingSlots = MAX_CATEGORIES - totalSelectedMinorCount;
      if (remainingSlots <= 0) {
        showToast('Limit Reached', `Maximum ${MAX_CATEGORIES} categories allowed. Please uncheck some categories first.`, 'warning');
        return;
      }
      const allowedMinors = allMinor.slice(0, remainingSlots);
      setSelectedMinor((prev) => ({ ...prev, [majorName]: allowedMinors }));
    }
  };

  // Toggle Minor Category (Strict Max 10 Check)
  const toggleMinorCategory = (majorName: string, minorName: string) => {
    const currentList = selectedMinor[majorName] || [];
    const isCurrentlyChecked = currentList.includes(minorName);

    if (!isCurrentlyChecked) {
      if (totalSelectedMinorCount >= MAX_CATEGORIES) {
        showToast(
          'Maximum 10 Categories Reached',
          `You have selected ${totalSelectedMinorCount}/${MAX_CATEGORIES} categories. Please uncheck a category to add "${minorName}".`,
          'warning'
        );
        return;
      }

      setSelectedMajor((majors) => (majors.includes(majorName) ? majors : [...majors, majorName]));
      setSelectedMinor((prev) => ({
        ...prev,
        [majorName]: [...(prev[majorName] || []), minorName],
      }));
    } else {
      setSelectedMinor((prev) => {
        const updated = (prev[majorName] || []).filter((m) => m !== minorName);
        const next = { ...prev, [majorName]: updated };
        if (updated.length === 0) {
          delete next[majorName];
          setSelectedMajor((majors) => majors.filter((m) => m !== majorName));
        }
        return next;
      });
    }
  };

  // Handle adding custom category or auto-selecting existing category
  const handleAddCustomCategory = () => {
    const trimmed = customCategoryInput.trim();
    if (!trimmed) {
      showToast('Validation Error', UI_STRINGS.vendorProfile.categoryEmptyMessage, 'warning');
      return;
    }

    const normalized = trimmed.toLowerCase();

    // 1. Search existing categories across displayTaxonomy
    let matchedMajor = '';
    let matchedMinor = '';

    // Check exact match in minor categories
    for (const group of displayTaxonomy) {
      const found = (group.minorCategories || []).find(
        (m) => m.trim().toLowerCase() === normalized
      );
      if (found) {
        matchedMajor = group.majorCategory;
        matchedMinor = found;
        break;
      }
    }

    // Check match in major categories
    if (!matchedMinor) {
      for (const group of displayTaxonomy) {
        if (group.majorCategory.trim().toLowerCase() === normalized) {
          matchedMajor = group.majorCategory;
          matchedMinor = (group.minorCategories && group.minorCategories[0]) || group.majorCategory;
          break;
        }
      }
    }

    // Check substring / partial match in minor categories
    if (!matchedMinor) {
      for (const group of displayTaxonomy) {
        const found = (group.minorCategories || []).find(
          (m) =>
            m.trim().toLowerCase().includes(normalized) ||
            normalized.includes(m.trim().toLowerCase())
        );
        if (found) {
          matchedMajor = group.majorCategory;
          matchedMinor = found;
          break;
        }
      }
    }

    // Check registry lookup fallback
    if (!matchedMinor) {
      const regMajor = findMajorForMinor(trimmed);
      if (regMajor) {
        matchedMajor = regMajor;
        matchedMinor = trimmed;
      }
    }

    if (matchedMajor && matchedMinor) {
      // Found in existing taxonomy: automatically mark tick or alert
      const currentList = selectedMinor[matchedMajor] || [];
      if (currentList.includes(matchedMinor)) {
        showToast(
          'Category Already Selected',
          `"${matchedMinor}" under "${matchedMajor}" is already selected.`,
          'info'
        );
        setExpandedMajor((prev) => ({ ...prev, [matchedMajor]: true }));
        setCustomCategoryInput('');
        return;
      }

      if (totalSelectedMinorCount >= MAX_CATEGORIES) {
        showToast(
          'Maximum 10 Categories Reached',
          `You have selected ${totalSelectedMinorCount}/${MAX_CATEGORIES} categories. Please uncheck a category to select "${matchedMinor}".`,
          'warning'
        );
        return;
      }

      setSelectedMajor((majors) => (majors.includes(matchedMajor) ? majors : [...majors, matchedMajor]));
      setSelectedMinor((prev) => ({
        ...prev,
        [matchedMajor]: [...(prev[matchedMajor] || []), matchedMinor],
      }));
      setExpandedMajor((prev) => ({ ...prev, [matchedMajor]: true }));
      setCustomCategoryInput('');
      showToast(
        'Category Selected',
        `Found and automatically selected "${matchedMinor}" under "${matchedMajor}".`,
        'success'
      );
      return;
    }

    // 2. Otherwise: add under 'Other' for this vendor only and mark that tick / selected
    const otherGroup = CUSTOM_CATEGORY_GROUP;
    const otherList = selectedMinor[otherGroup] || [];
    if (otherList.some((m) => m.trim().toLowerCase() === normalized)) {
      showToast('Category Exists', `"${trimmed}" is already added under ${otherGroup}.`, 'info');
      setExpandedMajor((prev) => ({ ...prev, [otherGroup]: true }));
      setCustomCategoryInput('');
      return;
    }

    if (totalSelectedMinorCount >= MAX_CATEGORIES) {
      showToast(
        'Maximum 10 Categories Reached',
        `You have selected ${totalSelectedMinorCount}/${MAX_CATEGORIES} categories. Please uncheck a category to add "${trimmed}".`,
        'warning'
      );
      return;
    }

    setSelectedMajor((majors) => (majors.includes(otherGroup) ? majors : [...majors, otherGroup]));
    setSelectedMinor((prev) => ({
      ...prev,
      [otherGroup]: [...(prev[otherGroup] || []), trimmed],
    }));
    setExpandedMajor((prev) => ({ ...prev, [otherGroup]: true }));
    setCustomCategoryInput('');
    showToast(
      'Added to Other',
      `"${trimmed}" has been added under ${otherGroup} and selected for your profile.`,
      'success'
    );
  };

  // Handle removing a selected category directly
  const handleRemoveCategory = (categoryName: string) => {
    setSelectedMinor((prev) => {
      const next: Record<string, string[]> = {};
      let removedMajor = '';
      for (const [major, minors] of Object.entries(prev)) {
        const filtered = minors.filter((m) => m !== categoryName);
        if (filtered.length > 0) {
          next[major] = filtered;
        } else {
          removedMajor = major;
        }
      }
      if (removedMajor) {
        setSelectedMajor((majors) => majors.filter((m) => m !== removedMajor));
      }
      return next;
    });
  };

  // Collect all available categories across taxonomy for autocomplete search
  const allAvailableCategories = React.useMemo(() => {
    const list: { name: string; major: string }[] = [];
    (categoryTaxonomy || []).forEach((c) => {
      if (c.majorCategory && !list.some((item) => item.name.toLowerCase() === c.majorCategory.toLowerCase())) {
        list.push({ name: c.majorCategory, major: c.majorCategory });
      }
      (c.minorCategories || []).forEach((m) => {
        if (m && !list.some((item) => item.name.toLowerCase() === m.toLowerCase())) {
          list.push({ name: m, major: c.majorCategory });
        }
      });
    });
    return list;
  }, [categoryTaxonomy]);

  const filteredCategorySuggestions = React.useMemo(() => {
    const q = customCategoryInput.trim().toLowerCase();
    if (q.length < 3) return [];
    return allAvailableCategories.filter(
      (item) => item.name.toLowerCase().includes(q) || item.major.toLowerCase().includes(q)
    );
  }, [customCategoryInput, allAvailableCategories]);

  // The category master as the database returned it. Empty while loading or after a failure.
  const displayTaxonomy = categoryTaxonomy;

  // Include custom categories in the active taxonomy list under 'Other'
  const customMinors = selectedMinor[CUSTOM_CATEGORY_GROUP] || [];
  const activeTaxonomy = [...displayTaxonomy];
  const otherIdx = activeTaxonomy.findIndex(
    (c) => c.majorCategory.trim().toLowerCase() === CUSTOM_CATEGORY_GROUP.toLowerCase()
  );
  if (otherIdx >= 0) {
    const existing = activeTaxonomy[otherIdx].minorCategories || [];
    const merged = Array.from(new Set([...existing, ...customMinors]));
    activeTaxonomy[otherIdx] = {
      ...activeTaxonomy[otherIdx],
      minorCategories: merged,
    };
  } else if (customMinors.length > 0) {
    activeTaxonomy.push({
      majorCategory: CUSTOM_CATEGORY_GROUP,
      minorCategories: customMinors,
    });
  }

  // Filtered Categories based on search
  const filteredCategories = activeTaxonomy.filter((cat) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesMajor = cat.majorCategory.toLowerCase().includes(term);
    const matchesMinor = cat.minorCategories.some((m) => m.toLowerCase().includes(term));
    return matchesMajor || matchesMinor;
  });

  // Buyer-mapped categories come only from this vendor's own backend record. The shared store
  // copy is not scoped to a vendor, so it is never substituted here.
  const clientCats: string[] = loadedClientCats;
  const flatSelectedCategories = Object.values(selectedMinor).flat();
  const clientLower = clientCats.map((c: string) => c.toLowerCase().trim());
  const vendorLower = flatSelectedCategories.map((c) => c.toLowerCase().trim());

  const commonCategories = flatSelectedCategories.filter((v) => clientLower.includes(v.toLowerCase().trim()));
  const vendorOnlyCategories = flatSelectedCategories.filter((v) => !clientLower.includes(v.toLowerCase().trim()));
  const clientOnlyCategories = clientCats.filter((c: string) => !vendorLower.includes(c.toLowerCase().trim()));
  const isAligned = clientCats.length > 0 && commonCategories.length === clientCats.length && flatSelectedCategories.length === clientCats.length;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !panNumber.trim() || !gstNumber.trim()) {
      showToast('Validation Error', 'Company Name, PAN, and GSTIN are required.', 'warning');
      return;
    }
    if (!isPanValid(panNumber)) {
      showToast('Validation Error', 'PAN number format is invalid (expected e.g. AAACA9876K).', 'warning');
      return;
    }
    if (!isGstValid(gstNumber)) {
      showToast('Validation Error', 'GSTIN format is invalid.', 'warning');
      return;
    }
    if (flatSelectedCategories.length === 0) {
      showToast('Validation Error', 'Select at least one manufacturing / supply category.', 'warning');
      return;
    }
    if (pincode.trim() && pincodeError) {
      showToast('Validation Error', pincodeError, 'warning');
      return;
    }
    if (!currentUserSession?.email) {
      showToast('Not Signed In', 'Your session could not be verified. Please sign in again.', 'warning');
      return;
    }

    const token = authClient.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    setIsSaving(true);
    try {
      const profilePayload = {
        name: companyName,
        brandName,
        // Omitted (not sent as an empty string) when the vendor has not chosen one.
        orgType: orgType || undefined,
        pan: panNumber,
        gst: gstNumber,
        msme: msmeNumber,
        website,
        annualTurnover,
        factoryAddress,
        city,
        state,
        pincode,
        country,
        location: [factoryAddress, city, state && pincode ? `${state} ${pincode}` : state, country]
          .filter((part) => part && part.trim())
          .join(', '),
        contactPerson: contactName,
        contactDesignation,
        phone: contactPhone,
        majorCategory: selectedMajor[0] || '',
        minorCategories: flatSelectedCategories,
      };

      let currentId = vendorRecordId;
      if (currentId) {
        const res = await fetch(`/api/vendors/${encodeURIComponent(currentId)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(profilePayload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to save profile.');
        }
      } else {
        const res = await fetch('/api/vendors', {
          method: 'POST',
          headers,
          body: JSON.stringify(profilePayload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to create vendor profile.');
        }
        currentId = data.data.id;
        setVendorRecordId(currentId);
      }

      const catRes = await fetch(`/api/vendors/${encodeURIComponent(currentId as string)}/categories`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          clientMappedCategories: clientCats,
          vendorSelectedCategories: flatSelectedCategories,
        }),
      });
      const catData = await catRes.json();
      if (!catRes.ok || !catData.success) {
        throw new Error(catData.error || 'Failed to save category taxonomy.');
      }
      setLoadedClientCats(catData.data.clientMappedCategories || clientCats);

      if (saveVendorProfileCategories) {
        saveVendorProfileCategories(contactEmail, clientCats, flatSelectedCategories);
      }
      addAuditLog(`Updated Vendor Supplier Profile & Manufacturing Capabilities for ${companyName}`);
      showToast('Profile Saved', 'Supplier details and manufacturing categories updated successfully.', 'success');
    } catch (err: unknown) {
      showToast(
        'Save Failed',
        err instanceof Error && err.message ? err.message : 'Could not save the supplier profile. Please try again.',
        'warning'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <span className="badge badge-emerald font-mono uppercase">
            {vendorSubscription} Tier Supplier
          </span>
          <p className="max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-gray-400">
            Manage company registration, PAN/GSTIN compliance, and define your manufacturing / supply categories for direct buyer RFQs.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href="#account-security"
            className="btn btn-secondary btn-md font-bold flex items-center gap-1.5 shadow-xs"
          >
            <KeyRound size={16} className="text-emerald-600 dark:text-emerald-400" />
            <span>Update Password</span>
          </a>
          <button
            onClick={handleSaveProfile}
            disabled={isLoadingProfile || isSaving || Boolean(profileLoadError)}
            className="btn btn-emerald btn-md shadow-lg shadow-emerald-600/20 font-bold flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save size={16} /> {isSaving ? 'Saving...' : 'Save Supplier Profile'}
          </button>
        </div>
      </div>

      {isLoadingProfile && (
        <p className="text-xs text-slate-500 dark:text-gray-400 -mt-2">Loading your supplier profile…</p>
      )}

      {profileLoadError && (
        <p role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {profileLoadError}
        </p>
      )}

      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Section 1: Legal Entity & Tax Compliance */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="text-emerald-600 dark:text-emerald-400" size={18} /> Section 1: Supplier Tax & Business Details
            </h2>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Company Name */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Vendor Legal Entity Name *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>

            {/* Trade Name */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Trade Name / Brand
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
                Business Constitution *
              </label>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value as typeof orgType)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              >
                <option value="" disabled>—</option>
                <option value="Private Limited">Private Limited Company</option>
                <option value="Public Limited">Public Limited Company</option>
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
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ Valid format</span>
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
              {panNumber.trim() && !isPanValid(panNumber) && (
                <p className="text-[10px] text-rose-500 font-medium mt-1">
                  Invalid PAN format (expected 5 letters, 4 numbers, 1 letter, e.g. AAACA9876K)
                </p>
              )}
            </div>

            {/* GST Number */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                  GSTIN / GST Number *
                </label>
                {isGstValid(gstNumber) ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ Valid format</span>
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
              {gstNumber.trim() && !isGstValid(gstNumber) && (
                <p className="text-[10px] text-rose-500 font-medium mt-1">
                  Invalid GSTIN format (15 characters alphanumeric, e.g. 29AAAAA0000A1Z5)
                </p>
              )}
            </div>

            {/* MSME / Udyam Number */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                MSME / Udyam Registration
              </label>
              <input
                type="text"
                value={msmeNumber}
                onChange={(e) => setMsmeNumber(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase"
              />
            </div>

            {/* Website */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Company Website
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
                Annual Turnover
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

        {/* Section 2: Address & Sales Contact */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Factory / Works Address */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-3">
              <MapPin className="text-emerald-600 dark:text-emerald-400" size={18} /> Works / Factory Address
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Street / Industrial Area</label>
                <input
                  type="text"
                  value={factoryAddress}
                  onChange={(e) => setFactoryAddress(e.target.value)}
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
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">PIN Code</label>
                    {pincodeValidating && (
                      <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Checking
                      </span>
                    )}
                    {!pincodeValidating && pincodePostOffices.length > 0 && !pincodeError && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> Valid
                      </span>
                    )}
                    {!pincodeValidating && pincodeError && pincode.trim().length >= 6 && (
                      <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                        <AlertCircle size={10} /> Invalid
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={pincode}
                    maxLength={6}
                    onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5 ${
                      pincodeError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-800'
                    }`}
                  />
                  {pincodeError && pincode.trim().length >= 6 && (
                    <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{pincodeError}</p>
                  )}
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

          {/* Primary Sales Contact */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-3">
              <User className="text-emerald-600 dark:text-emerald-400" size={18} /> Sales & RFQ Contact Person
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
                    disabled
                    title="This is your account login email and can't be changed here."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-100 dark:bg-gray-900 text-slate-500 dark:text-gray-400 mt-0.5 cursor-not-allowed"
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

        {/* Section 3: Consolidated Major & Minor Categories Selector & Dual-Stream Reconciliation */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="text-emerald-600 dark:text-emerald-400" size={18} /> Section 3: Dual-Stream Category Reconciliation &amp; Taxonomy (Max 10 Categories)
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Manage your self-selected supply capabilities (up to 10 categories). The system reconciles buyer-mapped categories and routes RFQs across both streams.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${
                totalSelectedMinorCount >= MAX_CATEGORIES
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200'
              }`}>
                {totalSelectedMinorCount} / {MAX_CATEGORIES} Categories Selected
              </span>
            </div>
          </div>

          {/* DUAL-STREAM CATEGORY RECONCILIATION SUMMARY DASHBOARD */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-gray-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Layers className="text-indigo-600 dark:text-indigo-400" size={16} />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Category Alignment &amp; Backend Storage Status
                </h3>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 ${
                isAligned
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300'
                  : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300'
              }`}>
                {isAligned ? '✓ 100% Categories Aligned' : '🛡️ Dual-Category Backend Storage Active'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Card 1: Client Mapped Categories (from PO / Historical Data) */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    🏢 Client Mapped Categories <span className="text-slate-400 text-[10px] font-normal">(Buyer Empanelled)</span>
                  </span>
                  <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    {clientCats.length} Categories
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[36px]">
                  {clientCats.length > 0 ? (
                    clientCats.map((c: string) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50"
                      >
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">No buyer-mapped categories assigned yet.</span>
                  )}
                </div>
                <p className="text-[9.5px] text-slate-400">
                  Extracted from historical buyer pre-purchase orders &amp; master records.
                </p>
              </div>

              {/* Card 2: Vendor Profile Self-Selected Categories (Table Format) */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    ⚙️ Vendor Self-Selected <span className="text-slate-400 text-[10px] font-normal">(Max 10)</span>
                  </span>
                  <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {flatSelectedCategories.length} / {MAX_CATEGORIES} Selected
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-gray-900/60 shadow-xs">
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400 uppercase tracking-wider text-[10px] font-bold border-b border-slate-200 dark:border-gray-800 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left w-10">#</th>
                          <th className="px-3 py-2 text-left">Category / Capability Name</th>
                          <th className="px-3 py-2 text-left">Major Category</th>
                          <th className="px-3 py-2 text-center">Status</th>
                          <th className="px-3 py-2 text-right w-32">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-800 text-[11px]">
                        {flatSelectedCategories.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-slate-400 text-xs">
                              {UI_STRINGS.vendorProfile.noCategoriesSelected}
                            </td>
                          </tr>
                        ) : (
                          flatSelectedCategories.map((c, idx) => {
                            const majorName = findMajorForMinor(c) || CUSTOM_CATEGORY_GROUP;
                            const isClientMapped = clientCats.some((cc) => cc.toLowerCase() === c.toLowerCase());
                            const isDualAligned = isClientMapped;

                            return (
                              <tr key={c} className="hover:bg-slate-50/70 dark:hover:bg-gray-850/40 transition-colors">
                                <td className="px-3 py-2 font-mono text-slate-400 font-bold">{idx + 1}</td>
                                <td className="px-3 py-2 font-bold text-slate-900 dark:text-white">
                                  {c}
                                </td>
                                <td className="px-3 py-2 text-slate-500 dark:text-gray-400 font-medium">
                                  Domain: {majorName}
                                </td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {isDualAligned ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200">
                                      ✓ Dual Aligned
                                    </span>
                                  ) : isClientMapped ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400 border border-indigo-200">
                                      Buyer-Empanelled
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200">
                                      Self-Selected
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  <div className="flex justify-end items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setViewCategory({
                                          name: c,
                                          major: majorName,
                                          status: isDualAligned ? 'Dual Aligned (Buyer & Vendor)' : isClientMapped ? 'Buyer-Empanelled' : 'Self-Selected',
                                        })
                                      }
                                      className="btn btn-secondary btn-xs font-semibold inline-flex items-center gap-1"
                                      title={`View details for ${c}`}
                                    >
                                      <Eye size={11} /> View
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveCategory(c)}
                                      className="btn btn-ghost btn-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/60 inline-flex items-center gap-1 cursor-pointer"
                                      title={`${UI_STRINGS.vendorProfile.removeCategoryTitle}: ${c}`}
                                      aria-label={`${UI_STRINGS.vendorProfile.removeCategoryTitle}: ${c}`}
                                    >
                                      <Trash2 size={11} /> Remove
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Reconciliation Breakdown & Dispatch Policy */}
            <div className="p-3 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/40 text-[11px] space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400" />
                  Backend Storage &amp; Dual RFQ Dispatch Policy:
                </span>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold">
                    {commonCategories.length} Aligned
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 font-bold">
                    +{vendorOnlyCategories.length} Vendor-Extended
                  </span>
                  {clientOnlyCategories.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold">
                      +{clientOnlyCategories.length} Client-Only
                    </span>
                  )}
                </div>
              </div>
              <p className="text-slate-600 dark:text-gray-300 text-[10.5px] leading-relaxed">
                {isAligned
                  ? 'All categories perfectly match between buyer roster and your self-selection. RFQs are fully aligned.'
                  : 'If there is any discrepancy between client-mapped categories and your self-selected categories, our backend permanently saves BOTH category sets. The matching engine routes RFQs corresponding to both streams to your opportunity feed so you never miss an opportunity.'}
              </p>
            </div>
          </div>

          {/* Dedicated Vendor Custom Category Creation Card */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-emerald-200/70 dark:border-emerald-900/40 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <Plus size={16} className="text-emerald-600 dark:text-emerald-400 font-bold" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  {UI_STRINGS.vendorProfile.customCategoriesTitle}
                </h3>
              </div>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                {UI_STRINGS.vendorProfile.customCategoriesSubtitle}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
              {UI_STRINGS.vendorProfile.customCategoriesDesc}
            </p>
            <div className="relative flex flex-col sm:flex-row gap-2 pt-1" ref={categorySearchContainerRef}>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={customCategoryInput}
                  onChange={(e) => {
                    setCustomCategoryInput(e.target.value);
                    setShowCategorySuggestions(true);
                  }}
                  onFocus={() => {
                    if (customCategoryInput.trim().length >= 3) {
                      setShowCategorySuggestions(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomCategory();
                    } else if (e.key === 'Escape') {
                      setShowCategorySuggestions(false);
                    }
                  }}
                  placeholder={UI_STRINGS.vendorProfile.customCategoryPlaceholder}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-white dark:bg-gray-900 text-slate-900 dark:text-white placeholder:text-slate-400"
                />
                {customCategoryInput.trim().length > 0 && customCategoryInput.trim().length < 3 && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                    Type at least 3 characters to search master categories
                  </p>
                )}
                {showCategorySuggestions && customCategoryInput.trim().length >= 3 && (
                  <div
                    role="listbox"
                    className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl divide-y divide-slate-100 dark:divide-gray-700/60"
                  >
                    <div className="px-3 py-1.5 bg-slate-50 dark:bg-gray-900/80 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center justify-between">
                      <span>Matching Categories ({filteredCategorySuggestions.length})</span>
                      <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-semibold">Taxonomy Master</span>
                    </div>
                    {filteredCategorySuggestions.length > 0 ? (
                      filteredCategorySuggestions.map((item) => (
                        <button
                          key={`${item.major}-${item.name}`}
                          type="button"
                          role="option"
                          aria-selected={customCategoryInput === item.name}
                          onClick={() => {
                            setCustomCategoryInput(item.name);
                            setShowCategorySuggestions(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/60 flex items-center justify-between text-slate-700 dark:text-gray-200 transition-colors"
                        >
                          <span className="font-semibold text-slate-800 dark:text-white">{item.name}</span>
                          <span className="text-[10px] text-slate-400 italic">{item.major}</span>
                        </button>
                      ))
                    ) : (
                      <div className="p-3 text-center space-y-1">
                        <p className="text-xs text-slate-500 dark:text-gray-400">No matching master categories found</p>
                        <p className="text-[11px] text-indigo-600 dark:text-indigo-400">
                          Click &quot;+ Add Category&quot; to add &quot;{customCategoryInput.trim()}&quot; as custom capability
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleAddCustomCategory}
                disabled={!customCategoryInput.trim()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer shadow-xs whitespace-nowrap self-start"
              >
                <Plus size={14} />
                <span>{UI_STRINGS.vendorProfile.addCategoryButton}</span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search supply categories (e.g. Valves, Bearings, Motors, Cables, Fasteners)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
            />
          </div>

          {/* Categories Selector Grid */}
          <div className="space-y-3 pt-1">
            {categoryTaxonomy.length === 0 && (
              <p role="alert" className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {categoryTaxonomyError || UI_STRINGS.buyerProfile.taxonomyEmpty}
              </p>
            )}
            {categoryTaxonomy.length > 0 && filteredCategories.length === 0 && (
              <p className="text-xs font-semibold text-slate-500 dark:text-gray-400">
                No supply categories match your search.
              </p>
            )}
            {filteredCategories.map((cat) => {
              const isMajorSelected = selectedMajor.includes(cat.majorCategory);
              const selectedMinorsInCat = selectedMinor[cat.majorCategory] || [];
              const isExpanded = expandedMajor[cat.majorCategory] || false;

              return (
                <div
                  key={cat.majorCategory}
                  className={`rounded-2xl border transition-all ${
                    isMajorSelected
                      ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/60'
                  }`}
                >
                  {/* Major Category Bar */}
                  <div className="p-3.5 flex items-center justify-between gap-3 cursor-pointer">
                    <div className="flex items-center gap-3 flex-1" onClick={() => toggleMajorCategory(cat.majorCategory)}>
                      <button type="button" className="text-emerald-600 dark:text-emerald-400">
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
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 mono bg-white dark:bg-gray-900 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                        {selectedMinorsInCat.length} Selected
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
                          Minor Supply Items (Click to select/unselect)
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {totalSelectedMinorCount} / {MAX_CATEGORIES} total profile limit
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {cat.minorCategories.map((minor) => {
                          const isMinorChecked = selectedMinorsInCat.includes(minor);
                          const isClientMapped = clientCats.includes(minor);
                          return (
                            <label
                              key={minor}
                              className={`p-2 rounded-xl border text-[11px] font-medium flex items-center gap-2 cursor-pointer transition-colors ${
                                isMinorChecked
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                  : 'bg-slate-50 dark:bg-gray-950 text-slate-700 dark:text-gray-300 border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isMinorChecked}
                                onChange={() => toggleMinorCategory(cat.majorCategory, minor)}
                                className="sr-only"
                              />
                              <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border ${isMinorChecked ? 'bg-white text-emerald-600 border-white' : 'border-slate-400'}`}>
                                {isMinorChecked && <span className="text-[10px] font-bold">✓</span>}
                              </div>
                              <span className="truncate flex-1" title={minor}>{minor}</span>
                              {isClientMapped && (
                                <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase shrink-0 ${isMinorChecked ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'}`} title="Mapped by buyer">
                                  Buyer
                                </span>
                              )}
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
            disabled={isLoadingProfile || isSaving || Boolean(profileLoadError)}
            className="btn btn-emerald btn-lg shadow-xl shadow-emerald-600/20 font-bold flex items-center gap-2 px-8 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save size={18} /> {isSaving ? 'Saving...' : 'Save & Reconcile Vendor Profile'}
          </button>
        </div>
      </form>

      {/* Section 4: Account & Security (Update Password) */}
      {/* Sits outside the profile form above on purpose. The panel has its */}
      {/* own submit handlers, and nesting a <form> inside another is invalid */}
      {/* HTML — the inner one is dropped during parsing, which would wire the */}
      {/* password button up to the profile save instead. */}
      <div id="account-security" className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <KeyRound className="text-emerald-600 dark:text-emerald-400" size={18} />{' '}
              {UI_STRINGS.accountSecurity.sectionTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              {UI_STRINGS.accountSecurity.sectionDescription}
            </p>
          </div>
          <span className="badge badge-emerald text-[11px] font-bold px-2.5 py-1 rounded-full self-start sm:self-auto flex items-center gap-1">
            <ShieldCheck size={12} /> Password Security
          </span>
        </div>

        <AccountSecurityPanel />
      </div>

      {/* Category View Modal */}
      {viewCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="text-emerald-600 dark:text-emerald-400" size={18} />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Category Details</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewCategory(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Category Name</span>
                <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{viewCategory.name}</p>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Major Category</span>
                <p className="font-semibold text-slate-700 dark:text-gray-300 mt-0.5">{viewCategory.major}</p>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Alignment Status</span>
                <p className="font-semibold text-slate-700 dark:text-gray-300 mt-0.5">{viewCategory.status}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewCategory(null)}
                className="btn btn-secondary btn-sm px-4"
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
