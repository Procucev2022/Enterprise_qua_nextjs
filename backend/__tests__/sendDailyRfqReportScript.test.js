const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const dailyRfqReportService = require('../src/services/dailyRfqReportService');
const script = require('../scripts/send-daily-rfq-report');

describe('send-daily-rfq-report script Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  describe('parseArgs', () => {
    test('parses default arguments', () => {
      const opts = script.parseArgs([]);
      expect(opts.date).toBeNull();
      expect(opts.to).toBeNull();
      expect(opts.dryRun).toBe(false);
    });

    test('parses --date and --to flags (both space and equals separated)', () => {
      const opts1 = script.parseArgs(['--date', '2026-11-03', '--to', 'user@test.com', '--dry-run']);
      expect(opts1.date).toBe('2026-11-03');
      expect(opts1.to).toBe('user@test.com');
      expect(opts1.dryRun).toBe(true);

      const opts2 = script.parseArgs(['--date=2026-11-02', '--to=a@b.com,c@d.com']);
      expect(opts2.date).toBe('2026-11-02');
      expect(opts2.to).toBe('a@b.com,c@d.com');
      expect(opts2.dryRun).toBe(false);
    });
  });

  describe('main', () => {
    test('executes report dispatch when storage is connected', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValue({
        isConnected: true,
        providerLabel: 'Neon PostgreSQL',
        database: 'testdb',
      });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue();
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue();

      const sendSpy = jest.spyOn(dailyRfqReportService, 'sendDailyRfqReport').mockResolvedValue({
        success: true,
        reportDate: '2026-11-03',
        totalRFQs: 2,
        summary: {
          bySourcingMode: { mode_0: 1, mode_1: 1 },
          bySource: { web_portal: 2 },
        },
        messageId: 'msg-test-123',
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await script.main(['--date=2026-11-03', '--to=veerababu.v@procucev.com']);
      expect(result.success).toBe(true);
      expect(result.totalRFQs).toBe(2);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-11-03',
          recipients: ['veerababu.v@procucev.com'],
        })
      );

      logSpy.mockRestore();
    });

    test('executes in memory mode when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(dailyRfqReportService, 'sendDailyRfqReport').mockResolvedValue({
        success: true,
        reportDate: '2026-11-03',
        totalRFQs: 0,
        dryRun: true,
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await script.main(['--dry-run']);
      expect(result.success).toBe(true);

      logSpy.mockRestore();
    });

    test('warns when database is not connected but storage is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValue({
        isConnected: false,
        errorMessage: 'Connection failed',
      });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue();
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue();
      jest.spyOn(dailyRfqReportService, 'sendDailyRfqReport').mockResolvedValue({
        success: true,
        reportDate: '2026-11-03',
        totalRFQs: 0,
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await script.main([]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Database connection warning'));

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    test('handles errors during dispatch gracefully', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(dailyRfqReportService, 'sendDailyRfqReport').mockRejectedValue(new Error('SMTP failure'));

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await script.main([]);
      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP failure');
      expect(process.exitCode).toBe(1);

      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });
});

