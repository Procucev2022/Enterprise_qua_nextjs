'use client';

import React, { useState, useEffect } from 'react';
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
        if (vendorRes.status === 404) {
          // No vendor profile exists yet, so there is no catalogue to show.
          if (!cancelled) setProducts([]);
          return;
        }
        if (!vendorRes.ok) {
          if (!cancelled) setCatalogueLoadError(UI_STRINGS.vendorWorkspace.catalogueUnavailable);
          return;
        }
        const vendorData = await vendorRes.json();
        const vendorId = vendorData?.data?.id;
        if (!vendorId) {
          if (!cancelled) setProducts([]);
          return;
        }
        if (!cancelled) setMyVendorId(vendorId);

        const catRes = await fetch(`/api/catalogue?vendorId=${encodeURIComponent(vendorId)}`);
        const catData = await catRes.json();
        if (cancelled) return;
        if (!catRes.ok || !catData.success) {
          setCatalogueLoadError(UI_STRINGS.vendorWorkspace.catalogueUnavailable);
          return;
        }
        setProducts(catData.data || []);
      } catch {
        // The list is not replaced, and the failure is shown instead of an empty catalogue.
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
      if (isEditing && editingId) {
        const res = await fetch(`/api/catalogue/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ name, category, sku, specs, unitPrice: priceNum, leadTimeDays: leadTimeNum, moq: moqNum }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update product.');

        setProducts((prev) => prev.map((prod) => (prod.id === editingId ? data.data : prod)));
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

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Product Catalogue Management
            </h1>
            <span className={`badge text-[10px] font-extrabold uppercase ${
              vendorSubscription === 'select'
                ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300'
                : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300'
            }`}>
              {vendorSubscription === 'select' ? 'Select Model (Active)' : 'Select Model Required'}
            </span>
          </div>
        </div>
      </div>

      {/* Select Model Plan Banner */}
      {vendorSubscription !== 'select' && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-blue-500/10 border border-purple-200 dark:border-purple-900/60 text-xs text-slate-800 dark:text-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🎁</span>
            <div>
              <span className="font-extrabold block text-purple-900 dark:text-purple-200">
                Item Catalogue Feature (Select Model)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-gray-400">
                {catalogueLimit !== null
                  ? formatString(UI_STRINGS.vendorWorkspace.catalogueSelectBannerWithLimit, { limit: catalogueLimit })
                  : UI_STRINGS.vendorWorkspace.catalogueSelectBannerWithoutLimit}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Product Capacity Tracker Widget */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1.5 grow w-full">
          <div className="flex justify-between items-center text-xs font-bold text-slate-800 dark:text-white">
            <span className="flex items-center gap-1">
              <Package size={15} className="text-indigo-500 animate-pulse" />
              {catalogueLimit !== null
                ? formatString(UI_STRINGS.vendorWorkspace.catalogueCapacityWithLimit, { limit: catalogueLimit })
                : UI_STRINGS.vendorWorkspace.catalogueCapacityWithoutLimit}
            </span>
            <span className="mono">
              {catalogueLimit !== null
                ? formatString(UI_STRINGS.vendorWorkspace.catalogueProductsWithLimit, { count: currentCount, limit: catalogueLimit })
                : formatString(UI_STRINGS.vendorWorkspace.catalogueProductsWithoutLimit, { count: currentCount })}
            </span>
          </div>
          
          {catalogueLimit !== null && (
          <div className="w-full bg-slate-100 dark:bg-gray-800 h-3.5 rounded-full overflow-hidden border border-slate-200/50 dark:border-gray-700/50">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                percentage > 90
                  ? 'bg-gradient-to-r from-red-500 to-rose-600'
                  : percentage > 70
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600'
                  : 'bg-gradient-to-r from-indigo-600 to-emerald-500'
              }`}
              style={{ width: `${percentage}%` }}
            ></div>
          </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 shrink-0 w-full md:w-auto">
          <button type="button" onClick={downloadCatalogueTemplate} className="btn btn-secondary font-bold text-xs py-2 px-4 border border-slate-200 text-slate-700 dark:text-gray-300">
            Download Excel Template
          </button>
          <label className="btn btn-secondary font-bold text-xs py-2 px-4 flex items-center gap-1.5 border border-slate-200 text-slate-700 dark:text-gray-300 cursor-pointer">
            <UploadCloud size={14} className="text-indigo-650" />
            Upload Excel
            <input aria-label="Upload catalogue Excel workbook" type="file" accept=".xlsx" className="sr-only" onChange={handleCatalogueFile} />
          </label>
        </div>
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
                  <td className="p-2">{row.rowNumber}</td><td className="p-2">{row.sku || '-'}</td><td className="p-2">{row.name || '-'}</td>
                  <td className="p-2">{row.errors.length ? row.errors.join(' ') : 'Ready to import'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* CREATE / EDIT PRODUCT FORM */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/60 shadow-md space-y-4">
          <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider border-b pb-2 flex items-center gap-1.5">
            {isEditing ? <Edit2 size={13} className="text-indigo-500" /> : <Plus size={14} className="text-emerald-600" />}
            {isEditing ? 'Edit Product Item' : 'Add Product to Catalogue'}
          </h3>

          <form onSubmit={handleAddOrEditProduct} className="space-y-3.5 text-xs">
            {/* Product Name */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Product Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Centrifugal Water Pump"
                className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-white"
                required
              />
            </div>

            {/* SKU & Category */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">SKU / Model *</label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="SKU-PUMP-500"
                  className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-white uppercase"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="select w-full bg-slate-50 dark:bg-gray-955 border border-slate-250 rounded-lg font-bold text-slate-800 dark:text-white"
                >
                  <option value="">—</option>
                  {category !== '' && !categoryTaxonomy.some((group) => group.majorCategory === category) && <option value={category}>{category}</option>}
                  {categoryTaxonomy.map((group) => (
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
              </div>
            </div>

            {/* Price, Lead Time & MOQ */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-450 dark:text-gray-500">Unit Price (₹) *</label>
                <input
                  type="number"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="850"
                  className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-450 dark:text-gray-500">Lead Time *</label>
                <input
                  type="number"
                  value={leadTimeDays}
                  onChange={(e) => setLeadTimeDays(e.target.value)}
                  placeholder="5"
                  className="input w-full bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-455 dark:text-gray-500">MOQ *</label>
                <input
                  type="number"
                  value={moq}
                  onChange={(e) => setMoq(e.target.value)}
                  placeholder="10"
                  className="input w-full bg-slate-50 dark:bg-gray-955 border border-slate-250 rounded-lg text-slate-800 dark:text-white"
                  required
                />
              </div>
            </div>

            {/* Technical Specifications */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Technical Specs</label>
              <textarea
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                placeholder="Details of materials, sizes, compatibility standards..."
                rows={3}
                className="textarea w-full bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-white text-xs"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={isSavingProduct || isLoadingCatalogue}
                className={`btn flex-1 text-xs font-bold py-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                  isEditing
                    ? 'btn-primary bg-indigo-650 hover:bg-indigo-600'
                    : 'btn-success bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-none'
                }`}
              >
                {isSavingProduct ? 'Saving...' : isEditing ? 'Update Item' : 'Add Item'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* CATALOG LIST AND SEARCH TABLE */}
        <div className="lg:col-span-2 glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
            <h3 className="text-xs font-bold text-slate-805 dark:text-gray-255 uppercase tracking-wider flex items-center gap-2">
              <Layers size={14} className="text-indigo-600" />
              Catalogue Products ({catalogueLoadError ? '—' : filteredProducts.length} Items Listed)
            </h3>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              {/* Bidirectional Cross-Highlight Summary Filter Button */}
              <button
                type="button"
                onClick={() => setFilterRfqsAvailableOnly(!filterRfqsAvailableOnly)}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border shadow-sm cursor-pointer whitespace-nowrap ${
                  filterRfqsAvailableOnly
                    ? 'bg-violet-600 text-white border-violet-500 ring-2 ring-violet-400/30'
                    : 'bg-violet-50/80 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40 hover:bg-violet-100'
                }`}
                title="Click to filter products that have matching open RFQs in the marketplace"
              >
                <Bell size={13} className="animate-pulse" />
                <span>🔔 Summary: {productsWithRfqsCount} Products with RFQs</span>
                {filterRfqsAvailableOnly ? (
                  <span className="text-[9px] bg-white/25 text-white px-1.5 py-0.25 rounded font-black uppercase">Filtered</span>
                ) : (
                  <span className="text-[9px] bg-violet-200/60 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200 px-1.5 py-0.25 rounded font-bold">Filter</span>
                )}
              </button>

              {/* Search Input */}
              <div className="relative text-xs w-full sm:w-56">
                <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
                  <Search size={13} />
                </span>
                <input
                  type="text"
                  placeholder="Search SKU, name, specs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input pl-8 py-1 w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 rounded-lg font-bold"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 dark:border-gray-800 text-slate-400 uppercase tracking-wider text-[9px] font-bold">
                  <th className="py-2">SKU / Model</th>
                  <th className="py-2">Item Name & Specs</th>
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-center">MOQ</th>
                  <th className="py-2 text-center">Lead Time</th>
                  <th className="py-2 text-center">RFQs Available</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-850 text-[11px]">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} role={catalogueLoadError ? 'alert' : undefined} className="py-8 text-center text-slate-400 text-xs">
                      {catalogueLoadError || 'No matching products found in catalogue.'}
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((prod) => {
                    const matchingRfqs = getMatchingRfqsForProduct(prod);
                    const hasRfqMatch = matchingRfqs.length > 0;

                    return (
                    <tr key={prod.id} className={`hover:bg-slate-50/50 dark:hover:bg-gray-850/20 ${hasRfqMatch ? 'bg-violet-50/30 dark:bg-violet-950/10' : ''}`}>
                      {/* SKU */}
                      <td className="py-3 font-mono font-bold text-slate-900 dark:text-white uppercase">{prod.sku}</td>
                      
                      {/* Name & Specs */}
                      <td className="py-3 max-w-[200px]">
                        <div className="font-semibold text-slate-800 dark:text-gray-200 truncate">{prod.name}</div>
                        <div className="text-[10px] text-slate-400 dark:text-gray-500 truncate" title={prod.specs}>
                          {prod.specs || 'No technical specifications provided.'}
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3 text-slate-500">{prod.category}</td>

                      {/* Price */}
                      <td className="py-3 text-right font-mono font-bold text-indigo-650 dark:text-indigo-400">
                        {displayValue(prod.unitPrice, (n) => `₹${n.toLocaleString('en-IN')}`)}
                      </td>

                      {/* MOQ */}
                      <td className="py-3 text-center font-bold text-indigo-600 dark:text-indigo-300 mono">
                        {displayValue(prod.moq, (n) => `${n.toLocaleString()} units`)}
                      </td>

                      {/* Lead Time */}
                      <td className="py-3 text-center mono text-slate-700 dark:text-gray-300">
                        {displayValue(prod.leadTimeDays, (n) => `${n} Days`)}
                      </td>

                      {/* RFQs Available */}
                      <td className="py-3 text-center">
                        {hasRfqMatch ? (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-black bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/40"
                            title="Matching RFQs available in marketplace"
                          >
                            <Bell size={9} className="animate-pulse" /> {matchingRfqs.length} RFQs Available
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleEditClick(prod)}
                            className="p-1 text-slate-500 hover:text-indigo-650 bg-slate-100 hover:bg-indigo-50 dark:bg-gray-800 dark:hover:bg-indigo-950 rounded border-none cursor-pointer"
                            title="Edit Product"
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(prod.id, prod.sku)}
                            className="p-1 text-slate-500 hover:text-red-650 bg-slate-100 hover:bg-red-50 dark:bg-gray-800 dark:hover:bg-red-950 rounded border-none cursor-pointer"
                            title="Delete Product"
                          >
                            <Trash2 size={11} />
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
  );
}
