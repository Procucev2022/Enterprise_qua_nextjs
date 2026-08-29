'use client';

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '@/lib/store';
import {
  VendorMasterUploadRecord,
  PurchaseOrderLineItemRecord,
  HistoricalPurchaseVendorRecord,
} from '@/lib/types';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building2,
  Mail,
  Phone,
  MapPin,
  FileText,
  Star,
  Clock,
  Download,
  AlertCircle,
  Tag,
  Zap,
  X,
  Layers,
  ChevronRight,
  Plus,
  Trash2,
  SlidersHorizontal,
  Check,
  Database,
} from 'lucide-react';

export default function InitialSetupModal() {
  const {
    initialSetupModalOpen,
    setInitialSetupModalOpen,
    historicalPurchaseDataPeriod,
    setHistoricalPurchaseDataPeriod,
    processHistoricalPurchaseData,
    activeBuyerAccount,
    buyerVendors,
    showToast,
  } = useApp();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedPeriod, setSelectedPeriod] = useState<'1_year' | '2_years' | '3_years'>(historicalPurchaseDataPeriod || '2_years');

  // Separate Upload States & File Handlers
  const [storedVendors, setStoredVendors] = useState<VendorMasterUploadRecord[]>([]);
  const [vendorMasterUploaded, setVendorMasterUploaded] = useState(true);
  const [vendorFileName, setVendorFileName] = useState<string>('Vendor_Master_Database.xlsx');
  const [isDraggingVendor, setIsDraggingVendor] = useState<boolean>(false);
  const [isParsingVendor, setIsParsingVendor] = useState<boolean>(false);

  const [poLineItems, setPoLineItems] = useState<PurchaseOrderLineItemRecord[]>([]);
  const [poDataUploaded, setPoDataUploaded] = useState(false);
  const [poFileName, setPoFileName] = useState<string>(`PO_Purchase_Dump_${selectedPeriod}.xlsx`);
  const [isDraggingPo, setIsDraggingPo] = useState<boolean>(false);
  const [isParsingPo, setIsParsingPo] = useState<boolean>(false);

  // Hydrate storedVendors from live PostgreSQL database
  React.useEffect(() => {
    if (buyerVendors && buyerVendors.length > 0) {
      setStoredVendors((prev) => {
        if (prev.length > 0 && vendorFileName !== 'Vendor_Master_Database.xlsx') return prev;
        return buyerVendors.map((v, i) => ({
          id: v.id || `vm-${i + 1}`,
          vendorCode: (v as any).vendorCode || `VND-${1000 + i + 1}`,
          companyName: v.name,
          contactPerson: v.contactPerson || 'Procurement Lead',
          email: v.email,
          phone: v.phone || '+91 98000 00000',
          address: v.location || 'Industrial Area, India',
          gstNumber: (v as any).gstNumber || (v as any).gstin || '27AAACA0000A1Z0',
          vendorRatingScore: (v as any).vendorRatingScore || (v.score ? Math.round(v.score) : v.rating ? Math.round(v.rating * 20) : undefined),
        }));
      });
    }
  }, [buyerVendors, vendorFileName]);

  const vendorFileInputRef = useRef<HTMLInputElement>(null);
  const poFileInputRef = useRef<HTMLInputElement>(null);

  const [isProcessingPOJoin, setIsProcessingPOJoin] = useState(false);
  const [activeReviewTab, setActiveReviewTab] = useState<'all' | 'mapped' | 'unmapped'>('all');

  if (!initialSetupModalOpen) return null;

  // Real File Upload & SheetJS/CSV Parsing for File 1: Vendor Master
  const handleVendorFileUpload = (file: File) => {
    if (!file) return;
    setIsParsingVendor(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawJson || rawJson.length === 0) {
          showToast('Empty File', 'The uploaded file has no readable data rows.', 'warning');
          setIsParsingVendor(false);
          return;
        }

        const parsedVendors: VendorMasterUploadRecord[] = rawJson.map((row, idx) => {
          const keys = Object.keys(row);
          const getVal = (possibleKeys: string[]): string => {
            for (const pk of possibleKeys) {
              const matchedKey = keys.find((k) => k.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === pk.toLowerCase().replace(/[^a-z0-9]/g, ''));
              if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                return String(row[matchedKey]).trim();
              }
            }
            return '';
          };

          const vendorCode = getVal(['vendorcode', 'vendor code', 'code', 'vendor id', 'supplier code', 'id']) || `VND-${1000 + idx + 1}`;
          const companyName = getVal(['companyname', 'company name', 'vendor name', 'supplier', 'name', 'vendor', 'supplier name']) || `Supplier ${idx + 1}`;
          const contactPerson = getVal(['contactperson', 'contact person', 'contact', 'person', 'representative']) || 'Operations Lead';
          const email = getVal(['email', 'email id', 'email_id', 'mail', 'corporate email']) || `contact@${companyName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'vendor'}.com`;
          const phone = getVal(['phone', 'mobile', 'contact number', 'phone number', 'telephone', 'mobile number']) || '+91 98000 00000';
          const address = getVal(['address', 'location', 'city', 'plant location', 'street', 'office address']) || 'Industrial Zone, India';
          const gstNumber = getVal(['gstnumber', 'gstin', 'gst', 'gst number', 'tax id', 'gst no']) || '27AAACA0000A1Z0';
          
          const ratingRaw = getVal(['vendorratingscore', 'rating', 'score', 'vendor rating', 'rating 0 100', 'performance score']);
          const vendorRatingScore = ratingRaw && !isNaN(Number(ratingRaw)) ? Math.min(100, Math.max(0, Math.round(Number(ratingRaw)))) : undefined;

          return {
            id: `vm-upload-${Date.now()}-${idx}`,
            vendorCode,
            companyName,
            contactPerson,
            email,
            phone,
            address,
            gstNumber,
            vendorRatingScore,
          };
        });

        setStoredVendors(parsedVendors);
        setVendorMasterUploaded(true);
        setVendorFileName(file.name);
        showToast('Vendor Master Uploaded', `Successfully parsed & loaded ${parsedVendors.length} vendors from ${file.name}.`, 'success');
      } catch (err: any) {
        console.error('Vendor Master Parse Error:', err);
        showToast('Parsing Error', `Could not parse file: ${err.message || 'Unknown format'}`, 'warning');
      } finally {
        setIsParsingVendor(false);
      }
    };

    reader.onerror = () => {
      showToast('File Read Error', 'Failed to read file from disk.', 'warning');
      setIsParsingVendor(false);
    };

    reader.readAsArrayBuffer(file);
  };

  // Real File Upload & SheetJS/CSV Parsing for File 2: PO Purchase Dump
  const handlePODataFileUpload = (file: File) => {
    if (!file) return;
    setIsParsingPo(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawJson || rawJson.length === 0) {
          showToast('Empty PO File', 'The uploaded PO dump has no readable rows.', 'warning');
          setIsParsingPo(false);
          return;
        }

        const parsedPOs: PurchaseOrderLineItemRecord[] = rawJson.map((row, idx) => {
          const keys = Object.keys(row);
          const getVal = (possibleKeys: string[]): string => {
            for (const pk of possibleKeys) {
              const matchedKey = keys.find((k) => k.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === pk.toLowerCase().replace(/[^a-z0-9]/g, ''));
              if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                return String(row[matchedKey]).trim();
              }
            }
            return '';
          };

          const poNumber = getVal(['ponumber', 'po number', 'po #', 'po no', 'order id', 'order number']) || `PO-2025-${(1000 + idx).toString()}`;
          const poDate = getVal(['podate', 'po date', 'date', 'order date', 'creation date']) || '2025-06-15';
          const vendorIdentifier = getVal(['vendoridentifier', 'vendor', 'vendor name', 'supplier', 'company name', 'vendor code']) || 'Apex Supplies Ltd.';
          const itemName = getVal(['itemname', 'item description', 'description', 'item', 'material', 'product name']) || 'Industrial Mechanical Spares';
          const specs = getVal(['specs', 'specification', 'technical specs', 'details', 'item specs', 'grade']) || 'Standard Plant Specifications';
          
          const qtyRaw = getVal(['quantity', 'qty', 'units', 'count', 'ordered qty']);
          const quantity = qtyRaw && !isNaN(Number(qtyRaw)) ? Math.max(1, Math.round(Number(qtyRaw))) : 10;
          
          const unit = getVal(['unit', 'uom', 'unit of measure']) || 'Units';

          const unitPriceRaw = getVal(['unitprice', 'unit price', 'rate', 'price', 'item price']);
          const totalSpendRaw = getVal(['totalspend', 'total spend', 'total amount', 'spend', 'amount', 'total value', 'po amount']);

          let unitPrice = unitPriceRaw && !isNaN(Number(unitPriceRaw.replace(/[^0-9.]/g, ''))) ? Number(unitPriceRaw.replace(/[^0-9.]/g, '')) : 500;
          let totalSpend = totalSpendRaw && !isNaN(Number(totalSpendRaw.replace(/[^0-9.]/g, ''))) ? Number(totalSpendRaw.replace(/[^0-9.]/g, '')) : unitPrice * quantity;

          if (totalSpend === 0 && unitPrice > 0) {
            totalSpend = unitPrice * quantity;
          } else if (unitPrice === 0 && totalSpend > 0 && quantity > 0) {
            unitPrice = Math.round(totalSpend / quantity);
          }

          const department = getVal(['department', 'dept', 'cost center', 'plant', 'division', 'category']) || 'Maintenance & Utilities';

          return {
            id: `po-upload-${Date.now()}-${idx}`,
            poNumber,
            poDate,
            vendorIdentifier,
            itemName,
            specs,
            quantity,
            unit,
            unitPrice,
            totalSpend,
            department,
          };
        });

        setPoLineItems(parsedPOs);
        setPoDataUploaded(true);
        setPoFileName(file.name);
        showToast('PO Dump Uploaded', `Successfully parsed & loaded ${parsedPOs.length} PO line items from ${file.name}.`, 'success');
      } catch (err: any) {
        console.error('PO Dump Parse Error:', err);
        showToast('Parsing Error', `Could not parse PO file: ${err.message || 'Unknown format'}`, 'warning');
      } finally {
        setIsParsingPo(false);
      }
    };

    reader.onerror = () => {
      showToast('File Read Error', 'Failed to read file from disk.', 'warning');
      setIsParsingPo(false);
    };

    reader.readAsArrayBuffer(file);
  };

  const resetToSampleVendorData = () => {
    if (buyerVendors && buyerVendors.length > 0) {
      setStoredVendors(
        buyerVendors.map((v, i) => ({
          id: v.id || `vm-${i + 1}`,
          vendorCode: (v as any).vendorCode || `VND-${1000 + i + 1}`,
          companyName: v.name,
          contactPerson: v.contactPerson || 'Procurement Lead',
          email: v.email,
          phone: v.phone || '+91 98000 00000',
          address: v.location || 'Industrial Area, India',
          gstNumber: (v as any).gstNumber || (v as any).gstin || '27AAACA0000A1Z0',
          vendorRatingScore: (v as any).vendorRatingScore || (v.score ? Math.round(v.score) : v.rating ? Math.round(v.rating * 20) : undefined),
        }))
      );
    }
    setVendorFileName('Vendor_Master_Database.xlsx');
    showToast('Reset Complete', 'Vendor Master reset to live database records.', 'info');
  };

  const resetToSamplePoData = () => {
    setPoLineItems([]);
    setPoFileName(`PO_Purchase_Dump_${selectedPeriod}.xlsx`);
    setPoDataUploaded(false);
    showToast('Reset Complete', 'PO Dump line items cleared. Please upload your spreadsheet.', 'info');
  };

  // Correlate and Join PO line items against stored Vendor Master
  const computeJoinedRecords = (): HistoricalPurchaseVendorRecord[] => {
    return storedVendors.map((v) => {
      // Find matching POs
      const matchingPOs = poLineItems.filter(
        (po) =>
          po.vendorIdentifier.toLowerCase().includes(v.companyName.toLowerCase()) ||
          v.companyName.toLowerCase().includes(po.vendorIdentifier.toLowerCase()) ||
          (v.vendorCode && po.vendorIdentifier.toLowerCase().includes(v.vendorCode.toLowerCase()))
      );

      const hasMatchingPOs = matchingPOs.length > 0;
      const items = matchingPOs.map((p) => p.itemName);
      const totalAmount = matchingPOs.reduce((acc, p) => acc + p.totalSpend, 0);

      let firstSetMajor = '';
      let secondSetMinors: string[] = [];

      if (hasMatchingPOs) {
        // AI Category mapping based on purchased items
        const itemText = items.join(' ').toLowerCase();
        if (itemText.includes('pump') || itemText.includes('valve') || itemText.includes('hose') || itemText.includes('compressor')) {
          firstSetMajor = 'Engineering Spares - Mechanical';
          if (itemText.includes('pump')) secondSetMinors.push('Pumps & Accessories');
          if (itemText.includes('valve') || itemText.includes('gate') || itemText.includes('globe')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('hose')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('compressor')) secondSetMinors.push('Compressors & Accessories');
          if (itemText.includes('motor')) secondSetMinors.push('Machinery Parts');
        } else if (itemText.includes('switchgear') || itemText.includes('panel') || itemText.includes('breaker') || itemText.includes('cable')) {
          firstSetMajor = 'Engineering Spares - Electrical';
          if (itemText.includes('panel') || itemText.includes('switchgear')) secondSetMinors.push('Panels');
          if (itemText.includes('breaker') || itemText.includes('mccb')) secondSetMinors.push('Circuit Breakers');
        } else if (itemText.includes('tmt') || itemText.includes('steel') || itemText.includes('civil') || itemText.includes('peb')) {
          firstSetMajor = 'Civil Works';
          if (itemText.includes('peb')) secondSetMinors.push('PEB Structure');
          if (itemText.includes('tmt')) secondSetMinors.push('TMT BARS');
          secondSetMinors.push('Roofing Sheets');
        } else {
          firstSetMajor = 'General Spares & Consumables';
          secondSetMinors.push('Customised Parts');
        }

        // Deduplicate
        secondSetMinors = Array.from(new Set(secondSetMinors));
      }

      return {
        id: v.id,
        vendorCode: v.vendorCode,
        companyName: v.companyName,
        email: v.email,
        contactPerson: v.contactPerson,
        phone: v.phone,
        address: v.address,
        gstNumber: v.gstNumber,
        vendorRatingScore: v.vendorRatingScore,
        hasPoHistory: hasMatchingPOs,
        categoriesMappedByBuyer: hasMatchingPOs,
        itemsSupplied: items,
        pastPoSpend: hasMatchingPOs ? `$${totalAmount.toLocaleString()} (${matchingPOs.length} POs)` : 'No PO History in Dump',
        poCount: matchingPOs.length,
        firstSetMajorCategory: firstSetMajor,
        secondSetMinorCategories: secondSetMinors,
        secondSetSecondaryMajors: hasMatchingPOs ? ['Engineering Spares - Electrical', 'Civil Works'] : [],
      };
    });
  };

  const joinedVendors = computeJoinedRecords();
  const mappedVendors = joinedVendors.filter((v) => v.categoriesMappedByBuyer);
  const unmappedVendors = joinedVendors.filter((v) => !v.categoriesMappedByBuyer);

  // Download Sample Vendor Master CSV
  const handleDownloadVendorMasterCsv = () => {
    const csv =
      'Vendor Code,Company Name,Contact Person,Email ID,Phone,Address,GSTIN,Rating (0-100 Optional)\n' +
      'VND-1001,Apex Supplies Ltd.,Rajesh Nair,rajesh@apexsupplies.in,+91 98201 44820,"MIDC Thane, Mumbai, MH",27AAACA1928K1Z4,95\n' +
      'VND-1002,Kiran Valve Industries,Amit Kumar,amit@kiranvalves.com,+91 97653 21098,"Bhosari, Pune, MH",27AAACK3921P1Z9,78\n' +
      'VND-1007,Vortex Hydraulic Systems,Nikhil Rane,nikhil@vortexhydraulics.in,+91 98450 11920,"Peenya, Bangalore, KA",29AAACV8841P1Z5,82\n' +
      'VND-1008,Nova Electrical Spares,Pooja Deshmukh,sales@novaelectricals.com,+91 97230 44510,"Makarpura, Vadodara, GJ",24AAACN4419K1Z1,\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Procucev_Template_1_Vendor_Master.csv';
    link.click();
    showToast('Template Downloaded', 'Sample Vendor Master CSV template downloaded.', 'success');
  };

  // Download Sample PO Data CSV
  const handleDownloadPoDataCsv = () => {
    const csv =
      'PO Number,PO Date,Vendor Name / Code,Item Name & Description,Quantity,Unit,Unit Price,Total Spend,Department\n' +
      'PO-2025-00891,2025-04-12,Apex Supplies Ltd.,Centrifugal Water Pump 500 GPM (15 HP Motor),12,Units,12500,150000,Mechanical\n' +
      'PO-2025-01156,2025-08-04,Kiran Valve Industries,Flanged Gate Valve 4-inch Class 150,24,Units,3800,91200,Piping\n' +
      'PO-2025-01431,2025-10-10,TechnoForce Engineering Ltd,LV Switchgear Modular Panels with Drawout MCCB,3,Panels,85000,255000,Electrical\n' +
      'PO-2025-01740,2025-12-05,Everest Steel & Infra Structures,Fe500D TMT High-Yield Reinforcement Bars,120,Tons,620,744000,Civil\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Procucev_Template_2_PO_Purchase_Dump_${selectedPeriod}.csv`;
    link.click();
    showToast('Template Downloaded', 'Sample PO Purchase Order Dump CSV downloaded.', 'success');
  };

  const handleSimulatePOJoin = () => {
    setIsProcessingPOJoin(true);
    setTimeout(() => {
      setIsProcessingPOJoin(false);
      setStep(4);
      showToast(
        'Cross-Match Complete',
        `Matched PO data against ${storedVendors.length} stored vendors. ${mappedVendors.length} categorized, ${unmappedVendors.length} flagged for self-mapping.`,
        'success'
      );
    }, 800);
  };

  const handleConfirmFinalIngestion = () => {
    processHistoricalPurchaseData(selectedPeriod, joinedVendors);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 sm:p-8 bg-white dark:bg-gray-900 border-2 border-indigo-500/30 dark:border-indigo-500/40 shadow-2xl space-y-6 animate-scale-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-gray-800 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  Buyer Initial Setup: Vendor Master & PO Data Ingestion
                </h2>
                <span className="badge badge-amber font-mono font-bold text-[10px] uppercase">
                  Dual-File ERP Setup
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 leading-relaxed">
                Organization: <strong>{activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited'}</strong> · Upload Vendor Master and PO purchase dump separately for AI category cross-mapping.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setInitialSetupModalOpen(false)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            title="Dismiss setup (you can resume from the blinking corner badge)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Informative Why This is Required Box */}
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-xs text-indigo-950 dark:text-indigo-200 space-y-2">
          <div className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-600 shrink-0" />
            <span>Dual-Stream ERP Ingestion Architecture</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-700 dark:text-gray-300">
            Because combined data is rarely available in enterprise systems, you can upload <strong>File 1 (Vendor Master Coordinates)</strong> first, followed by <strong>File 2 (Historical PO Spend Dump)</strong>. The system saves the vendor master, extracts purchased items from POs, and maps categories against each vendor profile. If a vendor is in the master but has no PO history, they receive an email notifying them to <strong>self-map their categories upon login</strong> in order to receive enquiries.
          </p>
        </div>

        {/* Step Progress Indicators */}
        <div className="grid grid-cols-5 gap-1.5 text-center text-[11px] font-bold">
          {[
            { num: 1, label: '1. Time Horizon' },
            { num: 2, label: '2. Vendor Master' },
            { num: 3, label: '3. PO Dump' },
            { num: 4, label: '4. AI Category Join' },
            { num: 5, label: '5. Dispatch Emails' },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num as any)}
              className={`p-2 rounded-xl border transition-all ${
                step === s.num
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                  : step > s.num
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/60 text-slate-400 dark:text-gray-500 border-slate-200 dark:border-gray-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* STEP 1: CHOOSE TIME HORIZON */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 1: Choose Historical Purchase Period
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Select the time horizon of PO data you wish to cross-reference against your vendor master.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: '1_year' as const,
                  title: 'Last 1 Year (12 Months)',
                  desc: 'Fast bootstrap focusing on recent high-velocity procurement spares.',
                  badge: 'Quick Ingestion',
                },
                {
                  id: '2_years' as const,
                  title: 'Last 2 Years (24 Months)',
                  desc: 'Recommended baseline covering seasonal maintenance & capex cycles.',
                  badge: '⭐ Recommended',
                },
                {
                  id: '3_years' as const,
                  title: 'Last 3 Years (36 Months)',
                  desc: 'Complete historical enterprise audit and comprehensive supplier discovery.',
                  badge: 'Full Enterprise Audit',
                },
              ].map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => {
                    setSelectedPeriod(opt.id);
                    setHistoricalPurchaseDataPeriod(opt.id);
                  }}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    selectedPeriod === opt.id
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20 shadow-md'
                      : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 bg-slate-50/50 dark:bg-gray-850/40'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          selectedPeriod === opt.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-gray-800 text-slate-700 dark:text-gray-300'
                        }`}
                      >
                        {opt.badge}
                      </span>
                      <Clock size={15} className={selectedPeriod === opt.id ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white mt-1">{opt.title}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">{opt.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Continue to File 1: Vendor Master <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: FILE 1 — VENDOR MASTER DATA INGESTION */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={vendorFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVendorFileUpload(file);
              }}
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                    Step 2: Upload File 1 — Vendor Master Database
                  </h3>
                  <span className="badge badge-indigo font-bold text-[10px]">Stored First</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Contains: Vendor Code, Company Name, Contact Person, Email, Phone, Address, GSTIN, and Optional Rating (0-100).
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadVendorMasterCsv}
                  className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 shrink-0"
                >
                  <Download size={12} /> Download CSV Template
                </button>
                <button
                  type="button"
                  onClick={resetToSampleVendorData}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 underline font-medium"
                >
                  Reset Template
                </button>
              </div>
            </div>

            {/* Drag & Drop Vendor Master Area */}
            <div
              onClick={() => vendorFileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingVendor(true);
              }}
              onDragLeave={() => setIsDraggingVendor(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingVendor(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleVendorFileUpload(file);
              }}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                isDraggingVendor
                  ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
                  : 'border-indigo-300 dark:border-indigo-500/50 hover:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/80'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-600/20 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                <UploadCloud size={24} />
              </div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mt-2">
                {isParsingVendor
                  ? 'Reading and Parsing Vendor Records...'
                  : `Click to Browse or Drag & Drop Vendor Master (.xlsx, .csv, .xls)`}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                Upload your ERP vendor master sheet or use our sample template with {storedVendors.length} loaded records.
              </p>

              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 px-3 py-1 rounded-full bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 shadow-sm">
                  <Database size={12} className="text-indigo-500" />
                  <span>Active File:</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">{vendorFileName}</span>
                  <span className="text-slate-400">({storedVendors.length} Suppliers)</span>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    vendorFileInputRef.current?.click();
                  }}
                  className="btn btn-primary btn-xs font-bold text-[11px] flex items-center gap-1"
                >
                  <UploadCloud size={12} /> Choose Another File
                </button>
              </div>
            </div>

            {/* Table of Stored Vendor Master */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Stored Vendor Master Records ({storedVendors.length} Suppliers):
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 size={11} /> Ready for PO Cross-Referencing
                </span>
              </div>

              <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-48 overflow-y-auto text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0">
                    <tr>
                      <th className="p-2.5">Code</th>
                      <th className="p-2.5">Company Name</th>
                      <th className="p-2.5">Email & Phone</th>
                      <th className="p-2.5">GSTIN / Address</th>
                      <th className="p-2.5">Rating (0-100)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800 bg-white dark:bg-gray-900/60">
                    {storedVendors.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                        <td className="p-2.5 font-mono text-[10px] text-slate-500">{v.vendorCode || 'VND-AUTO'}</td>
                        <td className="p-2.5 font-bold text-slate-800 dark:text-white">{v.companyName}</td>
                        <td className="p-2.5">
                          <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold block">{v.email}</span>
                          <span className="text-slate-400 text-[10px]">{v.phone}</span>
                        </td>
                        <td className="p-2.5">
                          <span className="mono text-[10px] text-slate-600 dark:text-gray-300 font-bold block">{v.gstNumber}</span>
                          <span className="text-slate-400 text-[10px] truncate max-w-[120px] block">{v.address}</span>
                        </td>
                        <td className="p-2.5 font-bold">
                          {v.vendorRatingScore ? (
                            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                              <Star size={11} fill="currentColor" /> {v.vendorRatingScore}/100
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">Optional (N/A)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => setStep(1)} className="btn btn-secondary btn-sm">
                Back to Period
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Proceed to File 2: PO Dump <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: FILE 2 — PO PURCHASE DATA INGESTION */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={poFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePODataFileUpload(file);
              }}
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                    Step 3: Upload File 2 — Historical PO Purchase Dump
                  </h3>
                  <span className="badge badge-purple font-bold text-[10px]">
                    {selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Contains: PO Number, PO Date, Vendor Name / Code, Line Item Description, Quantity, Spend, Department.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadPoDataCsv}
                  className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 shrink-0"
                >
                  <Download size={12} /> Download CSV Template
                </button>
                <button
                  type="button"
                  onClick={resetToSamplePoData}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 underline font-medium"
                >
                  Reset Template
                </button>
              </div>
            </div>

            {/* Drag & Drop PO Dump Area */}
            <div
              onClick={() => poFileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingPo(true);
              }}
              onDragLeave={() => setIsDraggingPo(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingPo(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handlePODataFileUpload(file);
              }}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                isDraggingPo
                  ? 'border-purple-600 bg-purple-100/70 dark:bg-purple-900/50 scale-[1.01]'
                  : 'border-purple-300 dark:border-purple-500/50 hover:border-purple-600 bg-purple-50/40 dark:bg-purple-950/20 hover:bg-purple-50/80'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-600/20 flex items-center justify-center mx-auto text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                <FileSpreadsheet size={24} />
              </div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mt-2">
                {isParsingPo
                  ? 'Reading and Parsing PO Dump Records...'
                  : `Click to Browse or Drag & Drop PO Purchase Dump (.xlsx, .csv, .xls)`}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                Upload your historical purchase orders to automatically extract purchased items and map vendor categories.
              </p>

              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 shadow-sm">
                  <FileSpreadsheet size={12} className="text-purple-500" />
                  <span>Active File:</span>
                  <span className="font-mono text-purple-600 dark:text-purple-400">{poFileName}</span>
                  <span className="text-slate-400">({poLineItems.length} PO Lines)</span>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    poFileInputRef.current?.click();
                  }}
                  className="btn btn-primary btn-xs font-bold text-[11px] flex items-center gap-1"
                >
                  <UploadCloud size={12} /> Choose Another File
                </button>
              </div>
            </div>

            {/* PO Line Items Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  PO Line Items Preview ({poLineItems.length} Line Items):
                </span>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">
                  Total Spend: ${poLineItems.reduce((acc, p) => acc + p.totalSpend, 0).toLocaleString()}
                </span>
              </div>

              <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-48 overflow-y-auto text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0">
                    <tr>
                      <th className="p-2.5">PO Number</th>
                      <th className="p-2.5">Vendor</th>
                      <th className="p-2.5">Purchased Item & Specs</th>
                      <th className="p-2.5">Qty / Unit</th>
                      <th className="p-2.5">Total Spend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800 bg-white dark:bg-gray-900/60">
                    {poLineItems.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                        <td className="p-2.5 font-mono text-[10px] text-slate-500">{p.poNumber}</td>
                        <td className="p-2.5 font-bold text-slate-800 dark:text-white">{p.vendorIdentifier}</td>
                        <td className="p-2.5">
                          <span className="font-semibold text-slate-800 dark:text-gray-200 block">{p.itemName}</span>
                          <span className="text-slate-400 text-[10px]">{p.specs}</span>
                        </td>
                        <td className="p-2.5 text-slate-600 dark:text-gray-400">{p.quantity} {p.unit}</td>
                        <td className="p-2.5 font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          ${p.totalSpend.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => setStep(2)} className="btn btn-secondary btn-sm">
                Back to Vendor Master
              </button>
              <button
                type="button"
                onClick={handleSimulatePOJoin}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                {isProcessingPOJoin ? 'Processing Join...' : 'Run AI Category Cross-Match'} <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: AI CATEGORY JOIN & CROSS-MATCH AUDIT */}
        {step === 4 && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                  Step 4: AI Cross-Match & Category Assignment Audit
                </h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Review vendors with buyer-mapped categories vs vendors requiring self-mapping.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 p-1 rounded-xl text-xs font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('all')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'all' ? 'bg-white dark:bg-gray-900 text-indigo-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  All ({joinedVendors.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('mapped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'mapped' ? 'bg-white dark:bg-gray-900 text-emerald-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  ✓ Mapped ({mappedVendors.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('unmapped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'unmapped' ? 'bg-white dark:bg-gray-900 text-amber-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  ⚠️ Unmapped ({unmappedVendors.length})
                </button>
              </div>
            </div>

            {/* List of Correlated Vendors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1 text-xs">
              {joinedVendors
                .filter((v) => {
                  if (activeReviewTab === 'mapped') return v.categoriesMappedByBuyer;
                  if (activeReviewTab === 'unmapped') return !v.categoriesMappedByBuyer;
                  return true;
                })
                .map((v) => (
                  <div
                    key={v.id}
                    className={`p-4 rounded-2xl border transition-all space-y-2.5 ${
                      v.categoriesMappedByBuyer
                        ? 'bg-slate-50/80 dark:bg-gray-800/50 border-slate-200 dark:border-gray-800'
                        : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300/80 dark:border-amber-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-black text-slate-900 dark:text-white text-xs">{v.companyName}</h4>
                          {v.vendorCode && (
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300">
                              {v.vendorCode}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-500">{v.email} · {v.phone}</span>
                      </div>

                      {v.categoriesMappedByBuyer ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 shrink-0 flex items-center gap-0.5">
                          <Check size={10} /> PO Mapped ({v.poCount} POs)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 shrink-0 flex items-center gap-0.5">
                          <AlertCircle size={10} /> No POs · Self-Map
                        </span>
                      )}
                    </div>

                    {v.categoriesMappedByBuyer ? (
                      <>
                        {/* 1st Set Category */}
                        <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/50">
                          <span className="text-[9px] uppercase font-black text-indigo-700 dark:text-indigo-300 block">
                            1st Set: Primary Major Category
                          </span>
                          <span className="font-bold text-indigo-950 dark:text-white text-xs block mt-0.5">
                            {v.firstSetMajorCategory}
                          </span>
                        </div>

                        {/* 2nd Set Minor Categories */}
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase font-bold text-slate-400 block">
                            2nd Set: Minor Categories & Product Lines
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {v.secondSetMinorCategories.map((m) => (
                              <span
                                key={m}
                                className="px-2 py-0.5 rounded-lg bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700 text-[10px] font-semibold"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      /* Unmapped Fallback Notice Box */
                      <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                        <div className="font-bold flex items-center gap-1 text-amber-800 dark:text-amber-300 text-[10px] uppercase">
                          <AlertCircle size={12} />
                          Dispatched Notification Protocol:
                        </div>
                        <p className="text-[10px] leading-relaxed">
                          The onboarding email will explicitly notify <strong>{v.companyName}</strong> that <em>&quot;the buyer didn&apos;t map any categories for you, so please map yourself in order to receive enquiries.&quot;</em>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => setStep(3)} className="btn btn-secondary btn-sm">
                Back to PO Dump
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Review Email Dispatch & Finalize <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: FINAL CONFIRMATION & TAILORED EMAIL PREVIEWS */}
        {step === 5 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 5: Confirm Ingestion & Dispatch Tailored Onboarding Emails
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                The platform will dispatch tailored credentials and category notices based on PO correlation.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Template A Preview: PO-Mapped Suppliers */}
              <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-900 dark:text-indigo-200 text-[11px] flex items-center gap-1">
                    <CheckCircle2 size={13} className="text-emerald-600" />
                    Template A: Suppliers With PO History ({mappedVendors.length})
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900 text-[10px] space-y-1 font-mono text-slate-700 dark:text-gray-300">
                  <p><strong>Subject:</strong> [Action Required] Welcome: {activeBuyerAccount?.organizationName || 'Larsen & Toubro'} mapped your categories</p>
                  <p className="text-emerald-700 dark:text-emerald-400 font-bold">
                    • 1st Set: Engineering Spares - Mechanical<br />
                    • 2nd Set: Pumps, Valves, Hoses, Machinery Parts
                  </p>
                  <p className="text-slate-400">• User: [Email] | Pass: [TempPass] | OTP Ready</p>
                </div>
              </div>

              {/* Template B Preview: Unmapped Suppliers */}
              <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 dark:text-amber-200 text-[11px] flex items-center gap-1">
                    <AlertCircle size={13} className="text-amber-600" />
                    Template B: Suppliers With NO POs ({unmappedVendors.length})
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900 text-[10px] space-y-1 font-mono text-slate-700 dark:text-gray-300">
                  <p><strong>Subject:</strong> [Action Required] Set Up Categories: {activeBuyerAccount?.organizationName || 'Larsen & Toubro'} added you</p>
                  <p className="text-amber-700 dark:text-amber-400 font-bold">
                    • &quot;Buyer didn&apos;t map any categories for you, so please map yourself in order to receive enquiries.&quot;
                  </p>
                  <p className="text-slate-400">• User: [Email] | Pass: [TempPass] | OTP Ready</p>
                </div>
              </div>
            </div>

            {/* Ingestion Totals Grid */}
            <div className="grid grid-cols-4 gap-2.5 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                <span className="text-[10px] text-slate-400 block">Total Stored</span>
                <span className="font-black text-slate-900 dark:text-white text-sm">{joinedVendors.length} Vendors</span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">PO Mapped</span>
                <span className="font-black text-emerald-700 dark:text-emerald-300 text-sm">{mappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50">
                <span className="text-[10px] text-amber-600 dark:text-amber-400 block">Self-Map Required</span>
                <span className="font-black text-amber-700 dark:text-amber-300 text-sm">{unmappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50">
                <span className="text-[10px] text-purple-600 dark:text-purple-400 block">3-Day Reminders</span>
                <span className="font-black text-purple-700 dark:text-purple-300 text-sm">Active (Day 3)</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => setStep(4)} className="btn btn-secondary btn-sm">
                Back to Category Join
              </button>
              <button
                type="button"
                onClick={handleConfirmFinalIngestion}
                className="btn btn-primary font-bold text-xs py-3 px-6 shadow-lg shadow-indigo-600/30 flex items-center gap-2"
              >
                <CheckCircle2 size={16} /> [ COMPLETE SETUP & INGEST {joinedVendors.length} VENDORS ]
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
