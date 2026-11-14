const gemini = require('../src/services/geminiService');
const { GEMINI_CONFIG } = require('../src/config/constants');
const { logger } = require('../src/services/loggerService');

// A 400 from one model is judged per model. Two in a row mean the request is refused, and the
// text sent is cleaned first so an invalid character cannot be the cause. These tests pin both,
// and the diagnostics a failed extraction logs.

const { EXTRACTION_STATUS } = gemini;
const originalFetch = global.fetch;
const originalKeys = process.env.GEMINI_API_KEYS;
const SUCCESS_JSON = JSON.stringify({ items: [{ itemName: 'Ball bearing 6205', quantity: 4, unit: 'Nos' }] });

/** A Gemini generateContent success reply around a JSON string. */
function geminiReply(jsonText) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: jsonText }] } }] }),
  };
}

/** The bare 400 Gemini returns for a request it will not accept. */
function rejectedRequest() {
  return {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: async () => ({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } }),
    text: async () => '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
  };
}

/** The model name a generateContent URL addresses. */
function modelOf(url) {
  return String(url).split('/').pop().split(':')[0];
}

describe('Gemini request hygiene and per-model rejections', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEYS = 'hygiene-test-key';
    gemini.clearKeyCooldowns();
    gemini.resetActiveModelIndex();
    gemini.setActiveKeyIndex(0);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKeys === undefined) delete process.env.GEMINI_API_KEYS;
    else process.env.GEMINI_API_KEYS = originalKeys;
    jest.restoreAllMocks();
  });

  test('a rejection by one model is tried on the next model, and that model\'s result is used', async () => {
    const modelsCalled = [];
    global.fetch = jest.fn(async (url) => {
      modelsCalled.push(modelOf(url));
      return modelsCalled.length === 1 ? rejectedRequest() : geminiReply(SUCCESS_JSON);
    });

    const result = await gemini.extractLineItems({ documentText: 'Need 4 ball bearings 6205', fileName: 'req.txt' });

    expect(result.status).toBe(EXTRACTION_STATUS.SUCCESS);
    expect(modelsCalled).toHaveLength(2);
    expect(modelsCalled[1]).not.toBe(modelsCalled[0]);
  });

  test('two rejections in a row stop the chain, and the failure reports only the models it tried', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(async () => rejectedRequest());

    const result = await gemini.extractLineItems({ documentText: 'Need bearings', fileName: 'req.txt' });

    expect(result.status).not.toBe(EXTRACTION_STATUS.SUCCESS);
    expect(global.fetch).toHaveBeenCalledTimes(GEMINI_CONFIG.MAX_CONSECUTIVE_REJECTIONS);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^\\[GEMINI\\] Extraction failed after ${GEMINI_CONFIG.MAX_CONSECUTIVE_REJECTIONS} of ${GEMINI_CONFIG.MODELS.length} models in chain for "req.txt"`)),
      expect.objectContaining({
        totalModelsInChain: GEMINI_CONFIG.MODELS.length,
        totalModelsAttempted: GEMINI_CONFIG.MAX_CONSECUTIVE_REJECTIONS,
        failureCount: GEMINI_CONFIG.MAX_CONSECUTIVE_REJECTIONS,
      }),
      'GEMINI'
    );
  });

  test('a failed extraction logs the request size and how much text was cleaned, but never the text', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(async () => rejectedRequest());

    await gemini.extractLineItems({ documentText: 'Need\u0000 bearings \uD83D end', fileName: 'req.txt' });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        approxRequestBytes: expect.any(Number),
        documentTextChars: 'Need bearings \uFFFD end'.length,
        controlCharactersRemoved: 1,
        loneSurrogatesReplaced: 1,
      }),
      'GEMINI'
    );
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('Need bearings');
  });

  test('sends the document text without control characters or unpaired surrogates', async () => {
    let sentBody = '';
    global.fetch = jest.fn(async (url, options) => {
      sentBody = options.body;
      return geminiReply(SUCCESS_JSON);
    });

    await gemini.extractLineItems({ documentText: 'Need\u0000 bearings \uD83D end', fileName: 'req.txt' });

    const documentPart = JSON.parse(sentBody).contents[0].parts.find(
      (part) => typeof part.text === 'string' && part.text.includes('DOCUMENT TEXT')
    );
    expect(documentPart.text).toContain('Need bearings \uFFFD end');
    expect(sentBody).not.toMatch(/\\u0000/);
    expect(sentBody).not.toMatch(/\\ud83d/i);
  });

  test('generateJson stops after two rejections in a row, and reports the models it tried', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(async () => rejectedRequest());

    const res = await gemini.generateJson({ prompt: 'test prompt' });

    expect(res.status).toBe('AI_FAILED');
    expect(res.data).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(GEMINI_CONFIG.MAX_CONSECUTIVE_REJECTIONS);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/failed after 2 of \d+ models/),
      expect.objectContaining({ totalModelsAttempted: GEMINI_CONFIG.MAX_CONSECUTIVE_REJECTIONS }),
      'GEMINI'
    );
  });
});
