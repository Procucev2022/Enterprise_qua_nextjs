const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const { logger } = require('../src/services/loggerService');

const checkEmailScript = require('../scripts/check-email');
const emailSchedulerScript = require('../scripts/email-scheduler');

describe('Email Scheduler & Check Scripts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emailSchedulerScript.stopScheduler();
  });

  afterEach(() => {
    emailSchedulerScript.stopScheduler();
    process.exitCode = 0;
  });

  afterAll(() => {
    emailSchedulerScript.stopScheduler();
    process.exitCode = 0;
  });

  describe('check-email.js', () => {
    test('main() reports when database is unavailable', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConnected: false,
        errorMessage: 'Database connection failed',
      });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await checkEmailScript.main();
      expect(result.isConnected).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Database unavailable'));
      errorSpy.mockRestore();
    });

    test('main() executes dual-inbox scan and prints results when healthy', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConnected: true,
        providerLabel: 'PostgreSQL',
        database: 'testdb',
      });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValueOnce();
      jest.spyOn(emailGatewayService, 'getStatus').mockResolvedValueOnce({
        mailboxUser: 'rfqprocucev@gmail.com',
        host: 'imap.gmail.com',
        gatewayAddress: 'rfq@procucev.com',
        vendorGateway: {
          mailboxUser: 'srinu20252026@gmail.com',
          host: 'imap.gmail.com',
          gatewayAddress: 'srinu20252026@gmail.com',
        },
      });

      jest.spyOn(emailGatewayService, 'pollBothInboxesOnce').mockResolvedValueOnce({
        buyerMailbox: {
          address: 'rfq@procucev.com',
          considered: 2,
          ingested: 1,
          pending: 0,
          outcomes: [{ uid: 1, messageId: '<msg1@corp.com>', status: 'INGESTED' }],
        },
        vendorMailbox: {
          address: 'srinu20252026@gmail.com',
          considered: 1,
          ingested: 1,
          pending: 0,
          outcomes: [{ uid: 2, messageId: '<msg2@vendor.com>', status: 'QUOTE_INGESTED' }],
        },
        totalConsidered: 3,
        totalIngested: 2,
      });

      jest.spyOn(emailGatewayQueries, 'listRecent').mockResolvedValueOnce([
        { status: 'INGESTED', fromAddress: 'buyer@corp.com', subject: 'Requisition', detail: 'Created RFQ' },
      ]);
      jest.spyOn(pool, 'closePool').mockResolvedValueOnce();

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await checkEmailScript.main();
      expect(result.totalConsidered).toBe(3);
      expect(result.totalIngested).toBe(2);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Scan complete: 2 ingested of 3 considered'));
      logSpy.mockRestore();
    });

    test('main() handles skipped or error mailboxes and empty outcomes', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConnected: true,
        providerLabel: 'PostgreSQL',
        database: 'testdb',
      });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValueOnce();
      jest.spyOn(emailGatewayService, 'getStatus').mockResolvedValueOnce({
        mailboxUser: null,
        vendorGateway: null,
      });

      jest.spyOn(emailGatewayService, 'pollBothInboxesOnce').mockResolvedValueOnce({
        buyerMailbox: {
          address: '',
          skipped: true,
          reason: 'Not configured',
        },
        vendorMailbox: {
          address: '',
          error: 'IMAP timeout',
        },
        totalConsidered: 0,
        totalIngested: 0,
      });

      jest.spyOn(emailGatewayQueries, 'listRecent').mockResolvedValueOnce([]);
      jest.spyOn(pool, 'closePool').mockRejectedValueOnce(new Error('pool close failed'));

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await checkEmailScript.main();
      expect(result.totalConsidered).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Status: Skipped (Not configured)'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Status: Error (IMAP timeout)'));
      logSpy.mockRestore();
    });
  });

  describe('email-scheduler.js', () => {
    test('executeCycle runs pollBothInboxesOnce and logs duration', async () => {
      jest.spyOn(emailGatewayService, 'pollBothInboxesOnce').mockResolvedValueOnce({
        buyerMailbox: { ingested: 1, considered: 1 },
        vendorMailbox: { ingested: 0, considered: 0 },
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const summary = await emailSchedulerScript.executeCycle();
      expect(summary.buyerMailbox.ingested).toBe(1);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Scheduled cycle finished in'));
      logSpy.mockRestore();
    });

    test('executeCycle handles overlapping cycle', async () => {
      let resolver;
      const slowPromise = new Promise((resolve) => {
        resolver = resolve;
      });
      jest.spyOn(emailGatewayService, 'pollBothInboxesOnce').mockImplementationOnce(() => slowPromise);

      const first = emailSchedulerScript.executeCycle();
      const second = await emailSchedulerScript.executeCycle();

      expect(second.skipped).toBe(true);
      expect(second.reason).toBe('Already running');
      resolver({ buyerMailbox: { ingested: 0 } });
      await first;
    });

    test('executeCycle catches and logs unhandled errors', async () => {
      jest.spyOn(emailGatewayService, 'pollBothInboxesOnce').mockRejectedValueOnce(new Error('Fatal poll failure'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await emailSchedulerScript.executeCycle();
      expect(result.error).toBe('Fatal poll failure');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Scheduler cycle error'));
      errorSpy.mockRestore();
    });

    test('startScheduler stops when DB is unavailable', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConnected: false,
        errorMessage: 'Connection rejected',
      });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await emailSchedulerScript.startScheduler(60000, true);
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Database unavailable'));
      errorSpy.mockRestore();
    });

    test('startScheduler runs single pass with runOnce=true', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConnected: true,
        providerLabel: 'PostgreSQL',
        database: 'testdb',
      });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValueOnce();
      jest.spyOn(emailGatewayService, 'getStatus').mockResolvedValueOnce({
        mailboxUser: 'rfq@procucev.com',
        gatewayAddress: 'rfq@procucev.com',
        vendorGateway: { mailboxUser: 'srinu@gmail.com', gatewayAddress: 'srinu@gmail.com' },
      });
      jest.spyOn(emailGatewayService, 'pollBothInboxesOnce').mockResolvedValueOnce({
        buyerMailbox: { ingested: 0, considered: 0 },
        vendorMailbox: { ingested: 0, considered: 0 },
      });
      jest.spyOn(pool, 'closePool').mockResolvedValueOnce();

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await emailSchedulerScript.startScheduler(60000, true);
      expect(result.stopped).toBe(true);
      logSpy.mockRestore();
    });

    test('startScheduler and stopScheduler manage continuous interval', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConnected: true,
        providerLabel: 'PostgreSQL',
        database: 'testdb',
      });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValueOnce();
      jest.spyOn(emailGatewayService, 'getStatus').mockResolvedValueOnce({
        mailboxUser: 'rfq@procucev.com',
        vendorGateway: {},
      });
      jest.spyOn(emailGatewayService, 'pollBothInboxesOnce').mockResolvedValueOnce({
        buyerMailbox: { ingested: 0, considered: 0 },
        vendorMailbox: { ingested: 0, considered: 0 },
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await emailSchedulerScript.startScheduler(60000, false);
      expect(result.started).toBe(true);
      expect(result.pollIntervalMs).toBe(60000);

      const stopped = emailSchedulerScript.stopScheduler();
      expect(stopped).toBe(true);

      const secondStop = emailSchedulerScript.stopScheduler();
      expect(secondStop).toBe(false);

      logSpy.mockRestore();
    });
  });
});
