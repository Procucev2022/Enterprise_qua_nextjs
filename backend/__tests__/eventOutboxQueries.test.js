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
    await expect(eventOutboxQueries.releasePendingBuyerQuoteNotificationsInDB('buyer@example.test')).resolves.toEqual([]);
    await expect(eventOutboxQueries.releaseReadyOnboardingQuoteNotificationsInDB()).resolves.toEqual([]);
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

  test('returns null when an idempotent enqueue retry has no persisted event', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(eventOutboxQueries.enqueueEventOutboxInDB({
      id: 'retry:notification:missing', eventType: 'notification', payload: { id: 'n-missing' },
    })).resolves.toBeNull();
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
      params.now, params.staleBefore, params.limit, params.leaseToken, params.leaseUntil, null,
    ]);
    expect(querySpy.mock.calls[0][2].d1Params).toEqual([
      params.now, params.staleBefore, params.limit, params.leaseToken, params.leaseUntil, null,
    ]);
  });

  test('claims only selected quote events when onboarding releases a target set', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    const params = {
      now: '2026-11-05T00:00:00.000Z',
      staleBefore: '2026-11-04T23:55:00.000Z',
      leaseUntil: '2026-11-05T00:05:00.000Z',
      leaseToken: 'lease-targeted',
      limit: 2,
      ids: ['quote-event-1', 'quote-event-2'],
    };

    await expect(eventOutboxQueries.claimDueEventOutboxInDB(params)).resolves.toEqual([]);
    expect(querySpy.mock.calls[0][0]).toContain('id = ANY($6::varchar[])');
    expect(querySpy.mock.calls[0][1]).toEqual([
      params.now, params.staleBefore, params.limit, params.leaseToken, params.leaseUntil, params.ids,
    ]);
    expect(querySpy.mock.calls[0][2].d1Params.at(-1)).toBe(JSON.stringify(params.ids));
    await expect(eventOutboxQueries.claimDueEventOutboxInDB({ ...params, ids: [] })).resolves.toEqual([]);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  test('releases onboarding-deferred quote notices by indexed buyer recipient', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'quote-event-1' }] });

    await expect(eventOutboxQueries.releasePendingBuyerQuoteNotificationsInDB('Buyer@Example.Test'))
      .resolves.toEqual([{ id: 'quote-event-1' }]);
    expect(querySpy.mock.calls[0][0]).toContain("status = $1 AND event_type = $2 AND lower(raw->>'recipientEmail') = lower($3)");
    expect(querySpy.mock.calls[0][1]).toEqual(['onboarding', 'rfq_quote_received_email', 'Buyer@Example.Test']);
    expect(querySpy.mock.calls[0][2].d1Text).toContain("lower(json_extract(raw, '$.recipientEmail')) = lower($3)");
  });

  test.each([
    [{ binding: null, http: null }, 'raw->>'],
    [{ binding: {}, http: null }, 'json_extract(b.raw'],
    [{ binding: null, http: {} }, 'json_extract(b.raw'],
  ])('periodically releases a bounded batch for completed buyers (%s)', async ({ binding, http }, expectedExpression) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(http);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'quote-ready-1' }] });

    await expect(eventOutboxQueries.releaseReadyOnboardingQuoteNotificationsInDB(100))
      .resolves.toEqual([{ id: 'quote-ready-1' }]);
    expect(querySpy.mock.calls[0][0]).toContain("e.status = $1 AND e.event_type = $2");
    expect(querySpy.mock.calls[0][0]).toContain(expectedExpression);
    expect(querySpy.mock.calls[0][1]).toEqual(['onboarding', 'rfq_quote_received_email', 10]);
    expect(querySpy.mock.calls[0][2].d1Text).toContain("lower(json_extract(e.raw, '$.recipientEmail'))");
    expect(querySpy.mock.calls[0][2].d1Text).toContain("json_extract(b.raw, '$.onboardingRequired')");
  });

  test('uses the default batch size and clamps a zero limit to one', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await expect(eventOutboxQueries.releaseReadyOnboardingQuoteNotificationsInDB()).resolves.toEqual([]);
    await expect(eventOutboxQueries.releaseReadyOnboardingQuoteNotificationsInDB(0)).resolves.toEqual([]);

    expect(querySpy.mock.calls[0][1]).toEqual(['onboarding', 'rfq_quote_received_email', 10]);
    expect(querySpy.mock.calls[1][1]).toEqual(['onboarding', 'rfq_quote_received_email', 1]);
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
    const querySpy = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [], rowCount: 3 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(eventOutboxQueries.purgeEventOutboxInDB('cutoff-a', 'cutoff-b')).resolves.toBe(3);
    await expect(eventOutboxQueries.purgeEventOutboxInDB('cutoff-a', 'cutoff-b')).resolves.toBe(0);
    expect(querySpy.mock.calls[0][0]).toContain("status = 'dead'");
    expect(querySpy.mock.calls[0][0]).toContain("created_at < $2");
    expect(querySpy.mock.calls[0][0]).toContain('LIMIT $4');
    expect(querySpy.mock.calls[0][1]).toEqual([
      'cutoff-a',
      'cutoff-b',
      'onboarding',
      require('../src/config/constants').EVENT_OUTBOX_PURGE_BATCH_SIZE,
    ]);
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
