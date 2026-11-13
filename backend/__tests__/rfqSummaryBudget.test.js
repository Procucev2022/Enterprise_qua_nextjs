const rfqSummaryService = require('../src/services/rfqSummaryService');
const { RFQ_SUMMARY_CONFIG } = require('../src/config/constants');

describe('RFQ summary model budget', () => {
  test('caps the summary model call at the summary budget, so RFQ creation is not held for minutes', async () => {
    const gemini = {
      isConfigured: () => true,
      EXTRACTION_STATUS: { SUCCESS: 'SUCCESS' },
      generateJson: jest.fn(async () => ({ status: 'NOT_CONFIGURED', data: null, model: null })),
    };
    const rfq = {
      title: 'Pipe supply',
      extractedEntities: [{ itemName: 'Carbon steel pipe', quantity: 10, unit: 'Nos' }],
    };

    const summary = await rfqSummaryService.buildRFQSummary(rfq, { gemini });

    expect(gemini.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      label: 'RFQ summary',
      budgetMs: RFQ_SUMMARY_CONFIG.GEMINI_BUDGET_MS,
    }));
    expect(summary).toBeTruthy();
  });

  test('the summary budget is short enough for a request that waits on it', () => {
    expect(RFQ_SUMMARY_CONFIG.GEMINI_BUDGET_MS).toBeGreaterThan(0);
    expect(RFQ_SUMMARY_CONFIG.GEMINI_BUDGET_MS).toBeLessThanOrEqual(30000);
  });
});
