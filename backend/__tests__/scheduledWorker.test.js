const { handleScheduled } = require('../src/workers/scheduledWorker');
const zohoReconciliationService = require('../src/services/zohoReconciliationService');
const pool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');

jest.mock('../src/services/zohoReconciliationService');
jest.mock('../src/db/pool');
jest.mock('../src/services/loggerService', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Cloudflare Scheduled Worker (Cron Triggers)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('successfully executes scheduled task with cron event and initializes Hyperdrive pool', async () => {
    zohoReconciliationService.reconcileOnce.mockResolvedValue({ checked: 5, success: true });

    const event = { cron: '*/5 * * * *', scheduledTime: Date.now() };
    const env = {
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive:pass@edge/db' },
    };
    const ctx = { waitUntil: jest.fn() };

    const result = await handleScheduled(event, env, ctx);

    expect(pool.initFromEnv).toHaveBeenCalledWith(env);
    expect(zohoReconciliationService.reconcileOnce).toHaveBeenCalled();
    expect(result).toMatchObject({
      cron: '*/5 * * * *',
      zohoChecked: 5,
      success: true,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[ScheduledWorker] Triggered cron task: "*/5 * * * *"'),
      {},
      'CRON'
    );
  });

  test('handles execution when cron event is missing or default (manual trigger)', async () => {
    zohoReconciliationService.reconcileOnce.mockResolvedValue(null);

    const env = { DATABASE_URL: 'postgres://localhost/db' };
    const result = await handleScheduled(undefined, env);

    expect(pool.initFromEnv).toHaveBeenCalledWith(env);
    expect(result.cron).toBe('manual');
    expect(result.zohoChecked).toBe(0);
    expect(result.success).toBe(true);
  });

  test('handles execution when env has no database connection bindings', async () => {
    zohoReconciliationService.reconcileOnce.mockResolvedValue({ checked: 'invalid-type' });

    const result = await handleScheduled({}, {});

    expect(pool.initFromEnv).not.toHaveBeenCalled();
    expect(result.zohoChecked).toBe(0);
    expect(result.success).toBe(true);
  });

  test('catches and reports error if zoho reconciliation throws an exception', async () => {
    const error = new Error('Reconciliation API failure');
    zohoReconciliationService.reconcileOnce.mockRejectedValue(error);

    const result = await handleScheduled({ cron: '0 * * * *' }, null);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Reconciliation API failure');
    expect(logger.error).toHaveBeenCalledWith(
      '[ScheduledWorker] Error during scheduled reconciliation',
      error,
      'CRON'
    );
  });

  test('handles invocation with completely empty arguments', async () => {
    zohoReconciliationService.reconcileOnce.mockResolvedValue({ checked: 1 });
    const result = await handleScheduled();
    expect(result.success).toBe(true);
    expect(result.cron).toBe('manual');
  });
});
