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
});
