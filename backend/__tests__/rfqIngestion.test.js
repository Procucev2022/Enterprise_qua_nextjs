const request = require('supertest');
const app = require('../src/app');
const ingestion = require('../src/services/rfqIngestionService');
const storeService = require('../src/services/storeService');
const { RFQ_CATEGORY_CLASSIFICATION, RFQ_INGESTION_CONFIG } = require('../src/config/constants');
const { authHeader } = require('./testHelpers');

const { STATUS, CONFIDENCE, DEFAULT_MAJOR_CATEGORY, DEFAULT_MINOR_CATEGORY } = RFQ_CATEGORY_CLASSIFICATION;

describe('RFQ ingestion service (AI line-item classification)', () => {
  // ── Generic category detection ─────────────────────────────────────────────
  describe('isGenericCategory', () => {
    test.each(['', '   ', 'various', 'Multiple', 'NOT SPECIFIED', 'n/a', 'misc', 'general goods'])(
      'treats %s as carrying no routing value',
      (value) => {
        expect(ingestion.isGenericCategory(value)).toBe(true);
      }
    );

    test.each([null, undefined, 42, {}])('treats the non-string %p as generic', (value) => {
      expect(ingestion.isGenericCategory(value)).toBe(true);
    });

    test.each(['Pumps & Accessories', 'Cables', 'TMT BARS'])('accepts the real category %s', (value) => {
      expect(ingestion.isGenericCategory(value)).toBe(false);
    });
  });

  // ── Keyword matching ───────────────────────────────────────────────────────
  describe('matchByKeyword', () => {
    test('prefers the longest keyword so a specific phrase wins', () => {
      // 'circuit breaker' and 'breaker'-like entries both appear; the specific
      // phrase must decide the minor category.
      expect(ingestion.matchByKeyword('400A Circuit Breaker MCCB').minor).toBe('Circuit Breakers');
      expect(ingestion.matchByKeyword('Centrifugal Pump 500 GPM').minor).toBe('Pumps & Accessories');
    });

    test.each([
      ['Flanged Gate Valve 4-inch', 'Hoses, Valves & Fittings'],
      ['XLPE Armoured Copper Cable', 'Cables'],
      ['Fe500D TMT Rebar 16mm', 'TMT BARS'],
      ['Rotary Screw Compressor', 'Compressors & Accessories'],
      ['Form 4b LV Switchgear', 'Electrical-Lv Switch Gears'],
    ])('maps %s to %s', (text, expected) => {
      expect(ingestion.matchByKeyword(text).minor).toBe(expected);
    });

    test('returns null when nothing matches so the caller can fall through', () => {
      expect(ingestion.matchByKeyword('Assorted unclassifiable widget')).toBeNull();
      expect(ingestion.matchByKeyword('')).toBeNull();
      expect(ingestion.matchByKeyword(null)).toBeNull();
    });
  });

  // ── Classification precedence, mirroring the Java service ──────────────────
  describe('classifyLineItem precedence', () => {
    test('1. an explicit item category wins over any keyword in the text', () => {
      const result = ingestion.classifyLineItem({
        itemName: 'Centrifugal Pump 500 GPM',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Bearings & Accessories',
      });
      expect(result.minorCategory).toBe('Bearings & Accessories');
      expect(result.classificationStatus).toBe(STATUS.EXPLICIT);
      expect(result.categoryConfidence).toBe(CONFIDENCE.EXPLICIT);
    });

    test('2. a payload-level category applies when the item has none', () => {
      const result = ingestion.classifyLineItem({ itemName: 'Unclassifiable widget' }, 'Panels');
      expect(result.minorCategory).toBe('Panels');
      expect(result.classificationStatus).toBe(STATUS.EXPLICIT);
    });

    test('2b. a generic payload category does not short-circuit keyword matching', () => {
      const result = ingestion.classifyLineItem({ itemName: 'Centrifugal Pump' }, 'various');
      expect(result.minorCategory).toBe('Pumps & Accessories');
      expect(result.classificationStatus).toBe(STATUS.KEYWORD);
    });

    test('3. keyword matching reads the technical specification too', () => {
      const result = ingestion.classifyLineItem({
        itemName: 'Unnamed assembly',
        technicalSpecs: 'ANSI 150 flanged gate valve body',
      });
      expect(result.minorCategory).toBe('Hoses, Valves & Fittings');
      expect(result.categoryConfidence).toBe(CONFIDENCE.KEYWORD);
    });

    test('4. falls back to the documented default and flags it for review', () => {
      const result = ingestion.classifyLineItem({ itemName: 'Assorted unclassifiable widget' });
      expect(result).toMatchObject({
        majorCategory: DEFAULT_MAJOR_CATEGORY,
        minorCategory: DEFAULT_MINOR_CATEGORY,
        classificationStatus: STATUS.DEFAULT,
        categoryConfidence: CONFIDENCE.DEFAULT,
      });
    });

    test('keeps an explicit major category alongside a payload-level minor', () => {
      const result = ingestion.classifyLineItem(
        { itemName: 'Widget', majorCategory: 'Civil Works' },
        'Roofing Sheets'
      );
      expect(result.majorCategory).toBe('Civil Works');
      expect(result.minorCategory).toBe('Roofing Sheets');
    });
  });

  // ── Field normalisation ────────────────────────────────────────────────────
  describe('normalizeQuantity', () => {
    test.each([
      [12, 12],
      ['24', 24],
      [2.5, 2.5],
    ])('keeps the usable quantity %p', (input, expected) => {
      expect(ingestion.normalizeQuantity(input)).toBe(expected);
    });

    test.each([0, -5, 'abc', null, undefined, ''])('defaults the unusable quantity %p to 1', (input) => {
      expect(ingestion.normalizeQuantity(input)).toBe(RFQ_INGESTION_CONFIG.DEFAULT_QUANTITY);
    });
  });

  // ── Monetary normalisation & budget derivation ─────────────────────────────
  describe('normalizeAmount', () => {
    test.each([
      [145000, 145000],
      ['145000', 145000],
      ['₹ 1,45,000', 145000],
      ['Rs. 4,500/-', 4500],
      ['INR 2500.50', 2500.5],
    ])('reads %p as a usable amount', (input, expected) => {
      expect(ingestion.normalizeAmount(input)).toBe(expected);
    });

    // Zero and negatives mean "not stated", so they never overwrite a real total.
    test.each([0, -5, '0', 'not quoted', '', '.', null, undefined, {}, NaN, Infinity])(
      'treats %p as no amount at all',
      (input) => {
        expect(ingestion.normalizeAmount(input)).toBeNull();
      }
    );
  });

  describe('lineItemValue', () => {
    test('prefers the stated line total over the unit rate', () => {
      expect(ingestion.lineItemValue({ totalPrice: 240000, unitPrice: 1 }, 12)).toBe(240000);
    });

    test('accepts the amount and rate column aliases a BOQ may use', () => {
      expect(ingestion.lineItemValue({ amount: 5000 }, 2)).toBe(5000);
      expect(ingestion.lineItemValue({ rate: 250 }, 4)).toBe(1000);
    });

    test('multiplies the unit rate by the quantity when only a rate is stated', () => {
      expect(ingestion.lineItemValue({ unitPrice: 4500 }, 24)).toBe(108000);
    });

    test('returns null for an unpriced line', () => {
      expect(ingestion.lineItemValue({ itemName: 'Gasket Set' }, 10)).toBeNull();
    });
  });

  describe('deriveEstimatedBudget', () => {
    test('a stated total wins over the sum of the lines', () => {
      expect(ingestion.deriveEstimatedBudget(890000, [1000, 2000])).toBe(890000);
    });

    test('sums the priced lines and ignores the unpriced ones', () => {
      expect(ingestion.deriveEstimatedBudget(null, [240000, null, 108000])).toBe(348000);
    });

    test('rounds a float sum to whole currency units', () => {
      expect(ingestion.deriveEstimatedBudget(null, [0.1, 0.2])).toBe(0);
      expect(ingestion.deriveEstimatedBudget(null, [1500.4, 1500.4])).toBe(3001);
    });

    test('returns null when nothing was priced', () => {
      expect(ingestion.deriveEstimatedBudget(null, [null, null])).toBeNull();
      expect(ingestion.deriveEstimatedBudget(undefined, [])).toBeNull();
    });
  });

  test('defaultTargetDate returns an ISO date the configured number of days out', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + RFQ_INGESTION_CONFIG.DELIVERY_DATE_OFFSET_DAYS);
    expect(ingestion.defaultTargetDate()).toBe(expected.toISOString().slice(0, 10));
    expect(ingestion.defaultTargetDate(0)).toBe(new Date().toISOString().slice(0, 10));
  });

  test('buildDeduplicationKey is case and whitespace insensitive', () => {
    const a = { itemName: ' Pump ', quantity: 2, unit: 'Nos', targetDate: '2026-09-15', technicalSpecs: 'SS316' };
    const b = { itemName: 'pump', quantity: 2, unit: 'nos', targetDate: '2026-09-15', technicalSpecs: 'ss316' };
    expect(ingestion.buildDeduplicationKey(a)).toBe(ingestion.buildDeduplicationKey(b));
  });

  describe('normalizeLineItems', () => {
    test('applies the documented defaults for quantity, unit and target date', () => {
      const { entities } = ingestion.normalizeLineItems([
        { description: 'Centrifugal Pump', quantity: 0 },
      ]);
      expect(entities).toHaveLength(1);
      expect(entities[0]).toMatchObject({
        itemName: 'Centrifugal Pump',
        quantity: RFQ_INGESTION_CONFIG.DEFAULT_QUANTITY,
        unit: RFQ_INGESTION_CONFIG.DEFAULT_UNIT,
        minorCategory: 'Pumps & Accessories',
      });
      expect(entities[0].targetDate).toBe(ingestion.defaultTargetDate());
    });

    test('drops rows with no description rather than surfacing blank lines', () => {
      const { entities } = ingestion.normalizeLineItems([
        { itemName: '   ', quantity: 5 },
        {},
        { itemName: 'Gate Valve', quantity: 3 },
      ]);
      expect(entities).toHaveLength(1);
      expect(entities[0].itemName).toBe('Gate Valve');
    });

    test('collapses duplicate rows and reports how many were removed', () => {
      const row = { itemName: 'Cable', quantity: 100, unit: 'Meters', targetDate: '2026-09-20', technicalSpecs: 'XLPE' };
      const { entities, duplicatesRemoved } = ingestion.normalizeLineItems([row, { ...row }, { ...row }]);
      expect(entities).toHaveLength(1);
      expect(duplicatesRemoved).toBe(2);
    });

    test('accepts the specification alias used by spreadsheet exports', () => {
      const { entities } = ingestion.normalizeLineItems([
        { itemName: 'Bespoke assembly', specification: 'Gate valve, ANSI 150' },
      ]);
      expect(entities[0].technicalSpecs).toBe('Gate valve, ANSI 150');
      expect(entities[0].minorCategory).toBe('Hoses, Valves & Fittings');
    });

    test('tolerates a non-array payload', () => {
      expect(ingestion.normalizeLineItems(undefined).entities).toEqual([]);
      expect(ingestion.normalizeLineItems(null).entities).toEqual([]);
    });

    // A sparse sheet can produce null or primitive rows; one bad cell must not
    // fail the whole ingest.
    test('skips null and primitive rows instead of throwing', () => {
      const { entities } = ingestion.normalizeLineItems([
        null,
        undefined,
        'Centrifugal Pump',
        42,
        { itemName: 'Gate Valve', quantity: 3 },
      ]);
      expect(entities).toHaveLength(1);
      expect(entities[0].itemName).toBe('Gate Valve');
    });

    test('exposes confidence as a percentage for the review grid', () => {
      const { entities } = ingestion.normalizeLineItems([{ itemName: 'Centrifugal Pump' }]);
      expect(entities[0].confidence).toBe(90);
    });
  });

  describe('deriveTitle', () => {
    test('uses the single item description for a one-line RFQ', () => {
      expect(ingestion.deriveTitle([{ itemName: 'Centrifugal Pump' }])).toBe(
        `Centrifugal Pump${RFQ_INGESTION_CONFIG.TITLE_SUFFIX_SINGLE}`
      );
    });

    test('signals breadth when the RFQ covers several items', () => {
      expect(ingestion.deriveTitle([{ itemName: 'Pump' }, { itemName: 'Valve' }])).toBe(
        `Pump${RFQ_INGESTION_CONFIG.TITLE_SUFFIX_MULTIPLE}`
      );
    });

    test('truncates an over-long title to the RFQ header limit', () => {
      const title = ingestion.deriveTitle([{ itemName: 'X'.repeat(200) }]);
      expect(title).toHaveLength(RFQ_INGESTION_CONFIG.MAX_TITLE_LENGTH);
      expect(title.endsWith('…')).toBe(true);
    });

    test('returns an empty string when there are no items', () => {
      expect(ingestion.deriveTitle([])).toBe('');
    });
  });

  describe('buildRFQDraft', () => {
    test('produces a review-ready draft with a classification breakdown', () => {
      const { draft, classification } = ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Centrifugal Pump 500 GPM', quantity: 12, unit: 'Units', targetDate: '2026-09-15' },
          { itemName: 'Flanged Gate Valve', quantity: 24, unit: 'Units', targetDate: '2026-09-18' },
          { itemName: 'Assorted unclassifiable widget', quantity: 4 },
        ],
        sourceFileName: 'BOQ.xlsx',
      });

      expect(draft.extractedEntities).toHaveLength(3);
      expect(draft.targetDeliveryDate).toBe('2026-09-15');
      expect(draft.sourceFileName).toBe('BOQ.xlsx');
      expect(draft.source).toBe('web_portal');
      expect(classification).toMatchObject({
        totalExtracted: 3,
        accepted: 3,
        duplicatesRemoved: 0,
        needsReview: 1,
        autoClassified: 2,
      });
    });

    test('sets the header category from the dominant major, not just the first item', () => {
      const { draft } = ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Copper Cable' },
          { itemName: 'LV Panel' },
          { itemName: 'Centrifugal Pump' },
        ],
      });
      expect(draft.category).toBe('Engineering Spares - Electrical');
    });

    test('prefers an explicit title over the derived one', () => {
      const { draft } = ingestion.buildRFQDraft({
        title: 'Q3 Mechanical Spares',
        lineItems: [{ itemName: 'Centrifugal Pump' }],
      });
      expect(draft.title).toBe('Q3 Mechanical Spares');
    });

    test('carries the source email through for the email gateway path', () => {
      const { draft } = ingestion.buildRFQDraft({
        lineItems: [{ itemName: 'Centrifugal Pump' }],
        source: 'email_gateway',
        sourceEmail: 'plant@lt-heavy.com',
      });
      expect(draft.source).toBe('email_gateway');
      expect(draft.sourceEmail).toBe('plant@lt-heavy.com');
    });

    test('reports an empty result rather than throwing', () => {
      const { draft, classification } = ingestion.buildRFQDraft({ lineItems: [] });
      expect(draft.extractedEntities).toEqual([]);
      expect(draft.category).toBe(DEFAULT_MAJOR_CATEGORY);
      expect(classification.accepted).toBe(0);
    });

    test('defaults to an empty payload when called with no arguments', () => {
      expect(ingestion.buildRFQDraft().classification.accepted).toBe(0);
    });

    test('derives the estimated budget by summing the priced lines', () => {
      const { draft } = ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Centrifugal Pump', quantity: 12, totalPrice: 240000 },
          { itemName: 'Flanged Gate Valve', quantity: 24, unitPrice: 4500 },
        ],
      });
      expect(draft.estimatedBudget).toBe(348000);
    });

    test('counts a collapsed duplicate once in the estimated budget', () => {
      const { draft, classification } = ingestion.buildRFQDraft({
        lineItems: [
          { itemName: 'Centrifugal Pump', quantity: 12, unit: 'Units', targetDate: '2026-09-15', totalPrice: 240000 },
          { itemName: 'Centrifugal Pump', quantity: 12, unit: 'Units', targetDate: '2026-09-15', totalPrice: 240000 },
        ],
      });
      expect(classification.duplicatesRemoved).toBe(1);
      expect(draft.estimatedBudget).toBe(240000);
    });

    test('leaves the estimated budget null when the document had no pricing', () => {
      const { draft } = ingestion.buildRFQDraft({ lineItems: [{ itemName: 'Centrifugal Pump' }] });
      expect(draft.estimatedBudget).toBeNull();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('RFQ ingestion & summary HTTP routes', () => {
  describe('POST /api/rfqs/ingest', () => {
    test('classifies extracted rows into a review-ready draft', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({
          lineItems: [
            { itemName: 'Centrifugal Water Pump 500 GPM', quantity: 12, unit: 'Units' },
            { itemName: 'Flanged Gate Valve 4-inch', quantity: 24, unit: 'Units' },
          ],
          sourceFileName: 'BOQ_Pumps.xlsx',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.extractedEntities).toHaveLength(2);
      expect(res.body.data.extractedEntities[0].minorCategory).toBe('Pumps & Accessories');
      expect(res.body.classification.accepted).toBe(2);
    });

    test('requires authentication', async () => {
      const res = await request(app).post('/api/rfqs/ingest').send({ lineItems: [] });
      expect(res.statusCode).toBe(401);
    });

    test('rejects a payload with no lineItems array', async () => {
      const res = await request(app).post('/api/rfqs/ingest').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.fieldErrors.lineItems).toBeDefined();
    });

    test('rejects a malformed source email at the boundary', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({ lineItems: [{ itemName: 'Pump' }], sourceEmail: 'not-an-email' });
      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.sourceEmail).toBeDefined();
    });

    test('rejects an unknown source value', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({ lineItems: [{ itemName: 'Pump' }], source: 'carrier_pigeon' });
      expect(res.statusCode).toBe(400);
    });

    // A document the parser could read but that yielded nothing quotable is a
    // failed ingestion, so the wizard must keep the buyer on the upload step.
    test('returns 422 when no usable line item could be extracted', async () => {
      const res = await request(app)
        .post('/api/rfqs/ingest')
        .set(authHeader('buyer'))
        .send({ lineItems: [{ quantity: 5 }, { itemName: '  ' }] });
      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.classification.accepted).toBe(0);
    });

    test('surfaces an unexpected failure through the error handler', async () => {
      const spy = jest
        .spyOn(storeService, 'getRFQSummary')
        .mockImplementation(() => {
          throw new Error('boom');
        });
      const res = await request(app).get('/api/rfqs/summary');
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      spy.mockRestore();
    });
  });

  describe('GET /api/rfqs/summary', () => {
    test('aggregates the buyer RFQ portfolio', async () => {
      const res = await request(app).get('/api/rfqs/summary');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const s = res.body.data;
      expect(typeof s.totalRFQs).toBe('number');
      expect(typeof s.activeRFQs).toBe('number');
      expect(typeof s.awaitingQuotes).toBe('number');
      expect(typeof s.totalBudget).toBe('number');
      expect(typeof s.averageQuotesPerRFQ).toBe('number');
      expect(s.byStatus).toBeDefined();
      expect(s.bySourcingMode).toBeDefined();
      expect(s.followUps).toBeDefined();
      expect(typeof s.followUps.vendorsInvited).toBe('number');
    });

    // 'summary' must not be captured by the '/:id' route below it.
    test('is not shadowed by the RFQ-by-id route', async () => {
      const res = await request(app).get('/api/rfqs/summary');
      expect(res.body.data.byStatus).toBeDefined();
      expect(res.body.error).toBeUndefined();
    });
  });

  describe('storeService.getRFQSummary', () => {
    test('counts an empty portfolio without dividing by zero', () => {
      const original = storeService.rfqs;
      storeService.rfqs = [];
      try {
        const summary = storeService.getRFQSummary();
        expect(summary).toMatchObject({
          totalRFQs: 0,
          activeRFQs: 0,
          awaitingQuotes: 0,
          totalQuotesReceived: 0,
          totalBudget: 0,
          averageQuotesPerRFQ: 0,
        });
        expect(summary.byStatus).toEqual({});
      } finally {
        storeService.rfqs = original;
      }
    });

    test('rolls up statuses, modes, sources, budget and follow-up channels', () => {
      const original = storeService.rfqs;
      storeService.rfqs = [
        {
          id: 'a',
          rfqNumber: 'RFQ-A',
          status: 'Quotes Pending',
          sourcingMode: 'mode_1',
          source: 'web_portal',
          budget: 1000,
          quotesCount: 2,
          chasingActive: true,
          followUpData: {
            totalInvited: 4,
            respondedCount: 2,
            callStats: { total: 4, connected: 3 },
            whatsappStats: { total: 4, read: 1 },
            smsStats: { total: 4 },
          },
        },
        {
          id: 'b',
          rfqNumber: 'RFQ-B',
          status: 'Quotes Pending',
          sourcingMode: 'mode_3',
          source: 'email_gateway',
          budget: 500,
          quotesCount: 0,
          chasingActive: false,
        },
      ];
      try {
        const s = storeService.getRFQSummary();
        expect(s.totalRFQs).toBe(2);
        expect(s.activeRFQs).toBe(1);
        expect(s.awaitingQuotes).toBe(1);
        expect(s.totalQuotesReceived).toBe(2);
        expect(s.totalBudget).toBe(1500);
        expect(s.averageQuotesPerRFQ).toBe(1);
        expect(s.byStatus).toEqual({ 'Quotes Pending': 2 });
        expect(s.bySourcingMode).toEqual({ mode_1: 1, mode_3: 1 });
        expect(s.bySource).toEqual({ web_portal: 1, email_gateway: 1 });
        expect(s.followUps).toMatchObject({
          vendorsInvited: 4,
          vendorsResponded: 2,
          calls: 4,
          callsConnected: 3,
          whatsapp: 4,
          whatsappRead: 1,
          sms: 4,
        });
      } finally {
        storeService.rfqs = original;
      }
    });

    test('falls back to intakeSource and ignores RFQs with neither source field', () => {
      const original = storeService.rfqs;
      storeService.rfqs = [
        { id: 'a', intakeSource: 'manual_entry', status: 'Parsing' },
        { id: 'b', status: 'Parsing' },
      ];
      try {
        expect(storeService.getRFQSummary().bySource).toEqual({ manual_entry: 1 });
      } finally {
        storeService.rfqs = original;
      }
    });
  });
});
