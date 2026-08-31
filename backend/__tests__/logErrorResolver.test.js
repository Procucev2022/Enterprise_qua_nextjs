const fs = require('fs');
const path = require('path');
const { LogErrorResolver, logErrorResolver } = require('../src/services/logErrorResolver');

describe('LogErrorResolver Unit Tests', () => {
  const tempLogsDir = path.join(__dirname, 'temp_logs_test');

  beforeAll(() => {
    if (!fs.existsSync(tempLogsDir)) {
      fs.mkdirSync(tempLogsDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempLogsDir)) {
      fs.rmSync(tempLogsDir, { recursive: true, force: true });
    }
  });

  test('parseLogLines handles non-existent file and file read error gracefully', () => {
    const resolver = new LogErrorResolver({ logsDir: path.join(__dirname, 'non_existent') });
    expect(resolver.parseLogLines('error')).toEqual([]);

    // File path testing for different logTypes
    expect(resolver.getLogFilePath('error')).toMatch(/error\.log$/);
    expect(resolver.getLogFilePath('audit')).toMatch(/audit\.log$/);
    expect(resolver.getLogFilePath('app')).toMatch(/app\.log$/);
    expect(resolver.getLogFilePath('unknown')).toMatch(/app\.log$/);

    // Read error catch branch
    const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw new Error('Disk Read Failure');
    });
    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(true);
    expect(resolver.parseLogLines('error')).toEqual([]);
    readSpy.mockRestore();
  });

  test('parseLogLines and diagnoseErrors parses structured, error-keyed, and unstructured logs', () => {
    const errorLogPath = path.join(tempLogsDir, 'error.log');
    const mockLines = [
      JSON.stringify({
        timestamp: '2026-08-30T09:00:00.000Z',
        level: 'ERROR',
        message: 'PostgreSQL connection timeout on pool query',
        category: 'DATABASE',
      }),
      JSON.stringify({
        timestamp: '2026-08-30T09:01:00.000Z',
        level: 'WARN',
        message: 'Slow database query detected on table rfqs: 250ms',
        category: 'PERFORMANCE',
      }),
      JSON.stringify({
        timestamp: '2026-08-30T09:02:00.000Z',
        level: 'ERROR',
        message: 'GraphQL syntax error: Cannot query field foo',
        category: 'GRAPHQL_API',
      }),
      JSON.stringify({
        timestamp: '2026-08-30T09:03:00.000Z',
        level: 'ERROR',
        message: 'Fatal error: Out of memory heap allocation failed',
        category: 'SYSTEM',
      }),
      JSON.stringify({
        timestamp: '2026-08-30T09:04:00.000Z',
        level: 'ERROR',
        error: 'Entry using error field instead of message',
      }),
      JSON.stringify({
        timestamp: '2026-08-30T09:05:00.000Z',
        level: 'ERROR',
      }),
      'UNSTRUCTURED RAW STACK TRACE LINE',
    ].join('\n');

    fs.writeFileSync(errorLogPath, mockLines, 'utf8');

    const resolver = new LogErrorResolver({ logsDir: tempLogsDir });
    const parsed = resolver.parseLogLines('error');
    expect(parsed.length).toBe(7);

    const diagnosed = resolver.diagnoseErrors();
    expect(diagnosed.length).toBeGreaterThanOrEqual(4);

    const dbIssue = diagnosed.find((d) => d.issueType === 'DATABASE_CONNECTION_FAULT');
    expect(dbIssue).toBeDefined();
    expect(dbIssue.severity).toBe('HIGH');

    const graphqlIssue = diagnosed.find((d) => d.issueType === 'GRAPHQL_VALIDATION_FAULT');
    expect(graphqlIssue).toBeDefined();
    expect(graphqlIssue.severity).toBe('LOW');

    const memIssue = diagnosed.find((d) => d.issueType === 'MEMORY_PRESSURE');
    expect(memIssue).toBeDefined();
    expect(memIssue.severity).toBe('CRITICAL');
  });

  test('executeRemediation applies remediation strategies and tracks history exceeding buffer limit', async () => {
    const resolver = new LogErrorResolver({ logsDir: tempLogsDir });

    const rem1 = await resolver.executeRemediation('RECONNECT_POOL_AND_INVALIDATE_CACHE');
    expect(rem1.actionType).toBe('RECONNECT_POOL_AND_INVALIDATE_CACHE');

    const rem2 = await resolver.executeRemediation('OPTIMIZE_QUERY_CACHE');
    expect(rem2.actionType).toBe('OPTIMIZE_QUERY_CACHE');

    const rem3 = await resolver.executeRemediation('PURGE_EXPIRED_LOGS_AND_FLUSH_CACHE');
    expect(rem3.actionType).toBe('PURGE_EXPIRED_LOGS_AND_FLUSH_CACHE');

    const rem4 = await resolver.executeRemediation('VALIDATE_SCHEMA_CLIENT_COMPATIBILITY');
    expect(rem4.actionType).toBe('VALIDATE_SCHEMA_CLIENT_COMPATIBILITY');

    // Default remediation branch
    const remDefault = await resolver.executeRemediation('CUSTOM_ACTION');
    expect(remDefault.message).toMatch(/Validated schema stability/i);

    // Fill history to > 50
    for (let i = 0; i < 55; i++) {
      await resolver.executeRemediation('OPTIMIZE_QUERY_CACHE');
    }
    const history = resolver.getRemediationHistory();
    expect(history.length).toBe(50);
  });

  test('autoResolveAll diagnoses and resolves all detected errors', async () => {
    const resolver = new LogErrorResolver({ logsDir: tempLogsDir });
    const report = await resolver.autoResolveAll();

    expect(report.diagnosedCount).toBeGreaterThanOrEqual(1);
    expect(report.remediationsApplied.length).toBeGreaterThanOrEqual(1);
  });

  test('singleton logErrorResolver works properly', async () => {
    const issues = logErrorResolver.diagnoseErrors();
    expect(Array.isArray(issues)).toBe(true);

    const history = logErrorResolver.getRemediationHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});
