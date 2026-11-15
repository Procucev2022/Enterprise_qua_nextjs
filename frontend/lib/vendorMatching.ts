// ==============================================================================
// VENDOR CATEGORY MATCHING & SCORING MODULE
// ==============================================================================
// Resolves category signals from RFQs / line items and matches candidate vendors
// for Mode 1 (Private Roster), Mode 2 (Hybrid Sourcing), and Mode 3 (AI Discovery).
// ==============================================================================

import type { RfqCategoryFormInput, VendorEntry } from './types';
import { isProcucevVendor } from '../app/buyer/vendor-summary';
import { ALL_CATEGORIES_OPTION, VENDOR_ASSIGNMENT_LIMITS } from './constants';
import { findMajorForMinor } from './categoryTaxonomy';
import { UI_STRINGS } from './uiStrings';

export interface CategoryMatchResult {
  isMatch: boolean;
  matchScore: number;
  matchedCategories: string[];
  matchedMajor: string;
}

export interface MatchedVendorResult {
  vendor: VendorEntry;
  matchScore: number;
  matchedCategories: string[];
  matchedMajor: string;
}

/**
 * Normalizes category strings for comparison by lowercasing, trimming,
 * and normalizing ampersands and punctuation.
 */
export function normalizeCategory(cat?: string | null): string {
  if (!cat) return '';
  return String(cat)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[/_.,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Category labels from a vendor field that may hold an array or a comma-separated
 * string. The server reads both forms, so the browser does too.
 */
function categoryLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((label) => String(label ?? '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((label) => label.trim()).filter(Boolean);
  return [];
}

/**
 * Whether two normalized category names are the same minor category, allowing a
 * singular or plural difference ("Box" and "Boxes"). A longer name that only
 * contains the other does not match. Mirrors minorKeysMatch in
 * backend/src/services/storeService.js so the browser and the server agree.
 */
export function minorNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a + 's' === b || a + 'es' === b || b + 's' === a || b + 'es' === a;
}

/** Category signals an RFQ carries, and whether they are minor-level. */
export interface RfqCategorySignals {
  /**
   * Normalized signals to match vendors against. When the RFQ names minor
   * categories these are only those minors. Otherwise they are every major and
   * category label the RFQ carries.
   */
  signals: string[];
  /** Every raw category label the RFQ carries, for display and for fetching the directory. */
  rawSignals: string[];
  /** True when `signals` are minor categories. A vendor then has to match a minor, never a major alone. */
  minorOnly: boolean;
}

/**
 * Extract the unique normalized category signals from an RFQ form or payload.
 * An RFQ that names minor categories is matched by those minors only.
 */
function isAllCategoriesLabel(value?: string | null): boolean {
  return String(value ?? '').trim().toLowerCase() === ALL_CATEGORIES_OPTION.toLowerCase();
}

function addDistinctCategoryLabel(target: Set<string>, value?: string | null): void {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || isAllCategoriesLabel(trimmed)) return;
  target.add(trimmed);
}

function collectVendorMinorLabels(vendor: VendorEntry): string[] {
  return [
    ...categoryLabels(vendor.minorCategories),
    ...categoryLabels(vendor.vendorSelectedCategories),
    ...categoryLabels(vendor.clientMappedCategories),
  ].filter((label) => Boolean(normalizeCategory(label)));
}

export function extractRfqCategorySignals(form: RfqCategoryFormInput): RfqCategorySignals {
  const rawSet = new Set<string>();
  const minorSet = new Set<string>();

  addDistinctCategoryLabel(rawSet, form.majorCategory);
  if (form.minorCategory?.trim() && !isAllCategoriesLabel(form.minorCategory)) {
    addDistinctCategoryLabel(rawSet, form.minorCategory);
    addDistinctCategoryLabel(minorSet, form.minorCategory);
  }
  addDistinctCategoryLabel(rawSet, form.category);

  const items = form.lineItems || form.extractedEntities || [];
  for (const item of items) {
    addDistinctCategoryLabel(rawSet, item.majorCategory);
    if (item.minorCategory?.trim() && !isAllCategoriesLabel(item.minorCategory)) {
      addDistinctCategoryLabel(rawSet, item.minorCategory);
      addDistinctCategoryLabel(minorSet, item.minorCategory);
    }
    addDistinctCategoryLabel(rawSet, item.category);
  }

  const rawSignals = Array.from(rawSet);
  const minorSignals = Array.from(new Set(Array.from(minorSet).map(normalizeCategory).filter(Boolean)));
  if (minorSignals.length > 0) {
    return { signals: minorSignals, rawSignals, minorOnly: true };
  }
  const signals = Array.from(new Set(rawSignals.map(normalizeCategory).filter(Boolean)));

  return { signals, rawSignals, minorOnly: false };
}

/**
 * Returns true only when the buyer explicitly chose "All Categories" with no narrower category.
 */
export function hasExplicitAllCategoriesChoice(form: RfqCategoryFormInput): boolean {
  if (extractRfqCategorySignals(form).rawSignals.length > 0) return false;
  const items = form.lineItems || form.extractedEntities || [];
  return (
    isAllCategoriesLabel(form.majorCategory) ||
    isAllCategoriesLabel(form.category) ||
    items.some((item) => isAllCategoriesLabel(item.majorCategory) || isAllCategoriesLabel(item.category))
  );
}

/**
 * Extracts distinct non-empty minor and major categories (including parent majors inferred
 * from minor categories) across the RFQ header and all line items.
 */
export function extractRfqCategoryFilters(form: RfqCategoryFormInput): { majors: string[]; minors: string[] } {
  const items = form.lineItems || form.extractedEntities || [];
  const majorsSet = new Set<string>();
  const minorsSet = new Set<string>();

  addDistinctCategoryLabel(majorsSet, form.majorCategory);
  addDistinctCategoryLabel(majorsSet, form.category);
  addDistinctCategoryLabel(minorsSet, form.minorCategory);

  for (const item of items) {
    addDistinctCategoryLabel(majorsSet, item.majorCategory);
    addDistinctCategoryLabel(majorsSet, item.category);
    addDistinctCategoryLabel(minorsSet, item.minorCategory);
  }

  for (const minor of Array.from(minorsSet)) {
    addDistinctCategoryLabel(majorsSet, findMajorForMinor(minor));
  }

  return {
    majors: Array.from(majorsSet),
    minors: Array.from(minorsSet),
  };
}

function matchesCategoryToken(target: string, signal: string): boolean {
  if (!target || !signal) return false;
  const t = target.trim().toLowerCase();
  const s = signal.trim().toLowerCase();
  if (t === s) return true;
  // Word boundary regex check to prevent substring collisions (e.g. "it" in "security")
  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sReg = new RegExp(`(^|\\b)${escapeRegExp(s)}(\\b|$)`, 'i');
  if (sReg.test(t)) return true;
  const tReg = new RegExp(`(^|\\b)${escapeRegExp(t)}(\\b|$)`, 'i');
  if (tReg.test(s)) return true;
  return false;
}

/**
 * Checks if a vendor's categories match the given RFQ category signals.
 *
 * With `minorOnly` the signals are minor categories. Only a minor-level label
 * then counts: a vendor's major category or a related minor does not, and the
 * loose token and taxonomy-association matches are not used. Without it the
 * legacy major-level rules apply.
 */
export function matchVendorAgainstSignals(
  vendor: VendorEntry,
  signals: string[],
  minorOnly = false
): CategoryMatchResult {
  const sameName = (a: string, b: string): boolean => (minorOnly ? minorNamesMatch(a, b) : a === b);
  if (!vendor || !signals || signals.length === 0) {
    return { isMatch: false, matchScore: 0, matchedCategories: [], matchedMajor: vendor?.majorCategory || '' };
  }

  const vendorMajor = vendor.majorCategory ? normalizeCategory(vendor.majorCategory) : '';
  const minorLabels = categoryLabels(vendor.minorCategories).filter((label) => normalizeCategory(label));
  const selectedLabels = categoryLabels(vendor.vendorSelectedCategories).filter((label) => normalizeCategory(label));
  const mappedLabels = categoryLabels(vendor.clientMappedCategories).filter((label) => normalizeCategory(label));
  const vendorMinors = minorLabels.map(normalizeCategory);
  const vendorSelected = selectedLabels.map(normalizeCategory);
  const vendorMapped = mappedLabels.map(normalizeCategory);

  const hasAnyCategory = Boolean(vendorMajor || vendorMinors.length > 0 || vendorSelected.length > 0 || vendorMapped.length > 0);
  if (!hasAnyCategory) {
    return { isMatch: false, matchScore: 0, matchedCategories: [], matchedMajor: '' };
  }

  const matched = new Set<string>();
  let highestScore = 0;

  for (const signal of signals) {
    if (!signal) continue;
    const normSignal = normalizeCategory(signal);
    if (!normSignal) continue;

    // 1. Check Minor Categories match (highest specificity -> 98%)
    for (let i = 0; i < vendorMinors.length; i++) {
      const vMinor = vendorMinors[i];
      if (sameName(vMinor, normSignal)) {
        matched.add(minorLabels[i]);
        highestScore = Math.max(highestScore, 98);
      } else if (!minorOnly && matchesCategoryToken(vMinor, normSignal)) {
        matched.add(minorLabels[i]);
        highestScore = Math.max(highestScore, 92);
      }
    }

    // 2. Check Client Mapped Categories (from PO history -> 96%)
    for (let i = 0; i < vendorMapped.length; i++) {
      const vMapped = vendorMapped[i];
      if (sameName(vMapped, normSignal)) {
        matched.add(mappedLabels[i]);
        highestScore = Math.max(highestScore, 96);
      } else if (!minorOnly && matchesCategoryToken(vMapped, normSignal)) {
        matched.add(mappedLabels[i]);
        highestScore = Math.max(highestScore, 90);
      }
    }

    // 3. Check Major Category match (95%). In minor-only mode it counts only
    // when the major is itself named like the minor.
    if (vendorMajor) {
      if (sameName(vendorMajor, normSignal)) {
        matched.add(vendor.majorCategory!);
        highestScore = Math.max(highestScore, 95);
      } else if (!minorOnly && matchesCategoryToken(vendorMajor, normSignal)) {
        matched.add(vendor.majorCategory!);
        highestScore = Math.max(highestScore, 88);
      }
    }

    // 4. Check Vendor Profile Selected Categories (94%)
    for (let i = 0; i < vendorSelected.length; i++) {
      const vSel = vendorSelected[i];
      if (sameName(vSel, normSignal)) {
        matched.add(selectedLabels[i]);
        highestScore = Math.max(highestScore, 94);
      } else if (!minorOnly && matchesCategoryToken(vSel, normSignal)) {
        matched.add(selectedLabels[i]);
        highestScore = Math.max(highestScore, 86);
      }
    }

    // 5. Legacy only: taxonomy major/minor association. A minor-level RFQ never
    // reaches a vendor through the parent major of its minor.
    if (!minorOnly) {
      const signalMajor = findMajorForMinor(signal);
      if (signalMajor && vendorMajor && normalizeCategory(signalMajor) === vendorMajor) {
        matched.add(vendor.majorCategory!);
        highestScore = Math.max(highestScore, 93);
      }
      for (let i = 0; i < vendorMinors.length; i++) {
        const vMinor = vendorMinors[i];
        const vMinorMajor = findMajorForMinor(vMinor);
        if (vMinorMajor && normalizeCategory(vMinorMajor) === normSignal) {
          matched.add(minorLabels[i]);
          highestScore = Math.max(highestScore, 93);
        }
      }
    }
  }

  const matchedList = Array.from(matched);
  const isMatch = matchedList.length > 0 && highestScore >= 80;

  return {
    isMatch,
    matchScore: isMatch ? highestScore : 0,
    matchedCategories: matchedList,
    matchedMajor: vendor.majorCategory || matchedList[0] || '',
  };
}

/** A Procucev vendor ranked by the V3 360Â° evaluation (category + location). */
export interface RankedProcucevVendor {
  vendor: VendorEntry;
  /** Combined 0â€“100 score used for ordering. */
  overallScore: number;
  /** The category-relevance component (0â€“100). */
  categoryScore: number;
  /** The delivery-location component (0â€“100). */
  locationScore: number;
  matchedCategories: string[];
  /** Human label describing why the vendor ranked where it did. */
  locationReason: string;
  hasMinorMatch?: boolean;
  matchedMinorCategory?: string | null;
}

/**
 * Score how well a vendor's location serves a delivery destination.
 *
 * A deterministic, data-only heuristic â€” no external geocoding â€” so it is
 * stable in tests and offline:
 *   â€¢ Same 6-digit PIN prefix (first 3 digits = same postal district): 100
 *   â€¢ Same first PIN digit (same broad postal region/zone): 70
 *   â€¢ City or state name appears in the vendor's location string: 85 / 60
 *   â€¢ Nothing matched / no data: 40 (neutral â€” never zero, so a strong
 *     category match is not wiped out by missing location data)
 */
export function scoreVendorLocation(
  vendor: VendorEntry,
  destination: { location?: string | null; pincode?: string | null }
): { score: number; reason: string } {
  const vendorPin = String(vendor.pincode || '').replace(/\D/g, '');
  const destPin = String(destination.pincode || '').replace(/\D/g, '');

  if (vendorPin.length === 6 && destPin.length === 6) {
    if (vendorPin.slice(0, 3) === destPin.slice(0, 3)) {
      return { score: 100, reason: 'Same delivery district (PIN)' };
    }
    if (vendorPin[0] === destPin[0]) {
      return { score: 70, reason: 'Same postal region' };
    }
  }

  const destText = String(destination.location || '').toLowerCase();
  const vendorText = `${vendor.location || ''} ${vendor.city || ''} ${vendor.state || ''}`.toLowerCase();

  if (destText && vendor.city && destText.includes(String(vendor.city).toLowerCase())) {
    return { score: 85, reason: `Based in ${vendor.city}` };
  }
  if (destText && vendor.state && destText.includes(String(vendor.state).toLowerCase())) {
    return { score: 60, reason: `In ${vendor.state}` };
  }
  // Reverse: the vendor's location text mentions the destination.
  if (vendorText.trim() && destText && destText.split(/[\s,/]+/).some((tok) => tok.length >= 4 && vendorText.includes(tok))) {
    return { score: 60, reason: 'Regional overlap' };
  }

  return { score: 40, reason: UI_STRINGS.vendorRanking.locationNotConfirmed };
}

/**
 * Rank Procucev network vendors for a V3 (Autonomous) RFQ by a 360Â° evaluation
 * that blends category relevance with delivery-location proximity (and rating
 * as a final tie-break), returning at most `limit` vendors.
 *
 * Weighting: category relevance is the primary driver (70%), delivery location
 * secondary (30%) â€” a geographically close supplier that cannot supply the
 * category is useless, but between two capable suppliers the closer one wins.
 */
export function rankProcucevVendorsForV3(
  vendors: VendorEntry[],
  signals: string[],
  destination: { location?: string | null; pincode?: string | null },
  limit = 10,
  preferredMinors: string[] = [],
  minorOnly = false
): RankedProcucevVendor[] {
  if (!Array.isArray(vendors)) return [];

  const procucevPool = vendors.filter(isProcucevVendor);
  const ranked: RankedProcucevVendor[] = [];
  const normMinors = preferredMinors.map(normalizeCategory).filter(Boolean);

  // With no category signals there is nothing to match, so no supplier is ranked and no
  // category percentage is shown. The score is never invented for an empty signal list.
  if (signals.length === 0) return [];

  for (const vendor of procucevPool) {
    const match = matchVendorAgainstSignals(vendor, signals, minorOnly);
    const categoryScore = match.matchScore;
    if (categoryScore <= 0) continue;

    const rawVendorMinors = collectVendorMinorLabels(vendor);
    const vendorMinors = rawVendorMinors.map(normalizeCategory);

    const hasMinorMatch = normMinors.length > 0 && normMinors.some((nm) =>
      vendorMinors.some((vm) => minorNamesMatch(vm, nm))
    );

    const loc = scoreVendorLocation(vendor, destination);
    const minorBonus = hasMinorMatch ? 15 : 0;
    const overallScore = Math.min(100, Math.round(categoryScore * 0.7 + loc.score * 0.3) + minorBonus);

    const matchedMinorCategory = rawVendorMinors.find((m) => {
      const normM = normalizeCategory(m);
      return normMinors.some((nm) => minorNamesMatch(normM, nm));
    }) || rawVendorMinors[0] || null;

    ranked.push({
      vendor,
      overallScore,
      categoryScore,
      locationScore: loc.score,
      matchedCategories: match.matchedCategories,
      locationReason: loc.reason,
      hasMinorMatch,
      matchedMinorCategory,
    });
  }

  ranked.sort((a, b) => {
    const aMinor = a.hasMinorMatch ? 1 : 0;
    const bMinor = b.hasMinorMatch ? 1 : 0;
    if (aMinor !== bMinor) return bMinor - aMinor;
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
    if (b.categoryScore !== a.categoryScore) return b.categoryScore - a.categoryScore;
    return (b.vendor.rating || 0) - (a.vendor.rating || 0);
  });

  return ranked.slice(0, Math.max(0, limit));
}

/**
 * Selects the top Procucev Network vendors for Mode 3 ingestion:
 * - Returns `[]` when no categories are set unless the buyer explicitly selected "All Categories".
 * - Ranks Tier 1 exact/stem minor matches first, then tops up remaining slots up to `limit` (10)
 *   from Tier 2 parent-major vendors so multi-vendor shortlists stay populated.
 */
export function selectTopProcucevVendorsForMode3(
  vendors: VendorEntry[],
  form: RfqCategoryFormInput,
  limit = VENDOR_ASSIGNMENT_LIMITS.MODE3_TOP_VENDORS_LIMIT
): RankedProcucevVendor[] {
  if (!Array.isArray(vendors) || limit <= 0) return [];
  const procucevPool = vendors.filter(isProcucevVendor);
  if (procucevPool.length === 0) return [];

  const destination = { location: form.deliveryLocation, pincode: form.deliveryPincode };
  const { signals, minorOnly } = extractRfqCategorySignals(form);
  const { majors, minors } = extractRfqCategoryFilters(form);

  if (signals.length === 0) {
    if (!hasExplicitAllCategoriesChoice(form)) return [];
    return procucevPool
      .map((vendor): RankedProcucevVendor => {
        const loc = scoreVendorLocation(vendor, destination);
        const ratingScore = Math.min(100, Math.max(0, Math.round((Number(vendor.rating) || 0) * 20)));
        const overallScore = Math.min(100, Math.round(loc.score * 0.6 + ratingScore * 0.4));
        const vendorMinors = collectVendorMinorLabels(vendor);
        return {
          vendor,
          overallScore,
          categoryScore: 100,
          locationScore: loc.score,
          matchedCategories: [vendor.majorCategory?.trim() || ALL_CATEGORIES_OPTION],
          locationReason: loc.reason,
          hasMinorMatch: false,
          matchedMinorCategory: vendorMinors[0] || null,
        };
      })
      .sort((a, b) => {
        if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
        if (b.locationScore !== a.locationScore) return b.locationScore - a.locationScore;
        return (b.vendor.rating || 0) - (a.vendor.rating || 0);
      })
      .slice(0, limit);
  }

  if (!minorOnly) {
    return rankProcucevVendorsForV3(procucevPool, signals, destination, limit, minors, false);
  }

  const tier1 = rankProcucevVendorsForV3(procucevPool, signals, destination, limit, minors, true);
  if (tier1.length >= limit) return tier1.slice(0, limit);

  const fallbackMajorSignals = Array.from(new Set(majors.map(normalizeCategory).filter(Boolean)));
  if (fallbackMajorSignals.length === 0) return tier1;

  const pickedKeys = new Set(tier1.map((item) => item.vendor.id || item.vendor.email));
  const remainingPool = procucevPool.filter((v) => !pickedKeys.has(v.id || v.email));
  const tier2 = rankProcucevVendorsForV3(
    remainingPool,
    fallbackMajorSignals,
    destination,
    limit - tier1.length,
    [],
    false
  );
  return [...tier1, ...tier2];
}

/**
 * Filters Procucev marketplace vendors to only those that match the RFQ's categories.
 */
export function getCategoryMatchedProcucevVendors(
  vendors: VendorEntry[],
  signals: string[],
  minScore = 80,
  minorOnly = false
): MatchedVendorResult[] {
  if (!Array.isArray(vendors)) return [];

  const procucevPool = vendors.filter(isProcucevVendor);
  const results: MatchedVendorResult[] = [];

  for (const vendor of procucevPool) {
    const match = matchVendorAgainstSignals(vendor, signals, minorOnly);
    if (match.isMatch && match.matchScore >= minScore) {
      results.push({
        vendor,
        matchScore: match.matchScore,
        matchedCategories: match.matchedCategories,
        matchedMajor: match.matchedMajor,
      });
    }
  }

  // Sort by match score descending, then rating descending
  return results.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return (b.vendor.rating || 0) - (a.vendor.rating || 0);
  });
}

/**
 * Selects candidate vendors considering the rule:
 * For each category, up to maxPerCategory vendors (default 5, configurable via env)
 * should be selected, deduplicated across categories.
 * When destination is provided, vendors closer to delivery location are prioritized.
 */
export function selectVendorsForCategories(
  vendors: VendorEntry[],
  signals: string[],
  maxPerCategory = VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY,
  destination?: { location?: string | null; pincode?: string | null },
  minorOnly = false
): MatchedVendorResult[] {
  if (!Array.isArray(vendors) || !signals || signals.length === 0) return [];

  const rawSignals = Array.from(new Set(signals.map(normalizeCategory).filter(Boolean)));
  if (rawSignals.length === 0) return [];

  const selectedMap = new Map<string, MatchedVendorResult>();
  for (const signal of rawSignals) {
    const catMatches: MatchedVendorResult[] = [];
    for (const vendor of vendors) {
      const match = matchVendorAgainstSignals(vendor, [signal], minorOnly);
      if (match.isMatch) {
        catMatches.push({
          vendor,
          matchScore: match.matchScore,
          matchedCategories: match.matchedCategories,
          matchedMajor: match.matchedMajor,
        });
      }
    }
    catMatches.sort((a, b) => {
      if (destination && (destination.pincode || destination.location)) {
        const aLoc = scoreVendorLocation(a.vendor, destination).score;
        const bLoc = scoreVendorLocation(b.vendor, destination).score;
        if (bLoc !== aLoc) return bLoc - aLoc;
      }
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return (b.vendor.rating || 0) - (a.vendor.rating || 0);
    });
    for (const item of catMatches.slice(0, maxPerCategory)) {
      const key = item.vendor.id || item.vendor.email;
      if (key && !selectedMap.has(key)) {
        selectedMap.set(key, item);
      }
    }
  }

  const results = Array.from(selectedMap.values());
  return results.sort((a, b) => {
    if (destination && (destination.pincode || destination.location)) {
      const aLoc = scoreVendorLocation(a.vendor, destination).score;
      const bLoc = scoreVendorLocation(b.vendor, destination).score;
      if (bLoc !== aLoc) return bLoc - aLoc;
    }
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return (b.vendor.rating || 0) - (a.vendor.rating || 0);
  });
}

