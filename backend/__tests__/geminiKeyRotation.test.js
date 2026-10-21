const gemini = require('../src/services/geminiService');
const { GEMINI_CONFIG } = require('../src/config/constants');
const { logger } = require('../src/services/loggerService');

describe('Gemini API Key Fallback, Cooldown & Automatic Rotation', () => {
  const originalEnvKeys = process.env.GEMINI_API_KEYS;
  const originalEnvSingle = process.env.GEMINI_API_KEY;
  const originalEnvBackup = process.env.GEMINI_BACKUP_KEYS;
  const originalConfigKeys = GEMINI_CONFIG.API_KEYS;
  const originalConfigSingle = GEMINI_CONFIG.API_KEY;
  const originalConfigBackup = GEMINI_CONFIG.BACKUP_KEYS;
  const originalConfigCooldown = GEMINI_CONFIG.KEY_COOLDOWN_MS;
  const originalFetch = global.fetch;

  beforeEach(() => {
    gemini.clearKeyCooldowns();
    gemini.resetActiveModelIndex();
    gemini.setActiveKeyIndex(0);
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BACKUP_KEYS;
    delete GEMINI_CONFIG.API_KEYS;
    delete GEMINI_CONFIG.API_KEY;
    delete GEMINI_CONFIG.BACKUP_KEYS;
    GEMINI_CONFIG.KEY_COOLDOWN_MS = 60000;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    gemini.clearKeyCooldowns();
    if (originalEnvKeys !== undefined) process.env.GEMINI_API_KEYS = originalEnvKeys;
    if (originalEnvSingle !== undefined) process.env.GEMINI_API_KEY = originalEnvSingle;
    if (originalEnvBackup !== undefined) process.env.GEMINI_BACKUP_KEYS = originalEnvBackup;
    GEMINI_CONFIG.API_KEYS = originalConfigKeys;
    GEMINI_CONFIG.API_KEY = originalConfigSingle;
    GEMINI_CONFIG.BACKUP_KEYS = originalConfigBackup;
    GEMINI_CONFIG.KEY_COOLDOWN_MS = originalConfigCooldown;
    jest.restoreAllMocks();
  });

  describe('Key Resolution & Primary Ordering', () => {
    test('resolves multiple keys from GEMINI_API_KEYS comma-delimited list', () => {
      process.env.GEMINI_API_KEYS = ' key-alpha , key-beta,key-gamma ';
      const keys = gemini.resolveApiKeys();
      expect(keys).toEqual(['key-alpha', 'key-beta', 'key-gamma']);
      expect(keys[0]).toBe('key-alpha'); // First key is primary
    });

    test('deduplicates keys and merges GEMINI_API_KEY and GEMINI_BACKUP_KEYS seamlessly', () => {
      process.env.GEMINI_API_KEY = 'key-primary';
      process.env.GEMINI_BACKUP_KEYS = 'key-backup-1, key-primary, key-backup-2';
      const keys = gemini.resolveApiKeys();
      expect(keys).toEqual(['key-primary', 'key-backup-1', 'key-backup-2']);
      expect(keys[0]).toBe('key-primary');
    });

    test('GEMINI_API_KEYS takes precedence while preserving uniqueness', () => {
      process.env.GEMINI_API_KEYS = 'key-1, key-2';
      process.env.GEMINI_API_KEY = 'key-3';
      process.env.GEMINI_BACKUP_KEYS = 'key-2, key-4';
      const keys = gemini.resolveApiKeys();
      expect(keys).toEqual(['key-1', 'key-2', 'key-3', 'key-4']);
      expect(keys[0]).toBe('key-1');
    });

    test('filters out invalid placeholder keys (e.g. AIzaSyC_2mDq... or keys with mD3Zq8mD)', () => {
      process.env.GEMINI_API_KEYS = 'AIzaSyC_2mDqFAKEKEYmD3Zq8mD, key-valid-1, placeholder, key-valid-2';
      const keys = gemini.resolveApiKeys();
      expect(keys).toEqual(['key-valid-1', 'key-valid-2']);
    });
  });

  describe('Key Cooldown Management', () => {
    test('marks a key in cooldown and respects expiration', () => {
      const key = 'test-cooldown-key-1';
      expect(gemini.isKeyInCooldown(key)).toBe(false);

      gemini.markKeyCooldown(key, 5000);
      expect(gemini.isKeyInCooldown(key)).toBe(true);

      // Fast forward past cooldown
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 6000);
      expect(gemini.isKeyInCooldown(key)).toBe(false);
    });

    test('clearKeyCooldowns resets all cooldowns', () => {
      const key1 = 'test-cooldown-key-a';
      const key2 = 'test-cooldown-key-b';
      gemini.markKeyCooldown(key1, 60000);
      gemini.markKeyCooldown(key2, 60000);

      expect(gemini.isKeyInCooldown(key1)).toBe(true);
      expect(gemini.isKeyInCooldown(key2)).toBe(true);

      gemini.clearKeyCooldowns();
      expect(gemini.isKeyInCooldown(key1)).toBe(false);
      expect(gemini.isKeyInCooldown(key2)).toBe(false);
    });
  });

  describe('Automatic Failover on 429 Rate Limits / Quota Exhaustion', () => {
    test('automatically retries with Key 2 when Key 1 hits 429 RESOURCE_EXHAUSTED', async () => {
      const secretKey1 = 'secret-key-one-rate-limited';
      const secretKey2 = 'secret-key-two-working';
      process.env.GEMINI_API_KEYS = `${secretKey1},${secretKey2}`;

      const loggerWarnSpy = jest.spyOn(logger, 'warn');
      const loggerInfoSpy = jest.spyOn(logger, 'info');

      const attemptedKeys = [];

      global.fetch = jest.fn().mockImplementation(async (url, options) => {
        const apiKey = options?.headers?.['x-goog-api-key'] || '';
        attemptedKeys.push(apiKey);
        if (apiKey === secretKey1) {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            json: async () => ({
              error: {
                code: 429,
                message: 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric',
                status: 'RESOURCE_EXHAUSTED',
              },
            }),
            text: async () => JSON.stringify({ error: { code: 429, message: 'RESOURCE_EXHAUSTED' } }),
          };
        }
        if (apiKey === secretKey2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify({ items: [{ itemDescription: 'Industrial Valve', quantity: 5 }] }) }],
                  },
                },
              ],
            }),
            text: async () => '',
          };
        }
        throw new Error('Unknown Key: ' + apiKey);
      });

      const result = await gemini.extractLineItems({
        documentText: 'Please quote 5 units of Industrial Valve.',
        fileName: 'rfq.txt',
      });

      expect(result.status).toBe(gemini.EXTRACTION_STATUS.SUCCESS);
      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].itemName).toBe('Industrial Valve');

      // Key 1 was tried, then Key 2 was tried
      expect(attemptedKeys).toEqual([secretKey1, secretKey2]);

      // Key 1 must be marked in cooldown
      expect(gemini.isKeyInCooldown(secretKey1)).toBe(true);

      // Safe logging check: secret keys must NEVER appear in logger calls
      const allLogMessages = [
        ...loggerWarnSpy.mock.calls.map((c) => JSON.stringify(c)),
        ...loggerInfoSpy.mock.calls.map((c) => JSON.stringify(c)),
      ].join(' ');

      expect(allLogMessages).not.toContain(secretKey1);
      expect(allLogMessages).not.toContain(secretKey2);
      expect(allLogMessages).toContain('Key #1/2');
    });

    test('subsequent calls skip rate-limited Key 1 while in cooldown and immediately use Key 2', async () => {
      const secretKey1 = 'secret-key-cooldown-skip';
      const secretKey2 = 'secret-key-healthy-runner';
      process.env.GEMINI_API_KEYS = `${secretKey1},${secretKey2}`;

      // Pre-mark Key 1 in cooldown
      gemini.markKeyCooldown(secretKey1, 60000);
      expect(gemini.isKeyInCooldown(secretKey1)).toBe(true);

      const attemptedKeys = [];
      global.fetch = jest.fn().mockImplementation(async (url, options) => {
        const apiKey = options?.headers?.['x-goog-api-key'] || '';
        attemptedKeys.push(apiKey);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ items: [{ itemDescription: 'Steel Pipes', quantity: 20 }] }) }],
                },
              },
            ],
          }),
        };
      });

      const result = await gemini.extractLineItems({
        documentText: '20 Steel Pipes',
        fileName: 'pipes.txt',
      });

      expect(result.status).toBe(gemini.EXTRACTION_STATUS.SUCCESS);
      expect(attemptedKeys).toEqual([secretKey2]); // Directly used Key 2
      expect(attemptedKeys).not.toContain(secretKey1);
    });

    test('non-retryable 400 Bad Request aborts immediately without rotating through other keys', async () => {
      const secretKey1 = 'secret-key-bad-req-1';
      const secretKey2 = 'secret-key-bad-req-2';
      process.env.GEMINI_API_KEYS = `${secretKey1},${secretKey2}`;

      const attemptedKeys = [];
      global.fetch = jest.fn().mockImplementation(async (url, options) => {
        const apiKey = options?.headers?.['x-goog-api-key'] || '';
        attemptedKeys.push(apiKey);
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            error: {
              code: 400,
              message: 'Invalid argument: document contains invalid characters',
              status: 'INVALID_ARGUMENT',
            },
          }),
          text: async () => 'Invalid argument',
        };
      });

      const result = await gemini.extractLineItems({
        documentText: 'invalid payload',
        fileName: 'bad.txt',
      });

      expect(result.status).not.toBe(gemini.EXTRACTION_STATUS.SUCCESS);
      // Fails immediately on 400 without key rotation
      expect(attemptedKeys).toEqual([secretKey1]);
      expect(gemini.isKeyInCooldown(secretKey1)).toBe(false);
    });

    test('returns a meaningful error when all eligible keys are exhausted', async () => {
      const secretKey1 = 'secret-exhausted-1';
      const secretKey2 = 'secret-exhausted-2';
      process.env.GEMINI_API_KEYS = `${secretKey1},${secretKey2}`;

      global.fetch = jest.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({
            error: { code: 429, message: 'RESOURCE_EXHAUSTED' },
          }),
          text: async () => 'RESOURCE_EXHAUSTED',
        };
      });

      const result = await gemini.extractLineItems({
        documentText: 'Document items',
        fileName: 'exhausted.txt',
      });

      expect(result.status).toBe(gemini.EXTRACTION_STATUS.QUOTA_EXCEEDED);
      expect(result.error).toMatch(/quota|rate limit|temporarily exceeded|exhausted|429/i);
      expect(gemini.isKeyInCooldown(secretKey1)).toBe(true);
      expect(gemini.isKeyInCooldown(secretKey2)).toBe(true);
    });

    test('network fetch error with rate limit message marks cooldown and rotates', async () => {
      const secretKey1 = 'secret-net-rate-1';
      const secretKey2 = 'secret-net-rate-2';
      process.env.GEMINI_API_KEYS = `${secretKey1},${secretKey2}`;

      let attempts = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('fetch error: 429 Resource Exhausted rate limit exceeded');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        items: [
                          {
                            itemNumber: 1,
                            itemDescription: 'Carbon Steel Pipe',
                            quantity: 10,
                            unit: 'PCS',
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      });

      const result = await gemini.extractLineItems({
        documentText: 'Carbon Steel Pipe 10 PCS',
        fileName: 'network_retry.txt',
      });

      expect(result.status).toBe(gemini.EXTRACTION_STATUS.SUCCESS);
      expect(attempts).toBe(2);
      expect(gemini.isKeyInCooldown(secretKey1)).toBe(true);
      expect(gemini.getKeyCooldowns().has(secretKey1)).toBe(true);
    });

    test('generateJson aborts on non-retryable error', async () => {
      const secretKey1 = 'secret-gen-bad-1';
      process.env.GEMINI_API_KEYS = secretKey1;

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { code: 400, message: 'Invalid prompt argument', status: 'INVALID_ARGUMENT' } }),
        text: async () => 'Invalid argument',
      }));

      const res = await gemini.generateJson({ prompt: 'test prompt' });
      expect(res.status).toBe('AI_FAILED');
      expect(res.data).toBeNull();
    });

    test('isLocationUnsupportedError identifies location precondition failures and isNonRetryableError returns false', () => {
      const locationMsg = JSON.stringify({
        error: {
          code: 400,
          message: 'User location is not supported for the API use.',
          status: 'FAILED_PRECONDITION',
        },
      });

      expect(gemini.isLocationUnsupportedError(400, locationMsg)).toBe(true);
      expect(gemini.isNonRetryableError(400, locationMsg)).toBe(false);
      expect(gemini.isNonRetryableError(400, 'Invalid argument: bad parameter')).toBe(true);
    });

    test('400 User location unsupported does not abort key rotation and succeeds with Key 2', async () => {
      const secretKey1 = 'secret-location-blocked-1';
      const secretKey2 = 'secret-location-ok-2';
      process.env.GEMINI_API_KEYS = `${secretKey1},${secretKey2}`;

      const locationErrorJson = JSON.stringify({
        error: {
          code: 400,
          message: 'User location is not supported for the API use.',
          status: 'FAILED_PRECONDITION',
        },
      });

      const attemptedKeys = [];
      global.fetch = jest.fn().mockImplementation(async (url, options) => {
        const apiKey = options?.headers?.['x-goog-api-key'] || '';
        attemptedKeys.push(apiKey);
        if (apiKey === secretKey1) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => locationErrorJson,
            json: async () => JSON.parse(locationErrorJson),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ items: [{ itemDescription: 'Supported Item', quantity: 5 }] }) }],
                },
              },
            ],
          }),
        };
      });

      const result = await gemini.extractLineItems({
        documentText: 'Supported Item 5 Nos',
        fileName: 'location_test.txt',
      });

      expect(result.status).toBe(gemini.EXTRACTION_STATUS.SUCCESS);
      expect(attemptedKeys).toEqual([secretKey1, secretKey2]);
      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].itemName).toBe('Supported Item');
    });

    test('extractLineItems advances activeModelIndex when all keys fail with location error', async () => {
      const secretKey1 = 'secret-loc-fail-1';
      process.env.GEMINI_API_KEYS = secretKey1;

      const locationErrorJson = JSON.stringify({
        error: {
          code: 400,
          message: 'User location is not supported for the API use.',
          status: 'FAILED_PRECONDITION',
        },
      });

      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: false,
        status: 400,
        text: async () => locationErrorJson,
        json: async () => JSON.parse(locationErrorJson),
      }));

      const result = await gemini.extractLineItems({
        documentText: 'Steel Flange 4 inch 15 Nos',
        fileName: 'materials.txt',
      });

      expect(result.status).toBe(gemini.EXTRACTION_STATUS.AI_FAILED);
      expect(result.error).toContain('User location is not supported');
      // Advances activeModelIndex so subsequent attempts immediately try fallback models
      expect(gemini.getActiveModelIndex()).toBe(1);
    });
  });
});

