// ==============================================================================
// RFQ SUMMARY GENERATION
// ==============================================================================
// The behaviour that matters most: generating a summary must never cost the buyer
// their RFQ. Every failure mode of the model has to degrade to a derived summary
// that is honestly labelled, not propagate as an error out of RFQ creation.
// ==============================================================================

const rfqSummaryService = require('../src/services/rfqSummaryService');
const { RFQ_SUMMARY_CONFIG } = require('../src/config/constants');

const { GENERATED_BY } = rfqSummaryService;

const SUCCESS = 'SUCCESS';

/** A Gemini double with the same contract as the real generateJson. */
function geminiDouble(result) {
  return {
    EXTRACTION_STATUS: { SUCCESS },
    generateJson: jest.fn(async () => result),
  };
}

function rfq(overrides = {}) {
  return {
    rfqId: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    targetDeliveryDate: '2026-09-30',
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    extractedEntities: [
      { itemName: 'Centrifugal Pump', quantity: 2, unit: 'Nos', minorCategory: 'Pumps', technicalSpecs: 'SS316' },
      { itemName: 'Gate Valve', quantity: 10, unit: 'Nos', minorCategory: 'Valves' },
    ],
    ...overrides,
  };
}

describe('rfqSummaryService.describeLineItems', () => {
  test('counts items, totals quantity and collects distinct minor categories', () => {
    expect(rfqSummaryService.describeLineItems(rfq().extractedEntities)).toEqual({
      itemCount: 2,
      totalQuantity: 12,
      categories: ['Pumps', 'Valves'],
    });
  });

  test('de-duplicates repeated categories', () => {
    const described = rfqSummaryService.describeLineItems([
      { quantity: 1, minorCategory: 'Pumps' },
      { quantity: 1, minorCategory: 'Pumps' },
    ]);
    expect(described.categories).toEqual(['Pumps']);
  });

  test.each([[undefined], [null], ['not-an-array']])('treats %p as empty', (value) => {
    expect(rfqSummaryService.describeLineItems(value)).toEqual({
      itemCount: 0,
      totalQuantity: 0,
      categories: [],
    });
  });

  test('ignores blank categories and non-numeric quantities', () => {
    expect(
      rfqSummaryService.describeLineItems([
        { quantity: 'abc', minorCategory: '  ' },
        { minorCategory: undefined },
      ])
    ).toEqual({ itemCount: 2, totalQuantity: 0, categories: [] });
  });
});

describe('rfqSummaryService.buildSummaryPrompt', () => {
  test('includes the header facts and the line items', () => {
    const prompt = rfqSummaryService.buildSummaryPrompt(rfq(), { orgName: 'Test Buyer Org' });

    expect(prompt).toContain('Mechanical Spares Procurement');
    expect(prompt).toContain('Test Buyer Org');
    expect(prompt).toContain('Centrifugal Pump');
    expect(prompt).toContain('SS316');
    expect(prompt).toContain('400701');
  });

  // No buyer identifiers are sent. The summary does not need them, so they should
  // not leave the network.
  test('sends no buyer identifiers', () => {
    const prompt = rfqSummaryService.buildSummaryPrompt(
      { ...rfq(), buyerEmail: 'buyer@procucev.com', buyerOrgId: 'org-buyer-01' },
      {}
    );
    expect(prompt).not.toContain('buyer@procucev.com');
    expect(prompt).not.toContain('org-buyer-01');
  });

  test('describes unspecified header fields rather than leaving them blank', () => {
    const prompt = rfqSummaryService.buildSummaryPrompt({ extractedEntities: [] }, {});
    expect(prompt).toContain('unspecified');
    expect(prompt).toContain('(none supplied)');
  });

  // A long BOQ would otherwise produce a prompt big enough to blow the context
  // window or the request timeout.
  test('caps the number of items sent and says it has done so', () => {
    const many = Array.from({ length: RFQ_SUMMARY_CONFIG.MAX_PROMPT_ITEMS + 10 }, (_, i) => ({
      itemName: `Item ${i}`,
      quantity: 1,
    }));
    const prompt = rfqSummaryService.buildSummaryPrompt({ extractedEntities: many }, {});

    expect(prompt).toContain(`first ${RFQ_SUMMARY_CONFIG.MAX_PROMPT_ITEMS} shown`);
    expect(prompt).not.toContain(`Item ${RFQ_SUMMARY_CONFIG.MAX_PROMPT_ITEMS + 5}`);
  });
});

describe('rfqSummaryService.buildDeterministicSummary', () => {
  test('states only what is countable', () => {
    const summary = rfqSummaryService.buildDeterministicSummary(rfq(), 'NOT_CONFIGURED');

    expect(summary.generatedBy).toBe(GENERATED_BY.DERIVED);
    expect(summary.fallbackReason).toBe('NOT_CONFIGURED');
    expect(summary.itemCount).toBe(2);
    expect(summary.totalQuantity).toBe(12);
    expect(summary.riskNotes).toEqual([]);
    expect(summary.model).toBeNull();
    expect(summary.scope).toContain('Navi Mumbai Plant, Gate 3');
    expect(summary.scope).toContain('2026-09-30');
  });

  test.each([
    [[], 'uncategorised items'],
    [[{ quantity: 1, minorCategory: 'Pumps' }], 'Pumps'],
  ])('describes %j as %s', (entities, expected) => {
    const summary = rfqSummaryService.buildDeterministicSummary({ extractedEntities: entities });
    expect(summary.headline).toContain(expected);
  });

  test('lists multiple categories with a count', () => {
    const summary = rfqSummaryService.buildDeterministicSummary(rfq());
    expect(summary.headline).toContain('2 categories');
  });

  // Singular and plural read correctly, since this text is shown verbatim.
  test('uses singular wording for a single item of one unit', () => {
    const summary = rfqSummaryService.buildDeterministicSummary({
      extractedEntities: [{ quantity: 1, minorCategory: 'Pumps' }],
    });
    expect(summary.headline).toContain('1 line item ');
    expect(summary.scope).toContain('1 unit ');
  });

  test('omits the location and date clauses when absent', () => {
    const summary = rfqSummaryService.buildDeterministicSummary({ extractedEntities: [] });
    expect(summary.scope).not.toContain('Delivery is to');
    expect(summary.scope).not.toContain('target delivery date');
  });
});

describe('rfqSummaryService.normalizeAiSummary', () => {
  test('accepts a well-formed response', () => {
    const normalized = rfqSummaryService.normalizeAiSummary(
      { headline: 'Two pumps and ten valves', scope: 'A mixed mechanical package.', riskNotes: ['Long lead time'] },
      'gemini-flash',
      rfq()
    );

    expect(normalized.generatedBy).toBe(GENERATED_BY.AI);
    expect(normalized.model).toBe('gemini-flash');
    expect(normalized.riskNotes).toEqual(['Long lead time']);
    expect(normalized.fallbackReason).toBeNull();
  });

  // Counts come from the data, never the model, so the figures always agree with
  // the line-item table rendered beside them.
  test('takes the counts from the data even when the model contradicts them', () => {
    const normalized = rfqSummaryService.normalizeAiSummary(
      { headline: 'h', scope: 's', itemCount: 99, totalQuantity: 99 },
      'gemini-flash',
      rfq()
    );
    expect(normalized.itemCount).toBe(2);
    expect(normalized.totalQuantity).toBe(12);
  });

  test.each([
    [{ scope: 'only scope' }],
    [{ headline: 'only headline' }],
    [{ headline: '   ', scope: 'blank headline' }],
    [{}],
    [null],
  ])('rejects %j as unusable', (data) => {
    expect(rfqSummaryService.normalizeAiSummary(data, 'gemini-flash', rfq())).toBeNull();
  });

  test('truncates an over-long headline', () => {
    const normalized = rfqSummaryService.normalizeAiSummary(
      { headline: 'x'.repeat(400), scope: 's' },
      'gemini-flash',
      rfq()
    );
    expect(normalized.headline).toHaveLength(RFQ_SUMMARY_CONFIG.MAX_HEADLINE_CHARS);
  });

  test('drops blank risk notes and caps the list', () => {
    const normalized = rfqSummaryService.normalizeAiSummary(
      {
        headline: 'h',
        scope: 's',
        riskNotes: ['  ', 'real risk', 42, ...Array.from({ length: 20 }, (_, i) => `risk ${i}`)],
      },
      'gemini-flash',
      rfq()
    );
    expect(normalized.riskNotes).toHaveLength(RFQ_SUMMARY_CONFIG.MAX_RISK_NOTES);
    expect(normalized.riskNotes).not.toContain('  ');
  });

  test('treats a non-array riskNotes as none', () => {
    const normalized = rfqSummaryService.normalizeAiSummary(
      { headline: 'h', scope: 's', riskNotes: 'not an array' },
      'gemini-flash',
      rfq()
    );
    expect(normalized.riskNotes).toEqual([]);
  });
});

describe('rfqSummaryService.buildRFQSummary', () => {
  test('returns the model summary when generation succeeds', async () => {
    const gemini = geminiDouble({
      status: SUCCESS,
      data: { headline: 'Two pumps and ten valves', scope: 'A mixed package.', riskNotes: [] },
      model: 'gemini-flash',
    });

    const summary = await rfqSummaryService.buildRFQSummary(rfq(), { gemini });

    expect(summary.generatedBy).toBe(GENERATED_BY.AI);
    expect(summary.headline).toBe('Two pumps and ten valves');
    expect(gemini.generateJson).toHaveBeenCalledTimes(1);
  });

  // Nothing to summarise: skip the network call rather than asking a model to
  // describe an empty list.
  test('skips the model entirely when there are no line items', async () => {
    const gemini = geminiDouble({ status: SUCCESS, data: {}, model: 'gemini-flash' });

    const summary = await rfqSummaryService.buildRFQSummary({ extractedEntities: [] }, { gemini });

    expect(gemini.generateJson).not.toHaveBeenCalled();
    expect(summary.generatedBy).toBe(GENERATED_BY.DERIVED);
    expect(summary.fallbackReason).toBe('NO_LINE_ITEMS');
  });

  test.each([['NOT_CONFIGURED'], ['AI_FAILED'], ['NO_CONTENT']])(
    'falls back to a derived summary when the model reports %s',
    async (status) => {
      const gemini = geminiDouble({ status, data: null, model: null });
      const summary = await rfqSummaryService.buildRFQSummary(rfq(), { gemini });

      expect(summary.generatedBy).toBe(GENERATED_BY.DERIVED);
      expect(summary.fallbackReason).toBe(status);
      expect(summary.itemCount).toBe(2);
    }
  );

  test('falls back when the model returns an unusable payload', async () => {
    const gemini = geminiDouble({ status: SUCCESS, data: { headline: '' }, model: 'gemini-flash' });
    const summary = await rfqSummaryService.buildRFQSummary(rfq(), { gemini });

    expect(summary.generatedBy).toBe(GENERATED_BY.DERIVED);
    expect(summary.fallbackReason).toBe('UNUSABLE_RESPONSE');
  });

  // generateJson is documented never to throw, but an unexpected throw must not
  // cost the buyer the RFQ they have just finished keying.
  test('falls back when generation throws unexpectedly', async () => {
    const gemini = {
      EXTRACTION_STATUS: { SUCCESS },
      generateJson: jest.fn(async () => {
        throw new Error('socket hang up');
      }),
    };

    const summary = await rfqSummaryService.buildRFQSummary(rfq(), { gemini });

    expect(summary.generatedBy).toBe(GENERATED_BY.DERIVED);
    expect(summary.fallbackReason).toBe('AI_ERROR');
  });

  test('defaults to the real Gemini service when none is injected', async () => {
    // No API key is configured under test, so this exercises the real
    // NOT_CONFIGURED path end to end without a network call.
    const summary = await rfqSummaryService.buildRFQSummary(rfq());
    expect(summary.generatedBy).toBe(GENERATED_BY.DERIVED);
  });
});

describe('rfqSummaryService.buildPortfolioSummary', () => {
  test('counts an empty portfolio without dividing by zero', () => {
    expect(rfqSummaryService.buildPortfolioSummary([])).toMatchObject({
      totalRFQs: 0,
      averageQuotesPerRFQ: 0,
      totalBudget: 0,
    });
  });

  test('rolls up budget, quotes and line items', () => {
    const summary = rfqSummaryService.buildPortfolioSummary([
      { status: 'Quotes Pending', sourcingMode: 'mode_1', source: 'manual_entry', budget: 1000, quotesCount: 2, extractedEntities: [{}, {}] },
      { status: 'In Evaluation', sourcingMode: 'mode_1', source: 'web_portal', budget: 500, quotesCount: 0, extractedEntities: [{}] },
    ]);

    expect(summary.totalRFQs).toBe(2);
    expect(summary.totalBudget).toBe(1500);
    expect(summary.totalQuotesReceived).toBe(2);
    expect(summary.totalLineItems).toBe(3);
    expect(summary.awaitingQuotes).toBe(1);
    expect(summary.byStatus).toEqual({ 'Quotes Pending': 1, 'In Evaluation': 1 });
    expect(summary.bySourcingMode).toEqual({ mode_1: 2 });
  });

  // Every figure that used to be fabricated is gone.
  test('reports no follow-up channel statistics', () => {
    const summary = rfqSummaryService.buildPortfolioSummary([{ budget: 1 }]);
    expect(summary.followUps).toBeUndefined();
  });

  test('ignores a non-numeric budget or quote count', () => {
    const summary = rfqSummaryService.buildPortfolioSummary([
      { budget: 'abc', quotesCount: 'many', extractedEntities: 'nope' },
    ]);
    expect(summary.totalBudget).toBe(0);
    expect(summary.totalQuotesReceived).toBe(0);
    expect(summary.totalLineItems).toBe(0);
  });
});
