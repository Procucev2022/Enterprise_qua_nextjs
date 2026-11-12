const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const { queryCache } = require('../src/db/queryCache');
const botBridgeService = require('../src/services/botBridgeService');
const botBridgeQueries = require('../src/db/botBridgeQueries');
const identityQueries = require('../src/db/identityQueries');
const authService = require('../src/services/authService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const { BOT_BRIDGE_MESSAGES } = require('../src/config/botBridgeConfig');

const KEY = 'bridge-test-key';
const BOT = { 'x-bot-api-key': KEY };

function buyerUser(overrides = {}) {
  return {
    id: 'u-buyer',
    email: 'buyer@acme.com',
    name: 'Bea Buyer',
    role: 'buyer',
    orgId: 'org-buyer',
    orgName: 'Acme Ltd',
    mobile: '+919876543210',
    isActive: true,
    isApproved: true,
    isSelfClient: false,
    verificationStatus: null,
    ...overrides,
  };
}

function vendorUser(overrides = {}) {
  return buyerUser({ id: 'u-vendor', email: 'seller@steel.com', role: 'vendor', orgId: 'org-vendor', orgName: 'Steel Co', ...overrides });
}

const VENDOR = { id: 'v-1', email: 'seller@steel.com', name: 'Steel Co' };

describe('WhatsApp agent-bot bridge', () => {
  let previousAesEncryptionKey;
  let previousAesSecretKey;

  beforeEach(() => {
    previousAesEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    previousAesSecretKey = process.env.AES_SECRET_KEY;
    process.env.BOT_API_KEY = KEY;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.BOT_API_KEY;
    delete process.env.BOT_REGISTRATION_REQUIRES_APPROVAL;
    if (previousAesEncryptionKey === undefined) delete process.env.AES_ENCRYPTION_KEY;
    else process.env.AES_ENCRYPTION_KEY = previousAesEncryptionKey;
    if (previousAesSecretKey === undefined) delete process.env.AES_SECRET_KEY;
    else process.env.AES_SECRET_KEY = previousAesSecretKey;
  });

  // ── Data access ────────────────────────────────────────────────────────────

  describe('botBridgeQueries', () => {
    test('phoneVariants covers the three spellings QUA matched', () => {
      expect(botBridgeQueries.phoneVariants('9876543210')).toEqual(['+919876543210', '919876543210', '9876543210']);
      expect(botBridgeQueries.phoneVariants('+14155550100')).toEqual(['+14155550100']);
      expect(botBridgeQueries.phoneVariants('')).toEqual([]);
    });

    test('findUsersByPhone maps rows and skips the query for an empty number', async () => {
      const rows = jest.spyOn(pool, 'rows').mockResolvedValue([
        { uuid: 'u1', username: 'A@B.com', role_name: 'ClientInitiator', is_active: 1, unique_id: 'USR1', org_uuid: 'o1' },
        { uuid: 'u2', username: 'c@d.com', role_name: 'ClientInitiator', is_active: 1 },
      ]);
      const users = await botBridgeQueries.findUsersByPhone('9876543210');
      expect(users[0]).toMatchObject({ id: 'u1', email: 'a@b.com', uniqueId: 'USR1', orgId: 'o1' });
      expect(users[1].uniqueId).toBeNull();
      expect(rows.mock.calls[0][1]).toEqual(['+919876543210', '919876543210', '9876543210']);
      expect(rows.mock.calls[0][0]).toContain('in ($1, $2, $3)');

      rows.mockClear();
      expect(await botBridgeQueries.findUsersByPhone(null)).toEqual([]);
      expect(rows).not.toHaveBeenCalled();
    });

    test('findUsersByOrgUuid and findUserByUuid', async () => {
      const rows = jest.spyOn(pool, 'rows').mockResolvedValue([{ uuid: 'u1', username: 'a@b.com' }]);
      expect(await botBridgeQueries.findUsersByOrgUuid('')).toEqual([]);
      expect((await botBridgeQueries.findUsersByOrgUuid('o1'))[0].id).toBe('u1');
      expect(await botBridgeQueries.findUserByUuid(null)).toBeNull();
      expect((await botBridgeQueries.findUserByUuid('u1')).id).toBe('u1');
      rows.mockResolvedValue([]);
      expect(await botBridgeQueries.findUserByUuid('missing')).toBeNull();
    });

    test('findVendorIdByEmail probes the indexed, lowercase email column only', async () => {
      const rows = jest.spyOn(pool, 'rows').mockResolvedValue([{ id: 'v-1' }]);
      expect(await botBridgeQueries.findVendorIdByEmail(null)).toBeNull();
      expect(await botBridgeQueries.findVendorIdByEmail('  ')).toBeNull();
      expect(rows).not.toHaveBeenCalled();
      expect(await botBridgeQueries.findVendorIdByEmail(' Seller@Steel.com ')).toBe('v-1');
      expect(rows).toHaveBeenCalledWith('select id from vendors where email = $1 limit 1', ['seller@steel.com'], { d1: true });
      rows.mockResolvedValue([]);
      expect(await botBridgeQueries.findVendorIdByEmail('nobody@x.com')).toBeNull();
    });

    test('setWhatsAppStatus writes only the fields given, in both SQL dialects', async () => {
      const query = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      expect(await botBridgeQueries.setWhatsAppStatus('u1', { registeredViaWhatsApp: true, verificationStatus: 'PENDING_EMAIL_VERIFICATION' })).toBe(true);
      expect(query.mock.calls[0][0]).toBe(
        'update "user" set is_whats_app = true, source_type = $1, verification_status = $2, last_modified_by = $3, last_modified_ts = now() where uuid = $4'
      );
      expect(query.mock.calls[0][1]).toEqual(['WHATSAPP', 'PENDING_EMAIL_VERIFICATION', 'whatsapp-bot', 'u1']);
      expect(query.mock.calls[0][2].d1Text).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");

      await botBridgeQueries.setWhatsAppStatus('u1', { registeredViaWhatsApp: true, requireApproval: true });
      expect(query.mock.calls[1][0]).toContain('is_approved = false');

      await botBridgeQueries.setWhatsAppStatus('u1', { verificationStatus: 'EMAIL_VERIFIED' });
      expect(query.mock.calls[2][0]).toBe(
        'update "user" set verification_status = $1, last_modified_by = $2, last_modified_ts = now() where uuid = $3'
      );

      query.mockClear();
      expect(await botBridgeQueries.setWhatsAppStatus('u1')).toBe(false);
      expect(query).not.toHaveBeenCalled();

      query.mockResolvedValue({});
      expect(await botBridgeQueries.setWhatsAppStatus('u1', { verificationStatus: 'EMAIL_VERIFIED' })).toBe(false);
    });
    test('verification, temporary password and encrypted delivery intent commit in one PostgreSQL transaction', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ uuid: 'u1' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'event-1' }] }),
      };
      jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
      const invalidate = jest.spyOn(queryCache, 'invalidate');
      const payload = { accountId: 'u1', role: 'buyer', encryptedTempPassword: 'enc:v1:credential' };

      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {
        password: 'Tmp#1', eventId: 'event-1', payload,
      })).resolves.toBe(true);

      expect(client.query).toHaveBeenCalledTimes(2);
      expect(client.query.mock.calls[0][0]).toContain('verification_status = $1, password = $2, reset_password = true');
      expect(client.query.mock.calls[0][0]).toContain('verification_status = $5');
      expect(client.query.mock.calls[0][0]).toContain("status <> 'dead'");
      expect(client.query.mock.calls[0][1]).toEqual(['EMAIL_VERIFIED', 'Tmp#1', 'whatsapp-bot', 'u1', 'PENDING_EMAIL_VERIFICATION', 'event-1']);
      expect(client.query.mock.calls[1][0]).toContain('INSERT INTO event_outbox');
      expect(client.query.mock.calls[1][0]).toContain("WHERE event_outbox.status = 'dead'");
      expect(client.query.mock.calls[1][1]).toEqual(['event-1', 'whatsapp_credentials_email', JSON.stringify(payload)]);
      expect(invalidate).toHaveBeenCalledWith('user');
    });

    test('verification includes WhatsApp provenance and approval fields in an atomic D1 batch', async () => {
      const binding = { prepare: jest.fn() };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
        { rows: [{ uuid: 'u1' }] },
        { rows: [{ id: 'event-1' }] },
      ]);
      const invalidate = jest.spyOn(queryCache, 'invalidate');

      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {
        password: 'Tmp#1',
        eventId: 'event-1',
        payload: { accountId: 'u1', role: 'buyer', encryptedTempPassword: 'ciphertext' },
        registeredViaWhatsApp: true,
        requireApproval: true,
      })).resolves.toBe(true);

      const statements = batch.mock.calls[0][1];
      expect(batch).toHaveBeenCalledWith(binding, expect.any(Array));
      expect(statements[0].text).toContain('is_whats_app = true, source_type = $3, is_approved = false');
      expect(statements[0].text).toContain("last_modified_ts = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      expect(statements[1].text).toContain('SELECT $1, $2, $3 WHERE changes() = 1');
      expect(invalidate).toHaveBeenCalledWith('user');
    });

    test('does not invalidate identity cache when a concurrent verifier already changed the status', async () => {
      const binding = { prepare: jest.fn() };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([{ rows: [] }, { rows: [] }]);
      const invalidate = jest.spyOn(queryCache, 'invalidate');

      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {
        password: 'Tmp#1', eventId: 'event-1', payload: { accountId: 'u1' },
      })).resolves.toBe(false);
      expect(invalidate).not.toHaveBeenCalled();
    });

    test('rejects verification without storage or complete durable event inputs', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {})).rejects.toThrow(pool.NOT_CONFIGURED_MESSAGE);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {})).rejects.toThrow('A user, temporary password and durable credential event are required.');
    });

    test('surfaces a D1 batch that reports a verification update without its matching outbox row', async () => {
      const binding = { prepare: jest.fn() };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([{ rows: [{ uuid: 'u1' }] }, { rows: [] }]);
      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {
        password: 'Tmp#1', eventId: 'event-1', payload: { accountId: 'u1' },
      })).rejects.toThrow('WhatsApp verification changed without a durable credential delivery event.');
    });

    test('requeues expired or dead-lettered credentials and resets the persisted password in one PostgreSQL transaction', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ uuid: 'u1' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'event-1' }] }),
      };
      jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
      const invalidate = jest.spyOn(queryCache, 'invalidate');

      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {
        password: 'Tmp#2', eventId: 'event-1', payload: { accountId: 'u1', encryptedTempPassword: 'cipher-2' },
      })).resolves.toBe(true);

      expect(client.query.mock.calls[0][0]).toContain("status <> 'dead'");
      expect(client.query.mock.calls[0][0]).toContain('NOT EXISTS');
      expect(client.query.mock.calls[0][1]).toEqual(['Tmp#2', 'whatsapp-bot', 'u1', 'EMAIL_VERIFIED', 'event-1']);
      expect(client.query.mock.calls[1][0]).toContain('raw = EXCLUDED.raw');
      expect(invalidate).toHaveBeenCalledWith('user');
    });

    test('does not replace a credential while its prior event is pending, leased, or complete', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {
        password: 'Tmp#2', eventId: 'event-1', payload: { accountId: 'u1' },
      })).resolves.toBe(false);
      expect(client.query).toHaveBeenCalledTimes(1);
    });

    test('requeues expired or dead credentials through one atomic D1 Worker batch', async () => {
      const binding = { prepare: jest.fn() };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
        { rows: [{ uuid: 'u1' }] },
        { rows: [{ id: 'event-1' }] },
      ]);

      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {
        password: 'Tmp#2', eventId: 'event-1', payload: { accountId: 'u1' },
      })).resolves.toBe(true);

      expect(batch.mock.calls[0][1][0].text).toContain('reset_password = 1');
      expect(batch.mock.calls[0][1][0].text).toContain("status <> 'dead'");
      expect(batch.mock.calls[0][1][1].text).toContain("WHERE event_outbox.status = 'dead'");
    });

    test('rejects a credential retry without database storage or required payload fields', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {})).rejects.toThrow(pool.NOT_CONFIGURED_MESSAGE);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {})).rejects.toThrow('A user, temporary password and durable credential event are required.');
    });

    test('surfaces a D1 batch that reports a password update without its replacement event', async () => {
      const binding = { prepare: jest.fn() };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([{ rows: [{ uuid: 'u1' }] }, { rows: [] }]);
      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {
        password: 'Tmp#2', eventId: 'event-1', payload: { accountId: 'u1' },
      })).rejects.toThrow('WhatsApp credential retry was not durably queued.');
    });

    test('rejects a credential retry when only the non-atomic D1 HTTP adapter is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });
      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {
        password: 'Tmp#2', eventId: 'event-1', payload: { accountId: 'u1' },
      })).rejects.toMatchObject({ code: 'ATOMIC_BATCH_REQUIRED' });
    });

      test('rolls back a credential retry if its outbox payload cannot be replaced', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ uuid: 'u1' }] })
          .mockRejectedValueOnce(new Error('outbox update failed')),
      };
      jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
      await expect(botBridgeQueries.retryWhatsAppCredentialDelivery('u1', {
        password: 'Tmp#2', eventId: 'event-1', payload: { accountId: 'u1' },
      })).rejects.toThrow('outbox update failed');
    });

    test('rejects credential verification over the non-atomic D1 HTTP adapter', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });
      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {
        password: 'Tmp#1', eventId: 'event-1', payload: { accountId: 'u1' },
      })).rejects.toMatchObject({ code: 'ATOMIC_BATCH_REQUIRED' });
    });

    test('rolls back the PostgreSQL verification transaction if outbox insertion fails', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ uuid: 'u1' }] })
          .mockRejectedValueOnce(new Error('outbox insert failed')),
      };
      jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
      await expect(botBridgeQueries.verifyWhatsAppEmailAndQueueCredentials('u1', {
        password: 'Tmp#1', eventId: 'event-1', payload: { accountId: 'u1' },
      })).rejects.toThrow('outbox insert failed');
    });
  });

  // ── Gatekeeping and routing ────────────────────────────────────────────────

  describe('routes', () => {
    test('the bridge is closed until BOT_API_KEY is configured', async () => {
      delete process.env.BOT_API_KEY;
      const res = await request(app).get('/api/bot/vendor-plans').set(BOT);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe(BOT_BRIDGE_MESSAGES.BRIDGE_DISABLED);
    });

    test('bridge requests do not wait for the in-memory store to load; other routes still do', async () => {
      const wasHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = false;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const hydrate = jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue({ hydrated: true });
      try {
        expect((await request(app).get('/api/bot/vendor-plans').set(BOT)).status).toBe(200);
        expect((await request(app).get('/api/bot').set(BOT)).status).toBe(404);
        expect(hydrate).not.toHaveBeenCalled();
        await request(app).get('/api/rfqs');
        expect(hydrate).toHaveBeenCalledTimes(1);
      } finally {
        storeService.isHydratedFromDB = wasHydrated;
      }
    });

    test('a missing or wrong key is refused', async () => {
      expect((await request(app).get('/api/bot/vendor-plans')).status).toBe(401);
      const res = await request(app).get('/api/bot/vendor-plans').set('x-bot-api-key', 'nope');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe(BOT_BRIDGE_MESSAGES.BRIDGE_UNAUTHORIZED);
    });

    test('each route reaches its bridge function with the request data', async () => {
      const routes = [
        ['post', '/session', 'createSession', { id: 'u1' }, (fn) => expect(fn).toHaveBeenCalledWith({ id: 'u1' })],
        ['get', '/users?phone=919876543210', 'findUsersByPhone', null, (fn) => expect(fn).toHaveBeenCalledWith('919876543210')],
        ['put', '/users/u1/whatsapp', 'setWhatsAppStatus', { registeredViaWhatsApp: true }, (fn) => expect(fn).toHaveBeenCalledWith('u1', { registeredViaWhatsApp: true })],
        ['put', '/vendors/v-1/whatsapp-opt-out', 'setVendorOptOut', { optedOut: true }, (fn) => expect(fn).toHaveBeenCalledWith('v-1', { optedOut: true })],
        ['post', '/email', 'sendEmail', { to: 'bot@example.com' }, (fn) => expect(fn).toHaveBeenCalledWith({ to: 'bot@example.com' })],
        ['get', '/vendor-plans', 'listVendorPlans', null, (fn) => expect(fn).toHaveBeenCalled()],
      ];
      for (const [method, path, fnName, body, assertCall] of routes) {
        const spy = jest.spyOn(botBridgeService, fnName).mockResolvedValue({ status: 202, body: { routed: fnName } });
        const call = request(app)[method](`/api/bot${path}`).set(BOT);
        const res = body ? await call.send(body) : await call;
        expect(res.status).toBe(202);
        expect(res.body.routed).toBe(fnName);
        assertCall(spy);
        spy.mockRestore();
      }
    });

    test('accepts email and phone as an alternate session identity', async () => {
      const sessionSpy = jest.spyOn(botBridgeService, 'createSession').mockResolvedValue({ status: 202, body: { routed: true } });
      const res = await request(app).post('/api/bot/session').set(BOT).send({
        email: 'bot-user@example.com',
        phone: '+919876543210',
      });

      expect(res.status).toBe(202);
      expect(sessionSpy).toHaveBeenCalledWith({ email: 'bot-user@example.com', phone: '+919876543210' });
    });

    test('rejects invalid bridge data before calling its service', async () => {
      const sessionSpy = jest.spyOn(botBridgeService, 'createSession').mockResolvedValue({ status: 200, body: {} });
      const phoneSpy = jest.spyOn(botBridgeService, 'findUsersByPhone').mockResolvedValue({ status: 200, body: {} });
      const emailSpy = jest.spyOn(botBridgeService, 'sendEmail').mockResolvedValue({ status: 200, body: {} });
      const statusSpy = jest.spyOn(botBridgeService, 'setWhatsAppStatus').mockResolvedValue({ status: 200, body: {} });

      const missingSessionIdentity = await request(app).post('/api/bot/session').set(BOT).send({});
      const invalidPhone = await request(app).get('/api/bot/users?phone=bad').set(BOT);
      const invalidRecipients = await request(app).post('/api/bot/email').set(BOT).send({
        to: 'bad-address',
        attachments: [{ fileName: 'a.txt', contentType: 'text/plain', fileData: 'not-base64' }],
      });
      const invalidStatus = await request(app).put('/api/bot/users/u1/whatsapp').set(BOT).send({
        registeredViaWhatsApp: 'yes',
      });
      const invalidParam = await request(app).put(`/api/bot/users/${'u'.repeat(129)}/whatsapp`).set(BOT).send({
        registeredViaWhatsApp: true,
      });
      const unsupportedField = await request(app).post('/api/bot/session').set(BOT).send({ id: 'u1', password: 'unexpected' });
      const malformedSession = await request(app).post('/api/bot/session').set(BOT).send({ email: 'bad-email' });
      const repeatedSessionId = await request(app).post('/api/bot/session').set(BOT).send({ id: ['u1', 'u2'] });
      const arrayBody = await request(app).post('/api/bot/email').set(BOT).send(['not', 'an', 'object']);

      expect(missingSessionIdentity.status).toBe(400);
      expect(missingSessionIdentity.body.fieldErrors.id).toBeDefined();
      expect(invalidPhone.status).toBe(400);
      expect(invalidPhone.body.fieldErrors.phone).toBeDefined();
      expect(invalidRecipients.status).toBe(400);
      expect(invalidRecipients.body.fieldErrors.to).toBeDefined();
      expect(invalidStatus.status).toBe(400);
      expect(invalidStatus.body.fieldErrors.registeredViaWhatsApp).toBeDefined();
      expect(invalidParam.status).toBe(400);
      expect(invalidParam.body.fieldErrors.id).toBeDefined();
      expect(unsupportedField.status).toBe(400);
      expect(unsupportedField.body.fieldErrors.password).toBe(BOT_BRIDGE_MESSAGES.UNSUPPORTED_FIELD);
      expect(malformedSession.status).toBe(400);
      expect(malformedSession.body.fieldErrors.email).toBeDefined();
      expect(repeatedSessionId.status).toBe(400);
      expect(repeatedSessionId.body.fieldErrors.id).toBe(BOT_BRIDGE_MESSAGES.INVALID_FIELD_TYPE);
      expect(arrayBody.status).toBe(400);
      expect(arrayBody.body.fieldErrors.to).toBeDefined();
      expect(sessionSpy).not.toHaveBeenCalled();
      expect(phoneSpy).not.toHaveBeenCalled();
      expect(emailSpy).not.toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    test('a service failure reaches the global error handler', async () => {
      jest.spyOn(botBridgeService, 'listVendorPlans').mockImplementation(() => {
        throw new Error('boom');
      });
      expect((await request(app).get('/api/bot/vendor-plans').set(BOT)).status).toBe(500);
    });
  });

  // ── Sessions and accounts ──────────────────────────────────────────────────

  describe('accounts', () => {
    test('resolveAccount accepts an account id, a vendor id, or an organisation id', async () => {
      jest.spyOn(botBridgeQueries, 'findUserByUuid').mockImplementation(async (id) => (id === 'u-buyer' ? buyerUser() : null));
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation(async (key) =>
        key === 'v-1' ? VENDOR : key === 'v-orphan' ? { id: 'v-orphan', email: 'gone@x.com' } : key === 'v-noemail' ? { id: 'v-noemail' } : null
      );
      jest.spyOn(identityQueries, 'findUserByEmail').mockImplementation(async (email) => (email === 'seller@steel.com' ? vendorUser() : null));
      jest.spyOn(botBridgeQueries, 'findUsersByOrgUuid').mockImplementation(async (id) =>
        id === 'org-x' ? [buyerUser({ role: 'admin' }), buyerUser({ isActive: false }), null, buyerUser({ id: 'u-org' })] : []
      );

      expect(await botBridgeService.resolveAccount(null)).toBeNull();
      expect((await botBridgeService.resolveAccount('u-buyer')).id).toBe('u-buyer');
      expect((await botBridgeService.resolveAccount('v-1')).id).toBe('u-vendor');
      expect(await botBridgeService.resolveAccount('v-orphan')).toBeNull();
      expect(await botBridgeService.resolveAccount('v-noemail')).toBeNull();
      expect((await botBridgeService.resolveAccount('org-x')).id).toBe('u-org');
      expect(await botBridgeService.resolveAccount('nobody')).toBeNull();
    });

    test('createSession issues a token for an active, approved buyer or seller only', async () => {
      const byEmail = jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerUser({ resetPasswordRequired: true }));
      const session = await botBridgeService.createSession({ email: 'buyer@acme.com', phone: '9876543210' });
      expect(session.status).toBe(200);
      expect(session.body.user).toEqual({
        id: 'u-buyer',
        email: 'buyer@acme.com',
        name: 'Bea Buyer',
        role: 'buyer',
        orgId: 'org-buyer',
        orgName: 'Acme Ltd',
        mobile: '+919876543210',
        vendorId: null,
      });
      expect(session.body.expiresIn).toBe(authService.SESSION_TTL_SECONDS);
      expect(authService.verifySessionToken(session.body.token).user).toMatchObject({ sub: 'u-buyer', role: 'buyer', passwordChangeRequired: false });
      expect(byEmail).toHaveBeenCalledWith('buyer@acme.com', '9876543210');

      jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(vendorUser());
      jest.spyOn(botBridgeQueries, 'findVendorIdByEmail').mockResolvedValue('v-1');
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(VENDOR);
      const seller = await botBridgeService.createSession({ id: 'u-vendor' });
      expect(seller.body.user).toMatchObject({ role: 'vendor', vendorId: 'v-1' });

      for (const user of [null, vendorUser({ isActive: false }), vendorUser({ isApproved: false }), vendorUser({ role: 'admin' })]) {
        botBridgeQueries.findUserByUuid.mockResolvedValue(user);
        storeService.getVendorByIdWithDBFallback.mockResolvedValue(null);
        jest.spyOn(botBridgeQueries, 'findUsersByOrgUuid').mockResolvedValue([]);
        const refused = await botBridgeService.createSession({ id: 'x' });
        expect(refused).toEqual({ status: 404, body: { success: false, error: BOT_BRIDGE_MESSAGES.ACCOUNT_NOT_FOUND } });
      }
      expect((await botBridgeService.createSession()).status).toBe(404);
    });

    test('findUsersByPhone lists buyers and sellers with their vendor ids', async () => {
      jest.spyOn(botBridgeQueries, 'findUsersByPhone').mockResolvedValue([
        buyerUser({ uniqueId: 'USR1', verificationStatus: 'EMAIL_VERIFIED' }),
        vendorUser({ orgName: '' }),
        vendorUser({ id: 'u-v2', email: 'new@steel.com' }),
        buyerUser({ role: 'admin' }),
      ]);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(undefined);
      const byEmail = jest.spyOn(botBridgeQueries, 'findVendorIdByEmail').mockImplementation(async (email) => (email === 'seller@steel.com' ? 'v-1' : null));
      const byId = jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation(async (key) => (key === 'v-1' ? VENDOR : null));
      const res = await botBridgeService.findUsersByPhone('9876543210');
      // The vendor record is reached by its id, never by the unindexed email match.
      expect(byEmail).toHaveBeenCalledWith('new@steel.com');
      expect(byId.mock.calls.map(([key]) => key)).toEqual(['v-1']);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          id: 'u-buyer', email: 'buyer@acme.com', name: 'Bea Buyer', role: 'buyer', orgId: 'org-buyer', orgName: 'Acme Ltd',
          mobile: '+919876543210', uniqueId: 'USR1', verificationStatus: 'EMAIL_VERIFIED', isApproved: true, isActive: true, vendorId: null,
        },
        expect.objectContaining({ id: 'u-vendor', orgName: null, uniqueId: null, verificationStatus: null, vendorId: 'v-1' }),
        expect.objectContaining({ id: 'u-v2', vendorId: null }),
      ]);
    });

    test('a vendor already in memory is used without a database lookup', async () => {
      jest.spyOn(botBridgeQueries, 'findUsersByPhone').mockResolvedValue([vendorUser()]);
      jest.spyOn(storeService, 'getVendorById').mockImplementation((key) => (key === 'seller@steel.com' ? VENDOR : undefined));
      const byEmail = jest.spyOn(botBridgeQueries, 'findVendorIdByEmail');
      const res = await botBridgeService.findUsersByPhone('9876543210');
      expect(res.body.data[0].vendorId).toBe('v-1');
      expect(byEmail).not.toHaveBeenCalled();
    });

    test('setWhatsAppStatus validates the state and honours the approval setting', async () => {
      const set = jest.spyOn(botBridgeQueries, 'setWhatsAppStatus').mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      expect(await botBridgeService.setWhatsAppStatus('u1', { verificationStatus: 'BOGUS' })).toEqual({
        status: 400,
        body: { success: false, error: BOT_BRIDGE_MESSAGES.INVALID_VERIFICATION_STATE },
      });

      expect(await botBridgeService.setWhatsAppStatus('u1', { registeredViaWhatsApp: true, verificationStatus: 'PENDING_EMAIL_VERIFICATION' })).toEqual({
        status: 200,
        body: { success: true },
      });
      expect(set).toHaveBeenLastCalledWith('u1', { registeredViaWhatsApp: true, verificationStatus: 'PENDING_EMAIL_VERIFICATION', requireApproval: false });

      process.env.BOT_REGISTRATION_REQUIRES_APPROVAL = 'TRUE';
      await botBridgeService.setWhatsAppStatus('u1', { registeredViaWhatsApp: 'yes' });
      expect(set).toHaveBeenLastCalledWith('u1', { registeredViaWhatsApp: false, verificationStatus: null, requireApproval: true });

      expect((await botBridgeService.setWhatsAppStatus('u1')).status).toBe(404);
    });

    test('the first email verification atomically queues encrypted buyer credentials without direct mail', async () => {
      process.env.AES_ENCRYPTION_KEY = 'bot-bridge-test-key';
      process.env.BOT_REGISTRATION_REQUIRES_APPROVAL = 'TRUE';
      const find = jest.spyOn(botBridgeQueries, 'findUserByUuid')
        .mockResolvedValue(buyerUser({ verificationStatus: 'PENDING_EMAIL_VERIFICATION' }));
      const queue = jest.spyOn(botBridgeQueries, 'verifyWhatsAppEmailAndQueueCredentials').mockResolvedValue(true);
      jest.spyOn(storeService, '_generateTempPassword').mockReturnValue('Temporary#123');
      const send = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail');

      expect(await botBridgeService.setWhatsAppStatus('u-buyer', {
        verificationStatus: 'EMAIL_VERIFIED',
        registeredViaWhatsApp: true,
      })).toEqual({
        status: 200,
        body: { success: true, credentials: { issued: true, emailSent: false, deliveryQueued: true } },
      });
      const options = queue.mock.calls[0][1];
      expect(options.password).toBe('Temporary#123');
      expect(options.payload).toMatchObject({ accountId: 'u-buyer', role: 'buyer' });
      expect(options.payload.encryptedTempPassword).not.toContain('Temporary#123');
      expect(queue).toHaveBeenCalledWith('u-buyer', expect.objectContaining({
        registeredViaWhatsApp: true,
        requireApproval: true,
      }));
      expect(find).toHaveBeenCalledWith('u-buyer', { fresh: true });
      expect(send).not.toHaveBeenCalled();

      // A repeated callback for an already verified account does not reissue credentials.
      find.mockResolvedValue(buyerUser({ verificationStatus: 'EMAIL_VERIFIED' }));
      jest.spyOn(botBridgeQueries, 'setWhatsAppStatus').mockResolvedValue(true);
      expect((await botBridgeService.setWhatsAppStatus('u-buyer', { verificationStatus: 'EMAIL_VERIFIED' })).body).toEqual({ success: true });
      expect(queue).toHaveBeenCalledTimes(1);
    });

    test('verification stays pending and returns retryable failure when the credential event cannot be saved', async () => {
      process.env.AES_ENCRYPTION_KEY = 'bot-bridge-test-key';
      jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(buyerUser({ verificationStatus: 'PENDING_EMAIL_VERIFICATION' }));
      jest.spyOn(botBridgeQueries, 'verifyWhatsAppEmailAndQueueCredentials').mockRejectedValue(new Error('D1 unavailable'));
      const statusUpdate = jest.spyOn(botBridgeQueries, 'setWhatsAppStatus');
      const result = await botBridgeService.setWhatsAppStatus('u-buyer', { verificationStatus: 'EMAIL_VERIFIED' });

      expect(result).toEqual({
        status: 503,
        body: { success: false, error: BOT_BRIDGE_MESSAGES.CREDENTIALS_QUEUE_FAILED, retryable: true },
      });
      expect(statusUpdate).not.toHaveBeenCalled();
    });

    test('a repeated verification callback requeues credentials only after an earlier delivery dead-letters', async () => {
      process.env.AES_ENCRYPTION_KEY = 'bot-bridge-test-key';
      jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(buyerUser({
        verificationStatus: 'EMAIL_VERIFIED',
        resetPasswordRequired: true,
      }));
      jest.spyOn(storeService, '_generateTempPassword').mockReturnValue('Replacement#123');
      const retry = jest.spyOn(botBridgeQueries, 'retryWhatsAppCredentialDelivery').mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(botBridgeService.setWhatsAppStatus('u-buyer', { verificationStatus: 'EMAIL_VERIFIED' })).resolves.toEqual({
        status: 200,
        body: { success: true, credentials: { issued: true, emailSent: false, deliveryQueued: true } },
      });
      expect(retry.mock.calls[0][1].password).toBe('Replacement#123');

      await expect(botBridgeService.setWhatsAppStatus('u-buyer', { verificationStatus: 'EMAIL_VERIFIED' })).resolves.toEqual({
        status: 200,
        body: { success: true },
      });
      expect(retry).toHaveBeenCalledTimes(2);
    });

    test('verification refuses to change state without a configured encryption key', async () => {
      delete process.env.AES_ENCRYPTION_KEY;
      delete process.env.AES_SECRET_KEY;
      jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(buyerUser({ verificationStatus: 'PENDING_EMAIL_VERIFICATION' }));
      const queue = jest.spyOn(botBridgeQueries, 'verifyWhatsAppEmailAndQueueCredentials');
      const statusUpdate = jest.spyOn(botBridgeQueries, 'setWhatsAppStatus');

      const result = await botBridgeService.setWhatsAppStatus('u-buyer', { verificationStatus: 'EMAIL_VERIFIED' });
      expect(result.status).toBe(503);
      expect(queue).not.toHaveBeenCalled();
      expect(statusUpdate).not.toHaveBeenCalled();
    });

    test('vendor credentials are queued and vendor status mirrors pending state', async () => {
      process.env.AES_ENCRYPTION_KEY = 'bot-bridge-test-key';
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(botBridgeQueries, 'findVendorIdByEmail').mockResolvedValue('v-1');
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(VENDOR);
      const update = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: 'v-1' });
      const queue = jest.spyOn(botBridgeQueries, 'verifyWhatsAppEmailAndQueueCredentials').mockResolvedValue(true);
      jest.spyOn(storeService, '_generateTempPassword').mockReturnValue('Temporary#123');
      const send = jest.spyOn(mailerService, 'sendVendorIngestionEmail');

      await expect(botBridgeService.issueCredentials(vendorUser())).resolves.toEqual({
        issued: true,
        emailSent: false,
        deliveryQueued: true,
      });
      expect(queue.mock.calls[0][1].payload).toMatchObject({ accountId: 'u-vendor', role: 'vendor', vendorId: 'v-1' });
      expect(update).toHaveBeenCalledWith('v-1', { onboardingEmailStatus: 'pending' });
      expect(send).not.toHaveBeenCalled();
    });

    test('issueCredentials reports persistence and encryption failures without throwing', async () => {
      process.env.AES_ENCRYPTION_KEY = 'bot-bridge-test-key';
      jest.spyOn(storeService, '_generateTempPassword').mockReturnValue('Temporary#123');
      const queue = jest.spyOn(botBridgeQueries, 'verifyWhatsAppEmailAndQueueCredentials').mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('D1 unavailable'));
      await expect(botBridgeService.issueCredentials(buyerUser())).resolves.toEqual({
        issued: false, emailSent: false, deliveryQueued: false,
      });
      await expect(botBridgeService.issueCredentials(buyerUser())).resolves.toEqual({
        issued: false, emailSent: false, deliveryQueued: false, error: 'QUEUE_FAILED',
      });
      delete process.env.AES_ENCRYPTION_KEY;
      delete process.env.AES_SECRET_KEY;
      await expect(botBridgeService.issueCredentials(buyerUser())).resolves.toMatchObject({
        issued: false, emailSent: false, deliveryQueued: false, error: 'ENCRYPTION_NOT_CONFIGURED',
      });
      expect(queue).toHaveBeenCalledTimes(2);
    });

    test('setVendorOptOut records the flag on the vendor', async () => {
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce(VENDOR).mockResolvedValueOnce(VENDOR).mockResolvedValue(null);
      const update = jest.spyOn(storeService, 'updateVendorDurably').mockImplementation(async (id, changes) => ({ id, ...changes }));
      expect((await botBridgeService.setVendorOptOut('v-1', { optedOut: true })).body).toEqual({ success: true, vendorId: 'v-1', optedOut: true });
      expect(update).toHaveBeenCalledWith('v-1', { whatsappOptOut: true });
      expect((await botBridgeService.setVendorOptOut('v-1', { optedOut: 'yes' })).body.optedOut).toBe(false);
      expect((await botBridgeService.setVendorOptOut()).status).toBe(404);
    });

    test('does not claim an opt-out was saved when the durable vendor update fails', async () => {
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(VENDOR);
      jest.spyOn(storeService, 'updateVendorDurably').mockRejectedValue(new Error('D1 unavailable'));

      expect(await botBridgeService.setVendorOptOut('v-1', { optedOut: true })).toEqual({
        status: 503,
        body: { success: false, error: BOT_BRIDGE_MESSAGES.PREFERENCE_SAVE_FAILED },
      });
    });

    test('keeps a durable vendor credential queue accepted when status mirror fails', async () => {
      process.env.AES_ENCRYPTION_KEY = 'bot-bridge-test-key';
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(botBridgeQueries, 'findVendorIdByEmail').mockResolvedValue('v-1');
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(VENDOR);
      jest.spyOn(storeService, 'updateVendorDurably').mockRejectedValue(new Error('D1 unavailable'));
      jest.spyOn(botBridgeQueries, 'verifyWhatsAppEmailAndQueueCredentials').mockResolvedValue(true);

      await expect(botBridgeService.issueCredentials(vendorUser())).resolves.toEqual({
        issued: true, emailSent: false, deliveryQueued: true,
      });
    });
  });

  // ── Email and plans ────────────────────────────────────────────────────────

  describe('sendEmail', () => {
    test('requires valid recipients', async () => {
      expect(await botBridgeService.sendEmail()).toEqual({ status: 400, body: { success: false, error: BOT_BRIDGE_MESSAGES.NO_RECIPIENTS } });
      const bad = await botBridgeService.sendEmail({ to: ['ok@x.com', 'bad'], cc: 'also-bad' });
      expect(bad).toEqual({ status: 400, body: { success: false, error: BOT_BRIDGE_MESSAGES.INVALID_RECIPIENTS, invalid: ['bad', 'also-bad'] } });
    });

    test('delivers text or html with attachments mapped for the mail transport', async () => {
      const deliver = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });
      const res = await botBridgeService.sendEmail({
        to: 'ops@procucev.com',
        bcc: ['audit@procucev.com'],
        subject: 'Report',
        text: 'See attached',
        attachments: [{ fileName: 'r.xlsx', fileData: 'AAA=', contentType: 'application/vnd.ms-excel' }],
      });
      expect(res).toEqual({ status: 200, body: { success: true, sent: true } });
      expect(deliver.mock.calls[0][0]).toMatchObject({
        to: ['ops@procucev.com'],
        cc: undefined,
        bcc: ['audit@procucev.com'],
        subject: 'Report',
        text: 'See attached',
        attachments: [{ filename: 'r.xlsx', content: 'AAA=', contentType: 'application/vnd.ms-excel' }],
      });
      expect(deliver.mock.calls[0][0].html).toBeUndefined();

      await botBridgeService.sendEmail({ to: 'v@x.com', cc: 'b@x.com', html: '<p>RFQ</p>' });
      expect(deliver.mock.calls[1][0]).toMatchObject({ html: '<p>RFQ</p>', cc: ['b@x.com'], subject: '', attachments: [] });
      expect(deliver.mock.calls[1][0].text).toBeUndefined();

      await botBridgeService.sendEmail({ to: 'v@x.com' });
      expect(deliver.mock.calls[2][0].text).toBe('');
    });

    test('an undelivered or failing send reports 502 with the reason', async () => {
      jest.spyOn(mailerService, 'deliver')
        .mockResolvedValueOnce({ sent: false, reason: 'SMTP not configured' })
        .mockResolvedValueOnce({ sent: false, error: 'quota' })
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('smtp down'));
      expect(await botBridgeService.sendEmail({ to: 'a@b.com' })).toEqual({ status: 502, body: { success: false, sent: false, error: 'SMTP not configured' } });
      expect((await botBridgeService.sendEmail({ to: 'a@b.com' })).body.error).toBe('quota');
      expect((await botBridgeService.sendEmail({ to: 'a@b.com' })).body.error).toBe('not delivered');
      expect((await botBridgeService.sendEmail({ to: 'a@b.com' })).body.error).toBe('smtp down');
    });
  });

  test('the buyer credentials email carries the login details', async () => {
    const message = mailerService.buildBuyerCredentialsEmail({ to: 'buyer@acme.com', recipientName: 'Bea <B>', tempPassword: 'Tmp#1', contactPhone: '+919876543210' });
    expect(message.to).toBe('buyer@acme.com');
    expect(message.subject).toBe('Welcome to Procucev - Your Account Credentials');
    expect(message.html).toContain('Tmp#1');
    expect(message.html).toContain('+919876543210');
    expect(message.html).toContain('Bea &lt;B&gt;');
    expect(message.html).toContain('/login');
    const bare = mailerService.buildBuyerCredentialsEmail({ to: 'b@x.com' });
    expect(bare.html).toContain('Hello,');
    expect(bare.html).not.toContain('Temporary Password');
    // NODE_ENV=test: delivery is refused before any transport is touched.
    expect(await mailerService.sendBuyerCredentialsEmail({ to: 'b@x.com', tempPassword: 'x' })).toEqual({
      sent: false,
      success: false,
      status: 'skipped',
      reason: 'test environment',
    });
  });

  test('listVendorPlans returns the paid plans with what the payment link charges', () => {
    const { status, body } = botBridgeService.listVendorPlans();
    expect(status).toBe(200);
    expect(body.data.map((p) => [p.id, p.rfqBundleSize, p.periodMonths])).toEqual([
      ['connect', 50, 3],
      ['select', 100, 3],
    ]);
    expect(body.data[0].amount).toBeGreaterThan(0);
    expect(body.data[0].amountWithGst).toBeGreaterThan(body.data[0].amount);
    expect(body.data[0].name).toMatch(/^Connect/);
  });
});
