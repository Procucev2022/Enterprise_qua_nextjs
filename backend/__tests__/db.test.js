const { detectDBProvider, sanitizeConnectionString } = require('../src/db/pool');

describe('Database Configuration & Connection Helpers', () => {
  test('detectDBProvider identifies Neon / Vercel', () => {
    const res = detectDBProvider('postgres://user:pass@ep-cool-fog-12345.us-east-2.aws.neon.tech/neondb');
    expect(res.provider).toBe('neon');
    expect(res.label).toContain('Neon');
  });

  test('detectDBProvider identifies Supabase', () => {
    const res = detectDBProvider('postgresql://postgres:pass@db.xyz.supabase.co:5432/postgres');
    expect(res.provider).toBe('supabase');
  });

  test('detectDBProvider identifies Azure Flexible Postgres', () => {
    const res = detectDBProvider('postgresql://admin:pass@psql-procucev.postgres.database.azure.com:5432/procucev_db');
    expect(res.provider).toBe('azure_postgres');
  });

  test('detectDBProvider identifies AWS RDS', () => {
    const res = detectDBProvider('postgresql://admin:pass@rds-instance.123456789.us-east-1.rds.amazonaws.com:5432/mydb');
    expect(res.provider).toBe('aws_rds');
  });

  test('detectDBProvider falls back to in-memory mock when empty', () => {
    const res = detectDBProvider('');
    expect(res.provider).toBe('in_memory_mock');
    expect(res.label).toContain('In-Memory');
  });

  test('sanitizeConnectionString appends uselibpqcompat for sslmode=require', () => {
    const raw = 'postgresql://user:pass@host/db?sslmode=require';
    const sanitized = sanitizeConnectionString(raw);
    expect(sanitized).toContain('uselibpqcompat=true');
  });
});
