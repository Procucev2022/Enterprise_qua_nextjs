'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { SOURCING_MODES } from '@/lib/mock-data';
import { SourcingMode, ExtractedEntity } from '@/lib/types';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Send,
  Layers,
  Edit3,
  Trash2,
  Plus,
  Mail,
  FileText,
  Clock,
  ShieldCheck,
  Cpu,
  Users,
  Building2,
  Tag,
  MapPin,
  Phone,
  Globe,
  Star,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';

interface IngestionWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

interface VendorEntry {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  category: string;
  location: string;
  rating: number;
  source: 'manual' | 'excel';
}

const VENDOR_CATEGORIES = [
  'Heavy Mechanical',
  'Flow Control',
  'Electrical & Switchgear',
  'Building Automation & HVAC',
  'Piping & Fittings',
  'Instrumentation',
  'General Industrial',
];

const INITIAL_VENDORS: VendorEntry[] = [
  { id: 'v-1', name: 'Apex Supplies Ltd.', contactPerson: 'Rajesh Nair', phone: '+91 98201 44820', email: 'rajesh@apexsupplies.in', category: 'Heavy Mechanical', location: 'Mumbai, MH', rating: 4.8, source: 'manual' },
  { id: 'v-2', name: 'Kiran Valve Industries', contactPerson: 'Amit Kumar', phone: '+91 97653 21098', email: 'amit@kiranvalves.com', category: 'Flow Control', location: 'Ahmedabad, GJ', rating: 4.5, source: 'manual' },
  { id: 'v-3', name: 'TechnoForce Engineering', contactPerson: 'Sunita Reddy', phone: '+91 87654 32109', email: 'sunita@technoforce.in', category: 'Electrical & Switchgear', location: 'Hyderabad, TS', rating: 4.7, source: 'manual' },
  { id: 'v-4', name: 'Precision Pumps Pvt Ltd', contactPerson: 'Vikram Shah', phone: '+91 99876 54321', email: 'vikram@precisionpumps.co.in', category: 'Heavy Mechanical', location: 'Pune, MH', rating: 4.3, source: 'manual' },
  { id: 'v-5', name: 'CoolAir Systems', contactPerson: 'Priya Menon', phone: '+91 94321 67890', email: 'priya@coolairsys.com', category: 'Building Automation & HVAC', location: 'Chennai, TN', rating: 4.6, source: 'manual' },
];

const RECOMMENDED_PROCUCEV_VENDORS = [
  { id: 'rec-1', name: 'Delta Valve Systems', category: 'Flow Control', location: 'Pune, MH', rating: 4.8, matchScore: 96, proximity: 'Local Hub (<250km)' },
  { id: 'rec-2', name: 'Dynamic Flow Controls', category: 'Flow Control', location: 'Chennai, TN', rating: 4.7, matchScore: 94, proximity: 'Regional Hub (<600km)' },
  { id: 'rec-3', name: 'ElectroMech Pumps', category: 'Heavy Mechanical', location: 'Mumbai, MH', rating: 4.6, matchScore: 93, proximity: 'Local Hub (<250km)' },
  { id: 'rec-4', name: 'Vanguard Heavy Engineering', category: 'Heavy Mechanical', location: 'Bangalore, KA', rating: 4.7, matchScore: 91, proximity: 'Regional Hub (<600km)' },
  { id: 'rec-5', name: 'Sigma Switchgears', category: 'Electrical & Switchgear', location: 'Noida, UP', rating: 4.5, matchScore: 89, proximity: 'National Hub' },
  { id: 'rec-6', name: 'Zenith Piping Solutions', category: 'Piping & Fittings', location: 'Ahmedabad, GJ', rating: 4.4, matchScore: 88, proximity: 'Regional Hub (<600km)' },
  { id: 'rec-7', name: 'Alpha Instrumentation', category: 'Instrumentation', location: 'Hyderabad, TS', rating: 4.6, matchScore: 87, proximity: 'Regional Hub (<600km)' },
  { id: 'rec-8', name: 'United HVAC Systems', category: 'Building Automation & HVAC', location: 'Mumbai, MH', rating: 4.5, matchScore: 86, proximity: 'Local Hub (<250km)' },
  { id: 'rec-9', name: 'Matrix Fluid Dynamics', category: 'Flow Control', location: 'Vadodara, GJ', rating: 4.3, matchScore: 85, proximity: 'Regional Hub (<600km)' },
  { id: 'rec-10', name: 'Supreme Casting Industries', category: 'Heavy Mechanical', location: 'Jamshedpur, JH', rating: 4.2, matchScore: 84, proximity: 'National Hub' },
];

export default function IngestionWizard({ onComplete, onCancel }: IngestionWizardProps) {
  const { addNewRFQ, currentMode, setCurrentMode, showToast } = useApp();

  const [activeStep, setActiveStep] = useState<number>(1);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>('BOQ_Centrifugal_Pumps_HVAC_2026.xlsx');
  const [ingestionMethod, setIngestionMethod] = useState<'upload' | 'email'>('upload');

  const [rfqTitle, setRfqTitle] = useState('Centrifugal Water Pumps & Industrial Valves Procurement');
  const [rfqNumber] = useState(`RFQ-2026-00${Math.floor(430 + Math.random() * 50)}`);
  const [selectedMode, setSelectedMode] = useState<SourcingMode>(currentMode || 'mode_2');
  const [budget, setBudget] = useState(145000);

  // Vendor management state
  const [vendors, setVendors] = useState<VendorEntry[]>(INITIAL_VENDORS);
  const [vendorAddMethod, setVendorAddMethod] = useState<'manual' | 'excel'>('manual');
  const [isUploadingVendors, setIsUploadingVendors] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(VENDOR_CATEGORIES));
  const [newVendor, setNewVendor] = useState<Omit<VendorEntry, 'id' | 'source'>>({
    name: '', contactPerson: '', phone: '', email: '', category: 'Heavy Mechanical', location: '', rating: 4.0,
  });

  const [entities, setEntities] = useState<ExtractedEntity[]>([
    {
      id: 'ent-1',
      itemName: 'Centrifugal Water Pump (500 GPM)',
      quantity: 12,
      unit: 'Units',
      targetDate: '2026-09-15',
      technicalSpecs: 'Stainless Steel Impeller (SS316), 15 HP Motor, ANSI Flanged, 150 PSI',
      confidence: 98.4,
      category: 'Heavy Mechanical',
    },
    {
      id: 'ent-2',
      itemName: 'Flanged Gate Valve (4-inch Class 150)',
      quantity: 24,
      unit: 'Units',
      targetDate: '2026-09-18',
      technicalSpecs: 'ASTM A216 WCB Cast Carbon Steel Body, 150# Raised Face Flange, Rising Stem',
      confidence: 96.2,
      category: 'Flow Control',
    },
  ]);

  const handleSimulateUpload = () => {
    setIsProcessingDoc(true);
    setTimeout(() => {
      setIsProcessingDoc(false);
      setActiveStep(2);
      showToast('AI OCR Extraction Complete', '2 Line-item entities extracted with 98.4% average confidence.', 'success');
    }, 1200);
  };

  const handleEntityChange = (id: string, field: keyof ExtractedEntity, value: any) => {
    setEntities((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleAddEntity = () => {
    const newEnt: ExtractedEntity = {
      id: `ent-${Date.now()}`,
      itemName: 'New Industrial Item Description',
      quantity: 10,
      unit: 'Units',
      targetDate: '2026-09-30',
      technicalSpecs: 'Specify ANSI / DIN standard compliance specs',
      confidence: 99.0,
      category: 'General Mechanical',
    };
    setEntities([...entities, newEnt]);
  };

  const handleDeleteEntity = (id: string) => {
    setEntities(entities.filter((e) => e.id !== id));
  };

  const handleDispatch = () => {
    setCurrentMode(selectedMode);
    addNewRFQ({
      rfqNumber,
      title: rfqTitle,
      category: 'Mechanical & Fluid Systems',
      sourcingMode: selectedMode,
      targetDeliveryDate: entities[0]?.targetDate || '2026-09-25',
      budget,
      extractedEntities: entities,
      aiScore: selectedMode === 'mode_3' ? 95 : 88,
    });
    onComplete();
  };

  // Vendor handlers
  const handleAddVendor = () => {
    if (!newVendor.name.trim() || !newVendor.contactPerson.trim()) {
      showToast('Missing Fields', 'Vendor name and contact person are required.', 'info');
      return;
    }
    const vendor: VendorEntry = {
      ...newVendor,
      id: `v-${Date.now()}`,
      source: 'manual',
    };
    setVendors((prev) => [...prev, vendor]);
    setNewVendor({ name: '', contactPerson: '', phone: '', email: '', category: 'Heavy Mechanical', location: '', rating: 4.0 });
    setShowVendorForm(false);
    showToast('Vendor Added', `${vendor.name} added to ${vendor.category} category.`, 'success');
  };

  const handleDeleteVendor = (id: string) => {
    setVendors((prev) => prev.filter((v) => v.id !== id));
    showToast('Vendor Removed', 'Vendor has been removed from the list.', 'info');
  };

  const handleSimulateVendorUpload = () => {
    setIsUploadingVendors(true);
    setTimeout(() => {
      const bulkVendors: VendorEntry[] = [
        { id: `v-bulk-${Date.now()}-1`, name: 'Global Fittings Corp', contactPerson: 'Anil Joshi', phone: '+91 98765 11223', email: 'anil@globalfittings.com', category: 'Piping & Fittings', location: 'Vadodara, GJ', rating: 4.4, source: 'excel' },
        { id: `v-bulk-${Date.now()}-2`, name: 'SmartSense Instruments', contactPerson: 'Deepa Rajan', phone: '+91 98234 55678', email: 'deepa@smartsense.in', category: 'Instrumentation', location: 'Bangalore, KA', rating: 4.6, source: 'excel' },
        { id: `v-bulk-${Date.now()}-3`, name: 'Bharat Heavy Equipments', contactPerson: 'Rohan Desai', phone: '+91 99112 33456', email: 'rohan@bharatheavy.com', category: 'Heavy Mechanical', location: 'Jamshedpur, JH', rating: 4.2, source: 'excel' },
        { id: `v-bulk-${Date.now()}-4`, name: 'Automate HVAC Solutions', contactPerson: 'Kavita Iyer', phone: '+91 94567 88901', email: 'kavita@automatehvac.in', category: 'Building Automation & HVAC', location: 'Pune, MH', rating: 4.5, source: 'excel' },
        { id: `v-bulk-${Date.now()}-5`, name: 'PowerGrid Switchgear', contactPerson: 'Manoj Singh', phone: '+91 93456 77890', email: 'manoj@powergrid.co.in', category: 'Electrical & Switchgear', location: 'Noida, UP', rating: 4.3, source: 'excel' },
        { id: `v-bulk-${Date.now()}-6`, name: 'FlowMaster Valves', contactPerson: 'Anita Rao', phone: '+91 97890 12345', email: 'anita@flowmaster.com', category: 'Flow Control', location: 'Coimbatore, TN', rating: 4.7, source: 'excel' },
      ];
      setVendors((prev) => [...prev, ...bulkVendors]);
      setIsUploadingVendors(false);
      showToast('Vendor Excel Imported', `${bulkVendors.length} vendors imported and categorized successfully.`, 'success');
    }, 1500);
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const vendorsByCategory = VENDOR_CATEGORIES.map((cat) => ({
    category: cat,
    vendors: vendors.filter((v) => v.category === cat),
  })).filter((g) => g.vendors.length > 0);

  const getCategoryColor = (cat: string) => {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      'Heavy Mechanical': { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-800' },
      'Flow Control': { bg: 'bg-cyan-50 dark:bg-cyan-950/40', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-200 dark:border-cyan-800' },
      'Electrical & Switchgear': { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' },
      'Building Automation & HVAC': { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' },
      'Piping & Fittings': { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800' },
      'Instrumentation': { bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-800' },
      'General Industrial': { bg: 'bg-slate-50 dark:bg-slate-950/40', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-800' },
    };
    return colors[cat] || colors['General Industrial'];
  };

  const getTargetedVendors = () => {
    // Categories extracted from the RFQ entities
    const activeCategories = Array.from(new Set(entities.map(e => e.category)));
    
    if (selectedMode === 'mode_1') {
      // Version 1: Route ONLY to manual/Excel vendors in the buyer roster
      const matched = vendors.filter(v => 
        (v.source === 'manual' || v.source === 'excel') && 
        activeCategories.some(cat => v.category.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(v.category.toLowerCase()))
      );
      
      // Proximity score logic based on state overlap
      return matched.map(v => {
        const isLocalProximity = v.location.includes('MH') || v.location.includes('Mumbai') || v.location.includes('Pune') || v.location.includes('Ahmedabad') || v.location.includes('GJ');
        return {
          ...v,
          matchReason: 'Buyer Approved Roster',
          proximity: isLocalProximity ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
          proximityMatch: true
        };
      });
    } else if (selectedMode === 'mode_2') {
      // Version 2: Buyer roster + Procucev Network Database
      const matchedLocal = vendors.filter(v => 
        activeCategories.some(cat => v.category.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(v.category.toLowerCase()))
      ).map(v => ({
        ...v,
        matchReason: 'Buyer Roster',
        proximity: v.location.includes('MH') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
        proximityMatch: true
      }));

      const networkVendors = [
        { id: 'v-net-1', name: 'Global Pipe Solutions', contactPerson: 'John Doe', email: 'john@globalpipes.com', phone: '+1 415 555 2671', category: 'Flow Control', location: 'Houston, TX', rating: 4.5, matchReason: 'Procucev Base Network', proximity: 'International / US Hub', proximityMatch: false },
        { id: 'v-net-2', name: 'Titanium Castings Corp', contactPerson: 'Sarah Jenkins', email: 'sarah@titaniumcast.com', phone: '+44 20 7946 0958', category: 'Heavy Mechanical', location: 'Sheffield, UK', rating: 4.7, matchReason: 'Procucev Base Network', proximity: 'International / UK Hub', proximityMatch: false },
      ].filter(v => activeCategories.some(cat => v.category.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(v.category.toLowerCase())));

      return [...matchedLocal, ...networkVendors];
    } else {
      // Version 3: RFQs go strictly to buyer uploaded vendors
      const matched = vendors.filter(v => 
        (v.source === 'manual' || v.source === 'excel') && 
        activeCategories.some(cat => v.category.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(v.category.toLowerCase()))
      );
      return matched.map(v => ({
        ...v,
        matchReason: 'Buyer Approved Roster',
        proximity: v.location.includes('MH') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
        proximityMatch: true
      }));
    }
  };

  const targetedPool = getTargetedVendors();

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              AI Ingestion & Sourcing Mode Selection Wizard
            </h1>
            <span className="badge badge-purple">Screen 1.2</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Automated document entity parsing, verification, and autonomous vendor pool routing.
          </p>
        </div>
        <button onClick={onCancel} className="btn btn-secondary btn-sm">
          Exit Wizard
        </button>
      </div>

      {/* Step Progress Indicator */}
      <div className="grid grid-cols-3 gap-3">
        <div
          onClick={() => setActiveStep(1)}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            activeStep === 1
              ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-indigo-950 dark:text-white shadow-sm'
              : activeStep > 1
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-500/40 text-slate-700 dark:text-gray-300'
              : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="flex items-center gap-1.5">
              {activeStep > 1 ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" /> : '1.'}
              STEP 1: INGESTION
            </span>
            <span className="text-[10px] mono text-slate-400 dark:text-gray-400">Document OCR</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">Drag & drop BOQ file or email</p>
        </div>

        <div
          onClick={() => activeStep >= 2 && setActiveStep(2)}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            activeStep === 2
              ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-indigo-950 dark:text-white shadow-sm'
              : activeStep > 2
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-500/40 text-slate-700 dark:text-gray-300'
              : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="flex items-center gap-1.5">
              {activeStep > 2 ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" /> : '2.'}
              STEP 2: REVIEW ENTITIES
            </span>
            <span className="text-[10px] mono text-slate-400 dark:text-gray-400">AI Extraction</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">Verify items, quantities & specs</p>
        </div>

        <div
          onClick={() => activeStep >= 3 && setActiveStep(3)}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            activeStep === 3
              ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-indigo-950 dark:text-white shadow-sm'
              : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="flex items-center gap-1.5">3. STEP 3: SOURCING MODE</span>
            <span className="text-[10px] mono text-slate-400 dark:text-gray-400">Dispatch</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">Choose Version 1, 2, or 3</p>
        </div>
      </div>

      {/* STEP 1: INGESTION & DOCUMENT EXTRACTION */}
      {activeStep === 1 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UploadCloud size={18} className="text-indigo-600 dark:text-indigo-400" />
                STEP 1: INGESTION & DOCUMENT EXTRACTION
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Upload your Bill of Quantities (BOQ), RFP specification sheet, or ingest automatically via email.
              </p>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-900 p-1 rounded-lg border border-slate-200 dark:border-gray-800 text-xs">
              <button
                onClick={() => setIngestionMethod('upload')}
                className={`px-3 py-1 rounded-md font-semibold ${
                  ingestionMethod === 'upload' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                File Upload
              </button>
              <button
                onClick={() => setIngestionMethod('email')}
                className={`px-3 py-1 rounded-md font-semibold ${
                  ingestionMethod === 'email' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Email Ingestion
              </button>
            </div>
          </div>

          {ingestionMethod === 'upload' ? (
            <div
              onClick={handleSimulateUpload}
              className="border-2 border-dashed border-indigo-300 dark:border-indigo-500/40 hover:border-indigo-500 rounded-2xl p-8 text-center bg-indigo-50/40 dark:bg-gray-900/40 hover:bg-indigo-50/80 dark:hover:bg-gray-900/70 transition-all cursor-pointer group"
            >
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-300 dark:border-indigo-500/40 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                <FileSpreadsheet size={28} />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-3">
                [ Drag & Drop RFQ Document / BOQ Spreadsheet Here ]
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                Supports Excel (.xlsx, .xls), PDF engineering drawings, and Word specifications (.docx).
              </p>
              <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-gray-800 text-xs text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700 shadow-sm">
                <span>Selected Sample:</span>
                <span className="font-semibold text-indigo-600 dark:text-indigo-300 mono">{uploadedFileName}</span>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-slate-50 dark:bg-gray-900/70 border border-slate-200 dark:border-gray-800 space-y-3 text-xs">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold">
                <Mail size={16} /> Autonomous Email Ingestion Gateway
              </div>
              <p className="text-slate-700 dark:text-gray-300">
                Forward your vendor RFP attachments directly to: <span className="font-bold text-indigo-600 dark:text-indigo-300 mono">client@procucev.com</span>. The QUA AI engine will autonomously parse attachments, extract entities, and create an RFQ draft.
              </p>
              <div className="p-3 rounded-lg bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex items-center justify-between">
                <span className="mono text-slate-800 dark:text-gray-300 font-medium">client@procucev.com (Enterprise Ingestion Active)</span>
                <span className="badge badge-emerald">Connected</span>
              </div>
            </div>
          )}

          {isProcessingDoc ? (
            <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/40 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-xs">
                <Sparkles size={16} className="animate-spin" />
                OCR Engine (Azure AI Document Intelligence) Parsing Entities...
              </div>
              <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden max-w-md mx-auto">
                <div className="bg-indigo-600 h-full w-3/4 animate-pulse" />
              </div>
            </div>
          ) : (
            <div className="flex justify-end pt-2">
              <button onClick={handleSimulateUpload} className="btn btn-primary">
                Parse Document & Review Entities <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: AI EXTRACTED ENTITIES (REVIEW & VERIFY) */}
      {activeStep === 2 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
                STEP 2: AI EXTRACTED ENTITIES (REVIEW & VERIFY)
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Review, refine, or add line items extracted from the uploaded document before selecting the sourcing pool.
              </p>
            </div>
            <button onClick={handleAddEntity} className="btn btn-secondary btn-sm">
              <Plus size={13} /> Add Line Item
            </button>
          </div>

          {/* RFQ Meta inputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs">
            <div>
              <label className="block text-slate-600 dark:text-gray-400 font-semibold mb-1">Generated RFQ Number</label>
              <input type="text" value={rfqNumber} readOnly className="mono opacity-80" />
            </div>
            <div>
              <label className="block text-slate-600 dark:text-gray-400 font-semibold mb-1">Procurement Project Title</label>
              <input
                type="text"
                value={rfqTitle}
                onChange={(e) => setRfqTitle(e.target.value)}
                className="font-medium"
              />
            </div>
            <div>
              <label className="block text-slate-600 dark:text-gray-400 font-semibold mb-1">Estimated Budget ($)</label>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="mono font-semibold"
              />
            </div>
          </div>

          {/* Line-item table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-50 dark:bg-gray-900/90 text-slate-600 dark:text-gray-400 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-3">Item Description</th>
                  <th className="p-3 w-24">Qty</th>
                  <th className="p-3 w-28">Target Date</th>
                  <th className="p-3">Technical Specifications</th>
                  <th className="p-3 w-28 text-center">Confidence</th>
                  <th className="p-3 w-12 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-800 dark:text-gray-200">
                {entities.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="p-3">
                      <input
                        type="text"
                        value={item.itemName}
                        onChange={(e) => handleEntityChange(item.id, 'itemName', e.target.value)}
                        className="font-semibold text-xs"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleEntityChange(item.id, 'quantity', Number(e.target.value))}
                        className="mono text-xs text-center"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="date"
                        value={item.targetDate}
                        onChange={(e) => handleEntityChange(item.id, 'targetDate', e.target.value)}
                        className="text-xs"
                      />
                    </td>
                    <td className="p-3">
                      <textarea
                        rows={2}
                        value={item.technicalSpecs}
                        onChange={(e) => handleEntityChange(item.id, 'technicalSpecs', e.target.value)}
                        className="text-xs resize-none"
                      />
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                        {item.confidence}%
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleDeleteEntity(item.id)}
                        className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1"
                        title="Delete item"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
            <button onClick={() => setActiveStep(1)} className="btn btn-secondary btn-sm">
              Back to Upload
            </button>
            <button onClick={() => setActiveStep(3)} className="btn btn-primary">
              Proceed to Mode Selection <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: CHOOSE PROCUREMENT MODE & DISPATCH */}
      {activeStep === 3 && (
        <div className="glass-panel p-6 rounded-2xl space-y-6 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers size={18} className="text-indigo-600 dark:text-indigo-400" />
              STEP 3: CHOOSE PROCUREMENT MODE
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Select the supplier routing algorithm and automated chasing governance for this RFQ.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SOURCING_MODES.map((mode) => {
              const isSelected = selectedMode === mode.id;
              return (
                <div
                  key={mode.id}
                  onClick={() => setSelectedMode(mode.id)}
                  className={`p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between relative group ${
                    isSelected
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-600 dark:border-indigo-500 shadow-md'
                      : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-3 right-3 p-1 rounded-full bg-indigo-600 text-white">
                      <CheckCircle2 size={14} />
                    </div>
                  )}

                  <div>
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider inline-block mb-2"
                      style={{
                        backgroundColor: `${mode.badgeColor}15`,
                        color: mode.badgeColor,
                        border: `1px solid ${mode.badgeColor}35`,
                      }}
                    >
                      {mode.code}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{mode.shortLabel}</h3>
                    <p className="text-xs text-slate-600 dark:text-gray-400 mt-2 leading-relaxed">{mode.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-gray-800 text-[11px] font-medium text-slate-600 dark:text-gray-300">
                    {mode.id === 'mode_1' && '• Private client roster only'}
                    {mode.id === 'mode_2' && '• Client + Procucev Hybrid pool (Recommended)'}
                    {mode.id === 'mode_3' && '• AI Match Scored >80% with auto-audit'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dynamic Targeted Sourcing Pool Preview */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                <Users size={14} className="text-indigo-600 dark:text-indigo-400" />
                Targeted Dispatch Pool Preview ({targetedPool.length} matched roster vendors)
              </h3>
              {selectedMode === 'mode_1' && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60">
                  Version 1 Active Pool Rules
                </span>
              )}
              {selectedMode === 'mode_3' && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                  Version 3 Double-Blind Verification Active
                </span>
              )}
            </div>

            {selectedMode === 'mode_1' && (
              <div className="p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-900/30 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                👉 <strong>Version 1 Restrictions</strong>: RFQ dispatch goes strictly to manually added or Excel-uploaded vendors in your buyer roster. **System-wide AI Vendor Evaluations are fully disabled in V1.** Target matching is calculated strictly based on **RFQ Category Match** and **Location Proximity**.
              </div>
            )}

            {selectedMode === 'mode_3' && (
              <div className="p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/40 dark:border-indigo-900/30 text-[11px] leading-relaxed text-slate-700 dark:text-gray-300 space-y-1.5 shadow-sm">
                <div className="flex items-center gap-1.5 font-bold text-indigo-700 dark:text-indigo-400">
                  <ShieldCheck size={14} />
                  <span>Version 3 Anonymous Double-Blind Sourcing & Qualification Protocol</span>
                </div>
                <p>
                  This RFQ will be sent immediately to the buyer uploaded roster. Simultaneously, our system has recommended **10 vetted vendors from the Procucev database** below. 
                </p>
                <p className="text-[10px] text-slate-500 dark:text-gray-400">
                  ⚡ <strong>Evaluation First</strong>: The system will send these 10 vendors an evaluation invite via email and SMS/WhatsApp with a secure capability questionnaire. Important BOQ details and specs are provided, but <strong>your company identity and contact information will remain fully withheld</strong> until they pass initial validation.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {targetedPool.map((v) => (
                <div key={v.id} className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex flex-col justify-between space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-white">{v.name}</div>
                      <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">{v.category} · {v.location}</div>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 shrink-0 border border-indigo-200/40">
                      {v.matchReason}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-100 dark:border-gray-900">
                    <span className="text-slate-500">Proximity: <strong className="text-slate-700 dark:text-gray-300">{v.proximity}</strong></span>
                    {v.proximityMatch && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200/30">
                        ✓ Approved Roster
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {targetedPool.length === 0 && (
                <div className="col-span-2 p-5 text-center text-slate-400 dark:text-gray-500 border border-dashed border-slate-200 dark:border-gray-800 rounded-xl">
                  No matching vendors found in your approved roster. Please add manual/Excel vendors matching category criteria.
                </div>
              )}
            </div>

            {/* Recommended Procucev Pool Grid */}
            {selectedMode === 'mode_3' && (
              <div className="space-y-2.5 pt-3">
                <h4 className="text-[10px] uppercase font-extrabold text-slate-450 dark:text-gray-500 tracking-wider">
                  System Recommendations: 10 Procucev Database Vendors (Invited for Anonymous Evaluation)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {RECOMMENDED_PROCUCEV_VENDORS.map((v) => (
                    <div key={v.id} className="p-3 rounded-xl bg-slate-50/50 dark:bg-gray-950/40 border border-slate-200 dark:border-gray-800/60 flex flex-col justify-between space-y-1 hover:border-indigo-500/40 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                            {v.name}
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/30">
                              {v.matchScore}% Match
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">{v.category} · {v.location}</div>
                        </div>
                        <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-450 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200/30 shrink-0">
                          Evaluation Invite Queued
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-450 flex justify-between items-center pt-1 border-t border-slate-100 dark:border-gray-900">
                        <span>Rating: ⭐ <strong>{v.rating} / 5.0</strong> ({v.proximity})</span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-0.5">
                          🔒 Double-Blind active
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Dispatch Summary Box */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs space-y-2">
            <div className="flex items-center justify-between font-semibold">
              <span className="text-slate-700 dark:text-gray-300">Ready to Dispatch:</span>
              <span className="mono text-indigo-700 dark:text-indigo-300 font-bold">{rfqNumber} — {entities.length} Line Items</span>
            </div>
            <p className="text-slate-500 dark:text-gray-400 text-[11px]">
              Upon dispatch, targeted suppliers will receive instant WhatsApp & Email notifications with interactive line-item bidding portals.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
            <button onClick={() => setActiveStep(2)} className="btn btn-secondary btn-sm">
              Back to Review
            </button>
            <button onClick={handleDispatch} className="btn btn-primary btn-lg font-bold">
              <Send size={16} /> [ DISPATCH RFQ TO TARGET VENDOR POOL ]
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR DATA MANAGEMENT SECTION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-panel rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 overflow-hidden">
        {/* Section Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400">
              <Users size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Vendor Data Management</h2>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Add vendors manually or import via Excel. Categorized view below.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] mono text-slate-400 dark:text-gray-500">{vendors.length} vendors</span>
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-gray-800 p-0.5 rounded-lg border border-slate-200 dark:border-gray-700 text-[11px]">
              <button
                onClick={() => setVendorAddMethod('manual')}
                className={`px-3 py-1 rounded-md font-semibold transition-all ${
                  vendorAddMethod === 'manual'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-1"><Plus size={11} /> Manual</span>
              </button>
              <button
                onClick={() => setVendorAddMethod('excel')}
                className={`px-3 py-1 rounded-md font-semibold transition-all ${
                  vendorAddMethod === 'excel'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-1"><FileSpreadsheet size={11} /> Excel Upload</span>
              </button>
            </div>
          </div>
        </div>

        {/* Add Vendor Panel */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800">
          {vendorAddMethod === 'manual' ? (
            <div>
              {!showVendorForm ? (
                <button
                  onClick={() => setShowVendorForm(true)}
                  className="w-full p-4 rounded-xl border-2 border-dashed border-slate-200 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500 text-slate-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all flex items-center justify-center gap-2 text-xs font-semibold"
                >
                  <Plus size={14} /> Click to Add New Vendor Manually
                </button>
              ) : (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                      <Building2 size={13} className="text-indigo-600 dark:text-indigo-400" /> New Vendor Details
                    </span>
                    <button onClick={() => setShowVendorForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-gray-300">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Company Name *</label>
                      <input
                        type="text"
                        value={newVendor.name}
                        onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })}
                        placeholder="e.g. Apex Supplies Ltd."
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Contact Person *</label>
                      <input
                        type="text"
                        value={newVendor.contactPerson}
                        onChange={(e) => setNewVendor({ ...newVendor, contactPerson: e.target.value })}
                        placeholder="e.g. Rajesh Nair"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Phone</label>
                      <input
                        type="text"
                        value={newVendor.phone}
                        onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })}
                        placeholder="+91 98201 44820"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Email</label>
                      <input
                        type="email"
                        value={newVendor.email}
                        onChange={(e) => setNewVendor({ ...newVendor, email: e.target.value })}
                        placeholder="vendor@company.com"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Category</label>
                      <select
                        value={newVendor.category}
                        onChange={(e) => setNewVendor({ ...newVendor, category: e.target.value })}
                        className="text-xs"
                      >
                        {VENDOR_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Location</label>
                      <input
                        type="text"
                        value={newVendor.location}
                        onChange={(e) => setNewVendor({ ...newVendor, location: e.target.value })}
                        placeholder="Mumbai, MH"
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button onClick={() => setShowVendorForm(false)} className="btn btn-secondary btn-sm text-[11px]">
                      Cancel
                    </button>
                    <button onClick={handleAddVendor} className="btn btn-primary btn-sm text-[11px]">
                      <Plus size={12} /> Add Vendor
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Excel Upload */
            <div>
              {isUploadingVendors ? (
                <div className="p-5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/40 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-xs">
                    <Sparkles size={14} className="animate-spin" /> Parsing vendor spreadsheet & categorizing...
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden max-w-sm mx-auto">
                    <div className="bg-indigo-600 h-full w-3/4 animate-pulse" />
                  </div>
                </div>
              ) : (
                <div
                  onClick={handleSimulateVendorUpload}
                  className="border-2 border-dashed border-indigo-300 dark:border-indigo-500/40 hover:border-indigo-500 rounded-xl p-6 text-center bg-indigo-50/30 dark:bg-gray-900/40 hover:bg-indigo-50/60 dark:hover:bg-gray-900/70 transition-all cursor-pointer group"
                >
                  <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-300 dark:border-indigo-500/40 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                    <FileSpreadsheet size={24} />
                  </div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white mt-2">
                    [ Drag & Drop Vendor Excel File Here ]
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">
                    Supports .xlsx, .xls, .csv — Columns: Company, Contact, Phone, Email, Category, Location
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Vendor Categorization View ── */}
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
              <Tag size={13} className="text-indigo-600 dark:text-indigo-400" />
              Vendor Categorization ({vendors.length} total across {vendorsByCategory.length} categories)
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpandedCategories(new Set(VENDOR_CATEGORIES))}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
              >
                Expand All
              </button>
              <button
                onClick={() => setExpandedCategories(new Set())}
                className="text-[10px] text-slate-400 dark:text-gray-500 hover:underline font-semibold"
              >
                Collapse All
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {vendorsByCategory.map(({ category, vendors: catVendors }) => {
              const isExpanded = expandedCategories.has(category);
              const colors = getCategoryColor(category);
              return (
                <div key={category} className={`rounded-xl border ${colors.border} overflow-hidden`}>
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 ${colors.bg} transition-colors hover:opacity-90`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${colors.text}`}>{category}</span>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-gray-500 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded">
                        {catVendors.length} vendor{catVendors.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={14} className={colors.text} />
                    ) : (
                      <ChevronDown size={14} className={colors.text} />
                    )}
                  </button>

                  {/* Vendor Rows */}
                  {isExpanded && (
                    <div className="divide-y divide-slate-100 dark:divide-gray-800/60">
                      {catVendors.map((vendor) => (
                        <div
                          key={vendor.id}
                          className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50/80 dark:hover:bg-gray-800/30 transition-colors text-xs group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center text-slate-500 dark:text-gray-400 shrink-0 text-[10px] font-bold">
                              {vendor.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-800 dark:text-gray-200 truncate">{vendor.name}</span>
                                {vendor.source === 'excel' && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 shrink-0">
                                    Excel
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
                                <span className="flex items-center gap-0.5"><Users size={9} /> {vendor.contactPerson}</span>
                                {vendor.location && <span className="flex items-center gap-0.5"><MapPin size={9} /> {vendor.location}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {vendor.phone && (
                              <span className="text-[10px] text-slate-400 dark:text-gray-500 mono hidden sm:inline">{vendor.phone}</span>
                            )}
                            <div className="flex items-center gap-0.5 text-amber-500">
                              <Star size={10} fill="currentColor" />
                              <span className="text-[10px] font-bold">{vendor.rating}</span>
                            </div>
                            <button
                              onClick={() => handleDeleteVendor(vendor.id)}
                              className="text-slate-300 dark:text-gray-600 hover:text-rose-500 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all p-1"
                              title="Remove vendor"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {vendors.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-400 dark:text-gray-500">
              <Users size={24} className="mx-auto mb-2 opacity-40" />
              No vendors added yet. Add manually or import via Excel.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
