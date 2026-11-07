const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const { logger } = require('../src/services/loggerService');

describe('event-outbox database operations', () => {
  afterEach(() => jest.restoreAllMocks());

  test('returns safe no-op values when storage is not configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

    await expect(eventOutboxQueries.enqueueEventOutboxInDB({ id: 'e-1', eventType: 'ai_feed', payload: {} })).resolves.toBeNull();
    await expect(eventOutboxQueries.claimDueEventOutboxInDB({})).resolves.toEqual([]);
    await expect(eventOutboxQueries.markEventOutboxCompleteInDB('e-1', 'lease')).resolves.toBe(false);
    await expect(eventOutboxQueries.rescheduleEventOutboxInDB({ id: 'e-1' })).resolves.toBe(false);
    await expect(eventOutboxQueries.purgeEventOutboxInDB('2026-01-01', '2026-01-01')).resolves.toBe(0);
  });

  test('parses payload values and rejects malformed JSON with a stable error code', () => {
    expect(eventOutboxQueries.parseRaw({ id: 'object' })).toEqual({ id: 'object' });
    expect(eventOutboxQueries.parseRaw('{"id":"json"}')).toEqual({ id: 'json' });
    expect(eventOutboxQueries.parseRaw('null')).toEqual({});
    expect(eventOutboxQueries.parseRaw(null)).toEqual({});
    expect(() => eventOutboxQueries.parseRaw('{')).toThrow(expect.objectContaining({ code: 'INVALID_PERSISTED_RECORD' }));
  });

  test('inserts a retry event idempotently with its JSON payload', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'retry:ai_feed:abc', status: 'pending' }] });
    const event = { id: 'retry:ai_feed:abc', eventType: 'ai_feed', payload: { id: 'feed-1' } };

    await expect(eventOutboxQueries.enqueueEventOutboxInDB(event)).resolves.toEqual({ id: event.id, status: 'pending' });
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (id) DO UPDATE'),
      [event.id, event.eventType, JSON.stringify(event.payload)],
      expect.objectContaining({ d1: true, d1Text: expect.stringContaining('RETURNING id, status') })
    );
  });

  test('returns an existing event on an idempotent enqueue retry', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'retry:notification:abc', status: 'processing' }] });

    await expect(eventOutboxQueries.enqueueEventOutboxInDB({
      id: 'retry:notification:abc', eventType: 'notification', payload: { id: 'n-1' },
    })).resolves.toMatchObject({ status: 'processing' });
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(querySpy.mock.calls[1][0]).toContain('SELECT id, status FROM event_outbox');
  });

  test('claims due events with a lease and parses D1 JSON payloads', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const job = {
      id: 'retry:ai_feed:abc',
      event_type: 'ai_feed',
      raw: '{"id":"feed-1"}',
      attempts: 1,
      lease_token: 'lease-1',
    };
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [job] });
    const params = {
      now: '2026-11-05T00:00:00.000Z',
      staleBefore: '2026-11-04T23:55:00.000Z',
      leaseUntil: '2026-11-05T00:05:00.000Z',
      leaseToken: 'lease-1',
      limit: 10,
    };

    await expect(eventOutboxQueries.claimDueEventOutboxInDB(params)).resolves.toEqual([
      { ...job, raw: { id: 'feed-1' } },
    ]);
    expect(querySpy.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(querySpy.mock.calls[0][2].d1Text).toContain('UPDATE event_outbox');
    expect(querySpy.mock.calls[0][1]).toEqual([
      params.now, params.staleBefore, params.limit, params.leaseToken, params.leaseUntil,
    ]);
  });

  test('returns malformed payloads as claimed parse failures so workers can dead-letter them', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{
      id: 'retry:ai_feed:malformed', event_type: 'ai_feed', raw: '{', attempts: 1, lease_token: 'lease-bad',
    }] });

    await expect(eventOutboxQueries.claimDueEventOutboxInDB({
      now: '2026-11-05T00:00:00.000Z',
      staleBefore: '2026-11-04T23:55:00.000Z',
      leaseUntil: '2026-11-05T00:05:00.000Z',
      leaseToken: 'lease-bad',
      limit: 1,
    })).resolves.toEqual([expect.objectContaining({
      id: 'retry:ai_feed:malformed', raw: null,
      parseError: expect.objectContaining({ code: 'INVALID_PERSISTED_RECORD' }),
    })]);
  });

  test('marks completion only for the worker that owns the lease', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'event-1' }], rowCount: 1 });

    await expect(eventOutboxQueries.markEventOutboxCompleteInDB('event-1', 'lease-1')).resolves.toBe(true);
    expect(querySpy.mock.calls[0][0]).toContain("status = 'completed'");
    expect(querySpy.mock.calls[0][1]).toEqual(['event-1', 'lease-1']);
  });

  test('reschedules retry or dead-letter state using a lease token', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'event-1' }], rowCount: 1 });
    const retry = { id: 'event-1', leaseToken: 'lease-1', status: 'pending', availableAt: '2026-11-05T00:01:00.000Z', lastError: 'E_DOWN:Error' };

    await expect(eventOutboxQueries.rescheduleEventOutboxInDB(retry)).resolves.toBe(true);
    expect(querySpy.mock.calls[0][0]).toContain("status = 'processing' AND lease_token = $2");
    expect(querySpy.mock.calls[0][1]).toEqual(['event-1', 'lease-1', 'pending', retry.availableAt, retry.lastError]);
  });

  test('purges retained completed and dead-letter rows', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 3 });

    await expect(eventOutboxQueries.purgeEventOutboxInDB('cutoff-a', 'cutoff-b')).resolves.toBe(3);
    expect(querySpy.mock.calls[0][0]).toContain("status = 'dead'");
    expect(querySpy.mock.calls[0][1]).toEqual(['cutoff-a', 'cutoff-b']);
  });

  test.each([
    [{ binding: {}, http: null }, 'cloudflare-d1'],
    [{ binding: null, http: {} }, 'cloudflare-d1-http'],
    [{ binding: null, http: null }, 'postgres'],
  ])('logs provider metadata (%s)', async ({ binding, http }, provider) => {
    const failure = new Error('database unavailable');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockRejectedValue(failure);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(http);
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxQueries.enqueueEventOutboxInDB({ id: 'e-1', eventType: 'ai_feed', payload: {} }))
      .rejects.toBe(failure);
    expect(loggerSpy).toHaveBeenCalledWith('Event-outbox database operation failed', expect.objectContaining({ provider }), 'EVENT_OUTBOX');
  });
});
