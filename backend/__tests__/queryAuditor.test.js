const { QueryAuditor, queryAuditor } = require('../src/db/queryAuditor');

describe('Database QueryAuditor Unit Tests', () => {
  let auditor;

  beforeEach(() => {
    auditor = new QueryAuditor({ slowQueryThresholdMs: 50 });
  });

  test('detectTable extracts table names from diverse SQL queries and handles empty/default args', () => {
    expect(auditor.detectTable('SELECT * FROM vendors WHERE id = 1')).toBe('vendors');
    expect(auditor.detectTable('INSERT INTO buyer_accounts (id) VALUES (1)')).toBe('buyer_accounts');
    expect(auditor.detectTable('UPDATE rfqs SET status = $1')).toBe('rfqs');
    expect(auditor.detectTable('SELECT * FROM rfqs JOIN vendor_evaluations ON rfqs.id = vendor_evaluations.id')).toBe('rfqs');
    expect(auditor.detectTable('SELECT 1')).toBe('other');
    expect(auditor.detectTable('')).toBe('other');
    expect(auditor.detectTable()).toBe('other');
  });

  test('auditQuery tracks normal and slow queries with table statistics and default arguments', () => {
    const defaultAuditor = new QueryAuditor();
    expect(defaultAuditor.slowQueryThresholdMs).toBe(200);
    defaultAuditor.auditQuery('SELECT 1');

    // Fast query
    const fastRes = auditor.auditQuery('SELECT * FROM vendors', [], 10, false);
    expect(fastRes.isSlow).toBe(false);
    expect(fastRes.table).toBe('vendors');

    // Slow query
    const slowRes = auditor.auditQuery('SELECT * FROM rfqs WHERE line_items @> $1', [], 120, false);
    expect(slowRes.isSlow).toBe(true);
    expect(slowRes.table).toBe('rfqs');

    // Cache hit query
    const cacheHitRes = auditor.auditQuery('SELECT * FROM vendors', [], 80, true);
    expect(cacheHitRes.isSlow).toBe(false);

    const report = auditor.getAuditReport();
    expect(report.totalQueriesExecuted).toBe(3);
    expect(report.totalExecutionTimeMs).toBe(210);
    expect(report.slowQueriesCount).toBe(1);
    expect(report.recentSlowQueries.length).toBe(1);
    expect(report.tableExecutionBreakdown.vendors.count).toBe(2);
    expect(report.tableExecutionBreakdown.rfqs.count).toBe(1);
    expect(report.tableExecutionBreakdown.rfqs.slowCount).toBe(1);
  });

  test('respects maxSlowQueryLog buffer limit', () => {
    for (let i = 0; i < 60; i++) {
      auditor.auditQuery(`SELECT * FROM test_${i}`, [], 100, false);
    }
    expect(auditor.slowQueries.length).toBe(50);
  });

  test('reset clears all accumulated metrics and handles 0 query report', () => {
    auditor.auditQuery('SELECT 1', [], 10, false);
    auditor.reset();
    const report = auditor.getAuditReport();
    expect(report.totalQueriesExecuted).toBe(0);
    expect(report.averageQueryDurationMs).toBe(0);
  });

  test('singleton queryAuditor methods execute without error', () => {
    queryAuditor.reset();
    queryAuditor.auditQuery('SELECT * FROM system_config', [], 5, false);
    const report = queryAuditor.getAuditReport();
    expect(report.totalQueriesExecuted).toBe(1);
  });
});
