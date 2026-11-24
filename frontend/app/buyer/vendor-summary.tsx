'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { fetchAllVendors } from '@/lib/rfqClient';
import { fetchBuyerProfile } from '@/lib/buyerProfileClient';
import { VendorEvaluationRecord, VendorEntry, VendorPageMeta } from '@/lib/types';
import { getMinorCategories, findMajorForMinor, resolveMinorCategory } from '@/lib/categoryTaxonomy';
import {
  BUYER_VENDOR_DIRECTORY_COLUMNS,
  createBooleanSetterHandler,
  createColumnResetHandler,
  createColumnSortClickHandler,
  getSortIndicatorSymbol,
  getTableAriaSort,
  getTableColumnClass,
  isBuyerUploadedVendor,
  canBuyerManageVendor,
  isPlaceholderVendorCategory,
  isProcucevNetworkVendor,
  isVendorActive,
  isVendorInactive,
  resolveVendorDisplayName,
  loadVendorUploadHistoryFromStorage,
  setVendorsActiveStateInStorage,
  normalizeVendorCategoryList,
  reconcileBuyerVendorsWithUploadHistory,
  resolveVendorLocationFields,
  sortTableRows,
  normalizeVendorRating,
  VENDOR_ACTIVE_STATUSES,
  type TableColumnOption,
  type TableSortState,
} from '@/lib/constants';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import VendorUploadModal from '@/app/category-manager/VendorUploadModal';
import ColumnSettingsPopup from '@/app/category-manager/components/ColumnSettingsPopup';
import {
  Search,
  Building2,
  FileCheck,
  ChevronRight,
  ShieldCheck,
  Mail,
  MapPin,
  Plus,
  CheckCircle2,
  Lock,
  Star,
  Send,
  X,
  AlertCircle,
  UploadCloud,
  Users,
  Eye,
  Pencil,
  Power,
  PowerOff,
  Phone,
  Globe,
  FileText,
  Layers,
  Award,
  DollarSign,
  Tag,
  Check,
  Loader2,
  History,
  Download,
  FileSpreadsheet,
  Clock,
  Filter,
  ArrowLeft,
  Settings,
} from 'lucide-react';
import {
  validatePincode,
  resolveCityAndStateFromPostalResult,
  PostOfficeDetail,
  PINCODE_PATTERN,
  isDummyPincode,
  usablePan,
  EXACT_10_DIGIT_MOBILE_PATTERN,
  sanitize10DigitMobile,
  GSTIN_PATTERN,
} from '@/lib/validationSchemas';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { logger } from '@/lib/logger';

export let ENABLE_VENDOR_RATING = false; // Changed from FEATURE_FLAGS.ENABLE_VENDOR_RATING
export let ENABLE_VENDOR_EVALUATION_REQUEST = FEATURE_FLAGS.ENABLE_VENDOR_EVALUATION_REQUEST;
export let ENABLE_EDIT_VENDOR_PROFILE = false; // New flag to hide Edit Profile button
export let ENABLE_VENDOR_EVALUATION = FEATURE_FLAGS.ENABLE_VENDOR_EVALUATION;
export const setEnableVendorRating = (val: boolean) => {
  ENABLE_VENDOR_RATING = val;
};
export const setEnableVendorEvaluationRequest = (val: boolean) => {
  ENABLE_VENDOR_EVALUATION_REQUEST = val;
};
export const setEnableEditVendorProfile = (val: boolean) => {
  ENABLE_EDIT_VENDOR_PROFILE = val;
};
export const setEnableVendorEvaluation = (val: boolean) => {
  ENABLE_VENDOR_EVALUATION = val;
};

interface VendorSummaryProps {
  onViewEvaluation: (record: VendorEvaluationRecord) => void;
  onNavigateToWizard?: () => void;
}

// Shown for a statutory value the vendor record does not hold. A placeholder PAN goes through usablePan first, so it
// is shown the same way.
const statutoryText = (value: unknown): string => {
  if (typeof value !== 'string') return UI_STRINGS.recordPlaceholders.notApplicable;
  const clean = value.trim();
  return clean === '' ? UI_STRINGS.recordPlaceholders.notApplicable : clean;
};

/**
 * Matches a vendor row to an evaluation record by vendor ID first, then email,
 * falling back to vendor name only when stored emails do not conflict.
 */
function findMatchingEvaluation(
  evaluations: VendorEvaluationRecord[],
  vendor: VendorEntry
): VendorEvaluationRecord | undefined {
  const vendorId = String(vendor.id || '').trim();
  if (vendorId) {
    const byId = evaluations.find((e) => e.vendorId && e.vendorId === vendorId);
    if (byId) return byId;
  }

  const vendorEmail = String(vendor.email || '').trim().toLowerCase();
  if (vendorEmail) {
    const byEmail = evaluations.find((e) => e.email && e.email.trim().toLowerCase() === vendorEmail);
    if (byEmail) return byEmail;
  }

  const vendorName = String(vendor.name || '').trim().toLowerCase();
  if (!vendorName) return undefined;
  return evaluations.find((e) => {
    const evalName = String(e.vendorName || '').trim().toLowerCase();
    if (!evalName || evalName !== vendorName) return false;
    const evalEmail = String(e.email || '').trim().toLowerCase();
    return !(vendorEmail && evalEmail && evalEmail !== vendorEmail);
  });
}

// Classification helpers shared across Buyer Vendor Directory and Evaluation Summary.
export const isBuyerUploaded = isBuyerUploadedVendor;
export const isProcucevVendor = isProcucevNetworkVendor;

export default function VendorSummary({ onViewEvaluation, onNavigateToWizard }: VendorSummaryProps) {
  const {
    vendorEvaluations,
    currentMode,
    rfqs,
    showToast,
    buyerVendors,
    addBuyerVendor,
    updateBuyerVendor,
    setBuyerVendorActiveStatus,
    setMultipleBuyerVendorsActiveStatus,
    categoryTaxonomy,
    ensureCategoryTaxonomy,
    reviseVendorRating,
    requestVendorEvaluation,
    openRatingRevisionEmailModal,
    activeBuyerAccount,
    currentUserSession,
    initialSetupCompleted,
    setInitialSetupCompleted,
    isLoadingVendors,
    fetchVendorEvaluation,
  } = useApp();

  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [bulkStatusModalOpen, setBulkStatusModalOpen] = useState(false);
  const [bulkTargetIsActive, setBulkTargetIsActive] = useState(false);
  const [isUpdatingBulkStatus, setIsUpdatingBulkStatus] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Buyer's own registered pincode, fetched once — used to rank vendors with
  // a matching pincode first, same relevance-then-pincode rule the backend
  // already applies to mode_2 RFQ dispatch (createRFQ) and RFQ invite emails
  const [buyerPincode, setBuyerPincode] = useState<string | null>(() => {
    return activeBuyerAccount?.pincode ? String(activeBuyerAccount.pincode).trim() : null;
  });
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (activeBuyerAccount?.pincode) {
      setBuyerPincode(String(activeBuyerAccount.pincode).trim() || null);
      return;
    }
    if (currentUserSession?.role && currentUserSession.role !== 'buyer') {
      return;
    }
    void fetchBuyerProfile({ signal: controller.signal }).then((result) => {
      if (cancelled) return;
      if (result.success && result.data?.pincode) {
        setBuyerPincode(String(result.data.pincode).trim() || null);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeBuyerAccount?.pincode, currentUserSession?.role]);

  useEffect(() => {
    if (ensureCategoryTaxonomy) {
      void ensureCategoryTaxonomy();
    }
  }, [ensureCategoryTaxonomy]);

  // Pincode-first sort: vendors whose pincode matches the buyer's own are
  // moved to the front, preserving whatever relative order (rating, etc.)
  // each group already had — mirrors the backend's pincode-match-then-rating
  // ranking rather than introducing a separate ordering rule client-side.
  const sortByPincodeMatch = (list: any[]) => {
    if (!buyerPincode) return list;
    const matches: any[] = [];
    const nonMatches: any[] = [];
    for (const v of list) {
      if (v.pincode && String(v.pincode).trim() === buyerPincode) {
        matches.push(v);
      } else {
        nonMatches.push(v);
      }
    }
    return [...matches, ...nonMatches];
  };

  // CRUD Modals State
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [bulkUploadModalOpen, setBulkUploadModalOpen] = useState(false);
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [isSavingCategories, setIsSavingCategories] = useState(false);
  const [vendorPoSuggestion, setVendorPoSuggestion] = useState<{
    majorCategory: string;
    minorCategories: string[];
    source: string;
  } | null>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [targetStatusIsActive, setTargetStatusIsActive] = useState(false);
  const [isUpdatingSingleStatus, setIsUpdatingSingleStatus] = useState(false);
  const [selectedVendorForCrud, setSelectedVendorForCrud] = useState<any | null>(null);

  // Rating Revision State
  const [selectedVendorForRevision, setSelectedVendorForRevision] = useState<any | null>(null);
  const [qualityScore, setQualityScore] = useState<number | string>('');
  const [costScore, setCostScore] = useState<number | string>('');
  const [deliveryScore, setDeliveryScore] = useState<number | string>('');
  const [remarks, setRemarks] = useState('');
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);
  const isSubmittingRevisionRef = useRef(false);
  const [isRequestingEvaluation, setIsRequestingEvaluation] = useState(false);

  // CRUD Form State
  const [formName, setFormName] = useState('');
  const [formBrandName, setFormBrandName] = useState('');
  const [formMajorCategory, setFormMajorCategory] = useState('');
  const [formMinorCategories, setFormMinorCategories] = useState<string[]>([]);
  const [formMinorInput, setFormMinorInput] = useState('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [formContactPerson, setFormContactPerson] = useState('');
  const [formContactDesignation, setFormContactDesignation] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [phoneFieldError, setPhoneFieldError] = useState<string | null>(null);
  const [formLocation, setFormLocation] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');
  const [formCountry, setFormCountry] = useState('India');
  const [formPincode, setFormPincode] = useState('');
  const [formPincodeError, setFormPincodeError] = useState<string | null>(null);
  const [formPincodeValidating, setFormPincodeValidating] = useState(false);
  const [formPincodePostOffices, setFormPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  // The PIN the form holds now. A lookup that returns after the PIN has changed is ignored.
  const formPincodeLatestRef = useRef('');
  // True while the Add Vendor form is open, so a verified PIN fills its City and State. Opening an existing vendor's
  // edit form turns it off, so a lookup never overwrites the City and State already on record.
  const pincodeFillsLocationRef = useRef(false);
  // Shown when the postal service could not verify the PIN. The PIN is not treated as invalid.
  const [formPincodeNotice, setFormPincodeNotice] = useState<string | null>(null);

  useEffect(() => {
    const raw = formPincode.trim();
    formPincodeLatestRef.current = raw;
    setFormPincodeNotice(null);
    if (!raw) {
      setFormPincodeError(null);
      setFormPincodeValidating(false);
      setFormPincodePostOffices([]);
      return;
    }
    if (isDummyPincode(raw)) {
      setFormPincodeError('Invalid or dummy PIN code');
      setFormPincodeValidating(false);
      setFormPincodePostOffices([]);
      return;
    }
    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setFormPincodeError('Invalid PIN code format');
      setFormPincodeValidating(false);
      setFormPincodePostOffices([]);
      return;
    }
    if (/^\d{6}$/.test(raw)) {
      setFormPincodeValidating(true);
      const lookupTimer = setTimeout(async () => {
        try {
          // The same postal lookup the Create RFQ page uses for its delivery PIN code.
          const res = await validatePincode(raw);
          // A PIN typed after this lookup started has replaced it, so this result must not fill the form.
          if (formPincodeLatestRef.current !== raw) return;
          if (!res.isValid && res.unverified) {
            // The postal service could not be reached. The PIN is not judged invalid, and the form can still be saved.
            setFormPincodeError(null);
            setFormPincodeNotice(UI_STRINGS.pincodeVerification.unverifiedFillManually);
            setFormPincodePostOffices([]);
          } else if (!res.isValid) {
            setFormPincodeError(res.message || 'Invalid PIN code');
            setFormPincodePostOffices([]);
          } else {
            const offices = res.postOffices || [];
            setFormPincodeError(null);
            setFormPincodePostOffices(offices);
            const { city, state } = resolveCityAndStateFromPostalResult(raw, offices);
            if (pincodeFillsLocationRef.current) {
              if (city) setFormCity(city);
              if (state) setFormState(state);
            } else {
              if (city) setFormCity((prev) => (prev.trim() ? prev : city));
              if (state) setFormState((prev) => (prev.trim() ? prev : state));
            }
          }
        } catch {
          setFormPincodeError(null);
        } finally {
          if (formPincodeLatestRef.current === raw) setFormPincodeValidating(false);
        }
      }, 350);
      // Cancels the pending lookup when the PIN changes again or the form unmounts, so it cannot run afterwards.
      return () => clearTimeout(lookupTimer);
    }
    setFormPincodeError(null);
    setFormPincodeValidating(false);
    setFormPincodePostOffices([]);
  }, [formPincode]);
  const [formGst, setFormGst] = useState('');
  const [formGstError, setFormGstError] = useState<string | null>(null);
  const [formPan, setFormPan] = useState('');
  const [formMsme, setFormMsme] = useState('');
  const [formAnnualTurnover, setFormAnnualTurnover] = useState('');
  // Null until the user enters a rating (1.0 - 5.0). No default rating is assumed.

  // GST validation
  useEffect(() => {
    const raw = formGst.trim();
    if (!raw) {
      setFormGstError(null);
      return;
    }
    
    // Check for placeholder values
    const PLACEHOLDER_VALUES = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', '-', '—', 'NOTPROVIDED', 'NOTAPPLICABLE', 'AAAAA0000A1Z5', '00AAAAA0000A1Z5']);
    if (PLACEHOLDER_VALUES.has(raw.toUpperCase())) {
      setFormGstError('Invalid or placeholder GSTIN. Please enter a valid GSTIN.');
      return;
    }

    // Check for dummy/repeated patterns
    if (/^[0-9]{2}([A-Z])\1{4}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(raw)) {
      setFormGstError('Invalid GSTIN format. Please enter a valid GSTIN.');
      return;
    }

    // Validate GSTIN format
    if (!GSTIN_PATTERN.test(raw)) {
      setFormGstError('Invalid GSTIN format. Must be 15 characters (e.g., 29ABCDE1234F1Z5).');
      return;
    }

    setFormGstError(null);
  }, [formGst]);
  const [formRating, setFormRating] = useState<number | null>(null);

  // Vendor Upload History State & Handlers
  const [showUploadHistoryModal, setShowUploadHistoryModal] = useState(false);
  const [uploadHistoryList, setUploadHistoryList] = useState<any[]>([]);
  const [selectedHistoryBatch, setSelectedHistoryBatch] = useState<any | null>(null);
  const [batchSearchQuery, setBatchSearchQuery] = useState('');
  const [vendorTableSort, setVendorTableSort] = useState<TableSortState>({ key: null, dir: 'asc' });
  const [vendorColumns, setVendorColumns] = useState<TableColumnOption[]>(() =>
    BUYER_VENDOR_DIRECTORY_COLUMNS.map((col) => ({ ...col }))
  );
  const [showVendorColumnSettings, setShowVendorColumnSettings] = useState(false);

  const loadUploadHistory = useCallback(() => {
    setUploadHistoryList(loadVendorUploadHistoryFromStorage());
  }, []);

  useEffect(() => {
    loadUploadHistory();
    const handleStorageUpdate = () => {
      loadUploadHistory();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('vendor_upload_history_updated', handleStorageUpdate);
      window.addEventListener('storage', handleStorageUpdate);
      return () => {
        window.removeEventListener('vendor_upload_history_updated', handleStorageUpdate);
        window.removeEventListener('storage', handleStorageUpdate);
      };
    }
  }, [loadUploadHistory]);

  const handleDownloadBatchCsv = (batch: any) => {
    if (!batch) return;
    const records = batch.records || [];
    let csv = 'Vendor Code,Company Name,Contact Person,Email ID,Phone,Address,GSTIN,Division,Rating\n';
    // Only the batch's real records become rows. A batch without records exports the header alone.
    records.forEach((r: any) => {
      csv += `"${r.vendorCode || ''}","${r.name || ''}","${r.contactPerson || ''}","${r.email || ''}","${r.phone || ''}","${r.city || ''}","${r.gstin || ''}","${r.category || ''}","${r.rating ?? ''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Procucev_Vendor_Upload_${(batch.fileName || 'template').replace(/\.[^/.]+$/, '')}.csv`;
    link.click();
    showToast('Template Downloaded', `Downloaded vendor template data for ${batch.fileName}.`, 'success');
  };

  // Exports the selected rows of the current list. Every value written is a field
  // the vendor record holds; nothing is added.
  const handleExportSelectedCsv = () => {
    const rows = buyerFilteredVendors.filter((v) => selectedVendorIds.includes(v.id));
    const header = 'Vendor ID,Company Name,Division,Contact Person,Email ID,Phone,Location,Rating\n';
    const body = rows
      .map((v) =>
        [v.id, v.name, v.majorCategory, v.contactPerson, v.email, v.phone, v.location, v.rating]
          .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([header + body + (body ? '\n' : '')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Procucev_Selected_Suppliers_${new Date().toISOString().substring(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Export Complete', `Exported ${rows.length} selected supplier records.`, 'success');
  };

  // Major categories come only from the category master read from the database.
  // When it is empty or failed to load, the picker is empty; no list is substituted.
  const availableMajorCategories = Array.from(
    new Set(
      (categoryTaxonomy || [])
        .map((c) => c.majorCategory)
        .filter((cat): cat is string => Boolean(cat) && !isPlaceholderVendorCategory(cat))
    )
  );

  const getMajorForCategory = useCallback(
    (minorName: string): string => {
      if (!minorName) return '';
      const match = (categoryTaxonomy || []).find((c) =>
        (c.minorCategories || []).some((m) => m.toLowerCase() === minorName.toLowerCase())
      );
      return match ? match.majorCategory : '';
    },
    [categoryTaxonomy]
  );

  const allAvailableMinorCategories = useMemo(() => {
    const list: string[] = [];
    (categoryTaxonomy || []).forEach((c) => {
      (c.minorCategories || []).forEach((m) => {
        if (m && !list.includes(m)) {
          list.push(m);
        }
      });
    });
    return list.sort((a, b) => a.localeCompare(b));
  }, [categoryTaxonomy]);

  const filteredCategorySuggestions = useMemo(() => {
    const q = formMinorInput.trim().toLowerCase();
    if (q.length < 3) return [];
    return allAvailableMinorCategories.filter((cat) => cat.toLowerCase().includes(q));
  }, [formMinorInput, allAvailableMinorCategories]);

  const clearVendorModalErrors = () => {
    setFormValidationError(null);
    setPhoneFieldError(null);
    setFormGstError(null);
  };

  const reportVendorModalError = (title: string, message: string) => {
    setFormValidationError(message);
    showToast(title, message, 'warning');
  };

  const handleVendorPhoneChange = (rawValue: string) => {
    const sanitized = sanitize10DigitMobile(rawValue);
    setFormPhone(sanitized);
    setFormValidationError(null);

    const hasInvalidCharacters = /[^0-9+\s()-]/.test(rawValue);
    if (hasInvalidCharacters || (sanitized.length === 10 && !EXACT_10_DIGIT_MOBILE_PATTERN.test(sanitized))) {
      setPhoneFieldError(UI_STRINGS.addVendorModal.invalidPhoneError);
    } else {
      setPhoneFieldError(null);
    }
  };

  const validateVendorPhoneOnSubmit = (): string | null => {
    const normalized = sanitize10DigitMobile(formPhone);
    if (!EXACT_10_DIGIT_MOBILE_PATTERN.test(normalized)) {
      setPhoneFieldError(UI_STRINGS.addVendorModal.invalidPhoneError);
      reportVendorModalError(
        UI_STRINGS.addVendorModal.invalidPhoneTitle,
        UI_STRINGS.addVendorModal.invalidPhoneError
      );
      return null;
    }
    setPhoneFieldError(null);
    return normalized;
  };

  const renderModalErrorBanner = () =>
    formValidationError ? (
      <div
        role="alert"
        data-testid="vendor-modal-error-banner"
        className="mt-3 shrink-0 flex items-start justify-between gap-2.5 rounded-xl border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/60 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 shadow-sm"
      >
        <div className="flex items-start gap-2">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
          <p className="font-medium leading-relaxed">{formValidationError}</p>
        </div>
        <button
          type="button"
          aria-label={UI_STRINGS.addVendorModal.dismissErrorAria}
          onClick={() => setFormValidationError(null)}
          className="shrink-0 rounded-md p-0.5 text-rose-600 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/60"
        >
          <X size={14} />
        </button>
      </div>
    ) : null;

  const renderVendorPhoneField = (id: string, label: string) => (
    <div>
      <label htmlFor={id} className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
        {label} <span className="text-rose-500">*</span>
      </label>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        required
        placeholder={UI_STRINGS.addVendorModal.phonePlaceholder}
        value={formPhone}
        onChange={(e) => handleVendorPhoneChange(e.target.value)}
        aria-invalid={Boolean(phoneFieldError)}
        aria-describedby={phoneFieldError ? `${id}-error` : undefined}
        className={`w-full text-xs p-2 rounded-lg border bg-white dark:bg-gray-900 ${phoneFieldError
          ? 'border-rose-400 dark:border-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500/30'
          : 'border-slate-200 dark:border-gray-700'
          }`}
      />
      {phoneFieldError && (
        <p id={`${id}-error`} className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
          {phoneFieldError}
        </p>
      )}
    </div>
  );

  const renderDivisionSelectField = (id: string, clearMinorsOnChange: boolean) => (
    <div>
      <label htmlFor={id} className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
        {UI_STRINGS.vendorCategorySelect.divisionLabel} <span className="text-rose-500">*</span>
      </label>
      <select
        id={id}
        aria-label={UI_STRINGS.vendorCategorySelect.divisionLabel}
        required
        value={formMajorCategory}
        onChange={(e) => {
          setFormMajorCategory(e.target.value);
          setFormValidationError(null);
          if (clearMinorsOnChange) {
            setFormMinorCategories([]);
          }
        }}
        className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      >
        <option value="">{UI_STRINGS.vendorCategorySelect.divisionSelectPlaceholder}</option>
        {availableMajorCategories.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>
    </div>
  );

  const renderCategoryTagsField = (idPrefix: string) => (
    <div>
      <label htmlFor={`${idPrefix}-category-input`} className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
        {UI_STRINGS.vendorCategorySelect.categoryLabel} <span className="text-rose-500">*</span>
      </label>
      {formMinorCategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {formMinorCategories.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold border border-indigo-200/50 dark:border-indigo-800"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => handleRemoveMinorCategoryTag(tag)}
                className="hover:text-rose-500 ml-0.5"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center gap-2">
          <input
            id={`${idPrefix}-category-input`}
            type="text"
            aria-label={UI_STRINGS.vendorCategorySelect.categoryLabel}
            value={formMinorInput}
            onChange={(e) => {
              setFormMinorInput(e.target.value);
              setFormValidationError(null);
              setShowCategorySuggestions(true);
            }}
            onFocus={() => {
              if (formMinorInput.trim().length >= 3) {
                setShowCategorySuggestions(true);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredCategorySuggestions.length > 0 && showCategorySuggestions) {
                  handleAddMinorCategoryTag(filteredCategorySuggestions[0]);
                } else if (formMinorInput.trim()) {
                  handleAddMinorCategoryTag(formMinorInput);
                }
              } else if (e.key === 'Escape') {
                setShowCategorySuggestions(false);
              }
            }}
            placeholder={UI_STRINGS.vendorCategorySelect.searchPlaceholder}
            className="flex-1 text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => handleAddMinorCategoryTag(formMinorInput)}
            className="btn btn-secondary btn-xs font-semibold px-3 py-2 shrink-0"
          >
            Add Tag
          </button>
        </div>
        {formMinorInput.trim().length > 0 && formMinorInput.trim().length < 3 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
            {UI_STRINGS.vendorCategorySelect.minCharsHint}
          </p>
        )}
        {showCategorySuggestions && formMinorInput.trim().length >= 3 && (
          <div
            id={`${idPrefix}-category-suggestions`}
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl divide-y divide-slate-100 dark:divide-gray-700/60"
          >
            <div className="px-3 py-1.5 bg-slate-50 dark:bg-gray-900/80 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center justify-between">
              <span>{UI_STRINGS.vendorCategorySelect.matchingCategories} ({filteredCategorySuggestions.length})</span>
              <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-semibold">{UI_STRINGS.vendorCategorySelect.masterCountBadge}</span>
            </div>
            {filteredCategorySuggestions.length > 0 ? (
              filteredCategorySuggestions.map((category) => (
                <button
                  key={category}
                  type="button"
                  role="option"
                  aria-selected={formMinorCategories.includes(category)}
                  onClick={() => handleAddMinorCategoryTag(category)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/60 flex items-center justify-between text-slate-700 dark:text-gray-200 transition-colors"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-100">{category}</span>
                  <span className="text-[10px] text-slate-400 italic">{getMajorForCategory(category)}</span>
                </button>
              ))
            ) : (
              <div className="p-3 text-center">
                <p className="text-xs text-slate-500 dark:text-gray-400 mb-1.5">{UI_STRINGS.vendorCategorySelect.noMatches}</p>
                <button
                  type="button"
                  onClick={() => handleAddMinorCategoryTag(formMinorInput.trim())}
                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  + Add &quot;{formMinorInput.trim()}&quot; as custom category
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Open Add Vendor Modal — reuses the same form field state as Edit, reset
  // to blanks/defaults since there is no existing vendor to populate from.
  const handleOpenAddModal = () => {
    if (ensureCategoryTaxonomy) {
      void ensureCategoryTaxonomy();
    }
    clearVendorModalErrors();
    setFormName('');
    setFormBrandName('');
    setFormMajorCategory('');
    setFormMinorCategories([]);
    setFormMinorInput('');
    setShowCategorySuggestions(false);
    setFormContactPerson('');
    setFormContactDesignation('');
    setFormEmail('');
    setFormPhone('');
    setFormLocation('');
    setFormCity('');
    setFormState('');
    setFormCountry('India');
    setFormPincode('');
    setFormGst('');
    setFormPan('');
    setFormMsme('');
    setFormAnnualTurnover('');
    setFormRating(null);
    pincodeFillsLocationRef.current = true;
    setAddModalOpen(true);
  };

  const resolveSubmittedCategoryValues = (): { majorCategory: string; minorCategories: string[] } | null => {
    const pendingTag = formMinorInput.trim();
    if (pendingTag && isPlaceholderVendorCategory(pendingTag) && formMinorCategories.length === 0) {
      reportVendorModalError(
        UI_STRINGS.addVendorModal.categoryRequiredTitle,
        UI_STRINGS.addVendorModal.invalidDivisionError
      );
      return null;
    }

    const combinedMinors = pendingTag && !isPlaceholderVendorCategory(pendingTag)
      ? [...formMinorCategories, pendingTag]
      : formMinorCategories;
    const minorCategories = normalizeVendorCategoryList(combinedMinors);

    const rawMajor = formMajorCategory.trim();
    if (rawMajor && isPlaceholderVendorCategory(rawMajor)) {
      reportVendorModalError(
        UI_STRINGS.addVendorModal.categoryRequiredTitle,
        UI_STRINGS.addVendorModal.invalidDivisionError
      );
      return null;
    }

    let majorCategory = rawMajor;
    if (!majorCategory && minorCategories.length > 0) {
      majorCategory = getMajorForCategory(minorCategories[0]) || '';
    }

    if (!majorCategory || minorCategories.length === 0) {
      reportVendorModalError(
        UI_STRINGS.addVendorModal.categoryRequiredTitle,
        UI_STRINGS.addVendorModal.categoryRequiredError
      );
      return null;
    }

    return { majorCategory, minorCategories };
  };

  // Form Submission: Add Vendor — persists through the real POST /api/vendors
  // endpoint (see addBuyerVendor in store.tsx); only closes the modal and
  // clears the form once the backend actually confirms the write.
  const handleAddVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearVendorModalErrors();
    if (
      !formName.trim() ||
      !formEmail.trim() ||
      !formContactPerson.trim() ||
      !formPhone.trim() ||
      !formCity.trim() ||
      !formState.trim() ||
      !formPincode.trim() ||
      !formGst.trim() ||
      formRating === null
    ) {
      if (!formPhone.trim()) {
        setPhoneFieldError(UI_STRINGS.addVendorModal.invalidPhoneError);
      }
      reportVendorModalError(
        UI_STRINGS.addVendorModal.validationErrorTitle,
        UI_STRINGS.addVendorModal.requiredFieldsError
      );
      return;
    }

    const normalizedPhone = validateVendorPhoneOnSubmit();
    if (!normalizedPhone) return;

    if (formRating < 1 || formRating > 5) {
      reportVendorModalError(
        UI_STRINGS.addVendorModal.invalidRatingTitle,
        UI_STRINGS.addVendorModal.invalidRatingError
      );
      return;
    }

    if (formPincodeError) {
      reportVendorModalError(UI_STRINGS.addVendorModal.invalidPincodeTitle, formPincodeError);
      return;
    }

    if (formGstError) {
      reportVendorModalError('Invalid GSTIN', formGstError);
      return;
    }

    const resolvedCategories = resolveSubmittedCategoryValues();
    if (!resolvedCategories) return;

    setIsSubmittingAdd(true);
    const created = await addBuyerVendor({
      name: formName.trim(),
      brandName: formBrandName.trim() || formName.trim(),
      majorCategory: resolvedCategories.majorCategory,
      minorCategories: resolvedCategories.minorCategories,
      contactPerson: formContactPerson.trim(),
      contactDesignation: formContactDesignation.trim(),
      email: formEmail.trim().toLowerCase(),
      phone: normalizedPhone,
      location: formLocation.trim() || `${formCity}, ${formState}`,
      city: formCity.trim(),
      state: formState.trim(),
      country: formCountry.trim() || 'India',
      pincode: formPincode.trim(),
      gst: formGst.trim().toUpperCase(),
      gstin: formGst.trim().toUpperCase(),
      pan: formPan.trim().toUpperCase(),
      msme: formMsme.trim(),
      annualTurnover: formAnnualTurnover.trim(),
      rating: formRating,
      score: Math.round(formRating * 20),
      source: 'buyer_manual',
    });
    setIsSubmittingAdd(false);

    // On failure, addBuyerVendor already showed the error toast — keep the
    // modal open with the form intact so nothing the buyer typed is lost.
    if (created) {
      setAddModalOpen(false);
    }
  };

  // Open Edit Vendor Modal
  const handleOpenEditModal = (vendor: any) => {
    if (ensureCategoryTaxonomy) {
      void ensureCategoryTaxonomy();
    }
    clearVendorModalErrors();
    const cleanedMinors = normalizeVendorCategoryList(vendor.minorCategories);
    const rawMajor = typeof vendor.majorCategory === 'string' ? vendor.majorCategory.trim() : '';
    let initialMajor = !isPlaceholderVendorCategory(rawMajor) ? rawMajor : '';
    if (!initialMajor && cleanedMinors.length > 0) {
      initialMajor = getMajorForCategory(cleanedMinors[0]) || '';
    }
    const richer =
      mergedVendors.find((v) => (vendor.id && v.id === vendor.id) || (vendor.email && v.email === vendor.email)) ||
      vendor;
    const resolvedGstin = String(
      richer.gstin ||
      richer.gst ||
      (richer as any).gstNumber ||
      (richer as any).raw?.gstin ||
      (richer as any).raw?.gstNumber ||
      (richer as any).storeRecord?.gstin ||
      vendor.gstin ||
      vendor.gst ||
      vendor.gstNumber ||
      ''
    ).trim().toUpperCase();
    setSelectedVendorForCrud({
      ...richer,
      ...(resolvedGstin ? { gstin: resolvedGstin, gst: resolvedGstin } : {}),
    });
    setFormName(vendor.name || '');
    setFormBrandName(vendor.brandName || vendor.name || '');
    setFormMajorCategory(initialMajor);
    setFormMinorCategories(cleanedMinors);
    setFormMinorInput('');
    setShowCategorySuggestions(false);
    setFormContactPerson(vendor.contactPerson || '');
    setFormContactDesignation(vendor.contactDesignation || '');
    setFormEmail(vendor.email || '');
    setFormPhone(vendor.phone || '');
    const normalizedLoc = resolveVendorLocationFields({
      location: vendor.location,
      factoryAddress: vendor.factoryAddress,
      city: vendor.city,
      state: vendor.state,
      pincode: vendor.pincode,
    });
    setFormLocation(normalizedLoc.location || `${normalizedLoc.city || ''}, ${normalizedLoc.state || ''}`);
    setFormCity(normalizedLoc.city);
    setFormState(normalizedLoc.state);
    setFormCountry(vendor.country || 'India');
    pincodeFillsLocationRef.current = false;
    setFormPincode(normalizedLoc.pincode);
    setFormRating(typeof vendor.rating === 'number' ? vendor.rating : null);
    setEditModalOpen(true);
  };

  // Open Category Assign / Edit Modal for a buyer's own vendor
  const handleOpenCategoryModal = (vendor: any) => {
    if (ensureCategoryTaxonomy) {
      void ensureCategoryTaxonomy();
    }
    clearVendorModalErrors();
    const cleanedMinors = normalizeVendorCategoryList(vendor.minorCategories);
    const rawMajor = typeof vendor.majorCategory === 'string' ? vendor.majorCategory.trim() : '';
    let initialMajor = !isPlaceholderVendorCategory(rawMajor) ? rawMajor : '';
    if (!initialMajor && cleanedMinors.length > 0) {
      initialMajor = getMajorForCategory(cleanedMinors[0]) || '';
    }

    const vId = (vendor.id || '').toLowerCase().trim();
    const vName = (vendor.name || '').toLowerCase().trim();
    let poSug: { majorCategory: string; minorCategories: string[]; source: string } | null = null;
    if (vendor.poMajorCategory && Array.isArray(vendor.poMinorCategories) && vendor.poMinorCategories.length > 0) {
      poSug = {
        majorCategory: vendor.poMajorCategory,
        minorCategories: normalizeVendorCategoryList(vendor.poMinorCategories),
        source: 'PO Ingestion',
      };
    } else {
      const matchedRfqs = rfqs.filter((rfqItem) => {
        const r = rfqItem as any;
        const quotations: any[] = Array.isArray(r?.quotations) ? r.quotations : [];
        const followUps: any[] = Array.isArray(r?.followUps) ? r.followUps : [];
        const inQuotes = quotations.some(
          (q: any) => (q?.vendorName && String(q.vendorName).toLowerCase().trim() === vName) || (q?.vendorId && String(q.vendorId).toLowerCase().trim() === vId)
        );
        const inFollowUps = followUps.some(
          (f: any) => (f?.vendorName && String(f.vendorName).toLowerCase().trim() === vName) || (f?.vendorId && String(f.vendorId).toLowerCase().trim() === vId)
        );
        return inQuotes || inFollowUps;
      });
      const rfqMajors = new Set<string>();
      const rfqMinors = new Set<string>();
      matchedRfqs.forEach((rfqItem) => {
        const r = rfqItem as any;
        const entities: any[] = Array.isArray(r?.extractedEntities) ? r.extractedEntities : [];
        entities.forEach((e: any) => {
          if (e?.majorCategory && !isPlaceholderVendorCategory(e.majorCategory)) rfqMajors.add(String(e.majorCategory).trim());
          if (e?.minorCategory && !isPlaceholderVendorCategory(e.minorCategory)) rfqMinors.add(String(e.minorCategory).trim());
        });
      });
      if (rfqMajors.size > 0 || rfqMinors.size > 0) {
        poSug = {
          majorCategory: Array.from(rfqMajors)[0] || '',
          minorCategories: Array.from(rfqMinors),
          source: 'PO Purchase Dump / RFQ Records',
        };
      } else if (Array.isArray(vendor.clientMappedCategories) && vendor.clientMappedCategories.length > 0) {
        const cleanMinors = normalizeVendorCategoryList(vendor.clientMappedCategories);
        const infMajor = cleanMinors[0] ? getMajorForCategory(cleanMinors[0]) : '';
        if (cleanMinors.length > 0) {
          poSug = {
            majorCategory: infMajor || (!isPlaceholderVendorCategory(vendor.majorCategory) ? vendor.majorCategory : ''),
            minorCategories: cleanMinors,
            source: 'PO Master Data',
          };
        }
      }
    }
    setVendorPoSuggestion(poSug);

    setSelectedVendorForCrud(vendor);
    setFormMajorCategory(initialMajor);
    setFormMinorCategories(cleanedMinors);
    setFormMinorInput('');
    setShowCategorySuggestions(false);
    setCategoryModalOpen(true);
  };

  const handleCategoryModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForCrud || isSavingCategories) return;
    clearVendorModalErrors();
    const resolvedCategories = resolveSubmittedCategoryValues();
    if (!resolvedCategories) return;

    setIsSavingCategories(true);
    const saved = await updateBuyerVendor(selectedVendorForCrud.id, {
      majorCategory: resolvedCategories.majorCategory,
      minorCategories: resolvedCategories.minorCategories,
      name: selectedVendorForCrud.name,
      email: selectedVendorForCrud.email,
      phone: selectedVendorForCrud.phone,
      contactPerson: selectedVendorForCrud.contactPerson,
      location: selectedVendorForCrud.location,
      city: selectedVendorForCrud.city,
      state: selectedVendorForCrud.state,
      country: selectedVendorForCrud.country,
      pincode: selectedVendorForCrud.pincode,
      gstin: selectedVendorForCrud.gstin || selectedVendorForCrud.gst,
      vendorCode: selectedVendorForCrud.vendorCode,
      source: selectedVendorForCrud.source,
    });
    setIsSavingCategories(false);

    if (saved) {
      setCategoryModalOpen(false);
      setSelectedVendorForCrud(null);
    }
  };

  // Open View Profile Modal
  const handleOpenViewModal = (vendor: any) => {
    const richer =
      mergedVendors.find((v) => (vendor.id && v.id === vendor.id) || (vendor.email && v.email === vendor.email)) ||
      vendor;
    const resolvedRating =
      normalizeVendorRating(vendor.rating, vendor.score) ??
      normalizeVendorRating(richer.rating, richer.score) ??
      normalizeVendorRating((richer as any).storeRecord?.rating, (richer as any).storeRecord?.overallScore) ??
      normalizeVendorRating((richer as any).latestRatingRevision?.newRating) ??
      normalizeVendorRating((vendor as any).latestRatingRevision?.newRating);
    const resolvedGstin = String(
      richer.gstin ||
      richer.gst ||
      (richer as any).gstNumber ||
      (richer as any).raw?.gstin ||
      (richer as any).raw?.gstNumber ||
      (richer as any).storeRecord?.gstin ||
      vendor.gstin ||
      vendor.gst ||
      vendor.gstNumber ||
      ''
    ).trim().toUpperCase();
    const hasEvalRequest = Boolean(richer.evaluationRequested || richer.evaluationRequestedAt);
    const resolvedStatus = isVendorInactive(richer)
      ? VENDOR_ACTIVE_STATUSES.INACTIVE
      : hasEvalRequest
      ? 'PENDING EVALUATION'
      : richer.status && richer.status !== 'PENDING EVALUATION' && richer.status !== 'REGISTERED / NOT EVALUATED'
      ? richer.status
      : 'NOT EVALUATED';

    setSelectedVendorForCrud({
      ...richer,
      ...(resolvedRating !== null ? { rating: resolvedRating } : {}),
      status: resolvedStatus,
      ...(resolvedGstin ? { gstin: resolvedGstin, gst: resolvedGstin } : {}),
    });
    setViewModalOpen(true);
  };

  // Open Mark Inactive / Activate Vendor Confirmation Modal
  const handleOpenStatusModal = (vendor: VendorEntry, nextIsActive: boolean) => {
    setSelectedVendorForCrud(vendor);
    setTargetStatusIsActive(nextIsActive);
    setStatusModalOpen(true);
  };

  // Add Minor Category Tag
  const handleAddMinorCategoryTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) {
      setFormMinorInput('');
      setShowCategorySuggestions(false);
      return;
    }
    if (isPlaceholderVendorCategory(trimmed)) {
      reportVendorModalError(
        UI_STRINGS.addVendorModal.categoryRequiredTitle,
        UI_STRINGS.addVendorModal.invalidDivisionError
      );
      return;
    }
    if (!formMinorCategories.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      setFormMinorCategories([...formMinorCategories, trimmed]);
      if (!formMajorCategory || isPlaceholderVendorCategory(formMajorCategory)) {
        const inferredMajor = getMajorForCategory(trimmed);
        if (inferredMajor) {
          setFormMajorCategory(inferredMajor);
        }
      }
    }
    setFormMinorInput('');
    setShowCategorySuggestions(false);
  };

  // Remove Minor Category Tag
  const handleRemoveMinorCategoryTag = (tagToRemove: string) => {
    setFormMinorCategories(formMinorCategories.filter((t) => t !== tagToRemove));
  };

  // Form Submission: Edit Vendor
  const handleEditVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForCrud || isSubmittingEdit) return;
    clearVendorModalErrors();
    if (!formName.trim() || !formEmail.trim() || !formContactPerson.trim() || !formPhone.trim()) {
      if (!formPhone.trim()) {
        setPhoneFieldError(UI_STRINGS.addVendorModal.invalidPhoneError);
      }
      reportVendorModalError(
        UI_STRINGS.addVendorModal.validationErrorTitle,
        UI_STRINGS.addVendorModal.editRequiredFieldsError
      );
      return;
    }

    const normalizedPhone = validateVendorPhoneOnSubmit();
    if (!normalizedPhone) return;

    if (formRating !== null && (formRating < 1 || formRating > 5)) {
      reportVendorModalError(
        UI_STRINGS.addVendorModal.invalidRatingTitle,
        UI_STRINGS.addVendorModal.invalidRatingError
      );
      return;
    }

    if (formPincode.trim() && formPincodeError) {
      reportVendorModalError(UI_STRINGS.addVendorModal.invalidPincodeTitle, formPincodeError);
      return;
    }

    const resolvedCategories = resolveSubmittedCategoryValues();
    if (!resolvedCategories) return;

    const updates: Partial<VendorEntry> = {
      name: formName.trim(),
      brandName: formBrandName.trim() || formName.trim(),
      majorCategory: resolvedCategories.majorCategory,
      minorCategories: resolvedCategories.minorCategories,
      contactPerson: formContactPerson.trim(),
      contactDesignation: formContactDesignation.trim(),
      email: formEmail.trim().toLowerCase(),
      phone: normalizedPhone,
      location: formLocation.trim() || `${formCity}, ${formState}`,
      city: formCity.trim(),
      state: formState.trim(),
      country: formCountry.trim() || 'India',
      pincode: formPincode.trim(),
      // Statutory identifiers are locked and are not sent from this form. Rating and score change only when the user
      // enters a rating. Status is not edited here, so it is not sent.
      ...(formRating !== null ? { rating: formRating, score: Math.round(formRating * 20) } : {}),
    };

    setIsSubmittingEdit(true);
    const saved = await updateBuyerVendor(selectedVendorForCrud.id, updates);
    setIsSubmittingEdit(false);
    if (saved) {
      setEditModalOpen(false);
      setSelectedVendorForCrud(null);
    }
  };

  const updateSingleVendorStatus = async (vendor: Partial<VendorEntry>, nextIsActive: boolean): Promise<boolean> => {
    const vendorId = String(vendor.id || '');
    if (typeof setBuyerVendorActiveStatus === 'function') {
      return setBuyerVendorActiveStatus(vendorId, nextIsActive, vendor);
    }
    const nextStatus = (
      nextIsActive
        ? (vendor.previousStatus || 'REGISTERED / NOT EVALUATED')
        : VENDOR_ACTIVE_STATUSES.INACTIVE
    ) as VendorEntry['status'];
    return updateBuyerVendor(vendorId, {
      isActive: nextIsActive,
      disabled: !nextIsActive,
      status: nextStatus,
    });
  };

  // Confirm Single Vendor Active/Inactive Update
  const handleConfirmSingleStatusChange = async () => {
    if (!selectedVendorForCrud || isUpdatingSingleStatus) return;
    const vendorId = selectedVendorForCrud.id;
    setIsUpdatingSingleStatus(true);
    try {
      const identifiers = [
        selectedVendorForCrud.id,
        selectedVendorForCrud.email,
        selectedVendorForCrud.name,
      ].filter((val): val is string => typeof val === 'string' && Boolean(val.trim()));
      const res = await updateSingleVendorStatus(selectedVendorForCrud, targetStatusIsActive);
      if (res !== false) {
        setVendorsActiveStateInStorage(identifiers, targetStatusIsActive);
        loadUploadHistory();
        setStatusModalOpen(false);
        setSelectedVendorForCrud(null);
      }
    } catch (err) {
      logger.log('ERROR', 'Failed to update vendor status', { error: err, vendorId, nextIsActive: targetStatusIsActive }, 'VENDOR_DIRECTORY');
      showToast(UI_STRINGS.vendorStatusControl.updateFailedTitle, UI_STRINGS.vendorStatusControl.singleUpdateFailedMessage, 'warning');
    } finally {
      setIsUpdatingSingleStatus(false);
    }
  };

  // Open Bulk Status Modal (Mark Inactive / Reactivate)
  const handleOpenBulkStatusModal = (nextIsActive: boolean) => {
    if (selectedVendorIds.length === 0) return;
    setBulkTargetIsActive(nextIsActive);
    setBulkStatusModalOpen(true);
  };

  // Confirm Bulk Status Update (Non-destructive Mark Inactive / Activate)
  const resolveBulkTargetVendors = (targetIsActive: boolean): VendorEntry[] => {
    const selectedVendors = mergedVendors.filter(
      (v) => selectedVendorIds.includes(v.id) && canBuyerManageVendor(v, activeBuyerAccount, currentUserSession)
    );
    const targetedVendors = selectedVendors.filter((v) =>
      targetIsActive ? isVendorInactive(v) : isVendorActive(v)
    );
    return targetedVendors.length > 0 ? targetedVendors : selectedVendors;
  };

  const handleBulkStatusConfirm = async () => {
    if (selectedVendorIds.length === 0 || isUpdatingBulkStatus) return;
    setIsUpdatingBulkStatus(true);
    try {
      const effectiveVendors = resolveBulkTargetVendors(bulkTargetIsActive);
      const idsToUpdate = effectiveVendors.length > 0
        ? effectiveVendors.map((v) => v.id)
        : [...selectedVendorIds];
      const identifiers = Array.from(
        new Set(
          [
            ...idsToUpdate,
            ...effectiveVendors.map((v) => v.email || ''),
            ...effectiveVendors.map((v) => v.name || ''),
          ].filter((val): val is string => typeof val === 'string' && Boolean(val.trim()))
        )
      );

      let updated = false;
      if (typeof setMultipleBuyerVendorsActiveStatus === 'function') {
        updated = await setMultipleBuyerVendorsActiveStatus(idsToUpdate, bulkTargetIsActive, effectiveVendors);
      } else {
        const results = await Promise.all(
          idsToUpdate.map((id) => {
            const vendorRecord = effectiveVendors.find((v) => v.id === id) || { id };
            return updateSingleVendorStatus(vendorRecord, bulkTargetIsActive);
          })
        );
        updated = results.every((r) => r !== false);
        if (updated) {
          setVendorsActiveStateInStorage(identifiers, bulkTargetIsActive);
        }
      }

      if (updated !== false) {
        loadUploadHistory();
        setSelectedVendorIds([]);
        setBulkStatusModalOpen(false);
      }
    } catch (err) {
      logger.log('ERROR', 'Failed to bulk update vendor status', { error: err, bulkTargetIsActive }, 'VENDOR_DIRECTORY');
      showToast(UI_STRINGS.vendorStatusControl.updateFailedTitle, UI_STRINGS.vendorStatusControl.bulkUpdateFailedMessage, 'warning');
    } finally {
      setIsUpdatingBulkStatus(false);
    }
  };

  // Helper for granular source badges / origin notes
  const getVendorOriginDetails = (v: any) => {
    const s = String(v.source || '').toLowerCase().trim();
    if (s === 'historical_purchase_dump' || s.includes('purchase_dump')) {
      return {
        origin: 'PO Spend Data Ingestion',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'vendor_master_ingestion' || s.includes('ingestion') || s === 'buyer_uploaded') {
      return {
        origin: 'Vendor Master Ingestion',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'buyer_excel') {
      return {
        origin: 'Buyer Excel Ingest',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'buyer_manual' || s.includes('buyer')) {
      return {
        origin: 'Buyer Manual Empanelment',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'excel' || s === 'category_manager_upload') {
      return {
        origin: 'Category Manager Catalogue',
        badgeClass: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    }
    if (s === 'self_onboarded' || s === 'vendor_registration' || s === 'self_registered') {
      return {
        origin: 'Direct Self-Onboarded',
        badgeClass: 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
      };
    }
    if (s === 'procucev_network' || !isBuyerUploaded(v)) {
      return {
        origin: (v as any).overlap ? 'Overlap (Buyer + Procucev)' : 'Procucev Network Partner',
        badgeClass: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    }
    return {
      origin: 'Registered Supplier',
      badgeClass: 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-gray-700',
    };
  };

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

    const isUploaded = isBuyerUploaded(vendor);
    const isUsedInRFQ = matchingRfqs.length > 0;
    const isEngaged = isUploaded || isUsedInRFQ;

    let qualificationReason = '';
    if (isUploaded && isUsedInRFQ) {
      qualificationReason = `Buyer Empanelled & Active in ${matchingRfqs.length} RFQ(s)`;
    } else if (isUploaded) {
      qualificationReason = 'Buyer Empanelled Supplier';
    } else if (isUsedInRFQ) {
      qualificationReason = `Used in ${matchingRfqs[0]?.rfqNumber || 'RFQ'}`;
    }

    return {
      isEngaged,
      isUploaded,
      isUsedInRFQ,
      matchingRfqs,
      recentRfqNumber: matchingRfqs[0]?.rfqNumber || null,
      qualificationReason,
    };
  };

  // Open Rating / Revision Modal for any vendor
  // The scores start from the vendor's latest recorded revision, or stay empty.
  // Nothing is estimated for the buyer.
  const openRevisionModal = (vendor: any) => {
    setSelectedVendorForRevision(vendor);
    setQualityScore(vendor.latestRatingRevision?.qualityScore ?? '');
    setCostScore(vendor.latestRatingRevision?.costScore ?? '');
    setDeliveryScore(vendor.latestRatingRevision?.deliveryScore ?? '');
    setRemarks(vendor.latestRatingRevision?.remarks ?? '');
  };

  // Closes the rating and profile popups that an evaluation request was sent from.
  const closeEvaluationRequestPopups = () => {
    setSelectedVendorForRevision(null);
    setRemarks('');
    setViewModalOpen(false);
    setSelectedVendorForCrud(null);
  };

  const closeAddModal = () => setAddModalOpen(false);
  const closeEditModal = () => {
    setEditModalOpen(false);
    setSelectedVendorForCrud(null);
  };
  const closeViewModal = () => {
    setViewModalOpen(false);
    setSelectedVendorForCrud(null);
  };
  const closeCategoryModal = () => {
    setCategoryModalOpen(false);
    setSelectedVendorForCrud(null);
  };
  const closeStatusModal = () => {
    setStatusModalOpen(false);
    setSelectedVendorForCrud(null);
  };
  const closeBulkStatusModal = () => setBulkStatusModalOpen(false);
  const closeRevisionModal = () => setSelectedVendorForRevision(null);
  const closeUploadHistoryModal = () => {
    setShowUploadHistoryModal(false);
    setSelectedHistoryBatch(null);
    setBatchSearchQuery('');
  };

  const handleBackdropClick =
    (onClose: () => void, blocked = false) =>
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!blocked && e.target === e.currentTarget) {
          onClose();
        }
      };

  const handleRequestVendorEvaluation = async (vendorToRequest?: any) => {
    const targetVendor = vendorToRequest || selectedVendorForRevision;
    if (!targetVendor || isRequestingEvaluation) return;
    if (isVendorInactive(targetVendor)) {
      showToast(UI_STRINGS.vendorStatusControl.updateFailedTitle, UI_STRINGS.vendorStatusControl.inactiveVendorEvalBlocked, 'warning');
      return;
    }

    setIsRequestingEvaluation(true);
    try {
      // The store asks the server to look for a saved evaluation before it sends any request.
      const isStoredVendor = Array.isArray(buyerVendors) && buyerVendors.some((v) => v.id === targetVendor.id);
      const res = isStoredVendor
        ? await requestVendorEvaluation(targetVendor.id)
        : await requestVendorEvaluation(targetVendor.id, undefined, targetVendor);
      // A request that did not go out keeps the popup open, unless a category must be assigned first.
      if (!res.success) {
        if ((res as { code?: string }).code === 'VENDOR_CATEGORY_REQUIRED') {
          closeEvaluationRequestPopups();
          handleOpenCategoryModal(targetVendor);
        }
        return;
      }
      if (res.evaluationExists && res.evaluation) {
        // A saved evaluation was returned, so no request was sent. Open it.
        closeEvaluationRequestPopups();
        onViewEvaluation(res.evaluation);
        return;
      }
      // The request was sent. The popup closes, and the supplier row shows the requested state from the server.
      closeEvaluationRequestPopups();
    } catch (err: any) {
      logger.log('ERROR', 'Failed to request vendor evaluation', { error: err }, 'VENDOR_SUMMARY');
      showToast(
        UI_STRINGS.vendorEvaluationRequest.requestFailedTitle,
        err?.message || UI_STRINGS.vendorEvaluationRequest.requestFailedFallback,
        'warning'
      );
    } finally {
      setIsRequestingEvaluation(false);
    }
  };

  const handleSaveRatingRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForRevision || isSubmittingRevision || isSubmittingRevisionRef.current) return;

    const isEnteredScore = (value: number | string) =>
      value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
    if (!isEnteredScore(qualityScore) || !isEnteredScore(costScore) || !isEnteredScore(deliveryScore)) {
      showToast('Scores Required', 'Enter quality, cost and delivery scores between 0 and 100.', 'warning');
      return;
    }

    if (!remarks.trim()) {
      showToast('Remarks Required', 'Please provide performance remarks explaining the rating change.', 'warning');
      return;
    }

    isSubmittingRevisionRef.current = true;
    setIsSubmittingRevision(true);
    try {
      const saved = await reviseVendorRating(
        selectedVendorForRevision.id,
        Number(qualityScore),
        Number(costScore),
        Number(deliveryScore),
        remarks
      );
      if (saved) {
        setSelectedVendorForRevision(null);
        setRemarks('');
      }
    } finally {
      isSubmittingRevisionRef.current = false;
      setIsSubmittingRevision(false);
    }
  };

  // Merge evaluations in store onto a vendor list, shared by both tabs.
  const allEvaluations = [...vendorEvaluations];
  const mergeWithEvaluations = (list: VendorEntry[]) =>
    list.map((bv) => {
      const storeEval = findMatchingEvaluation(allEvaluations, bv);
      if (storeEval && typeof storeEval.overallScore === 'number') {
        return {
          ...bv,
          status: storeEval.status || bv.status,
          score: storeEval.overallScore,
          evaluated: true,
          hasRecord: true,
          storeRecord: storeEval,
        };
      }
      if (bv.storeRecord && typeof bv.storeRecord.overallScore === 'number') {
        return {
          ...bv,
          status: bv.storeRecord.status || bv.status,
          score: bv.storeRecord.overallScore,
          evaluated: true,
          hasRecord: true,
        };
      }
      const hasEvaluationRequest = Boolean(bv.evaluationRequested || bv.evaluationRequestedAt);
      const isInactive = isVendorInactive(bv);
      const resolvedStatus = isInactive
        ? VENDOR_ACTIVE_STATUSES.INACTIVE
        : hasEvaluationRequest
        ? 'PENDING EVALUATION'
        : bv.status && bv.status !== 'PENDING EVALUATION' && bv.status !== 'REGISTERED / NOT EVALUATED'
        ? bv.status
        : 'NOT EVALUATED';

      return {
        ...bv,
        status: resolvedStatus as VendorEntry['status'],
        score: typeof bv.score === 'number' ? bv.score : null,
        evaluated: false,
        hasRecord: false,
        storeRecord: null,
      };
    });

  const reconciledBuyerVendors = useMemo<VendorEntry[]>(
    () => reconcileBuyerVendorsWithUploadHistory(buyerVendors, uploadHistoryList, activeBuyerAccount),
    [buyerVendors, uploadHistoryList, activeBuyerAccount]
  );

  const normalizeBuyerVendorEntry = (vendor: VendorEntry): VendorEntry => {
    const loc = resolveVendorLocationFields({
      location: vendor.location,
      factoryAddress: vendor.factoryAddress,
      city: vendor.city,
      state: vendor.state,
      pincode: vendor.pincode,
    });

    let currentMinors = normalizeVendorCategoryList(vendor.minorCategories);
    if (currentMinors.length === 0) {
      if (Array.isArray(vendor.clientMappedCategories) && vendor.clientMappedCategories.length > 0) {
        currentMinors = normalizeVendorCategoryList(vendor.clientMappedCategories);
      } else if (Array.isArray(vendor.poMinorCategories) && vendor.poMinorCategories.length > 0) {
        currentMinors = normalizeVendorCategoryList(vendor.poMinorCategories);
      } else if (Array.isArray(vendor.vendorSelectedCategories) && vendor.vendorSelectedCategories.length > 0) {
        currentMinors = normalizeVendorCategoryList(vendor.vendorSelectedCategories);
      } else if (Array.isArray(vendor.itemsSupplied) && vendor.itemsSupplied.length > 0) {
        currentMinors = Array.from(
          new Set(
            vendor.itemsSupplied
              .map((it) => resolveMinorCategory(String(it), '', vendor.majorCategory))
              .filter((m) => Boolean(m) && !isPlaceholderVendorCategory(m))
          )
        );
      }
    }

    let finalMajor = typeof vendor.majorCategory === 'string' && !isPlaceholderVendorCategory(vendor.majorCategory)
      ? vendor.majorCategory.trim()
      : '';
    if (!finalMajor && currentMinors.length > 0) {
      finalMajor = findMajorForMinor(currentMinors[0]) || '';
    }

    const resolvedGstin = String(
      vendor.gstin ||
      vendor.gst ||
      (vendor as any).gstNumber ||
      (vendor as any).raw?.gstin ||
      (vendor as any).raw?.gstNumber ||
      (vendor as any).raw?.gst ||
      (vendor as any).storeRecord?.gstin ||
      ''
    ).trim().toUpperCase();

    const hasLocChanges =
      loc.location !== (vendor.location || '') ||
      loc.city !== (vendor.city || '') ||
      loc.state !== (vendor.state || '') ||
      loc.pincode !== (vendor.pincode || '');
    const hasCategoryChanges =
      currentMinors.length !== (vendor.minorCategories || []).length ||
      (finalMajor && finalMajor !== (vendor.majorCategory || ''));
    const hasGstinChanges =
      Boolean(resolvedGstin) && (vendor.gstin !== resolvedGstin || vendor.gst !== resolvedGstin);

    if (!hasLocChanges && !hasCategoryChanges && !hasGstinChanges) {
      return vendor;
    }

    return {
      ...vendor,
      ...(resolvedGstin ? { gstin: resolvedGstin, gst: resolvedGstin } : {}),
      ...(loc.location ? { location: loc.location } : {}),
      ...(loc.city ? { city: loc.city } : {}),
      ...(loc.state ? { state: loc.state } : {}),
      ...(loc.pincode ? { pincode: loc.pincode } : {}),
      ...(finalMajor ? { majorCategory: finalMajor } : {}),
      ...(currentMinors.length > 0 ? { minorCategories: currentMinors } : {}),
    };
  };
  const mergedVendors = mergeWithEvaluations(reconciledBuyerVendors.map(normalizeBuyerVendorEntry));
  const buyerUploadedVendorsList = mergedVendors.filter(isBuyerUploaded);

  // Filter categories dynamically (never list empty or placeholder divisions)
  const categories = [
    'ALL',
    ...Array.from(
      new Set(
        buyerUploadedVendorsList
          .map((v) => v.majorCategory)
          .filter((cat): cat is string => Boolean(cat) && !isPlaceholderVendorCategory(cat))
      )
    ),
  ];

  // Helper filter function
  const filterVendorItem = (v: any) => {
    const q = (searchQuery || '').toLowerCase().trim();
    const vName = (v.name || '').toLowerCase();
    const vContact = (v.contactPerson || '').toLowerCase();
    const vEmail = (v.email || '').toLowerCase();
    const vId = (v.id || '').toLowerCase();
    const rawCategory = v.majorCategory || '';
    const vCategory = rawCategory.toLowerCase();
    const vMinors = (v.minorCategories || []).join(' ').toLowerCase();
    const vLocation = (v.location || v.city || v.state || '').toLowerCase();
    const vGstin = (v.gstin || v.gst || v.gstNumber || '').toLowerCase();

    const matchesSearch =
      !q ||
      vName.includes(q) ||
      vContact.includes(q) ||
      vEmail.includes(q) ||
      vId.includes(q) ||
      vCategory.includes(q) ||
      vMinors.includes(q) ||
      vLocation.includes(q) ||
      vGstin.includes(q);

    const matchesCategory = selectedCategory === 'ALL' || rawCategory.toLowerCase() === selectedCategory.toLowerCase();
    const matchesStatus =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'ACTIVE' && isVendorActive(v)) ||
      (selectedStatus === 'INACTIVE' && isVendorInactive(v)) ||
      (selectedStatus === 'EVALUATED' && v.evaluated) ||
      (selectedStatus === 'NOT_EVALUATED' && !v.evaluated && !v.evaluationRequested && !v.evaluationRequestedAt) ||
      (selectedStatus === 'PENDING_EVALUATION' && (v.evaluationRequested || v.evaluationRequestedAt)) ||
      (selectedStatus === 'PREFERRED' && v.status === 'PREFERRED ENTERPRISE SUPPLIER') ||
      (selectedStatus === 'CONDITIONAL' && v.status === 'CONDITIONAL / UNDER REVIEW');

    return matchesSearch && matchesCategory && matchesStatus;
  };

  const buyerFilteredVendors = sortTableRows(
    sortByPincodeMatch(buyerUploadedVendorsList.filter(filterVendorItem)),
    vendorTableSort
  );
  const hasUploadedVendors = Boolean(
    initialSetupCompleted ||
    currentUserSession?.vendorMasterUploaded === true ||
    activeBuyerAccount?.initialSetupCompleted === true ||
    buyerUploadedVendorsList.length > 0
  );

  // Multi-Selection Controls
  const handleToggleSelectVendor = (id: string) => {
    setSelectedVendorIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (selectedVendorIds.length === buyerFilteredVendors.length && buyerFilteredVendors.length > 0) {
      setSelectedVendorIds([]);
    } else {
      setSelectedVendorIds(buyerFilteredVendors.map((v) => v.id).filter(Boolean));
    }
  };

  const handleClearSelection = () => {
    setSelectedVendorIds([]);
  };

  const getStatusStyle = (status: string) => {
    if (status === 'PREFERRED ENTERPRISE SUPPLIER') {
      return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    }
    if (status === 'CONDITIONAL / UNDER REVIEW' || status === 'PENDING EVALUATION') {
      return 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-gray-700';
  };

  // Vendor Card Renderer
  const renderVendorCard = (vendor: any) => {
    const isUploaded = isBuyerUploaded(vendor);
    const canManage = canBuyerManageVendor(vendor, activeBuyerAccount, currentUserSession);
    const originDetails = getVendorOriginDetails(vendor);

    // Check if this vendor has submitted a quote in any RFQ
    const vendorNameLower = (vendor.name || '').toLowerCase();
    const hasSubmittedQuote = rfqs.some((r) =>
      (r.quotes || []).some((q) => {
        const qNameLower = (q.vendorName || '').toLowerCase();
        return (
          (qNameLower && qNameLower.includes(vendorNameLower)) ||
          (vendorNameLower && vendorNameLower.includes(qNameLower))
        );
      })
    );

    // Version Rules
    const hasCompletedEvaluation = Boolean(
      (vendor.storeRecord && typeof vendor.storeRecord.overallScore === 'number') ||
      allEvaluations.some(
        (e) =>
          ((e.vendorId && e.vendorId === vendor.id) ||
            (e.vendorName && e.vendorName.toLowerCase() === (vendor.name || '').toLowerCase())) &&
          typeof e.overallScore === 'number'
      )
    );
    let showEvaluation = false;
    let isLockedForProcucevV2 = false;

    if (currentMode === 'mode_1') {
      showEvaluation = isUploaded;
    } else if (currentMode === 'mode_2') {
      const hasOverlap = (vendor as any).overlap === true;
      if (vendor.source === 'procucev_network' || hasOverlap) {
        if (hasSubmittedQuote) {
          showEvaluation = true;
        } else {
          isLockedForProcucevV2 = true;
        }
      }
    } else {
      // Version 3: AI Sourcing Engine
      showEvaluation = true;
    }

    const engagement = getVendorRfqEngagement(vendor);
    const isSelected = selectedVendorIds.includes(vendor.id);
    const vendorInactive = isVendorInactive(vendor);

    return (
      <tr
        key={vendor.id}
        className={`hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors border-b border-slate-100 dark:border-gray-800/60 ${isSelected ? 'bg-indigo-50/30 dark:bg-indigo-950/20' : ''} ${vendorInactive ? 'opacity-75 bg-slate-50/60 dark:bg-gray-900/40' : ''}`}
      >
        {/* Selection Checkbox */}
        <td className="py-1.5 px-2.5 w-10 min-w-[40px] text-center align-middle">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => handleToggleSelectVendor(vendor.id)}
            data-testid={`select-vendor-${vendor.id}`}
            aria-label={`Select ${vendor.name}`}
            className="h-4 w-4 rounded border-slate-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
        </td>

        {/* 1. Supplier Name */}
        <td className={getTableColumnClass(vendorColumns, 'name', 'py-1.5 px-2.5 min-w-[260px] max-w-[320px] align-middle')}>
          <div className="space-y-0.5">
            <h3
              className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 max-w-[240px]"
              title={vendor.name}
            >
              <span className="truncate block" title={vendor.name}>
                {vendor.name}
              </span>
              {showEvaluation && hasCompletedEvaluation && typeof vendor.score === 'number' && vendor.score >= 80 && (
                <ShieldCheck className="text-emerald-500 shrink-0" size={14} />
              )}
            </h3>

            {/* Performance Rating Revision Badge / History Line */}
            {vendor.latestRatingRevision && (
              <div className="mt-1.5 p-2 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 text-[10px] space-y-1 w-full max-w-[280px] shadow-xs">
                <div className="flex items-center justify-between gap-1 flex-wrap">
                  <div className="flex items-center gap-1 font-bold text-amber-900 dark:text-amber-300">
                    <Star size={11} className="fill-amber-500 text-amber-500 shrink-0" />
                    <span>Buyer Rating Revision: {vendor.latestRatingRevision.newRating} ★</span>
                    <span className="text-[9.5px] font-semibold text-amber-700 dark:text-amber-400">
                      ({vendor.latestRatingRevision.newCompositeScore}%)
                    </span>
                  </div>
                  <span
                    className="text-[9px] font-medium text-slate-500 dark:text-gray-400 truncate max-w-[120px]"
                    title={vendor.latestRatingRevision.buyerCompany}
                  >
                    by {vendor.latestRatingRevision.buyerCompany}
                  </span>
                </div>

                <div className="text-[9px] text-slate-500 dark:text-gray-400">
                  {(() => {
                    const rawTs = String(vendor.latestRatingRevision.timestamp || '');
                    const datePart = rawTs.includes('T') ? rawTs.split('T')[0] : rawTs.split(' ')[0];
                    return datePart || rawTs;
                  })()}
                </div>

                {vendor.latestRatingRevision.remarks && (
                  <p
                    className="text-slate-600 dark:text-gray-300 italic text-[9.5px] line-clamp-2 leading-tight break-words"
                    title={vendor.latestRatingRevision.remarks}
                  >
                    &ldquo;{vendor.latestRatingRevision.remarks}&rdquo;
                  </p>
                )}

                <div className="flex items-center justify-between gap-1 pt-1 border-t border-amber-200/60 dark:border-amber-800/40 text-[9px] flex-wrap">
                  <span className="text-slate-600 dark:text-gray-400 font-medium">
                    Quality: {vendor.latestRatingRevision.qualityScore}, Cost: {vendor.latestRatingRevision.costScore}, Delivery: {vendor.latestRatingRevision.deliveryScore}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      vendor.latestRatingRevision && openRatingRevisionEmailModal(vendor.latestRatingRevision)
                    }
                    className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-0.5 shrink-0"
                  >
                    <Mail size={10} /> View Dispatched Email Notice
                  </button>
                </div>
              </div>
            )}
          </div>
        </td>

        {/* 2. Vendor Code */}
        <td className={getTableColumnClass(vendorColumns, 'vendorCode', 'py-1.5 px-2.5 min-w-[110px] whitespace-nowrap align-middle font-mono text-[11px] text-slate-600 dark:text-gray-300')}>
          <span className="truncate block max-w-[100px]" title={vendor.vendorCode}>
            {vendor.vendorCode}
          </span>
        </td>

        {/* 3. Division (Major Category) */}
        <td className={getTableColumnClass(vendorColumns, 'majorCategory', 'py-1.5 px-2.5 min-w-[140px] max-w-[180px] align-middle')}>
          <span
            className={`text-[11px] font-semibold truncate max-w-[160px] inline-block align-middle ${isPlaceholderVendorCategory(vendor.majorCategory)
              ? 'text-amber-600 dark:text-amber-400 italic'
              : 'text-slate-600 dark:text-gray-300'
              }`}
            title={
              isPlaceholderVendorCategory(vendor.majorCategory)
                ? UI_STRINGS.vendorCategoryEditor.unassignedDivision
                : vendor.majorCategory
            }
          >
            {isPlaceholderVendorCategory(vendor.majorCategory)
              ? UI_STRINGS.vendorCategoryEditor.unassignedDivision
              : vendor.majorCategory}
          </span>
        </td>

        {/* 4. Category (Minor Categories) */}
        <td className={getTableColumnClass(vendorColumns, 'minorCategories', 'py-1.5 px-2.5 min-w-[160px] align-middle')}>
          {(() => {
            const normalizedRowMinors = normalizeVendorCategoryList(vendor.minorCategories);
            return (
              <div className="flex items-center gap-1 flex-wrap max-w-[200px]">
                {normalizedRowMinors.length > 0 ? (
                  <>
                    <span className="text-[9px] text-slate-400 font-semibold">{UI_STRINGS.vendorCategorySelect.categoryBadgePrefix}</span>
                    {normalizedRowMinors.map((m: string) => (
                      <span
                        key={m}
                        title={m}
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40 truncate max-w-[110px] inline-block align-middle"
                      >
                        {m}
                      </span>
                    ))}
                  </>
                ) : (
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 italic">None</span>
                    <span className="block text-[9px] text-amber-600 dark:text-amber-400 font-semibold">
                      Category Not Assigned
                    </span>
                  </div>
                )}
                {isUploaded && (
                  <button
                    type="button"
                    onClick={() => handleOpenCategoryModal(vendor)}
                    data-testid={
                      normalizedRowMinors.length > 0
                        ? `edit-category-vendor-${vendor.id}`
                        : `add-category-vendor-${vendor.id}`
                    }
                    className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-md px-1.5 py-0.5 transition-colors ${normalizedRowMinors.length === 0
                      ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100'
                      : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50'
                      }`}
                  >
                    <Tag size={10} />
                    {normalizedRowMinors.length > 0
                      ? UI_STRINGS.vendorCategoryEditor.editCategoryButton
                      : UI_STRINGS.vendorCategoryEditor.addCategoryButton}
                  </button>
                )}
              </div>
            );
          })()}
        </td>

        {/* 5. Primary Source Badge */}
        <td className={getTableColumnClass(vendorColumns, 'source', 'py-1.5 px-2.5 min-w-[130px] whitespace-nowrap align-middle')}>
          {isUploaded ? (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 inline-flex items-center gap-1 shadow-xs">
              <UploadCloud size={10} className="text-indigo-600 dark:text-indigo-400" />
              Internal Vendor
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-1 shadow-xs">
              <ShieldCheck size={10} className="text-emerald-600 dark:text-emerald-400" />
              Procucev Vendor
            </span>
          )}
        </td>

        {/* 6. Secondary Origin Tag */}
        <td className={getTableColumnClass(vendorColumns, 'origin', 'py-1.5 px-2.5 min-w-[150px] whitespace-nowrap align-middle')}>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${originDetails.badgeClass}`}>
            {originDetails.origin}
          </span>
        </td>

        {/* 7. RFQ Engagement */}
        <td className={getTableColumnClass(vendorColumns, 'engagement', 'py-1.5 px-2.5 min-w-[150px] whitespace-nowrap align-middle')}>
          <div className="flex items-center gap-1 flex-wrap">
            {engagement.isEngaged ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50 inline-flex items-center gap-0.5">
                <CheckCircle2 size={9} /> {engagement.qualificationReason}
              </span>
            ) : (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-400 border border-slate-200 dark:border-gray-700 inline-flex items-center gap-0.5"
                title="Vendor neither uploaded nor used in any RFQs by your organization"
              >
                <Lock size={9} /> No RFQs / Not Uploaded
              </span>
            )}
            {isLockedForProcucevV2 && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 inline-flex items-center gap-0.5">
                <Lock size={9} /> Quote Submission Pending
              </span>
            )}
          </div>
        </td>

        {/* 8. Contact Person */}
        <td className={getTableColumnClass(vendorColumns, 'contactPerson', 'py-1.5 px-2.5 min-w-[150px] max-w-[180px] align-middle text-[11px] text-slate-600 dark:text-gray-300')}>
          <div
            className="truncate font-medium text-slate-700 dark:text-slate-200 max-w-[150px]"
            title={vendor.contactPerson ? `Contact: ${vendor.contactPerson}` : undefined}
          >
            👤 Contact: {vendor.contactPerson}
          </div>
        </td>

        {/* 9. Email */}
        <td className={getTableColumnClass(vendorColumns, 'email', 'py-1.5 px-2.5 min-w-[190px] max-w-[220px] align-middle text-[11px]')}>
          <div
            className="truncate text-slate-500 dark:text-gray-400 max-w-[180px]"
            title={vendor.email}
          >
            ✉️ {vendor.email}
          </div>
        </td>

        {/* 10. Phone */}
        <td className={getTableColumnClass(vendorColumns, 'phone', 'py-1.5 px-2.5 min-w-[130px] whitespace-nowrap align-middle text-[11px]')}>
          <div
            className="truncate text-slate-500 dark:text-gray-400 max-w-[140px]"
            title={vendor.phone}
          >
            📞 {vendor.phone}
          </div>
        </td>

        {/* 11. Location */}
        <td className={getTableColumnClass(vendorColumns, 'location', 'py-1.5 px-2.5 min-w-[160px] max-w-[200px] align-middle text-[11px]')}>
          {(() => {
            const vendorAddress = vendor.location || `${vendor.city || ''}${vendor.city && vendor.state ? ', ' : ''}${vendor.state || ''}`;
            return (
              <div
                className="flex items-center gap-1 text-slate-500 dark:text-gray-400 truncate max-w-[170px]"
                title={vendorAddress || undefined}
              >
                <MapPin size={11} className="shrink-0" />
                <span className="truncate">{vendorAddress || '—'}</span>
              </div>
            );
          })()}
        </td>

        {/* 12. AI Score */}
        <td className={getTableColumnClass(vendorColumns, 'score', 'py-1.5 px-2.5 min-w-[120px] whitespace-nowrap text-center align-middle')}>
          {showEvaluation && hasCompletedEvaluation && typeof vendor.score === 'number' ? (
            <div className="space-y-0.5">
              <div className="text-[9px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
              <div className="text-sm font-mono font-black text-indigo-600 dark:text-indigo-400">
                {vendor.score}%
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="text-[9px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
              <div className="text-[11px] font-semibold text-slate-400 italic">
                {currentMode === 'mode_1' && !isUploaded
                  ? 'Hidden (V1 Restriction)'
                  : isLockedForProcucevV2
                    ? 'Locked (Awaiting Quote)'
                    : currentMode === 'mode_2' && isUploaded && !(vendor as any).overlap
                      ? 'Locked (Buyer Roster Only)'
                      : 'Not Evaluated'}
              </div>
            </div>
          )}
        </td>

        {/* 13. Rating */}
        <td className={getTableColumnClass(vendorColumns, 'rating', 'py-1.5 px-2.5 min-w-[120px] whitespace-nowrap text-center align-middle')}>
          {(() => {
            const displayRating = normalizeVendorRating(vendor.rating, vendor.score);
            return displayRating !== null ? (
              <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 inline-flex items-center justify-center gap-0.5">
                <Star size={10} className="fill-amber-500 text-amber-500" /> {displayRating.toFixed(1)} / 5.0
              </div>
            ) : null;
          })()}
        </td>

        {/* 14. Status */}
        <td className={getTableColumnClass(vendorColumns, 'status', 'py-1.5 px-2.5 min-w-[140px] whitespace-nowrap text-center align-middle')}>
          {vendorInactive ? (
            <span
              data-testid={`status-badge-inactive-${vendor.id}`}
              title={UI_STRINGS.vendorStatusControl.inactiveTooltip}
              className="px-2 py-0.5 rounded text-[10px] font-bold border inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/60"
            >
              <PowerOff size={10} />
              {UI_STRINGS.vendorStatusControl.inactiveBadge}
            </span>
          ) : (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold border inline-block ${currentMode === 'mode_1' && !isUploaded
                ? 'bg-slate-100 dark:bg-gray-800 text-slate-500 border-slate-200'
                : getStatusStyle(
                    (vendor.evaluationRequested || vendor.evaluationRequestedAt)
                      ? 'PENDING EVALUATION'
                      : vendor.status === 'REGISTERED / NOT EVALUATED' || vendor.status === 'NOT EVALUATED' || (!vendor.evaluationRequested && !vendor.evaluationRequestedAt && vendor.status === 'PENDING EVALUATION')
                      ? 'NOT EVALUATED'
                      : vendor.status || 'NOT EVALUATED'
                  )
                }`}
            >
              {currentMode === 'mode_1' && !isUploaded
                ? 'UNAVAILABLE IN V1'
                : isLockedForProcucevV2
                  ? 'LOCKED (PENDING BID)'
                  : (vendor.evaluationRequested || vendor.evaluationRequestedAt)
                  ? 'PENDING EVALUATION'
                  : vendor.status === 'REGISTERED / NOT EVALUATED' || (!vendor.evaluationRequested && !vendor.evaluationRequestedAt && vendor.status === 'PENDING EVALUATION')
                  ? 'NOT EVALUATED'
                  : vendor.status && vendor.status !== 'BUYER ROSTER (NO EVAL)'
                  ? vendor.status
                  : 'NOT EVALUATED'}
            </span>
          )}
          {(vendor.evaluationRequested || vendor.evaluationRequestedAt) && (
            <span className="mt-1 block text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              {vendor.evaluationRequestedAt
                ? formatString(UI_STRINGS.vendorEvaluationRequest.requestedOnLabel, {
                  date: new Date(vendor.evaluationRequestedAt).toLocaleDateString(),
                })
                : UI_STRINGS.vendorEvaluationRequest.requestedLabel}
            </span>
          )}
        </td>

        {/* Action Buttons Toolbar (CRUD + Evaluation + Revision) */}
        <td className={getTableColumnClass(vendorColumns, 'actions', 'py-1.5 px-2.5 min-w-[200px] text-right align-middle whitespace-nowrap')}>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* View Profile Modal Button */}
            <button
              type="button"
              onClick={() => handleOpenViewModal(vendor)}
              className="btn btn-secondary btn-xs font-semibold flex items-center gap-1 shadow-xs"
              title="View complete supplier profile, commercial details, and contact scorecard"
            >
              <Eye size={11} className="text-indigo-600 dark:text-indigo-400" /> View Profile
            </button>

            {/* Mark Inactive / Reactivate Button - Only for buyer-owned vendors */}
            {canManage && (
              <button
                type="button"
                data-testid={vendorInactive ? `enable-vendor-${vendor.id}` : `disable-vendor-${vendor.id}`}
                onClick={() => handleOpenStatusModal(vendor, vendorInactive)}
                className={
                  vendorInactive
                    ? 'btn btn-secondary btn-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-1 shadow-xs'
                    : 'btn btn-secondary btn-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center gap-1 shadow-xs'
                }
                title={
                  vendorInactive
                    ? UI_STRINGS.vendorStatusControl.markActiveTitle
                    : UI_STRINGS.vendorStatusControl.markInactiveTitle
                }
              >
                {vendorInactive ? <Power size={11} /> : <PowerOff size={11} />}
                {vendorInactive
                  ? UI_STRINGS.vendorStatusControl.markActiveButton
                  : UI_STRINGS.vendorStatusControl.markInactiveButton}
              </button>
            )}

            {/* Rate Vendor / AI Rating Button */}
            {ENABLE_VENDOR_RATING && (
              <button
                type="button"
                onClick={() => openRevisionModal(vendor)}
                className="btn btn-amber btn-xs font-bold flex items-center gap-1 shadow-xs"
                title="Rate supplier manually or request vendor evaluation"
              >
                <Star size={11} className="fill-current" /> Revise Rating
              </button>
            )}

            {showEvaluation ? (
              <button
                type="button"
                onClick={async () => {
                  // Opens only a stored evaluation record. No record means no evaluation.
                  let evalRec =
                    (vendor as any).storeRecord ||
                    findMatchingEvaluation(vendorEvaluations, vendor);
                  if (!evalRec && fetchVendorEvaluation) {
                    try {
                      evalRec = await fetchVendorEvaluation(vendor.id || vendor.name);
                    } catch {
                      // ignore fetch error
                    }
                  }
                  if (!evalRec || typeof evalRec.overallScore !== 'number') {
                    showToast('Not evaluated', 'No evaluation record exists for this vendor yet.', 'info');
                    return;
                  }
                  onViewEvaluation(evalRec);
                }}
                className="btn btn-secondary btn-xs flex items-center gap-1"
              >
                <FileCheck size={11} /> View 360° Evaluation <ChevronRight size={11} />
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
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-2.5 animate-fade-in pb-4">
      {/* Top Action Bar */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            loadUploadHistory();
            setShowUploadHistoryModal(true);
          }}
          className="btn btn-secondary btn-sm flex items-center gap-1.5 shadow-sm border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
          title="View previous vendor uploads, historical batches, and template data"
        >
          <History size={14} /> Upload History
        </button>
        <button
          type="button"
          data-testid="open-add-vendor-modal"
          onClick={handleOpenAddModal}
          className="btn btn-primary btn-sm flex items-center gap-1.5 shadow-sm"
        >
          <Plus size={14} /> Add Vendor
        </button>
        {/* Upload Vendor Wizard Button */}
        {onNavigateToWizard && (
          <button
            type="button"
            data-testid="open-upload-vendor-modal"
            onClick={onNavigateToWizard}
            className="btn btn-secondary btn-sm flex items-center gap-1.5 shadow-sm"
          >
            <UploadCloud size={14} /> Upload Vendor
          </button>
        )}
      </div>

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">
            {UI_STRINGS.vendorSummaryStats.totalVendorLabel}
          </div>
          <div className="text-xl sm:text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
            {buyerFilteredVendors.length}
          </div>
        </div>
        <div className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">
            {UI_STRINGS.vendorSummaryStats.ocrEvaluatedLabel}
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
            {buyerFilteredVendors.filter((v) => v.evaluated).length}
          </div>
        </div>
        <div className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">
            {UI_STRINGS.vendorSummaryStats.activeVendorLabel}
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
            {buyerFilteredVendors.filter((v) => isVendorActive(v)).length}
          </div>
        </div>
        <div className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">
            {UI_STRINGS.vendorSummaryStats.inactiveVendorLabel}
          </div>
          <div className="text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400 mt-0.5">
            {buyerFilteredVendors.filter((v) => isVendorInactive(v)).length}
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="glass-panel p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col md:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search vendors by name, contact, category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="has-leading-icon text-xs py-1.5"
          />
        </div>

        {/* Category Selector */}
        <div className="w-full md:w-56">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="select-field text-xs py-1.5"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'ALL' ? 'All Categories' : c}
              </option>
            ))}
          </select>
        </div>

        {/* Status Selector */}
        <div className="w-full md:w-52">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="select-field text-xs py-1.5"
          >
            <option value="ALL">{UI_STRINGS.vendorStatusControl.filterAllStatuses}</option>
            <option value="ACTIVE">{UI_STRINGS.vendorStatusControl.filterActiveOnly}</option>
            <option value="INACTIVE">{UI_STRINGS.vendorStatusControl.filterInactiveOnly}</option>
            <option value="EVALUATED">Evaluated Only</option>
            <option value="NOT_EVALUATED">Pending Evaluation</option>
            <option value="PREFERRED">Preferred Status</option>
            <option value="CONDITIONAL">Conditional / Review</option>
          </select>
        </div>
      </div>

      {/* Multi-Selection Controls Bar */}
      <div className="flex items-center justify-between gap-2.5 flex-wrap bg-slate-50 dark:bg-gray-900/60 p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="select-all-vendors-checkbox"
              checked={buyerFilteredVendors.length > 0 && selectedVendorIds.length === buyerFilteredVendors.length}
              onChange={handleToggleSelectAll}
              className="h-4 w-4 rounded border-slate-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>Select All ({buyerFilteredVendors.length} suppliers)</span>
          </label>
          {selectedVendorIds.length > 0 && (
            <span className="badge badge-purple text-[10px] font-bold">
              {selectedVendorIds.length} Selected
            </span>
          )}
          <button
            type="button"
            onClick={createBooleanSetterHandler(setShowVendorColumnSettings, true)}
            data-testid="vendor-directory-column-settings-btn"
            aria-label="Column Settings"
            title="Column Settings"
            className="btn btn-secondary btn-xs inline-flex items-center gap-1 font-semibold"
          >
            <Settings size={12} />
            <span>Column Settings</span>
          </button>
        </div>
        {selectedVendorIds.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleClearSelection}
              className="btn btn-ghost btn-xs text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={handleExportSelectedCsv}
              className="btn btn-secondary btn-xs font-semibold"
            >
              Export Selected ({selectedVendorIds.length})
            </button>
            {(() => {
              const selectedSet = new Set(selectedVendorIds);
              const selectedRecords = buyerUploadedVendorsList.filter((v) => selectedSet.has(v.id));
              const inactiveSelectedCount = selectedRecords.filter((v) => isVendorInactive(v)).length;
              const activeSelectedCount = Math.max(0, selectedVendorIds.length - inactiveSelectedCount);
              return (
                <>
                  {activeSelectedCount > 0 && (
                    <button
                      type="button"
                      data-testid="bulk-disable-vendors-button"
                      onClick={() => handleOpenBulkStatusModal(false)}
                      className="btn btn-xs font-bold flex items-center gap-1.5 shadow-xs bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                      title={UI_STRINGS.vendorStatusControl.markInactiveTitle}
                    >
                      <PowerOff size={12} />
                      {formatString(UI_STRINGS.vendorStatusControl.bulkDisableButton, { count: activeSelectedCount })}
                    </button>
                  )}
                  {inactiveSelectedCount > 0 && (
                    <button
                      type="button"
                      data-testid="bulk-enable-vendors-button"
                      onClick={() => handleOpenBulkStatusModal(true)}
                      className="btn btn-xs font-bold flex items-center gap-1.5 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                      title={UI_STRINGS.vendorStatusControl.markActiveTitle}
                    >
                      <Power size={12} />
                      {formatString(UI_STRINGS.vendorStatusControl.bulkEnableButton, { count: inactiveSelectedCount })}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      <ColumnSettingsPopup
        isOpen={showVendorColumnSettings}
        onClose={createBooleanSetterHandler(setShowVendorColumnSettings, false)}
        columns={vendorColumns}
        onSave={setVendorColumns}
        onReset={createColumnResetHandler(BUYER_VENDOR_DIRECTORY_COLUMNS, setVendorColumns)}
        title="Column Settings"
      />

      {/* Vendors Display List */}
      <div className="space-y-2.5">
        {buyerFilteredVendors.length > 0 && (
          <div className="rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
            <div
              data-testid="vendor-directory-table-container"
              className="w-full max-w-full overflow-x-auto vendor-directory-table-scroll focus:outline-none"
              tabIndex={0}
              role="region"
              aria-label="Vendor Directory Table"
            >
              <table className="w-full text-left text-xs border-collapse min-w-[2260px]">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-gray-800 shadow-xs">
                  <tr className="bg-slate-50 dark:bg-gray-800/90 border-b border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2 px-2.5 w-10 min-w-[40px] text-center">
                      <span className="sr-only">Select</span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('name', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'name')}
                      className={getTableColumnClass(vendorColumns, 'name', 'py-2 px-2.5 min-w-[260px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Supplier Name <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'name')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('vendorCode', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'vendorCode')}
                      className={getTableColumnClass(vendorColumns, 'vendorCode', 'py-2 px-2.5 min-w-[110px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Vendor Code <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'vendorCode')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('majorCategory', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'majorCategory')}
                      className={getTableColumnClass(vendorColumns, 'majorCategory', 'py-2 px-2.5 min-w-[140px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Division <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'majorCategory')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('minorCategories', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'minorCategories')}
                      className={getTableColumnClass(vendorColumns, 'minorCategories', 'py-2 px-2.5 min-w-[160px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">{UI_STRINGS.vendorCategorySelect.categoryHeader} <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'minorCategories')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('source', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'source')}
                      className={getTableColumnClass(vendorColumns, 'source', 'py-2 px-2.5 min-w-[130px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Source <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'source')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('origin', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'origin')}
                      className={getTableColumnClass(vendorColumns, 'origin', 'py-2 px-2.5 min-w-[150px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Origin <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'origin')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('engagement', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'engagement')}
                      className={getTableColumnClass(vendorColumns, 'engagement', 'py-2 px-2.5 min-w-[150px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">RFQ Engagement <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'engagement')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('contactPerson', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'contactPerson')}
                      className={getTableColumnClass(vendorColumns, 'contactPerson', 'py-2 px-2.5 min-w-[150px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Contact Person <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'contactPerson')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('email', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'email')}
                      className={getTableColumnClass(vendorColumns, 'email', 'py-2 px-2.5 min-w-[190px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Email <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'email')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('phone', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'phone')}
                      className={getTableColumnClass(vendorColumns, 'phone', 'py-2 px-2.5 min-w-[130px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Phone <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'phone')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('location', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'location')}
                      className={getTableColumnClass(vendorColumns, 'location', 'py-2 px-2.5 min-w-[160px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center gap-1">Location <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'location')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('score', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'score')}
                      className={getTableColumnClass(vendorColumns, 'score', 'py-2 px-2.5 min-w-[120px] text-center cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center justify-center gap-1">AI Score <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'score')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('rating', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'rating')}
                      className={getTableColumnClass(vendorColumns, 'rating', 'py-2 px-2.5 min-w-[120px] text-center cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center justify-center gap-1">Rating <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'rating')}</span></span>
                    </th>
                    <th
                      onClick={createColumnSortClickHandler('status', setVendorTableSort)}
                      aria-sort={getTableAriaSort(vendorTableSort, 'status')}
                      className={getTableColumnClass(vendorColumns, 'status', 'py-2 px-2.5 min-w-[140px] text-center cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <span className="inline-flex items-center justify-center gap-1">Status <span aria-hidden="true">{getSortIndicatorSymbol(vendorTableSort, 'status')}</span></span>
                    </th>
                    <th className={getTableColumnClass(vendorColumns, 'actions', 'py-2 px-2.5 min-w-[200px] text-right whitespace-nowrap')}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-gray-800/60">
                  {buyerFilteredVendors.map(renderVendorCard)}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {isLoadingVendors && buyerFilteredVendors.length === 0 && (
          <div className="p-12 text-center text-slate-500 border border-slate-200 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-900/60 shadow-xs space-y-3">
            <Loader2 size={24} className="animate-spin text-indigo-600 dark:text-indigo-400 mx-auto" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Loading vendor directory...
            </p>
          </div>
        )}
        {!isLoadingVendors && buyerFilteredVendors.length === 0 && (
          <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-gray-800 rounded-2xl bg-slate-50/50 dark:bg-gray-950/40 space-y-3">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 rounded-full w-fit mx-auto text-indigo-600 dark:text-indigo-400">
              <Building2 size={24} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                No vendors match the selected filters.
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Empanel suppliers manually or batch ingest your vendor master catalog.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleOpenAddModal}
                className="btn btn-primary btn-xs font-semibold flex items-center gap-1"
              >
                <Plus size={12} /> Add Vendor
              </button>
              {onNavigateToWizard && (
                <button
                  type="button"
                  onClick={onNavigateToWizard}
                  className="btn btn-secondary btn-xs font-semibold flex items-center gap-1"
                >
                  <UploadCloud size={12} /> Ingest Master / POs
                </button>
              )}
            </div>
          </div>
        )}
      </div>



      {/* ========================================================================= */}
      {/* ADD VENDOR MODAL */}
      {/* ========================================================================= */}
      {addModalOpen && (
        <div
          className="modal-overlay !z-[1100]"
          data-testid="add-vendor-modal-backdrop"
          onClick={handleBackdropClick(closeAddModal, isSubmittingAdd)}
        >
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 animate-fade-in max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Plus size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Add Vendor</h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    {UI_STRINGS.addVendorModal.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="close-add-vendor-modal"
                onClick={closeAddModal}
                disabled={isSubmittingAdd}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>

            {renderModalErrorBanner()}

            <form onSubmit={handleAddVendorSubmit} noValidate className="overflow-y-auto my-3 space-y-3 pr-1 text-xs">
              <div>
                <label htmlFor="add-vendor-name" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Company Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="add-vendor-name"
                  type="text"
                  required
                  placeholder="Legal company name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-vendor-contact" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Contact Person Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="add-vendor-contact"
                    type="text"
                    required
                    placeholder="Full name"
                    value={formContactPerson}
                    onChange={(e) => setFormContactPerson(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
                {renderVendorPhoneField('add-vendor-phone', UI_STRINGS.addVendorModal.phoneLabel)}
              </div>

              <div>
                <label htmlFor="add-vendor-email" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  id="add-vendor-email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>

              {renderDivisionSelectField('add-vendor-major-category', true)}

              {renderCategoryTagsField('add-vendor')}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="add-vendor-city" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    City <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="add-vendor-city"
                    type="text"
                    required
                    placeholder="e.g. Pune"
                    value={formCity}
                    onChange={(e) => setFormCity(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
                <div>
                  <label htmlFor="add-vendor-state" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    State <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="add-vendor-state"
                    type="text"
                    required
                    placeholder="e.g. Maharashtra"
                    value={formState}
                    onChange={(e) => setFormState(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="add-vendor-pincode" className="block font-semibold text-slate-700 dark:text-gray-300">
                      Pincode <span className="text-rose-500">*</span>
                    </label>
                    {formPincodeValidating && (
                      <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> {UI_STRINGS.pincodeVerification.checking}
                      </span>
                    )}
                    {!formPincodeValidating && formPincodePostOffices.length > 0 && !formPincodeError && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> Valid
                      </span>
                    )}
                    {!formPincodeValidating && formPincodeError && formPincode.trim().length >= 6 && (
                      <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                        <AlertCircle size={10} /> Invalid
                      </span>
                    )}
                  </div>
                  <input
                    id="add-vendor-pincode"
                    type="text"
                    required
                    placeholder="6-digit PIN code"
                    maxLength={6}
                    value={formPincode}
                    onChange={(e) => setFormPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`w-full text-xs p-2 rounded-lg border font-mono ${formPincodeError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-700'
                      } bg-white dark:bg-gray-900`}
                  />
                  {formPincodeError && formPincode.trim().length >= 6 && (
                    <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{formPincodeError}</p>
                  )}
                  {formPincodeNotice && formPincode.trim().length >= 6 && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 font-medium">{formPincodeNotice}</p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="add-vendor-rating" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Rating (1.0 - 5.0) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="add-vendor-rating"
                  type="number"
                  required
                  min="1"
                  max="5"
                  step="0.1"
                  placeholder="1.0 - 5.0"
                  value={formRating ?? ''}
                  onChange={(e) => setFormRating(e.target.value === '' ? null : Number(e.target.value))}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono"
                />
              </div>

              <div>
                <label htmlFor="add-vendor-gstin" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  GSTIN <span className="text-rose-500">*</span>
                </label>
                <input
                  id="add-vendor-gstin"
                  type="text"
                  required
                  placeholder="15-character GSTIN (e.g., 29ABCDE1234F1Z5)"
                  maxLength={15}
                  value={formGst}
                  onChange={(e) => setFormGst(e.target.value.toUpperCase())}
                  className={`w-full text-xs p-2 rounded-lg border uppercase font-mono ${formGstError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-700'
                    } bg-white dark:bg-gray-900`}
                />
                {formGstError && formGst.trim().length > 0 && (
                  <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{formGstError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  disabled={isSubmittingAdd}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  data-testid="submit-add-vendor"
                  className="btn btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmittingAdd ? 'Adding…' : 'Add Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BULK UPLOAD VENDORS MODAL — same real POST /api/vendors/bulk-import path */}
      {/* the category manager uses, scoped server-side to this buyer's own      */}
      {/* private roster (buyerId/addedByBuyerCompany, source 'buyer_excel')     */}
      {/* rather than the shared Procucev network.                              */}
      {/* ========================================================================= */}
      <VendorUploadModal
        isOpen={bulkUploadModalOpen}
        onClose={() => setBulkUploadModalOpen(false)}
        onImportComplete={() => {
          loadUploadHistory();
          setInitialSetupCompleted?.(true);
        }}
      />

      {/* ========================================================================= */}
      {/* EDIT VENDOR MODAL */}
      {/* ========================================================================= */}
      {editModalOpen && selectedVendorForCrud && (
        <div
          className="modal-overlay !z-[1100]"
          data-testid="edit-vendor-modal-backdrop"
          onClick={handleBackdropClick(closeEditModal, isSubmittingEdit)}
        >
          <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 animate-fade-in max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Pencil size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    Edit Vendor Profile
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Update supplier corporate details, categories, contact information, and compliance records.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

            {renderModalErrorBanner()}

            {/* Modal Body Form */}
            <form onSubmit={handleEditVendorSubmit} noValidate className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
              {/* Section 1: Basic Company & Brand Details */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <Building2 size={13} className="text-indigo-600" /> 1. Company &amp; Taxonomy Information
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Company Legal Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Brand / Trade Name
                    </label>
                    <input
                      type="text"
                      value={formBrandName}
                      onChange={(e) => setFormBrandName(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {renderDivisionSelectField('edit-vendor-major-category', false)}

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Rating (1.0 - 5.0)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1.0"
                        max="5.0"
                        step="0.1"
                        value={formRating ?? ''}
                        onChange={(e) => setFormRating(e.target.value === '' ? null : Number(e.target.value))}
                        className="w-24 text-xs p-2 font-mono font-bold rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                      />
                      <span className="text-amber-500 font-bold flex items-center gap-1">
                        <Star size={13} className="fill-amber-500" /> {formRating !== null ? `${formRating} / 5.0` : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Category Chips & Searchable Dropdown */}
                {renderCategoryTagsField('edit-vendor')}
              </div>

              {/* Section 2: Contact & Location */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <Mail size={13} className="text-indigo-600" /> 2. Contact &amp; Facility Location
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Contact Person Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formContactPerson}
                      onChange={(e) => setFormContactPerson(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Designation
                    </label>
                    <input
                      type="text"
                      value={formContactDesignation}
                      onChange={(e) => setFormContactDesignation(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Official Email Address <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  {renderVendorPhoneField('edit-vendor-phone', UI_STRINGS.addVendorModal.editPhoneLabel)}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Factory / Office Address &amp; Location
                    </label>
                    <input
                      type="text"
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">City</label>
                    <input
                      type="text"
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">State</label>
                    <input
                      type="text"
                      value={formState}
                      onChange={(e) => setFormState(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="edit-vendor-pincode" className="block font-semibold text-slate-700 dark:text-gray-300">Pincode</label>
                      {formPincodeValidating && (
                        <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                          <Loader2 size={10} className="animate-spin" /> {UI_STRINGS.pincodeVerification.checking}
                        </span>
                      )}
                      {!formPincodeValidating && formPincodePostOffices.length > 0 && !formPincodeError && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                          <CheckCircle2 size={10} /> Valid
                        </span>
                      )}
                      {!formPincodeValidating && formPincodeError && formPincode.trim().length >= 6 && (
                        <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                          <AlertCircle size={10} /> Invalid
                        </span>
                      )}
                    </div>
                    <input
                      id="edit-vendor-pincode"
                      type="text"
                      maxLength={6}
                      value={formPincode}
                      onChange={(e) => setFormPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className={`w-full text-xs p-2 rounded-lg border font-mono ${formPincodeError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-700'
                        } bg-white dark:bg-gray-900`}
                    />
                    {formPincodeError && formPincode.trim().length >= 6 && (
                      <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{formPincodeError}</p>
                    )}
                    {formPincodeNotice && formPincode.trim().length >= 6 && (
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 font-medium">{formPincodeNotice}</p>
                    )}
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">Country</label>
                    <input
                      type="text"
                      value={formCountry}
                      onChange={(e) => setFormCountry(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Statutory & Commercial Identifiers. Locked: these come from the supplier registration. */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200 dark:border-gray-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    <FileText size={13} className="text-indigo-600 dark:text-indigo-400" /> {UI_STRINGS.vendorStatutory.editHeading}
                  </span>
                  <span
                    data-testid="statutory-locked-badge"
                    className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1"
                  >
                    <Lock size={11} /> {UI_STRINGS.vendorStatutory.lockedBadge}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-gray-400">{UI_STRINGS.vendorStatutory.lockedNote}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">{UI_STRINGS.vendorStatutory.editGstLabel}</span>
                    <span
                      data-testid="edit-statutory-gstin"
                      className="block w-full text-xs p-2 font-mono rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-100/70 dark:bg-gray-800/50 text-slate-600 dark:text-gray-400"
                    >
                      {statutoryText(
                        selectedVendorForCrud.gstin ||
                        selectedVendorForCrud.gst ||
                        (selectedVendorForCrud as any).gstNumber ||
                        (selectedVendorForCrud as any).raw?.gstin ||
                        (selectedVendorForCrud as any).raw?.gstNumber ||
                        (selectedVendorForCrud as any).storeRecord?.gstin
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">{UI_STRINGS.vendorStatutory.editPanLabel}</span>
                    <span
                      data-testid="edit-statutory-pan"
                      className="block w-full text-xs p-2 font-mono rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-100/70 dark:bg-gray-800/50 text-slate-600 dark:text-gray-400"
                    >
                      {statutoryText(usablePan(selectedVendorForCrud.pan))}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">{UI_STRINGS.vendorStatutory.editMsmeLabel}</span>
                    <span
                      data-testid="edit-statutory-msme"
                      className="block w-full text-xs p-2 font-mono rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-100/70 dark:bg-gray-800/50 text-slate-600 dark:text-gray-400"
                    >
                      {statutoryText(selectedVendorForCrud.msme)}
                    </span>
                  </div>
                  <div>
                    <span className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">{UI_STRINGS.vendorStatutory.editTurnoverLabel}</span>
                    <span
                      data-testid="edit-statutory-turnover"
                      className="block w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-100/70 dark:bg-gray-800/50 text-slate-600 dark:text-gray-400"
                    >
                      {statutoryText(selectedVendorForCrud.annualTurnover)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalOpen(false);
                    setSelectedVendorForCrud(null);
                  }}
                  disabled={isSubmittingEdit}
                  className="btn btn-ghost btn-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 shadow-md disabled:opacity-60"
                >
                  {isSubmittingEdit ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {isSubmittingEdit ? UI_STRINGS.vendorCategoryEditor.savingButton : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW VENDOR DETAILS / PROFILE MODAL */}
      {/* ========================================================================= */}
      {viewModalOpen && selectedVendorForCrud && (
        <div
          className="modal-overlay !z-[1100]"
          data-testid="view-vendor-modal-backdrop"
          onClick={handleBackdropClick(closeViewModal)}
        >
          <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 animate-fade-in max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Building2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    {selectedVendorForCrud.name}
                    {isVendorInactive(selectedVendorForCrud) && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                        {UI_STRINGS.vendorStatusControl.inactiveBadge}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Comprehensive supplier registration, compliance, and taxonomy profile.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeViewModal}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
              {/* Score & Key Highlights Bar */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50/50 dark:from-indigo-950/40 dark:to-purple-950/30 border border-indigo-200/60 dark:border-indigo-800/50 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-center">
                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Rating</span>
                  <div className="font-extrabold text-amber-600 text-sm mt-0.5 flex items-center justify-center gap-1">
                    <Star size={13} className="fill-amber-500 text-amber-500" />
                    {(() => {
                      const displayRating =
                        normalizeVendorRating(selectedVendorForCrud.rating, selectedVendorForCrud.score) ??
                        normalizeVendorRating(selectedVendorForCrud.latestRatingRevision?.newRating) ??
                        normalizeVendorRating(selectedVendorForCrud.storeRecord?.rating, selectedVendorForCrud.storeRecord?.overallScore) ??
                        (typeof (selectedVendorForCrud as any).actualRating === 'number' ? (selectedVendorForCrud as any).actualRating : null);
                      return displayRating !== null ? `${displayRating.toFixed(1)} / 5.0` : '—';
                    })()}
                  </div>
                </div>

                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    {UI_STRINGS.vendorStatusControl.evaluationStatusCardHeading}
                  </span>
                  <div
                    className={`font-bold text-[10.5px] mt-0.5 truncate ${isVendorInactive(selectedVendorForCrud)
                      ? 'text-rose-600 dark:text-rose-400'
                      : (selectedVendorForCrud.evaluationRequested || selectedVendorForCrud.evaluationRequestedAt)
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                  >
                    {isVendorInactive(selectedVendorForCrud)
                      ? UI_STRINGS.vendorStatusControl.inactiveBadge
                      : (selectedVendorForCrud.evaluationRequested || selectedVendorForCrud.evaluationRequestedAt)
                      ? 'PENDING EVALUATION'
                      : (selectedVendorForCrud.status === 'PENDING EVALUATION' || selectedVendorForCrud.status === 'REGISTERED / NOT EVALUATED' || selectedVendorForCrud.status === 'NOT EVALUATED' || !selectedVendorForCrud.status
                        ? UI_STRINGS.vendorStatusControl.notEvaluatedStatus
                        : selectedVendorForCrud.status)}
                  </div>
                  {(selectedVendorForCrud.evaluationRequested || selectedVendorForCrud.evaluationRequestedAt) && (
                    <span className="mt-1 block text-[9px] font-semibold text-emerald-700 dark:text-emerald-300 truncate">
                      {selectedVendorForCrud.evaluationRequestedAt
                        ? formatString(UI_STRINGS.vendorEvaluationRequest.requestedOnLabel, {
                          date: new Date(selectedVendorForCrud.evaluationRequestedAt).toLocaleDateString(),
                        })
                        : UI_STRINGS.vendorEvaluationRequest.requestedLabel}
                    </span>
                  )}
                </div>

                {/* Registration Status (Separately added field) */}
                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    {UI_STRINGS.vendorStatusControl.registrationStatusCardHeading || 'Registration Status'}
                  </span>
                  <div className={`font-bold text-[10.5px] mt-0.5 truncate ${
                    Boolean(selectedVendorForCrud.isExistingInDatabase || selectedVendorForCrud.source === 'procucev_network' || selectedVendorForCrud.firstLoginCompleted || (selectedVendorForCrud as any).registered || (selectedVendorForCrud as any).isRegistered)
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-600 dark:text-gray-400'
                  }`}>
                    {Boolean(selectedVendorForCrud.isExistingInDatabase || selectedVendorForCrud.source === 'procucev_network' || selectedVendorForCrud.firstLoginCompleted || (selectedVendorForCrud as any).registered || (selectedVendorForCrud as any).isRegistered)
                      ? (UI_STRINGS.vendorStatusControl.registeredBadge || 'Registered')
                      : (UI_STRINGS.vendorStatusControl.notRegisteredBadge || 'Not Registered')}
                  </div>
                </div>
              </div>

              {/* Taxonomy Details */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Layers size={13} className="text-indigo-600" /> Procurement Taxonomy &amp; Products
                  </span>
                  {canBuyerManageVendor(selectedVendorForCrud, activeBuyerAccount, currentUserSession) && (
                    <button
                      type="button"
                      data-testid="view-profile-edit-category-button"
                      onClick={() => {
                        const vendor = selectedVendorForCrud;
                        setViewModalOpen(false);
                        handleOpenCategoryModal(vendor);
                      }}
                      className="btn btn-secondary btn-xs font-semibold flex items-center gap-1"
                    >
                      <Tag size={11} />
                      {normalizeVendorCategoryList(selectedVendorForCrud.minorCategories).length > 0
                        ? UI_STRINGS.vendorCategoryEditor.editCategoryButton
                        : UI_STRINGS.vendorCategoryEditor.addCategoryButton}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 dark:text-gray-300">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">{UI_STRINGS.vendorCategorySelect.divisionViewPrefix}</span>
                    <strong className={isPlaceholderVendorCategory(selectedVendorForCrud.majorCategory) ? 'text-amber-600 dark:text-amber-400 italic' : 'text-slate-900 dark:text-white'}>
                      {isPlaceholderVendorCategory(selectedVendorForCrud.majorCategory)
                        ? UI_STRINGS.vendorCategoryEditor.unassignedDivision
                        : selectedVendorForCrud.majorCategory}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Categories:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(() => {
                        const viewMinors = normalizeVendorCategoryList(selectedVendorForCrud.minorCategories);
                        return viewMinors.length > 0 ? (
                          viewMinors.map((m: string) => (
                            <span
                              key={m}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50"
                            >
                              {m}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400 italic">No specific categories tagged</span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact & Facility Address */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <MapPin size={13} className="text-indigo-600" /> Contact &amp; Facility Information
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700 dark:text-gray-300">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Primary Contact Person:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {selectedVendorForCrud.contactPerson || '—'}
                    </span>
                    {selectedVendorForCrud.contactDesignation && (
                      <span className="block text-[10px] text-slate-500">
                        ({selectedVendorForCrud.contactDesignation})
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Official Email:</span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">
                      {selectedVendorForCrud.email}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Phone / Mobile:</span>
                    <span>{selectedVendorForCrud.phone || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Location / Address:</span>
                    <span>
                      {selectedVendorForCrud.location ||
                        `${selectedVendorForCrud.city || ''}, ${selectedVendorForCrud.state || ''} ${selectedVendorForCrud.country || 'India'
                        }`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Statutory & Financial Compliance: read-only, from the supplier's registration */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                  <FileCheck size={13} className="text-indigo-600 dark:text-indigo-400" /> {UI_STRINGS.vendorStatutory.viewHeading}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-700 dark:text-gray-300 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">{UI_STRINGS.vendorStatutory.gstLabel}</span>
                    <strong data-testid="view-statutory-gstin">
                      {statutoryText(
                        selectedVendorForCrud.gstin ||
                        selectedVendorForCrud.gst ||
                        (selectedVendorForCrud as any).gstNumber ||
                        (selectedVendorForCrud as any).raw?.gstin ||
                        (selectedVendorForCrud as any).raw?.gstNumber ||
                        (selectedVendorForCrud as any).storeRecord?.gstin
                      )}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">{UI_STRINGS.vendorStatutory.panLabel}</span>
                    <strong data-testid="view-statutory-pan">{statutoryText(usablePan(selectedVendorForCrud.pan))}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">{UI_STRINGS.vendorStatutory.msmeLabel}</span>
                    <span data-testid="view-statutory-msme">{statutoryText(selectedVendorForCrud.msme)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">{UI_STRINGS.vendorStatutory.turnoverLabel}</span>
                    <span className="font-sans font-semibold" data-testid="view-statutory-turnover">{statutoryText(selectedVendorForCrud.annualTurnover)}</span>
                  </div>
                </div>
              </div>

              {/* Latest Rating Revision History if any */}
              {selectedVendorForCrud.latestRatingRevision && (
                <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 space-y-1.5">
                  <div className="flex items-center justify-between text-amber-900 dark:text-amber-300 font-bold">
                    <span className="flex items-center gap-1.5">
                      <Star size={13} className="fill-amber-500 text-amber-500" /> Latest Rating Revision
                    </span>
                    <span className="text-[10px] font-normal text-slate-500">
                      {selectedVendorForCrud.latestRatingRevision.timestamp}
                    </span>
                  </div>
                  <p className="italic text-slate-700 dark:text-gray-300">
                    &ldquo;{selectedVendorForCrud.latestRatingRevision.remarks}&rdquo;
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-slate-600 dark:text-gray-400 pt-1">
                    <span>Quality: {selectedVendorForCrud.latestRatingRevision.qualityScore}</span>
                    <span>Cost: {selectedVendorForCrud.latestRatingRevision.costScore}</span>
                    <span>Delivery: {selectedVendorForCrud.latestRatingRevision.deliveryScore}</span>
                    <span className="font-bold text-amber-700 dark:text-amber-400">
                      → Rating: {selectedVendorForCrud.latestRatingRevision.newRating} ★
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 flex-wrap">
                {ENABLE_EDIT_VENDOR_PROFILE && canBuyerManageVendor(selectedVendorForCrud, activeBuyerAccount, currentUserSession) && (
                  <button
                    type="button"
                    onClick={() => {
                      setViewModalOpen(false);
                      handleOpenEditModal(selectedVendorForCrud);
                    }}
                    className="btn btn-secondary btn-sm font-semibold flex items-center gap-1.5"
                  >
                    <Pencil size={13} /> Edit Profile
                  </button>
                )}
                {canBuyerManageVendor(selectedVendorForCrud, activeBuyerAccount, currentUserSession) && (
                  <button
                    type="button"
                    data-testid="view-profile-status-toggle-button"
                    onClick={() => {
                      const target = selectedVendorForCrud;
                      setViewModalOpen(false);
                      handleOpenStatusModal(target, isVendorInactive(target));
                    }}
                    className={
                      isVendorInactive(selectedVendorForCrud)
                        ? 'btn btn-secondary btn-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5'
                        : 'btn btn-secondary btn-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5'
                    }
                  >
                    {isVendorInactive(selectedVendorForCrud) ? <Power size={13} /> : <PowerOff size={13} />}
                    {isVendorInactive(selectedVendorForCrud)
                      ? UI_STRINGS.vendorStatusControl.markActiveButton
                      : UI_STRINGS.vendorStatusControl.markInactiveButton}
                  </button>
                )}
                {ENABLE_VENDOR_EVALUATION && (
                  <button
                    type="button"
                    onClick={() => handleRequestVendorEvaluation(selectedVendorForCrud)}
                    disabled={isRequestingEvaluation || isVendorInactive(selectedVendorForCrud)}
                    className="btn btn-secondary btn-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    title={
                      isVendorInactive(selectedVendorForCrud)
                        ? UI_STRINGS.vendorStatusControl.inactiveVendorEvalBlocked
                        : UI_STRINGS.vendorEvaluationRequest.buttonTooltip
                    }
                  >
                    {isRequestingEvaluation ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    {UI_STRINGS.vendorEvaluationRequest.buttonLabel}
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setViewModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="btn btn-primary btn-sm font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ASSIGN / UPDATE VENDOR CATEGORY MODAL */}
      {/* ========================================================================= */}
      {categoryModalOpen && selectedVendorForCrud && (
        <div
          className="modal-overlay !z-[1100]"
          data-testid="vendor-category-modal-backdrop"
          onClick={handleBackdropClick(closeCategoryModal, isSavingCategories)}
        >
          <div
            data-testid="vendor-category-modal"
            className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 animate-fade-in max-h-[92vh] flex flex-col"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Tag size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {UI_STRINGS.vendorCategoryEditor.modalTitle}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    {formatString(UI_STRINGS.vendorCategoryEditor.modalSubtitle, {
                      vendorName: selectedVendorForCrud.name,
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="close-vendor-category-modal"
                disabled={isSavingCategories}
                onClick={closeCategoryModal}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>

            {renderModalErrorBanner()}

            <form onSubmit={handleCategoryModalSubmit} noValidate className="my-4 space-y-4 text-xs">
              {/* Category Guidance & PO Evidence Comparison Box */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                    Current Stored Category:
                  </span>
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-gray-200">
                    {isPlaceholderVendorCategory(selectedVendorForCrud.majorCategory)
                      ? 'Category Not Assigned'
                      : selectedVendorForCrud.majorCategory}
                    {Array.isArray(selectedVendorForCrud.minorCategories) && selectedVendorForCrud.minorCategories.length > 0
                      ? ` (${selectedVendorForCrud.minorCategories.join(', ')})`
                      : ''}
                  </span>
                </div>
                {vendorPoSuggestion && (
                  <div className="pt-2 border-t border-slate-200 dark:border-gray-700 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block">
                        Suggested from {vendorPoSuggestion.source}:
                      </span>
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-white">
                        {vendorPoSuggestion.majorCategory || 'Multi-Category'}
                        {vendorPoSuggestion.minorCategories.length > 0
                          ? ` (${vendorPoSuggestion.minorCategories.join(', ')})`
                          : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      data-testid="apply-po-suggestion-button"
                      onClick={() => {
                        if (vendorPoSuggestion.majorCategory) {
                          setFormMajorCategory(vendorPoSuggestion.majorCategory);
                        }
                        if (vendorPoSuggestion.minorCategories.length > 0) {
                          setFormMinorCategories(vendorPoSuggestion.minorCategories);
                        }
                      }}
                      className="btn btn-xs btn-outline btn-primary text-[10px] font-bold shrink-0"
                    >
                      Apply PO Suggestion
                    </button>
                  </div>
                )}
              </div>

              {renderDivisionSelectField('category-modal-major-category', false)}
              {renderCategoryTagsField('category-modal')}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  disabled={isSavingCategories}
                  onClick={() => {
                    setCategoryModalOpen(false);
                    setSelectedVendorForCrud(null);
                  }}
                  className="btn btn-ghost btn-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-vendor-category-modal"
                  disabled={isSavingCategories}
                  className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 shadow-md disabled:opacity-60"
                >
                  {isSavingCategories ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {isSavingCategories
                    ? UI_STRINGS.vendorCategoryEditor.savingButton
                    : UI_STRINGS.vendorCategoryEditor.saveCategoriesButton}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SINGLE VENDOR MARK INACTIVE / REACTIVATE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {statusModalOpen && selectedVendorForCrud && (
        <div
          className="modal-overlay !z-[1100]"
          data-testid="single-vendor-status-modal"
          onClick={handleBackdropClick(closeStatusModal, isUpdatingSingleStatus)}
        >
          <div className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-amber-200 dark:border-amber-900/60 animate-fade-in flex flex-col">
            <div className="flex items-start gap-3 pb-3 border-b border-slate-200 dark:border-gray-800">
              <div
                className={`p-3 rounded-full shrink-0 ${targetStatusIsActive
                  ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                  }`}
              >
                {targetStatusIsActive ? <Power size={22} /> : <PowerOff size={22} />}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {targetStatusIsActive
                    ? UI_STRINGS.vendorStatusControl.singleEnableTitle
                    : UI_STRINGS.vendorStatusControl.singleDisableTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  {formatString(
                    targetStatusIsActive
                      ? UI_STRINGS.vendorStatusControl.singleEnableDescription
                      : UI_STRINGS.vendorStatusControl.singleDisableDescription,
                    {
                      vendorName: resolveVendorDisplayName(
                        selectedVendorForCrud,
                        UI_STRINGS.vendorStatusControl.genericVendorLabel
                      ),
                    }
                  )}
                </p>
              </div>
            </div>

            <div
              className={`my-4 p-3 rounded-xl border text-[11px] space-y-1 ${targetStatusIsActive
                ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40 text-emerald-900 dark:text-emerald-300'
                : 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-300'
                }`}
            >
              <p className="font-bold">
                {targetStatusIsActive
                  ? UI_STRINGS.vendorStatusControl.singleEnableBanner
                  : UI_STRINGS.vendorStatusControl.singleDisableBanner}
              </p>
              <p>
                {targetStatusIsActive
                  ? UI_STRINGS.vendorStatusControl.bulkEnableBannerText
                  : UI_STRINGS.vendorStatusControl.singleDisableImpactNote}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setStatusModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                disabled={isUpdatingSingleStatus}
                className="btn btn-ghost btn-sm font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-vendor-status-button"
                onClick={handleConfirmSingleStatusChange}
                disabled={isUpdatingSingleStatus}
                className={`btn btn-sm font-bold flex items-center gap-1.5 shadow-md text-white px-4 py-2 rounded-xl disabled:opacity-50 ${targetStatusIsActive
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-amber-600 hover:bg-amber-700'
                  }`}
              >
                {isUpdatingSingleStatus ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> {UI_STRINGS.vendorStatusControl.bulkUpdatingButton}
                  </>
                ) : targetStatusIsActive ? (
                  <>
                    <Power size={13} /> {UI_STRINGS.vendorStatusControl.confirmEnableButton}
                  </>
                ) : (
                  <>
                    <PowerOff size={13} /> {UI_STRINGS.vendorStatusControl.confirmDisableButton}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BULK VENDOR MARK INACTIVE / REACTIVATE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {bulkStatusModalOpen && (() => {
        const modalTargetVendors = resolveBulkTargetVendors(bulkTargetIsActive);
        const modalTargetIds = modalTargetVendors.length > 0
          ? modalTargetVendors.map((v) => v.id)
          : selectedVendorIds;
        const targetCount = modalTargetIds.length;
        return (
          <div
            className="modal-overlay !z-[1100]"
            data-testid="bulk-vendor-status-modal"
            onClick={handleBackdropClick(closeBulkStatusModal, isUpdatingBulkStatus)}
          >
            <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-amber-200 dark:border-amber-900/60 animate-fade-in flex flex-col gap-4">
              <div className="flex items-start justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-3 rounded-2xl border shrink-0 ${bulkTargetIsActive
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60'
                      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/60'
                      }`}
                  >
                    {bulkTargetIsActive ? <Power size={22} /> : <PowerOff size={22} />}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {formatString(
                        bulkTargetIsActive
                          ? UI_STRINGS.vendorStatusControl.bulkEnableModalTitle
                          : UI_STRINGS.vendorStatusControl.bulkDisableModalTitle,
                        {
                          count: targetCount,
                          plural: targetCount === 1 ? '' : 's',
                        }
                      )}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                      {UI_STRINGS.vendorStatusControl.bulkModalSubtitle}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="close-bulk-status-modal"
                  onClick={() => setBulkStatusModalOpen(false)}
                  disabled={isUpdatingBulkStatus}
                  className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
                >
                  <X size={18} />
                </button>
              </div>

              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${bulkTargetIsActive
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-900 dark:text-emerald-300'
                  : 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-300'
                  }`}
              >
                <AlertCircle
                  size={16}
                  className={`shrink-0 mt-0.5 ${bulkTargetIsActive
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                    }`}
                />
                <div>
                  <p className="font-semibold">
                    {bulkTargetIsActive
                      ? UI_STRINGS.vendorStatusControl.bulkEnableBannerTitle
                      : UI_STRINGS.vendorStatusControl.bulkDisableBannerTitle}
                  </p>
                  <p className="text-[11px] mt-0.5 opacity-90">
                    {bulkTargetIsActive
                      ? UI_STRINGS.vendorStatusControl.bulkEnableBannerText
                      : UI_STRINGS.vendorStatusControl.bulkDisableBannerText}
                  </p>
                </div>
              </div>

              {/* List Preview of Selected Vendors */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                  <span>
                    {formatString(UI_STRINGS.vendorStatusControl.bulkSelectedListHeading, { count: targetCount })}
                  </span>
                  <span className="text-[10px] lowercase text-slate-400 font-normal">scroll to view all</span>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-slate-50 dark:bg-gray-950/60 border border-slate-200 dark:border-gray-800 divide-y divide-slate-100 dark:divide-gray-800/60">
                  {modalTargetIds.map((id) => {
                    const vendor =
                      mergedVendors.find((v) => v.id === id) ||
                      buyerFilteredVendors.find((v) => v.id === id) ||
                      buyerVendors.find((v) => v.id === id);
                    return (
                      <div key={id} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {vendor ? vendor.name : id}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                            {vendor?.majorCategory && (
                              <span>{vendor.majorCategory}</span>
                            )}
                            {vendor?.majorCategory && vendor?.email && (
                              <span>•</span>
                            )}
                            {vendor?.email && (
                              <span>{vendor.email}</span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`badge text-[9px] font-bold shrink-0 ${bulkTargetIsActive ? 'badge-emerald' : 'badge-amber'
                            }`}
                        >
                          {bulkTargetIsActive
                            ? UI_STRINGS.vendorStatusControl.confirmEnableButton
                            : UI_STRINGS.vendorStatusControl.confirmDisableButton}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setBulkStatusModalOpen(false)}
                  disabled={isUpdatingBulkStatus}
                  className="btn btn-ghost btn-sm font-semibold text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="confirm-bulk-status-button"
                  onClick={handleBulkStatusConfirm}
                  disabled={isUpdatingBulkStatus}
                  className={`btn btn-sm font-bold flex items-center gap-1.5 shadow-md text-white px-4 py-2 rounded-xl disabled:opacity-50 ${bulkTargetIsActive
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                >
                  {isUpdatingBulkStatus ? (
                    <>
                      <Loader2 size={13} className="animate-spin" /> {UI_STRINGS.vendorStatusControl.bulkUpdatingButton}
                    </>
                  ) : bulkTargetIsActive ? (
                    <>
                      <Power size={13} />{' '}
                      {formatString(UI_STRINGS.vendorStatusControl.bulkConfirmEnableButton, {
                        count: targetCount,
                        plural: targetCount === 1 ? '' : 's',
                      })}
                    </>
                  ) : (
                    <>
                      <PowerOff size={13} />{' '}
                      {formatString(UI_STRINGS.vendorStatusControl.bulkConfirmDisableButton, {
                        count: targetCount,
                        plural: targetCount === 1 ? '' : 's',
                      })}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* BUYER VENDOR RATING REVISION MODAL */}
      {/* ========================================================================= */}
      {selectedVendorForRevision &&
        (() => {
          const vendor = selectedVendorForRevision;
          // Previous figures are the vendor's recorded values. A missing value shows a dash.
          const previousRating: number | null = normalizeVendorRating(vendor.rating, vendor.score);
          const previousScore: number | null =
            typeof vendor.score === 'number' && vendor.score > 5
              ? Math.round(vendor.score)
              : previousRating !== null
              ? Math.round(previousRating * 20)
              : null;
          const scoresEntered = [qualityScore, costScore, deliveryScore].every((s) => s !== '');
          const buyerAverage = scoresEntered
            ? parseFloat(((Number(qualityScore) + Number(costScore) + Number(deliveryScore)) / 3).toFixed(2))
            : null;
          const baselineScore = previousScore ?? buyerAverage;
          const newCompositeScore =
            baselineScore !== null && buyerAverage !== null
              ? parseFloat((baselineScore * 0.6 + buyerAverage * 0.4).toFixed(2))
              : null;
          const newRating =
            newCompositeScore !== null
              ? parseFloat((Math.min(5.0, (newCompositeScore / 100) * 5)).toFixed(1))
              : null;
          const previousScoreText = previousScore !== null ? `${previousScore}%` : '—';
          const previousRatingText = previousRating !== null ? `${previousRating} ★` : '—';
          const buyerAverageText = buyerAverage !== null ? `${buyerAverage}%` : '—';
          const newRatingText = newRating !== null ? `${newRating} ★` : '—';
          const newCompositeText = newCompositeScore !== null ? `${Math.round(newCompositeScore)}% Score` : '—';
          const buyerCompany = activeBuyerAccount?.organizationName || '—';

          return (
            <div
              className="modal-overlay !z-[1100]"
              data-testid="revision-modal-backdrop"
              onClick={handleBackdropClick(closeRevisionModal, isSubmittingRevision)}
            >
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
                    type="button"
                    onClick={closeRevisionModal}
                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Modal Body Form */}
                <form onSubmit={handleSaveRatingRevision} noValidate className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
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
                      <div className="text-[10px] text-slate-500 font-mono">
                        Current: {previousRatingText} ({previousScoreText})
                      </div>
                    </div>
                  </div>

                  {/* Performance Criteria Inputs (Quality, Cost, Delivery against 100) */}
                  <div className="space-y-3.5 p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300">
                        1. Rate Performance (Manual)
                      </span>
                      {ENABLE_VENDOR_EVALUATION_REQUEST && (
                        <button
                          type="button"
                          onClick={() => handleRequestVendorEvaluation(vendor)}
                          disabled={isRequestingEvaluation || isVendorInactive(vendor)}
                          className="btn btn-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            isVendorInactive(vendor)
                              ? UI_STRINGS.vendorStatusControl.inactiveVendorEvalBlocked
                              : UI_STRINGS.vendorEvaluationRequest.buttonTooltip
                          }
                        >
                          {isRequestingEvaluation ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Send size={11} />
                          )}
                          {UI_STRINGS.vendorEvaluationRequest.buttonLabel}
                        </button>
                      )}
                    </div>

                    {vendor.evaluationRequested && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                        <Check size={12} className="text-emerald-600 dark:text-emerald-400" />
                        <span>{UI_STRINGS.vendorEvaluationRequest.requestDispatchedBadge}</span>
                        {vendor.evaluationRequestedAt && (
                          <span className="text-slate-400 text-[10px]">
                            ({new Date(vendor.evaluationRequestedAt).toLocaleDateString()})
                          </span>
                        )}
                      </div>
                    )}

                    {/* Quality Score */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 dark:text-gray-200">
                          Quality Compliance &amp; Specs adherence:
                        </span>
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
                        <span className="font-bold text-slate-800 dark:text-gray-200">
                          Cost Competitiveness &amp; Pricing Fairness:
                        </span>
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
                        <span className="font-bold text-slate-800 dark:text-gray-200">
                          Delivery Timeliness &amp; OTIF Lead Time:
                        </span>
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
                      <span className="font-mono text-[10px]">
                        {previousScore !== null ? '60% Historical + 40% Buyer Avg' : 'Buyer Average Baseline'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                        <span className="text-[9.5px] text-slate-400 block uppercase">Buyer Input Avg</span>
                        <div className="font-bold font-mono text-indigo-600 text-xs mt-0.5">{buyerAverageText}</div>
                        <span className="text-[9px] text-slate-400">
                          ({qualityScore}+{costScore}+{deliveryScore})/3
                        </span>
                      </div>
                      <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                        <span className="text-[9.5px] text-slate-400 block uppercase">Actual Previous</span>
                        <div className="font-bold font-mono text-slate-700 dark:text-gray-300 text-xs mt-0.5">
                          {previousScoreText}
                        </div>
                        <span className="text-[9px] text-slate-400">{previousRatingText}</span>
                      </div>
                      <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800">
                        <span className="text-[9.5px] text-emerald-700 dark:text-emerald-300 font-bold block uppercase">
                          New Composite
                        </span>
                        <div className="font-extrabold font-mono text-emerald-700 dark:text-emerald-300 text-sm mt-0.5">
                          {newRatingText}
                        </div>
                        <span className="text-[9px] text-emerald-600 font-bold">{newCompositeText}</span>
                      </div>
                    </div>
                  </div>

                  {/* Remarks & Accolades Textarea */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-800 dark:text-gray-200 flex items-center justify-between">
                      <span>
                        3. Remarks / Accolades / Performance Notes <span className="text-rose-500">*</span>
                      </span>
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
                      These revised ratings (Quality: {qualityScore}, Cost: {costScore}, Delivery: {deliveryScore}) and
                      your remarks will be <strong>officially emailed to {vendor.email}</strong>. Once submitted, the new
                      aggregate rating ({newRatingText}) will update the platform master directory and will be{' '}
                      <strong>visible to all other enterprise buyers</strong>.
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
                      className="btn btn-amber btn-sm font-bold flex items-center gap-1.5 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isSubmittingRevision}
                    >
                      <Send size={13} /> {isSubmittingRevision ? 'Submitting & Dispatching...' : 'Submit Revision & Dispatch Email'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          );
        })()}

      {/* ========================================================================= */}
      {/* VENDOR TEMPLATE UPLOAD HISTORY MODAL */}
      {/* ========================================================================= */}
      {showUploadHistoryModal && (
        <div
          className="modal-overlay !z-[1100] animate-fade-in"
          data-testid="upload-history-modal-backdrop"
          onClick={handleBackdropClick(closeUploadHistoryModal)}
        >
          <div
            data-testid="upload-history-modal"
            className="modal-content max-w-5xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-3xl shadow-2xl border-2 border-indigo-500/30 dark:border-indigo-500/40 animate-scale-up max-h-[92vh] flex flex-col space-y-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center shrink-0">
                  <History size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                      {selectedHistoryBatch ? 'Vendor Template Upload Batch Details' : 'Vendor Template Upload History'}
                    </h3>
                    <span className="badge badge-indigo font-bold text-[10px]">
                      {selectedHistoryBatch ? 'Batch Records' : `${uploadHistoryList.length} Upload${uploadHistoryList.length === 1 ? '' : 's'} Recorded`}
                    </span>
                  </div>
                  {selectedHistoryBatch && (
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                      Overview of uploaded supplier document records and batch ingestion metrics.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {selectedHistoryBatch && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedHistoryBatch(null);
                      setBatchSearchQuery('');
                    }}
                    className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1"
                  >
                    <ArrowLeft size={12} /> Back to History List
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeUploadHistoryModal}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                  title="Close upload history"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="overflow-y-auto flex-1 pr-1 space-y-4">
              {selectedHistoryBatch ? (
                /* ========================================================================= */
                /* DIRECT UPLOADED DOCUMENT RECORDS & ANALYTICS VIEW FOR SELECTED BATCH     */
                /* ========================================================================= */
                (() => {
                  const records = selectedHistoryBatch.records || [];
                  // Counts are the batch's recorded values. Missing values show a dash.
                  const totalCount: number | string = selectedHistoryBatch.total ?? selectedHistoryBatch.imported ?? (records.length > 0 ? records.length : '—');
                  const importedCount: number | string = selectedHistoryBatch.imported ?? totalCount;
                  const duplicateCount: number | string = selectedHistoryBatch.duplicates ?? '—';
                  const uniqueCategories = Array.from(new Set(records.map((r: any) => r.category).filter(Boolean)));
                  const categoriesCount: number | string = records.length > 0
                    ? (uniqueCategories.length > 0 ? uniqueCategories.length : 1)
                    : (selectedHistoryBatch.category ? 1 : '—');

                  const filteredRecords = records.filter((r: any) => {
                    if (!batchSearchQuery.trim()) return true;
                    const q = batchSearchQuery.toLowerCase();
                    return (
                      String(r.name || '').toLowerCase().includes(q) ||
                      String(r.brandName || '').toLowerCase().includes(q) ||
                      String(r.vendorCode || '').toLowerCase().includes(q) ||
                      String(r.contactPerson || '').toLowerCase().includes(q) ||
                      String(r.email || '').toLowerCase().includes(q) ||
                      String(r.phone || '').toLowerCase().includes(q) ||
                      String(r.city || '').toLowerCase().includes(q) ||
                      String(r.state || '').toLowerCase().includes(q) ||
                      String(r.gstin || '').toLowerCase().includes(q) ||
                      String(r.category || '').toLowerCase().includes(q)
                    );
                  });

                  return (
                    <div className="space-y-4 animate-fade-in">
                      {/* Top Action Banner */}
                      <div className="flex items-center justify-between flex-wrap gap-3 p-4 rounded-2xl bg-gradient-to-r from-indigo-50/80 via-purple-50/40 to-blue-50/80 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-blue-950/40 border border-indigo-200/80 dark:border-indigo-800/60 shadow-xs">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 flex items-center justify-center shadow-xs shrink-0">
                            <FileSpreadsheet size={22} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-sm font-black text-slate-900 dark:text-white font-mono">
                                {selectedHistoryBatch.fileName || '—'}
                              </h4>
                              <span className="badge badge-emerald font-bold text-[10px] flex items-center gap-1">
                                <CheckCircle2 size={10} /> Imported
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                              Batch ID: <span className="font-mono font-semibold">{selectedHistoryBatch.id || '—'}</span> · Uploaded: {selectedHistoryBatch.timestamp || '—'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDownloadBatchCsv(selectedHistoryBatch)}
                            className="btn btn-primary btn-xs font-bold text-xs flex items-center gap-1.5 shadow-sm"
                          >
                            <Download size={13} /> Download
                          </button>
                        </div>
                      </div>

                      {/* Immediate Analytics Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800 text-center space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Total Suppliers</span>
                          <div className="text-xl font-black text-slate-900 dark:text-white">
                            {totalCount}
                          </div>
                          <span className="text-[10px] text-slate-500 font-medium">Rows Ingested</span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/60 text-center space-y-0.5 bg-emerald-50/20">
                          <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">Imported &amp; Validated</span>
                          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                            {importedCount}
                          </div>
                          <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 font-medium">Rows recorded in this batch</span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800/60 text-center space-y-0.5 bg-amber-50/20">
                          <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">Duplicates Deduplicated</span>
                          <div className="text-xl font-black text-amber-600 dark:text-amber-400">
                            {duplicateCount}
                          </div>
                          <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80 font-medium">Auto-Merged</span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800/60 text-center space-y-0.5 bg-indigo-50/20">
                          <span className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-400">Categories</span>
                          <div className="text-xl font-black text-indigo-600 dark:text-indigo-400">
                            {categoriesCount}
                          </div>
                          <span className="text-[10px] text-indigo-600/80 dark:text-indigo-400/80 font-medium">Identified Categories</span>
                        </div>
                      </div>

                      {/* Uploaded Document Records Table */}
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                              Uploaded Document Records
                            </h4>
                            <span className="badge badge-indigo font-bold text-[10px]">
                              Showing {filteredRecords.length} of {records.length || totalCount}
                            </span>
                          </div>

                          {/* In-Batch Search Input */}
                          <div className="relative w-full sm:w-64">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                            <input
                              type="text"
                              value={batchSearchQuery}
                              onChange={(e) => setBatchSearchQuery(e.target.value)}
                              placeholder="Search this batch..."
                              className="input pl-8 pr-7 py-1 text-xs w-full bg-white dark:bg-gray-900"
                            />
                            {batchSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setBatchSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Records Table */}
                        {filteredRecords.length > 0 ? (
                          <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900 shadow-xs">
                            <table className="w-full text-left border-collapse min-w-[920px]">
                              <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0 z-10 shadow-xs">
                                <tr>
                                  <th className="p-2.5">Code</th>
                                  <th className="p-2.5">Company &amp; Brand</th>
                                  <th className="p-2.5">Contact Person</th>
                                  <th className="p-2.5">Email</th>
                                  <th className="p-2.5">Phone &amp; Location</th>
                                  <th className="p-2.5">Category</th>
                                  <th className="p-2.5">GSTIN</th>
                                  <th className="p-2.5">Rating</th>
                                  <th className="p-2.5">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                                {filteredRecords.map((r: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
                                    <td className="p-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-400 font-bold whitespace-nowrap">
                                      {r.vendorCode || '—'}
                                    </td>
                                    <td className="p-2.5 max-w-[180px]">
                                      <div className="font-bold text-slate-800 dark:text-white truncate" title={r.name || undefined}>
                                        {r.name || '—'}
                                      </div>
                                      {r.brandName && (
                                        <div className="text-[10px] text-slate-400 font-medium truncate" title={`Brand: ${r.brandName}`}>
                                          Brand: {r.brandName}
                                        </div>
                                      )}
                                    </td>
                                    <td className="p-2.5 max-w-[140px]">
                                      <div className="font-medium text-slate-700 dark:text-gray-300 truncate" title={r.contactPerson || undefined}>
                                        {r.contactPerson || '—'}
                                      </div>
                                      {r.contactDesignation && (
                                        <div className="text-[10px] text-slate-400 truncate" title={r.contactDesignation}>
                                          {r.contactDesignation}
                                        </div>
                                      )}
                                    </td>
                                    <td className="p-2.5 font-mono text-indigo-600 dark:text-indigo-400 font-semibold max-w-[180px] truncate" title={r.email || undefined}>
                                      {r.email || '—'}
                                    </td>
                                    <td className="p-2.5 max-w-[160px]">
                                      <div className="font-mono text-[11px] text-slate-600 dark:text-gray-400 truncate" title={r.phone || undefined}>
                                        {r.phone || '—'}
                                      </div>
                                      {(() => {
                                        const loc = [r.city, r.state, r.pincode].filter(Boolean).join(', ');
                                        return (
                                          <div className="text-[10px] text-slate-500 truncate" title={loc || undefined}>
                                            {loc || '—'}
                                          </div>
                                        );
                                      })()}
                                    </td>
                                    <td className="p-2.5 max-w-[140px]">
                                      <span className="badge badge-slate font-bold text-[10px] truncate max-w-[130px] inline-block" title={r.category || undefined}>
                                        {r.category || '—'}
                                      </span>
                                    </td>
                                    <td className="p-2.5 font-mono text-[10px] text-slate-700 dark:text-gray-300 font-bold whitespace-nowrap">
                                      {r.gstin || '—'}
                                    </td>
                                    <td className="p-2.5 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 font-bold text-[11px] text-amber-600 dark:text-amber-400">
                                        <Star size={11} className="fill-amber-400 text-amber-400" />
                                        {r.rating ?? '—'}
                                      </span>
                                    </td>
                                    <td className="p-2.5 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                        {r.status || '—'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : records.length > 0 ? (
                          <div className="p-6 text-center border border-dashed border-slate-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 space-y-1">
                            <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                              No suppliers match &quot;{batchSearchQuery}&quot;
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Try clearing your search query to view all {records.length} records in this batch.
                            </p>
                          </div>
                        ) : (
                          <div className="p-6 text-center border border-dashed border-slate-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 space-y-1">
                            <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                              Summary record maintained for {selectedHistoryBatch.fileName}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {importedCount} suppliers successfully imported into database.
                            </p>
                            <button
                              type="button"
                              onClick={() => handleDownloadBatchCsv(selectedHistoryBatch)}
                              className="btn btn-primary btn-xs font-bold text-[11px] inline-flex items-center gap-1 mt-2 shadow-sm"
                            >
                              <Download size={12} /> Download
                            </button>
                          </div>
                        )}
                      </div>

                    </div>
                  );
                })()
              ) : uploadHistoryList.length > 0 ? (
                /* LIST OF ALL UPLOAD BATCHES */
                <div className="space-y-2.5">
                  {uploadHistoryList.map((batch: any, index: number) => (
                    <div
                      key={batch.id || index}
                      className="p-4 rounded-2xl bg-white dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700/80 hover:border-indigo-400 dark:hover:border-indigo-500 shadow-sm transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center shrink-0">
                          <FileSpreadsheet size={18} />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-900 dark:text-white font-mono">
                              {batch.fileName || '—'}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              <CheckCircle2 size={10} /> Imported
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-gray-400 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Clock size={11} className="text-slate-400" /> {batch.timestamp || '—'}
                            </span>
                            <span>•</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              {batch.imported ?? batch.total ?? '—'} suppliers
                            </span>
                            {batch.duplicates > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-amber-600 dark:text-amber-400">
                                  {batch.duplicates} duplicate(s) updated
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedHistoryBatch(batch);
                            setBatchSearchQuery('');
                          }}
                          className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                          title="View all step details and uploaded vendor list"
                        >
                          <Eye size={12} /> View Records
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadBatchCsv(batch)}
                          className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1"
                          title="Download uploaded vendor template CSV"
                        >
                          <Download size={12} /> Download CSV
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* EMPTY STATE */
                <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-gray-800 rounded-2xl bg-slate-50/50 dark:bg-gray-950/40 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center mx-auto">
                    <History size={22} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-slate-800 dark:text-white">
                      No Upload History Found
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
                      You haven&apos;t uploaded any vendor master or PO data batches yet. Upload your vendor spreadsheet to see historical records here.
                    </p>
                  </div>
                  {onNavigateToWizard && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowUploadHistoryModal(false);
                        onNavigateToWizard();
                      }}
                      className="btn btn-primary btn-sm font-bold text-xs inline-flex items-center gap-1.5 shadow-sm mt-1"
                    >
                      <UploadCloud size={13} /> Upload Vendor Master Now
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-gray-800 shrink-0 text-xs">
              <span className="text-[11px] text-slate-400">
                This history is stored in this browser only.
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowUploadHistoryModal(false);
                  setSelectedHistoryBatch(null);
                  setBatchSearchQuery('');
                }}
                className="btn btn-secondary btn-sm font-bold text-xs"
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
