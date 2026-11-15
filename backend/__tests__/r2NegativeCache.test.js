const r2NegativeCache = require('../src/services/r2NegativeCache');
const r2Client = require('../src/services/r2Client');
const rfqAttachmentService = require('../src/services/rfqAttachmentService');
const { logger } = require('../src/services/loggerService');

describe('r2NegativeCache', () => {
  afterEach(() => {
    r2NegativeCache.resetMissingKeyCache();
    jest.restoreAllMocks();
  });

  test('identifies missing object errors across R2 and S3 error shapes', () => {
    expect(r2NegativeCache.isMissingObjectError(null)).toBe(false);
    expect(r2NegativeCache.isMissingObjectError({ name: 'NoSuchKey' })).toBe(true);
    expect(r2NegativeCache.isMissingObjectError({ Code: 'NoSuchKey' })).toBe(true);
    expect(r2NegativeCache.isMissingObjectError({ code: 'NoSuchKey' })).toBe(true);
    expect(r2NegativeCache.isMissingObjectError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(r2NegativeCache.isMissingObjectError(new Error('The specified key does not exist.'))).toBe(true);
    expect(r2NegativeCache.isMissingObjectError({})).toBe(false);
    expect(r2NegativeCache.isMissingObjectError(new Error('network timeout'))).toBe(false);
  });

  test('caches missing keys with TTL expiry, eviction, and write invalidation', () => {
    const now = Date.now();
    expect(r2NegativeCache.isKeyKnownMissing('')).toBe(false);
    expect(r2NegativeCache.isKeyKnownMissing('k1', now)).toBe(false);

    r2NegativeCache.markKeyMissing('', now);
    r2NegativeCache.markKeyMissing('k1', now);
    expect(r2NegativeCache.isKeyKnownMissing('k1', now + 1000)).toBe(true);

    // Expires after TTL
    expect(
      r2NegativeCache.isKeyKnownMissing('k1', now + r2NegativeCache.MISSING_KEY_CACHE_TTL_MS + 1)
    ).toBe(false);

    // Explicit clear and empty-arg safety
    r2NegativeCache.markKeyMissing('k2', now);
    r2NegativeCache.clearMissingKey('');
    r2NegativeCache.clearMissingKey('k2');
    expect(r2NegativeCache.isKeyKnownMissing('k2', now)).toBe(false);

    // Evicts oldest key once capacity is reached
    for (let i = 0; i <= r2NegativeCache.MAX_MISSING_KEY_CACHE_ENTRIES; i += 1) {
      r2NegativeCache.markKeyMissing(`fill-${i}`, now);
    }
    expect(r2NegativeCache.isKeyKnownMissing('fill-0', now)).toBe(false);
    expect(
      r2NegativeCache.isKeyKnownMissing(`fill-${r2NegativeCache.MAX_MISSING_KEY_CACHE_ENTRIES}`, now)
    ).toBe(true);

    // Updating an existing entry does not trigger eviction
    r2NegativeCache.markKeyMissing(`fill-${r2NegativeCache.MAX_MISSING_KEY_CACHE_ENTRIES}`, now + 10);
    expect(r2NegativeCache.isKeyKnownMissing('fill-1', now)).toBe(true);
  });

  test('getFromBinding suppresses repeat missing lookups, handles NoSuchKey errors, and invalidates on put', async () => {
    const store = new Map();
    const binding = {
      get: jest.fn(async (key) => store.get(key) || null),
      put: jest.fn(async (key, body) => store.set(key, { arrayBuffer: async () => body })),
      delete: jest.fn(async (key) => store.delete(key)),
    };

    expect(await r2NegativeCache.getFromBinding(binding, 'rfq-attachments/missing-1')).toBeNull();
    expect(await r2NegativeCache.getFromBinding(binding, 'rfq-attachments/missing-1')).toBeNull();
    expect(binding.get).toHaveBeenCalledTimes(1);

    await r2NegativeCache.putToBinding(binding, 'rfq-attachments/missing-1', Buffer.from('pdf'));
    const loaded = await r2NegativeCache.getFromBinding(binding, 'rfq-attachments/missing-1');
    expect(loaded).not.toBeNull();
    expect(binding.get).toHaveBeenCalledTimes(2);

    await r2NegativeCache.deleteFromBinding(binding, 'rfq-attachments/missing-1');
    expect(await r2NegativeCache.getFromBinding(binding, 'rfq-attachments/missing-1')).toBeNull();
    expect(binding.get).toHaveBeenCalledTimes(2);

    // Binding throwing NoSuchKey is treated as missing and cached; transient error rethrows
    binding.get.mockRejectedValueOnce(new Error('The specified key does not exist.'));
    expect(await r2NegativeCache.getFromBinding(binding, 'rfq-attachments/throws-missing')).toBeNull();
    expect(await r2NegativeCache.getFromBinding(binding, 'rfq-attachments/throws-missing')).toBeNull();
    expect(binding.get).toHaveBeenCalledTimes(3);

    binding.get.mockRejectedValueOnce(new Error('R2 temporary outage'));
    await expect(r2NegativeCache.getFromBinding(binding, 'rfq-attachments/transient')).rejects.toThrow(
      'R2 temporary outage'
    );
  });

  test('rfqAttachmentService skips repeat R2 binding lookups for missing keys and logs NoSuchKey as warn', async () => {
    const binding = {
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(r2Client, 'getBinding').mockReturnValue(binding);

    const id = '11111111-1111-4111-8111-111111111111';
    expect(await rfqAttachmentService.loadAttachment(id)).toBeNull();
    expect(await rfqAttachmentService.loadAttachment(id)).toBeNull();
    expect(binding.get).toHaveBeenCalledTimes(1);

    // S3-style NoSuchKey logs warning rather than error
    r2Client.getBinding.mockReturnValue(null);
    const notFoundErr = new Error('The specified key does not exist.');
    notFoundErr.name = 'NoSuchKey';
    jest.spyOn(r2Client, 'getClient').mockReturnValue({
      send: jest.fn().mockRejectedValue(notFoundErr),
    });
    jest.spyOn(r2Client, 'bucket').mockReturnValue('bucket');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    const missingId2 = '22222222-2222-4222-8222-222222222222';
    expect(await rfqAttachmentService.loadAttachment(missingId2)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('RFQ attachment missing in storage'),
      expect.objectContaining({ key: `uploads/rfq-attachments/${missingId2}` }),
      'RFQ_ATTACHMENT'
    );
    expect(errSpy).not.toHaveBeenCalled();
  });
});
