jest.mock('../src/db/pool', () => ({
  rows: jest.fn(),
  query: jest.fn(),
}));

const pool = require('../src/db/pool');
const zohoWebhookQueries = require('../src/db/zohoWebhookQueries');
const { ZOHO_WEBHOOK_RECEIPT_POLICY } = require('../src/config/constants');

describe('zohoWebhookQueries', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normalizes identifiers and hashes only the serialized event payload', () => {
    expect(zohoWebhookQueries.normalizeIdentifier(undefined)).toBe('');
    expect(zohoWebhookQueries.normalizeIdentifier(null)).toBe('');
    expect(zohoWebhookQueries.normalizeIdentifier(123)).toBe('123');
    expect(zohoWebhookQueries.hashPayload({ event_id: 'evt-1' })).toBe(
      zohoWebhookQueries.hashPayload({ event_id: 'evt-1' })
    );
    expect(zohoWebhookQueries.hashPayload({ event_id: 'evt-1' })).not.toBe(
      zohoWebhookQueries.hashPayload({ event_id: 'evt-2' })
    );
    expect(zohoWebhookQueries.hashPayload(undefined)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('does not query storage for a missing event id', async () => {
    await expect(zohoWebhookQueries.claimWebhookEvent('acct-1', '  ', {})).resolves.toEqual({
      claimed: false,
      reason: 'MISSING_EVENT_ID',
    });
    expect(pool.rows).not.toHaveBeenCalled();
  });

  test('claims a new event using one conditional insert and a bounded lease', async () => {
    pool.rows.mockResolvedValue([{ event_id: 'evt-1' }]);
    const event = { event_id: 'evt-1', event_type: 'payment_link.paid', payment: { amount: 50 } };

    const result = await zohoWebhookQueries.claimWebhookEvent(' acct-1 ', ' evt-1 ', event);

    expect(result.claimed).toBe(true);
    expect(result.ownerToken).toEqual(expect.any(String));
    const [sql, params, options] = pool.rows.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (account_id, event_id) DO UPDATE');
    expect(sql).toContain("zoho_webhook_events.status <> 'PROCESSED'");
    expect(sql).toContain('lease_expires_at <= $8');
    expect(params[0]).toBe('acct-1');
    expect(params[1]).toBe('evt-1');
    expect(params[2]).toBe('payment_link.paid');
    expect(params[3]).toMatch(/^[a-f0-9]{64}$/);
    expect(params[3]).not.toContain(JSON.stringify(event));
    expect(new Date(params[5]).getTime() - new Date(params[6]).getTime()).toBe(ZOHO_WEBHOOK_RECEIPT_POLICY.LEASE_MS);
    expect(options).toMatchObject({ d1: true, tag: 'zoho_webhook_events' });
  });

  test('does not claim an active or completed event', async () => {
    pool.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'PROCESSING', lease_expires_at: '2026-11-04T00:02:00.000Z' }]);
    await expect(zohoWebhookQueries.claimWebhookEvent('acct-1', 'evt-1', {})).resolves.toEqual({
      claimed: false,
      reason: 'IN_PROGRESS',
      leaseExpiresAt: '2026-11-04T00:02:00.000Z',
    });
    pool.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'PROCESSED' }]);
    await expect(zohoWebhookQueries.claimWebhookEvent('acct-1', 'evt-1', {})).resolves.toMatchObject({
      claimed: false,
      reason: 'PROCESSED',
      leaseExpiresAt: null,
    });
    pool.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(zohoWebhookQueries.claimWebhookEvent('acct-1', 'evt-1', {})).resolves.toEqual({
      claimed: false,
      reason: 'MISSING_RECEIPT',
    });
  });

  test('completes only while the claim owner still holds the processing lease', async () => {
    await expect(zohoWebhookQueries.completeWebhookEvent('acct-1', 'evt-1', '')).resolves.toBe(false);
    pool.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ event_id: 'evt-1' }]);
    await expect(zohoWebhookQueries.completeWebhookEvent('acct-1', 'evt-1', 'owner-1')).resolves.toBe(false);
    await expect(zohoWebhookQueries.completeWebhookEvent('acct-1', 'evt-1', 'owner-1')).resolves.toBe(true);
    expect(pool.rows.mock.calls[1][0]).toContain("status = 'PROCESSED'");
    expect(pool.rows.mock.calls[1][0]).toContain('lease_owner = $3');
  });

  test('marks a failed attempt retryable and bounds the stored error code', async () => {
    await expect(zohoWebhookQueries.failWebhookEvent('acct-1', 'evt-1', null, 'error')).resolves.toBe(false);
    pool.rows.mockResolvedValue([{ event_id: 'evt-1' }]);
    const result = await zohoWebhookQueries.failWebhookEvent('acct-1', 'evt-1', 'owner-1', 'E'.repeat(200));
    expect(result).toBe(true);
    const [sql, params] = pool.rows.mock.calls[0];
    expect(sql).toContain("status = 'FAILED'");
    expect(sql).toContain('lease_owner = $3');
    expect(params[4]).toHaveLength(160);
    pool.rows.mockResolvedValueOnce([]);
    await expect(zohoWebhookQueries.failWebhookEvent('acct-1', 'evt-1', 'owner-1', '')).resolves.toBe(false);
    expect(pool.rows.mock.calls[1][1][4]).toBe('PROCESSING_FAILED');
  });

  test('purges processed and old failed receipts by indexed timestamp and reports row count', async () => {
    pool.query.mockResolvedValue({ rowCount: 7 });
    const now = new Date('2026-11-04T00:00:00.000Z');

    await expect(zohoWebhookQueries.purgeExpiredWebhookEvents(now)).resolves.toBe(7);

    const [sql, params, options] = pool.query.mock.calls[0];
    expect(sql).toContain("status = 'PROCESSED' AND processed_at < $1");
    expect(sql).toContain("status = 'FAILED' AND updated_at < $1");
    expect(new Date(params[0]).getTime()).toBe(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(options).toMatchObject({ d1: true, tag: 'zoho_webhook_events' });
    pool.query.mockResolvedValueOnce({});
    await expect(zohoWebhookQueries.purgeExpiredWebhookEvents()).resolves.toBe(0);
  });

  test('removes at most one batch of expired receipts per run, selected by the primary key pair', async () => {
    pool.query.mockResolvedValue({ rowCount: 0 });

    await zohoWebhookQueries.purgeExpiredWebhookEvents(new Date('2026-11-04T00:00:00.000Z'));

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('(account_id, event_id) IN (');
    expect(sql).toContain('LIMIT $2');
    expect(params).toHaveLength(2);
    expect(params[1]).toBe(require('../src/config/constants').ZOHO_WEBHOOK_RECEIPT_POLICY.PURGE_BATCH_SIZE);
  });
});
