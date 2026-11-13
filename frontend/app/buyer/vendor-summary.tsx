'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { fetchAllVendors } from '@/lib/rfqClient';
import { fetchBuyerProfile } from '@/lib/buyerProfileClient';
import { VendorEvaluationRecord, VendorEntry, VendorPageMeta } from '@/lib/types';
import { getMinorCategories } from '@/lib/categoryTaxonomy';
import VendorUploadModal from '@/app/category-manager/VendorUploadModal';
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
  Trash2,
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
} from 'lucide-react';
import { validatePincode, PostOfficeDetail, PINCODE_PATTERN, isDummyPincode, usablePan } from '@/lib/validationSchemas';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { logger } from '@/lib/logger';

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

// Classification helper: Uploaded by Buyer. Reads only the ownership fields the
// vendor record carries (source, buyerId, buyerAccountId, addedByBuyerCompany).
// The vendor ID is never parsed for a prefix.
export const isBuyerUploaded = (
  v: Partial<Pick<VendorEntry, 'source' | 'buyerId' | 'buyerAccountId' | 'addedByBuyerCompany'>> | null | undefined
): boolean => {
  if (!v) return false;
  const s = String(v.source || '').toLowerCase().trim();
  return (
    s === 'buyer_uploaded' ||
    s === 'vendor_master_ingestion' ||
    s === 'historical_purchase_dump' ||
    s === 'buyer_manual' ||
    s === 'buyer_excel' ||
    s === 'buyer' ||
    s.includes('buyer') ||
    s.includes('ingestion') ||
    s.includes('purchase_dump') ||
    !!v.addedByBuyerCompany ||
    !!v.buyerId ||
    !!v.buyerAccountId
  );
};

// Classification helper: Procucev Vendors (Category Manager uploads & Direct Self-Registration)
export const isProcucevVendor = (v: any): boolean => {
  return !isBuyerUploaded(v);
};

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
    deleteMultipleBuyerVendors,
    categoryTaxonomy,
    ensureCategoryTaxonomy,
    reviseVendorRating,
    requestVendorEvaluation,
    openRatingRevisionEmailModal,
    activeBuyerAccount,
    isLoadingVendors,
    fetchVendorEvaluation,
  } = useApp();

  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
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
    if (activeBuyerAccount?.pincode) {
      setBuyerPincode(String(activeBuyerAccount.pincode).trim() || null);
      return;
    }
    void fetchBuyerProfile().then((result) => {
      if (cancelled) return;
      if (result.success && result.data?.pincode) {
        setBuyerPincode(String(result.data.pincode).trim() || null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeBuyerAccount?.pincode]);

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
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
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
  const [formLocation, setFormLocation] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');
  const [formCountry, setFormCountry] = useState('India');
  const [formPincode, setFormPincode] = useState('');
  const [formPincodeError, setFormPincodeError] = useState<string | null>(null);
  const [formPincodeValidating, setFormPincodeValidating] = useState(false);
  const [formPincodePostOffices, setFormPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const formPincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const raw = formPincode.trim();
    if (formPincodeDebounceRef.current) clearTimeout(formPincodeDebounceRef.current);
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
      formPincodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await validatePincode(raw);
          if (!res.isValid) {
            setFormPincodeError(res.message || 'Invalid PIN code');
            setFormPincodePostOffices([]);
          } else {
            setFormPincodeError(null);
            setFormPincodePostOffices(res.postOffices || []);
          }
        } catch {
          setFormPincodeError(null);
        } finally {
          setFormPincodeValidating(false);
        }
      }, 350);
    } else {
      setFormPincodeError(null);
      setFormPincodeValidating(false);
      setFormPincodePostOffices([]);
    }
  }, [formPincode]);
  const [formGst, setFormGst] = useState('');
  const [formPan, setFormPan] = useState('');
  const [formMsme, setFormMsme] = useState('');
  const [formAnnualTurnover, setFormAnnualTurnover] = useState('');
  // Null until the user enters a rating (1.0 - 5.0). No default rating is assumed.
  const [formRating, setFormRating] = useState<number | null>(null);

  // Vendor Upload History State & Handlers
  const [showUploadHistoryModal, setShowUploadHistoryModal] = useState(false);
  const [uploadHistoryList, setUploadHistoryList] = useState<any[]>([]);
  const [selectedHistoryBatch, setSelectedHistoryBatch] = useState<any | null>(null);
  const [batchSearchQuery, setBatchSearchQuery] = useState('');

  const loadUploadHistory = () => {
    try {
      const raw = localStorage.getItem('procucev_vendor_upload_history');
      if (raw) {
        const parsed = JSON.parse(raw);
        setUploadHistoryList(Array.isArray(parsed) ? parsed : []);
      } else {
        setUploadHistoryList([]);
      }
    } catch {
      setUploadHistoryList([]);
    }
  };

  const handleDownloadBatchCsv = (batch: any) => {
    if (!batch) return;
    const records = batch.records || [];
    let csv = 'Vendor Code,Company Name,Contact Person,Email ID,Phone,Address,GSTIN,Major Category,Rating\n';
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
    const header = 'Vendor ID,Company Name,Major Category,Contact Person,Email ID,Phone,Location,Rating\n';
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
    new Set((categoryTaxonomy || []).map((c) => c.majorCategory).filter(Boolean))
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

  // Open Add Vendor Modal — reuses the same form field state as Edit, reset
  // to blanks/defaults since there is no existing vendor to populate from.
  const handleOpenAddModal = () => {
    if (ensureCategoryTaxonomy) {
      void ensureCategoryTaxonomy();
    }
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
    setAddModalOpen(true);
  };

  // Form Submission: Add Vendor — persists through the real POST /api/vendors
  // endpoint (see addBuyerVendor in store.tsx); only closes the modal and
  // clears the form once the backend actually confirms the write.
  const handleAddVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !formName.trim() ||
      !formMajorCategory ||
      !formEmail.trim() ||
      !formContactPerson.trim() ||
      !formPhone.trim() ||
      !formCity.trim() ||
      !formState.trim() ||
      !formPincode.trim() ||
      !formGst.trim() ||
      formRating === null
    ) {
      showToast(
        'Validation Error',
        'Please complete all required fields including Division, City, State, Pincode, GSTIN and Rating (1.0 - 5.0).',
        'warning'
      );
      return;
    }

    if (formRating < 1 || formRating > 5) {
      showToast('Invalid Rating', 'Rating must be between 1.0 and 5.0.', 'warning');
      return;
    }

    if (formPincodeError) {
      showToast('Invalid Pincode', formPincodeError, 'warning');
      return;
    }

    setIsSubmittingAdd(true);
    const created = await addBuyerVendor({
      name: formName.trim(),
      brandName: formBrandName.trim() || formName.trim(),
      majorCategory: formMajorCategory,
      minorCategories: formMinorCategories,
      contactPerson: formContactPerson.trim(),
      contactDesignation: formContactDesignation.trim(),
      email: formEmail.trim().toLowerCase(),
      phone: formPhone.trim(),
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
    setSelectedVendorForCrud(vendor);
    setFormName(vendor.name || '');
    setFormBrandName(vendor.brandName || vendor.name || '');
    setFormMajorCategory(vendor.majorCategory || '');
    setFormMinorCategories(vendor.minorCategories ? [...vendor.minorCategories] : []);
    setFormMinorInput('');
    setShowCategorySuggestions(false);
    setFormContactPerson(vendor.contactPerson || '');
    setFormContactDesignation(vendor.contactDesignation || '');
    setFormEmail(vendor.email || '');
    setFormPhone(vendor.phone || '');
    setFormLocation(vendor.location || `${vendor.city || ''}, ${vendor.state || ''}`);
    setFormCity(vendor.city || '');
    setFormState(vendor.state || '');
    setFormCountry(vendor.country || 'India');
    setFormPincode(vendor.pincode || '');
    setFormRating(typeof vendor.rating === 'number' ? vendor.rating : null);
    setEditModalOpen(true);
  };

  // Open View Profile Modal
  const handleOpenViewModal = (vendor: any) => {
    setSelectedVendorForCrud(vendor);
    setViewModalOpen(true);
  };

  // Open Delete Vendor Modal
  const handleOpenDeleteModal = (vendor: any) => {
    setSelectedVendorForCrud(vendor);
    setDeleteModalOpen(true);
  };

  // Add Minor Category Tag
  const handleAddMinorCategoryTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !formMinorCategories.includes(trimmed)) {
      setFormMinorCategories([...formMinorCategories, trimmed]);
      if (!formMajorCategory) {
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
  const handleEditVendorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForCrud) return;
    if (!formName.trim() || !formMajorCategory || !formEmail.trim() || !formContactPerson.trim() || !formPhone.trim()) {
      showToast('Validation Error', 'Please complete all required fields.', 'warning');
      return;
    }

    if (formRating !== null && (formRating < 1 || formRating > 5)) {
      showToast('Invalid Rating', 'Rating must be between 1.0 and 5.0.', 'warning');
      return;
    }

    if (formPincode.trim() && formPincodeError) {
      showToast('Invalid Pincode', formPincodeError, 'warning');
      return;
    }

    const updates: Partial<VendorEntry> = {
      name: formName.trim(),
      brandName: formBrandName.trim() || formName.trim(),
      majorCategory: formMajorCategory,
      minorCategories: formMinorCategories,
      contactPerson: formContactPerson.trim(),
      contactDesignation: formContactDesignation.trim(),
      email: formEmail.trim().toLowerCase(),
      phone: formPhone.trim(),
      location: formLocation.trim() || `${formCity}, ${formState}`,
      city: formCity.trim(),
      state: formState.trim(),
      country: formCountry.trim() || 'India',
      pincode: formPincode.trim(),
      // Statutory identifiers are locked and are not sent from this form. Rating and score change only when the user
      // enters a rating. Status is not edited here, so it is not sent.
      ...(formRating !== null ? { rating: formRating, score: Math.round(formRating * 20) } : {}),
    };

    updateBuyerVendor(selectedVendorForCrud.id, updates);
    setEditModalOpen(false);
    setSelectedVendorForCrud(null);
  };

  // Confirm Delete Vendor
  const handleDeleteVendorConfirm = async () => {
    if (!selectedVendorForCrud) return;
    const vendorId = selectedVendorForCrud.id;
    try {
      const res = await deleteBuyerVendor(vendorId);
      if (res !== false) {
        setDeleteModalOpen(false);
        setSelectedVendorForCrud(null);
      }
    } catch (err) {
      logger.log('ERROR', 'Failed to delete vendor', { error: err, vendorId }, 'VENDOR_DIRECTORY');
    }
  };

  // Open Bulk Delete Modal
  const handleOpenBulkDeleteModal = () => {
    if (selectedVendorIds.length === 0) return;
    setBulkDeleteModalOpen(true);
  };

  // Confirm Bulk Delete Vendors
  const handleBulkDeleteConfirm = async () => {
    if (selectedVendorIds.length === 0) return;
    setIsDeletingBulk(true);
    try {
      const idsToDelete = [...selectedVendorIds];
      if (typeof deleteMultipleBuyerVendors === 'function') {
        await deleteMultipleBuyerVendors(idsToDelete);
      } else if (typeof deleteBuyerVendor === 'function') {
        await Promise.all(idsToDelete.map((id) => deleteBuyerVendor(id)));
      }
      setSelectedVendorIds([]);
      setBulkDeleteModalOpen(false);
    } catch (err) {
      logger.log('ERROR', 'Failed to bulk delete vendors', { error: err }, 'VENDOR_DIRECTORY');
      showToast('Error', 'Failed to delete selected vendors. Please try again.', 'warning');
    } finally {
      setIsDeletingBulk(false);
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

  const handleRequestVendorEvaluation = async (vendorToRequest?: any) => {
    const targetVendor = vendorToRequest || selectedVendorForRevision;
    if (!targetVendor) return;

    setIsRequestingEvaluation(true);
    try {
      // The store asks the server to look for a saved evaluation before it sends any request.
      const res = await requestVendorEvaluation(targetVendor.id);
      // A request that did not go out keeps the popup open. The store has already said why.
      if (!res.success) return;
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
      const storeEval = allEvaluations.find(
        (e) =>
          (e.vendorId && e.vendorId === bv.id) ||
          (e.vendorName && e.vendorName.toLowerCase() === (bv.name || '').toLowerCase())
      );
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
      return {
        ...bv,
        score: null,
        evaluated: false,
        hasRecord: false,
        storeRecord: null,
      };
    });

  const mergedVendors = mergeWithEvaluations(buyerVendors);
  const buyerUploadedVendorsList = mergedVendors.filter(isBuyerUploaded);

  // Filter categories dynamically
  const categories = [
    'ALL',
    ...Array.from(new Set(buyerUploadedVendorsList.map((v) => v.majorCategory).filter(Boolean))),
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
    const vGstin = (v.gstin || '').toLowerCase();

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
      (selectedStatus === 'EVALUATED' && v.evaluated) ||
      (selectedStatus === 'NOT_EVALUATED' && !v.evaluated) ||
      (selectedStatus === 'PREFERRED' && v.status === 'PREFERRED ENTERPRISE SUPPLIER') ||
      (selectedStatus === 'CONDITIONAL' && v.status === 'CONDITIONAL / UNDER REVIEW');

    return matchesSearch && matchesCategory && matchesStatus;
  };

  const buyerFilteredVendors = sortByPincodeMatch(buyerUploadedVendorsList.filter(filterVendorItem));

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
    if (status === 'CONDITIONAL / UNDER REVIEW') {
      return 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-gray-700';
  };

  // Vendor Card Renderer
  const renderVendorCard = (vendor: any) => {
    const isUploaded = isBuyerUploaded(vendor);
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

    return (
      <tr
        key={vendor.id}
        className={`hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors border-b border-slate-100 dark:border-gray-800/60 ${
          isSelected ? 'bg-indigo-50/30 dark:bg-indigo-950/20' : ''
        }`}
      >
        {/* Selection Checkbox */}
        <td className="py-2.5 px-3 w-10 text-center align-middle">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => handleToggleSelectVendor(vendor.id)}
            data-testid={`select-vendor-${vendor.id}`}
            aria-label={`Select ${vendor.name}`}
            className="h-4 w-4 rounded border-slate-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
        </td>

        {/* Supplier & Details */}
        <td className="py-2.5 px-3 min-w-[240px] align-middle">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="text-[11px] text-slate-500 dark:text-gray-400 font-semibold truncate max-w-[160px] inline-block align-middle"
                title={vendor.majorCategory}
              >
                {vendor.majorCategory}
              </span>
              <span className="text-slate-300 dark:text-gray-600">•</span>

              {/* Primary Source Badge */}
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

              {/* Secondary Origin Tag */}
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${originDetails.badgeClass}`}>
                {originDetails.origin}
              </span>

              {/* RFQ Engagement & Upload Status Badge */}
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

            <h3
              className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 max-w-[280px]"
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
              <div className="mt-1 p-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 text-[10px] space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1 font-bold text-amber-900 dark:text-amber-300">
                    <Star size={11} className="fill-amber-500 text-amber-500" />
                    <span>
                      Buyer Rating Revision: {vendor.latestRatingRevision.newRating} ★ (
                      {vendor.latestRatingRevision.newCompositeScore}%)
                    </span>
                    <span className="text-[9px] font-normal text-slate-500">
                      by {vendor.latestRatingRevision.buyerCompany} ({vendor.latestRatingRevision.timestamp.split(' ')[0]})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      vendor.latestRatingRevision && openRatingRevisionEmailModal(vendor.latestRatingRevision)
                    }
                    className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-0.5 shrink-0"
                  >
                    <Mail size={10} /> View Dispatched Email Notice
                  </button>
                </div>
                <p className="text-slate-600 dark:text-gray-300 italic text-[9.5px]">
                  &ldquo;{vendor.latestRatingRevision.remarks}&rdquo; (Quality:{' '}
                  {vendor.latestRatingRevision.qualityScore}, Cost: {vendor.latestRatingRevision.costScore}, Delivery:{' '}
                  {vendor.latestRatingRevision.deliveryScore})
                </p>
              </div>
            )}
          </div>
        </td>

        {/* Contact & Location */}
        <td className="py-2.5 px-3 min-w-[200px] align-middle">
          <div className="space-y-0.5 text-[11px] text-slate-600 dark:text-gray-300">
            <div
              className="truncate font-medium text-slate-700 dark:text-slate-200 max-w-[190px]"
              title={vendor.contactPerson ? `Contact: ${vendor.contactPerson}` : undefined}
            >
              👤 Contact: {vendor.contactPerson}
            </div>
            <div
              className="truncate text-slate-500 dark:text-gray-400 max-w-[190px]"
              title={vendor.email}
            >
              ✉️ {vendor.email}
            </div>
            <div
              className="truncate text-slate-500 dark:text-gray-400 max-w-[190px]"
              title={vendor.phone}
            >
              📞 {vendor.phone}
            </div>
            {(() => {
              const vendorAddress = vendor.location || `${vendor.city || ''}${vendor.city && vendor.state ? ', ' : ''}${vendor.state || ''}`;
              return (
                <div
                  className="flex items-center gap-1 text-slate-500 dark:text-gray-400 truncate max-w-[190px]"
                  title={vendorAddress || undefined}
                >
                  <MapPin size={11} className="shrink-0" />
                  <span className="truncate">{vendorAddress || '—'}</span>
                </div>
              );
            })()}
          </div>
        </td>

        {/* Category */}
        <td className="py-2.5 px-3 min-w-[150px] align-middle">
          {vendor.minorCategories && vendor.minorCategories.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
              <span className="text-[9px] text-slate-400 font-semibold">{UI_STRINGS.vendorCategorySelect.categoryBadgePrefix}</span>
              {vendor.minorCategories.map((m: string) => (
                <span
                  key={m}
                  title={m}
                  className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40 truncate max-w-[110px] inline-block align-middle"
                >
                  {m}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-slate-400 italic">None</span>
          )}
        </td>

        {/* AI Score & Rating */}
        <td className="py-2.5 px-3 min-w-[140px] text-center align-middle">
          {showEvaluation && hasCompletedEvaluation && typeof vendor.score === 'number' ? (
            <div className="space-y-0.5">
              <div className="text-[9px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
              <div className="text-base font-mono font-black text-indigo-600 dark:text-indigo-400">
                {vendor.score}%
              </div>
              <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-center gap-0.5">
                <Star size={10} className="fill-amber-500 text-amber-500" />{' '}
                {vendor.rating || (vendor.score / 20).toFixed(1)} / 5.0
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
              {vendor.rating && (
                <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-center gap-0.5">
                  <Star size={10} className="fill-amber-500 text-amber-500" /> {vendor.rating} / 5.0
                </div>
              )}
            </div>
          )}
        </td>

        {/* Status */}
        <td className="py-2.5 px-3 min-w-[130px] text-center align-middle">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold border inline-block ${
              currentMode === 'mode_1' && !isUploaded
                ? 'bg-slate-100 dark:bg-gray-800 text-slate-500 border-slate-200'
                : getStatusStyle(vendor.status || '')
            }`}
          >
            {currentMode === 'mode_1' && !isUploaded
              ? 'UNAVAILABLE IN V1'
              : isLockedForProcucevV2
              ? 'LOCKED (PENDING BID)'
              : currentMode === 'mode_2' && isUploaded && !(vendor as any).overlap
              ? 'BUYER ROSTER (NO EVAL)'
              : vendor.status}
          </span>
          {vendor.evaluationRequested && (
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
        <td className="py-2.5 px-3 min-w-[200px] text-right align-middle">
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

            {/* Edit Vendor Button - Only for buyer-uploaded vendors */}
            {isUploaded && (
              <button
                type="button"
                onClick={() => handleOpenEditModal(vendor)}
                className="btn btn-secondary btn-xs font-semibold flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 shadow-xs"
                title="Edit vendor company information, categories, and contact details"
              >
                <Pencil size={11} /> Edit
              </button>
            )}

            {/* Delete Vendor Button - Only for buyer-uploaded vendors */}
            {isUploaded && (
              <button
                type="button"
                onClick={() => handleOpenDeleteModal(vendor)}
                className="btn btn-ghost btn-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1"
                title="Delete vendor from directory and database"
              >
                <Trash2 size={11} /> Delete
              </button>
            )}

            {/* Rate Vendor / AI Rating Button */}
            <button
              type="button"
              onClick={() => openRevisionModal(vendor)}
              className="btn btn-amber btn-xs font-bold flex items-center gap-1 shadow-xs"
              title="Rate supplier manually or request vendor evaluation"
            >
              <Star size={11} className="fill-current" /> Revise Rating
            </button>

            {showEvaluation ? (
              <button
                type="button"
                onClick={async () => {
                  // Opens only a stored evaluation record. No record means no evaluation.
                  let evalRec =
                    (vendor as any).storeRecord ||
                    vendorEvaluations.find(
                      (e) =>
                        (e.vendorId && e.vendorId === vendor.id) ||
                        (e.vendorName && e.vendorName.toLowerCase() === (vendor.name || '').toLowerCase())
                    );
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
          <div className="text-[10px] uppercase font-bold text-slate-400">Total Empanelled</div>
          <div className="text-xl sm:text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
            {buyerFilteredVendors.length}
          </div>
        </div>
        <div className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">OCR &amp; 360° Evaluated</div>
          <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
            {buyerFilteredVendors.filter((v) => v.evaluated).length}
          </div>
        </div>
        <div className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Preferred Status</div>
          <div className="text-xl sm:text-2xl font-black text-indigo-700 dark:text-indigo-300 mt-0.5">
            {buyerFilteredVendors.filter(
              (v) => v.status === 'PREFERRED ENTERPRISE SUPPLIER'
            ).length}
          </div>
        </div>
        <div className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Selected Suppliers</div>
          <div className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-0.5">
            {selectedVendorIds.length}
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
            <option value="ALL">All Statuses</option>
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
            <button
              type="button"
              data-testid="bulk-delete-vendors-button"
              onClick={handleOpenBulkDeleteModal}
              className="btn btn-rose btn-xs font-bold flex items-center gap-1.5 shadow-xs bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 size={12} />
              Delete Selected ({selectedVendorIds.length})
            </button>
          </div>
        )}
      </div>

      {/* Vendors Display List */}
      <div className="space-y-2.5">
        {buyerFilteredVendors.length > 0 && (
          <div className="rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-gray-800/60 border-b border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 w-10 text-center">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="py-2.5 px-3 min-w-[240px]">Supplier &amp; Details</th>
                    <th className="py-2.5 px-3 min-w-[200px]">Contact &amp; Location</th>
                    <th className="py-2.5 px-3 min-w-[150px]">{UI_STRINGS.vendorCategorySelect.categoryHeader}</th>
                    <th className="py-2.5 px-3 min-w-[140px] text-center">AI Score &amp; Rating</th>
                    <th className="py-2.5 px-3 min-w-[130px] text-center">Status</th>
                    <th className="py-2.5 px-3 min-w-[200px] text-right">Actions</th>
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
        <div className="modal-overlay !z-[1100]">
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
                onClick={() => setAddModalOpen(false)}
                disabled={isSubmittingAdd}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>

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
                <div>
                  <label htmlFor="add-vendor-phone" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Phone <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="add-vendor-phone"
                    type="tel"
                    required
                    placeholder="+91 XXXXX XXXXX"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
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

              <div>
                <label htmlFor="add-vendor-major-category" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  {UI_STRINGS.vendorCategorySelect.divisionLabel} <span className="text-rose-500">*</span>
                </label>
                <select
                  id="add-vendor-major-category"
                  aria-label={UI_STRINGS.vendorCategorySelect.divisionLabel}
                  required
                  value={formMajorCategory}
                  onChange={(e) => {
                    setFormMajorCategory(e.target.value);
                    setFormMinorCategories([]);
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

              <div>
                <label htmlFor="add-vendor-category-input" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  {UI_STRINGS.vendorCategorySelect.categoryLabel}
                </label>
                {formMinorCategories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {formMinorCategories.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold border border-indigo-200/50 dark:border-indigo-800"
                      >
                        {tag}
                        <button type="button" aria-label={`Remove ${tag}`} onClick={() => handleRemoveMinorCategoryTag(tag)}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <input
                    id="add-vendor-category-input"
                    type="text"
                    aria-label={UI_STRINGS.vendorCategorySelect.categoryLabel}
                    value={formMinorInput}
                    onChange={(e) => {
                      setFormMinorInput(e.target.value);
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
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                  />
                  {formMinorInput.trim().length > 0 && formMinorInput.trim().length < 3 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      {UI_STRINGS.vendorCategorySelect.minCharsHint}
                    </p>
                  )}
                  {showCategorySuggestions && formMinorInput.trim().length >= 3 && (
                    <div
                      id="add-vendor-category-suggestions"
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
                        <Loader2 size={10} className="animate-spin" /> Checking
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
                    className={`w-full text-xs p-2 rounded-lg border font-mono ${
                      formPincodeError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-700'
                    } bg-white dark:bg-gray-900`}
                  />
                  {formPincodeError && formPincode.trim().length >= 6 && (
                    <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{formPincodeError}</p>
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
                  placeholder="15-character GSTIN"
                  maxLength={15}
                  value={formGst}
                  onChange={(e) => setFormGst(e.target.value.toUpperCase())}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 uppercase font-mono"
                />
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
      <VendorUploadModal isOpen={bulkUploadModalOpen} onClose={() => setBulkUploadModalOpen(false)} />

      {/* ========================================================================= */}
      {/* EDIT VENDOR MODAL */}
      {/* ========================================================================= */}
      {editModalOpen && selectedVendorForCrud && (
        <div className="modal-overlay !z-[1100]">
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
                onClick={() => {
                  setEditModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

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
                  <div>
                    <label htmlFor="edit-vendor-major-category" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      {UI_STRINGS.vendorCategorySelect.divisionLabel} <span className="text-rose-500">*</span>
                    </label>
                    <select
                      id="edit-vendor-major-category"
                      aria-label={UI_STRINGS.vendorCategorySelect.divisionLabel}
                      value={formMajorCategory}
                      onChange={(e) => setFormMajorCategory(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    >
                      <option value="">{UI_STRINGS.vendorCategorySelect.divisionSelectPlaceholder}</option>
                      {availableMajorCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

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
                <div>
                  <label htmlFor="edit-vendor-category-input" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    {UI_STRINGS.vendorCategorySelect.categoryLabel}
                  </label>
                  {formMinorCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {formMinorCategories.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1"
                        >
                          {tag}
                          <button
                            type="button"
                            aria-label={`Remove ${tag}`}
                            onClick={() => handleRemoveMinorCategoryTag(tag)}
                            className="hover:text-rose-500 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <input
                        id="edit-vendor-category-input"
                        type="text"
                        aria-label={UI_STRINGS.vendorCategorySelect.categoryLabel}
                        placeholder={UI_STRINGS.vendorCategorySelect.searchPlaceholder}
                        value={formMinorInput}
                        onChange={(e) => {
                          setFormMinorInput(e.target.value);
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
                        id="edit-vendor-category-suggestions"
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
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Phone / Mobile Number <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
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
                      <label className="block font-semibold text-slate-700 dark:text-gray-300">Pincode</label>
                      {formPincodeValidating && (
                        <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                          <Loader2 size={10} className="animate-spin" /> Checking
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
                      type="text"
                      maxLength={6}
                      value={formPincode}
                      onChange={(e) => setFormPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className={`w-full text-xs p-2 rounded-lg border font-mono ${
                        formPincodeError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-700'
                      } bg-white dark:bg-gray-900`}
                    />
                    {formPincodeError && formPincode.trim().length >= 6 && (
                      <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{formPincodeError}</p>
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
                      {statutoryText(selectedVendorForCrud.gst || selectedVendorForCrud.gstin)}
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
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 shadow-md"
                >
                  <Check size={14} /> Save Changes
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
        <div className="modal-overlay !z-[1100]">
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
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Comprehensive supplier registration, compliance, and taxonomy profile.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setViewModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
              {/* Score & Key Highlights Bar */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50/50 dark:from-indigo-950/40 dark:to-purple-950/30 border border-indigo-200/60 dark:border-indigo-800/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Rating</span>
                  <div className="font-extrabold text-amber-600 text-sm mt-0.5 flex items-center justify-center gap-1">
                    <Star size={13} className="fill-amber-500 text-amber-500" />
                    {typeof selectedVendorForCrud.rating === 'number' ? `${selectedVendorForCrud.rating} / 5.0` : '—'}
                  </div>
                </div>

                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Mode 3 AI Score</span>
                  <div className="font-extrabold font-mono text-indigo-600 text-sm mt-0.5">
                    {(() => {
                      const hasRecord = Boolean(
                        (selectedVendorForCrud.storeRecord && typeof selectedVendorForCrud.storeRecord.overallScore === 'number') ||
                        allEvaluations.some(
                          (e) =>
                            ((e.vendorId && e.vendorId === selectedVendorForCrud.id) ||
                             (e.vendorName && e.vendorName.toLowerCase() === (selectedVendorForCrud.name || '').toLowerCase())) &&
                            typeof e.overallScore === 'number'
                        )
                      );
                      return hasRecord && typeof selectedVendorForCrud.score === 'number'
                        ? `${selectedVendorForCrud.score}%`
                        : '—';
                    })()}
                  </div>
                </div>

                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Status</span>
                  <div className="font-bold text-[10.5px] text-emerald-600 dark:text-emerald-400 mt-0.5 truncate">
                    {selectedVendorForCrud.status || '—'}
                  </div>
                </div>

                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Roster Origin</span>
                  <div className="font-bold text-[10.5px] text-slate-700 dark:text-gray-300 mt-0.5 truncate">
                    {isBuyerUploaded(selectedVendorForCrud) ? 'Internal Vendor' : 'Procucev Network'}
                  </div>
                </div>
              </div>

              {/* Taxonomy Details */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <Layers size={13} className="text-indigo-600" /> Procurement Taxonomy &amp; Products
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 dark:text-gray-300">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">{UI_STRINGS.vendorCategorySelect.divisionViewPrefix}</span>
                    <strong className="text-slate-900 dark:text-white">
                      {selectedVendorForCrud.majorCategory || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Minor Line Items:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedVendorForCrud.minorCategories && selectedVendorForCrud.minorCategories.length > 0 ? (
                        selectedVendorForCrud.minorCategories.map((m: string) => (
                          <span
                            key={m}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50"
                          >
                            {m}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 italic">No specific minors tagged</span>
                      )}
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
                        `${selectedVendorForCrud.city || ''}, ${selectedVendorForCrud.state || ''} ${
                          selectedVendorForCrud.country || 'India'
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
                    <strong data-testid="view-statutory-gstin">{statutoryText(selectedVendorForCrud.gst || selectedVendorForCrud.gstin)}</strong>
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
              <div className="flex items-center gap-2">
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
                <button
                  type="button"
                  onClick={() => handleRequestVendorEvaluation(selectedVendorForCrud)}
                  disabled={isRequestingEvaluation}
                  className="btn btn-secondary btn-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center gap-1.5 shadow-xs"
                  title={UI_STRINGS.vendorEvaluationRequest.buttonTooltip}
                >
                  {isRequestingEvaluation ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Send size={13} />
                  )}
                  {UI_STRINGS.vendorEvaluationRequest.buttonLabel}
                </button>
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
      {/* DELETE VENDOR CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deleteModalOpen && selectedVendorForCrud && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-rose-200 dark:border-rose-900/60 animate-fade-in flex flex-col">
            <div className="flex items-start gap-3 pb-3 border-b border-slate-200 dark:border-gray-800">
              <div className="p-3 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Vendor Record</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Are you sure you want to delete <strong>{selectedVendorForCrud.name}</strong> from your vendor directory?
                </p>
              </div>
            </div>

            <div className="my-4 p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-[11px] text-rose-800 dark:text-rose-300">
              <p>
                This action will permanently delete supplier ID <strong>{selectedVendorForCrud.id}</strong> (
                {selectedVendorForCrud.email}) from your private buyer master list and synchronised database records.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="btn btn-ghost btn-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteVendorConfirm}
                className="btn btn-rose btn-sm font-bold flex items-center gap-1.5 shadow-md bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl"
              >
                <Trash2 size={13} /> Delete Vendor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BULK DELETE VENDORS CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {bulkDeleteModalOpen && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-rose-200 dark:border-rose-900/60 animate-fade-in flex flex-col gap-4">
            <div className="flex items-start justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 shrink-0">
                  <Trash2 size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Delete Multiple Vendors ({selectedVendorIds.length})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    Are you sure you want to permanently delete these {selectedVendorIds.length} supplier records?
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="close-bulk-delete-modal"
                onClick={() => setBulkDeleteModalOpen(false)}
                disabled={isDeletingBulk}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2.5">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="font-semibold">Irreversible Action</p>
                <p className="text-[11px] mt-0.5 text-rose-700/90 dark:text-rose-300/90">
                  This will permanently delete {selectedVendorIds.length} selected vendor records from your private buyer master list and backend database.
                </p>
              </div>
            </div>

            {/* List Preview of Selected Vendors */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                <span>Selected Suppliers ({selectedVendorIds.length})</span>
                <span className="text-[10px] lowercase text-slate-400 font-normal">scroll to view all</span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-slate-50 dark:bg-gray-950/60 border border-slate-200 dark:border-gray-800 divide-y divide-slate-100 dark:divide-gray-800/60">
                {selectedVendorIds.map((id) => {
                  const vendor = buyerFilteredVendors.find((v) => v.id === id) || buyerVendors.find((v) => v.id === id);
                  return (
                    <div key={id} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {vendor ? vendor.name : id}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                          <span>{id}</span>
                          {vendor?.majorCategory && (
                            <>
                              <span>•</span>
                              <span>{vendor.majorCategory}</span>
                            </>
                          )}
                          {vendor?.email && (
                            <>
                              <span>•</span>
                              <span>{vendor.email}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="badge badge-rose text-[9px] font-bold shrink-0">
                        To Delete
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setBulkDeleteModalOpen(false)}
                disabled={isDeletingBulk}
                className="btn btn-ghost btn-sm font-semibold text-slate-600 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-bulk-delete-button"
                onClick={handleBulkDeleteConfirm}
                disabled={isDeletingBulk}
                className="btn btn-rose btn-sm font-bold flex items-center gap-1.5 shadow-md bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl disabled:opacity-50"
              >
                {isDeletingBulk ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={13} /> Delete {selectedVendorIds.length} Vendor{selectedVendorIds.length === 1 ? '' : 's'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BUYER VENDOR RATING REVISION MODAL */}
      {/* ========================================================================= */}
      {selectedVendorForRevision &&
        (() => {
          const vendor = selectedVendorForRevision;
          // Previous figures are the vendor's recorded values. A missing value shows a dash.
          const previousScore: number | null =
            typeof vendor.score === 'number' ? vendor.score : typeof vendor.rating === 'number' ? Math.round(vendor.rating * 20) : null;
          const previousRating: number | null =
            typeof vendor.rating === 'number' ? vendor.rating : previousScore !== null ? Number((previousScore / 20).toFixed(1)) : null;
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
                    type="button"
                    onClick={() => setSelectedVendorForRevision(null)}
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
                      <button
                        type="button"
                        onClick={() => handleRequestVendorEvaluation(vendor)}
                        disabled={isRequestingEvaluation}
                        className="btn btn-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 shadow-sm transition-all"
                        title={UI_STRINGS.vendorEvaluationRequest.buttonTooltip}
                      >
                        {isRequestingEvaluation ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Send size={11} />
                        )}
                        {UI_STRINGS.vendorEvaluationRequest.buttonLabel}
                      </button>
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
        <div className="modal-overlay !z-[1100] animate-fade-in">
          <div className="modal-content max-w-5xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-3xl shadow-2xl border-2 border-indigo-500/30 dark:border-indigo-500/40 animate-scale-up max-h-[92vh] flex flex-col space-y-4">
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
                      {selectedHistoryBatch ? 'Full Step Audit' : `${uploadHistoryList.length} Upload${uploadHistoryList.length === 1 ? '' : 's'} Recorded`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    {selectedHistoryBatch
                      ? 'Detailed breakdown of ingestion parameters, validation metrics, supplier records, and sourcing activation status.'
                      : 'View previous vendor template batches, inspect uploaded supplier records, and re-download template data.'}
                  </p>
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
                  onClick={() => {
                    setShowUploadHistoryModal(false);
                    setSelectedHistoryBatch(null);
                    setBatchSearchQuery('');
                  }}
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
                /* DETAILED 4-STEP BREAKDOWN VIEW FOR A SELECTED BATCH                       */
                /* ========================================================================= */
                (() => {
                  const records = selectedHistoryBatch.records || [];
                  // Counts are the batch's recorded values. Missing values show a dash.
                  const totalCount: number | string = selectedHistoryBatch.total ?? selectedHistoryBatch.imported ?? (records.length > 0 ? records.length : '—');
                  const importedCount: number | string = selectedHistoryBatch.imported ?? totalCount;
                  const duplicateCount: number | string = selectedHistoryBatch.duplicates ?? '—';

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
                            <Download size={13} /> Export Upload CSV
                          </button>
                        </div>
                      </div>

                      {/* STEP 1: Ingestion & Time Horizon Parameters */}
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                            1
                          </span>
                          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                            Step 1: Upload &amp; Time Horizon Configuration
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                          <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800 space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Template File Source</span>
                            <p className="font-bold text-slate-800 dark:text-white font-mono truncate flex items-center gap-1.5">
                              <FileText size={13} className="text-indigo-500 shrink-0" />
                              {selectedHistoryBatch.fileName || '—'}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-gray-400">Excel / Spreadsheet Dataset</p>
                          </div>

                        </div>
                      </div>

                      {/* STEP 2: Processing & Data Pipeline Metrics */}
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                            2
                          </span>
                          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                            Step 2: Processing &amp; Data Pipeline Metrics
                          </h4>
                        </div>
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

                        </div>
                      </div>

                      {/* STEP 3: Supplier Directory Records Table */}
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                              3
                            </span>
                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                              Step 3: Uploaded Supplier Coordinates &amp; Directory Records
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
                              <Download size={12} /> Re-export Upload CSV
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
