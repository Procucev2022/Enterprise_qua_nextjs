'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { User, Phone, Mail, MapPin, Building2, ShieldCheck } from 'lucide-react';

interface CompanyContact {
  companyName: string;
  type: 'buyer' | 'vendor';
  contactPerson: string;
  designation: string;
  mobile: string;
  email: string;
  location: string;
  gstin?: string;
}

const COMPANY_CONTACTS_DB: Record<string, CompanyContact> = {
  // Buyer Companies
  'Larsen & Toubro Ltd.': {
    companyName: 'Larsen & Toubro Ltd.',
    type: 'buyer',
    contactPerson: 'Rajesh Sharma',
    designation: 'Head of Strategic Procurement',
    mobile: '+91 98201 44820',
    email: 'rajesh.sharma@lntecc.com',
    location: 'L&T House, Powai, Mumbai, Maharashtra',
    gstin: '27AAACL1234F1Z5',
  },
  'Larsen & Toubro Limited': {
    companyName: 'Larsen & Toubro Limited',
    type: 'buyer',
    contactPerson: 'Rajesh Sharma',
    designation: 'Head of Strategic Procurement',
    mobile: '+91 98201 44820',
    email: 'rajesh.sharma@lntecc.com',
    location: 'L&T House, Powai, Mumbai, Maharashtra',
    gstin: '27AAACL1234F1Z5',
  },
  'Tata Projects Ltd.': {
    companyName: 'Tata Projects Ltd.',
    type: 'buyer',
    contactPerson: 'Vikram Malhotra',
    designation: 'VP - Supply Chain & Contracts',
    mobile: '+91 98190 11223',
    email: 'vmalhotra@tataprojects.com',
    location: 'Mithona Towers, Secunderabad, Telangana',
    gstin: '36AAACT9876K1Z9',
  },
  'Reliance Industries': {
    companyName: 'Reliance Industries',
    type: 'buyer',
    contactPerson: 'Anil Deshmukh',
    designation: 'Chief Procurement Officer',
    mobile: '+91 98210 55443',
    email: 'anil.deshmukh@ril.com',
    location: 'Maker Chambers IV, Nariman Point, Mumbai',
    gstin: '27AAACR5544E1Z2',
  },
  'Shapoorji Pallonji': {
    companyName: 'Shapoorji Pallonji',
    type: 'buyer',
    contactPerson: 'Sandeep Varma',
    designation: 'General Manager Sourcing',
    mobile: '+91 98200 33441',
    email: 'sandeep.varma@shapoorji.com',
    location: 'SP Centre, Colaba, Mumbai, Maharashtra',
    gstin: '27AAACS1122D1Z8',
  },
  'Hindustan Unilever': {
    companyName: 'Hindustan Unilever',
    type: 'buyer',
    contactPerson: 'Pooja Hegde',
    designation: 'Lead Packaging Buyer',
    mobile: '+91 98330 77889',
    email: 'pooja.hegde@unilever.com',
    location: 'Unilever House, Andheri East, Mumbai',
    gstin: '27AAACH1111A1Z0',
  },

  // Vendor Companies
  'Apex Supplies Ltd.': {
    companyName: 'Apex Supplies Ltd.',
    type: 'vendor',
    contactPerson: 'Srinivas Rao',
    designation: 'Key Account Manager & Sales Director',
    mobile: '+91 98450 12345',
    email: 'srinivas.rao@apexsupplies.in',
    location: 'Peenya Industrial Estate, Bengaluru, Karnataka',
    gstin: '29AAACA9988H1Z4',
  },
  'WPIL Pumps Ltd.': {
    companyName: 'WPIL Pumps Ltd.',
    type: 'vendor',
    contactPerson: 'Amitabh Sen',
    designation: 'Senior Sales Manager - Industrial Pumps',
    mobile: '+91 98310 99887',
    email: 'asen@wpil.co.in',
    location: 'Trinity Tower, Kolkata, West Bengal',
    gstin: '19AAACW7766F1Z1',
  },
  'Kirloskar Brothers': {
    companyName: 'Kirloskar Brothers',
    type: 'vendor',
    contactPerson: 'Milind Kulkarni',
    designation: 'National Accounts Lead',
    mobile: '+91 98220 44556',
    email: 'milind.kulkarni@kirloskar.com',
    location: 'Yamuna, Pune, Maharashtra',
    gstin: '27AAACK3344J1Z7',
  },
  'Havells Switchgear': {
    companyName: 'Havells Switchgear',
    type: 'vendor',
    contactPerson: 'Rohan Kapoor',
    designation: 'Enterprise Sales Head - Electrical',
    mobile: '+91 98110 66778',
    email: 'rohan.kapoor@havells.com',
    location: 'QRG Towers, Noida, Uttar Pradesh',
    gstin: '09AAACH4455L1Z3',
  },
  'ABB India': {
    companyName: 'ABB India',
    type: 'vendor',
    contactPerson: 'Devendra Patel',
    designation: 'Automation Solutions Lead',
    mobile: '+91 98440 22334',
    email: 'devendra.patel@abb.com',
    location: 'Electronics City, Bengaluru, Karnataka',
    gstin: '29AAACA1122M1Z6',
  },
  'Siemens Spares': {
    companyName: 'Siemens Spares',
    type: 'vendor',
    contactPerson: 'Karan Mehra',
    designation: 'Product Specialist - Drives & Spares',
    mobile: '+91 98204 88776',
    email: 'karan.mehra@siemens.com',
    location: 'Worli, Mumbai, Maharashtra',
    gstin: '27AAACS8899B1Z0',
  },
  'Hindustan Precast': {
    companyName: 'Hindustan Precast',
    type: 'vendor',
    contactPerson: 'Vijay Kumar',
    designation: 'Works & Sales Manager',
    mobile: '+91 98990 12389',
    email: 'vijay@hindustanprecast.com',
    location: 'GIDC Industrial Area, Vadodara, Gujarat',
    gstin: '24AAACH7788P1Z9',
  },
};

// Generate deterministic realistic fallback details for any non-mapped company
function getCompanyContact(name: string, defaultType: 'buyer' | 'vendor' = 'vendor'): CompanyContact {
  const cleanName = name ? name.trim() : 'Enterprise Partner';
  if (COMPANY_CONTACTS_DB[cleanName]) {
    return COMPANY_CONTACTS_DB[cleanName];
  }

  // Derive realistic contact person from name hash
  const sampleFirst = ['Amit', 'Rajesh', 'Srinivas', 'Vikram', 'Pooja', 'Sandeep', 'Anil', 'Karan', 'Sunil', 'Manish'];
  const sampleLast = ['Kumar', 'Sharma', 'Rao', 'Verma', 'Patel', 'Deshmukh', 'Mehra', 'Sen', 'Kulkarni', 'Singh'];
  
  let hash = 0;
  for (let i = 0; i < cleanName.length; i++) {
    hash = (hash << 5) - hash + cleanName.charCodeAt(i);
    hash |= 0;
  }
  const posHash = Math.abs(hash);

  const first = sampleFirst[posHash % sampleFirst.length];
  const last = sampleLast[(posHash >> 2) % sampleLast.length];
  const contactPerson = `${first} ${last}`;

  const designation = defaultType === 'buyer' ? 'Lead Procurement Manager' : 'Key Account Manager';
  const mobileNum = `+91 9${String(posHash).slice(0, 4).padEnd(4, '8')} ${String(posHash).slice(4, 9).padEnd(5, '2')}`;
  
  const cleanDomain = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = `${first.toLowerCase()}.${last.toLowerCase()}@${cleanDomain || 'company'}.com`;

  const cities = ['Mumbai, Maharashtra', 'Bengaluru, Karnataka', 'Noida, Uttar Pradesh', 'Pune, Maharashtra', 'Ahmedabad, Gujarat', 'Chennai, Tamil Nadu'];
  const location = `${cities[posHash % cities.length]}`;

  return {
    companyName: cleanName,
    type: defaultType,
    contactPerson,
    designation,
    mobile: mobileNum,
    email,
    location,
    gstin: `27AAAC${String(posHash).slice(0, 4)}A1Z${posHash % 9}`,
  };
}

interface CompanyHoverTooltipProps {
  name: string;
  type?: 'buyer' | 'vendor';
  children?: React.ReactNode;
  className?: string;
}

export default function CompanyHoverTooltip({
  name,
  type = 'vendor',
  children,
  className = '',
}: CompanyHoverTooltipProps) {
  const { currentRole } = useApp();
  const [isHovered, setIsHovered] = useState(false);
  const contact = getCompanyContact(name, type);

  // Strictly enforce hover contact card visibility ONLY for Category Manager role
  if (currentRole !== 'category_manager') {
    return <span className={className}>{children || name}</span>;
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className={`cursor-pointer underline decoration-dotted decoration-indigo-300 dark:decoration-indigo-600 underline-offset-2 font-semibold hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors ${className}`}>
        {children || name}
      </span>

      {/* Floating Hover Card */}
      {isHovered && (
        <div className="absolute z-[9999] top-full left-0 mt-2 w-72 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl p-4 animate-fade-in text-left pointer-events-none">
          {/* Tail Triangle Arrow (pointing up) */}
          <div className="absolute bottom-full left-6 -mb-[1px] border-8 border-transparent border-b-white dark:border-b-gray-900" />

          {/* Top Header */}
          <div className="flex items-start justify-between border-b border-slate-100 dark:border-gray-800 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${contact.type === 'buyer' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                <Building2 size={14} />
              </div>
              <div>
                <h4 className="text-xs font-black text-slate-900 dark:text-white leading-tight">
                  {contact.companyName}
                </h4>
                <span className={`text-[9px] font-mono font-bold uppercase ${contact.type === 'buyer' ? 'text-indigo-600 dark:text-indigo-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {contact.type === 'buyer' ? 'Enterprise Buyer' : 'Verified Supplier'}
                </span>
              </div>
            </div>
            <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 shrink-0">
              <ShieldCheck size={10} /> Verified
            </span>
          </div>

          {/* Contact Details */}
          <div className="space-y-2 text-xs">
            {/* Person Name */}
            <div className="flex items-center gap-2 text-slate-800 dark:text-gray-200 font-bold">
              <User size={13} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div>
                <span className="text-xs block">{contact.contactPerson}</span>
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-normal block">{contact.designation}</span>
              </div>
            </div>

            {/* Mobile */}
            <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300 text-[11px] font-mono">
              <Phone size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{contact.mobile}</span>
            </div>

            {/* Email */}
            <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300 text-[11px] font-mono">
              <Mail size={13} className="text-sky-600 dark:text-cyan-400 shrink-0" />
              <span className="truncate">{contact.email}</span>
            </div>

            {/* Location */}
            <div className="flex items-center gap-2 text-slate-500 dark:text-gray-400 text-[10px]">
              <MapPin size={13} className="text-rose-500 shrink-0" />
              <span className="truncate">{contact.location}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
