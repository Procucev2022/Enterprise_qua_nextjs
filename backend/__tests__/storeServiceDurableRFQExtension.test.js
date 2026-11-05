const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

const TEST_RFQ_ID = 'rfq-durable-extension-test';
const createRFQ = (overrides = {}) => ({
  id: TEST_RFQ_ID,
  rfqNumber: 'RFQ-DURABLE-EXTENSION-TEST',
  status: 'Open',
  buyerAccountId: 'buyer-1',
  quotes: [],
  deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

describe('storeService.extendRFQDurably', () => {
  beforeEach(() => {
    storeService.rfqs = storeService.rfqs.filter((rfq) => rfq.id !== TEST_RFQ_ID);
  });

  afterEach(() => {
    storeService.rfqs = storeService.rfqs.filter((rfq) => rfq.id !== TEST_RFQ_ID);
    jest.restoreAllMocks();
  });

  test('reads fresh storage and caches only the database-confirmed extension', async () => {
    const fresh = createRFQ();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(fresh);
    jest.spyOn(domainQueries, 'extendRFQOnceInDB').mockImplementation(async (id, updates) => ({ ...fresh, ...updates }));

    const result = await storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 24, userEmail: 'buyer@example.com' });

    expect(result.success).toBe(true);
    expect(result.rfq.isExtended).toBe(true);
    expect(result.rfq.extensionHours).toBe(24);
    expect(result.rfq.extendedByEmail).toBe('buyer@example.com');
    expect(domainQueries.extendRFQOnceInDB).toHaveBeenCalledWith(TEST_RFQ_ID, expect.objectContaining({ isExtended: true }));
    expect(storeService.rfqs.find((rfq) => rfq.id === TEST_RFQ_ID)).toEqual(result.rfq);
  });

  test('returns not found when the durable RFQ does not exist', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);
    await expect(storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 24 })).resolves.toMatchObject({
      success: false,
      reason: 'NOT_FOUND',
    });
  });

  test.each([
    [{ status: 'Closed' }, 'INVALID_STATUS'],
    [{ status: 'Expired' }, 'INVALID_STATUS'],
    [{ isExtended: true }, 'ALREADY_EXTENDED'],
    [{ extendedAt: '2026-11-01T00:00:00.000Z' }, 'ALREADY_EXTENDED'],
    [{ extensionHours: 24 }, 'ALREADY_EXTENDED'],
  ])('rejects an RFQ that is no longer eligible: %p', async (overrides, reason) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(createRFQ(overrides));
    await expect(storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 24 })).resolves.toMatchObject({
      success: false,
      reason,
    });
  });

  test('rejects durations other than 24 or 48 hours before writing', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(createRFQ());
    const updateSpy = jest.spyOn(domainQueries, 'extendRFQOnceInDB');
    await expect(storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 36 })).resolves.toMatchObject({
      success: false,
      reason: 'VALIDATION',
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('maps a failed fresh read to a retryable persistence error', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockRejectedValue(new Error('database unavailable'));
    await expect(storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 24 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  test('maps a failed atomic write to a retryable persistence error', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(createRFQ());
    jest.spyOn(domainQueries, 'extendRFQOnceInDB').mockRejectedValue(new Error('write failed'));
    await expect(storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 24 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  test.each([
    [null, 'NOT_FOUND'],
    [createRFQ({ isExtended: true }), 'ALREADY_EXTENDED'],
    [createRFQ({ status: 'Closed' }), 'INVALID_STATUS'],
    [createRFQ(), 'CONCURRENT_UPDATE'],
  ])('explains a conditional write miss based on the latest row: %p', async (latest, reason) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB')
      .mockResolvedValueOnce(createRFQ())
      .mockResolvedValueOnce(latest);
    jest.spyOn(domainQueries, 'extendRFQOnceInDB').mockResolvedValue(null);
    await expect(storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 24 })).resolves.toMatchObject({
      success: false,
      reason,
    });
  });

  test('maps a failed conditional-write verification read to a retryable persistence error', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB')
      .mockResolvedValueOnce(createRFQ())
      .mockRejectedValueOnce(new Error('verification failed'));
    jest.spyOn(domainQueries, 'extendRFQOnceInDB').mockResolvedValue(null);
    await expect(storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 24 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  test('retains the in-memory mode when no database is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    storeService.rfqs.push(createRFQ());
    const result = await storeService.extendRFQDurably(TEST_RFQ_ID, { hours: 48 });
    expect(result.success).toBe(true);
    expect(result.rfq.extensionHours).toBe(48);
  });
});

describe('storeService.getRFQByIdAsync', () => {
  beforeEach(() => {
    storeService.rfqs = storeService.rfqs.filter((rfq) => rfq.id !== TEST_RFQ_ID);
  });

  afterEach(() => {
    storeService.rfqs = storeService.rfqs.filter((rfq) => rfq.id !== TEST_RFQ_ID);
    jest.restoreAllMocks();
  });

  test('loads and caches a database-backed RFQ that is absent from memory', async () => {
    const fresh = createRFQ();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(fresh);

    await expect(storeService.getRFQByIdAsync(TEST_RFQ_ID)).resolves.toMatchObject(fresh);
    expect(storeService.rfqs).toContainEqual(fresh);
  });

  test('removes a stale cached RFQ when storage confirms it no longer exists', async () => {
    storeService.rfqs.push(createRFQ());
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);

    await expect(storeService.getRFQByIdAsync(TEST_RFQ_ID)).resolves.toBeUndefined();
    expect(storeService.rfqs).not.toContainEqual(expect.objectContaining({ id: TEST_RFQ_ID }));
  });

  test('fails closed instead of returning cached data when storage is unavailable', async () => {
    storeService.rfqs.push(createRFQ());
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockRejectedValue(new Error('connection lost'));

    await expect(storeService.getRFQByIdAsync(TEST_RFQ_ID)).rejects.toMatchObject({
      statusCode: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  test('uses the in-memory RFQ when no database is configured', async () => {
    const cached = createRFQ();
    storeService.rfqs.push(cached);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const querySpy = jest.spyOn(domainQueries, 'getRFQByIdFromDB');

    await expect(storeService.getRFQByIdAsync(TEST_RFQ_ID)).resolves.toMatchObject(cached);
    expect(querySpy).not.toHaveBeenCalled();
  });
});
