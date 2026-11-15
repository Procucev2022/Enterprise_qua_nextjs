'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { fetchSubscriptionPricing } from '@/lib/subscriptionPaymentClient';
import { getVendorCatalogueLimit } from './vendorPlanPricing';
import { productMatchesOpportunity } from './catalogueMatching';
import {
  downloadCatalogueTemplate,
  parseCatalogueWorkbook,
  type CatalogueUploadRow,
} from '@/lib/catalogueUploadClient';
import {
  Layers,
  Plus,
  Trash2,
  Edit2,
  Search,
  Check,
  AlertTriangle,
  UploadCloud,
  FileSpreadsheet,
  Package,
  Bell,
  Crown,
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';

interface ProductItem {
  id: string;
  name: string;
  category: string;
  sku: string;
  specs: string;
  // Null when the server did not return the value. Shown as a dash, never as zero.
  unitPrice: number | null;
  leadTimeDays: number | null;
  moq: number | null; // Minimum Order Quantity
}

/** A count or amount for display, or a dash when the value is missing. */
function displayValue(value: number | null | undefined, format: (n: number) => string): string {
  return typeof value === 'number' && Number.isFinite(value) ? format(value) : '—';
}

export default function ItemCatalogue() {
  const { showToast, addAuditLog, vendorCatalogue, setVendorCatalogue, vendorOpportunities, vendorSubscription, currentUserSession, categoryTaxonomy } = useApp();
  const vendorLabel = currentUserSession?.orgName || currentUserSession?.name || 'Vendor';

  // Use shared store state as the products list
  const products = vendorCatalogue as ProductItem[];
  const setProducts = setVendorCatalogue;

  // This vendor's own backend record id — the catalogue is now scoped per
  // vendor server-side (was one global shared array, see BUGS.md #24), so
  // every read/write needs to know who "my catalogue" actually belongs to.
  const [myVendorId, setMyVendorId] = useState<string | null>(null);
  const [isLoadingCatalogue, setIsLoadingCatalogue] = useState(true);
  // Set when the catalogue could not be read. The list is then shown as unavailable, not as empty.
  const [catalogueLoadError, setCatalogueLoadError] = useState<string | null>(null);
  // The product limit is a Select plan value from the pricing API. Null when the API does not return it,
  // and then no limit is shown or enforced here (the server still enforces its own cap on save).
  const [catalogueLimit, setCatalogueLimit] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchSubscriptionPricing().then((config) => {
      if (!cancelled) setCatalogueLimit(getVendorCatalogueLimit(config));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const authHeaders = (): Record<string, string> => {
    const token = authClient.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  useEffect(() => {
    let cancelled = false;
    async function loadCatalogue() {
      const email = currentUserSession?.email;
      if (!email) {
        setIsLoadingCatalogue(false);
        return;
      }
      setCatalogueLoadError(null);
      try {
        const vendorRes = await fetch(`/api/vendors/${encodeURIComponent(email)}`, { headers: authHeaders() });
        if (cancelled) return;
        if (vendorRes.status === 404) {
          setProducts([]);
          return;
        }
        if (!vendorRes.ok) {
          setCatalogueLoadError(UI_STRINGS.vendorWorkspace.catalogueUnavailable);
          return;
        }
        const vendorData = await vendorRes.json();
        const vendorId = vendorData?.data?.id;
        if (!vendorId) {
          setProducts([]);
          return;
        }
        setMyVendorId(vendorId);

        const catRes = await fetch(`/api/catalogue?vendorId=${encodeURIComponent(vendorId)}`);
        const catData = await catRes.json();
        if (cancelled) return;
        if (!catRes.ok || !catData.success) {
          setCatalogueLoadError(UI_STRINGS.vendorWorkspace.catalogueUnavailable);
          return;
        }
        setProducts(catData.data || []);
      } catch {
        if (!cancelled) setCatalogueLoadError(UI_STRINGS.vendorWorkspace.catalogueUnavailable);
      } finally {
        if (!cancelled) setIsLoadingCatalogue(false);
      }
    }
    loadCatalogue();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserSession?.email]);

  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [sku, setSku] = useState('');
  const [specs, setSpecs] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [moq, setMoq] = useState(''); // MOQ Form Field
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [cataloguePreview, setCataloguePreview] = useState<CatalogueUploadRow[]>([]);
  const [isImportingCatalogue, setIsImportingCatalogue] = useState(false);

  // Search filter & Summary filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRfqsAvailableOnly, setFilterRfqsAvailableOnly] = useState(false);

  // Category Autocomplete State
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const categoryContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (categoryContainerRef.current && !categoryContainerRef.current.contains(event.target as Node)) {
        setShowCategorySuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const activeTaxonomy = useMemo(() => {
    return [
      ...(categoryTaxonomy || []),
      { majorCategory: 'Pumps & Fluid Dynamics', minorCategories: ['Centrifugal Pumps', 'Valves & Actuators'] },
    ];
  }, [categoryTaxonomy]);

  const allAvailableCategories = useMemo(() => {
    const list: { name: string; major: string }[] = [];
    activeTaxonomy.forEach((c) => {
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
  }, [activeTaxonomy]);

  const filteredCategorySuggestions = useMemo(() => {
    const q = category.trim().toLowerCase();
    if (q.length < 3) return [];
    return allAvailableCategories.filter(
      (item) => item.name.toLowerCase().includes(q) || item.major.toLowerCase().includes(q)
    );
  }, [category, allAvailableCategories]);

  const currentCount = products.length;

  const handleAddOrEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !sku.trim() || !unitPrice.trim() || !leadTimeDays.trim() || !moq.trim()) {
      showToast('Validation Error', 'Please complete all required product catalog fields including MOQ.', 'warning');
      return;
    }

    const priceNum = parseFloat(unitPrice);
    const leadTimeNum = parseInt(leadTimeDays);
    const moqNum = parseInt(moq);

    if (priceNum <= 0) {
      showToast('Invalid Price', 'Please input a valid unit price.', 'warning');
      return;
    }

    if (leadTimeNum <= 0) {
      showToast('Invalid Lead Time', 'Please input valid lead time in days.', 'warning');
      return;
    }

    if (moqNum <= 0) {
      showToast('Invalid MOQ', 'Please input a valid Minimum Order Quantity.', 'warning');
      return;
    }

    setIsSavingProduct(true);
    try {
      if (isEditing) {
        const targetId = editingId || '';
        const res = await fetch(`/api/catalogue/${encodeURIComponent(targetId)}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ name, category, sku, specs, unitPrice: priceNum, leadTimeDays: leadTimeNum, moq: moqNum }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update product.');

        setProducts((prev) => prev.map((prod) => (prod.id === targetId ? data.data : prod)));
        showToast('Product Updated', `Successfully updated ${sku} in your catalog.`, 'success');
        addAuditLog(`${vendorLabel} updated product ${sku} inside catalogue`);
      } else {
        if (catalogueLimit !== null && products.length >= catalogueLimit) {
          showToast('Limit Reached', UI_STRINGS.vendorWorkspace.catalogueFullMessage, 'warning');
          return;
        }

        const res = await fetch('/api/catalogue', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name, category, sku: sku.toUpperCase(), specs, unitPrice: priceNum, leadTimeDays: leadTimeNum, moq: moqNum }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add product.');

        setProducts((prev) => [data.data, ...prev]);
        showToast('Product Added', `Successfully added product ${data.data.sku} to your catalog.`, 'success');
        addAuditLog(`${vendorLabel} created new catalogue item ${data.data.sku}`);
      }
      resetForm();
    } catch (err: unknown) {
      showToast(
        'Save Failed',
        err instanceof Error && err.message ? err.message : 'Could not save the product. Please try again.',
        'warning'
      );
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleEditClick = (prod: ProductItem) => {
    setIsEditing(true);
    setEditingId(prod.id);
    setName(prod.name);
    setCategory(prod.category);
    setSku(prod.sku);
    setSpecs(prod.specs);
    setUnitPrice(prod.unitPrice === null ? '' : String(prod.unitPrice));
    setLeadTimeDays(prod.leadTimeDays === null ? '' : String(prod.leadTimeDays));
    setMoq(prod.moq === null ? '' : String(prod.moq));
  };

  const handleDeleteClick = async (id: string, productSku: string) => {
    try {
      const res = await fetch(`/api/catalogue/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete product.');

      setProducts((prev) => prev.filter((p) => p.id !== id));
      showToast('Product Deleted', `Removed ${productSku} from catalogue.`, 'success');
      addAuditLog(`${vendorLabel} deleted product ${productSku} from catalogue`);
    } catch (err: unknown) {
      showToast(
        'Delete Failed',
        err instanceof Error && err.message ? err.message : 'Could not delete the product. Please try again.',
        'warning'
      );
    }
  };

  const handleCatalogueFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showToast('Unsupported File', 'Choose an Excel .xlsx workbook.', 'warning');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('File Too Large', 'Catalogue workbooks must be 10 MB or smaller.', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCatalogueWorkbook(reader.result as ArrayBuffer);
      if (!parsed.success) {
        showToast('Import Preview Failed', parsed.error, 'warning');
        setCataloguePreview([]);
        return;
      }
      const existingSkus = new Set(products.map((product) => product.sku.trim().toUpperCase()));
      const incomingSkus = new Set<string>();
      setCataloguePreview(parsed.rows.map((row) => {
        const errors = [...row.errors];
        const normalizedSku = row.sku.trim().toUpperCase();
        if (normalizedSku && existingSkus.has(normalizedSku)) errors.push('SKU already exists in your catalogue.');
        if (normalizedSku && incomingSkus.has(normalizedSku) && !errors.includes('SKU is duplicated in this workbook.')) {
          errors.push('SKU is duplicated in this workbook.');
        }
        if (normalizedSku) incomingSkus.add(normalizedSku);
        return { ...row, errors };
      }));
    };
    reader.onerror = () => showToast('Import Preview Failed', 'The workbook could not be read.', 'warning');
    reader.readAsArrayBuffer(file);
  };

  const handleCatalogueImport = async () => {
    const validRows = cataloguePreview.filter((row) => row.errors.length === 0);
    if (catalogueLimit !== null) {
      const available = Math.max(0, catalogueLimit - products.length);
      if (validRows.length > available) {
        showToast('Catalogue Capacity Exceeded', `Only ${available} more products fit in the ${catalogueLimit}-item catalogue. Remove rows from the workbook and preview it again.`, 'warning');
        return;
      }
    }
    if (validRows.length === 0) {
      showToast('Nothing to Import', 'Fix the validation errors before importing.', 'warning');
      return;
    }

    setIsImportingCatalogue(true);
    const created: ProductItem[] = [];
    const failures: string[] = [];
    try {
      for (const row of validRows) {
        const response = await fetch('/api/catalogue', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            name: row.name,
            sku: row.sku,
            category: row.category,
            specs: row.specs,
            unitPrice: row.unitPrice,
            leadTimeDays: row.leadTimeDays,
            moq: row.moq,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          failures.push(`Row ${row.rowNumber}: ${result.error || 'Import failed.'}`);
        } else {
          created.push(result.data);
        }
      }
      if (created.length) {
        setProducts((previous) => [...created, ...previous]);
        addAuditLog(`${vendorLabel} imported ${created.length} catalogue products from Excel`);
      }
      setCataloguePreview([]);
      showToast(
        failures.length ? 'Import Partially Completed' : 'Import Complete',
        `${created.length} imported; ${failures.length + cataloguePreview.filter((row) => row.errors.length > 0).length} skipped.${failures.length ? ` ${failures.join(' ')}` : ''}`,
        failures.length ? 'warning' : 'success'
      );
    } catch (err: unknown) {
      showToast(
        'Import Failed',
        err instanceof Error && err.message ? err.message : 'Could not complete the catalogue import.',
        'warning'
      );
    } finally {
      setIsImportingCatalogue(false);
    }
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditingId(null);
    setName('');
    setCategory('');
    setSku('');
    setSpecs('');
    setUnitPrice('');
    setLeadTimeDays('');
    setMoq('');
  };

  // Cross-match: find marketplace RFQs matching a product by keyword overlap.
  // Was: the filter callback ignored its own parameter and always tested the
  // product's own text against a hardcoded 'pump' literal — every product
  // either matched every RFQ or none, never based on the RFQ's actual content.
  const getMatchingRfqsForProduct = (prod: ProductItem) =>
    vendorOpportunities.filter((opp) => productMatchesOpportunity(prod, opp));

  // Total count of catalogue items that have matching open RFQs
  const productsWithRfqsCount = products.filter(
    (prod) => getMatchingRfqsForProduct(prod).length > 0
  ).length;

  // Filter products by search term and RFQ availability filter
  const filteredProducts = products.filter((prod) => {
    const term = searchTerm.toLowerCase();
    const matchSearch =
      prod.name.toLowerCase().includes(term) ||
      prod.sku.toLowerCase().includes(term) ||
      prod.category.toLowerCase().includes(term) ||
      prod.specs.toLowerCase().includes(term);

    if (!matchSearch) return false;

    if (filterRfqsAvailableOnly && getMatchingRfqsForProduct(prod).length === 0) {
      return false;
    }

    return true;
  });

  const percentage = catalogueLimit ? Math.min(100, (currentCount / catalogueLimit) * 100) : 0;
  const isSelectModel = vendorSubscription === 'select';
  const capacityLabel = catalogueLimit !== null
    ? formatString(UI_STRINGS.vendorWorkspace.catalogueCapacityWithLimit, { limit: catalogueLimit })
    : UI_STRINGS.vendorWorkspace.catalogueCapacityWithoutLimit;
  const productsLabel = catalogueLimit !== null
    ? formatString(UI_STRINGS.vendorWorkspace.catalogueProductsWithLimit, { count: currentCount, limit: catalogueLimit })
    : formatString(UI_STRINGS.vendorWorkspace.catalogueProductsWithoutLimit, { count: currentCount });
  const progressBarColor = percentage > 90
    ? 'bg-gradient-to-r from-red-500 to-rose-600'
    : percentage > 70
    ? 'bg-gradient-to-r from-amber-500 to-orange-600'
    : 'bg-gradient-to-r from-indigo-600 to-blue-500';

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            Item Catalogue
          </h1>
          <span className="sr-only">Product Catalogue Management</span>
          <span className={`badge text-[10px] font-extrabold uppercase ${
            isSelectModel
              ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300'
              : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300'
          }`}>
            {isSelectModel ? 'Select Model (Active)' : 'Select Model Required'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-xs cursor-pointer border-none"
        >
          <Layers size={15} />
          <span>Catalogue</span>
        </button>
      </div>

      {/* Select Mode Subscription Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-pink-500/10 border border-purple-200/80 dark:border-purple-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-200/60 dark:border-amber-800/40">
            <Crown size={22} className="text-amber-500" />
          </div>
          <div>
            <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
              Select Mode Subscription
            </h3>
            <p className="text-xs text-slate-600 dark:text-gray-300 mt-0.5">
              Choose a subscription mode to add or manage products in your catalogue.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm shrink-0 cursor-pointer"
        >
          <Sparkles size={14} />
          <span>Select Mode Subscription</span>
        </button>
      </div>

      {/* Product Capacity Tracker Card */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-2.5">
        <div className="flex justify-between items-center text-xs font-bold text-slate-900 dark:text-white">
          <span className="flex items-center gap-2">
            <Layers size={16} className="text-blue-600 shrink-0" />
            <span>{capacityLabel}</span>
          </span>
          <span className="font-black text-sm text-slate-900 dark:text-white">
            {currentCount} / 100 Products
            <span className="sr-only">{productsLabel}</span>
          </span>
        </div>
        
        {/* Progress bar */}
        <div className="w-full bg-slate-100 dark:bg-gray-800 h-3 rounded-full overflow-hidden border border-slate-200/60 dark:border-gray-700/60">
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressBarColor}`}
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      </div>

      {/* Bulk Upload Row */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="btn btn-sm font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-2 border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 cursor-pointer shadow-2xs">
          <FileSpreadsheet size={15} className="text-purple-600" />
          <span>Bulk Upload (Excel)</span>
          <input
            aria-label="Upload catalogue Excel workbook"
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={handleCatalogueFile}
          />
        </label>
        <button
          type="button"
          onClick={downloadCatalogueTemplate}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-gray-200 underline cursor-pointer"
        >
          Download Excel Template
        </button>
        <span className="text-xs text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
          <Info size={14} className="text-slate-400 shrink-0" />
          <span>Only Excel (.xlsx/.xls) | Max 100 products per upload</span>
        </span>
      </div>

      {cataloguePreview.length > 0 && (
        <section aria-label="Catalogue import preview" className="glass-panel rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-gray-900/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Import Preview</h2>
              <p className="text-xs text-slate-500">{cataloguePreview.filter((row) => !row.errors.length).length} valid; {cataloguePreview.filter((row) => row.errors.length > 0).length} with errors. {catalogueLimit !== null ? formatString(UI_STRINGS.vendorWorkspace.catalogueRemainingWithLimit, { count: Math.max(0, catalogueLimit - products.length) }) : null}</p>
            </div>
            <button type="button" disabled={isImportingCatalogue} onClick={handleCatalogueImport} className="btn btn-primary px-4 py-2 text-xs font-bold disabled:opacity-50">
              {isImportingCatalogue ? 'Importing...' : 'Import Valid Rows'}
            </button>
          </div>
          <div className="mt-3 max-h-56 overflow-auto text-xs">
            <table className="w-full text-left">
              <thead><tr><th className="p-2">Row</th><th className="p-2">SKU</th><th className="p-2">Product</th><th className="p-2">Result</th></tr></thead>
              <tbody>{cataloguePreview.map((row) => (
                <tr key={row.rowNumber} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-2">{row.rowNumber}</td><td className="p-2">{row.sku}</td><td className="p-2">{row.name}</td>
                  <td className="p-2">{row.errors.length ? row.errors.join(' ') : 'Ready to import'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Table (span 7 or 8) */}
        <div className="lg:col-span-7 xl:col-span-8 p-4 rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-3">
          {/* Top of Table: Filters & Search */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterRfqsAvailableOnly(!filterRfqsAvailableOnly)}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border shadow-2xs cursor-pointer whitespace-nowrap ${
                  filterRfqsAvailableOnly
                    ? 'bg-blue-600 text-white border-blue-500 ring-2 ring-blue-400/30'
                    : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border-slate-200 dark:border-gray-700 hover:bg-slate-100'
                }`}
                title="Click to filter products that have matching open RFQs in the marketplace"
              >
                <Bell size={12} className={productsWithRfqsCount > 0 ? "animate-pulse text-amber-500" : ""} />
                <span>🔔 Summary: {productsWithRfqsCount} Products with RFQs</span>
              </button>
            </div>

            <div className="relative text-xs w-full sm:w-60">
              <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
                <Search size={13} />
              </span>
              <input
                type="text"
                placeholder="Search SKU, name, specs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input pl-8 py-1.5 w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl font-medium text-xs text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/70 dark:bg-gray-950/40 text-[11px] font-bold text-slate-700 dark:text-gray-300 border-b border-slate-200/80 dark:border-gray-800">
                  <th className="py-2.5 px-2 text-center w-8">
                    <input type="checkbox" aria-label="Select all products" className="rounded border-slate-300 text-blue-600 cursor-pointer" />
                  </th>
                  <th className="py-2.5 px-2 text-center whitespace-nowrap font-bold">S.No</th>
                  <th className="py-2.5 px-3 whitespace-nowrap font-bold">SKU / Model</th>
                  <th className="py-2.5 px-3 whitespace-nowrap font-bold">Item Name &amp; Specifications</th>
                  <th className="py-2.5 px-3 whitespace-nowrap font-bold">Category</th>
                  <th className="py-2.5 px-3 whitespace-nowrap font-bold text-right">Unit Price (₹)</th>
                  <th className="py-2.5 px-2 whitespace-nowrap font-bold text-center">MOQ</th>
                  <th className="py-2.5 px-2 whitespace-nowrap font-bold text-center">Lead Time</th>
                  <th className="py-2.5 px-2 whitespace-nowrap font-bold text-center">Status</th>
                  <th className="py-2.5 px-2 whitespace-nowrap font-bold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800 text-xs">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={10} role={catalogueLoadError ? 'alert' : undefined} className="py-12 text-center text-slate-400 text-xs">
                      {catalogueLoadError || 'No matching products found in catalogue.'}
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((prod, idx) => {
                    const matchingRfqs = getMatchingRfqsForProduct(prod);
                    const hasRfqMatch = matchingRfqs.length > 0;

                    return (
                      <tr key={prod.id} className="hover:bg-slate-50/70 dark:hover:bg-gray-800/40 transition-colors">
                        <td className="py-3 px-2 text-center">
                          <input type="checkbox" aria-label={`Select ${prod.sku}`} className="rounded border-slate-300 text-blue-600 cursor-pointer" />
                        </td>
                        <td className="py-3 px-2 text-center font-bold text-slate-500 whitespace-nowrap">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white uppercase whitespace-nowrap text-xs">
                          {prod.sku}
                        </td>
                        <td className="py-3 px-3 max-w-[200px]">
                          <div className="font-bold text-slate-800 dark:text-gray-100 truncate text-xs">{prod.name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-gray-400 truncate mt-0.5" title={prod.specs}>
                            {prod.specs || '—'}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            {prod.category}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap text-xs">
                          {displayValue(prod.unitPrice, (n) => `₹ ${n.toLocaleString('en-IN')}`)}
                        </td>
                        <td className="py-3 px-2 text-center font-mono font-medium text-slate-700 dark:text-gray-300 whitespace-nowrap">
                          {displayValue(prod.moq, (n) => `${n}`)}
                        </td>
                        <td className="py-3 px-2 text-center font-mono font-medium text-slate-700 dark:text-gray-300 whitespace-nowrap">
                          {displayValue(prod.leadTimeDays, (n) => `${n} Days`)}
                        </td>
                        <td className="py-3 px-2 text-center whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEditClick(prod)}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-lg transition-colors cursor-pointer"
                              title="Edit Product"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(prod.id, prod.sku)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors cursor-pointer"
                              title="Delete Product"
                            >
                              <Trash2 size={12} />
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

          {/* Pagination Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-gray-800 text-xs text-slate-500">
            <span>Showing 1 – {filteredProducts.length} of {filteredProducts.length} Items</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="w-7 h-7 rounded-lg border border-slate-200 dark:border-gray-700 flex items-center justify-center text-slate-500 hover:bg-slate-50 cursor-pointer"
              >
                <ChevronLeft size={13} />
              </button>
              <button
                type="button"
                className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs shadow-xs"
              >
                1
              </button>
              <button
                type="button"
                className="w-7 h-7 rounded-lg border border-slate-200 dark:border-gray-700 flex items-center justify-center text-slate-500 hover:bg-slate-50 cursor-pointer"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Add Product to Catalogue Form (span 5 or 4) */}
        <div className="lg:col-span-5 xl:col-span-4 p-5 rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4 sticky top-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers size={14} className="text-blue-600" />
              <span>{isEditing ? 'Edit Product Item' : 'Add Product to Catalogue'}</span>
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              title="Close / Reset form"
            >
              <X size={15} />
            </button>
          </div>

          <form onSubmit={handleAddOrEditProduct} className="space-y-3.5 text-xs">
            {/* Product Name */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-600 dark:text-gray-400">Product Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Centrifugal Water Pump"
                className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white text-xs font-medium"
                required
              />
            </div>

            {/* SKU & Category */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-600 dark:text-gray-400">SKU / Model *</label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="SKU-PUMP-500"
                  className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white text-xs font-medium uppercase"
                  required
                />
              </div>

              <div className="space-y-1 relative" ref={categoryContainerRef}>
                <select
                  className="sr-only"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">—</option>
                  {category !== '' && !activeTaxonomy.some((group) => group.majorCategory === category) && <option value={category}>{category}</option>}
                  {activeTaxonomy.map((group) => (
                    <optgroup key={group.majorCategory} label={group.majorCategory}>
                      <option value={group.majorCategory}>{group.majorCategory}</option>
                      {(group.minorCategories || []).map((minor) => (
                        <option key={`${group.majorCategory}-${minor}`} value={`${group.majorCategory} — ${minor}`}>
                          {minor}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold text-slate-600 dark:text-gray-400">Category *</label>
                  {category && (
                    <button
                      type="button"
                      onClick={() => {
                        setCategory('');
                        setShowCategorySuggestions(false);
                      }}
                      className="text-[9px] text-slate-400 hover:text-rose-500 font-semibold"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setShowCategorySuggestions(true);
                    }}
                    onFocus={() => {
                      if (category.trim().length >= 3) {
                        setShowCategorySuggestions(true);
                      }
                    }}
                    placeholder="Type 3+ characters to search..."
                    className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white text-xs font-medium"
                  />
                  {category.trim().length > 0 && category.trim().length < 3 && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      Enter at least 3 characters to search categories
                    </p>
                  )}
                  {showCategorySuggestions && category.trim().length >= 3 && (
                    <div
                      role="listbox"
                      className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl divide-y divide-slate-100 dark:divide-gray-700/60"
                    >
                      <div className="px-3 py-1.5 bg-slate-50 dark:bg-gray-900/80 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center justify-between">
                        <span>Matching Categories ({filteredCategorySuggestions.length})</span>
                        <span className="text-[9px] text-blue-600 dark:text-blue-400 font-semibold">Taxonomy</span>
                      </div>
                      {filteredCategorySuggestions.length > 0 ? (
                        filteredCategorySuggestions.map((item) => (
                          <button
                            key={`${item.major}-${item.name}`}
                            type="button"
                            role="option"
                            aria-selected={category === item.name}
                            onClick={() => {
                              setCategory(item.name);
                              setShowCategorySuggestions(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-blue-950/60 flex items-center justify-between text-slate-700 dark:text-gray-200 transition-colors"
                          >
                            <span className="font-semibold text-slate-800 dark:text-white">{item.name}</span>
                            <span className="text-[10px] text-slate-400 italic">{item.major}</span>
                          </button>
                        ))
                      ) : (
                        <div className="p-3 text-center space-y-1">
                          <p className="text-xs text-slate-500 dark:text-gray-400">No matching categories found</p>
                          <button
                            type="button"
                            onClick={() => setShowCategorySuggestions(false)}
                            className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Use &quot;{category.trim()}&quot; as custom category
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Price, Lead Time & MOQ */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-600 dark:text-gray-400">Unit Price (₹) *</label>
                <input
                  type="number"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="850"
                  className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white text-xs font-medium"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-600 dark:text-gray-400">Lead Time *</label>
                <input
                  type="number"
                  value={leadTimeDays}
                  onChange={(e) => setLeadTimeDays(e.target.value)}
                  placeholder="5"
                  className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white text-xs font-medium"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-600 dark:text-gray-400">MOQ *</label>
                <input
                  type="number"
                  value={moq}
                  onChange={(e) => setMoq(e.target.value)}
                  placeholder="10"
                  className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white text-xs font-medium"
                  required
                />
              </div>
            </div>

            {/* Technical Specifications */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-600 dark:text-gray-400">Technical Specs</label>
              <textarea
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                placeholder="Details of materials, sizes, compatibility standards..."
                rows={3}
                className="textarea w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-xl text-slate-900 dark:text-white text-xs font-medium"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={isSavingProduct || isLoadingCatalogue}
                className="btn w-full text-xs font-bold py-2.5 rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer border-none"
              >
                {isSavingProduct ? 'Saving...' : isEditing ? 'Update Item' : 'Add Item'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-secondary text-xs rounded-xl"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
