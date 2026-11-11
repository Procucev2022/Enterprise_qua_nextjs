const fs = require('fs');
const path = require('path');
const { LoggerService, logger, LOG_LEVELS } = require('../src/services/loggerService');

describe('Backend LoggerService Unit Tests', () => {
  const testLogsDir = path.resolve(__dirname, '../logs_test');
  let testLogger;

  /**
   * Remove the scratch log directory, retrying briefly on ENOTEMPTY/EBUSY.
   *
   * The logger writes synchronously, but Windows (and OneDrive-synced paths in
   * particular) can still hold a handle for a moment after the write returns, so
   * a bare rmSync intermittently fails once suites run in parallel.
   */
  const removeTestLogsDir = () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!fs.existsSync(testLogsDir)) return;
      try {
        fs.rmSync(testLogsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        return;
      } catch (err) {
        if (attempt === 7) {
          try {
            const files = fs.readdirSync(testLogsDir);
            for (const file of files) {
              try { fs.unlinkSync(path.join(testLogsDir, file)); } catch (_) {}
            }
          } catch (_) {}
          return;
        }
        const start = Date.now();
        while (Date.now() - start < 100) {}
      }
    }
  };

  beforeEach(() => {
    removeTestLogsDir();
    testLogger = new LoggerService({
      logsDir: testLogsDir,
      maxBufferSize: 10,
      retentionDays: 1,
      maxFileSizeBytes: 1024,
      isLocalLoggingEnabled: true,
    });
  });

  afterEach(() => {
    removeTestLogsDir();
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

  test('keeps the audit actor in the audit file while masking it from stdout', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env.NODE_ENV = 'production';
      const auditEntry = testLogger.audit('Updated vendor profile', 'admin@enterprise.example', {
        vendorId: 'vendor-audit-1',
      });
      const auditFileEntry = JSON.parse(
        fs.readFileSync(path.join(testLogsDir, 'audit.log'), 'utf8').trim()
      );

      expect(auditEntry.userEmail).toBe('admin@enterprise.example');
      expect(auditFileEntry.userEmail).toBe('admin@enterprise.example');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(consoleSpy.mock.calls)).toContain('a***@enterprise.example');
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('admin@enterprise.example');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      consoleSpy.mockRestore();
    }
  });

  test('redacts contact details and credentials while preserving safe identifiers', () => {
    const entry = testLogger.warn(
      'SMS to +91 98765 43210 failed for buyer@example.com',
      {
        recipientEmail: 'buyer@example.com',
        formattedNumber: '919876543210',
        authorization: 'Bearer secret-value',
        sessionId: 'session-secret-value',
        privateKey: 'private-key-value',
        inviteUrl: 'https://example.test/invite?email=buyer%40example.com&token=secret-value&rfq=RFQ-100',
        rfqNumber: 'RFQ-100',
        vendorId: 'v-1793740320475-u1ff',
        messageId: '123456789012',
      },
      'DELIVERY'
    );

    const serialized = JSON.stringify(entry);
    expect(entry.message).toContain('b***@example.com');
    expect(entry.message).toContain('***10');
    expect(entry.metadata.recipientEmail).toBe('b***@example.com');
    expect(entry.metadata.formattedNumber).toBe('***10');
    expect(entry.metadata.authorization).toBe('[REDACTED]');
    expect(entry.metadata.sessionId).toBe('[REDACTED]');
    expect(entry.metadata.privateKey).toBe('[REDACTED]');
    expect(entry.metadata.inviteUrl).toContain('email=[REDACTED]');
    expect(entry.metadata.inviteUrl).toContain('token=[REDACTED]');
    expect(entry.metadata.inviteUrl).toContain('rfq=RFQ-100');
    expect(entry.metadata.rfqNumber).toBe('RFQ-100');
    expect(entry.metadata.vendorId).toBe('v-1793740320475-u1ff');
    expect(entry.metadata.messageId).toBe('123456789012');
    expect(serialized).not.toContain('buyer@example.com');
    expect(serialized).not.toContain('919876543210');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('private-key-value');
  });

  test('accepts client stack traces and redacts them before persistence', () => {
    const entry = testLogger.error('Browser request failed', {
      stackTrace: 'Error: request failed at buyer@example.com?token=private-token',
      requestId: 'req-client-1',
    }, 'CLIENT_ERROR');

    expect(entry.stackTrace).toContain('b***@example.com');
    expect(entry.stackTrace).toContain('token=[REDACTED]');
    expect(entry.metadata.stackTrace).toBeUndefined();
    expect(entry.metadata.requestId).toBe('req-client-1');
    expect(JSON.stringify(entry)).not.toContain('private-token');
    expect(JSON.stringify(entry)).not.toContain('buyer@example.com');
  });

  test('handles malformed contacts, nested errors, arrays, and cyclic metadata safely', () => {
    const circular = { requestId: 'req-123' };
    circular.parent = circular;
    const entry = testLogger.error('Failed lookup for @example.com', {
      malformedEmail: '@example.com',
      phone: '123',
      values: ['owner@example.com', '919876543210', null],
      errorDetails: new Error('Gateway failed for owner@example.com'),
      circular,
      empty: null,
    });

    expect(entry.message).toContain('@example.com');
    expect(entry.metadata.malformedEmail).toBe('[REDACTED]');
    expect(entry.metadata.phone).toBe('123');
    expect(entry.metadata.values).toEqual(['o***@example.com', '***10', null]);
    expect(entry.metadata.errorDetails.errorMessage).toContain('o***@example.com');
    expect(entry.metadata.circular.parent).toBe('[Circular]');
    expect(entry.metadata.empty).toBeNull();
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

  test('purges expired disk entries automatically after the configured write threshold', () => {
    const automaticLogger = new LoggerService({
      logsDir: testLogsDir,
      maxFileSizeBytes: 4096,
      purgeAfterWrites: 2,
      purgeCheckIntervalMs: Number.MAX_SAFE_INTEGER,
      isLocalLoggingEnabled: true,
    });
    const oldEntry = {
      timestamp: '2020-01-01 00:00:00.000 UTC',
      level: 'INFO',
      message: 'expired disk entry',
    };
    fs.writeFileSync(path.join(testLogsDir, 'app.log'), `${JSON.stringify(oldEntry)}\n`, 'utf8');
    automaticLogger.lastPurgeAt = Date.now();

    automaticLogger.info('first recent entry');
    expect(fs.readFileSync(path.join(testLogsDir, 'app.log'), 'utf8')).toContain('expired disk entry');
    automaticLogger.info('second recent entry');

    const diskContents = fs.readFileSync(path.join(testLogsDir, 'app.log'), 'utf8');
    expect(diskContents).not.toContain('expired disk entry');
    expect(diskContents).toContain('second recent entry');
  });

  test('reports local log persistence failures outside tests and rate limits repeats', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';

    try {
      testLogger.reportDiskFailure('write log entry', new Error('disk unavailable'));
      testLogger.reportDiskFailure('write log entry', new Error('disk unavailable'));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('disk unavailable');

      nowSpy.mockReturnValue(now + 60 * 1000 + 1);
      testLogger.reportDiskFailure('write log entry', new Error('disk unavailable again'));
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      nowSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test('does not emit disk failure warnings from the test environment', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    testLogger.reportDiskFailure('write log entry', new Error('test disk failure'));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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

  test('streams logs to console and invokes persistToDatabase in non-test environment', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const pool = require('../src/db/pool');
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    const storageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      process.env.NODE_ENV = 'development';
      testLogger.info('Dev info', { detail: 'yes' });
      expect(consoleLogSpy).toHaveBeenCalled();

      testLogger.warn('Dev warn', { code: 1 });
      expect(consoleWarnSpy).toHaveBeenCalled();

      testLogger.error('Dev error', new Error('Fail'));
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(querySpy).toHaveBeenCalled();

      // Test with storage false
      storageSpy.mockReturnValue(false);
      testLogger.error('Dev error without storage');

      // Test with all error fields and waitUntil active
      storageSpy.mockReturnValue(true);
      const d1Bridge = require('../src/db/d1Bridge');
      const waitSpy = jest.fn();
      jest.spyOn(d1Bridge, 'getWaitUntil').mockReturnValue(waitSpy);

      testLogger.error('Dev error with full fields', {
        errorName: 'CustomErr',
        url: '/api/test',
        correlationId: 'c-1',
        userEmail: 'u@test.com',
      });
      expect(waitSpy).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      querySpy.mockRestore();
      storageSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  test('persistToDatabase respects D1 overload, self-referential error filter, and rate limiter', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const pool = require('../src/db/pool');
    const d1Bridge = require('../src/db/d1Bridge');
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    const storageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    try {
      // 1. Skips when isD1Overloaded is true
      jest.spyOn(d1Bridge, 'isD1Overloaded').mockReturnValue(true);
      testLogger.persistToDatabase({ id: 'err-ov-1', level: 'ERROR', message: 'Any error' });
      expect(querySpy).not.toHaveBeenCalled();

      // 2. Skips when entry contains overload or system_error_logs keywords
      d1Bridge.isD1Overloaded.mockReturnValue(false);
      testLogger.persistToDatabase({ id: 'err-ov-2', level: 'ERROR', message: 'D1 DB is overloaded' });
      expect(querySpy).not.toHaveBeenCalled();

      testLogger.persistToDatabase({ id: 'err-ov-3', level: 'ERROR', message: 'Failed table', metadata: { errorMessage: 'no such table: system_error_logs' } });
      expect(querySpy).not.toHaveBeenCalled();

      // 3. Skips when rate limited
      LoggerService.resetDbLoggingRateLimit();
      for (let i = 0; i < 5; i++) {
        expect(LoggerService.isDbLoggingRateLimited()).toBe(false);
      }
      expect(LoggerService.isDbLoggingRateLimited()).toBe(true);

      testLogger.persistToDatabase({ id: 'err-ov-4', level: 'ERROR', message: 'Normal error' });
      expect(querySpy).not.toHaveBeenCalled();

      LoggerService.resetDbLoggingRateLimit();
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      querySpy.mockRestore();
      storageSpy.mockRestore();
      if (d1Bridge.isD1Overloaded.mockRestore) d1Bridge.isD1Overloaded.mockRestore();
    }
  });

  test('records database log sink failures to disk and throttles fallback diagnostics', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const pool = require('../src/db/pool');
    const d1Bridge = require('../src/db/d1Bridge');
    const querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('Database sink failed for admin@example.com'));
    const storageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const overloadSpy = jest.spyOn(d1Bridge, 'isD1Overloaded').mockReturnValue(false);
    const waitUntilSpy = jest.spyOn(d1Bridge, 'getWaitUntil').mockReturnValue(null);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const initialTime = Date.now();
    let currentTime = initialTime;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

    try {
      process.env.NODE_ENV = 'production';
      LoggerService.resetDbLoggingRateLimit();
      const sourceEntry = {
        id: 'source-error-1',
        level: 'ERROR',
        category: 'AUTH',
        message: 'Authentication record failed',
        metadata: {},
      };

      await testLogger.persistToDatabase(sourceEntry);
      await testLogger.persistToDatabase(sourceEntry);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      currentTime += 60 * 1000 + 1;
      await testLogger.persistToDatabase(sourceEntry);
      querySpy.mockImplementationOnce(() => {
        throw new Error('Synchronous database sink failure');
      });
      currentTime += 60 * 1000 + 1;
      await testLogger.persistToDatabase(sourceEntry);
      querySpy.mockRejectedValueOnce('Non-error database sink failure');
      currentTime += 60 * 1000 + 1;
      await testLogger.persistToDatabase({ ...sourceEntry, level: undefined, category: undefined, correlationId: 'sink-correlation-1' });

      const diagnostics = fs.readFileSync(path.join(testLogsDir, 'error.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(consoleErrorSpy).toHaveBeenCalledTimes(4);
      expect(diagnostics).toHaveLength(4);
      expect(diagnostics[0]).toEqual(expect.objectContaining({
        category: 'DATABASE_LOG_STORAGE',
        metadata: expect.objectContaining({
          operation: 'persist_critical_log',
          sourceCategory: 'AUTH',
          errorName: 'Error',
        }),
      }));
      expect(diagnostics[0].metadata.errorMessage).toContain('a***@example.com');
      expect(diagnostics[1].metadata.suppressedFailures).toBe(1);
      expect(diagnostics[2].metadata.errorMessage).toBe('Synchronous database sink failure');
      expect(diagnostics[3].metadata).toEqual(expect.objectContaining({
        sourceLevel: 'UNKNOWN',
        sourceCategory: 'SYSTEM',
        errorMessage: 'Non-error database sink failure',
      }));
      expect(diagnostics[3].correlationId).toBe('sink-correlation-1');
      expect(JSON.stringify(diagnostics)).not.toContain('admin@example.com');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      querySpy.mockRestore();
      storageSpy.mockRestore();
      overloadSpy.mockRestore();
      waitUntilSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      nowSpy.mockRestore();
      LoggerService.resetDbLoggingRateLimit();
    }
  });

  test('does not report database sink fallback failures inside tests', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      testLogger.reportDatabaseFailure(new Error('test database sink failure'), { category: 'TEST' });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(testLogsDir, 'error.log'))).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('handles readdirSync failure in getLogStats and directory resolution fallback', () => {
    const readdirSpy = jest.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('Disk unreadable');
    });
    try {
      const stats = testLogger.getLogStats();
      expect(stats.diskLogFiles).toEqual([]);
    } finally {
      readdirSpy.mockRestore();
    }
  });

  test('covers all remaining branches in createLogEntry, queryLogs, and directory fallback', () => {
    testLogger.info('With request ID', { requestId: 'req-456', ipAddress: '192.168.1.1' });

    // Test search branches in queryLogs
    testLogger.audit('Action for search', 'user@search.com', { detail: 'querymatch' }, 'SEARCH_CAT');
    const byUser = testLogger.queryLogs({ search: 'user@search' });
    expect(byUser.count).toBeGreaterThanOrEqual(1);

    const byCat = testLogger.queryLogs({ search: 'SEARCH_CAT' });
    expect(byCat.count).toBeGreaterThanOrEqual(1);

    const byMeta = testLogger.queryLogs({ search: 'querymatch' });
    expect(byMeta.count).toBeGreaterThanOrEqual(1);

    // Test resolveDefaultLogsDir catch block
    const origResolve = path.resolve;
    path.resolve = () => { throw new Error('resolve failed'); };
    try {
      expect(LoggerService.resolveDefaultLogsDir()).toBe('./logs');
    } finally {
      path.resolve = origResolve;
    }

    // Default arguments & branches
    testLogger.log('CUSTOM_LEVEL', 'Custom log');
    testLogger.createLogEntry('INFO', 'No meta');
    testLogger.audit('No extra', 'u@test.com');

    // Subdirectory in logs dir for purgeExpiredLogs
    fs.mkdirSync(path.join(testLogsDir, 'subfolder'), { recursive: true });
    testLogger.purgeExpiredLogs();

    // Bare persistToDatabase
    testLogger.persistToDatabase({ id: 'bare-1', level: 'ERROR', category: 'SYS', message: 'Bare error' });
  });
});
