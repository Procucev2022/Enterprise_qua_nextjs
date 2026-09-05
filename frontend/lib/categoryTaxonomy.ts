// ==============================================================================
// PROCUREMENT CATEGORY TAXONOMY REGISTRY
// ==============================================================================
// The major/minor category master, fetched once from the backend and shared by
// every screen that renders a category picker: the buyer ingestion wizard, the
// manual and edit RFQ modals, the buyer account table, the vendor profile and the
// category manager dashboards.
//
// This replaces `frontend/lib/categories.json`, a 372-line copy of the master
// that was bundled into the client. There was a second copy under
// backend/src/config, and the authoritative rows live in the `category_division`
// table — three copies, with nothing keeping any of them in step. A buyer's
// selection is written back as `org_division_category` rows and then used to fan
// RFQs out to vendors, so a checkbox offered from a stale bundled copy produced a
// procurement scope that silently matched nothing.
//
// The registry starts EMPTY and there is no fallback. A screen that has not
// loaded the taxonomy yet shows no options and says so, rather than showing
// options that may not exist. `useApp()` exposes the loaded value plus the load
// error; this module exists for the non-React validation code that cannot read
// context.
// ==============================================================================

import type { MajorMinorCategory } from './types';

/** Trim, collapse whitespace and casefold, so 'Storage  Racks' matches. */
function taxonomyKey(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

let groups: MajorMinorCategory[] = [];
let majorsByKey = new Map<string, string>();
let minorsByMajorKey = new Map<string, Map<string, string>>();

/**
 * Replace the registry contents.
 *
 * Called by the store once the fetch resolves. Indexes are rebuilt rather than
 * merged: a category removed from the master must stop being offered.
 */
export function setCategoryTaxonomy(next: MajorMinorCategory[]): void {
  groups = Array.isArray(next) ? next : [];
  majorsByKey = new Map();
  minorsByMajorKey = new Map();

  groups.forEach((group) => {
    if (!group?.majorCategory) return;
    const majorKey = taxonomyKey(group.majorCategory);
    majorsByKey.set(majorKey, group.majorCategory);
    const minors = new Map<string, string>();
    (group.minorCategories || []).forEach((minor) => {
      if (!minor) return;
      minors.set(taxonomyKey(minor), minor);
    });
    minorsByMajorKey.set(majorKey, minors);
  });
}

/** Everything currently loaded, in master order. */
export function getCategoryTaxonomy(): MajorMinorCategory[] {
  return groups;
}

/** True once a taxonomy has actually been loaded. */
export function isCategoryTaxonomyLoaded(): boolean {
  return groups.length > 0;
}

/** Major categories in master display order. */
export function getMajorCategories(): string[] {
  return groups.map((group) => group.majorCategory);
}

/** Minor categories under a major, or an empty list when the major is unknown. */
export function getMinorCategories(major: string): string[] {
  const group = groups.find((g) => taxonomyKey(g.majorCategory) === taxonomyKey(major));
  return group ? group.minorCategories || [] : [];
}

/** Whether the master contains this major category. */
export function hasMajorCategory(major: string): boolean {
  return majorsByKey.has(taxonomyKey(major));
}

/** Whether the master contains this minor under this major. */
export function hasMinorCategory(major: string, minor: string): boolean {
  return minorsByMajorKey.get(taxonomyKey(major))?.has(taxonomyKey(minor)) ?? false;
}

/**
 * The major category the master owns a minor under, or an empty string.
 *
 * The first match wins for a minor that appears under several majors
 * ('Refractories', 'Panels', 'Conveyors'), matching the order a buyer sees in the
 * dropdown.
 */
export function findMajorForMinor(minor: string): string {
  const key = taxonomyKey(minor);
  const group = groups.find((g) => (g.minorCategories || []).some((m) => taxonomyKey(m) === key));
  return group ? group.majorCategory : '';
}

/** Total minor categories across every major, for the summary counters. */
export function countMinorCategories(): number {
  return groups.reduce((total, group) => total + (group.minorCategories?.length || 0), 0);
}

/** Discard the loaded taxonomy. Used by tests and on sign-out. */
export function clearCategoryTaxonomy(): void {
  setCategoryTaxonomy([]);
}
