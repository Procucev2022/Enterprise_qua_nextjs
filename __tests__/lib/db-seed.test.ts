/**
 * @jest-environment node
 */
import { seedInitialDataToPostgres, SEED_BUYER_ACCOUNTS, SEED_VENDORS } from '@/lib/db/seed';
import { pool } from '@/lib/db';

describe('lib/db/seed', () => {
  it('should export valid SEED_BUYER_ACCOUNTS and SEED_VENDORS', () => {
    expect(Array.isArray(SEED_BUYER_ACCOUNTS)).toBe(true);
    expect(SEED_BUYER_ACCOUNTS.length).toBeGreaterThan(0);
    expect(Array.isArray(SEED_VENDORS)).toBe(true);
    expect(SEED_VENDORS.length).toBeGreaterThan(0);
  });

  it('should handle seedInitialDataToPostgres when pool is null', async () => {
    if (!pool) {
      const res = await seedInitialDataToPostgres();
      expect(res.success).toBe(false);
      expect(res.message).toContain('DATABASE_URL is not set');
      expect(res.counts.buyerAccounts).toBe(0);
    }
  });
});
