/**
 * @jest-environment node
 */
import { detectDBProvider, query, checkDBHealth, initializeSchema, pool } from '@/lib/db';

describe('lib/db/index', () => {
  describe('detectDBProvider', () => {
    it('should detect in-memory mock when connection string is empty', () => {
      const res = detectDBProvider('');
      expect(res.provider).toBe('in_memory_mock');
      expect(res.label).toContain('In-Memory');
    });

    it('should detect Neon / Vercel postgres', () => {
      const res1 = detectDBProvider('postgres://user:pass@ep-cool-neon.tech/dbname');
      expect(res1.provider).toBe('neon');

      const res2 = detectDBProvider('postgres://user:pass@verceldb.net/dbname');
      expect(res2.provider).toBe('neon');
    });

    it('should detect Supabase postgres', () => {
      const res = detectDBProvider('postgres://user:pass@db.xyz.supabase.co/dbname');
      expect(res.provider).toBe('supabase');
    });

    it('should detect Azure Postgres', () => {
      const res = detectDBProvider('postgres://user:pass@server.postgres.database.azure.com/dbname');
      expect(res.provider).toBe('azure_postgres');
    });

    it('should detect AWS RDS postgres', () => {
      const res = detectDBProvider('postgres://user:pass@mydb.rds.amazonaws.com/dbname');
      expect(res.provider).toBe('aws_rds');
    });

    it('should fallback to local/dedicated postgres', () => {
      const res = detectDBProvider('postgres://localhost:5432/mydb');
      expect(res.provider).toBe('local_postgres');
    });
  });

  describe('query fallback when pool is null', () => {
    it('should throw error if pool is null and query is called', async () => {
      if (!pool) {
        await expect(query('SELECT 1')).rejects.toThrow('DATABASE_URL is not configured');
      }
    });
  });

  describe('checkDBHealth when pool is null', () => {
    it('should return mock health status when pool is null', async () => {
      const health = await checkDBHealth();
      expect(health).toBeDefined();
      expect(health.timestamp).toBeDefined();
      if (!pool) {
        expect(health.isConnected).toBe(false);
        expect(health.totalRecords.buyerAccounts).toBe(6);
      }
    });
  });

  describe('initializeSchema when pool is null', () => {
    it('should throw or reject if pool is null', async () => {
      if (!pool) {
        await expect(initializeSchema()).rejects.toThrow('Cannot initialize schema');
      }
    });
  });
});
