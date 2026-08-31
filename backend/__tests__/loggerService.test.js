const fs = require('fs');
const path = require('path');
const { LoggerService, logger, LOG_LEVELS } = require('../src/services/loggerService');

describe('Backend LoggerService Unit Tests', () => {
  const testLogsDir = path.resolve(__dirname, '../logs_test');
  let testLogger;

  beforeEach(() => {
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
    testLogger = new LoggerService({
      logsDir: testLogsDir,
      maxBufferSize: 10,
      retentionDays: 1,
      maxFileSizeBytes: 1024,
      isLocalLoggingEnabled: true,
    });
  });

  afterEach(() => {
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
    logger.clear();
  });

  test('LOG_LEVELS constant maps correctly', () => {
    expect(LOG_LEVELS.DEBUG).toBe(0);
    expect(LOG_LEVELS.INFO).toBe(1);
    expect(LOG_LEVELS.WARN).toBe(2);
    expect(LOG_LEVELS.ERROR).toBe(3);
    expect(LOG_LEVELS.AUDIT).toBe(4);
  });

  test('logs INFO, WARN, ERROR, DEBUG, AUDIT entries with structured metadata and stack traces', () => {
    const infoEntry = testLogger.info('Server started', { port: 5000 }, 'SYSTEM_BOOT');
    expect(infoEntry.level).toBe('INFO');
    expect(infoEntry.message).toBe('Server started');
    expect(infoEntry.metadata.port).toBe(5000);
    expect(infoEntry.category).toBe('SYSTEM_BOOT');
    expect(infoEntry.timestamp).toBeDefined();
    expect(infoEntry.id).toBeDefined();

    const warnEntry = testLogger.warn('High memory usage', { memMB: 512 });
    expect(warnEntry.level).toBe('WARN');

    // Direct Error instance
    const err = new Error('Database timeout');
    const errEntry1 = testLogger.error('DB query failed', err, 'DATABASE');
    expect(errEntry1.level).toBe('ERROR');
    expect(errEntry1.stackTrace).toBeDefined();
    expect(errEntry1.metadata.errorMessage).toBe('Database timeout');

    // Error in metadata object
    const errEntry2 = testLogger.error('API failed', { error: new Error('Network failure'), requestId: 'req-123' });
    expect(errEntry2.level).toBe('ERROR');
    expect(errEntry2.correlationId).toBe('req-123');
    expect(errEntry2.stackTrace).toBeDefined();

    const debugEntry = testLogger.debug('Evaluating RFQ quotes', { quotesCount: 4 });
    expect(debugEntry.level).toBe('DEBUG');

    const auditEntry = testLogger.audit('Created RFQ-2026-00450', 'cpo@enterprise.com', { budget: 150000 }, 'RFQ-2026-00450');
    expect(auditEntry.level).toBe('AUDIT');
    expect(auditEntry.userEmail).toBe('cpo@enterprise.com');
    expect(auditEntry.metadata.rfqNumber).toBe('RFQ-2026-00450');

    // Verify files created on disk
    expect(fs.existsSync(path.join(testLogsDir, 'app.log'))).toBe(true);
    expect(fs.existsSync(path.join(testLogsDir, 'error.log'))).toBe(true);
    expect(fs.existsSync(path.join(testLogsDir, 'audit.log'))).toBe(true);
  });

  test('respects maxBufferSize and evicts oldest items in memory ring buffer', () => {
    for (let i = 0; i < 15; i++) {
      testLogger.info(`Log message ${i}`);
    }
    const stats = testLogger.getLogStats();
    expect(stats.totalLogs).toBe(10);
  });

  test('queryLogs filters by level, category, search query, date ranges, and pagination', () => {
    testLogger.info('User buyer logged in', { userEmail: 'buyer@procucev.com' }, 'AUTH');
    testLogger.warn('Rate limit threshold approaching', { ip: '10.0.0.1' }, 'SECURITY');
    testLogger.error('Failed to connect to Azure service bus', new Error('Timeout'), 'INFRA');
    testLogger.audit('Updated vendor rating', 'admin@procucev.com', { score: 92 });

    // Filter by level
    const errorsOnly = testLogger.queryLogs({ level: 'ERROR' });
    expect(errorsOnly.total).toBe(1);
    expect(errorsOnly.logs[0].level).toBe('ERROR');

    // Filter by category
    const authOnly = testLogger.queryLogs({ category: 'AUTH' });
    expect(authOnly.total).toBe(1);
    expect(authOnly.logs[0].category).toBe('AUTH');

    // Filter by search
    const searchResult = testLogger.queryLogs({ search: 'procucev.com' });
    expect(searchResult.total).toBe(2);

    // Search query matching message text
    const searchMsg = testLogger.queryLogs({ search: 'Rate limit' });
    expect(searchMsg.total).toBe(1);

    // Date range filtering
    const now = new Date();
    const fromPast = new Date(now.getTime() - 60000).toISOString();
    const toFuture = new Date(now.getTime() + 60000).toISOString();
    const dateFiltered = testLogger.queryLogs({ from: fromPast, to: toFuture, limit: 2, offset: 0 });
    expect(dateFiltered.count).toBe(2);
    expect(dateFiltered.total).toBe(4);

    // Out of range date filter
    const pastTo = new Date(now.getTime() - 100000).toISOString();
    const emptyDateResult = testLogger.queryLogs({ to: pastTo });
    expect(emptyDateResult.total).toBe(0);
  });

  test('purgeExpiredLogs clears old entries and truncates large disk files', () => {
    // Write entries
    for (let i = 0; i < 5; i++) {
      testLogger.info(`Log message ${i}`);
    }

    // Set an old timestamp on one log
    testLogger.inMemoryLogs[0].timestamp = '2020-01-01 00:00:00.000 UTC';

    // Simulate oversized file
    const largeContent = 'A'.repeat(2048) + '\n';
    fs.writeFileSync(path.join(testLogsDir, 'app.log'), largeContent, 'utf8');

    const purgeReport = testLogger.purgeExpiredLogs({ maxAgeDays: 30 });
    expect(purgeReport.success).toBe(true);
    expect(purgeReport.purgedMemoryCount).toBe(1);
    expect(purgeReport.diskFilesPurged).toBeGreaterThanOrEqual(1);
  });

  test('getLogStats returns counts and disk log file metadata', () => {
    testLogger.info('Info log');
    testLogger.error('Error log');
    testLogger.debug('Debug log');

    const stats = testLogger.getLogStats();
    expect(stats.levelCounts.INFO).toBe(1);
    expect(stats.levelCounts.ERROR).toBe(1);
    expect(stats.levelCounts.DEBUG).toBe(1);
    expect(stats.diskLogFiles.length).toBeGreaterThan(0);
  });

  test('handles disabled local disk logging gracefully', () => {
    const noDiskLogger = new LoggerService({
      isLocalLoggingEnabled: false,
    });
    const entry = noDiskLogger.info('In memory only log');
    expect(entry.message).toBe('In memory only log');
    const stats = noDiskLogger.getLogStats();
    expect(stats.isLocalLoggingEnabled).toBe(false);
    expect(stats.diskLogFiles).toEqual([]);

    const purgeReport = noDiskLogger.purgeExpiredLogs();
    expect(purgeReport.success).toBe(true);
  });

  test('clear method empties in-memory buffer', () => {
    testLogger.info('Test 1');
    testLogger.clear();
    expect(testLogger.inMemoryLogs.length).toBe(0);
  });

  test('default singleton logger instance works', () => {
    const entry = logger.info('Default logger test');
    expect(entry.level).toBe('INFO');
  });
});
