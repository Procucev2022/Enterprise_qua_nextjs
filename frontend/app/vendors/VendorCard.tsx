'use client';

import React from 'react';
import type { PublicVendor } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import { Layers, MapPin, BadgeCheck, ShieldCheck } from 'lucide-react';
import { avatarForName, getInitials, renderStars } from './vendorUtils';

const S = UI_STRINGS.publicVendorDirectory;

interface VendorCardProps {
  vendor: PublicVendor;
  onViewDetails: (vendor: PublicVendor) => void;
}

export default function VendorCard({ vendor, onViewDetails }: VendorCardProps) {
  const pal = avatarForName(vendor.name);

  return (
    <article
      className="group relative flex flex-col bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/60 rounded-2xl shadow-sm hover:shadow-lg dark:hover:shadow-slate-900/60 hover:border-blue-300 dark:hover:border-blue-700/80 transition-all duration-200 overflow-hidden cursor-pointer"
      onClick={() => onViewDetails(vendor)}
      tabIndex={0}
      role="button"
      aria-label={`View profile for ${vendor.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onViewDetails(vendor);
        }
      }}
    >
      {/* Top gradient accent */}
      <div className={`h-1.5 w-full bg-gradient-to-r ${pal.bg}`} />

      <div className="flex flex-col gap-3 p-5 flex-1">
        {/* Avatar + name */}
        <div className="flex items-start gap-3">
          <div
            className={`shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${pal.bg} flex items-center justify-center text-white font-bold text-sm ring-2 ${pal.ring}`}
          >
            {getInitials(vendor.name)}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug line-clamp-2 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
              {vendor.name}
            </h3>
            {vendor.brandName && vendor.brandName !== vendor.name && (
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{vendor.brandName}</p>
            )}
          </div>
        </div>

        {/* Major category badge */}
        {vendor.majorCategory && (
          <span className="inline-flex items-center gap-1 self-start px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 text-xs font-medium">
            <Layers size={10} />
            {vendor.majorCategory}
          </span>
        )}

        {/* Location */}
        {(vendor.city || vendor.state || vendor.location) && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <MapPin size={11} className="shrink-0 text-slate-400" />
            <span className="truncate">
              {[vendor.city, vendor.state].filter(Boolean).join(', ') || vendor.location}
            </span>
          </div>
        )}

        {/* Rating */}
        {(vendor.rating ?? 0) > 0 && (
          <div className="mt-auto">{renderStars(vendor.rating)}</div>
        )}

        {/* Badges row */}
        <div className="flex items-center flex-wrap gap-1.5 mt-auto pt-2 border-t border-slate-100 dark:border-slate-800">
          {vendor.isVerified && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 text-[10px] font-semibold">
              <BadgeCheck size={9} /> {S.labels.verified}
            </span>
          )}
          {vendor.isProcucevNetwork && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/60 text-[10px] font-semibold">
              <ShieldCheck size={9} /> Procucev
            </span>
          )}
        </div>
      </div>

      {/* View CTA */}
      <button
        id={`view-vendor-${vendor.id ?? vendor.name}`}
        className="w-full py-2.5 text-xs font-semibold text-blue-700 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors border-t border-blue-100 dark:border-blue-900/60"
        onClick={(e) => {
          e.stopPropagation();
          onViewDetails(vendor);
        }}
        tabIndex={-1}
      >
        {S.viewDetailsButton} →
      </button>
    </article>
  );
}
