/**
 * RFQ Ingestion Service
 *
 * Server-side half of the AI RFQ ingestion flow. The browser extracts raw rows
 * from a BOQ spreadsheet (or an email body), and this module turns those rows
 * into review-ready line items: it normalises the loose field names an upload
 * produces, repairs missing quantities and units, classifies every item into the
 * shared major/minor taxonomy, and derives the draft RFQ header.
 *
 * Ported from the Java p2pservices pipeline (EmailProcessorService +
 * CategoryClassificationService + RFQBuilderService). The behaviours kept
 * deliberately identical to that service, because buyers already rely on them:
 *   - a missing or non-positive quantity stays null and is reported as missing,
 *     and a blank unit stays null; neither is defaulted
 *   - classification precedence is explicit category, then keyword, then default
 *   - the RFQ title is derived from the first line item, capped at 100 chars
 *   - a missing delivery date defaults to today + 5 days
 *   - duplicate rows within one ingest are collapsed on a composite key
 */

const { RFQ_CATEGORY_CLASSIFICATION, RFQ_INGESTION_CONFIG, DEFAULT_CATEGORY_TAXONOMY } = require('../config/constants');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const { logger } = require('./loggerService');

const {
  CONFIDENCE,
  STATUS,
  STATED_CATEGORY_ALIASES,
  MAJOR_CATEGORY_ALIASES,
  GENERIC_CATEGORY_TOKENS,
  DOMAIN_KEYWORD_MAP,
  MATERIAL_ONLY_KEYWORDS,
  TAXONOMY_CACHE_TTL_MS,
} = RFQ_CATEGORY_CLASSIFICATION;

const {
  DELIVERY_DATE_OFFSET_DAYS,
  MAX_TITLE_LENGTH,
  TITLE_SUFFIX_SINGLE,
  TITLE_SUFFIX_MULTIPLE,
} = RFQ_INGESTION_CONFIG;

// Keywords are matched longest-first so a specific phrase wins over a substring
// of it, e.g. 'circuit breaker' must beat the bare 'breaker'-style entries.
const KEYWORDS_BY_LENGTH = Object.keys(DOMAIN_KEYWORD_MAP).sort((a, b) => b.length - a.length);
const MATERIAL_ONLY_KEYWORD_SET = new Set((MATERIAL_ONLY_KEYWORDS || []).map((k) => k.toLowerCase()));

// ==============================================================================
// SHARED TAXONOMY INDEX
// ==============================================================================
// The review grid builds its two dropdowns from the same taxonomy this index is
// built from: the major select lists the majors, and the minor select lists only
// the minors belonging to the chosen major. A pair outside the taxonomy therefore
// cannot be displayed — the select finds no matching option and renders blank,
// which is what made an extracted item arrive with both category fields
// apparently empty.
//
// The taxonomy is read from the `category_division` table rather than a bundled
// categories.json. There used to be two copies of that file, one under
// backend/src/config and one under frontend/lib, with nothing keeping them in
// step with each other or with the database the buyer's saved selection is
// actually written to. Classification is what routes an RFQ to a vendor pool, so
// it has to agree with the master the pool is defined against.
//
// The model reliably names a *minor* ("Motors", "Fasteners") and rarely names a
// major, so the major is looked up from the minor here instead of being replaced
// with a placeholder. Both indexes are keyed on a normalised form and store the
// master's own spelling, so classification always emits values the grid can
// render.

/** Trim, collapse whitespace and casefold, so 'Storage  Racks' matches. */
function taxonomyKey(value) {
  return String(value || '')
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// Cached rather than read per ingest: the master is a few hundred short rows that
// change rarely, and an ingest classifies every line item against it. Pre-primed
// with DEFAULT_CATEGORY_TAXONOMY as a baseline fallback so offline/test environments
// have complete valid category mappings available immediately.
const taxonomyIndex = {
  majorByKey: new Map(),
  byMinorKey: new Map(),
  minorsByMajorKey: new Map(),
  loadedAt: 0,
  groupCount: 0,
};

/** Build the lookup maps from the grouped taxonomy shape. */
function primeTaxonomyIndex(groups) {
  taxonomyIndex.majorByKey = new Map();
  taxonomyIndex.byMinorKey = new Map();
  taxonomyIndex.minorsByMajorKey = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    if (!group || !group.majorCategory) return;
    const majorKey = taxonomyKey(group.majorCategory);
    taxonomyIndex.majorByKey.set(majorKey, group.majorCategory);
    if (!taxonomyIndex.minorsByMajorKey.has(majorKey)) {
      taxonomyIndex.minorsByMajorKey.set(majorKey, new Map());
    }
    const minorMap = taxonomyIndex.minorsByMajorKey.get(majorKey);
    (group.minorCategories || []).forEach((minor) => {
      // First major wins for a minor that appears under several ('Refractories',
      // 'Panels', 'Conveyors'), matching the order a buyer sees in the dropdown.
      const key = taxonomyKey(minor);
      minorMap.set(key, minor);
      if (!taxonomyIndex.byMinorKey.has(key)) {
        taxonomyIndex.byMinorKey.set(key, { major: group.majorCategory, minor });
      }
    });
  });
  taxonomyIndex.loadedAt = Date.now();
  taxonomyIndex.groupCount = taxonomyIndex.majorByKey.size;
  return taxonomyIndex;
}

// Pre-initialize index from DEFAULT_CATEGORY_TAXONOMY
primeTaxonomyIndex(DEFAULT_CATEGORY_TAXONOMY);

/** Check if a minor category belongs to a given major category in the taxonomy */
function isMinorUnderMajor(major, minor) {
  if (!major || !minor) return false;
  const canonical = canonicalMajor(major) || major;
  const majorKey = taxonomyKey(canonical);
  const minorKey = taxonomyKey(minor);
  const minorMap = taxonomyIndex.minorsByMajorKey.get(majorKey);
  if (!minorMap) return false;
  if (minorMap.has(minorKey)) return true;
  const alias = aliasForStatedCategory(minor);
  if (alias && minorMap.has(taxonomyKey(alias))) return true;
  for (const masterKey of minorMap.keys()) {
    if (masterKey.includes(minorKey) || minorKey.includes(masterKey)) {
      return true;
    }
  }
  return false;
}

/** Get all minor categories for a given major category */
function getMinorsForMajor(major) {
  if (!major) return [];
  const majorKey = taxonomyKey(major);
  const minorMap = taxonomyIndex.minorsByMajorKey.get(majorKey);
  return minorMap ? Array.from(minorMap.values()) : [];
}

/**
 * The category names the taxonomy master holds, for constraining model output.
 * Only meaningful after ensureTaxonomyLoaded(); empty before that.
 */
function taxonomyCategoryNames() {
  const majors = [...taxonomyIndex.majorByKey.values()];
  const minors = [...new Set([...taxonomyIndex.byMinorKey.values()].map((pair) => pair.minor))];
  return { majors, minors };
}

/** Drop the cached index so the next ingest reloads it. */
function resetTaxonomyIndex() {
  taxonomyIndex.majorByKey = new Map();
  taxonomyIndex.byMinorKey = new Map();
  taxonomyIndex.minorsByMajorKey = new Map();
  taxonomyIndex.loadedAt = 0;
  taxonomyIndex.groupCount = 0;
}

/**
 * Load the taxonomy index if it is empty or stale.
 *
 * Reads from category_division in database, falling back to DEFAULT_CATEGORY_TAXONOMY
 * if the database has 0 category rows or the read fails.
 */
async function ensureTaxonomyLoaded() {
  const isFresh =
    taxonomyIndex.loadedAt > 0 && Date.now() - taxonomyIndex.loadedAt < TAXONOMY_CACHE_TTL_MS;
  if (isFresh && taxonomyIndex.groupCount > 0) return taxonomyIndex;

  try {
    const groups = await buyerProfileQueries.findCategoryTaxonomy();
    if (Array.isArray(groups) && groups.length > 0) {
      primeTaxonomyIndex(groups);
      logger.info(
        'Category taxonomy index loaded for RFQ classification',
        { majorCount: taxonomyIndex.majorByKey.size, minorCount: taxonomyIndex.byMinorKey.size },
        'RFQ_INGESTION'
      );
    } else if (taxonomyIndex.groupCount === 0) {
      primeTaxonomyIndex(DEFAULT_CATEGORY_TAXONOMY);
    }
  } catch (err) {
    logger.error('Could not load the category taxonomy for RFQ classification', err, 'RFQ_INGESTION');
    if (taxonomyIndex.groupCount === 0) {
      primeTaxonomyIndex(DEFAULT_CATEGORY_TAXONOMY);
    }
  }

  return taxonomyIndex;
}

/** The taxonomy's own spelling of a major, or null when it is not one. */
function canonicalMajor(value) {
  if (!value) return null;
  const key = taxonomyKey(value);
  const direct = taxonomyIndex.majorByKey.get(key);
  if (direct) return direct;
  const alias = MAJOR_CATEGORY_ALIASES && MAJOR_CATEGORY_ALIASES[key];
  if (alias) {
    return taxonomyIndex.majorByKey.get(taxonomyKey(alias)) || alias;
  }
  return null;
}

/** The taxonomy pair owning a minor category, or null when it is not one. */
function taxonomyPairForMinor(value) {
  return taxonomyIndex.byMinorKey.get(taxonomyKey(value)) || null;
}

/**
 * Settle a stated category into a pair the review grid can render.
 *
 * Succeeds only when the stated minor is a real taxonomy minor or alias.
 * If the stated major owns that minor, it is kept; otherwise the major that
 * genuinely owns the minor is returned to prevent invalid major-minor combinations.
 */
function resolveStatedCategory(statedMinor, statedMajor) {
  if (!statedMinor) return null;
  const trimmed = String(statedMinor).trim();
  const directPair = taxonomyPairForMinor(trimmed);
  const alias = aliasForStatedCategory(trimmed);
  const aliasPair = alias ? taxonomyPairForMinor(alias) : null;
  const pair = directPair || aliasPair;
  if (!pair) return null;

  // Never allow an invalid major-minor combination: only use statedMajor if it genuinely owns this minor.
  const canonicalStatedMajor = canonicalMajor(statedMajor);
  const majorToUse = (canonicalStatedMajor && isMinorUnderMajor(canonicalStatedMajor, pair.minor))
    ? canonicalStatedMajor
    : pair.major;

  return { major: majorToUse, minor: pair.minor };
}

/**
 * The real taxonomy minor a document's umbrella category label maps to, or '' if
 * the label is not a known alias. Matched case-insensitively on the trimmed
 * value. Returns a plain string so the caller can hand it straight to
 * taxonomyPairForMinor for the usual taxonomy validation.
 */
function aliasForStatedCategory(value) {
  if (!value || typeof value !== 'string') return '';
  return STATED_CATEGORY_ALIASES[value.trim().toLowerCase()] || '';
}

/**
 * A category string that reads like a placeholder carries no routing value, so
 * it must not short-circuit keyword matching.
 */
function isGenericCategory(value) {
  if (!value || typeof value !== 'string') return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return true;
  return GENERIC_CATEGORY_TOKENS.some(
    (token) => normalized === token || normalized.startsWith(`${token} `) || normalized.endsWith(` ${token}`)
  );
}

/**
 * Resolve a major/minor pair from free text by domain keyword.
 * Prioritizes whole word boundaries and optionally excludes raw material keywords.
 * Returns null when nothing matches, so the caller can fall through.
 */
function matchByKeyword(text, options = {}) {
  if (!text) return null;
  const haystack = String(text).toLowerCase();
  const hit = KEYWORDS_BY_LENGTH.find((keyword) => {
    if (options.excludeMaterials && MATERIAL_ONLY_KEYWORD_SET.has(keyword.toLowerCase())) {
      return false;
    }
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[\\s,./\\-_();:\\[\\]{}+*&|!@#$%^~=])${escaped}(?:s|es)?(?:$|[\\s,./\\-_();:\\[\\]{}+*&|!@#$%^~=])`, 'i');
    return regex.test(haystack);
  });
  return hit ? { ...DOMAIN_KEYWORD_MAP[hit], keyword: hit } : null;
}

/**
 * Classify a single line item independently, prioritizing product description first.
 *
 * Precedence:
 * 1. Explicit item category (if valid in taxonomy)
 * 2. Item Description — highest priority product classification
 * 3. Product purpose and technical specifications (excluding raw material keywords)
 * 4. Combined item text (excluding raw material keywords)
 * 5. Document payload-wide category fallback
 * 6. Default unclassified (never invent invalid category pairs)
 * Default minor category for each major category, used as a fallback when an item
 * belongs to a major category but no more specific minor could be resolved.
 */
function defaultMinorForMajor(major) {
  if (!major) return '';
  const key = taxonomyKey(major);
  const compactKey = key.replace(/[^a-z0-9]/g, '');
  const defaults = {
    'it': 'Hardware',
    'engineeringspareselectrical': 'Other Electrical Items',
    'engineeringsparesmechanical': 'Hardwares',
    'civilworks': 'Plumbing',
    'occuptionalhealthandsafety': 'Seafty Equipments',
    'packingmaterial': 'Plastic Packaging',
    'logistics': 'Road transport',
    'rawmaterial': 'Chemicals',
    'professionalservices': 'Consultant',
    'capexequipmentmachinery': 'Material Handling Equipments',
    'retailrepairmaintenance': 'Equipment Repair & Maintenance',
    'othersnewproduct': 'Office & security Cabins',
    'othersnewservice': 'Warehousing',
  };
  if (defaults[compactKey]) return defaults[compactKey];
  const minors = getMinorsForMajor(major);
  return (minors && minors.length > 0) ? minors[0] : '';
}

/**
 * Classify a single line item, mirroring the Java precedence chain.
 *
 * @param {Object} item raw or partially normalised line item
 * @param {string} [payloadCategory] category stated once for the whole payload
 * @returns {{majorCategory: string, minorCategory: string, category: string,
 *   categoryConfidence: number, classificationStatus: string}}
 */
function classifyLineItem(item, payloadCategory, payloadMinorCategory) {
  // 1. An explicit, meaningful category on the item itself wins outright if valid.
  const explicitMinor = item.minorCategory || item.category;
  if (!isGenericCategory(explicitMinor)) {
    const resolved = resolveStatedCategory(explicitMinor, item.majorCategory);
    if (resolved) {
      return {
        majorCategory: resolved.major,
        minorCategory: resolved.minor,
        category: resolved.minor,
        categoryConfidence: CONFIDENCE.EXPLICIT,
        classificationStatus: STATUS.EXPLICIT,
      };
    }
  }

  // 2. Item Description — HIGHEST PRIORITY: Classify based on the actual product
  const itemDesc = String(item.itemName || '').trim();
  const itemDescMatch = matchByKeyword(itemDesc);
  if (itemDescMatch) {
    return {
      majorCategory: itemDescMatch.major,
      minorCategory: itemDescMatch.minor,
      category: itemDescMatch.minor,
      categoryConfidence: CONFIDENCE.KEYWORD,
      classificationStatus: STATUS.KEYWORD,
    };
  }

  // 3. Technical specifications: exclude raw material keywords so specs like
  // "stainless steel chest piece" do not misclassify a finished product (e.g. Stethoscope) as Steels.
  const specs = String(item.technicalSpecs || '').trim();
  if (specs) {
    const specsMatch = matchByKeyword(specs, { excludeMaterials: true });
    if (specsMatch) {
      return {
        majorCategory: specsMatch.major,
        minorCategory: specsMatch.minor,
        category: specsMatch.minor,
        categoryConfidence: CONFIDENCE.KEYWORD,
        classificationStatus: STATUS.KEYWORD,
      };
    }

    if (itemDesc) {
      const combinedMatch = matchByKeyword(`${itemDesc} ${specs}`, { excludeMaterials: true });
      if (combinedMatch) {
        return {
          majorCategory: combinedMatch.major,
          minorCategory: combinedMatch.minor,
          category: combinedMatch.minor,
          categoryConfidence: CONFIDENCE.KEYWORD,
          classificationStatus: STATUS.KEYWORD,
        };
      }
    }
  }

  // 4. A category or minorCategory stated once for the whole payload applies as a fallback when the item itself has no match.
  const candidatePayloadCategory = payloadMinorCategory || payloadCategory;
  if (!isGenericCategory(candidatePayloadCategory)) {
    const resolved = resolveStatedCategory(candidatePayloadCategory, item.majorCategory);
    if (resolved) {
      return {
        majorCategory: resolved.major,
        minorCategory: resolved.minor,
        category: resolved.minor,
        categoryConfidence: CONFIDENCE.EXPLICIT,
        classificationStatus: STATUS.EXPLICIT,
      };
    }
  }
  if (payloadMinorCategory && payloadCategory && !isGenericCategory(payloadCategory)) {
    const resolved = resolveStatedCategory(payloadCategory, item.majorCategory);
    if (resolved) {
      return {
        majorCategory: resolved.major,
        minorCategory: resolved.minor,
        category: resolved.minor,
        categoryConfidence: CONFIDENCE.EXPLICIT,
        classificationStatus: STATUS.EXPLICIT,
      };
    }
  }

  // 5. Stated category fallback.
  // If the document stated a category (its own, or payloadCategory), inspect it.
  const statedCategory = !isGenericCategory(item.minorCategory || item.category)
    ? String(item.minorCategory || item.category).trim()
    : '';
  const statedMajor = !isGenericCategory(item.majorCategory) ? String(item.majorCategory).trim() : '';

  const finalMajor = canonicalMajor(statedMajor) || (canonicalMajor(statedCategory) ? canonicalMajor(statedCategory) : '');
  const finalMinor = (!finalMajor && statedCategory) ? statedCategory : '';

  return {
    majorCategory: finalMajor,
    minorCategory: finalMinor,
    category: finalMinor,
    categoryConfidence: CONFIDENCE.DEFAULT,
    classificationStatus: STATUS.DEFAULT,
  };
}

/**
 * ISO date (yyyy-mm-dd) a fixed number of days from now, used when an ingested
 * row carries no target date of its own.
 */
function defaultTargetDate(offsetDays = DELIVERY_DATE_OFFSET_DAYS) {
  const due = new Date();
  due.setDate(due.getDate() + offsetDays);
  return due.toISOString().slice(0, 10);
}

/**
 * Ensures an extracted or stated delivery date is in the future.
 * If missing, invalid, or in the past, returns current date + offsetDays (default 5).
 * Preserves explicitly provided future dates (>= today).
 */
function ensureFutureDeliveryDate(dateInput, offsetDays = DELIVERY_DATE_OFFSET_DAYS) {
  const fallback = defaultTargetDate(offsetDays);
  if (!dateInput) return fallback;
  const str = String(dateInput).trim();
  if (!str) return fallback;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (str < todayStr) return fallback;
    const [y, m, d] = str.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() !== m - 1 || dateObj.getUTCDate() !== d) {
      return fallback;
    }
    return str;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // Handle Excel Julian serial numbers (e.g. 46351 for 2026-11-25)
  if (/^\d{5}(?:\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    if (num >= 35000 && num <= 65000) {
      // Use midday (+0.5) to avoid timezone boundary shifts
      const dateObj = new Date(Math.round((num - 25569 + 0.5) * 86400 * 1000));
      if (!isNaN(dateObj.getTime())) {
        const iso = dateObj.toISOString().slice(0, 10);
        return iso >= todayStr ? iso : fallback;
      }
    }
  }

  // Check DD/MM/YYYY or DD-MM-YYYY (common in UK/India/EU procurements)
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return iso >= todayStr ? iso : fallback;
    }
  }

  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return fallback;

  // Infer missing year when V8 defaults year-less string (e.g. "28 November") to 2001
  if (parsed.getFullYear() === 2001 && !str.includes('2001')) {
    const currentYear = new Date().getFullYear();
    parsed.setFullYear(currentYear);
    const tempIso = `${currentYear}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    if (tempIso < todayStr) {
      parsed.setFullYear(currentYear + 1);
    }
  }

  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  const targetIso = `${y}-${m}-${d}`;

  if (targetIso < todayStr) return fallback;
  return targetIso;
}

/**
 * Coerce a spreadsheet quantity into a usable positive number.
 * Anything absent, non-numeric or <= 0 returns null. The quantity is then missing
 * and is reported as missing; it is never defaulted to a number the document did not state.
 */
function normalizeQuantity(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/,/g, '').trim();
    const match = cleaned.match(/^\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

/**
 * Coerce a monetary field into a usable positive number, or null when the
 * document did not state one.
 *
 * Accepts the shapes real documents produce: a plain number, or a string still
 * carrying a currency word, symbol or grouping separators ("Rs. 1,45,000/-").
 * Zero and negative figures count as "not stated" so they can never overwrite a
 * genuine total further down the pipeline.
 */
function normalizeAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;

  // Isolate the first number rather than stripping non-digits, because stripping
  // would turn the abbreviation dot in "Rs. 4,500" into a decimal point and read
  // the amount as 0.45. Grouping commas are dropped afterwards, which handles
  // both 1,45,000 (Indian) and 145,000 (Western) layouts.
  const match = raw.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Value of one line: the stated line total when the document printed one, else
 * the stated unit rate multiplied by the quantity. Null when neither was priced,
 * or when the rate is stated but the quantity is missing, so the value cannot be
 * computed. Either way the line stays out of the budget instead of counting as zero.
 */
function lineItemValue(raw, quantity) {
  const total = normalizeAmount(raw.totalPrice ?? raw.amount);
  if (total !== null) return total;

  const unitPrice = normalizeAmount(raw.unitPrice ?? raw.rate);
  if (unitPrice === null || quantity === null) return null;
  return unitPrice * quantity;
}

/**
 * Estimated budget for the whole requirement.
 *
 * A total stated on the document wins, because a grand total may include freight
 * or taxes that the individual lines do not. Otherwise the priced lines are
 * summed. Returns null when the document carried no pricing at all, so the buyer
 * is shown an empty field to fill in rather than a fabricated figure.
 */
function deriveEstimatedBudget(statedTotal, valuedLines) {
  const stated = normalizeAmount(statedTotal);
  if (stated !== null) return stated;

  const priced = valuedLines.filter((value) => value !== null);
  if (priced.length === 0) return null;

  // Rounded to whole currency units: a summed float can otherwise land on
  // 145000.00000000003 and render with a spurious decimal tail.
  return Math.round(priced.reduce((sum, value) => sum + value, 0));
}

/**
 * Composite key used to collapse duplicate rows inside a single ingest, matching
 * the Java buildDeduplicationKey field order.
 */
function buildDeduplicationKey(item) {
  return [item.itemName, item.quantity, item.unit, item.targetDate, item.technicalSpecs]
    .map((part) => String(part == null ? '' : part).trim().toLowerCase())
    .join('|');
}

/**
 * Normalise, deduplicate and classify a batch of extracted rows.
 *
 * @param {Array<Object>} rawItems rows as extracted from a document or email
 * @param {Object} [options]
 * @param {string} [options.category] category stated once for the whole payload
 * @returns {{entities: Array<Object>, duplicatesRemoved: number,
 *   lineValues: Array<number|null>}} lineValues is index-aligned with entities
 */
function normalizeLineItems(rawItems, options = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const seen = new Set();
  const entities = [];
  // Only accepted rows are valued, so a collapsed duplicate cannot be counted twice.
  const lineValues = [];
  let duplicatesRemoved = 0;

  items.forEach((raw, index) => {
    // A sparse spreadsheet can yield null or primitive rows; skipping them keeps
    // one malformed cell from failing the whole ingest with a 500.
    if (!raw || typeof raw !== 'object') return;

    const itemName = String(raw.itemName || raw.itemDescription || raw.description || '').trim();
    // A row with no description cannot be quoted against, so it is dropped
    // rather than surfaced as a blank line for the buyer to clean up.
    if (!itemName) return;

    if (options.requireValidQuantity) {
      if (raw.quantity === null || raw.quantity === undefined || raw.quantity === '') {
        return;
      }
      const rawNum = typeof raw.quantity === 'number'
        ? raw.quantity
        : Number(String(raw.quantity).replace(/,/g, '').trim());
      if (!Number.isFinite(rawNum) || rawNum <= 0) {
        return;
      }
    }

    const normalized = {
      id: raw.id || `ent-ingested-${Date.now()}-${index}`,
      itemName,
      quantity: normalizeQuantity(raw.quantity),
      unit: String(raw.unit || raw.uom || '').trim() || null,
      targetDate: (options.allowEmptyDeliveryDate || options.source === 'ai_extraction')
        ? (raw.targetDate ? (options.ensureFutureDate ? ensureFutureDeliveryDate(raw.targetDate, DELIVERY_DATE_OFFSET_DAYS) : String(raw.targetDate).trim()) : '')
        : (options.ensureFutureDate
            ? (raw.targetDate ? ensureFutureDeliveryDate(raw.targetDate, DELIVERY_DATE_OFFSET_DAYS) : '')
            : String(raw.targetDate || '').trim()),
      technicalSpecs: String(raw.technicalSpecs || raw.specifications || raw.specification || '').trim(),
      brand: String(raw.brand || '').trim(),
      deliveryCity: String(raw.deliveryCity || '').trim(),
      deliveryState: String(raw.deliveryState || '').trim(),
      deliveryPincode: String(raw.deliveryPincode || '').trim(),
      deliveryLocation: String(raw.deliveryLocation || '').trim(),
    };

    const key = buildDeduplicationKey(normalized);
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      return;
    }
    seen.add(key);

    const classification = classifyLineItem({ ...raw, ...normalized }, options.category, options.minorCategory);
    entities.push({
      ...normalized,
      ...classification,
      confidence: Math.round(classification.categoryConfidence * 1000) / 10,
    });
    lineValues.push(lineItemValue(raw, normalized.quantity));
  });

  return { entities, duplicatesRemoved, lineValues };
}

/**
 * Derive the RFQ title from its line items, the way RFQBuilderService does:
 * the first item's description, pluralised when the RFQ covers several items,
 * and truncated so it fits the RFQ header.
 */
function deriveTitle(entities) {
  if (entities.length === 0) return '';
  const lead = entities[0].itemName;
  const suffix = entities.length > 1 ? TITLE_SUFFIX_MULTIPLE : TITLE_SUFFIX_SINGLE;
  const title = `${lead}${suffix}`;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : title;
}

/**
 * Turn raw extracted rows into a review-ready RFQ draft.
 *
 * This is the endpoint-facing entry point: it returns the classified line items
 * plus the header fields the wizard pre-fills, and a breakdown the buyer can use
 * to judge how much of the extraction needs manual attention.
 *
 * @param {Object} payload
 * @param {Array<Object>} payload.lineItems raw extracted rows
 * @param {string} [payload.category] category stated once for the whole payload
 * @param {string} [payload.title] explicit title, else derived from the items
 * @param {number|string} [payload.estimatedBudget] overall value stated on the
 *   document, else derived by summing the priced line items
 * @param {string} [payload.source] where the rows came from
 * @param {string} [payload.sourceFileName]
 * @param {string} [payload.sourceEmail]
 * @param {boolean} [payload.requireValidQuantity] enforce valid positive quantities
 */
async function buildRFQDraft(payload = {}, options = {}) {
  // Loaded once here rather than per line item, so classification below stays
  // synchronous and one ingest costs at most one taxonomy read.
  await ensureTaxonomyLoaded();

  const allowEmptyDeliveryDate = Boolean(
    payload.allowEmptyDeliveryDate ||
    options.allowEmptyDeliveryDate ||
    payload.source === 'ai_extraction' ||
    options.source === 'ai_extraction'
  );

  const { entities, duplicatesRemoved, lineValues } = normalizeLineItems(payload.lineItems, {
    category: payload.category,
    majorCategory: payload.majorCategory,
    minorCategory: payload.minorCategory,
    requireValidQuantity: Boolean(payload.requireValidQuantity),
    ensureFutureDate: Boolean(payload.ensureFutureDate || options.ensureFutureDate),
    allowEmptyDeliveryDate,
    source: payload.source || options.source,
  });

  // A declared major category (e.g. the email's "Category: Civil Works") is the
  // buyer's own statement of what the RFQ is for, so it decides the RFQ header.
  // Items with no major of their own take it; items whose own classification
  // conflicts with it are kept as classified but flagged for review.
  // A declared minor (the model may return either level) resolves to its own major.
  const declaredMajor =
    canonicalMajor(payload.majorCategory || payload.category) ||
    taxonomyPairForMinor(payload.minorCategory || payload.category)?.major ||
    '';
  const declaredMinor =
    (payload.minorCategory && taxonomyPairForMinor(payload.minorCategory)?.minor) ||
    (payload.category && taxonomyPairForMinor(payload.category)?.minor) ||
    (payload.minorCategory && declaredMajor && isMinorUnderMajor(declaredMajor, payload.minorCategory) ? payload.minorCategory : '') ||
    '';
  if (declaredMajor) {
    entities.forEach((entity) => {
      if (!entity.majorCategory) {
        entity.majorCategory = declaredMajor;
      } else if (entity.majorCategory !== declaredMajor) {
        entity.categoryMismatch = true;
      }
      if (!entity.minorCategory || entity.minorCategory === entity.majorCategory) {
        entity.minorCategory = (declaredMinor && isMinorUnderMajor(entity.majorCategory, declaredMinor))
          ? declaredMinor
          : defaultMinorForMajor(entity.majorCategory);
        entity.category = entity.minorCategory;
      }
    });
  }

  // No generic title is invented. With no usable line item and no explicit title,
  // the title is blank and the caller decides what to do with it.
  const derivedTitle = deriveTitle(entities);
  const title = (payload.source === 'email_gateway')
    ? derivedTitle
    : (String(payload.title || '').trim() || derivedTitle);

  // The RFQ header category follows the majority of its line items rather than
  // just the first, so a mixed BOQ lands in the category it mostly belongs to.
  // Unclassified items are excluded from the vote — otherwise a BOQ that mostly
  // failed to classify would give the RFQ header a blank category even when some
  // items did resolve. If nothing classified, the header category is blank and
  // the buyer picks it in the review step.
  const majorCounts = entities.reduce((acc, e) => {
    if (!e.majorCategory) return acc;
    acc[e.majorCategory] = (acc[e.majorCategory] || 0) + 1;
    return acc;
  }, {});
  const dominantMajor = Object.keys(majorCounts).sort((a, b) => majorCounts[b] - majorCounts[a])[0] || '';

  const fallbackCategory = (entities.length > 0 && !declaredMajor && !dominantMajor)
    ? 'Others – New Product'
    : '';
  const headerCategory = declaredMajor || dominantMajor || fallbackCategory;

  // When a header category is resolved, assign it to line items that have no major category
  if (headerCategory) {
    entities.forEach((entity) => {
      if (!entity.majorCategory) {
        entity.majorCategory = headerCategory;
      }
      if (!entity.minorCategory || entity.minorCategory === entity.majorCategory) {
        entity.minorCategory = (declaredMinor && isMinorUnderMajor(entity.majorCategory, declaredMinor))
          ? declaredMinor
          : defaultMinorForMajor(entity.majorCategory);
        entity.category = entity.minorCategory;
      }
    });
  }

  // Derive header minor category
  const minorCounts = entities.reduce((acc, e) => {
    if (!e.minorCategory || e.minorCategory === e.majorCategory) return acc;
    acc[e.minorCategory] = (acc[e.minorCategory] || 0) + 1;
    return acc;
  }, {});
  const dominantMinor = Object.keys(minorCounts).sort((a, b) => minorCounts[b] - minorCounts[a])[0] || '';

  const headerMinor = (declaredMinor && (!headerCategory || isMinorUnderMajor(headerCategory, declaredMinor)))
    ? declaredMinor
    : (dominantMinor && (!headerCategory || isMinorUnderMajor(headerCategory, dominantMinor))
        ? dominantMinor
        : defaultMinorForMajor(headerCategory));

  const needsReview = entities.filter(
    (e) => !e.majorCategory || !e.minorCategory || e.categoryMismatch || e.minorCategory === e.majorCategory || e.classificationStatus === STATUS.DEFAULT || e.majorCategory === 'Others – New Product'
  ).length;
  const estimatedBudget = deriveEstimatedBudget(payload.estimatedBudget, lineValues);

  const candidateDates = entities.map((e) => e && e.targetDate).filter(Boolean);
  const earliestEntityDate = candidateDates.length > 0 ? [...candidateDates].sort()[0] : null;

  const resolvedDate = payload.targetDeliveryDate || earliestEntityDate || null;
  const defaultDateFallback = allowEmptyDeliveryDate ? '' : defaultTargetDate();

  const draft = {
    title,
    category: headerCategory,
    majorCategory: headerCategory,
    minorCategory: headerMinor,
    targetDeliveryDate: (options.ensureFutureDate || payload.ensureFutureDate)
      ? (resolvedDate
          ? ensureFutureDeliveryDate(resolvedDate, DELIVERY_DATE_OFFSET_DAYS)
          : defaultDateFallback)
      : (resolvedDate || defaultDateFallback),
    // Null rather than a placeholder figure: the wizard shows an empty budget
    // field so the buyer supplies the number the document did not state.
    estimatedBudget,
    extractedEntities: entities,
    deliveryLocation:
      (entities.length > 0 && entities[0].deliveryLocation) || payload.deliveryLocation || '',
    deliveryCity:
      (entities.length > 0 && entities[0].deliveryCity) || payload.deliveryCity || '',
    deliveryState:
      (entities.length > 0 && entities[0].deliveryState) || payload.deliveryState || '',
    deliveryPincode:
      (entities.length > 0 && entities[0].deliveryPincode) || payload.deliveryPincode || '',
    source: payload.source || 'web_portal',
    ...(payload.sourceFileName ? { sourceFileName: payload.sourceFileName } : {}),
    ...(payload.sourceEmail ? { sourceEmail: payload.sourceEmail } : {}),
  };

  const classification = {
    totalExtracted: Array.isArray(payload.lineItems) ? payload.lineItems.length : 0,
    accepted: entities.length,
    duplicatesRemoved,
    needsReview,
    autoClassified: entities.length - needsReview,
  };

  logger.info(
    `Ingested ${classification.accepted} line items (${classification.needsReview} need review)`,
    classification,
    'RFQ_INGESTION'
  );

  return { draft, classification };
}

module.exports = {
  taxonomyKey,
  primeTaxonomyIndex,
  resetTaxonomyIndex,
  ensureTaxonomyLoaded,
  taxonomyCategoryNames,
  canonicalMajor,
  taxonomyPairForMinor,
  aliasForStatedCategory,
  isGenericCategory,
  matchByKeyword,
  classifyLineItem,
  defaultMinorForMajor,
  defaultTargetDate,
  ensureFutureDeliveryDate,
  normalizeQuantity,
  normalizeAmount,
  lineItemValue,
  deriveEstimatedBudget,
  buildDeduplicationKey,
  normalizeLineItems,
  isMinorUnderMajor,
  getMinorsForMajor,
  deriveTitle,
  buildRFQDraft,
};
