jest.mock('../src/db/pool', () => ({
  hasStorage: jest.fn(),
  rows: jest.fn(),
  query: jest.fn(),
}));

const pool = require('../src/db/pool');
const { ZOHO_CONFIG } = require('../src/config/constants');
const reconciliationQueries = require('../src/db/zohoReconciliationQueries');

describe('zohoReconciliationQueries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.hasStorage.mockReturnValue(true);
  });

  test('normalizes nullish and whitespace payment-link identifiers', () => {
    expect(reconciliationQueries.normalizePaymentLinkId(undefined)).toBe('');
    expect(reconciliationQueries.normalizePaymentLinkId(null)).toBe('');
    expect(reconciliationQueries.normalizePaymentLinkId('  link-1  ')).toBe('link-1');
    expect(reconciliationQueries.normalizePaymentLinkId(123)).toBe('123');
  });

  test('rejects an empty payment-link identifier without touching storage', async () => {
    await expect(reconciliationQueries.claimPaymentLinkReconciliation('  ')).resolves.toEqual({
      claimed: false,
      reason: 'MISSING_PAYMENT_LINK_ID',
    });
    expect(pool.hasStorage).not.toHaveBeenCalled();
    expect(pool.rows).not.toHaveBeenCalled();
  });

  test('uses a local-only claim when persistence is not configured', async () => {
    pool.hasStorage.mockReturnValue(false);
    const now = new Date('2026-11-11T00:00:00.000Z');

    await expect(reconciliationQueries.claimPaymentLinkReconciliation(' link-local ', now)).resolves.toEqual({
      claimed: true,
      claimedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + ZOHO_CONFIG.RECONCILIATION_LEASE_MS).toISOString(),
      durable: false,
    });
    expect(pool.rows).not.toHaveBeenCalled();
  });

  test('claims a payment link atomically in D1 and PostgreSQL with a bounded lease', async () => {
    pool.rows.mockResolvedValue([{ payment_link_id: 'link-1' }]);
    const now = new Date('2026-11-11T00:00:00.000Z');

    await expect(reconciliationQueries.claimPaymentLinkReconciliation(' link-1 ', now)).resolves.toEqual({
      claimed: true,
      claimedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + ZOHO_CONFIG.RECONCILIATION_LEASE_MS).toISOString(),
      durable: true,
    });

    const [sql, params, options] = pool.rows.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (payment_link_id) DO UPDATE');
    expect(sql).toContain('zoho_reconciliation_claims.lease_expires_at <= EXCLUDED.claimed_at');
    expect(params).toEqual([
      'link-1',
      new Date(now.getTime() + ZOHO_CONFIG.RECONCILIATION_LEASE_MS).toISOString(),
      now.toISOString(),
    ]);
    expect(options).toMatchObject({
      d1: true,
      tag: 'zoho_reconciliation_claims',
      useCache: false,
    });
    expect(options.d1Text).toContain('zoho_reconciliation_claims.lease_expires_at <= excluded.claimed_at');
  });

  test('does not claim a payment link while another isolate holds its lease', async () => {
    pool.rows.mockResolvedValue([]);

    await expect(reconciliationQueries.claimPaymentLinkReconciliation('link-busy')).resolves.toEqual({
      claimed: false,
      reason: 'LEASE_HELD',
    });
  });

  test('releases only the lease owned by the supplied claim timestamp', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });
    const claimedAt = '2026-11-11T00:00:00.000Z';

    await expect(reconciliationQueries.releasePaymentLinkReconciliation(' link-1 ', claimedAt)).resolves.toBe(1);

    expect(pool.query).toHaveBeenCalledWith(
      'DELETE FROM zoho_reconciliation_claims WHERE payment_link_id = $1 AND claimed_at = $2',
      ['link-1', claimedAt],
      expect.objectContaining({
        d1: true,
        tag: 'zoho_reconciliation_claims',
        useCache: false,
        d1Text: 'DELETE FROM zoho_reconciliation_claims WHERE payment_link_id = $1 AND claimed_at = $2',
      })
    );
  });

  test('skips lease release when storage or claim identity is unavailable', async () => {
    await expect(reconciliationQueries.releasePaymentLinkReconciliation('', 'claimed-at')).resolves.toBe(0);
    await expect(reconciliationQueries.releasePaymentLinkReconciliation('link-1', '')).resolves.toBe(0);
    expect(pool.query).not.toHaveBeenCalled();

    pool.hasStorage.mockReturnValue(false);
    await expect(reconciliationQueries.releasePaymentLinkReconciliation('link-1', 'claimed-at')).resolves.toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('reports zero when another claim has already replaced the lease', async () => {
    pool.query.mockResolvedValue({ rowCount: 0 });

    await expect(reconciliationQueries.releasePaymentLinkReconciliation('link-1', 'stale-claim')).resolves.toBe(0);
  });

  test('propagates configured-storage errors instead of running without a durable lease', async () => {
    pool.rows.mockRejectedValue(new Error('database unavailable'));

    await expect(reconciliationQueries.claimPaymentLinkReconciliation('link-error')).rejects.toThrow('database unavailable');
  });

  test('skips lease cleanup when storage is not configured', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(reconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims()).resolves.toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('purges expired leases through an indexed timestamp predicate', async () => {
    pool.query.mockResolvedValue({ rowCount: 3 });
    const now = new Date('2026-11-11T00:00:00.000Z');

    await expect(reconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims(now)).resolves.toBe(3);

    expect(pool.query).toHaveBeenCalledWith(
      'DELETE FROM zoho_reconciliation_claims WHERE lease_expires_at <= $1',
      [now.toISOString()],
      expect.objectContaining({ d1: true, useCache: false, tag: 'zoho_reconciliation_claims' })
    );
  });

  test('reports zero deleted leases when the database does not return a row count', async () => {
    pool.query.mockResolvedValue({});

    await expect(reconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims()).resolves.toBe(0);
  });
});
