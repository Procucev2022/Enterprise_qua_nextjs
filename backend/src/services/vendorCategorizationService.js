// ==============================================================================
// VENDOR CATEGORISATION SERVICE (AI)
// ==============================================================================
// Classifies a supplier from its actual historical purchasing data.
//
// The whole point of this service is the evidence it uses. A supplier is NOT
// categorised from its company name, its industry or its business type — those
// are exactly the signals that put "Nova Electrical Spares & Cable Trays" in
// Electrical when every PO it ever received was for cable trays and nothing
// electrical. What the model reads is the aggregated PO line-item history:
// descriptions, specifications, quantities, units, purchase frequency, PO count,
// spend and the departments that bought. The vendor master supplies identity and
// context only.
//
// Four guarantees this module keeps:
//
//   1. One model call per vendor, not one per PO row. The purchasing history is
//      aggregated into a profile first (see findVendorPurchasingProfiles), which
//      is what makes a 10,000-line dump cost 8 calls for 8 suppliers.
//
//   2. The model chooses from the buyer's OWN category master. It is given the
//      list and told to return NEW_CATEGORY_SUGGESTION rather than invent one.
//      A returned category that is not in the master is never silently
//      accepted — it is downgraded to a suggestion the buyer must review.
//
//   3. A reply is parsed and validated, never interpreted. Anything that is not
//      the documented JSON shape is retried, and then recorded as a failure. No
//      partially-written category ever reaches the mapping row.
//
//   4. No vendor without PO history is ever sent here. That is enforced in the
//      data (seedCategoryMappings marks them SELF_MAP_REQUIRED/COMPLETED) and
//      asserted again below, because it is the rule most costly to get wrong.
//
// The transport, model fallback chain, timeout and shared budget all come from
// geminiService.generateJson — this module owns the prompt and the validation.
// ==============================================================================

const geminiService = require('./geminiService');
const { logger } = require('./loggerService');
const vendorIngestionQueries = require('../db/vendorIngestionQueries');
const {
  VENDOR_MAPPING_STATUS,
  VENDOR_MAPPING_SOURCE,
  VENDOR_CONFIDENCE_BANDS,
  VENDOR_INGESTION_CONFIG,
  VENDOR_INGESTION_MESSAGES,
} = require('../config/constants');

const LOG_CATEGORY = 'VENDOR_CATEGORIZATION';

/** Outcomes of one classification attempt, mirrored into ai_classification_logs. */
const CLASSIFICATION_STATUS = {
  SUCCESS: 'SUCCESS',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  AI_FAILED: 'AI_FAILED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NO_CONTENT: 'NO_CONTENT',
};

/** Sentinel the model must return when nothing in the master fits. */
const NEW_CATEGORY_SENTINEL = 'NEW_CATEGORY_SUGGESTION';

// ------------------------------------------------------------------------------
// PROMPT
// ------------------------------------------------------------------------------

/**
 * Instruction block. The prohibitions are load-bearing, in the same way as the
 * ones in geminiService's extraction prompt: without the "do not infer from the
 * company name" rule the model reliably classifies "Everest Steel & Infra
 * Structures" from its name into Civil Works even when its POs are all bearings.
 */
const CATEGORISATION_INSTRUCTIONS = `You are categorising a supplier for an enterprise procurement platform, based primarily on their actual historical purchasing/supply data.

EVIDENCE RULES — these override everything else.
- Categorise from the PURCHASE ORDER HISTORY below: the line item descriptions, specifications, units, quantities, purchase frequency, PO count and spend.
- DO NOT infer a category solely from the company name, the industry or the business type. A name is a hint, never evidence.
- Prefer a category supported by MULTIPLE PO line items and a repeated purchasing pattern over one supported by a single line.
- Weight the categories by spend and PO count: what the supplier is repeatedly and materially bought from for is their primary category.
- If the PO history genuinely supports more than one area, pick the single best-supported major category and put the others in minorCategories.

CATEGORY MASTER — you MUST choose from this list.
- "primaryCategory" MUST be copied EXACTLY from the AVAILABLE MAJOR CATEGORIES list, character for character.
- Every entry in "minorCategories" MUST be copied EXACTLY from the AVAILABLE MINOR CATEGORIES for the primary category you chose.
- DO NOT invent, rename, merge, pluralise or reword a category. Do not create a new one.
- If, and only if, NOTHING in the list is a reasonable fit for the purchasing history, set "primaryCategory" to "${NEW_CATEGORY_SENTINEL}" and put the category you would have created in "suggestedNewCategory". A human will review it.

OTHER FIELDS
- "relevantProducts" are the concrete product lines evident in the PO history, in the supplier's own terms. Derived from the descriptions, not from the category names.
- "confidenceScore" is an integer 0-100 reflecting how strongly the PO history supports your choice. Few lines, vague descriptions or a mixed pattern must score LOW. Do not inflate it.
- "reason" is one or two sentences citing the actual purchasing evidence you used. Do not restate the category name as the reason.

Return a SINGLE JSON object with EXACTLY this shape, no surrounding prose and no markdown:
{
  "vendorCode": "String, echo the vendor code you were given",
  "primaryCategory": "String, one major category copied exactly from the list, or \\"${NEW_CATEGORY_SENTINEL}\\"",
  "minorCategories": ["String, minor categories copied exactly from the list for that major category"],
  "relevantProducts": ["String, concrete product lines evident in the PO history"],
  "confidenceScore": 0,
  "reason": "String, one or two sentences citing the purchasing evidence",
  "suggestedNewCategory": "String, only when primaryCategory is \\"${NEW_CATEGORY_SENTINEL}\\", else null"
}`;

/** Truncate a description so one noisy row cannot dominate the prompt budget. */
function clampDescription(value) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= VENDOR_INGESTION_CONFIG.AI_MAX_DESCRIPTION_CHARS) return text;
  return `${text.slice(0, VENDOR_INGESTION_CONFIG.AI_MAX_DESCRIPTION_CHARS)}…`;
}

/**
 * Render the buyer's category master as an explicit major -> minors listing.
 *
 * Written out in full rather than summarised: the model can only copy a category
 * exactly if it has actually been shown the exact string.
 */
function renderCategoryMaster(categoryMaster = []) {
  return categoryMaster
    .map((group) => {
      const minors = Array.isArray(group.minorCategories) ? group.minorCategories.filter(Boolean) : [];
      const minorText = minors.length > 0 ? minors.join('; ') : '(no sub-categories defined)';
      return `- ${group.majorCategory}\n    AVAILABLE MINOR CATEGORIES: ${minorText}`;
    })
    .join('\n');
}

/**
 * Summarise how often each distinct description repeats.
 *
 * Frequency is a first-class signal — a supplier bought from twelve times for
 * pumps is a pump supplier, whereas twelve one-off miscellaneous lines is not a
 * category at all — so it is counted here and shown to the model rather than
 * left for it to infer from a flat list.
 */
function summarizePurchasePattern(lineSummaries = []) {
  const counts = new Map();
  for (const line of lineSummaries) {
    const clamped = clampDescription(line);
    if (clamped === '') continue;
    counts.set(clamped, (counts.get(clamped) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, VENDOR_INGESTION_CONFIG.AI_MAX_PO_LINES_PER_VENDOR)
    .map(([description, occurrences]) => ({ description, occurrences }));
}

/**
 * Build the full prompt for one vendor.
 *
 * Exported so the shape can be asserted in tests without calling a model, and so
 * a reviewer can read exactly what leaves the server. Note what is NOT included:
 * no other supplier's data, no buyer contact details, no API key.
 */
function buildCategorizationPrompt({ vendorProfile, categoryMaster, horizon }) {
  const pattern = summarizePurchasePattern(vendorProfile.lineSummaries);
  const patternText =
    pattern.length > 0
      ? pattern
          .map((entry, index) =>
            entry.occurrences > 1
              ? `${index + 1}. ${entry.description}  [appears on ${entry.occurrences} PO lines]`
              : `${index + 1}. ${entry.description}`
          )
          .join('\n')
      : '(none)';

  const horizonText =
    horizon && horizon.startDate && horizon.endDate
      ? `${horizon.startDate} to ${horizon.endDate}`
      : 'not specified';

  const departments =
    Array.isArray(vendorProfile.departments) && vendorProfile.departments.length > 0
      ? vendorProfile.departments.join(', ')
      : '(not stated)';

  const existingCategories =
    Array.isArray(vendorProfile.existingCategories) && vendorProfile.existingCategories.length > 0
      ? vendorProfile.existingCategories.join(', ')
      : '(none in the source data)';

  return `${CATEGORISATION_INSTRUCTIONS}

AVAILABLE MAJOR CATEGORIES (the buyer's own category master — choose from these only):
${renderCategoryMaster(categoryMaster)}

SUPPLIER IDENTITY (context only — NOT evidence for the category):
- Vendor Code: ${vendorProfile.vendorCode || '(none)'}
- Company Name: ${vendorProfile.companyName}

PURCHASING HISTORY (this is the evidence):
- Time horizon analysed: ${horizonText}
- Distinct purchase orders: ${vendorProfile.poCount}
- PO line items: ${vendorProfile.poLineCount}
- Total spend in this period: ${vendorProfile.totalSpend}
- First PO in period: ${vendorProfile.firstPoDate || '(unknown)'}
- Most recent PO in period: ${vendorProfile.lastPoDate || '(unknown)'}
- Buying departments: ${departments}
- Category tags already present in the buyer's PO data: ${existingCategories}

PURCHASED LINE ITEMS (description | specification | quantity unit), most material first:
${patternText}`;
}

// ------------------------------------------------------------------------------
// RESPONSE VALIDATION
// ------------------------------------------------------------------------------

/** Case-insensitive, whitespace-tolerant lookup key for a category string. */
function categoryKey(value) {
  return String(value === null || value === undefined ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Index the master so a model reply can be resolved back to the exact string. */
function indexCategoryMaster(categoryMaster = []) {
  const majors = new Map();
  for (const group of categoryMaster) {
    const major = String(group.majorCategory || '').trim();
    if (major === '') continue;
    const minors = new Map();
    for (const minor of Array.isArray(group.minorCategories) ? group.minorCategories : []) {
      const trimmed = String(minor || '').trim();
      if (trimmed !== '') minors.set(categoryKey(trimmed), trimmed);
    }
    majors.set(categoryKey(major), { major, minors });
  }
  return majors;
}

/** Trim, de-duplicate and cap a string array from a model reply. */
function cleanStringList(value, max) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().replace(/\s+/g, ' ');
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Map a raw confidence value onto an integer 0-100, or null.
 *
 * A missing or unparseable score is null, not 0 and not 100. Null means "the
 * model did not tell us", which the caller treats as needing review — quietly
 * substituting a number would manufacture a certainty nobody expressed.
 */
function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 100) return 100;
  return Math.round(num);
}

/** High / medium / needs-review band for a confidence score. */
function confidenceBand(confidence) {
  if (confidence === null || confidence === undefined) return 'NEEDS_REVIEW';
  if (confidence >= VENDOR_CONFIDENCE_BANDS.HIGH_MIN) return 'HIGH';
  if (confidence >= VENDOR_CONFIDENCE_BANDS.MEDIUM_MIN) return 'MEDIUM';
  return 'NEEDS_REVIEW';
}

/**
 * Validate and normalise one model reply against the buyer's category master.
 *
 * Returns a discriminated result rather than throwing, so a bad reply is a
 * retryable outcome rather than an exception that has to be caught two layers up.
 *
 * The interesting case is a `primaryCategory` that is not in the master. The
 * model was told to return the sentinel instead, but models do invent categories
 * anyway. Rather than reject the whole reply — which throws away a perfectly good
 * reading of the purchase history — it is accepted as a NEW_CATEGORY_SUGGESTION
 * that the buyer must approve. That satisfies RULE 10 (no silent category
 * creation) without discarding the analysis.
 */
function validateAiResult(parsed, { categoryMaster = [] } = {}) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Reply was not a JSON object.' };
  }

  const rawPrimary = typeof parsed.primaryCategory === 'string' ? parsed.primaryCategory.trim() : '';
  if (rawPrimary === '') {
    return { valid: false, error: 'Reply had no primaryCategory.' };
  }

  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  const confidence = normalizeConfidence(parsed.confidenceScore);
  const relevantProducts = cleanStringList(parsed.relevantProducts, VENDOR_INGESTION_CONFIG.MAX_MINOR_CATEGORIES_PER_VENDOR);
  const majors = indexCategoryMaster(categoryMaster);

  // The model explicitly said nothing fits.
  if (categoryKey(rawPrimary) === categoryKey(NEW_CATEGORY_SENTINEL)) {
    const suggested =
      typeof parsed.suggestedNewCategory === 'string' ? parsed.suggestedNewCategory.trim() : '';
    return {
      valid: true,
      suggestion: {
        majorCategory: '',
        minorCategories: [],
        relevantProducts,
        confidence,
        reason,
        isNewCategorySuggestion: true,
        suggestedNewCategory: suggested,
        status: VENDOR_MAPPING_STATUS.NEW_CATEGORY_SUGGESTION,
        confidenceBand: confidenceBand(confidence),
      },
    };
  }

  const matchedMajor = majors.get(categoryKey(rawPrimary));

  // The model invented a category. Keep the analysis, demand human approval.
  if (!matchedMajor) {
    return {
      valid: true,
      suggestion: {
        majorCategory: '',
        minorCategories: [],
        relevantProducts,
        confidence,
        reason,
        isNewCategorySuggestion: true,
        suggestedNewCategory: rawPrimary,
        status: VENDOR_MAPPING_STATUS.NEW_CATEGORY_SUGGESTION,
        confidenceBand: confidenceBand(confidence),
      },
    };
  }

  // Keep only minors that genuinely belong to the chosen major, resolved back to
  // the master's exact casing. A minor from a different major is dropped rather
  // than re-parented, because re-parenting would assert a taxonomy relationship
  // the buyer never defined.
  const minorCategories = [];
  for (const candidate of cleanStringList(
    parsed.minorCategories,
    VENDOR_INGESTION_CONFIG.MAX_MINOR_CATEGORIES_PER_VENDOR
  )) {
    const exact = matchedMajor.minors.get(categoryKey(candidate));
    if (exact && !minorCategories.includes(exact)) minorCategories.push(exact);
  }

  // Below the review threshold the suggestion is held for a person regardless of
  // how confident the rest of the reply reads. A low-confidence guess must not
  // become a live vendor category on its own (RULE 9).
  const band = confidenceBand(confidence);
  const status =
    band === 'NEEDS_REVIEW' ? VENDOR_MAPPING_STATUS.PENDING_REVIEW : VENDOR_MAPPING_STATUS.AI_MAPPED;

  return {
    valid: true,
    suggestion: {
      majorCategory: matchedMajor.major,
      minorCategories,
      relevantProducts,
      confidence,
      reason,
      isNewCategorySuggestion: false,
      suggestedNewCategory: '',
      status,
      confidenceBand: band,
    },
  };
}

// ------------------------------------------------------------------------------
// CLASSIFICATION
// ------------------------------------------------------------------------------

/**
 * Classify one supplier.
 *
 * Never throws. Every outcome — success, an unusable reply, an unreachable model,
 * an unconfigured server — is returned as a status the batch runner can act on,
 * and is written to ai_classification_logs including the failures, so a support
 * engineer can see that a vendor was attempted and why it did not land.
 *
 * Retries are safe because nothing is persisted to the mapping until a reply has
 * validated: a failed attempt leaves the previous category exactly as it was.
 */
async function classifyVendor({ session, organizationId, mapping, vendorProfile, categoryMaster }) {
  // Asserted rather than assumed. seedCategoryMappings already keeps these out
  // of the queue, but this is the rule whose violation is most expensive — a
  // supplier categorised with no purchasing evidence at all — so it is checked
  // at the point of use too.
  if (!vendorProfile || vendorProfile.hasPoHistory !== true) {
    logger.warn(
      `Refusing to categorise ${mapping.companyName} — no PO history in the selected period`,
      { mappingId: mapping.id, vendorRecordId: mapping.vendorRecordId },
      LOG_CATEGORY
    );
    return { status: CLASSIFICATION_STATUS.NO_CONTENT, error: VENDOR_INGESTION_MESSAGES.MAPPING_NO_PO_HISTORY };
  }

  if (categoryMaster.length === 0) {
    return { status: CLASSIFICATION_STATUS.NO_CONTENT, error: VENDOR_INGESTION_MESSAGES.CATEGORY_MASTER_EMPTY };
  }

  const prompt = buildCategorizationPrompt({
    vendorProfile,
    categoryMaster,
    horizon: { startDate: session.horizonStart, endDate: session.horizonEnd },
  });

  let lastError = null;
  let lastStatus = CLASSIFICATION_STATUS.AI_FAILED;

  for (let attempt = 1; attempt <= VENDOR_INGESTION_CONFIG.AI_MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    const result = await geminiService.generateJson({
      prompt,
      label: `vendor categorisation for ${mapping.vendorCode || mapping.companyName}`,
    });
    const durationMs = Date.now() - startedAt;

    if (result.status === geminiService.EXTRACTION_STATUS.NOT_CONFIGURED) {
      await logClassification({
        session,
        organizationId,
        mapping,
        vendorProfile,
        prompt,
        attempt,
        durationMs,
        model: null,
        status: CLASSIFICATION_STATUS.NOT_CONFIGURED,
        error: VENDOR_INGESTION_MESSAGES.AI_NOT_CONFIGURED,
        response: null,
      });
      // Not retryable — the key will not appear between two attempts.
      return { status: CLASSIFICATION_STATUS.NOT_CONFIGURED, error: VENDOR_INGESTION_MESSAGES.AI_NOT_CONFIGURED };
    }

    if (result.status !== geminiService.EXTRACTION_STATUS.SUCCESS || !result.data) {
      lastStatus = CLASSIFICATION_STATUS.AI_FAILED;
      lastError = result.error || `Model returned ${result.status}.`;
      await logClassification({
        session,
        organizationId,
        mapping,
        vendorProfile,
        prompt,
        attempt,
        durationMs,
        model: result.model,
        status: lastStatus,
        error: lastError,
        response: null,
      });
      continue;
    }

    const validated = validateAiResult(result.data, { categoryMaster });
    if (!validated.valid) {
      lastStatus = CLASSIFICATION_STATUS.INVALID_RESPONSE;
      lastError = validated.error;
      await logClassification({
        session,
        organizationId,
        mapping,
        vendorProfile,
        prompt,
        attempt,
        durationMs,
        model: result.model,
        status: lastStatus,
        error: lastError,
        // The offending reply is kept so an invalid-shape bug can be diagnosed
        // from the record rather than reproduced.
        response: result.data,
      });
      continue;
    }

    await logClassification({
      session,
      organizationId,
      mapping,
      vendorProfile,
      prompt,
      attempt,
      durationMs,
      model: result.model,
      status: CLASSIFICATION_STATUS.SUCCESS,
      error: null,
      response: result.data,
    });

    return {
      status: CLASSIFICATION_STATUS.SUCCESS,
      suggestion: { ...validated.suggestion, model: result.model, source: VENDOR_MAPPING_SOURCE.AI },
      attempt,
    };
  }

  return { status: lastStatus, error: lastError || VENDOR_INGESTION_MESSAGES.AI_INVALID_RESPONSE };
}

/** Write one attempt to ai_classification_logs, swallowing a logging failure. */
async function logClassification({
  session,
  organizationId,
  mapping,
  vendorProfile,
  prompt,
  attempt,
  durationMs,
  model,
  status,
  error,
  response,
}) {
  try {
    await vendorIngestionQueries.insertAiClassificationLog({
      sessionId: session.id,
      organizationId,
      vendorRecordId: mapping.vendorRecordId,
      vendorCode: mapping.vendorCode,
      model,
      status,
      attempt,
      // Length only. The prompt embeds the buyer's category master and spend
      // detail, and this table is read by support tooling.
      promptChars: prompt ? prompt.length : 0,
      poCount: vendorProfile ? vendorProfile.poCount : 0,
      durationMs,
      error,
      response,
    });
  } catch (err) {
    // A classification must not fail because its audit row could not be written.
    logger.error('Failed to write AI classification log', err, LOG_CATEGORY);
  }
}

/**
 * Classify one batch of queued suppliers and persist each outcome.
 *
 * Sequential rather than parallel on purpose: the model chain already carries a
 * shared time budget, and firing a batch concurrently is the fastest way to hit
 * a provider rate limit and turn eight recoverable calls into eight failures.
 *
 * Returns per-vendor outcomes so the caller can advance the session's persisted
 * progress counters — which is what lets the UI show "42 / 100 vendors" without
 * the browser holding a request open for the whole job.
 */
async function runCategorizationBatch({ session, organizationId, mappings, profilesByRecordId, categoryMaster }) {
  const outcomes = [];

  for (const mapping of mappings) {
    const vendorProfile = profilesByRecordId.get(mapping.vendorRecordId);
    await vendorIngestionQueries.markMappingProcessing(mapping.id, organizationId);

    const result = await classifyVendor({
      session,
      organizationId,
      mapping,
      vendorProfile,
      categoryMaster,
    });

    if (result.status === CLASSIFICATION_STATUS.SUCCESS) {
      const saved = await vendorIngestionQueries.saveAiSuggestion(mapping.id, organizationId, result.suggestion);
      outcomes.push({
        mappingId: mapping.id,
        vendorRecordId: mapping.vendorRecordId,
        companyName: mapping.companyName,
        status: CLASSIFICATION_STATUS.SUCCESS,
        mapping: saved,
        suggestion: result.suggestion,
      });
      logger.info(
        `Categorised ${mapping.companyName} as ${result.suggestion.majorCategory || NEW_CATEGORY_SENTINEL}`,
        {
          mappingId: mapping.id,
          confidence: result.suggestion.confidence,
          band: result.suggestion.confidenceBand,
          poCount: vendorProfile ? vendorProfile.poCount : 0,
        },
        LOG_CATEGORY
      );
      continue;
    }

    await vendorIngestionQueries.markMappingFailed(mapping.id, organizationId, result.error);
    outcomes.push({
      mappingId: mapping.id,
      vendorRecordId: mapping.vendorRecordId,
      companyName: mapping.companyName,
      status: result.status,
      error: result.error,
    });
    logger.warn(
      `Categorisation failed for ${mapping.companyName}`,
      { mappingId: mapping.id, status: result.status, error: result.error },
      LOG_CATEGORY
    );
  }

  return outcomes;
}

module.exports = {
  CLASSIFICATION_STATUS,
  NEW_CATEGORY_SENTINEL,
  CATEGORISATION_INSTRUCTIONS,
  clampDescription,
  renderCategoryMaster,
  summarizePurchasePattern,
  buildCategorizationPrompt,
  categoryKey,
  indexCategoryMaster,
  cleanStringList,
  normalizeConfidence,
  confidenceBand,
  validateAiResult,
  classifyVendor,
  logClassification,
  runCategorizationBatch,
};
