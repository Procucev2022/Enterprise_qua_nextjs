const rfqSummaryService = require('../src/services/rfqSummaryService');
const { GEMINI_CONFIG, RFQ_SUMMARY_CONFIG } = require('../src/config/constants');

const TEN_MINUTES_MS = 10 * 60 * 1000;

describe('RFQ summary model budget', () => {
  test('passes the summary budget to the model call', async () => {
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

  test('the summary budget is ten minutes and never exceeds the global Gemini budget', () => {
    expect(RFQ_SUMMARY_CONFIG.GEMINI_BUDGET_MS).toBe(TEN_MINUTES_MS);
    expect(RFQ_SUMMARY_CONFIG.GEMINI_BUDGET_MS).toBeLessThanOrEqual(GEMINI_CONFIG.TOTAL_BUDGET_MS);
  });
});
