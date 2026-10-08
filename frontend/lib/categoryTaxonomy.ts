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
  groups = (Array.isArray(next) ? next : []).filter((g) => Boolean(g && g.majorCategory));
  majorsByKey = new Map();
  minorsByMajorKey = new Map();

  groups.forEach((group) => {
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
  if (!major) return [];
  const key = taxonomyKey(major);
  const group = groups.find((g) => taxonomyKey(g.majorCategory) === key);
  return group ? group.minorCategories || [] : [];
}

/** Whether the master contains this major category. */
export function hasMajorCategory(major: string): boolean {
  return Boolean(major && majorsByKey.has(taxonomyKey(major)));
}

/** Whether the master contains this minor under this major. */
export function hasMinorCategory(major: string, minor: string): boolean {
  if (!major || !minor) return false;
  const minors = minorsByMajorKey.get(taxonomyKey(major));
  return Boolean(minors && minors.has(taxonomyKey(minor)));
}

/**
 * The major category the master owns a minor under, or an empty string.
 *
 * The first match wins for a minor that appears under several majors
 * ('Refractories', 'Panels', 'Conveyors'), matching the order a buyer sees in the
 * dropdown.
 */
export function findMajorForMinor(minor: string): string {
  if (!minor) return '';
  const key = taxonomyKey(minor);
  let found = '';
  minorsByMajorKey.forEach((minors, majorKey) => {
    if (!found && minors.has(key)) {
      found = majorsByKey.get(majorKey) || '';
    }
  });
  return found;
}

const KNOWN_KEYWORD_RULES: Array<{
  keywords: string[];
  major: string;
  minor: string;
}> = [
  { keywords: ['pump', 'impeller', 'hydraulic'], major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
  { keywords: ['valve', 'hose', 'flange', 'fitting', 'coupling'], major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
  { keywords: ['pipe', 'piping', 'tubing'], major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
  { keywords: ['filter', 'cartridge', 'strainer'], major: 'Engineering Spares - Mechanical', minor: 'Filters' },
  { keywords: ['tool', 'tackle', 'wrench', 'spanner', 'drill', 'cutter'], major: 'Engineering Spares - Mechanical', minor: 'Tools & Tackles' },
  { keywords: ['motor', 'rotor', 'stator', 'servo'], major: 'Engineering Spares - Electrical', minor: 'Motors' },
  { keywords: ['cable', 'wire', 'wiring', 'conduit'], major: 'Engineering Spares - Electrical', minor: 'Cables' },
  { keywords: ['panel', 'switchboard', 'distribution board', 'mcc panel', 'pcc panel'], major: 'Engineering Spares - Electrical', minor: 'Panels' },
  { keywords: ['sensor', 'transducer', 'transmitter', 'detector'], major: 'Engineering Spares - Electrical', minor: 'Sensors' },
  { keywords: ['mccb', 'breaker', 'switchgear', 'fuse', 'contactor'], major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
  { keywords: ['transformer', 'inverter', 'rectifier', 'ups'], major: 'Engineering Spares - Electrical', minor: 'Transformers' },
  { keywords: ['rebar', 'tmt', 'steel bar', 'reinforcement'], major: 'Civil Works', minor: 'TMT BARS' },
  { keywords: ['peb', 'pre-engineered', 'shed', 'warehouse structure'], major: 'Civil Works', minor: 'PEB Structure' },
  { keywords: ['cement', 'concrete', 'mortar', 'grout'], major: 'Civil Works', minor: 'Cement' },
  { keywords: ['brick', 'block', 'aac block', 'masonry'], major: 'Civil Works', minor: 'Bricks & Blocks' },
  { keywords: ['steel', 'plate', 'sheet', 'angle', 'channel', 'beam'], major: 'Raw Material', minor: 'Steels' },
  { keywords: ['laptop', 'desktop', 'computer', 'server', 'monitor'], major: 'IT', minor: 'Laptop' },
  { keywords: ['software', 'license', 'saas', 'cloud', 'antivirus'], major: 'IT', minor: 'Software' },
  { keywords: ['freight', 'transport', 'logistics', 'shipping', 'cargo'], major: 'Logistics', minor: 'Road transport' },
  { keywords: ['fire extinguisher', 'hydrant', 'sprinkler'], major: 'Occuptional Health and Safety', minor: 'Fire Extinguishers' },
  { keywords: ['safety jacket', 'high vis', 'vest'], major: 'Occuptional Health and Safety', minor: 'Safety jackets' },
  { keywords: ['safety shoe', 'boots', 'steel toe'], major: 'Occuptional Health and Safety', minor: 'Safety Shoes' },
  { keywords: ['helmet', 'hard hat'], major: 'Occuptional Health and Safety', minor: 'Hemlets' },
  { keywords: ['harness', 'fall arrest', 'safety belt'], major: 'Occuptional Health and Safety', minor: 'Harness' },
  { keywords: ['glove', 'gloves', 'hand protection'], major: 'Occuptional Health and Safety', minor: 'Gloves' },
  { keywords: ['storage rack', 'racking', 'pallet rack', 'shelving'], major: 'Others – New Product', minor: 'Storage Racks' },
  { keywords: ['consulting', 'audit', 'training', 'installation service', 'maintenance service'], major: 'Others – New Service', minor: 'Consulting' },
];

/**
 * Automatically identify and assign the appropriate major and minor category
 * based on item name and technical specifications keywords.
 */
export function autoCategorizeItem(
  itemName: string,
  specs = ''
): { majorCategory: string; minorCategory: string } {
  const combined = `${itemName || ''} ${specs || ''}`.trim().toLowerCase();
  if (!combined) {
    return { majorCategory: '', minorCategory: '' };
  }

  // 1. Direct match against known procurement keyword patterns
  for (const rule of KNOWN_KEYWORD_RULES) {
    if (rule.keywords.some((kw) => combined.includes(kw.toLowerCase()))) {
      return { majorCategory: rule.major, minorCategory: rule.minor };
    }
  }

  // 2. Match against dynamic registered taxonomy
  for (const group of groups) {
    const major = group.majorCategory;
    for (const minor of group.minorCategories || []) {
      const minorLower = minor.toLowerCase();
      if (combined.includes(minorLower) || minorLower.includes(combined)) {
        return { majorCategory: major, minorCategory: minor };
      }
    }
    const majorLower = major.toLowerCase();
    if (combined.includes(majorLower)) {
      const defaultMinor = group.minorCategories?.[0] || '';
      return { majorCategory: major, minorCategory: defaultMinor };
    }
  }

  // 3. Fallback based on service vs product cues
  if (/service|repair|maintenance|installation|consulting|commissioning|inspection/i.test(combined)) {
    return { majorCategory: 'Others – New Service', minorCategory: 'Others' };
  }

  return { majorCategory: 'Others – New Product', minorCategory: 'Others' };
}

/** Total minor categories across every major, for the summary counters. */
export function countMinorCategories(): number {
  return groups.reduce((total, group) => total + (group.minorCategories?.length || 0), 0);
}

/** Discard the loaded taxonomy. Used by tests and on sign-out. */
export function clearCategoryTaxonomy(): void {
  setCategoryTaxonomy([]);
}
