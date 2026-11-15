const pool = require('../src/db/pool');
const queries = require('../src/db/rfqComparisonQueueQueries');

describe('RFQ comparison queue queries', () => {
  afterEach(() => jest.restoreAllMocks());

  test('inserts one idempotent durable job for an RFQ', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    const job = {
      id: 'comparison-rfq-1',
      rfqId: 'rfq-1',
      rfqNumber: 'RFQ-1',
      fireAt: '2026-11-06T10:05:00.000Z',
    };

    await expect(queries.insertRFQComparisonJobInDB(job)).resolves.toEqual(job);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (rfq_id) DO NOTHING'),
      ['comparison-rfq-1', 'rfq-1', 'RFQ-1', '2026-11-06T10:05:00.000Z'],
      { d1: true }
    );
  });

  test('lists jobs with a bounded safe limit', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'comparison-rfq-1' }] });

    await expect(queries.getPendingRFQComparisonJobsFromDB(25)).resolves.toEqual([{ id: 'comparison-rfq-1' }]);
    await queries.getPendingRFQComparisonJobsFromDB('invalid');
    await queries.getPendingRFQComparisonJobsFromDB(2000);

    expect(query.mock.calls.map((call) => call[1])).toEqual([[25], [1000], [1000]]);
    expect(query.mock.calls[0][2]).toEqual({ d1: true, d1Text: query.mock.calls[0][0] });
  });

  test('claims due jobs with and without an exact job ID', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'comparison-rfq-1' }] });

    await expect(queries.claimDueRFQComparisonJobsFromDB('now', 'stale', 10, 'comparison-rfq-1'))
      .resolves.toEqual([{ id: 'comparison-rfq-1' }]);
    await queries.claimDueRFQComparisonJobsFromDB('now', 'stale', 500);

    expect(query.mock.calls[0][0]).toContain('AND id=$4');
    expect(query.mock.calls[0][1]).toEqual(['now', 'stale', 10, 'comparison-rfq-1']);
    expect(query.mock.calls[1][1]).toEqual(['now', 'stale', 100]);
    expect(query.mock.calls[1][0]).toContain("status='processing'");
    expect(query.mock.calls[1][0]).toContain('email_completed_at, sms_completed_at');
  });

  test('records completion for a job and each supported delivery channel', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await queries.markRFQComparisonJobCompleteInDB('comparison-rfq-1');
    await queries.markRFQComparisonChannelCompleteInDB('comparison-rfq-1', 'email');
    await queries.markRFQComparisonChannelCompleteInDB('comparison-rfq-1', 'sms');
    await expect(queries.markRFQComparisonChannelCompleteInDB('comparison-rfq-1', 'fax'))
      .rejects.toThrow('Unsupported RFQ comparison channel: fax');

    expect(query.mock.calls[0][0]).toContain("status='complete'");
    expect(query.mock.calls[1][0]).toContain('email_completed_at=COALESCE');
    expect(query.mock.calls[2][0]).toContain('sms_completed_at=COALESCE');
  });

  test('retries failed jobs with bounded error text and attempt limit', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await queries.markRFQComparisonJobFailedInDB('comparison-rfq-1', 'provider rejected');
    await queries.markRFQComparisonJobFailedInDB('comparison-rfq-2', '');

    expect(query.mock.calls[0][0]).toContain("WHEN attempts < $4 THEN 'pending'");
    expect(query.mock.calls[0][1][2]).toBe('provider rejected');
    expect(query.mock.calls[0][1][3]).toBe(5);
    expect(query.mock.calls[1][1][2]).toBe('unknown');
  });

  test('safely no-ops all persistence operations without configured storage', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const query = jest.spyOn(pool, 'query');

    await expect(queries.insertRFQComparisonJobInDB({})).resolves.toBeNull();
    await expect(queries.getPendingRFQComparisonJobsFromDB()).resolves.toEqual([]);
    await expect(queries.claimDueRFQComparisonJobsFromDB('now', 'stale')).resolves.toEqual([]);
    await expect(queries.markRFQComparisonJobCompleteInDB('job')).resolves.toBeUndefined();
    await expect(queries.markRFQComparisonChannelCompleteInDB('job', 'fax')).resolves.toBeUndefined();
    await expect(queries.markRFQComparisonJobFailedInDB('job', 'error')).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});
