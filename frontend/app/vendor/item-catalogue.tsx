'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
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
  unitPrice: number;
  leadTimeDays: number;
  moq: number; // Minimum Order Quantity
}

export default function ItemCatalogue() {
  const { showToast, addAuditLog, vendorCatalogue, setVendorCatalogue, vendorOpportunities, vendorSubscription } = useApp();

  // Use shared store state as the products list
  const products = vendorCatalogue as ProductItem[];
  const setProducts = setVendorCatalogue;

  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Pumps & Fluid Dynamics');
  const [sku, setSku] = useState('');
  const [specs, setSpecs] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [moq, setMoq] = useState(''); // MOQ Form Field

  // Search filter & Summary filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRfqsAvailableOnly, setFilterRfqsAvailableOnly] = useState(false);

  // Max product limit
  const MAX_LIMIT = 100;
  const currentCount = products.length;

  const handleAddOrEditProduct = (e: React.FormEvent) => {
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

    if (isEditing && editingId) {
      // Edit existing product
      setProducts((prev) =>
        prev.map((prod) =>
          prod.id === editingId
            ? { ...prod, name, category, sku, specs, unitPrice: priceNum, leadTimeDays: leadTimeNum, moq: moqNum }
            : prod
        )
      );
      showToast('Product Updated', `Successfully updated ${sku} in your catalog.`, 'success');
      addAuditLog(`Apex Supplies updated product ${sku} inside catalogue`, 'VN-APEX-4920', 'vendor@apex.com');
      resetForm();
    } else {
      // Check maximum limit constraint
      if (products.length >= MAX_LIMIT) {
        showToast('Limit Reached', `Unable to add product. Catalogue size is capped at ${MAX_LIMIT} items.`, 'warning');
        return;
      }

      const newProduct: ProductItem = {
        id: `prod-${Date.now()}`,
        name,
        category,
        sku: sku.toUpperCase(),
        specs,
        unitPrice: priceNum,
        leadTimeDays: leadTimeNum,
        moq: moqNum,
      };

      setProducts((prev) => [newProduct, ...prev]);
      showToast('Product Added', `Successfully added product ${newProduct.sku} to your catalog.`, 'success');
      addAuditLog(`Apex Supplies created new catalogue item ${newProduct.sku}`, 'VN-APEX-4920', 'vendor@apex.com');
      resetForm();
    }
  };

  const handleEditClick = (prod: ProductItem) => {
    setIsEditing(true);
    setEditingId(prod.id);
    setName(prod.name);
    setCategory(prod.category);
    setSku(prod.sku);
    setSpecs(prod.specs);
    setUnitPrice(prod.unitPrice.toString());
    setLeadTimeDays(prod.leadTimeDays.toString());
    setMoq(prod.moq.toString());
  };

  const handleDeleteClick = (id: string, productSku: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast('Product Deleted', `Removed ${productSku} from catalogue.`, 'success');
    addAuditLog(`Apex Supplies deleted product ${productSku} from catalogue`, 'VN-APEX-4920', 'vendor@apex.com');
  };

  const handleSimulateBulkImport = () => {
    if (products.length >= MAX_LIMIT) {
      showToast('Limit Reached', `Unable to import. Catalogue size is already at the ${MAX_LIMIT} item cap.`, 'warning');
      return;
    }

    // Generate mock bulk products up to 40 items to showcase limit bar
    const importItemsCount = Math.min(35, MAX_LIMIT - products.length);
    const importedList: ProductItem[] = [];

    for (let i = 1; i <= importItemsCount; i++) {
      const idx = products.length + i;
      importedList.push({
        id: `bulk-prod-${idx}`,
        name: `Industrial Flanged Adapter Fitting (Model: FLG-${100 + idx})`,
        category: 'Pipes & Fittings',
        sku: `SKU-PIPE-F${100 + idx}`,
        specs: `Standard carbon steel flanged connector pipe adapter fitting, size ${2 + (idx % 4)} inches.`,
        unitPrice: 150 + (idx * 5),
        leadTimeDays: 3 + (idx % 5),
        moq: 5 + (idx % 3),
      });
    }

    setProducts((prev) => [...prev, ...importedList]);
    showToast('Bulk Import Successful', `Ingested ${importedList.length} products with MOQ details from template.`, 'success');
    addAuditLog(`Apex Supplies performed bulk catalogue import of ${importedList.length} products`, 'VN-APEX-4920', 'vendor@apex.com');
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditingId(null);
    setName('');
    setCategory('Pumps & Fluid Dynamics');
    setSku('');
    setSpecs('');
    setUnitPrice('');
    setLeadTimeDays('');
    setMoq('');
  };

  // Cross-match: find marketplace RFQs matching a product by keyword comparison
  const getMatchingRfqsForProduct = (prod: ProductItem) => {
    const prodText = `${prod.name} ${prod.category} ${prod.specs}`.toLowerCase();
    return vendorOpportunities.filter(() => prodText.includes('pump'));
  };

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

  const percentage = Math.min(100, (currentCount / MAX_LIMIT) * 100);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Product Catalogue Management
            </h1>
            <span className="badge badge-purple">Screen 3.4</span>
            <span className={`badge text-[10px] font-extrabold uppercase ${
              vendorSubscription === 'select'
                ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300'
                : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300'
            }`}>
              {vendorSubscription === 'select' ? 'Select Model (Active)' : 'Select Model Required'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Build and manage your vendor item catalogue for automated RFQ matching, including Minimum Order Quantity (MOQ).
          </p>
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
                Vendors on the <strong>Select Model</strong> ($349 / 3 mo) can publish up to 100 products with MOQs and download up to 100 RFQs.
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
              Catalogue Capacity (Limit: 100 Products)
            </span>
            <span className="mono">{currentCount} / {MAX_LIMIT} Products Ingested</span>
          </div>
          
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
          <div className="text-[10px] text-slate-400 dark:text-gray-500">
            Automated Sourcing matching chasers read this catalogue to prioritize direct invitations to Apex Supplies.
          </div>
        </div>

        <button
          onClick={handleSimulateBulkImport}
          className="btn btn-secondary font-bold text-xs py-2 px-4 flex items-center gap-1.5 shrink-0 w-full md:w-auto border border-slate-200 text-slate-700 dark:text-gray-300 hover:bg-slate-50"
        >
          <UploadCloud size={14} className="text-indigo-650" />
          <span>Simulate Bulk Excel Import</span>
        </button>
      </div>

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
                  <option value="Pumps & Fluid Dynamics">⚙️ Pumps & Fluid</option>
                  <option value="Valves & Flow Control">⚙️ Valves & Flow</option>
                  <option value="Pipes & Fittings">🏗️ Pipes & Fittings</option>
                  <option value="Sensors & Instrumentation">⚡ Sensors & Instrumentation</option>
                  <option value="Electrical & Automation">🏢 Electrical Panels</option>
                </select>
              </div>
            </div>

            {/* Price, Lead Time & MOQ */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-450 dark:text-gray-500">Unit Price ($) *</label>
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
                className={`btn flex-1 text-xs font-bold py-2 ${
                  isEditing
                    ? 'btn-primary bg-indigo-650 hover:bg-indigo-600'
                    : 'btn-success bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-none'
                }`}
              >
                {isEditing ? 'Update Item' : 'Add Item'}
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
              Catalogue Products ({filteredProducts.length} Items Listed)
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
                    <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                      No matching products found in catalogue.
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
                        ${prod.unitPrice.toLocaleString()}
                      </td>

                      {/* MOQ */}
                      <td className="py-3 text-center font-bold text-indigo-600 dark:text-indigo-300 mono">
                        {prod.moq.toLocaleString()} units
                      </td>

                      {/* Lead Time */}
                      <td className="py-3 text-center mono text-slate-700 dark:text-gray-300">
                        {prod.leadTimeDays} Days
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
