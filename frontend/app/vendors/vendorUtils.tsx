import React from 'react';
import { Star } from 'lucide-react';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { PublicVendorFilterState } from '@/lib/types';

const S = UI_STRINGS.publicVendorDirectory;

export const AVATAR_PALETTE = [
  { bg: 'from-blue-600 to-cyan-500', ring: 'ring-blue-300 dark:ring-blue-700' },
  { bg: 'from-emerald-600 to-teal-500', ring: 'ring-emerald-300 dark:ring-emerald-700' },
  { bg: 'from-violet-600 to-purple-500', ring: 'ring-violet-300 dark:ring-violet-700' },
  { bg: 'from-orange-500 to-amber-400', ring: 'ring-orange-300 dark:ring-orange-700' },
  { bg: 'from-rose-600 to-pink-500', ring: 'ring-rose-300 dark:ring-rose-700' },
  { bg: 'from-sky-600 to-indigo-500', ring: 'ring-sky-300 dark:ring-sky-700' },
];

export function avatarForName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function getInitials(name: string): string {
  if (!name || !name.trim()) return '??';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

export function renderStars(rating: number | null | undefined): React.ReactNode {
  const r = Math.round((rating ?? 0) * 2) / 2;
  return (
    <span className="flex items-center gap-0.5" aria-label={formatString(S.labels.ratingStars, { rating: r })}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={13}
          className={
            r >= star
              ? 'text-amber-400 fill-amber-400'
              : r >= star - 0.5
              ? 'text-amber-400 fill-amber-200'
              : 'text-slate-300 dark:text-slate-600'
          }
        />
      ))}
      {r > 0 && (
        <span className="ml-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
          {r.toFixed(1)}
        </span>
      )}
    </span>
  );
}

export const DEFAULT_FILTER: PublicVendorFilterState = {
  search: '',
  category: 'all',
  state: 'all',
  minRating: 0,
  verifiedOnly: false,
  page: 1,
  pageSize: 24,
};

export const MAJOR_CATEGORIES = [
  'All Categories',
  'Mechanical',
  'Electrical',
  'Civil & Construction',
  'IT & Software',
  'Chemical & Petrochemical',
  'Automotive',
  'Electronics',
  'FMCG & Consumer',
  'Packaging',
  'Textile & Garments',
  'Metals & Alloys',
  'Medical & Pharma',
  'Logistics & Warehousing',
  'Safety & Security',
  'Office & Stationery',
  'Furniture & Fixtures',
  'Agriculture & Food',
  'Energy & Power',
  'Oil & Gas',
  'Mining & Minerals',
  'General Industrial',
];

/**
 * Masks an email for public display (e.g. "sXXXX@gmail.com" or "mXXXX@japl.org").
 */
export function maskPublicEmail(email?: string | null): string {
  if (!email || typeof email !== 'string') return '';
  const trimmed = email.trim();
  if (trimmed.includes('XXXX')) return trimmed;
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return trimmed;
  const username = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  return `${username.charAt(0)}XXXX${domain}`;
}

/**
 * Masks a phone number for public display (e.g. "9XXXXXXX09").
 */
export function maskPublicPhone(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (trimmed.includes('XXXX')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4) return trimmed;

  let prefix = '';
  let national = digits;
  if (trimmed.startsWith('+91') || (digits.length === 12 && digits.startsWith('91'))) {
    prefix = '+91 ';
    national = digits.slice(-10);
  } else if (trimmed.startsWith('+')) {
    prefix = '+ ';
    national = digits.slice(-10);
  } else if (digits.length > 10) {
    national = digits.slice(-10);
  }

  const firstDigit = national.charAt(0);
  const lastTwo = national.slice(-2);
  const maskLength = Math.max(1, national.length - 3);
  const maskedMiddle = 'X'.repeat(maskLength);
  return `${prefix}${firstDigit}${maskedMiddle}${lastTwo}`;
}
