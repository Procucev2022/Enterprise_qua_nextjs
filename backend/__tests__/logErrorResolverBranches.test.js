const path = require('path');
const { LogErrorResolver } = require('../src/services/logErrorResolver');

afterEach(() => {
  jest.restoreAllMocks();
});

function resolverWithEntries(entries) {
  const resolver = new LogErrorResolver({ logsDir: __dirname });
  jest.spyOn(resolver, 'parseLogLines').mockReturnValue(entries);
  return resolver;
}

describe('LogErrorResolver default logs folder', () => {
  test('builds the default folder from the module location', () => {
    expect(LogErrorResolver.resolveDefaultLogsDir()).toMatch(/logs$/);
  });

  test('falls back to a relative folder when the module location cannot be built', () => {
    jest.spyOn(path, 'join').mockImplementationOnce(() => {
      throw new Error('module location unavailable');
    });

    expect(LogErrorResolver.resolveDefaultLogsDir()).toBe('./logs');
  });
});

describe('LogErrorResolver diagnosis of slow queries and connection faults', () => {
  test('classifies a slow database query as a bottleneck with a cache optimisation action', () => {
    const issues = resolverWithEntries([
      {
        level: 'WARN',
        message: "Slow database query detected on table 'rfqs' (select): 250ms",
        category: 'PERFORMANCE',
      },
    ]).diagnoseErrors();

    expect(issues).toEqual([
      expect.objectContaining({
        issueType: 'SLOW_QUERY_BOTTLENECK',
        severity: 'MEDIUM',
        suggestedAction: 'OPTIMIZE_QUERY_CACHE',
        count: 1,
      }),
    ]);
  });

  test('keeps a real connection failure on the reconnect path', () => {
    const issues = resolverWithEntries([
      { level: 'ERROR', message: 'PostgreSQL connection timeout on pool query', category: 'DATABASE' },
    ]).diagnoseErrors();

    expect(issues).toEqual([
      expect.objectContaining({
        issueType: 'DATABASE_CONNECTION_FAULT',
        severity: 'HIGH',
        suggestedAction: 'RECONNECT_POOL_AND_INVALIDATE_CACHE',
      }),
    ]);
  });
});
