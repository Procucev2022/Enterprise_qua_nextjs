import { logger, ClientLogger } from '@/lib/logger';

describe('Frontend Client Logger Unit Tests', () => {
  beforeEach(() => {
    logger.clearLogs();
    jest.clearAllMocks();
  });

  test('logs INFO, WARN, ERROR, DEBUG, AUDIT entries with formatted metadata and default parameters', () => {
    // Default log call
    const defaultLog = logger.log('INFO', 'Simple log');
    expect(defaultLog.level).toBe('INFO');
    expect(defaultLog.category).toBe('UI_ACTION');
    expect(defaultLog.userEmail).toBe('buyer@tatasteel.com');

    const infoLog = logger.info('User opened modal', { modalId: 'rfq-preview', userEmail: 'custom@buyer.com' }, 'UI_MODAL');
    expect(infoLog.level).toBe('INFO');
    expect(infoLog.message).toBe('User opened modal');
    expect(infoLog.category).toBe('UI_MODAL');
    expect(infoLog.userEmail).toBe('custom@buyer.com');
    expect(infoLog.timestamp).toBeDefined();

    const warnLog = logger.warn('Subscription free trial limit reached', { remainingFreeRFQs: 0 });
    expect(warnLog.level).toBe('WARN');

    const err = new Error('Fetch failed');
    const errLog = logger.error('Failed to dispatch RFQ emails', { error: err });
    expect(errLog.level).toBe('ERROR');
    expect(errLog.stackTrace).toBeDefined();

    const debugLog = logger.debug('Rendering line items table');
    expect(debugLog.level).toBe('DEBUG');

    const auditLog = logger.audit('Signed PO Order #PO-909', 'buyer@tatasteel.com', { poAmount: 45000 });
    expect(auditLog.level).toBe('AUDIT');
    expect(auditLog.userEmail).toBe('buyer@tatasteel.com');

    const auditDefault = logger.audit('Default audit action', 'admin@procucev.com');
    expect(auditDefault.level).toBe('AUDIT');
  });

  test('getLogs filters buffer by level, category, search query', () => {
    logger.info('Buyer updated delivery date', { date: '2026-10-01' }, 'BUYER_ACTION');
    logger.warn('Unsaved changes in form', {}, 'FORM_VALIDATION');
    logger.error('API 500 internal server error', {}, 'NETWORK');

    // Filter by level
    const errorsOnly = logger.getLogs({ level: 'ERROR' });
    expect(errorsOnly.length).toBe(1);
    expect(errorsOnly[0].level).toBe('ERROR');

    // Filter by category
    const formLogs = logger.getLogs({ category: 'FORM' });
    expect(formLogs.length).toBe(1);

    // Filter by search query
    const searchResults = logger.getLogs({ search: 'delivery date' });
    expect(searchResults.length).toBe(1);

    // Search query matching metadata
    const searchMeta = logger.getLogs({ search: '2026-10-01' });
    expect(searchMeta.length).toBe(1);

    // No filter returns all
    expect(logger.getLogs().length).toBe(3);
  });

  test('respects max buffer size and clears buffer with clearLogs', () => {
    const customLogger = new ClientLogger(5);
    for (let i = 0; i < 10; i++) {
      customLogger.info(`Message ${i}`);
    }
    expect(customLogger.getLogs().length).toBe(5);

    customLogger.clearLogs();
    expect(customLogger.getLogs().length).toBe(0);
  });

  test('handles remote sync dispatch when fetch is available and rejects gracefully', () => {
    const originalFetch = global.fetch;
    const mockFetch = jest.fn().mockImplementation(() => Promise.reject(new Error('Network offline')));
    global.fetch = mockFetch as any;

    const originalEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'development';

    const testLogger = new ClientLogger(50);
    testLogger.info('Remote dispatch test', { key: 'value' });
    testLogger.warn('Warning test');
    testLogger.error('Error test');

    // Headers are matched loosely: a signed-in session also attaches an
    // Authorization header, and asserting the exact object made this test fail for
    // a reason unrelated to logging.
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/logs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );

    (process.env as any).NODE_ENV = originalEnv;
    global.fetch = originalFetch;
  });

  test('handles remote sync disabled', () => {
    const testLogger = new ClientLogger(50);
    testLogger.isRemoteSyncEnabled = false;
    const entry = testLogger.info('Sync disabled log');
    expect(entry.message).toBe('Sync disabled log');
  });
});
