const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const scheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');

const RFQ = { id: 'rfq-batch-1', rfqNumber: 'RFQ-BATCH-1', title: 'Batch RFQ', sourcingMode: 'mode_2' };
const V0_RFQ = { id: 'rfq-v0-batch', rfqNumber: 'RFQ-V0-BATCH', title: 'V0 RFQ', sourcingMode: 'mode_0' };
const VENDORS = [
  { id: 'v-batch-1', name: 'Vendor One', email: 'one@vendor.test', phone: '9000000001' },
  { id: 'v-batch-2', name: 'Vendor Two', email: 'two@vendor.test', phone: '9000000002' },
];

function chaserJob(overrides = {}) {
  return {
    id: 'chaser-1',
    rfqNumber: 'RFQ-1',
    rfqId: 'rfq-1',
    vendorId: 'v-1',
    vendorName: 'Vendor One',
    vendorPhone: null,
    vendorEmail: null,
    vendorContactPerson: null,
    rfqTitle: null,
    channel: 'sms',
    fireAt: '2026-11-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('insertChaserJobsInDB', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('writes nothing without storage or without jobs', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(domainQueries.insertChaserJobsInDB([chaserJob()])).resolves.toEqual([]);

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    await expect(domainQueries.insertChaserJobsInDB([])).resolves.toEqual([]);
    await expect(domainQueries.insertChaserJobsInDB(null)).resolves.toEqual([]);
  });

  test('sends every job to D1 in one batch through the Worker binding', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const binding = {};
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([]);
    const jobs = [
      chaserJob({ id: 'a' }),
      chaserJob({
        id: 'b',
        vendorEmail: 'x@vendor.test',
        vendorPhone: '9000000009',
        vendorContactPerson: 'Contact',
        rfqTitle: 'Title',
        channel: 'email',
      }),
    ];

    await expect(domainQueries.insertChaserJobsInDB(jobs)).resolves.toBe(jobs);

    expect(batch).toHaveBeenCalledTimes(1);
    const [target, statements] = batch.mock.calls[0];
    expect(target).toBe(binding);
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toContain('INSERT INTO chaser_queue');
    expect(statements[0].text).toContain('ON CONFLICT (id) DO NOTHING');
    expect(statements[0].params).toEqual([
      'a', 'RFQ-1', 'rfq-1', 'v-1', 'Vendor One', null, null, null, null, 'sms', '2026-11-13T00:00:00.000Z',
    ]);
    expect(statements[1].params).toEqual([
      'b', 'RFQ-1', 'rfq-1', 'v-1', 'Vendor One', '9000000009', 'x@vendor.test', 'Contact', 'Title', 'email',
      '2026-11-13T00:00:00.000Z',
    ]);
  });

  test('uses the HTTP D1 client when no Worker binding is present', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    const httpClient = {};
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(httpClient);
    const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([]);

    await domainQueries.insertChaserJobsInDB([chaserJob()]);

    expect(batch.mock.calls[0][0]).toBe(httpClient);
  });

  test('writes one row at a time when no D1 client is available', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
    const jobs = [chaserJob({ id: 'p-1' }), chaserJob({ id: 'p-2' })];

    await expect(domainQueries.insertChaserJobsInDB(jobs)).resolves.toEqual(jobs);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][0]).toBe('p-1');
    expect(query.mock.calls[1][1][0]).toBe('p-2');
  });
});

describe('scheduleRFQChasers writes one batch per RFQ on D1', () => {
  let previousEnv;
  let previousWaitUntil;

  beforeEach(() => {
    previousEnv = globalThis.__CF_ENV__;
    previousWaitUntil = globalThis.__CF_WAIT_UNTIL__;
    globalThis.__CF_ENV__ = { DB: {} };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousEnv === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = previousEnv;
    if (previousWaitUntil === undefined) delete globalThis.__CF_WAIT_UNTIL__;
    else globalThis.__CF_WAIT_UNTIL__ = previousWaitUntil;
  });

  test('writes every channel row for every distinct vendor in a single call', async () => {
    const waitUntil = jest.fn();
    globalThis.__CF_WAIT_UNTIL__ = waitUntil;
    const insert = jest.spyOn(domainQueries, 'insertChaserJobsInDB').mockResolvedValue([]);

    scheduler.scheduleRFQChasers(RFQ, [...VENDORS, VENDORS[0], null]);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toHaveLength(8);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
  });

  test('writes only the SMS row for each vendor on a V0 RFQ', async () => {
    globalThis.__CF_WAIT_UNTIL__ = jest.fn();
    const insert = jest.spyOn(domainQueries, 'insertChaserJobsInDB').mockResolvedValue([]);

    scheduler.scheduleRFQChasers(V0_RFQ, VENDORS);

    const rows = insert.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.channel === 'sms')).toBe(true);
  });

  test('logs a failed batch write and does not reject the request', async () => {
    const waitUntil = jest.fn();
    globalThis.__CF_WAIT_UNTIL__ = waitUntil;
    jest.spyOn(domainQueries, 'insertChaserJobsInDB').mockRejectedValue(new Error('batch failed'));
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(() => scheduler.scheduleRFQChasers(RFQ, VENDORS)).not.toThrow();
    await expect(waitUntil.mock.calls[0][0]).resolves.toEqual([]);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist 8 chaser job(s) for RFQ-BATCH-1'),
      {},
      'RFQ_CHASER'
    );
  });

  test('still writes the batch when the runtime offers no waitUntil', async () => {
    delete globalThis.__CF_WAIT_UNTIL__;
    const insert = jest.spyOn(domainQueries, 'insertChaserJobsInDB').mockResolvedValue([]);

    scheduler.scheduleRFQChasers(RFQ, VENDORS);

    expect(insert).toHaveBeenCalledTimes(1);
  });
});
