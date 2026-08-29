'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { SOURCING_MODES } from '@/lib/mock-data';
import { SourcingMode, ExtractedEntity, VendorEntry } from '@/lib/types';
import categoriesData from '@/lib/categories.json';
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
  Eye,
  Download,
  Search,
  CheckSquare,
  Square,
  AlertCircle,
  FileCheck,
  Zap,
  SlidersHorizontal,
  Bot,
  Check,
  Info,
  Award,
  ExternalLink,
  Activity,
  Briefcase,
} from 'lucide-react';

interface IngestionWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

export interface RecommendedProcucevVendor {
  id: string;
  name: string;
  brandName: string;
  majorCategory: string;
  minorCategories: string[];
  location: string;
  rating: number | null; // null when unrated
  ratingCount?: number;
  matchScore: number;
  proximity: string;
  contactPerson: string;
  email: string;
  phone: string;
  gstin: string;
  panNumber: string;
  establishedYear: number;
  annualTurnover: string;
  plantCapacity: string;
  certifications: string[];
  keyMachinery: string[];
  otifRate: string;
  qualityPpm: string;
  recommendationReason: string;
  isUnratedRecommendation?: boolean;
}

const RECOMMENDED_PROCUCEV_VENDORS: RecommendedProcucevVendor[] = [
  {
    id: 'rec-1',
    name: 'Delta Valve Systems Ltd.',
    brandName: 'DeltaFlow Industrial',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Hoses, Valves & Fittings', 'Pipes & Pipe Fittings'],
    location: 'Pune, MH',
    rating: 4.8,
    ratingCount: 38,
    matchScore: 96,
    proximity: 'Local Hub (<250km)',
    contactPerson: 'Vikram Joshi (VP Operations)',
    email: 'v.joshi@deltavalves.in',
    phone: '+91 98220 18492',
    gstin: '27AABCD3920M1Z8',
    panNumber: 'AABCD3920M',
    establishedYear: 2008,
    annualTurnover: '$14.2M / Year',
    plantCapacity: '85,000 Valves & Actuators / Month',
    certifications: ['ISO 9001:2015', 'API 6D Spec', 'IBR Approved', 'CE Marking'],
    keyMachinery: ['5-Axis CNC Machining Centers', 'Hydrostatic Test Benches (600 Bar)', 'Automated Lapping & Polishing'],
    otifRate: '98.6%',
    qualityPpm: '< 320 PPM',
    recommendationReason: 'Direct line-item match on ANSI Class 150 flanged valves with verified 600 Bar hydrostatic test facility and local Maharashtra hub dispatch within 48 hours.',
  },
  {
    id: 'rec-2',
    name: 'Dynamic Flow Controls Pvt Ltd',
    brandName: 'Dynaflow Heavy',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Hoses, Valves & Fittings'],
    location: 'Chennai, TN',
    rating: 4.7,
    ratingCount: 29,
    matchScore: 94,
    proximity: 'Regional Hub (<600km)',
    contactPerson: 'K. Senthil Nathan (Director - SCM)',
    email: 'senthil@dynamicflow.co.in',
    phone: '+91 94440 82910',
    gstin: '33AAACD8819L1Z2',
    panNumber: 'AAACD8819L',
    establishedYear: 2012,
    annualTurnover: '$9.8M / Year',
    plantCapacity: '50,000 High-Pressure Control Valves / Month',
    certifications: ['ISO 9001:2015', 'ISO 14001:2015', 'SIL 3 Functional Safety'],
    keyMachinery: ['Mazak Multi-Tasking Lathes', 'Cryogenic Testing Chambers', 'CMM Coordinate Measuring Benches'],
    otifRate: '97.8%',
    qualityPpm: '< 410 PPM',
    recommendationReason: 'High dimensional compliance score for gate and globe valve specifications with pre-calibrated smart positioners and audited Net 45 commercial terms.',
  },
  {
    id: 'rec-3',
    name: 'ElectroMech Pumps & Spares',
    brandName: 'ElectroMech Power',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pumps & Accessories', 'Motors'],
    location: 'Mumbai, MH',
    rating: 4.6,
    ratingCount: 44,
    matchScore: 93,
    proximity: 'Local Hub (<250km)',
    contactPerson: 'Anand Kulkarni (Chief Technical Officer)',
    email: 'anand.k@electromechpumps.com',
    phone: '+91 98190 33491',
    gstin: '27AAECE4910P1Z4',
    panNumber: 'AAECE4910P',
    establishedYear: 2005,
    annualTurnover: '$18.5M / Year',
    plantCapacity: '3,200 Industrial Centrifugal & Slurry Pumps / Month',
    certifications: ['ISO 9001:2015', 'Hydraulic Institute Standards (HI)', 'ATEX Flameproof'],
    keyMachinery: ['Dynamic Balancing Machines (up to 5 Tons)', 'Closed Loop Water Hydraulic Test Bay', 'Induction Hardening Units'],
    otifRate: '96.9%',
    qualityPpm: '< 480 PPM',
    recommendationReason: 'Local OEM manufacturer of 500 GPM centrifugal pumps matching SS316 impeller specifications with emergency site commissioning support within 24 hours.',
  },
  {
    id: 'rec-4',
    name: 'Vanguard Heavy Engineering Ltd',
    brandName: 'Vanguard Precision',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Machinery Parts', 'Customised Parts'],
    location: 'Bangalore, KA',
    rating: 4.7,
    ratingCount: 22,
    matchScore: 91,
    proximity: 'Regional Hub (<600km)',
    contactPerson: 'Siddharth Rao (VP - Aerospace & Industrial)',
    email: 'siddharth.r@vanguardeng.com',
    phone: '+91 99800 77123',
    gstin: '29AAACV7819B1Z5',
    panNumber: 'AAACV7819B',
    establishedYear: 2014,
    annualTurnover: '$11.2M / Year',
    plantCapacity: '120 Tons Precision Heavy Castings & Forgings / Month',
    certifications: ['AS9100D', 'ISO 9001:2015', 'NADCAP Heat Treatment'],
    keyMachinery: ['DMG MORI 5-Axis Milling Centers', 'Vacuum Heat Treatment Furnaces', 'Optical 3D Laser Scanners'],
    otifRate: '98.1%',
    qualityPpm: '< 290 PPM',
    recommendationReason: 'Precision engineering specialist with automated metallurgical spectrometry audits and proven track record across heavy infrastructure EPC clients.',
  },
  {
    id: 'rec-5',
    name: 'Sigma Switchgears & Controls',
    brandName: 'Sigma Volt',
    majorCategory: 'Engineering Spares - Electrical',
    minorCategories: ['Panels', 'Circuit Breakers'],
    location: 'Noida, UP',
    rating: 4.5,
    ratingCount: 31,
    matchScore: 89,
    proximity: 'National Hub',
    contactPerson: 'Rajeev Singhania (Head of Procurement & Tenders)',
    email: 'tenders@sigmaswitchgears.com',
    phone: '+91 98110 55420',
    gstin: '09AAACS9918K1Z3',
    panNumber: 'AAACS9918K',
    establishedYear: 2010,
    annualTurnover: '$15.0M / Year',
    plantCapacity: '4,500 LT/HT Electrical Control Panels / Year',
    certifications: ['CPRI Type Tested (65kA/1sec)', 'ISO 9001:2015', 'IEC 61439-1/2 Compliance'],
    keyMachinery: ['CNC Turret Punch Presses', 'Automated 9-Tank Powder Coating Lines', 'High Voltage Insulation Testers'],
    otifRate: '95.4%',
    qualityPpm: '< 520 PPM',
    recommendationReason: 'CPRI type-tested electrical panels and motorized circuit breaker assemblies with automated schematic verification.',
  },
  {
    id: 'rec-6',
    name: 'Zenith Piping Solutions',
    brandName: 'Zenith Tubes & Fittings',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pipes & Pipe Fittings'],
    location: 'Ahmedabad, GJ',
    rating: null, // UNRATED SUPPLIER (Option to Evaluate & Send RFQ)
    ratingCount: 0,
    matchScore: 88,
    proximity: 'Regional Hub (<600km)',
    contactPerson: 'Manish Patel (Managing Partner)',
    email: 'sales@zenithpiping.co.in',
    phone: '+91 98790 44102',
    gstin: '24AABFZ1940E1Z9',
    panNumber: 'AABFZ1940E',
    establishedYear: 2021,
    annualTurnover: '$4.5M / Year',
    plantCapacity: '2,500 Metric Tons Seamless / ERW Pipes / Month',
    certifications: ['ISO 9001:2015 (Pending Audit Verification)', 'ASTM A53 / A106 Compliant'],
    keyMachinery: ['Cold Draw Benches (up to 12-inch OD)', 'Hydro-Testing Station', 'Eddy Current NDT Line'],
    otifRate: 'Pending First Platform Order',
    qualityPpm: 'Audit Assessment Required',
    recommendationReason: 'High category capability alignment on heavy-wall industrial pipe fittings with modern production line, recommended for initial 360° qualification audit alongside RFQ.',
    isUnratedRecommendation: true,
  },
  {
    id: 'rec-7',
    name: 'Alpha Instrumentation & Automation',
    brandName: 'Alpha Sense',
    majorCategory: 'Engineering Spares - Electrical',
    minorCategories: ['Controllers', 'Sensors'],
    location: 'Hyderabad, TS',
    rating: 4.6,
    ratingCount: 19,
    matchScore: 87,
    proximity: 'Regional Hub (<600km)',
    contactPerson: 'Dr. Venkat Rao (VP - Smart Sensors)',
    email: 'v.rao@alphainstruments.in',
    phone: '+91 94900 12830',
    gstin: '36AAACA1102Q1Z7',
    panNumber: 'AAACA1102Q',
    establishedYear: 2016,
    annualTurnover: '$7.4M / Year',
    plantCapacity: '150,000 Industrial Transmitters & Flow Sensors / Year',
    certifications: ['ISO 9001:2015', 'NABL Accredited Calibration Lab', 'HART / Modbus Certified'],
    keyMachinery: ['Automated SMT Surface Mount Lines', 'Fluid Micro-Calibration Test Rigs', 'Thermal Environmental Shock Chambers'],
    otifRate: '97.2%',
    qualityPpm: '< 380 PPM',
    recommendationReason: 'NABL-calibrated precision flow rate sensors and BACnet/DDC digital controllers with integrated IoT telemetry.',
  },
  {
    id: 'rec-8',
    name: 'United HVAC Systems Corp',
    brandName: 'United Airtech',
    majorCategory: 'CAPEX - Equipment & Machinery',
    minorCategories: ['Air Conditioners', 'Industrial Fans'],
    location: 'Mumbai, MH',
    rating: 4.5,
    ratingCount: 26,
    matchScore: 86,
    proximity: 'Local Hub (<250km)',
    contactPerson: 'Farhan Merchant (Commercial Head)',
    email: 'farhan.m@unitedhvac.com',
    phone: '+91 98200 66190',
    gstin: '27AAACU3019R1Z1',
    panNumber: 'AAACU3019R',
    establishedYear: 2009,
    annualTurnover: '$16.8M / Year',
    plantCapacity: '800 Custom Air Handling Units (AHU) & Chillers / Month',
    certifications: ['Eurovent Certified', 'ISO 9001:2015', 'AHRI Performance Standards'],
    keyMachinery: ['CNC Foam Gasket Dispensing Robots', 'Sheet Metal Laser Bending Line', 'Acoustic Sound Level Testing Bay'],
    otifRate: '96.5%',
    qualityPpm: '< 450 PPM',
    recommendationReason: 'Local industrial HVAC equipment fabricator with proven acoustic dampening and high-efficiency coils matching project specifications.',
  },
  {
    id: 'rec-9',
    name: 'Matrix Fluid Dynamics Engineering',
    brandName: 'Matrix Flow Systems',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pumps & Accessories', 'Hoses, Valves & Fittings'],
    location: 'Vadodara, GJ',
    rating: null, // UNRATED SUPPLIER (Option to Evaluate & Send RFQ)
    ratingCount: 0,
    matchScore: 85,
    proximity: 'Regional Hub (<600km)',
    contactPerson: 'Hardik Shah (Plant Operations Manager)',
    email: 'hardik@matrixfluiddynamics.com',
    phone: '+91 97270 33910',
    gstin: '24AAECM7720J1Z6',
    panNumber: 'AAECM7720J',
    establishedYear: 2022,
    annualTurnover: '$3.8M / Year',
    plantCapacity: '1,800 High-Pressure Hydraulic Hoses & Manifolds / Month',
    certifications: ['ISO 9001:2015', 'DIN 20022 / EN 853 Hydraulic Standards'],
    keyMachinery: ['Finn-Power CNC Hose Crimping Machines', 'Burst Pressure Testing Rigs (1200 Bar)', 'Ultrasonic Tube Cleaning Baths'],
    otifRate: 'Pending Baseline Audit',
    qualityPpm: 'Initial Assessment Stage',
    recommendationReason: 'Newly registered manufacturer of heavy-duty hydraulic assemblies with state-of-the-art 1200 Bar burst pressure testing, recommended for initial 360° qualification.',
    isUnratedRecommendation: true,
  },
  {
    id: 'rec-10',
    name: 'Supreme Casting Industries',
    brandName: 'Supreme Foundry Works',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Cast Iron Parts', 'Die Casting'],
    location: 'Jamshedpur, JH',
    rating: 4.2,
    ratingCount: 17,
    matchScore: 84,
    proximity: 'National Hub',
    contactPerson: 'Bipin Bihari Roy (Works Manager)',
    email: 'works@supremecasting.in',
    phone: '+91 94310 99820',
    gstin: '20AAACS4920A1Z5',
    panNumber: 'AAACS4920A',
    establishedYear: 2003,
    annualTurnover: '$22.0M / Year',
    plantCapacity: '4,000 Metric Tons SGI & Gray Iron Castings / Month',
    certifications: ['ISO 9001:2015', 'IATF 16949 Automotive Quality', 'ISO 45001 Safety'],
    keyMachinery: ['Automatic Disamatic Green Sand Molding Line', 'Inductotherm Medium Frequency Melting Furnaces', 'Spectrometer Lab'],
    otifRate: '94.8%',
    qualityPpm: '< 650 PPM',
    recommendationReason: 'High-volume gray iron & ductile iron casting foundry with automated spectrometer chemical verification for large-scale municipal and industrial pump casings.',
  },
];

export default function IngestionWizard({ onComplete, onCancel }: IngestionWizardProps) {
  const {
    addNewRFQ,
    currentMode,
    setCurrentMode,
    showToast,
    buyerVendors,
    addBuyerVendor,
    importBuyerVendors,
    deleteBuyerVendor,
    matchSuitableVendors,
    openStandardEmailModal,
    remainingFreeRFQs,
    activeSubscription,
    selectedOnboardingEmail,
    setSelectedOnboardingEmail,
    onboardingEmailModalOpen,
    setOnboardingEmailModalOpen,
    openOnboardingEmailModal,
    triggerVendorReminder,
    completeVendorProfile,
  } = useApp();

  const [activeStep, setActiveStep] = useState<number>(1);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>('BOQ_Centrifugal_Pumps_HVAC_2026.xlsx');
  const [ingestionMethod, setIngestionMethod] = useState<'upload' | 'email'>('upload');
  const [uploadTab, setUploadTab] = useState<'boq' | 'email_file'>('boq');

  // Autonomous Ingestion State & Progress
  const [isAutoCirculating, setIsAutoCirculating] = useState(false);
  const [autoProgressStage, setAutoProgressStage] = useState<number>(0);

  // Email Ingestion Simulator State
  const [emailSender, setEmailSender] = useState('project.procurement@lt-heavy.com');
  const [emailSubject, setEmailSubject] = useState('URGENT: Requisition for Centrifugal Water Pumps & Industrial Valves');
  const [emailBody, setEmailBody] = useState(
    `Dear Procurement Team,\n\nPlease raise RFQ for immediate delivery to Navi Mumbai Site:\n1. Centrifugal Water Pump 500 GPM (15 HP Motor, SS316 Impeller, ANSI Flanged, 150 PSI) - Qty: 12 Units - Due: 2026-09-15\n2. Flanged Gate Valve 4-inch Class 150 (ASTM A216 WCB Cast Carbon Steel Body) - Qty: 24 Units - Due: 2026-09-18\n\nPlease categorize under appropriate mechanical minor categories and dispatch standard RFQ emails.`
  );

  const [rfqTitle, setRfqTitle] = useState('Centrifugal Water Pumps & Industrial Valves Procurement');
  const [rfqNumber] = useState(`RFQ-2026-00${Math.floor(430 + Math.random() * 50)}`);
  const [selectedMode, setSelectedMode] = useState<SourcingMode>(currentMode || 'mode_2');
  const [budget, setBudget] = useState(145000);

  // Line item entities state
  const [entities, setEntities] = useState<ExtractedEntity[]>([
    {
      id: 'ent-1',
      itemName: 'Centrifugal Water Pump (500 GPM)',
      quantity: 12,
      unit: 'Units',
      targetDate: '2026-09-15',
      technicalSpecs: 'Stainless Steel Impeller (SS316), 15 HP Motor, ANSI Flanged, 150 PSI',
      confidence: 98.4,
      category: 'Engineering Spares - Mechanical',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategory: 'Pumps & Accessories',
    },
    {
      id: 'ent-2',
      itemName: 'Flanged Gate Valve (4-inch Class 150)',
      quantity: 24,
      unit: 'Units',
      targetDate: '2026-09-18',
      technicalSpecs: 'ASTM A216 WCB Cast Carbon Steel Body, 150# Raised Face Flange, Rising Stem',
      confidence: 96.2,
      category: 'Engineering Spares - Mechanical',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategory: 'Hoses, Valves & Fittings',
    },
  ]);

  // Vendor management UI state
  const [vendorAddMethod, setVendorAddMethod] = useState<'manual' | 'excel'>('manual');
  const [isUploadingVendors, setIsUploadingVendors] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedMajorFilter, setSelectedMajorFilter] = useState('ALL');

  // Manual Vendor Form State
  const [newVendorName, setNewVendorName] = useState('');
  const [newContactPerson, setNewContactPerson] = useState('');
  const [newPhone, setNewPhone] = useState('+91 ');
  const [newEmail, setNewEmail] = useState('');
  const [newLocation, setNewLocation] = useState('Mumbai, MH');
  const [newMajorCategory, setNewMajorCategory] = useState(categoriesData[3].majorCategory); // Engineering Spares - Mechanical
  const [newSelectedMinors, setNewSelectedMinors] = useState<string[]>(['Pumps & Accessories', 'Hoses, Valves & Fittings']);

  // Mode 3 Procucev Pool Selection (Max 5 out of 10) & Vendor Profile Popup
  const [selectedMode3VendorIds, setSelectedMode3VendorIds] = useState<string[]>(['rec-1', 'rec-2', 'rec-3']);
  const [profileVendor, setProfileVendor] = useState<RecommendedProcucevVendor | null>(null);

  const toggleMode3Vendor = (vendorId: string, isEvaluateAction: boolean = false) => {
    const isCurrentlySelected = selectedMode3VendorIds.includes(vendorId);
    const targetVendor = RECOMMENDED_PROCUCEV_VENDORS.find((v) => v.id === vendorId);

    if (isCurrentlySelected) {
      if (selectedMode3VendorIds.length === 1) {
        showToast('Minimum Selection Required', 'Please keep at least 1 vendor selected to receive the RFQ.', 'warning');
        return;
      }
      setSelectedMode3VendorIds((prev) => prev.filter((id) => id !== vendorId));
      showToast('Vendor Removed', `Removed ${targetVendor?.name || 'vendor'} from dispatch list. (${selectedMode3VendorIds.length - 1}/5 selected)`, 'info');
    } else {
      if (selectedMode3VendorIds.length >= 5) {
        showToast('Maximum 5 Vendors Allowed', 'You can select a maximum of 5 vendors out of the 10 recommended database suppliers.', 'warning');
        return;
      }
      setSelectedMode3VendorIds((prev) => [...prev, vendorId]);
      if (isEvaluateAction || targetVendor?.isUnratedRecommendation) {
        showToast('360° Evaluation Bundled', `${targetVendor?.name} selected with bundled 360° double-blind qualification survey. (${selectedMode3VendorIds.length + 1}/5 selected)`, 'success');
      } else {
        showToast('Vendor Selected', `Added ${targetVendor?.name} to dispatch list. (${selectedMode3VendorIds.length + 1}/5 selected)`, 'success');
      }
    }
  };

  const handleAutoSelectTop5 = () => {
    const top5Ids = RECOMMENDED_PROCUCEV_VENDORS.slice(0, 5).map((v) => v.id);
    setSelectedMode3VendorIds(top5Ids);
    showToast('Top 5 Vendors Selected', 'Selected the 5 highest AI Match Score suppliers for Mode 3 dispatch.', 'success');
  };

  const handleClearMode3Selection = () => {
    setSelectedMode3VendorIds([RECOMMENDED_PROCUCEV_VENDORS[0].id]);
    showToast('Selection Reset', 'Kept top ranked supplier selected.', 'info');
  };

  // Handle Interactive File Upload (Portal / Email file)
  const handleSimulateUpload = (method: 'boq' | 'email_file' = uploadTab) => {
    setIsProcessingDoc(true);
    setTimeout(() => {
      setIsProcessingDoc(false);
      setActiveStep(2);
      if (method === 'email_file') {
        showToast('Email File Parsed (.eml)', 'Line-item entities extracted from uploaded email and mapped to Minor Categories.', 'success');
      } else {
        showToast('AI OCR Extraction Complete', 'Line-item entities extracted and categorized into Minor Categories.', 'success');
      }
    }, 1200);
  };

  // Helper to construct sample extracted entities
  const getSampleEntities = (sampleType?: 'mechanical' | 'electrical' | 'civil') => {
    let extracted: ExtractedEntity[] = [];
    let newTitle = '';
    let autoCategory = 'Engineering Spares - Mechanical';
    let autoBudget = 145000;

    if (sampleType === 'electrical') {
      newTitle = 'Electrical LV Switchgear Panels & Power Distribution Procurement';
      autoCategory = 'Engineering Spares - Electrical';
      autoBudget = 280000;
      extracted = [
        {
          id: `ent-${Date.now()}-1`,
          itemName: 'Form 4b Low Voltage Switchgear Panel 4000A',
          quantity: 2,
          unit: 'Sets',
          targetDate: '2026-09-28',
          technicalSpecs: 'IEC 61439-2 certified, 65kA fault withstand, IP54 enclosure',
          confidence: 99.2,
          category: 'Engineering Spares - Electrical',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategory: 'Panels',
        },
        {
          id: `ent-${Date.now()}-2`,
          itemName: 'Molded Case Circuit Breaker (MCCB 400A 4P 50kA)',
          quantity: 16,
          unit: 'Units',
          targetDate: '2026-09-28',
          technicalSpecs: 'Thermal-magnetic trip unit, microprocessor based, 50kA breaking capacity',
          confidence: 97.8,
          category: 'Engineering Spares - Electrical',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategory: 'Circuit Breakers',
        },
        {
          id: `ent-${Date.now()}-3`,
          itemName: 'XLPE Armoured Copper Power Cable (3.5C x 240 sq.mm)',
          quantity: 800,
          unit: 'Meters',
          targetDate: '2026-09-30',
          technicalSpecs: '1.1kV grade, stranded copper conductor, IS 7098 Part 1 compliant',
          confidence: 98.6,
          category: 'Engineering Spares - Electrical',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategory: 'Cables',
        },
      ];
    } else if (sampleType === 'civil') {
      newTitle = 'Structural Steel PEB & High-Grade TMT Rebars Supply';
      autoCategory = 'Civil Works';
      autoBudget = 195000;
      extracted = [
        {
          id: `ent-${Date.now()}-1`,
          itemName: 'Primary Steel Pre-Engineered Building (PEB Structure)',
          quantity: 140,
          unit: 'Metric Tons',
          targetDate: '2026-10-05',
          technicalSpecs: 'High tensile steel 345 MPa, clear span 30m, hot-dip galvanized purlins',
          confidence: 98.9,
          category: 'Civil Works',
          majorCategory: 'Civil Works',
          minorCategory: 'PEB Structure',
        },
        {
          id: `ent-${Date.now()}-2`,
          itemName: 'Fe500D High Strength TMT Rebar (16mm & 25mm)',
          quantity: 85,
          unit: 'Metric Tons',
          targetDate: '2026-09-25',
          technicalSpecs: 'IS 1786:2008 compliant, earthquake resistant, corrosion resistant',
          confidence: 97.4,
          category: 'Civil Works',
          majorCategory: 'Civil Works',
          minorCategory: 'TMT BARS',
        },
      ];
    } else {
      newTitle = 'Centrifugal Water Pumps & Flow Control Valves Procurement';
      autoCategory = 'Engineering Spares - Mechanical';
      autoBudget = 145000;
      extracted = [
        {
          id: `ent-${Date.now()}-1`,
          itemName: 'Centrifugal Water Pump (500 GPM)',
          quantity: 12,
          unit: 'Units',
          targetDate: '2026-09-15',
          technicalSpecs: 'Stainless Steel Impeller (SS316), 15 HP Motor, ANSI Flanged, 150 PSI',
          confidence: 98.4,
          category: 'Engineering Spares - Mechanical',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategory: 'Pumps & Accessories',
        },
        {
          id: `ent-${Date.now()}-2`,
          itemName: 'Flanged Gate Valve (4-inch Class 150)',
          quantity: 24,
          unit: 'Units',
          targetDate: '2026-09-18',
          technicalSpecs: 'ASTM A216 WCB Cast Carbon Steel Body, 150# Raised Face Flange, Rising Stem',
          confidence: 96.2,
          category: 'Engineering Spares - Mechanical',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategory: 'Hoses, Valves & Fittings',
        },
      ];
    }
    return { extracted, newTitle, autoCategory, autoBudget };
  };

  // Handle Interactive Email Ingestion Process (Proceed to Step 2)
  const handleSimulateEmailIngest = (sampleType?: 'mechanical' | 'electrical' | 'civil') => {
    setIsProcessingDoc(true);

    setTimeout(() => {
      const { extracted, newTitle } = getSampleEntities(sampleType);
      setRfqTitle(newTitle);
      setEntities(extracted);
      setIsProcessingDoc(false);
      setActiveStep(2);
      showToast('Email Ingested & Auto-Categorized', `${extracted.length} line items parsed & mapped to standard Minor Categories.`, 'success');
    }, 1400);
  };

  // ⚡ AUTONOMOUS PIPELINE: Directly complete Ingestion, Categorization, Vendor Shortlist & Auto-Circulation
  const handleAutonomousEmailDispatch = (sampleType: 'mechanical' | 'electrical' | 'civil' = 'mechanical') => {
    setIsAutoCirculating(true);
    setAutoProgressStage(1);

    const { extracted, newTitle, autoCategory, autoBudget } = getSampleEntities(sampleType);

    setTimeout(() => {
      setAutoProgressStage(2); // Stage 2: Minor Category Classification
    }, 600);

    setTimeout(() => {
      setAutoProgressStage(3); // Stage 3: Match suitable suppliers across mode
    }, 1200);

    setTimeout(() => {
      setAutoProgressStage(4); // Stage 4: Transmit standard emails & start chasers
    }, 1800);

    setTimeout(() => {
      const matched = matchSuitableVendors(extracted, selectedMode, buyerVendors);
      addNewRFQ(
        {
          rfqNumber,
          title: newTitle,
          category: autoCategory,
          sourcingMode: selectedMode,
          targetDeliveryDate: extracted[0]?.targetDate || '2026-09-25',
          budget: autoBudget,
          extractedEntities: extracted,
          aiScore: 96,
          source: 'email_gateway',
          sourceEmail: emailSender,
          autoCirculated: true,
        },
        matched
      );
      setIsAutoCirculating(false);
      showToast(
        'Autonomous Ingestion & Circulation Complete',
        `RFQ ${rfqNumber} ingested from ${emailSender}, categorized into minor categories, matched with ${matched.length} vendors, and standard RFQ emails dispatched automatically.`,
        'success'
      );
      onComplete();
    }, 2500);
  };

  const handleEntityChange = (id: string, field: keyof ExtractedEntity, value: any) => {
    setEntities((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === 'majorCategory') {
          // Reset minor category if major changed
          const validMinors = categoriesData.find((c) => c.majorCategory === value)?.minorCategories || [];
          updated.minorCategory = validMinors[0] || 'General Spec';
          updated.category = value;
        }
        return updated;
      })
    );
  };

  const handleAutoCategorizeAll = () => {
    setEntities((prev) =>
      prev.map((item) => {
        const cat = autoCategorizeItem(item.itemName, item.technicalSpecs);
        return {
          ...item,
          majorCategory: cat.majorCategory,
          minorCategory: cat.minorCategory,
          category: cat.majorCategory,
          confidence: 99.0,
        };
      })
    );
    showToast('AI Auto-Categorization Complete', 'All items accurately mapped to standardized Minor Categories.', 'success');
  };

  const handleAddEntity = () => {
    const newEnt: ExtractedEntity = {
      id: `ent-${Date.now()}`,
      itemName: 'High-Pressure Hydraulic Pump Spares',
      quantity: 10,
      unit: 'Units',
      targetDate: '2026-09-30',
      technicalSpecs: 'Specify ANSI / DIN standard compliance specs',
      confidence: 98.0,
      category: 'Engineering Spares - Mechanical',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategory: 'Pumps & Accessories',
    };
    setEntities([...entities, newEnt]);
  };

  const handleDeleteEntity = (id: string) => {
    setEntities(entities.filter((e) => e.id !== id));
  };

  // Get matched suitable vendor pool for Step 3
  const targetedPool = matchSuitableVendors(entities, selectedMode, buyerVendors);

  const handleDispatch = () => {
    setCurrentMode(selectedMode);
    const mainMajor = entities[0]?.majorCategory || 'Engineering Spares - Mechanical';

    let vendorsToDispatch: VendorEntry[] = targetedPool;
    if (selectedMode === 'mode_3') {
      vendorsToDispatch = RECOMMENDED_PROCUCEV_VENDORS
        .filter((v) => selectedMode3VendorIds.includes(v.id))
        .map((v) => ({
          id: v.id,
          name: v.name,
          contactPerson: v.contactPerson,
          email: v.email,
          phone: v.phone,
          majorCategory: v.majorCategory,
          minorCategories: v.minorCategories,
          location: v.location,
          rating: v.rating || undefined,
          source: 'procucev_network' as const,
          matchReason: v.rating
            ? `Mode 3 Double-Blind AI Matched (${v.matchScore}%)`
            : `Mode 3 Unrated Discovery Recommendation with Bundled 360° Evaluation (${v.matchScore}%)`,
          proximity: v.proximity,
          proximityMatch: true,
        }));
    }

    addNewRFQ(
      {
        rfqNumber,
        title: rfqTitle,
        category: mainMajor,
        sourcingMode: selectedMode,
        targetDeliveryDate: entities[0]?.targetDate || '2026-09-25',
        budget,
        extractedEntities: entities,
        aiScore: selectedMode === 'mode_3' ? 95 : 88,
        source: ingestionMethod === 'email' ? 'email_gateway' : uploadTab === 'email_file' ? 'email_upload' : 'web_portal',
        sourceEmail: ingestionMethod === 'email' ? emailSender : undefined,
        sourceFileName: ingestionMethod === 'upload' ? (uploadTab === 'email_file' ? 'Requisition_Valves_Spares.eml' : uploadedFileName) : undefined,
        autoCirculated: false,
      },
      vendorsToDispatch
    );
    onComplete();
  };

  // Vendor Handlers
  const handleAddVendorSubmit = () => {
    if (!newVendorName.trim() || !newContactPerson.trim() || !newEmail.trim()) {
      showToast('Validation Error', 'Vendor Company Name, Contact Person, and Email are required.', 'warning');
      return;
    }

    if (newSelectedMinors.length === 0) {
      showToast('Validation Error', 'Please select at least one Minor Category for this vendor.', 'warning');
      return;
    }

    addBuyerVendor({
      name: newVendorName,
      contactPerson: newContactPerson,
      phone: newPhone,
      email: newEmail,
      majorCategory: newMajorCategory,
      minorCategories: newSelectedMinors,
      location: newLocation,
      rating: 4.6,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      score: 90,
      evaluated: true,
      hasRecord: true,
    });

    setNewVendorName('');
    setNewContactPerson('');
    setNewEmail('');
    setNewPhone('+91 ');
    setShowVendorForm(false);
  };

  const handleToggleMinorSelection = (minor: string) => {
    if (newSelectedMinors.includes(minor)) {
      setNewSelectedMinors(newSelectedMinors.filter((m) => m !== minor));
    } else {
      setNewSelectedMinors([...newSelectedMinors, minor]);
    }
  };

  const handleSimulateVendorUpload = () => {
    setIsUploadingVendors(true);
    setTimeout(() => {
      const bulkVendors: Omit<VendorEntry, 'id'>[] = [
        {
          name: 'Global Fittings Corp',
          contactPerson: 'Anil Joshi',
          phone: '+91 98765 11223',
          email: 'anil@globalfittings.com',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategories: ['Pipes & Pipe Fittings', 'Hoses, Valves & Fittings'],
          location: 'Vadodara, GJ',
          rating: 4.6,
          source: 'buyer_excel',
          status: 'PREFERRED ENTERPRISE SUPPLIER',
        },
        {
          name: 'SmartSense Digital Instruments',
          contactPerson: 'Deepa Rajan',
          phone: '+91 98234 55678',
          email: 'deepa@smartsense.in',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategories: ['Controllers', 'Sensors', 'Transmitters'],
          location: 'Bangalore, KA',
          rating: 4.7,
          source: 'buyer_excel',
          status: 'PREFERRED ENTERPRISE SUPPLIER',
        },
        {
          name: 'Bharat Heavy Structural Infra',
          contactPerson: 'Rohan Desai',
          phone: '+91 99112 33456',
          email: 'rohan@bharatheavy.com',
          majorCategory: 'Civil Works',
          minorCategories: ['PEB Structure', 'Roofing Sheets', 'TMT BARS'],
          location: 'Jamshedpur, JH',
          rating: 4.4,
          source: 'buyer_excel',
          status: 'PREFERRED ENTERPRISE SUPPLIER',
        },
        {
          name: 'PowerGrid Switchgears & Transformers',
          contactPerson: 'Manoj Singh',
          phone: '+91 93456 77890',
          email: 'manoj@powergrid.co.in',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategories: ['Panels', 'Transformers', 'Circuit Breakers'],
          location: 'Noida, UP',
          rating: 4.5,
          source: 'buyer_excel',
          status: 'PREFERRED ENTERPRISE SUPPLIER',
        },
        {
          name: 'FlowMaster Valves & Fluid Dynamics',
          contactPerson: 'Anita Rao',
          phone: '+91 97890 12345',
          email: 'anita@flowmaster.com',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategories: ['Hoses, Valves & Fittings', 'Pumps & Accessories'],
          location: 'Coimbatore, TN',
          rating: 4.8,
          source: 'buyer_excel',
          status: 'PREFERRED ENTERPRISE SUPPLIER',
        },
      ];

      importBuyerVendors(bulkVendors);
      setIsUploadingVendors(false);
    }, 1500);
  };

  const handleDownloadSampleTemplate = () => {
    const csvContent =
      'Company Name,Contact Person,Email,Phone,Major Category,Minor Categories,Location,Rating\n' +
      'Apex Supplies Ltd.,Rajesh Nair,rajesh@apexsupplies.in,+91 98201 44820,Engineering Spares - Mechanical,"Pumps & Accessories, Compressors & Accessories",Mumbai MH,4.9\n' +
      'TechnoForce Engineering,Sunita Reddy,sunita@technoforce.in,+91 87654 32109,Engineering Spares - Electrical,"Panels, Circuit Breakers, Cables",Hyderabad TS,4.8\n' +
      'Everest Steel Infra,Harish Mehta,harish@evereststeel.in,+91 98111 22334,Civil Works,"PEB Structure, TMT BARS, Roofing Sheets",Ahmedabad GJ,4.7\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Vendor_Master_Major_Minor_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Template Downloaded', 'Sample Vendor CSV with Major & Minor Categories exported.', 'info');
  };

  // Group buyer vendors by Major Category
  const groupedVendors = categoriesData
    .map((cat) => ({
      majorCategory: cat.majorCategory,
      vendors: buyerVendors.filter(
        (v) =>
          v.majorCategory === cat.majorCategory &&
          (selectedMajorFilter === 'ALL' || selectedMajorFilter === cat.majorCategory) &&
          (vendorSearch === '' ||
            v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
            v.contactPerson.toLowerCase().includes(vendorSearch.toLowerCase()) ||
            (v.minorCategories || []).some((m) => m.toLowerCase().includes(vendorSearch.toLowerCase())))
      ),
    }))
    .filter((g) => g.vendors.length > 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              AI RFQ Ingestion & Multi-Mode Sourcing Dispatch
            </h1>
            <span className="badge badge-purple">Screen 1.2</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Automated minor category classification, multi-tier vendor matching, and standard RFQ email transmission.
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
            <span className="text-[10px] mono text-slate-400 dark:text-gray-400">Portal / Email</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">BOQ file or Email Gateway</p>
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
              STEP 2: MINOR CATEGORIZATION
            </span>
            <span className="text-[10px] mono text-slate-400 dark:text-gray-400">Taxonomy Mapping</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">Classify into 280+ Minor Categories</p>
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
            <span className="text-[10px] mono text-slate-400 dark:text-gray-400">Email Dispatch</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">Standard RFQ Email to Suitable Vendors</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 1: INGESTION (PORTAL UPLOAD OR EMAIL GATEWAY) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeStep === 1 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UploadCloud size={18} className="text-indigo-600 dark:text-indigo-400" />
                STEP 1: INGESTION SOURCE (EMAIL GATEWAY OR WEB PORTAL)
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Choose incoming intake source: Autonomous Email Ingestion Gateway or interactive Web Portal upload.
              </p>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-900 p-1 rounded-xl border border-slate-200 dark:border-gray-800 text-xs">
              <button
                onClick={() => setIngestionMethod('email')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                  ingestionMethod === 'email'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Mail size={13} /> 📧 Email Ingestion Gateway (Autonomous)
              </button>
              <button
                onClick={() => setIngestionMethod('upload')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                  ingestionMethod === 'upload'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Globe size={13} /> 🌐 Web Portal & File Ingestion
              </button>
            </div>
          </div>

          {ingestionMethod === 'upload' ? (
            <div className="space-y-4">
              {/* File Upload Subtabs */}
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-gray-800 pb-2">
                <button
                  onClick={() => setUploadTab('boq')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    uploadTab === 'boq'
                      ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-gray-200'
                  }`}
                >
                  <FileSpreadsheet size={14} /> BOQ Spreadsheet / Drawing (.xlsx, .pdf, .docx)
                </button>
                <button
                  onClick={() => setUploadTab('email_file')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    uploadTab === 'email_file'
                      ? 'bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-gray-200'
                  }`}
                >
                  <FileText size={14} /> Upload Email File (.eml / .msg)
                </button>
              </div>

              <div
                onClick={() => handleSimulateUpload(uploadTab)}
                className="border-2 border-dashed border-indigo-300 dark:border-indigo-500/40 hover:border-indigo-500 rounded-2xl p-8 text-center bg-indigo-50/40 dark:bg-gray-900/40 hover:bg-indigo-50/80 dark:hover:bg-gray-900/70 transition-all cursor-pointer group"
              >
                <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-300 dark:border-indigo-500/40 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                  {uploadTab === 'email_file' ? <Mail size={28} /> : <FileSpreadsheet size={28} />}
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-3">
                  {uploadTab === 'email_file'
                    ? '[ Drag & Drop Requisition Email File (.eml / .msg) Here ]'
                    : '[ Drag & Drop RFQ Document / BOQ Spreadsheet Here ]'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                  {uploadTab === 'email_file'
                    ? 'Extracts email headers, sender specifications, attachments, and line items.'
                    : 'Supports Excel (.xlsx, .xls), PDF drawings, and Word specifications (.docx).'}
                </p>
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-gray-800 text-xs text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700 shadow-sm">
                  <span>Active File:</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-300 mono">
                    {uploadTab === 'email_file' ? 'Requisition_Valves_Spares.eml' : uploadedFileName}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-gray-800 pb-3">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold">
                  <Mail size={16} /> Autonomous Email Ingestion Gateway (client@procucev.com)
                </div>
                <span className="badge badge-emerald flex items-center gap-1">
                  <span className="live-dot" style={{ width: 6, height: 6 }} /> Active & Listening
                </span>
              </div>

              {/* Banner explaining autonomous lights out */}
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Zap size={14} className="text-amber-600 dark:text-amber-400" />
                  Autonomous Lights-Out Ingestion:
                </div>
                <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
                  When an RFQ comes through email to <strong className="text-amber-700 dark:text-amber-300 font-mono">client@procucev.com</strong>, the system <strong>directly completes line-item minor categorization, vendor shortlisting, and email circulation automatically</strong> without requiring manual intervention.
                </p>
              </div>

              {/* Sample Email Simulator Box */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-3">
                <div className="flex items-center justify-between text-[11px] flex-wrap gap-2">
                  <span className="font-bold text-slate-700 dark:text-gray-300">Select Incoming Email Requisition Sample:</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => {
                        setEmailSubject('URGENT: Requisition for Centrifugal Water Pumps & Industrial Valves');
                        setEmailBody('Dear Procurement Team,\n\nPlease raise RFQ for immediate delivery to Navi Mumbai Site:\n1. Centrifugal Water Pump 500 GPM (15 HP Motor, SS316 Impeller, ANSI Flanged, 150 PSI) - Qty: 12 Units - Due: 2026-09-15\n2. Flanged Gate Valve 4-inch Class 150 (ASTM A216 WCB Cast Carbon Steel Body) - Qty: 24 Units - Due: 2026-09-18\n\nPlease categorize under appropriate mechanical minor categories and dispatch standard RFQ emails.');
                      }}
                      className="px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-semibold text-[10px] border border-indigo-200/50 hover:bg-indigo-100"
                    >
                      Mechanical Pumps & Valves
                    </button>
                    <button
                      onClick={() => {
                        setEmailSubject('URGENT: Requisition for LV Switchgear Panels & MCCB Breakers');
                        setEmailBody('Dear Procurement Team,\n\nRequisition for Electrical Infrastructure at Pune Plant:\n1. Form 4b Low Voltage Switchgear Panel 4000A (IEC 61439-2 certified, 65kA fault withstand, IP54) - Qty: 2 Sets - Due: 2026-09-28\n2. Molded Case Circuit Breaker MCCB 400A 4P 50kA - Qty: 16 Units - Due: 2026-09-28\n3. XLPE Armoured Copper Cable 3.5C x 240 sq.mm - Qty: 800 Meters - Due: 2026-09-30\n\nPlease auto-categorize and dispatch.');
                      }}
                      className="px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 font-semibold text-[10px] border border-amber-200/50 hover:bg-amber-100"
                    >
                      Electrical Switchgear
                    </button>
                    <button
                      onClick={() => {
                        setEmailSubject('URGENT: Structural Steel PEB & High-Grade TMT Rebars');
                        setEmailBody('Dear Procurement Team,\n\nRequisition for Civil & Warehouse Extension:\n1. Primary Steel Pre-Engineered Building (PEB Structure) - Qty: 140 Metric Tons - Due: 2026-10-05\n2. Fe500D High Strength TMT Rebar (16mm & 25mm) - Qty: 85 Metric Tons - Due: 2026-09-25\n\nPlease dispatch standard emails to civil vendors.');
                      }}
                      className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] border border-emerald-200/50 hover:bg-emerald-100"
                    >
                      Civil & PEB Steel
                    </button>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400">From (Plant Engineer)</label>
                      <input
                        type="text"
                        value={emailSender}
                        onChange={(e) => setEmailSender(e.target.value)}
                        className="w-full text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400">To (Enterprise Gateway)</label>
                      <input
                        type="text"
                        value="client@procucev.com"
                        readOnly
                        className="w-full text-xs font-mono opacity-80"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Subject</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Email Body & Line-Item Specs</label>
                    <textarea
                      rows={4}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      className="w-full text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {isProcessingDoc ? (
            <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/40 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-xs">
                <Sparkles size={16} className="animate-spin" />
                QUA AI Engine Parsing Entities & Categorizing into Minor Categories...
              </div>
              <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden max-w-md mx-auto">
                <div className="bg-indigo-600 h-full w-3/4 animate-pulse" />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
              <div className="text-[11px] text-slate-400">
                {ingestionMethod === 'email'
                  ? '⚡ Autonomous mode directly completes categorization, shortlisting, and dispatch in one step.'
                  : 'Interactive mode lets you review and adjust minor category taxonomy in Step 2.'}
              </div>
              <div className="flex items-center gap-2">
                {ingestionMethod === 'email' ? (
                  <>
                    <button
                      onClick={() => handleSimulateEmailIngest(emailSubject.includes('Switchgear') ? 'electrical' : emailSubject.includes('Steel') ? 'civil' : 'mechanical')}
                      className="btn btn-secondary text-xs flex items-center gap-1.5 font-semibold"
                    >
                      <SlidersHorizontal size={13} /> Interactive Review (Step-by-Step)
                    </button>
                    <button
                      onClick={() => handleAutonomousEmailDispatch(emailSubject.includes('Switchgear') ? 'electrical' : emailSubject.includes('Steel') ? 'civil' : 'mechanical')}
                      className="btn btn-primary font-black flex items-center gap-2 bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 hover:from-amber-500 hover:to-orange-600 text-white shadow-lg px-4 py-2 text-xs"
                    >
                      <Zap size={14} /> ⚡ Autonomous Ingest, Categorize & Auto-Circulate RFQ
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleSimulateUpload(uploadTab)}
                    className="btn btn-primary font-bold flex items-center gap-2"
                  >
                    <span>Proceed to Step 2: Interactive Review & Taxonomy</span> <ArrowRight size={15} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Autonomous Progress Execution Overlay ── */}
      {isAutoCirculating && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-500/40 rounded-3xl p-6 shadow-2xl space-y-5 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                  <Zap size={20} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Autonomous RFQ Ingestion & Auto-Circulation
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Executing lights-out pipeline for incoming email
                  </p>
                </div>
              </div>
              <span className="badge badge-amber font-mono text-[10px]">Lights-Out Active</span>
            </div>

            {/* Stages List */}
            <div className="space-y-3 text-xs">
              <div className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                autoProgressStage >= 1
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/50 text-emerald-900 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-800 text-slate-400'
              }`}>
                {autoProgressStage > 1 ? (
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <Sparkles size={16} className="text-amber-500 animate-spin shrink-0" />
                )}
                <div>
                  <span className="font-bold">Stage 1: Incoming Email Parsing & Entity Extraction</span>
                  <p className="text-[10px] opacity-80">Extracted requisition specs & attachments from {emailSender}</p>
                </div>
              </div>

              <div className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                autoProgressStage >= 2
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/50 text-emerald-900 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-800 text-slate-400'
              }`}>
                {autoProgressStage > 2 ? (
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : autoProgressStage === 2 ? (
                  <Sparkles size={16} className="text-amber-500 animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-gray-700 shrink-0" />
                )}
                <div>
                  <span className="font-bold">Stage 2: Standard Minor Category Classification</span>
                  <p className="text-[10px] opacity-80">Line items categorized into 280+ minor categories (Excel taxonomy)</p>
                </div>
              </div>

              <div className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                autoProgressStage >= 3
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/50 text-emerald-900 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-800 text-slate-400'
              }`}>
                {autoProgressStage > 3 ? (
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : autoProgressStage === 3 ? (
                  <Sparkles size={16} className="text-amber-500 animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-gray-700 shrink-0" />
                )}
                <div>
                  <span className="font-bold">Stage 3: Multi-Mode Vendor Matching</span>
                  <p className="text-[10px] opacity-80">Shortlisting suitable suppliers across Mode 1, Mode 2 & Mode 3</p>
                </div>
              </div>

              <div className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                autoProgressStage >= 4
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/50 text-emerald-900 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-800 text-slate-400'
              }`}>
                {autoProgressStage === 4 ? (
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-gray-700 shrink-0" />
                )}
                <div>
                  <span className="font-bold">Stage 4: Standard RFQ Email Auto-Circulation</span>
                  <p className="text-[10px] opacity-80">Standard emails dispatched with unmodified subject line requirement</p>
                </div>
              </div>
            </div>

            <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full transition-all duration-300"
                style={{ width: `${(autoProgressStage / 4) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 2: REVIEW ENTITIES & MINOR CATEGORIZATION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeStep === 2 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
                STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Every extracted item is categorized into its standardized <strong>Major Category</strong> and <strong>Minor Category</strong> from the Excel taxonomy.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAutoCategorizeAll}
                className="btn btn-secondary btn-sm text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 flex items-center gap-1 font-semibold"
              >
                <Sparkles size={13} /> ⚡ AI Auto-Categorize All
              </button>
              <button onClick={handleAddEntity} className="btn btn-secondary btn-sm flex items-center gap-1">
                <Plus size={13} /> Add Line Item
              </button>
            </div>
          </div>

          {/* RFQ Meta Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs">
            <div>
              <label className="block text-slate-600 dark:text-gray-400 font-semibold mb-1">Generated RFQ Number</label>
              <input type="text" value={rfqNumber} readOnly className="mono opacity-80 font-bold" />
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

          {/* Line Items Table with Major & Minor Category Dropdowns */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800 shadow-sm">
            <table className="w-full text-left text-xs min-w-[1080px]">
              <thead className="bg-slate-100 dark:bg-gray-950 text-slate-700 dark:text-gray-300 text-[10px] uppercase tracking-wider font-bold border-b border-slate-200 dark:border-gray-800">
                <tr>
                  <th className="p-3 w-[22%] min-w-[210px]">Item Description &amp; Specs</th>
                  <th className="p-3 w-[16%] min-w-[160px]">Major Category</th>
                  <th className="p-3 w-[18%] min-w-[180px]">Minor Category (Taxonomy)</th>
                  <th className="p-3 w-[10%] min-w-[90px] text-center">QTY</th>
                  <th className="p-3 w-[14%] min-w-[125px] text-center">UOM / UNIT</th>
                  <th className="p-3 w-[13%] min-w-[140px]">Target Date</th>
                  <th className="p-3 w-[8%] min-w-[85px] text-center">Confidence</th>
                  <th className="p-3 w-[4%] min-w-[45px] text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-800 dark:text-gray-200">
                {entities.map((item) => {
                  const currentMajor = item.majorCategory || categoriesData[0].majorCategory;
                  const availableMinors =
                    categoriesData.find((c) => c.majorCategory === currentMajor)?.minorCategories || [];

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="p-3 align-top min-w-[210px]">
                        <input
                          type="text"
                          value={item.itemName}
                          onChange={(e) => handleEntityChange(item.id, 'itemName', e.target.value)}
                          className="font-bold text-xs w-full mb-1 !py-1.5 !px-2.5 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                        <textarea
                          rows={2}
                          value={item.technicalSpecs}
                          onChange={(e) => handleEntityChange(item.id, 'technicalSpecs', e.target.value)}
                          className="text-[11px] w-full resize-none text-slate-500 dark:text-gray-400 !py-1.5 !px-2.5 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                      </td>

                      {/* Major Category Dropdown */}
                      <td className="p-3 align-top min-w-[160px]">
                        <select
                          value={currentMajor}
                          onChange={(e) => handleEntityChange(item.id, 'majorCategory', e.target.value)}
                          className="text-[11px] font-semibold w-full rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 !py-2 !px-2 shadow-xs"
                        >
                          {categoriesData.map((cat) => (
                            <option key={cat.majorCategory} value={cat.majorCategory}>
                              {cat.majorCategory}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Minor Category Dropdown */}
                      <td className="p-3 align-top min-w-[180px]">
                        <select
                          value={item.minorCategory || availableMinors[0]}
                          onChange={(e) => handleEntityChange(item.id, 'minorCategory', e.target.value)}
                          className="text-[11px] font-bold w-full rounded-lg bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 !py-2 !px-2 shadow-xs"
                        >
                          {availableMinors.map((minor) => (
                            <option key={minor} value={minor}>
                              {minor}
                            </option>
                          ))}
                        </select>
                        <span className="text-[9px] text-slate-400 mt-1 block">
                          Mapped from {availableMinors.length} minor items
                        </span>
                      </td>

                      {/* Quantity */}
                      <td className="p-3 align-top text-center min-w-[90px]">
                        <input
                          type="number"
                          value={item.quantity}
                          min={1}
                          onChange={(e) => handleEntityChange(item.id, 'quantity', Math.max(1, Number(e.target.value)))}
                          className="mono text-xs text-center font-bold w-full min-w-[75px] rounded-lg bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 !py-2 !px-2 shadow-inner focus:ring-2 focus:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </td>

                      {/* Unit of Measurement (UOM) */}
                      <td className="p-3 align-top text-center min-w-[125px]">
                        <input
                          type="text"
                          list={`uom-options-${item.id}`}
                          value={item.unit}
                          placeholder="e.g. Units"
                          onChange={(e) => handleEntityChange(item.id, 'unit', e.target.value)}
                          className="text-xs text-center font-semibold w-full min-w-[110px] rounded-lg bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 !py-2 !px-2.5 shadow-inner focus:ring-2 focus:ring-indigo-500"
                        />
                        <datalist id={`uom-options-${item.id}`}>
                          <option value="Units" />
                          <option value="Nos" />
                          <option value="Meters" />
                          <option value="Metric Tons" />
                          <option value="Kg" />
                          <option value="Sets" />
                          <option value="Liters" />
                          <option value="Pairs" />
                          <option value="Boxes" />
                          <option value="Hours" />
                          <option value="Lots" />
                        </datalist>
                      </td>

                      {/* Target Date */}
                      <td className="p-3 align-top min-w-[140px]">
                        <input
                          type="date"
                          value={item.targetDate}
                          onChange={(e) => handleEntityChange(item.id, 'targetDate', e.target.value)}
                          className="text-xs w-full min-w-[130px] !py-2 !px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                      </td>

                      {/* Confidence Badge */}
                      <td className="p-3 align-top text-center min-w-[85px]">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 inline-block mt-1">
                          {item.confidence}%
                        </span>
                      </td>

                      {/* Delete */}
                      <td className="p-3 align-top text-center min-w-[45px]">
                        <button
                          onClick={() => handleDeleteEntity(item.id)}
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="Delete item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
            <button onClick={() => setActiveStep(1)} className="btn btn-secondary btn-sm">
              Back to Ingestion
            </button>
            <button onClick={() => setActiveStep(3)} className="btn btn-primary font-bold flex items-center gap-2">
              <span>Proceed to Sourcing Mode & Vendor Matching</span> <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 3: SOURCING MODE, VENDOR MATCHING & STANDARD RFQ EMAIL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeStep === 3 && (
        <div className="glass-panel p-6 rounded-2xl space-y-6 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers size={18} className="text-indigo-600 dark:text-indigo-400" />
                STEP 3: SOURCING MODE SELECTION & STANDARD RFQ EMAIL DISPATCH
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Select your sourcing mode. The system matches suitable categorized vendors and transmits standard RFQ emails.
              </p>
            </div>
            {targetedPool.length > 0 && (
              <button
                onClick={() => openStandardEmailModal({ rfqNumber, title: rfqTitle, sourcingMode: selectedMode, targetDeliveryDate: entities[0]?.targetDate || '2026-09-25', budget, extractedEntities: entities } as any, targetedPool[0])}
                className="btn btn-secondary btn-sm text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 font-bold"
              >
                <Eye size={14} /> ✉️ Preview Standard RFQ Email
              </button>
            )}
          </div>

          {/* Free Account Quota Banner */}
          {activeSubscription === 'free_trial' && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-emerald-500/10 border border-amber-300 dark:border-amber-700/50 text-xs flex items-center justify-between gap-3 flex-wrap shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Sparkles size={16} />
                </div>
                <div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    Free Starter Account: {remainingFreeRFQs} of 5 Free RFQs Available
                  </span>
                  <p className="text-[11px] text-slate-600 dark:text-gray-300 mt-0.5">
                    You can select and dispatch in <strong>ANY version (Version 1, Version 2, or Version 3)</strong> for this free RFQ.
                  </p>
                </div>
              </div>
              <span className="badge badge-amber font-bold mono">
                All 3 Versions Unlocked
              </span>
            </div>
          )}

          {/* Sourcing Mode Selectors (Version 1, 2, 3) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SOURCING_MODES.map((mode) => {
              const isSelected = selectedMode === mode.id;
              const isAllowed = 
                (activeSubscription === 'free_trial' && remainingFreeRFQs > 0) ||
                activeSubscription === 'version_3' ||
                (activeSubscription === 'version_2' && (mode.id === 'mode_1' || mode.id === 'mode_2')) ||
                (activeSubscription === 'version_1' && mode.id === 'mode_1');

              const handleModeClick = () => {
                if (!isAllowed) {
                  showToast(
                    'Upgrade Required',
                    mode.id === 'mode_3'
                      ? 'Version 3 (Mode 3: Autonomous AI) requires an active Version 3 Plan. Upgrade in Subscription Center.'
                      : 'Version 2 (Mode 2: Hybrid Sourcing) requires a Version 2 or Version 3 Plan.',
                    'warning'
                  );
                  return;
                }
                setSelectedMode(mode.id);
              };

              return (
                <div
                  key={mode.id}
                  onClick={handleModeClick}
                  className={`p-5 rounded-2xl border-2 transition-all flex flex-col justify-between relative group ${
                    !isAllowed
                      ? 'opacity-65 bg-slate-50 dark:bg-gray-900/40 border-slate-200 dark:border-gray-800 cursor-not-allowed'
                      : isSelected
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-600 dark:border-indigo-500 shadow-md cursor-pointer'
                      : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 cursor-pointer'
                  }`}
                >
                  {isSelected && isAllowed && (
                    <div className="absolute top-3 right-3 p-1 rounded-full bg-indigo-600 text-white">
                      <CheckCircle2 size={14} />
                    </div>
                  )}

                  {!isAllowed && (
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[9px] font-bold border border-amber-300">
                      🔒 Upgrade Required
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider inline-block"
                        style={{
                          backgroundColor: `${mode.badgeColor}15`,
                          color: mode.badgeColor,
                          border: `1px solid ${mode.badgeColor}35`,
                        }}
                      >
                        {mode.code}
                      </span>
                      {isAllowed && (
                        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                          ✓ Included
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{mode.shortLabel}</h3>
                    <p className="text-xs text-slate-600 dark:text-gray-400 mt-2 leading-relaxed">{mode.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-gray-800 text-[11px] font-medium text-slate-600 dark:text-gray-300">
                    {mode.id === 'mode_1' && '• Private buyer roster only (Features of Version 1)'}
                    {mode.id === 'mode_2' && '• Buyer roster + Procucev Hybrid pool (Features of Version 1 & 2)'}
                    {mode.id === 'mode_3' && '• Autonomous AI + 360° Qualification (Features of Version 1, 2 & 3)'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dynamic Matched Suitable Vendor Pool */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                <Users size={14} className="text-indigo-600 dark:text-indigo-400" />
                Matched Suitable Vendors for Standard RFQ Email ({targetedPool.length} vendors matched on Minor Categories)
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                Taxonomy Matched: {entities.map((e) => e.minorCategory).filter(Boolean).join(', ')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {targetedPool.map((v) => (
                <div
                  key={v.id}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex flex-col justify-between space-y-2 hover:border-indigo-500/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                        {v.name}
                        {v.rating && (
                          <span className="text-[10px] text-amber-500 font-bold flex items-center gap-0.5">
                            ⭐ {v.rating}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
                        {v.contactPerson} · {v.email} · {v.location}
                      </div>
                    </div>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 shrink-0 border border-indigo-200/40">
                      {v.source === 'buyer_excel' || v.source === 'excel' ? 'Excel Upload' : v.source === 'procucev_network' ? 'Procucev Network' : 'Buyer Roster'}
                    </span>
                  </div>

                  {/* Minor Category Badges */}
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="text-slate-400 font-semibold">Categories:</span>
                    {(v.minorCategories || []).map((minor) => (
                      <span
                        key={minor}
                        className="px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 border border-slate-200 dark:border-gray-800 font-semibold"
                      >
                        {minor}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[10px] pt-2 border-t border-slate-100 dark:border-gray-900">
                    <span className="text-slate-500">
                      Proximity: <strong className="text-slate-700 dark:text-gray-300">{v.proximity || 'Local Hub (<250km)'}</strong>
                    </span>
                    <button
                      onClick={() =>
                        openStandardEmailModal(
                          {
                            rfqNumber,
                            title: rfqTitle,
                            sourcingMode: selectedMode,
                            targetDeliveryDate: entities[0]?.targetDate || '2026-09-25',
                            budget,
                            extractedEntities: entities,
                          } as any,
                          v
                        )
                      }
                      className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold flex items-center gap-0.5"
                    >
                      <Mail size={11} /> Preview Standard Email
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Recommended Procucev Pool in Mode 3 (Choose Maximum 5 out of 10) */}
            {selectedMode === 'mode_3' && (
              <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-gray-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-purple-50/70 dark:bg-purple-950/30 p-3.5 rounded-2xl border border-purple-200/60 dark:border-purple-900/50">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-xs uppercase font-black text-purple-900 dark:text-purple-200 tracking-wider flex items-center gap-1.5">
                        <ShieldCheck size={15} className="text-purple-600 dark:text-purple-400" />
                        Mode 3 Anonymous Double-Blind Sourcing: Choose Max 5 out of 10 Suppliers
                      </h4>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold transition-all ${
                        selectedMode3VendorIds.length === 5
                          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300'
                          : 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border border-purple-200'
                      }`}>
                        Selected: {selectedMode3VendorIds.length} / 5 Vendors
                      </span>
                    </div>
                    <p className="text-[11px] text-purple-800/80 dark:text-purple-300 mt-1">
                      Choose up to 5 verified suppliers. Click <strong>View Profile</strong> for factory specs & certifications. For unrated discovery suppliers, click <strong>Evaluate & Send RFQ</strong> to bundle a 360° qualification survey.
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleAutoSelectTop5}
                      className="btn btn-secondary btn-xs font-bold text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 flex items-center gap-1"
                    >
                      <Sparkles size={12} /> Auto-Select Top 5
                    </button>
                    <button
                      type="button"
                      onClick={handleClearMode3Selection}
                      className="btn btn-secondary btn-xs text-slate-600 dark:text-gray-400"
                    >
                      Reset (Top 1)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {RECOMMENDED_PROCUCEV_VENDORS.map((v) => {
                    const isSelected = selectedMode3VendorIds.includes(v.id);
                    const isUnrated = v.rating === null || v.isUnratedRecommendation;

                    return (
                      <div
                        key={v.id}
                        className={`p-4 rounded-2xl border-2 transition-all flex flex-col justify-between space-y-3 relative group ${
                          isSelected
                            ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-600 dark:border-indigo-500 shadow-sm'
                            : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                onClick={() => toggleMode3Vendor(v.id)}
                                className={`mt-0.5 p-1 rounded-md transition-colors ${
                                  isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'
                                }`}
                                title={isSelected ? 'Deselect vendor' : 'Select vendor (max 5)'}
                              >
                                {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                              </button>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setProfileVendor(v)}
                                  className="font-bold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline flex items-center gap-1.5 text-left"
                                >
                                  <span>{v.name}</span>
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40">
                                    {v.matchScore}% Match
                                  </span>
                                </button>
                                <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
                                  {v.brandName} · {v.location}
                                </div>
                              </div>
                            </div>

                            <span className="text-[9px] font-bold uppercase text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-full border border-purple-200/50 shrink-0">
                              360° Survey + RFQ
                            </span>
                          </div>

                          {/* Categories List */}
                          <div className="flex flex-wrap items-center gap-1 text-[10px] pl-6">
                            <span className="text-slate-400 font-semibold">{v.majorCategory}:</span>
                            {v.minorCategories.map((minor) => (
                              <span
                                key={minor}
                                className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 font-medium"
                              >
                                {minor}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Performance & Proximity Line */}
                        <div className="pt-2 border-t border-slate-100 dark:border-gray-800/80 flex items-center justify-between text-[11px] gap-2 flex-wrap pl-6">
                          <div className="flex items-center gap-2">
                            {!isUnrated ? (
                              <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <Star size={12} fill="currentColor" /> {v.rating} / 5.0 ({v.proximity})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 text-[10px] font-bold flex items-center gap-1">
                                <AlertCircle size={11} /> Rating: Not Available (New Recommendation)
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1">
                            🔒 Double-Blind Active
                          </span>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="pt-2 flex items-center justify-between gap-2 pl-6">
                          <button
                            type="button"
                            onClick={() => setProfileVendor(v)}
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-bold flex items-center gap-1 hover:underline"
                          >
                            <Eye size={12} /> View Vendor Profile
                          </button>

                          {isUnrated ? (
                            <button
                              type="button"
                              onClick={() => toggleMode3Vendor(v.id, true)}
                              className={`btn btn-xs font-bold flex items-center gap-1 ${
                                isSelected
                                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border-amber-300'
                                  : 'bg-amber-600 hover:bg-amber-700 text-white'
                              }`}
                            >
                              <FileCheck size={12} />
                              {isSelected ? '✓ Queued with 360° Evaluation' : '📋 Evaluate & Send RFQ'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleMode3Vendor(v.id)}
                              className={`btn btn-xs font-bold ${
                                isSelected
                                  ? 'btn-secondary text-indigo-700 dark:text-indigo-300 border-indigo-300'
                                  : 'btn-primary'
                              }`}
                            >
                              {isSelected ? `✓ Selected (${selectedMode3VendorIds.length}/5)` : '+ Select Vendor'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Dispatch Summary Box */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs space-y-2">
            <div className="flex items-center justify-between font-semibold flex-wrap gap-2">
              <span className="text-slate-700 dark:text-gray-300">Ready to Dispatch Standard RFQ Emails:</span>
              <span className="mono text-indigo-700 dark:text-indigo-300 font-bold">
                {selectedMode === 'mode_3'
                  ? `${rfqNumber} — ${entities.length} Categorized Items → ${selectedMode3VendorIds.length} Selected Mode 3 Suppliers (Max 5)`
                  : `${rfqNumber} — ${entities.length} Categorized Items → ${targetedPool.length} Suitable Vendors`}
              </span>
            </div>
            <p className="text-slate-500 dark:text-gray-400 text-[11px]">
              Upon dispatch, official Standard RFQ Emails with itemized BOQ specifications and SHA-256 digital seals will be transmitted to all chosen suppliers. Suppliers submit quotations by replying directly to the email without changing the subject line for automated AI ingestion.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
            <button onClick={() => setActiveStep(2)} className="btn btn-secondary btn-sm">
              Back to Review
            </button>
            <button onClick={handleDispatch} className="btn btn-primary btn-lg font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-2">
              <Send size={16} /> [ DISPATCH STANDARD RFQ EMAILS TO SUITABLE VENDORS ]
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR DATA MANAGEMENT SECTION (UPLOAD & CATEGORIZATION) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-panel rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 overflow-hidden">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400">
              <Users size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Buyer Vendor Data Management & Categorization
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">
                Upload or add vendor master data. All vendors are categorized into 13 Major and 280+ Minor Categories.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadSampleTemplate}
              className="btn btn-secondary btn-sm text-[11px] flex items-center gap-1 font-semibold"
              title="Download Excel/CSV Template with standard categories"
            >
              <Download size={12} /> Sample Template (.csv)
            </button>
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
                  <Plus size={14} /> Click to Add New Vendor & Categorize into Major & Minor Taxonomy
                </button>
              ) : (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                      <Building2 size={13} className="text-indigo-600 dark:text-indigo-400" /> New Vendor Registration & Categorization
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
                        value={newVendorName}
                        onChange={(e) => setNewVendorName(e.target.value)}
                        placeholder="e.g. Apex Supplies Ltd."
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Contact Person *</label>
                      <input
                        type="text"
                        value={newContactPerson}
                        onChange={(e) => setNewContactPerson(e.target.value)}
                        placeholder="e.g. Rajesh Nair"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Email Address *</label>
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="vendor@company.com"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Mobile / Phone</label>
                      <input
                        type="text"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        placeholder="+91 98201 44820"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Major Category *</label>
                      <select
                        value={newMajorCategory}
                        onChange={(e) => {
                          setNewMajorCategory(e.target.value);
                          const initialMinors = categoriesData.find(c => c.majorCategory === e.target.value)?.minorCategories || [];
                          setNewSelectedMinors(initialMinors.slice(0, 3));
                        }}
                        className="text-xs font-semibold"
                      >
                        {categoriesData.map((cat) => (
                          <option key={cat.majorCategory} value={cat.majorCategory}>
                            {cat.majorCategory}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-gray-400 font-medium mb-1">Operating Location</label>
                      <input
                        type="text"
                        value={newLocation}
                        onChange={(e) => setNewLocation(e.target.value)}
                        placeholder="Mumbai, MH"
                        className="text-xs"
                      />
                    </div>
                  </div>

                  {/* Minor Categories Selector for this Vendor */}
                  <div className="pt-2 border-t border-slate-200 dark:border-gray-800">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300">
                        Assign Minor Categories for {newMajorCategory} ({newSelectedMinors.length} selected)
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const allMinors = categoriesData.find(c => c.majorCategory === newMajorCategory)?.minorCategories || [];
                            setNewSelectedMinors(allMinors);
                          }}
                          className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewSelectedMinors([])}
                          className="text-[10px] text-slate-400 hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                      {(categoriesData.find(c => c.majorCategory === newMajorCategory)?.minorCategories || []).map((minor) => {
                        const isSelected = newSelectedMinors.includes(minor);
                        return (
                          <button
                            key={minor}
                            type="button"
                            onClick={() => handleToggleMinorSelection(minor)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 ${
                              isSelected
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200'
                            }`}
                          >
                            {isSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                            {minor}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
                    <button onClick={() => setShowVendorForm(false)} className="btn btn-secondary btn-sm text-[11px]">
                      Cancel
                    </button>
                    <button onClick={handleAddVendorSubmit} className="btn btn-primary btn-sm text-[11px] font-bold flex items-center gap-1">
                      <Plus size={12} /> Save & Categorize Vendor
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {isUploadingVendors ? (
                <div className="p-5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/40 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-xs">
                    <Sparkles size={14} className="animate-spin" /> Parsing vendor spreadsheet & categorizing into Major & Minor taxonomy...
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
                    [ Drag & Drop Vendor Master Spreadsheet Here ]
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">
                    Auto-categorizes rows into Major & Minor Categories (.xlsx, .xls, .csv).
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Categorized Vendor Hierarchy View ── */}
        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200">
                Buyer Vendor Master ({buyerVendors.length} Registered Vendors across Categories)
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search vendor or minor category..."
                  value={vendorSearch}
                  onChange={(e) => setVendorSearch(e.target.value)}
                  className="pl-7 pr-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-gray-800 w-48"
                />
              </div>
              <select
                value={selectedMajorFilter}
                onChange={(e) => setSelectedMajorFilter(e.target.value)}
                className="text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-gray-800"
              >
                <option value="ALL">All Major Categories</option>
                {categoriesData.map((c) => (
                  <option key={c.majorCategory} value={c.majorCategory}>
                    {c.majorCategory}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {groupedVendors.map((grp) => (
              <div
                key={grp.majorCategory}
                className="rounded-xl border border-slate-200 dark:border-gray-800 overflow-hidden bg-slate-50/50 dark:bg-gray-950/50"
              >
                {/* Major Category Header */}
                <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                      {grp.majorCategory}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white dark:bg-gray-800 text-indigo-700 dark:text-indigo-300 border border-slate-200 dark:border-gray-700">
                      {grp.vendors.length} vendor{grp.vendors.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Vendor Row Items */}
                <div className="divide-y divide-slate-100 dark:divide-gray-800">
                  {grp.vendors.map((v) => (
                    <div
                      key={v.id}
                      className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-white dark:hover:bg-gray-900/60 transition-colors text-xs border-b border-slate-100 dark:border-gray-800/80 last:border-0"
                    >
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 dark:text-white text-xs">{v.name}</span>
                          
                          {/* Database Availability Badge */}
                          {v.isExistingInDatabase ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/50 flex items-center gap-1">
                              <Building2 size={11} /> Existing in Procucev Database
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 flex items-center gap-1">
                              <Sparkles size={11} /> New Supplier (Onboarding Dispatched)
                            </span>
                          )}

                          {/* Onboarding Email Status */}
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200/40 flex items-center gap-1">
                            <Mail size={10} /> Email Sent ({v.tempPassword ? 'Temp Pass Active' : 'OTP Active'})
                          </span>

                          {/* 3-Day Reminder Cadence */}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200/50 flex items-center gap-1">
                            <Clock size={10} /> Every 3rd Day Reminders ({v.nextReminderDate || 'Next: Day 3'})
                          </span>

                          {/* Profile Completion */}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            v.profileCompletionStatus === 'completed'
                              ? 'bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300 border border-teal-200'
                              : 'bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {v.profileCompletionStatus === 'completed' ? '✓ Profile & Taxonomy Completed' : '⏳ Profile Update Pending'}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
                          <span>{v.contactPerson}</span>
                          <span>·</span>
                          <span className="font-mono text-slate-700 dark:text-gray-300 font-semibold">{v.email}</span>
                          <span>·</span>
                          <span>{v.phone}</span>
                          <span>·</span>
                          <span>{v.location}</span>
                        </div>

                        {/* Minor Categories */}
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <span className="text-[10px] text-slate-400 font-semibold">Minor Categories:</span>
                          {(v.minorCategories || []).map((minor) => (
                            <span
                              key={minor}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50"
                            >
                              {minor}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Right Action Controls */}
                      <div className="flex items-center gap-2 self-start lg:self-center shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-gray-800">
                        <button
                          type="button"
                          onClick={() => openOnboardingEmailModal(v)}
                          className="btn btn-secondary btn-xs font-bold text-indigo-600 dark:text-indigo-400 border-indigo-200 hover:border-indigo-400 flex items-center gap-1"
                          title="View dispatched onboarding email, username, temporary password and OTP instructions"
                        >
                          <Mail size={11} /> View Email & Credentials
                        </button>

                        <button
                          type="button"
                          onClick={() => triggerVendorReminder(v.id)}
                          className="btn btn-secondary btn-xs font-bold text-amber-700 dark:text-amber-300 border-amber-200 hover:border-amber-400 flex items-center gap-1"
                          title="Simulate sending the automated Day 3 profile update reminder email"
                        >
                          <Clock size={11} /> Simulate Day 3 Reminder
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteBuyerVendor(v.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          title="Delete vendor"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {groupedVendors.length === 0 && (
              <div className="text-center py-8 text-xs text-slate-400 dark:text-gray-500">
                <Users size={24} className="mx-auto mb-2 opacity-40" />
                No vendors found matching search criteria.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR PROFILE POPUP MODAL (MODE 3 DOUBLE-BLIND PROFILE) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {profileVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-2xl space-y-5 animate-scale-up">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-purple-600/10 dark:bg-purple-400/10 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                  <Building2 size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">
                      {profileVendor.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40">
                      {profileVendor.matchScore}% AI Match
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    {profileVendor.brandName} · {profileVendor.location} · {profileVendor.proximity}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileVendor(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Double Blind Notice */}
            <div className="p-3 rounded-xl bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 text-[11px] text-purple-900 dark:text-purple-200 flex items-center gap-2">
              <ShieldCheck size={16} className="text-purple-600 shrink-0" />
              <span>
                <strong>Mode 3 Double-Blind Verification:</strong> Verified enterprise partner from the Procucev Network Database. Evaluation surveys and RFQs are transmitted anonymously under standard compliance seals.
              </span>
            </div>

            {/* Rating / Unrated Evaluation Banner */}
            {profileVendor.rating !== null ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 text-center">
                  <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400 block">Performance Rating</span>
                  <span className="text-base font-black text-amber-900 dark:text-amber-200 flex items-center justify-center gap-1 mt-0.5">
                    <Star size={14} fill="currentColor" className="text-amber-500" /> {profileVendor.rating} / 5.0
                  </span>
                  <span className="text-[10px] text-slate-400">({profileVendor.ratingCount} Orders Fulfilled)</span>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 text-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 block">OTIF Delivery SLA</span>
                  <span className="text-base font-black text-emerald-900 dark:text-emerald-200 mt-0.5 block">
                    {profileVendor.otifRate}
                  </span>
                  <span className="text-[10px] text-slate-400">Audited Transit SLA</span>
                </div>
                <div className="p-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/60 text-center">
                  <span className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-400 block">Quality Defect Rate</span>
                  <span className="text-base font-black text-indigo-900 dark:text-indigo-200 mt-0.5 block">
                    {profileVendor.qualityPpm}
                  </span>
                  <span className="text-[10px] text-slate-400">PPM Non-Conformance</span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                  <AlertCircle size={16} />
                  <span>Rating: Not Available (Newly Recommended Discovery Supplier)</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-700 dark:text-gray-300">
                  This supplier is algorithmically recommended based on high minor category compatibility and factory capability match. Selecting this vendor will bundle the <strong>360-Degree Double-Blind Qualification Survey</strong> alongside the RFQ, evaluating commercial, technical, and quality parameters to establish their baseline rating.
                </p>
              </div>
            )}

            {/* AI Recommendation Rationale */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-gray-800/40 border border-slate-200 dark:border-gray-800 text-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                <Sparkles size={12} className="text-indigo-600 dark:text-indigo-400" /> Why AI Recommends This Vendor:
              </span>
              <p className="text-xs text-slate-800 dark:text-gray-200 leading-relaxed font-medium">
                {profileVendor.recommendationReason}
              </p>
            </div>

            {/* Technical Specifications & Capabilities */}
            <div className="space-y-2 text-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Factory & Operational Specifications</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-150 dark:border-gray-800">
                  <span className="text-[9px] text-slate-400 font-semibold block">Established</span>
                  <span className="font-bold text-slate-800 dark:text-white">{profileVendor.establishedYear}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-150 dark:border-gray-800">
                  <span className="text-[9px] text-slate-400 font-semibold block">Turnover</span>
                  <span className="font-bold text-slate-800 dark:text-white">{profileVendor.annualTurnover}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-150 dark:border-gray-800 col-span-2">
                  <span className="text-[9px] text-slate-400 font-semibold block">Monthly Plant Capacity</span>
                  <span className="font-bold text-slate-800 dark:text-white truncate block">{profileVendor.plantCapacity}</span>
                </div>
              </div>
            </div>

            {/* Key Machinery */}
            <div className="space-y-1.5 text-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Key Machinery & Infrastructure</span>
              <div className="flex flex-wrap gap-1.5">
                {profileVendor.keyMachinery.map((mach, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-gray-800 text-slate-800 dark:text-gray-200 text-[11px] font-medium border border-slate-200 dark:border-gray-700"
                  >
                    ⚙️ {mach}
                  </span>
                ))}
              </div>
            </div>

            {/* Taxonomy & Certifications */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Minor Categories Scope</span>
                <div className="flex flex-wrap gap-1">
                  {profileVendor.minorCategories.map((minor) => (
                    <span
                      key={minor}
                      className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold border border-indigo-200/50"
                    >
                      {minor}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Certifications & Quality Accreditations</span>
                <div className="flex flex-wrap gap-1">
                  {profileVendor.certifications.map((cert) => (
                    <span
                      key={cert}
                      className="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold border border-emerald-200/50 flex items-center gap-1"
                    >
                      <Check size={10} /> {cert}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Statutory Identity */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex items-center justify-between text-xs flex-wrap gap-2">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold block">GSTIN Identity</span>
                <span className="mono font-bold text-slate-700 dark:text-gray-300">{profileVendor.gstin}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-semibold block">PAN Number</span>
                <span className="mono text-slate-600 dark:text-gray-400">{profileVendor.panNumber}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-semibold block">Official Contact</span>
                <span className="text-slate-600 dark:text-gray-400">{profileVendor.contactPerson} ({profileVendor.phone})</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-gray-800 gap-2">
              <button
                type="button"
                onClick={() => setProfileVendor(null)}
                className="btn btn-secondary btn-sm"
              >
                Close Profile
              </button>

              {selectedMode3VendorIds.includes(profileVendor.id) ? (
                <button
                  type="button"
                  onClick={() => {
                    toggleMode3Vendor(profileVendor.id);
                    setProfileVendor(null);
                  }}
                  className="btn btn-secondary btn-sm font-bold text-rose-600 dark:text-rose-400 border-rose-200 hover:bg-rose-50"
                >
                  Remove from Dispatch List
                </button>
              ) : profileVendor.rating === null || profileVendor.isUnratedRecommendation ? (
                <button
                  type="button"
                  onClick={() => {
                    toggleMode3Vendor(profileVendor.id, true);
                    setProfileVendor(null);
                  }}
                  className="btn btn-primary btn-sm font-bold bg-amber-600 hover:bg-amber-700 text-white border-amber-600 flex items-center gap-1.5"
                >
                  <FileCheck size={14} /> 📋 Select with 360° Evaluation & Send RFQ ({selectedMode3VendorIds.length}/5)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    toggleMode3Vendor(profileVendor.id);
                    setProfileVendor(null);
                  }}
                  className="btn btn-primary btn-sm font-bold"
                >
                  ✓ Select Vendor for RFQ ({selectedMode3VendorIds.length}/5)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR ONBOARDING EMAIL & CREDENTIALS PREVIEW MODAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {onboardingEmailModalOpen && selectedOnboardingEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-2xl space-y-5 animate-scale-up">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-indigo-600/10 dark:bg-indigo-400/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                  <Mail size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                      Official Vendor Onboarding Invitation & Credentials
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200">
                      Dispatched & Active
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    Transmitted to {selectedOnboardingEmail.vendorName} ({selectedOnboardingEmail.recipientEmail})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOnboardingEmailModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Status Callout Banner */}
            {selectedOnboardingEmail.isExistingInDatabase ? (
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2.5">
                <Building2 size={18} className="text-emerald-600 shrink-0" />
                <div>
                  <strong>Existing Database Supplier Association:</strong> This vendor was identified in the Procucev platform master database. A network association email was dispatched confirming inclusion in {selectedOnboardingEmail.buyerCompanyName}&apos;s preferred vendor network.
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-xs text-indigo-900 dark:text-indigo-200 flex items-center gap-2.5">
                <Sparkles size={18} className="text-indigo-600 shrink-0" />
                <div>
                  <strong>New Discovery Supplier Onboarding:</strong> This vendor was not previously in the database. A welcome invitation email with first-time login credentials has been dispatched.
                </div>
              </div>
            )}

            {/* Email Metadata Grid */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 text-xs space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">From (Buyer Desk):</span>
                  <span className="font-semibold text-slate-800 dark:text-white">
                    {selectedOnboardingEmail.buyerContactName} ({selectedOnboardingEmail.buyerCompanyName})
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono block">{selectedOnboardingEmail.buyerContactEmail}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">To (Vendor Contact):</span>
                  <span className="font-semibold text-slate-800 dark:text-white">
                    {selectedOnboardingEmail.contactPerson} ({selectedOnboardingEmail.vendorName})
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono block">{selectedOnboardingEmail.recipientEmail}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-gray-700/60">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Email Subject:</span>
                <span className="font-bold text-slate-900 dark:text-white text-xs">{selectedOnboardingEmail.subject}</span>
              </div>
            </div>

            {/* Login Credentials Box */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/80 dark:from-gray-900 dark:via-gray-850 dark:to-purple-950/30 border-2 border-indigo-300 dark:border-indigo-700 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-indigo-900 dark:text-indigo-300 tracking-wider flex items-center gap-1.5">
                  <ShieldCheck size={16} className="text-indigo-600" />
                  Vendor Portal Access Credentials
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200">
                  Dual-Factor Ready
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">User Name (Login ID)</span>
                  <span className="font-mono text-sm font-black text-indigo-700 dark:text-indigo-300 select-all block mt-0.5">
                    {selectedOnboardingEmail.username}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1 block">Registered Email Address</span>
                </div>

                <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">First-Time Temporary Password</span>
                  <span className="font-mono text-sm font-black text-emerald-700 dark:text-emerald-300 select-all block mt-0.5">
                    {selectedOnboardingEmail.tempPassword}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1 block">Used for First-Time Authentication</span>
                </div>
              </div>

              {/* Subsequent Login Mechanics Note */}
              <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                  <AlertCircle size={13} />
                  Authentication Protocol:
                </div>
                <p className="leading-relaxed">
                  <strong>First-Time Login:</strong> Sign in with User Name (Email ID) and the First-Time Temporary Password.
                  <br />
                  <strong>Subsequent Logins:</strong> After your initial login, you can log in anytime using your <strong>User Name (Email ID) and a 4-digit One-Time OTP</strong> dispatched directly to your email inbox without needing to remember a password.
                </p>
              </div>
            </div>

            {/* Highlighted Buyer-Assigned Categories Banner vs Unmapped Self-Service Banner */}
            {selectedOnboardingEmail.categoriesMappedByBuyer === false ? (
              <div className="p-4 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-700/80 text-xs space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-amber-950 dark:text-amber-200 tracking-wider flex items-center gap-1.5">
                    <AlertCircle size={15} className="text-amber-600 dark:text-amber-400" />
                    ⚠️ Unmapped Categories (Self-Mapping Mandate)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                    Highlighted in Dispatched Email
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-900/60 space-y-1.5">
                  <p className="font-bold text-slate-800 dark:text-gray-200 leading-relaxed text-[11px]">
                    &quot;The buyer ({selectedOnboardingEmail.buyerCompanyName}) didn&apos;t map any categories for you because no historical PO records were found in their purchase dump, so please map yourself in order to receive enquiries.&quot;
                  </p>
                  <p className="text-[10px] text-amber-800 dark:text-amber-300 font-semibold">
                    → Upon logging in with your temporary credentials, navigate to the Vendor Profile tab to map your business across 13 Major and 280+ Minor Categories.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-indigo-50/90 dark:bg-indigo-950/50 border-2 border-indigo-300 dark:border-indigo-700/80 text-xs space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-indigo-950 dark:text-indigo-200 tracking-wider flex items-center gap-1.5">
                    <Tag size={15} className="text-indigo-600 dark:text-indigo-400" />
                    ⭐ Categories Assigned by Buyer (Purchase History Mapping)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-indigo-100">
                    Highlighted in Dispatch Email
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-indigo-100 dark:border-indigo-900/60 space-y-1">
                    <span className="text-[9px] uppercase font-black text-indigo-600 dark:text-indigo-400 block">
                      1st Set: Primary Major Category
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white text-xs block">
                      {selectedOnboardingEmail.assignedMajorCategory || 'Engineering Spares - Mechanical'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-indigo-100 dark:border-indigo-900/60 space-y-1">
                    <span className="text-[9px] uppercase font-black text-purple-600 dark:text-purple-400 block">
                      2nd Set: Minor Categories & Product Lines
                    </span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {(selectedOnboardingEmail.assignedMinorCategories || ['Pumps & Accessories', 'Valves & Fittings']).map((m) => (
                        <span
                          key={m}
                          className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 text-[10px] font-semibold border border-purple-200/50"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-slate-500 dark:text-gray-400 italic">
                  * Vendor will be prompted upon first login to verify these pre-mapped categories or expand their catalog across 280+ minor categories.
                </p>
              </div>
            )}

            {/* Profile & Category Update Mandate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-gray-800/40 border border-slate-200 dark:border-gray-800 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block flex items-center gap-1">
                  <Building2 size={12} className="text-indigo-600" /> Enterprise Profile Update
                </span>
                <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
                  {selectedOnboardingEmail.profileUpdateInstructions}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-gray-800/40 border border-slate-200 dark:border-gray-800 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block flex items-center gap-1">
                  <Tag size={12} className="text-purple-600" /> Category Taxonomy Mandate
                </span>
                <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
                  {selectedOnboardingEmail.categoryUpdateInstructions}
                </p>
              </div>
            </div>

            {/* Recurring 3-Day Reminder Schedule */}
            <div className="p-3.5 rounded-2xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-800/60 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="font-bold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                  <Clock size={14} className="text-purple-600" />
                  Automated Reminder Pipeline: Every 3rd Day
                </span>
                <p className="text-[11px] text-purple-800/80 dark:text-purple-300">
                  Scheduled to send follow-up notifications every 3rd day until profile completion is verified.
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold block">Next Trigger:</span>
                <span className="mono font-black text-purple-900 dark:text-white text-xs">{selectedOnboardingEmail.nextReminderDate}</span>
              </div>
            </div>

            {/* SHA-256 Digital Verification Seal */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex items-center justify-between text-[10px] text-slate-400">
              <span>Cryptographic Seal: <strong className="mono text-slate-600 dark:text-gray-400">{selectedOnboardingEmail.shaSignature.substring(0, 24)}...</strong></span>
              <span>Portal: <strong className="text-indigo-600">http://localhost:3000</strong></span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-gray-800 gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`User: ${selectedOnboardingEmail.username} | Password: ${selectedOnboardingEmail.tempPassword}`);
                  showToast('Credentials Copied', `Copied login details for ${selectedOnboardingEmail.vendorName} to clipboard.`, 'success');
                }}
                className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400"
              >
                📋 Copy Login Credentials
              </button>

              <button
                type="button"
                onClick={() => setOnboardingEmailModalOpen(false)}
                className="btn btn-primary btn-sm font-bold"
              >
                Close Email Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
