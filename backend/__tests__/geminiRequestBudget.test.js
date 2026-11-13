const gemini = require('../src/services/geminiService');
const { GEMINI_CONFIG } = require('../src/config/constants');
const { logger } = require('../src/services/loggerService');

const FIFTEEN_SECONDS_MS = 15000;
const GLOBAL_BUDGET_MS = 900000;

// The first "Attempting ..." log line carries the budget left for the first model call.
function firstAttemptRemainingMs(infoSpy) {
  const attempt = infoSpy.mock.calls.find(([message]) => String(message).includes('Attempting'));
  if (!attempt) throw new Error('no model attempt was logged');
  return attempt[1].remainingMs;
}

describe('generateJson per-call request budget', () => {
  const originalFetch = global.fetch;
  const originalKeys = GEMINI_CONFIG.API_KEYS;
  const originalTotalBudget = GEMINI_CONFIG.TOTAL_BUDGET_MS;

  beforeEach(() => {
    gemini.clearKeyCooldowns();
    gemini.resetActiveModelIndex();
    gemini.setActiveKeyIndex(0);
    GEMINI_CONFIG.API_KEYS = ['budget-test-key'];
    GEMINI_CONFIG.TOTAL_BUDGET_MS = GLOBAL_BUDGET_MS;
    // A 400 is not retryable, so the model chain stops after one attempt.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"error":{"message":"bad request"}}',
      json: async () => ({ error: { message: 'bad request' } }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    GEMINI_CONFIG.API_KEYS = originalKeys;
    GEMINI_CONFIG.TOTAL_BUDGET_MS = originalTotalBudget;
    gemini.clearKeyCooldowns();
    jest.restoreAllMocks();
  });

  test('uses a shorter requested budget in place of the global one', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    await gemini.generateJson({ prompt: 'Summarise this RFQ.', label: 'RFQ summary', budgetMs: FIFTEEN_SECONDS_MS });

    const remaining = firstAttemptRemainingMs(infoSpy);
    expect(remaining).toBeLessThanOrEqual(FIFTEEN_SECONDS_MS);
    expect(remaining).toBeGreaterThan(FIFTEEN_SECONDS_MS - 1000);
  });

  test('honours a ten minute summary budget under the default fifteen minute global budget', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    await gemini.generateJson({ prompt: 'Summarise this RFQ.', label: 'RFQ summary', budgetMs: 10 * 60 * 1000 });

    const remaining = firstAttemptRemainingMs(infoSpy);
    expect(remaining).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(remaining).toBeGreaterThan(10 * 60 * 1000 - 1000);
  });

  test('never grants more time than the global budget', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    await gemini.generateJson({ prompt: 'Summarise this RFQ.', label: 'RFQ summary', budgetMs: 10 * 60 * 60 * 1000 });

    expect(firstAttemptRemainingMs(infoSpy)).toBeLessThanOrEqual(GLOBAL_BUDGET_MS);
  });

  test('falls back to the global budget when the requested value is not a positive number', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    await gemini.generateJson({ prompt: 'Summarise this RFQ.', label: 'RFQ summary', budgetMs: 'soon' });

    const remaining = firstAttemptRemainingMs(infoSpy);
    expect(remaining).toBeLessThanOrEqual(GLOBAL_BUDGET_MS);
    expect(remaining).toBeGreaterThan(GLOBAL_BUDGET_MS - 1000);
  });

  test('uses the global budget when no budget is requested', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    await gemini.generateJson({ prompt: 'Summarise this RFQ.', label: 'RFQ summary' });

    expect(firstAttemptRemainingMs(infoSpy)).toBeGreaterThan(GLOBAL_BUDGET_MS - 1000);
  });
});
