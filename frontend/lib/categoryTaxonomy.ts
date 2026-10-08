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
  {
    keywords: [
      'pump', 'pumps', 'impeller', 'hydraulic', 'hydraulics', 'bearing', 'bearings', 'gear', 'gears',
      'compressor', 'boiler', 'turbine', 'conveyor', 'conveyors', 'cylinder', 'piston', 'shaft', 'spares',
      'mechanical', 'coupling', 'couplings', 'clutch', 'pulley', 'pulleys', 'spring', 'springs', 'nozzle', 'nozzles'
    ],
    major: 'Engineering Spares - Mechanical',
    minor: 'Pumps & Accessories',
  },
  {
    keywords: ['valve', 'valves', 'hose', 'hoses', 'flange', 'flanges', 'fitting', 'fittings', 'gasket', 'gaskets', 'seal', 'seals', 'o-ring', 'o rings'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Hoses, Valves & Fittings',
  },
  {
    keywords: ['pipe', 'pipes', 'piping', 'tubing', 'tube', 'tubes', 'nipple', 'elbow', 'tee', 'reducer'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Pipes & Pipe Fittings',
  },
  {
    keywords: ['filter', 'filters', 'cartridge', 'strainer', 'strainers', 'filtration'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Filters',
  },
  {
    keywords: ['tool', 'tools', 'tackle', 'tackles', 'wrench', 'spanner', 'drill', 'cutter', 'fastener', 'fasteners', 'bolt', 'bolts', 'nut', 'nuts', 'screw', 'screws'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Tools & Tackles',
  },
  {
    keywords: ['motor', 'motors', 'rotor', 'stator', 'servo', 'vfd', 'drive', 'drives'],
    major: 'Engineering Spares - Electrical',
    minor: 'Motors',
  },
  {
    keywords: ['cable', 'cables', 'wire', 'wires', 'wiring', 'conduit', 'conduits', 'harness', 'copper wire'],
    major: 'Engineering Spares - Electrical',
    minor: 'Cables',
  },
  {
    keywords: ['panel', 'panels', 'switchboard', 'distribution board', 'mcc', 'pcc', 'db box', 'enclosure'],
    major: 'Engineering Spares - Electrical',
    minor: 'Panels',
  },
  {
    keywords: ['sensor', 'sensors', 'transducer', 'transmitter', 'detector', 'gauge', 'meter', 'flowmeter', 'thermocouple', 'rtd', 'plc', 'scada'],
    major: 'Engineering Spares - Electrical',
    minor: 'Sensors',
  },
  {
    keywords: ['mccb', 'mcb', 'acb', 'breaker', 'breakers', 'switchgear', 'fuse', 'fuses', 'contactor', 'contactors', 'relay', 'relays', 'switch', 'switches'],
    major: 'Engineering Spares - Electrical',
    minor: 'Circuit Breakers',
  },
  {
    keywords: ['transformer', 'transformers', 'inverter', 'inverters', 'rectifier', 'ups', 'battery', 'batteries', 'generator', 'generators'],
    major: 'Engineering Spares - Electrical',
    minor: 'Transformers',
  },
  {
    keywords: ['rebar', 'rebars', 'tmt', 'steel bar', 'reinforcement', 'tmt bar', 'tmt bars'],
    major: 'Civil Works',
    minor: 'TMT BARS',
  },
  {
    keywords: ['peb', 'pre-engineered', 'shed', 'warehouse structure', 'steel structure', 'roofing sheet', 'purlin'],
    major: 'Civil Works',
    minor: 'PEB Structure',
  },
  {
    keywords: ['cement', 'concrete', 'mortar', 'grout', 'r質', 'aggregate', 'sand'],
    major: 'Civil Works',
    minor: 'Cement',
  },
  {
    keywords: ['brick', 'bricks', 'block', 'blocks', 'aac block', 'aac blocks', 'masonry', 'paver'],
    major: 'Civil Works',
    minor: 'Bricks & Blocks',
  },
  {
    keywords: ['steel', 'steels', 'plate', 'plates', 'sheet', 'sheets', 'angle', 'channel', 'beam', 'beams', 'metal', 'alloy'],
    major: 'Raw Material',
    minor: 'Steels',
  },
  {
    keywords: ['chemical', 'chemicals', 'acid', 'solvent', 'resin', 'oil', 'grease', 'lubricant', 'lubricants', 'paint', 'coating'],
    major: 'Raw Material',
    minor: 'Chemicals',
  },
  {
    keywords: ['laptop', 'laptops', 'desktop', 'computer', 'computers', 'server', 'servers', 'monitor', 'monitors', 'keyboard', 'printer'],
    major: 'IT',
    minor: 'Laptop',
  },
  {
    keywords: ['software', 'license', 'licenses', 'saas', 'cloud', 'antivirus', 'database', 'app'],
    major: 'IT',
    minor: 'Software',
  },
  {
    keywords: ['freight', 'transport', 'logistics', 'shipping', 'cargo', 'courier', 'road transport', 'trucking'],
    major: 'Logistics',
    minor: 'Road transport',
  },
  {
    keywords: ['fire extinguisher', 'extinguisher', 'extinguishers', 'hydrant', 'sprinkler', 'fire fighting'],
    major: 'Occuptional Health and Safety',
    minor: 'Fire Extinguishers',
  },
  {
    keywords: ['safety jacket', 'safety jackets', 'high vis', 'vest', 'vests', 'reflective jacket'],
    major: 'Occuptional Health and Safety',
    minor: 'Safety jackets',
  },
  {
    keywords: ['safety shoe', 'safety shoes', 'boots', 'steel toe', 'safety boot'],
    major: 'Occuptional Health and Safety',
    minor: 'Safety Shoes',
  },
  {
    keywords: ['helmet', 'helmets', 'hard hat', 'hard hats', 'hemlet'],
    major: 'Occuptional Health and Safety',
    minor: 'Hemlets',
  },
  {
    keywords: ['safety harness', 'fall arrest', 'safety belt', 'lanyard'],
    major: 'Occuptional Health and Safety',
    minor: 'Harness',
  },
  {
    keywords: ['glove', 'gloves', 'hand protection', 'safety gloves', 'nitrile gloves', 'leather gloves', 'mask', 'goggle', 'goggles', 'ppe'],
    major: 'Occuptional Health and Safety',
    minor: 'Gloves',
  },
  {
    keywords: ['storage rack', 'racking', 'pallet rack', 'shelving', 'slotted angle', 'mezzanine'],
    major: 'Others – New Product',
    minor: 'Storage Racks',
  },
  {
    keywords: ['consulting', 'audit', 'training', 'installation service', 'maintenance service', 'service', 'repair', 'fabrication', 'commissioning', 'inspection', 'manpower', 'calibration'],
    major: 'Others – New Service',
    minor: 'Consulting',
  },
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

  // Tokenize the combined text into words
  const tokens = combined.split(/[\s,./\\;:\-_+()\[\]{}|*&^%$#@!~`]+/).filter((t) => t.length >= 2);

  // 1. Direct match against known procurement keyword patterns
  for (const rule of KNOWN_KEYWORD_RULES) {
    if (
      rule.keywords.some(
        (kw) =>
          combined.includes(kw.toLowerCase()) ||
          tokens.some((token) => token === kw.toLowerCase() || (kw.length >= 4 && token.startsWith(kw.toLowerCase())))
      )
    ) {
      return { majorCategory: rule.major, minorCategory: rule.minor };
    }
  }

  // 2. Match against dynamic registered taxonomy
  for (const group of groups) {
    const major = group.majorCategory;
    for (const minor of group.minorCategories || []) {
      const minorLower = minor.toLowerCase();
      if (
        combined.includes(minorLower) ||
        tokens.some((token) => token.length >= 3 && minorLower.includes(token))
      ) {
        return { majorCategory: major, minorCategory: minor };
      }
    }
    const majorLower = major.toLowerCase();
    if (combined.includes(majorLower) || tokens.some((token) => token.length >= 4 && majorLower.includes(token))) {
      const defaultMinor = group.minorCategories?.[0] || '';
      return { majorCategory: major, minorCategory: defaultMinor };
    }
  }

  // 3. Fallback based on service vs product cues
  if (/service|repair|maintenance|installation|consulting|commissioning|inspection|testing|audit|civil work/i.test(combined)) {
    return { majorCategory: 'Others – New Service', minorCategory: 'Consulting' };
  }

  if (/product|material|equipment|supply|supplies|spares|item|hardware/i.test(combined)) {
    return { majorCategory: 'Others – New Product', minorCategory: 'Others' };
  }

  return { majorCategory: '', minorCategory: '' };
}

/** Total minor categories across every major, for the summary counters. */
export function countMinorCategories(): number {
  return groups.reduce((total, group) => total + (group.minorCategories?.length || 0), 0);
}

/** Discard the loaded taxonomy. Used by tests and on sign-out. */
export function clearCategoryTaxonomy(): void {
  setCategoryTaxonomy([]);
}
