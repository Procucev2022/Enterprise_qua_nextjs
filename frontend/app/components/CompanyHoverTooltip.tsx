'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { User, Phone, Mail, MapPin, Building2, ShieldCheck } from 'lucide-react';

// Real per-company contact details the caller already has from an actual
// backend record (a VendorEntry, BuyerAccount, or VendorEvaluationRecord) —
// this component never fabricates them itself. This used to hardcode a
// lookup table of specific names/phone numbers/emails/GSTINs for real named
// companies (L&T, Reliance, Tata Projects, Siemens, ABB, etc.) plus a
// deterministic-hash generator for anything else, all shown behind an
// unconditional "✓ Verified" badge — presenting entirely made-up personal
// and business data as verified fact for real organizations.
export interface CompanyContactInfo {
  contactPerson?: string;
  designation?: string;
  mobile?: string;
  email?: string;
  location?: string;
  verified?: boolean;
}

interface CompanyHoverTooltipProps {
  name: string;
  type?: 'buyer' | 'vendor';
  contact?: CompanyContactInfo;
  children?: React.ReactNode;
  className?: string;
}

export default function CompanyHoverTooltip({
  name,
  type = 'vendor',
  contact,
  children,
  className = '',
}: CompanyHoverTooltipProps) {
  const { currentRole } = useApp();
  const [isHovered, setIsHovered] = useState(false);
  const displayName = name && name.trim() ? name.trim() : 'Enterprise Partner';
  const hasContactDetails = !!(contact?.contactPerson || contact?.mobile || contact?.email);

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
              <div className={`p-1.5 rounded-lg ${type === 'buyer' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                <Building2 size={14} />
              </div>
              <div>
                <h4 className="text-xs font-black text-slate-900 dark:text-white leading-tight">
                  {displayName}
                </h4>
                <span className={`text-[9px] font-mono font-bold uppercase ${type === 'buyer' ? 'text-indigo-600 dark:text-indigo-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {type === 'buyer' ? 'Enterprise Buyer' : 'Supplier'}
                </span>
              </div>
            </div>
            {contact?.verified && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 shrink-0">
                <ShieldCheck size={10} /> Verified
              </span>
            )}
          </div>

          {/* Contact Details */}
          {hasContactDetails ? (
            <div className="space-y-2 text-xs">
              {contact?.contactPerson && (
                <div className="flex items-center gap-2 text-slate-800 dark:text-gray-200 font-bold">
                  <User size={13} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <div>
                    <span className="text-xs block">{contact.contactPerson}</span>
                    {contact.designation && (
                      <span className="text-[10px] text-slate-400 dark:text-gray-400 font-normal block">{contact.designation}</span>
                    )}
                  </div>
                </div>
              )}

              {contact?.mobile && (
                <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300 text-[11px] font-mono">
                  <Phone size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{contact.mobile}</span>
                </div>
              )}

              {contact?.email && (
                <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300 text-[11px] font-mono">
                  <Mail size={13} className="text-sky-600 dark:text-cyan-400 shrink-0" />
                  <span className="truncate">{contact.email}</span>
                </div>
              )}

              {contact?.location && (
                <div className="flex items-center gap-2 text-slate-500 dark:text-gray-400 text-[10px]">
                  <MapPin size={13} className="text-rose-500 shrink-0" />
                  <span className="truncate">{contact.location}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 dark:text-gray-500 italic py-1">
              No contact details on file for this company.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
