const obdVoiceService = require('../src/services/obdVoiceService');
const storeService = require('../src/services/storeService');
const rfqController = require('../src/controllers/rfqController');

describe('OBD Voice Calling Service (obdVoiceService)', () => {
  const originalEnv = { ...process.env };
  let originalFetch;
  let originalCfEnv;

  beforeEach(() => {
    obdVoiceService.clearTokenCache();
    process.env = { ...originalEnv };
    originalFetch = global.fetch;
    originalCfEnv = globalThis.__CF_ENV__;
  });

  afterEach(() => {
    obdVoiceService.clearTokenCache();
    process.env = originalEnv;
    global.fetch = originalFetch;
    globalThis.__CF_ENV__ = originalCfEnv;
    jest.restoreAllMocks();
  });

  describe('getEnv() and OBD_CONFIG getters', () => {
    test('resolves from process.env', () => {
      process.env.TEST_MY_KEY = 'env_val';
      expect(obdVoiceService.getEnv('TEST_MY_KEY', 'default')).toBe('env_val');
    });

    test('resolves from globalThis.__CF_ENV__ when process.env is missing', () => {
      delete process.env.TEST_CF_KEY;
      globalThis.__CF_ENV__ = { TEST_CF_KEY: 'cf_val' };
      expect(obdVoiceService.getEnv('TEST_CF_KEY', 'default')).toBe('cf_val');
    });

    test('returns fallback when neither process.env nor CF_ENV is set', () => {
      delete process.env.TEST_NONE_KEY;
      globalThis.__CF_ENV__ = {};
      expect(obdVoiceService.getEnv('TEST_NONE_KEY', 'fallback_val')).toBe('fallback_val');
      expect(obdVoiceService.getEnv('TEST_NONE_KEY')).toBe('');
    });

    test('accesses all OBD_CONFIG property getters with defaults', () => {
      delete process.env.OBD_API_BASE_URL;
      delete process.env.OBD_USERNAME;
      delete process.env.OBD_PASSWORD;
      delete process.env.OBD_USER_ID;
      delete process.env.OBD_WEBHOOK_ID;
      delete process.env.OBD_DEFAULT_PROMPT_ID;
      delete process.env.OBD_DEFAULT_LANGUAGE;
      delete process.env.OBD_DEFAULT_GENDER;

      expect(obdVoiceService.OBD_CONFIG.BASE_URL).toBe('https://obdapi2.ivrsms.com');
      expect(obdVoiceService.OBD_CONFIG.USERNAME).toBe('');
      expect(obdVoiceService.OBD_CONFIG.PASSWORD).toBe('');
      expect(obdVoiceService.OBD_CONFIG.USER_ID).toBe('');
      expect(obdVoiceService.OBD_CONFIG.WEBHOOK_ID).toBe('');
      expect(obdVoiceService.OBD_CONFIG.DEFAULT_PROMPT_ID).toBe('1667');
      expect(obdVoiceService.OBD_CONFIG.DEFAULT_LANGUAGE).toBe('en-IN');
      expect(obdVoiceService.OBD_CONFIG.DEFAULT_GENDER).toBe('FEMALE');
    });
  });

  describe('isConfigured()', () => {
    test('returns false when credentials are empty', () => {
      delete process.env.OBD_USERNAME;
      delete process.env.OBD_PASSWORD;
      delete process.env.OBD_USER_ID;
      expect(obdVoiceService.isConfigured()).toBe(false);
    });

    test('returns true when all required credentials are set', () => {
      process.env.OBD_USERNAME = 'test_user';
      process.env.OBD_PASSWORD = 'test_pass';
      process.env.OBD_USER_ID = '500128';
      expect(obdVoiceService.isConfigured()).toBe(true);
    });
  });

  describe('formatScheduleTime()', () => {
    test('formats a date as YYYY-MM-DD HH:MM:SS', () => {
      const fixedDate = new Date('2026-09-01T14:27:05');
      const formatted = obdVoiceService.formatScheduleTime(fixedDate);
      expect(formatted).toBe('2026-09-01 14:27:05');
    });

    test('uses current date when no argument provided', () => {
      const formatted = obdVoiceService.formatScheduleTime();
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('getAuthToken()', () => {
    test('throws if username or password are missing', async () => {
      delete process.env.OBD_USERNAME;
      delete process.env.OBD_PASSWORD;
      await expect(obdVoiceService.getAuthToken()).rejects.toThrow('OBD credentials not configured');
    });

    test('logs in and returns token on success, then reuses cached token', async () => {
      process.env.OBD_USERNAME = 'test_user';
      process.env.OBD_PASSWORD = 'test_password';
      process.env.OBD_API_BASE_URL = 'https://obdapi2.ivrsms.com';

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: 'Success',
          token: 'jwt-mock-token-xyz',
          userid: '500128',
        }),
      });
      global.fetch = mockFetch;

      const token1 = await obdVoiceService.getAuthToken();
      expect(token1).toBe('jwt-mock-token-xyz');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://obdapi2.ivrsms.com/api/obd/login',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'test_user', password: 'test_password' }),
        })
      );

      const token2 = await obdVoiceService.getAuthToken();
      expect(token2).toBe('jwt-mock-token-xyz');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('throws if OBD login response is missing token', async () => {
      process.env.OBD_USERNAME = 'test_user';
      process.env.OBD_PASSWORD = 'test_password';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'No token here' }),
      });

      await expect(obdVoiceService.getAuthToken()).rejects.toThrow('missing auth token');
    });

    test('throws if OBD login HTTP response is not ok', async () => {
      process.env.OBD_USERNAME = 'bad_user';
      process.env.OBD_PASSWORD = 'bad_password';

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized user',
      });

      await expect(obdVoiceService.getAuthToken()).rejects.toThrow('OBD login failed with HTTP 401');
    });
  });

  describe('sendRfqVoiceReminder()', () => {
    beforeEach(() => {
      process.env.OBD_TEST_LIVE = '1';
      process.env.OBD_USERNAME = 'test_obd_user';
      process.env.OBD_PASSWORD = 'test_obd_pass';
      process.env.OBD_USER_ID = '500128';
      process.env.OBD_WEBHOOK_ID = '93';
    });

    test('bypasses outdial when NODE_ENV=test and OBD_TEST_LIVE is unset', async () => {
      delete process.env.OBD_TEST_LIVE;
      process.env.NODE_ENV = 'test';
      const res = await obdVoiceService.sendRfqVoiceReminder({ phone: '9876543210' });
      expect(res.success).toBe(true);
      expect(res.status).toBe('sent');
      expect(res.campaignId).toBe('obd-test-camp-id');
      const resEmpty = await obdVoiceService.sendRfqVoiceReminder();
      expect(resEmpty.success).toBe(true);
    });

    test('returns not_configured when credentials are not configured', async () => {
      delete process.env.OBD_USERNAME;
      const res = await obdVoiceService.sendRfqVoiceReminder({
        phone: '9876543210',
        vendorName: 'Acme Corp',
        rfqNumber: 'RFQ-001',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe('not_configured');
    });

    test('validates phone number and rejects non-10 digit numbers', async () => {
      const res = await obdVoiceService.sendRfqVoiceReminder({
        phone: '12345',
        vendorName: 'Acme Corp',
        rfqNumber: 'RFQ-001',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe('skipped');
      expect(res.error).toContain('10-digit');
    });

    test('successfully composes and sends Action 2 Template 7 outdial campaign with defaults', async () => {
      delete process.env.OBD_WEBHOOK_ID;
      let loginDone = false;
      let outdialPayload = null;

      global.fetch = jest.fn().mockImplementation((url, opts) => {
        if (url.includes('/api/obd/login')) {
          loginDone = true;
          return Promise.resolve({
            ok: true,
            json: async () => ({ token: 'mock-outdial-jwt' }),
          });
        }
        if (url.includes('/api/obd/campaign/compose/outdial')) {
          outdialPayload = opts;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              campaignId: '1165142',
            }),
          });
        }
        return Promise.reject(new Error(`Unknown endpoint: ${url}`));
      });

      const res = await obdVoiceService.sendRfqVoiceReminder({
        phone: '+91 98765 43210',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('sent');
      expect(res.campaignId).toBe('1165142');
      expect(res.message).toBe('Campaign Created Successfully');
      expect(loginDone).toBe(true);
      expect(outdialPayload).toBeDefined();
      expect(outdialPayload.headers.Authorization).toBe('Bearer mock-outdial-jwt');
    });

    test('uses Template 8 (DTMF) when dtmf key is specified', async () => {
      let composedBody = null;

      global.fetch = jest.fn().mockImplementation((url, opts) => {
        if (url.includes('/api/obd/login')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ token: 'mock-dtmf-jwt' }),
          });
        }
        if (url.includes('/api/obd/campaign/compose/outdial')) {
          composedBody = opts.body;
          return Promise.resolve({
            ok: true,
            json: async () => ({ campaignId: '223344', message: 'Campaign Created Successfully' }),
          });
        }
        return Promise.reject(new Error(url));
      });

      const res = await obdVoiceService.sendRfqVoiceReminder({
        phone: '9876543210',
        vendorName: 'Apex Tools',
        rfqNumber: 'RFQ-DTMF-01',
        dtmf: '1',
      });

      expect(res.success).toBe(true);
      expect(res.campaignId).toBe('223344');
      expect(composedBody).toBeDefined();
    });

    test('enforces 30-second throttle on repeated calls to the same phone', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/obd/login')) {
          return Promise.resolve({ ok: true, json: async () => ({ token: 'mock-jwt' }) });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ campaignId: '556677', message: 'Success' }),
        });
      });

      const res1 = await obdVoiceService.sendRfqVoiceReminder({
        phone: '9988776655',
        vendorName: 'Vendor One',
        rfqNumber: 'RFQ-THR-01',
      });
      expect(res1.success).toBe(true);

      const res2 = await obdVoiceService.sendRfqVoiceReminder({
        phone: '9988776655',
        vendorName: 'Vendor One',
        rfqNumber: 'RFQ-THR-01',
      });
      expect(res2.success).toBe(false);
      expect(res2.status).toBe('throttled');
    });

    test('handles gateway error responses with message', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/obd/login')) {
          return Promise.resolve({ ok: true, json: async () => ({ token: 'mock-jwt' }) });
        }
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ message: 'Invalid Contact List' }),
        });
      });

      const res = await obdVoiceService.sendRfqVoiceReminder({
        phone: '9123456780',
        vendorName: 'Error Vendor',
        rfqNumber: 'RFQ-ERR-01',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.error).toBe('Invalid Contact List');
    });

    test('handles gateway error responses with non-JSON body', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/obd/login')) {
          return Promise.resolve({ ok: true, json: async () => ({ token: 'mock-jwt' }) });
        }
        return Promise.resolve({
          ok: false,
          status: 502,
          json: async () => { throw new Error('Bad gateway HTML'); },
        });
      });

      const res = await obdVoiceService.sendRfqVoiceReminder({
        phone: '9123456780',
        vendorName: 'Error Vendor',
        rfqNumber: 'RFQ-ERR-02',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.error).toBe('HTTP 502');
    });

    test('catches fetch network errors and returns failure', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/obd/login')) {
          return Promise.resolve({ ok: true, json: async () => ({ token: 'mock-jwt' }) });
        }
        return Promise.reject(new Error('Network timeout connecting to OBD gateway'));
      });

      const res = await obdVoiceService.sendRfqVoiceReminder({
        phone: '9123456780',
        vendorName: 'Timeout Vendor',
        rfqNumber: 'RFQ-TIMEOUT-01',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.error).toContain('Network timeout');
    });
  });

  describe('obdVoiceService.recordCallOutcome()', () => {
    test('updates rfq follow-up telemetry with call status and DTMF without prior followUpData', () => {
      const mockRfq = {
        id: 'rfq-obd-rec-0',
        rfqNumber: 'RFQ-REC-000',
      };

      expect(obdVoiceService.recordCallOutcome(mockRfq, { phone: '9876543210' })).toBeNull();
      expect(mockRfq.followUpData).toBeDefined();
    });

    test('updates rfq follow-up telemetry with call status and DTMF with duration', () => {
      const mockRfq = {
        id: 'rfq-obd-rec-1',
        rfqNumber: 'RFQ-REC-001',
        followUpData: {
          vendors: [
            {
              vendorId: 'v-rec-1',
              vendorName: 'Direct Rec Supplies',
              phone: '9876543210',
              call: { messageId: 'camp-rec-99', status: 'sent' },
            },
          ],
          callStats: { total: 1, connected: 0, avgDuration: null },
        },
      };

      const vendorRecord = obdVoiceService.recordCallOutcome(mockRfq, {
        campaignId: 'camp-rec-99',
        status: 'ANSWERED',
        duration: 25,
        dtmf: '1',
      });

      expect(vendorRecord).toBeDefined();
      expect(vendorRecord.call.status).toBe('answered');
      expect(vendorRecord.call.duration).toBe(25);
      expect(vendorRecord.call.dtmf).toBe('1');
      expect(mockRfq.followUpData.callStats.connected).toBe(1);
      expect(mockRfq.followUpData.callStats.avgDuration).toBe(25);
    });

    test('handles unanswered/failed call status without duration and non-array vendors', () => {
      const mockRfq = {
        id: 'rfq-obd-rec-2',
        rfqNumber: 'RFQ-REC-002',
        followUpData: {
          vendors: 'not-an-array',
        },
      };

      const result = obdVoiceService.recordCallOutcome(mockRfq, {
        campaignId: 'camp-rec-fail',
        status: 'BUSY',
      });
      expect(result).toBeNull();
    });

    test('returns null if rfq is null or no match', () => {
      expect(obdVoiceService.recordCallOutcome(null, {})).toBeNull();
      const emptyRfq = { followUpData: { vendors: [] } };
      expect(obdVoiceService.recordCallOutcome(emptyRfq, { phone: '9999999999' })).toBeNull();
    });

    test('updates rfq follow-up telemetry with mobileNumber, status answered without duration, and default outcome', () => {
      const mockRfq = {
        id: 'rfq-mob-1',
        rfqNumber: 'RFQ-MOB-1',
        followUpData: {
          vendors: [
            {
              vendorId: 'v-mob-1',
              mobileNumber: '9988776655',
            },
          ],
        },
      };

      expect(obdVoiceService.recordCallOutcome(mockRfq)).toBeNull();

      const rec = obdVoiceService.recordCallOutcome(mockRfq, {
        phone: '9988776655',
        status: 'answered',
      });
      expect(rec).toBeDefined();
      expect(rec.call.status).toBe('answered');
      expect(rec.call.duration).toBeUndefined();
    });
  });

  describe('rfqController.handleCallWebhook()', () => {
    test('handles inbound call webhook and returns 200', async () => {
      const mockRfq = {
        id: 'rfq-wb-1',
        rfqNumber: 'RFQ-WB-001',
        followUpData: {
          vendors: [{ vendorId: 'v-1', phone: '9876543210', call: { messageId: '1165142' } }],
          callStats: { total: 1, connected: 0, avgDuration: null },
        },
      };
      storeService.rfqs = [mockRfq];

      const req = {
        body: {
          campaignId: '1165142',
          mobile: '9876543210',
          status: 'ANSWERED',
          duration: 30,
          dtmf: '1',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await rfqController.handleCallWebhook(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Call webhook processed',
          updated: true,
        })
      );
    });

    test('returns 400 if phone and campaignId are missing', async () => {
      const req = { body: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await rfqController.handleCallWebhook(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Missing phone or campaignId'),
        })
      );
    });

    test('handles exact portal webhook payload with snake_case keys', async () => {
      const mockRfq = {
        id: 'rfq-wb-portal',
        rfqNumber: 'RFQ-PORTAL-001',
        followUpData: {
          vendors: [{ vendorId: 'v-portal-1', phone: '9876543210', call: { messageId: 'camp-portal-1' } }],
          callStats: { total: 1, connected: 0, avgDuration: null },
        },
      };
      storeService.rfqs = [mockRfq];

      const req = {
        body: {
          campaign_id: 'camp-portal-1',
          user_id: '506155',
          cli: '917090170801',
          mobile: '9876543210',
          answer_status: 'ANSWERED',
          dtmf: '1',
          billing_duration: 35,
          hangup_cause: 'NORMAL_CLEARING',
          dtmf_sequence: '1',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.handleCallWebhook(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, updated: true }));
    });

    test('handles variations in payload keys (campId, mobile_number, callStatus, keypress)', async () => {
      const mockRfq = {
        id: 'rfq-wb-2',
        rfqNumber: 'RFQ-WB-002',
        followUpData: {
          vendors: [{ vendorId: 'v-2', phone: '9876543211', call: { messageId: 'camp-alt-1' } }],
          callStats: { total: 1, connected: 0, avgDuration: null },
        },
      };
      storeService.rfqs = [mockRfq];
      const persistSpy = jest.fn();
      storeService._persistRFQ = persistSpy;

      const req = {
        body: {
          campId: 'camp-alt-1',
          mobile_number: '9876543211',
          callStatus: 'COMPLETED',
          callDuration: 45,
          keypress: '2',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.handleCallWebhook(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, updated: true }));
      expect(persistSpy).toHaveBeenCalledWith(mockRfq);
    });

    test('handles webhook when no matching RFQ is found', async () => {
      storeService.rfqs = [];
      const req = {
        body: {
          campid: 'camp-unmatched',
          phone: '9876543299',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.handleCallWebhook(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, updated: false }));
    });

    test('handles fallback when storeService.getRFQs is undefined and _persistRFQ is absent', async () => {
      const originalGetRFQs = storeService.getRFQs;
      const originalPersist = storeService._persistRFQ;
      try {
        delete storeService.getRFQs;
        delete storeService._persistRFQ;
        const mockRfq = {
          id: 'rfq-wb-3',
          rfqNumber: 'RFQ-WB-003',
          followUpData: {
            vendors: [{ vendorId: 'v-3', phone: '9876543212', call: { messageId: 'camp-3' } }],
          },
        };
        storeService.rfqs = [mockRfq];

        const req = { body: { campaignId: 'camp-3', phone: '9876543212' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await rfqController.handleCallWebhook(req, res, next);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, updated: true }));
      } finally {
        storeService.getRFQs = originalGetRFQs;
        storeService._persistRFQ = originalPersist;
      }
    });

    test('calls next(err) if webhook handling throws an error', async () => {
      const originalGetRFQs = storeService.getRFQs;
      try {
        storeService.getRFQs = () => {
          throw new Error('Database connection failed');
        };
        const req = { body: { campaignId: 'camp-err', phone: '9876543210' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await rfqController.handleCallWebhook(req, res, next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
      } finally {
        storeService.getRFQs = originalGetRFQs;
      }
    });
  });

  describe('rfqController.initiateVendorCall()', () => {
    test('refuses unauthenticated caller (401)', async () => {
      const req = { params: { id: 'rfq-1' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('refuses unauthorized role (403)', async () => {
      const req = { user: { role: 'vendor' }, params: { id: 'rfq-1' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns 404 if RFQ is not found or not accessible', async () => {
      storeService.rfqs = [];
      const req = { user: { role: 'admin' }, params: { id: 'rfq-missing' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('returns 404 if buyer cannot access RFQ from another account', async () => {
      const mockRfq = { id: 'rfq-other-acc', buyerAccountId: 'acc-other' };
      storeService.rfqs = [mockRfq];
      const req = {
        user: { role: 'buyer', email: 'buyer@example.com' },
        params: { id: 'rfq-other-acc' },
        body: {},
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('returns 503 if OBD is not configured', async () => {
      const mockRfq = { id: 'rfq-init-1', rfqNumber: 'RFQ-INIT-1', buyerAccountId: 'acc-1' };
      storeService.rfqs = [mockRfq];
      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(false);

      const req = { user: { role: 'admin' }, params: { id: 'rfq-init-1' }, body: { phone: '9876543210' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    test('returns 400 if phone is missing for vendor and body', async () => {
      const mockRfq = {
        id: 'rfq-init-2',
        rfqNumber: 'RFQ-INIT-2',
        assignedVendors: [{ id: 'v-no-ph', name: 'No Phone' }],
      };
      storeService.rfqs = [mockRfq];
      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(true);

      const req = { user: { role: 'admin' }, params: { id: 'rfq-init-2' }, body: { vendorId: 'v-no-ph' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('No phone number') }));
    });

    test('initiates outbound call successfully with vendorId match and updates rfq stats (200)', async () => {
      const mockRfq = {
        id: 'rfq-init-3',
        rfqNumber: 'RFQ-CALL-INSTANT-3',
        title: 'Instant Calling',
        assignedVendors: [{ id: 'v-inst-1', name: 'Instant Vendor', phone: '9876543210' }],
        followUpData: {
          vendors: [{ id: 'v-inst-1', vendorId: 'v-inst-1' }],
          callStats: { total: 0, connected: 0, avgDuration: null },
        },
      };
      storeService.rfqs = [mockRfq];
      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(true);
      jest.spyOn(obdVoiceService, 'sendRfqVoiceReminder').mockResolvedValue({
        success: true,
        campaignId: 'camp-inst-1',
      });

      const req = {
        user: { role: 'category_manager' },
        params: { id: 'rfq-init-3' },
        body: { vendorId: 'v-inst-1', phone: '9876543210', dtmf: '1' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, campaignId: 'camp-inst-1' }));
    });

    test('initiates call using fallback vendor and initializes missing callStats when followUpData present', async () => {
      const mockRfq = {
        id: 'rfq-init-fallback',
        rfqNumber: 'RFQ-CALL-FB',
        title: 'Fallback Calling',
        assignedVendors: null,
        followUpData: {},
      };
      storeService.rfqs = [mockRfq];
      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(true);
      jest.spyOn(obdVoiceService, 'sendRfqVoiceReminder').mockResolvedValue({
        success: true,
        campaignId: 'camp-fb-1',
      });

      const req = {
        user: { role: 'admin' },
        params: { id: 'rfq-init-fallback' },
        body: { phone: '9876543210' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRfq.followUpData.callStats.total).toBe(1);
    });

    test('resolves phone from mobile and mobileNumber when phone property is missing', async () => {
      const mockRfq = {
        id: 'rfq-init-mob',
        rfqNumber: 'RFQ-CALL-MOB',
        assignedVendors: [
          { vendorId: 'v-mob', name: 'Mobile Vendor', mobile: '9876543211' },
          { vendorId: 'v-num', name: 'Num Vendor', mobileNumber: '9876543212' },
        ],
      };
      storeService.rfqs = [mockRfq];
      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(true);
      const callSpy = jest.spyOn(obdVoiceService, 'sendRfqVoiceReminder').mockResolvedValue({
        success: true,
        campaignId: 'camp-mob',
      });

      const req1 = {
        user: { role: 'admin' },
        params: { id: 'rfq-init-mob' },
        body: { vendorId: 'v-mob' },
      };
      const res1 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await rfqController.initiateVendorCall(req1, res1, jest.fn());
      expect(res1.status).toHaveBeenCalledWith(200);

      const req2 = {
        user: { role: 'admin' },
        params: { id: 'rfq-init-mob' },
        body: { vendorId: 'v-num' },
      };
      const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await rfqController.initiateVendorCall(req2, res2, jest.fn());
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(callSpy).toHaveBeenCalledTimes(2);
    });

    test('returns 422 if call dispatch fails', async () => {
      const mockRfq = {
        id: 'rfq-init-4',
        rfqNumber: 'RFQ-CALL-FAIL',
        assignedVendors: [{ id: 'v-fail-1', name: 'Fail Vendor', phone: '9876543210' }],
      };
      storeService.rfqs = [mockRfq];
      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(true);
      jest.spyOn(obdVoiceService, 'sendRfqVoiceReminder').mockResolvedValue({
        success: false,
        status: 'failed',
        error: 'Out of quota',
      });

      const req = {
        user: { role: 'admin' },
        params: { id: 'rfq-init-4' },
        body: { vendorId: 'v-fail-1', phone: '9876543210' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Out of quota' }));
    });

    test('calls next(err) if initiateVendorCall throws an unexpected error', async () => {
      jest.spyOn(storeService, 'getRFQByIdAsync').mockRejectedValueOnce(new Error('Async error'));
      const req = { user: { role: 'admin' }, params: { id: 'rfq-err' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await rfqController.initiateVendorCall(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('rfqController.triggerBatchChaser() with call channel', () => {
    test('dispatches OBD voice call chaser when channels includes call and obdVoiceService is configured', async () => {
      const mockRfq = {
        id: 'rfq-chaser-obd-1',
        rfqNumber: 'RFQ-CHASER-001',
        title: 'Chaser RFQ',
        assignedVendors: [
          { id: 'v-chaser-1', name: 'Vendor 1', phone: '9876543210' },
          { id: 'v-chaser-2', name: 'Vendor 2', mobile: '9876543211' },
          { id: 'v-chaser-3', name: 'Vendor 3', mobileNumber: '9876543212' },
          { id: 'v-chaser-4', name: 'Vendor 4' },
        ],
      };
      storeService.rfqs = [mockRfq];

      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(true);
      const voiceSpy = jest.spyOn(obdVoiceService, 'sendRfqVoiceReminder').mockImplementation(async ({ phone }) => {
        if (phone === '9876543211') {
          return { success: false, error: 'Line busy' };
        }
        return { success: true, campaignId: `camp-${phone}` };
      });

      const req = {
        user: { role: 'admin', email: 'admin@example.com' },
        params: { id: 'rfq-chaser-obd-1' },
        body: { channels: ['call'] },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await rfqController.triggerBatchChaser(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.sentCount).toBeGreaterThan(0);
      expect(voiceSpy).toHaveBeenCalled();
    });

    test('handles triggerBatchChaser when obdVoiceService is not configured', async () => {
      const mockRfq = {
        id: 'rfq-chaser-obd-2',
        rfqNumber: 'RFQ-CHASER-002',
        title: 'Chaser RFQ Unconfigured',
        assignedVendors: [{ id: 'v-chaser-5', name: 'Vendor 5', phone: '9876543210' }],
      };
      storeService.rfqs = [mockRfq];

      jest.spyOn(obdVoiceService, 'isConfigured').mockReturnValue(false);
      const voiceSpy = jest.spyOn(obdVoiceService, 'sendRfqVoiceReminder');

      const req = {
        user: { role: 'admin', email: 'admin@example.com' },
        params: { id: 'rfq-chaser-obd-2' },
        body: { channels: ['call'] },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await rfqController.triggerBatchChaser(req, res, next);
      expect(voiceSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(422);
    });
  });

  describe('rfqController helper coverage boosters', () => {
    test('isPastDate handles various date inputs and nulls', () => {
      expect(rfqController.isPastDate(null)).toBe(false);
      expect(rfqController.isPastDate('')).toBe(false);
      expect(rfqController.isPastDate('invalid')).toBe(false);
      expect(rfqController.isPastDate('2000-01-01')).toBe(true);
      expect(rfqController.isPastDate('2099-01-01')).toBe(false);
    });

    test('resolveVendorForUser handles user resolution branches', async () => {
      expect(await rfqController.resolveVendorForUser(null)).toBeNull();
      expect(await rfqController.resolveVendorForUser({})).toBeNull();
      expect(await rfqController.resolveVendorForUser({ email: 'none@vendor.com', role: 'admin' })).toBeNull();
    });

    test('applyVendorBuyerPrivacy masks buyer details appropriately', () => {
      const rfq = {
        id: 'rfq-priv',
        buyerAccountId: 'acc-1',
        buyerName: 'Buyer Inc',
        buyerEmail: 'buyer@inc.com',
        buyerPhone: '1234567890',
        shippingAddress: { city: 'Mumbai', state: 'MH' },
        quotes: [
          {
            vendorId: 'v-priv',
            submittedAt: new Date().toISOString(),
          },
        ],
      };
      const masked = rfqController.applyVendorBuyerPrivacy(rfq, { id: 'v-priv' });
      expect(masked.buyerName).toBe('');
      expect(masked.buyerEmail).toBe('');
      expect(masked.buyerPhone).toBe('');
      expect(masked.buyerDetailsHidden).toBe(true);

      const unmasked = rfqController.applyVendorBuyerPrivacy(rfq, null);
      expect(unmasked.buyerName).toBe('Buyer Inc');
      expect(rfqController.applyVendorBuyerPrivacy(null)).toBeNull();
    });
  });
});
