const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const dailyRfqReportService = require('../src/services/dailyRfqReportService');
const { DAILY_RFQ_REPORT_CONFIG, RFQ_MODES } = require('../src/config/constants');
const { logger } = require('../src/services/loggerService');

describe('dailyRfqReportService Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    dailyRfqReportService.resetRuntimeState();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    dailyRfqReportService.resetRuntimeState();
    process.env = { ...originalEnv };
  });

  describe('Timezone & Date Helpers', () => {
    test('getTzDateParts extracts correct YYYY-MM-DD and time in Asia/Kolkata', () => {
      // 2026-11-04 06:45:15 UTC is 12:15:15 IST
      const refDate = new Date('2026-11-04T06:45:15.000Z');
      const parts = dailyRfqReportService.getTzDateParts(refDate, 'Asia/Kolkata');

      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(11);
      expect(parts.day).toBe(4);
      expect(parts.hour).toBe(12);
      expect(parts.minute).toBe(15);
      expect(parts.second).toBe(15);
      expect(parts.dateStr).toBe('2026-11-04');
    });

    test('getTzDateParts handles invalid date by falling back to current date', () => {
      const parts = dailyRfqReportService.getTzDateParts(new Date('invalid'));
      expect(parts.year).toBeGreaterThanOrEqual(2026);
      expect(parts.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('getTzDateParts with null timezone uses default', () => {
      const parts = dailyRfqReportService.getTzDateParts(new Date(), null);
      expect(parts.year).toBeDefined();
    });

    test('getYesterdayDateStr returns previous day in target timezone', () => {
      const refDate = new Date('2026-11-04T02:00:00.000Z'); // 07:30 AM IST on Nov 4
      const yesterday = dailyRfqReportService.getYesterdayDateStr(refDate, 'Asia/Kolkata');
      expect(yesterday).toBe('2026-11-03');
    });

    test('getRfqDateStr converts ISO timestamp to local YYYY-MM-DD or null', () => {
      expect(dailyRfqReportService.getRfqDateStr(null)).toBeNull();
      expect(dailyRfqReportService.getRfqDateStr('invalid-date')).toBeNull();

      // 2026-11-03 20:00:00 UTC is 2026-11-04 01:30:00 IST
      const istNextDay = dailyRfqReportService.getRfqDateStr('2026-11-03T20:00:00.000Z', 'Asia/Kolkata');
      expect(istNextDay).toBe('2026-11-04');

      // 2026-11-03 10:00:00 UTC is 2026-11-03 15:30:00 IST
      const istSameDay = dailyRfqReportService.getRfqDateStr('2026-11-03T10:00:00.000Z', null);
      expect(istSameDay).toBe('2026-11-03');
    });

    test('formatRfqTime formats time to HH:mm:ss or returns fallback', () => {
      expect(dailyRfqReportService.formatRfqTime(null)).toBe('-');
      expect(dailyRfqReportService.formatRfqTime('not-a-date')).toBe('-');

      const timeStr = dailyRfqReportService.formatRfqTime('2026-11-03T09:00:00.000Z', 'Asia/Kolkata');
      expect(timeStr).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(timeStr).toBe('14:30:00');

      const timeDefaultTz = dailyRfqReportService.formatRfqTime('2026-11-03T09:00:00.000Z', null);
      expect(timeDefaultTz).toBe('14:30:00');
    });

    test('formatDateLabel formats valid and invalid date strings', () => {
      expect(dailyRfqReportService.formatDateLabel('')).toBe('');
      expect(dailyRfqReportService.formatDateLabel('invalid')).toBe('invalid');

      const label = dailyRfqReportService.formatDateLabel('2026-11-03');
      expect(label).toContain('November 2026');
      expect(label).toContain('03');
    });
  });

  describe('resolveRecipients', () => {
    test('returns array override when provided with valid emails', () => {
      const rec = dailyRfqReportService.resolveRecipients(['custom1@procucev.com', 'custom2@procucev.com']);
      expect(rec).toEqual(['custom1@procucev.com', 'custom2@procucev.com']);
    });

    test('array with empty values falls through', () => {
      const rec = dailyRfqReportService.resolveRecipients(['', '   ']);
      expect(rec).toEqual(DAILY_RFQ_REPORT_CONFIG.DEFAULT_RECIPIENTS);
    });

    test('splits comma-separated string override', () => {
      const rec = dailyRfqReportService.resolveRecipients('a@test.com, b@test.com');
      expect(rec).toEqual(['a@test.com', 'b@test.com']);
    });

    test('string with empty tokens falls through', () => {
      const rec = dailyRfqReportService.resolveRecipients('   ,   ');
      expect(rec).toEqual(DAILY_RFQ_REPORT_CONFIG.DEFAULT_RECIPIENTS);
    });

    test('uses DAILY_RFQ_REPORT_EMAILS env variable when set', () => {
      process.env.DAILY_RFQ_REPORT_EMAILS = 'env1@procucev.com, env2@procucev.com';
      const rec = dailyRfqReportService.resolveRecipients();
      expect(rec).toEqual(['env1@procucev.com', 'env2@procucev.com']);
    });

    test('DAILY_RFQ_REPORT_EMAILS with only whitespace falls through', () => {
      process.env.DAILY_RFQ_REPORT_EMAILS = '  ,  ';
      process.env.CATEGORY_MANAGER_DAILY_REPORT_EMAILS = 'catman@procucev.com';
      const rec = dailyRfqReportService.resolveRecipients();
      expect(rec).toEqual(['catman@procucev.com']);
    });

    test('uses CATEGORY_MANAGER_DAILY_REPORT_EMAILS fallback env variable', () => {
      delete process.env.DAILY_RFQ_REPORT_EMAILS;
      process.env.CATEGORY_MANAGER_DAILY_REPORT_EMAILS = 'catman@procucev.com';
      const rec = dailyRfqReportService.resolveRecipients();
      expect(rec).toEqual(['catman@procucev.com']);
    });

    test('falls back to DEFAULT_RECIPIENTS when no inputs or env are present in dev/test', () => {
      delete process.env.DAILY_RFQ_REPORT_EMAILS;
      delete process.env.CATEGORY_MANAGER_DAILY_REPORT_EMAILS;
      process.env.NODE_ENV = 'development';
      const rec = dailyRfqReportService.resolveRecipients([]);
      expect(rec).toEqual(DAILY_RFQ_REPORT_CONFIG.DEFAULT_RECIPIENTS);
      expect(rec).toEqual(['veerababu.v@procucev.com']);
    });

    test('falls back to PROD_RECIPIENTS when in production and no env variable is set', () => {
      delete process.env.DAILY_RFQ_REPORT_EMAILS;
      delete process.env.CATEGORY_MANAGER_DAILY_REPORT_EMAILS;
      process.env.NODE_ENV = 'production';
      const rec = dailyRfqReportService.resolveRecipients();
      expect(rec).toEqual(DAILY_RFQ_REPORT_CONFIG.PROD_RECIPIENTS);
      expect(rec).toEqual(['quateam@procucev.com', 'veerababu.v@procucev.com']);
    });
  });

  describe('getDailyRfqReportData', () => {
    test('aggregates RFQs matching targetDate across modes and channels', async () => {
      const sampleRfqs = [
        {
          id: 'rfq-1',
          rfqNumber: 'RFQ-2026-001',
          title: 'Packaging Boxes',
          category: 'Packaging',
          sourcingMode: RFQ_MODES.MODE_0,
          source: 'web_portal',
          buyerAccountName: 'Buyer Corp A',
          budget: 50000,
          deliveryLocation: 'Mumbai',
          status: 'Quotes Pending',
          createdAt: '2026-11-03T05:00:00.000Z',
          quotes: [{ id: 'q-1' }],
        },
        {
          id: 'rfq-2',
          rfqNumber: 'RFQ-2026-002',
          title: 'CNC Machined Parts',
          category: 'Industrial Machinery',
          sourcingMode: RFQ_MODES.MODE_1,
          source: 'email_gateway',
          buyerAccountName: 'Buyer Corp B',
          budget: 250000,
          createdAt: '2026-11-03T09:00:00.000Z',
        },
        {
          id: 'rfq-3',
          rfqNumber: 'RFQ-2026-003',
          title: 'Electrical Transformers',
          category: 'Electricals',
          sourcingMode: RFQ_MODES.MODE_2,
          source: 'manual_entry',
          buyerAccountName: 'Buyer Corp C',
          budget: 0,
          createdAt: '2026-11-03T11:00:00.000Z',
        },
        {
          id: 'rfq-4',
          rfqNumber: 'RFQ-2026-004',
          title: 'Automotive Valves',
          category: 'Automotive',
          sourcingMode: RFQ_MODES.MODE_3,
          source: 'ai_extraction',
          buyerAccountName: 'Buyer Corp D',
          createdAt: '2026-11-03T14:00:00.000Z',
        },
        {
          id: 'rfq-custom',
          // no rfqNumber, no title, no category, no buyerAccountName, no deliveryLocation, no status
          sourcingMode: 'mode_custom_unmapped',
          source: 'custom_feed_unmapped',
          quotesCount: 3,
          createdAt: '2026-11-03T15:00:00.000Z',
        },
        null,
        { id: 'rfq-no-date', createdAt: null },
        { id: 'rfq-old', rfqNumber: 'RFQ-OLD', createdAt: '2026-11-01T10:00:00.000Z' },
      ];

      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValueOnce();
      jest.spyOn(storeService, 'getRFQs').mockReturnValue(sampleRfqs);

      const report = await dailyRfqReportService.getDailyRfqReportData({
        targetDate: '2026-11-03',
        timezone: 'Asia/Kolkata',
      });

      expect(report.reportDate).toBe('2026-11-03');
      expect(report.summary.totalRFQs).toBe(5);
      expect(report.summary.bySourcingMode[RFQ_MODES.MODE_0]).toBe(2);
      expect(report.summary.bySource.web_portal).toBe(2);
      expect(report.rfqs[4].title).toBe('General Procurement Requirement');
      expect(report.rfqs[4].category).toBe('General Procurement');
      expect(report.rfqs[4].deliveryLocation).toBe('All India');
      expect(report.rfqs[4].status).toBe('Quotes Pending');
      expect(report.rfqs[4].quotesCount).toBe(3);
    });

    test('handles default targetDate and invalid targetDate format fallback', async () => {
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValueOnce();
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([]);

      // targetDate null defaults to yesterday
      const report1 = await dailyRfqReportService.getDailyRfqReportData();
      expect(report1.reportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // targetDate with invalid format falls back to yesterday
      const report2 = await dailyRfqReportService.getDailyRfqReportData({ targetDate: 'invalid-date-format' });
      expect(report2.reportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('handles missing syncRFQsFromDB and getRFQs returning non-array', async () => {
      const origSync = storeService.syncRFQsFromDB;
      delete storeService.syncRFQsFromDB;
      jest.spyOn(storeService, 'getRFQs').mockReturnValue(null);

      const report = await dailyRfqReportService.getDailyRfqReportData({ targetDate: '2026-11-03' });
      expect(report.summary.totalRFQs).toBe(0);

      storeService.syncRFQsFromDB = origSync;
    });

    test('supports fromDate and toDate range filtering with valid and invalid timestamps', async () => {
      const fromDate = new Date('2026-11-03T00:00:00.000Z');
      const toDate = new Date('2026-11-03T23:59:59.999Z');

      const sampleRfqs = [
        { id: 'rfq-in', rfqNumber: 'RFQ-IN', createdAt: '2026-11-03T12:00:00.000Z' },
        { id: 'rfq-bad-date', rfqNumber: 'RFQ-BAD', createdAt: 'invalid-timestamp' },
        { id: 'rfq-out', rfqNumber: 'RFQ-OUT', createdAt: '2026-11-04T12:00:00.000Z' },
      ];

      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValueOnce();
      jest.spyOn(storeService, 'getRFQs').mockReturnValue(sampleRfqs);

      const report = await dailyRfqReportService.getDailyRfqReportData({ fromDate, toDate });
      expect(report.summary.totalRFQs).toBe(1);
      expect(report.rfqs[0].rfqNumber).toBe('RFQ-IN');
    });
  });

  describe('Email Template Builders', () => {
    test('buildDailyRfqEmailHtml generates rich HTML and handles missing mailerService helpers', () => {
      const origGetUrl = mailerService.getPublicFrontendUrl;
      const origGetLogo = mailerService.getLogoUrl;
      delete mailerService.getPublicFrontendUrl;
      delete mailerService.getLogoUrl;

      const html = dailyRfqReportService.buildDailyRfqEmailHtml({
        reportDateFormatted: 'Tuesday, 03 November 2026',
        reportDate: '2026-11-03',
        summary: { totalRFQs: 0 },
        rfqs: [],
        recipients: ['veerababu.v@procucev.com'],
      });

      expect(html).toContain('PROCUCEV ENTERPRISE PROCUREMENT');
      expect(html).toContain('https://equa.procucev.com');

      mailerService.getPublicFrontendUrl = origGetUrl;
      mailerService.getLogoUrl = origGetLogo;
    });

    test('buildDailyRfqEmailHtml generates rich HTML with RFQ rows', () => {
      const html = dailyRfqReportService.buildDailyRfqEmailHtml({
        reportDateFormatted: 'Tuesday, 03 November 2026',
        reportDate: '2026-11-03',
        summary: {
          totalRFQs: 1,
          bySourcingMode: { [RFQ_MODES.MODE_0]: 1 },
          bySource: { web_portal: 1 },
        },
        rfqs: [
          {
            index: 1,
            rfqNumber: 'RFQ-101',
            title: 'Steel Fasteners',
            sourcingModeLabel: 'Mode 0',
            sourceLabel: 'Web Portal',
            category: 'Hardware',
            buyerAccountName: 'Buyer Alpha',
            createdAtFormatted: '10:30:00',
            status: 'Quotes Pending',
          },
        ],
        recipients: ['veerababu.v@procucev.com'],
      });

      expect(html).toContain('Steel Fasteners');
      expect(html).toContain("Yesterday's RFQs");
    });

    test('buildDailyRfqEmailText generates plain text manifest with and without rows', () => {
      const text1 = dailyRfqReportService.buildDailyRfqEmailText({
        reportDateFormatted: 'Tuesday, 03 November 2026',
        reportDate: '2026-11-03',
        summary: { totalRFQs: 0 },
        rfqs: [],
        recipients: ['veerababu.v@procucev.com'],
      });
      expect(text1).toContain('No RFQs were ingested yesterday');

      const text2 = dailyRfqReportService.buildDailyRfqEmailText({
        reportDateFormatted: 'Tuesday, 03 November 2026',
        reportDate: '2026-11-03',
        summary: { totalRFQs: 1, bySourcingMode: {}, bySource: {} },
        rfqs: [
          {
            index: 1,
            rfqNumber: 'RFQ-TXT',
            title: 'Flange Joint',
            sourcingModeLabel: 'Mode 1',
            sourceLabel: 'Email',
            category: 'Steel',
            buyerAccountName: 'Buyer One',
            createdAtFormatted: '12:00:00',
          },
        ],
        recipients: ['veerababu.v@procucev.com'],
      });
      expect(text2).toContain('RFQ-TXT');
      expect(text2).toContain('Flange Joint');
    });
  });

  describe('sendDailyRfqReport', () => {
    test('dryRun returns simulated report without mailer dispatch', async () => {
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValueOnce();
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([]);
      const deliverSpy = jest.spyOn(mailerService, 'deliver');

      const result = await dailyRfqReportService.sendDailyRfqReport({
        date: '2026-11-03',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(deliverSpy).not.toHaveBeenCalled();
    });

    test('delivers live email via mailerService.deliver with and without fromAddress helper', async () => {
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue();
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([]);

      const origFrom = mailerService.fromAddress;
      delete mailerService.fromAddress;

      jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce(null);

      const res1 = await dailyRfqReportService.sendDailyRfqReport({ date: '2026-11-03' });
      expect(res1.success).toBe(true);
      expect(res1.messageId).toBeUndefined();

      mailerService.fromAddress = origFrom;

      jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ success: false });
      const res2 = await dailyRfqReportService.sendDailyRfqReport({ date: '2026-11-03' });
      expect(res2.success).toBe(false);
    });
  });

  describe('Scheduler Lifecycle & checkAndTriggerScheduledReport', () => {
    test('checkAndTriggerScheduledReport skips when not scheduled time', async () => {
      const refDate = new Date('2026-11-04T03:00:00.000Z');
      const res = await dailyRfqReportService.checkAndTriggerScheduledReport(refDate, 'Asia/Kolkata', 6, 0);
      expect(res.triggered).toBe(false);
      expect(res.reason).toContain('Not scheduled time');
    });

    test('checkAndTriggerScheduledReport fires at 06:00 and avoids double firing on same day', async () => {
      const scheduledTime = new Date('2026-11-04T00:30:00.000Z');

      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue();
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([]);
      jest.spyOn(mailerService, 'deliver').mockResolvedValue({ success: true });

      const firstRun = await dailyRfqReportService.checkAndTriggerScheduledReport(scheduledTime, 'Asia/Kolkata', 6, 0);
      expect(firstRun.triggered).toBe(true);

      const secondRun = await dailyRfqReportService.checkAndTriggerScheduledReport(scheduledTime, 'Asia/Kolkata', 6, 0);
      expect(secondRun.triggered).toBe(false);
      expect(secondRun.reason).toContain('already dispatched today');
    });

    test('startDailyReportScheduler executes timer tick and handles errors inside setInterval', async () => {
      let registeredCallback = null;
      const origSetInterval = global.setInterval;
      global.setInterval = jest.fn((cb) => {
        registeredCallback = cb;
        return { unref: jest.fn() };
      });

      const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      const failingCheckFn = jest.fn().mockRejectedValue(new Error('Scheduler tick failed'));

      dailyRfqReportService.startDailyReportScheduler({ pollIntervalMs: 1000, checkFn: failingCheckFn });
      expect(dailyRfqReportService.isSchedulerRunning()).toBe(true);
      expect(registeredCallback).toBeInstanceOf(Function);

      // Explicitly invoke callback and wait for error handling
      await registeredCallback();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error during scheduled daily RFQ report check'),
        expect.any(Error),
        expect.any(String)
      );

      global.setInterval = origSetInterval;
      dailyRfqReportService.stopDailyReportScheduler();
      loggerErrorSpy.mockRestore();
    });

    test('startDailyReportScheduler handles timer without unref method', () => {
      const origSetInterval = global.setInterval;
      global.setInterval = jest.fn().mockReturnValue({ unref: null });

      const res = dailyRfqReportService.startDailyReportScheduler();
      expect(res.started).toBe(true);

      global.setInterval = origSetInterval;
      dailyRfqReportService.stopDailyReportScheduler();
    });

    test('startDailyReportScheduler respects DAILY_RFQ_REPORT_ENABLED=false', () => {
      process.env.DAILY_RFQ_REPORT_ENABLED = 'false';
      const status = dailyRfqReportService.startDailyReportScheduler();
      expect(status.started).toBe(false);
      expect(status.reason).toBe('Disabled');
      expect(dailyRfqReportService.isSchedulerRunning()).toBe(false);
    });

    test('startDailyReportScheduler returns Already running when started twice', () => {
      dailyRfqReportService.startDailyReportScheduler();
      const res = dailyRfqReportService.startDailyReportScheduler();
      expect(res.started).toBe(false);
      expect(res.reason).toBe('Already running');
    });
  });
});
