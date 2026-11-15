const registrationQueries = require('../src/db/registrationQueries');
const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');

const UNAVAILABLE = { code: 'PERSISTENCE_UNAVAILABLE', status: 503 };

function pendingRow(overrides = {}) {
  return {
    id: 'reg-client-101',
    userName: 'Verababu',
    companyName: 'Verababu Enterprises',
    phoneNumber: null,
    userEmail: 'veerababuv2002@gmail.com',
    regDate: '2026-06-30T10:30:00.000Z',
    isApproved: false,
    verificationStatus: 'PENDING',
    sourceTypeRaw: 'web_app',
    isWhatsApp: false,
    roleName: 'vendor',
    ...overrides,
  };
}

function verifiedOf(row) {
  return { ...row, isApproved: true, verificationStatus: 'VERIFIED' };
}

/**
 * A stand-in for the transaction client. It answers the statements the decision
 * path issues in order, so tests can assert the SQL and parameters for each step.
 */
function transactionClient({ current = null, saved = null, outboxRows = [{ id: 'registration-decision-email:event-1' }] } = {}) {
  return jest.fn(async (sql) => {
    if (/FOR UPDATE OF u/.test(sql)) return { rows: current ? [current] : [] };
    if (/^\s*UPDATE "user"/.test(sql)) return { rows: saved ? [saved] : [] };
    if (/INSERT INTO event_outbox/.test(sql)) return { rows: outboxRows };
    return { rows: [] };
  });
}

describe('registrationQueries', () => {
  let querySpy;
  let transactionSpy;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    // Any query or transaction a test does not script fails loudly.
    querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('Unexpected pool.query call in this test.'));
    transactionSpy = jest.spyOn(pool, 'withTransaction').mockRejectedValue(new Error('Unexpected transaction in this test.'));
  });

  function runInTransaction(client) {
    transactionSpy.mockImplementation((callback) => callback({ query: client }));
  }

  describe('normalizeClientType', () => {
    it.each([
      ['seller', 'Seller'],
      ['vendor', 'Seller'],
      ['supplier', 'Seller'],
      ['Vendor Partner', 'Seller'],
      ['buyer', 'Buyer'],
      ['clientinitiator', 'Buyer'],
    ])('classifies the role "%s" as %s', (roleName, expected) => {
      expect(registrationQueries.normalizeClientType(roleName)).toBe(expected);
    });

    it('returns null when the role is missing, so no client type is invented', () => {
      expect(registrationQueries.normalizeClientType(null)).toBeNull();
      expect(registrationQueries.normalizeClientType(undefined)).toBeNull();
      expect(registrationQueries.normalizeClientType('   ')).toBeNull();
    });
  });

  describe('getRegisteredClients', () => {
    it('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(registrationQueries.getRegisteredClients()).rejects.toMatchObject(UNAVAILABLE);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('maps the registration row and reports the total from the window count', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [{
          id: 'u-1',
          userName: 'Buyer One',
          companyName: 'Buyer Org',
          phoneNumber: '+919999911111',
          userEmail: 'buyer@example.com',
          regDate: '2026-01-02T03:04:05.000Z',
          isApproved: true,
          verificationStatus: 'verified',
          sourceTypeRaw: 'web_app',
          isWhatsApp: false,
          roleName: 'clientinitiator',
          total: 1,
        }],
      });

      const result = await registrationQueries.getRegisteredClients();

      expect(result).toEqual({
        total: 1,
        limit: 100,
        offset: 0,
        clients: [{
          id: 'u-1',
          userName: 'Buyer One',
          companyName: 'Buyer Org',
          phoneNumber: '+919999911111',
          userEmail: 'buyer@example.com',
          regDate: '2026-01-02T03:04:05.000Z',
          status: 'Accepted',
          sourceType: 'Web App',
          isApproved: true,
          clientType: 'Buyer',
        }],
      });
      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain('INNER JOIN role r ON r.uuid = u.role_uuid');
      expect(sql).toContain('COUNT(*) OVER() AS total');
      expect(params).toEqual(expect.arrayContaining(['clientinitiator', 'prapprover1.1']));
      expect(params.slice(-2)).toEqual([100, 0]);
      expect(options).toEqual({ d1: true, useCache: false });
    });

    it('runs a separate count query when the page is empty', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '4' }] });

      const result = await registrationQueries.getRegisteredClients();

      expect(result).toEqual({ total: 4, limit: 100, offset: 0, clients: [] });
      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(querySpy.mock.calls[1][0]).toContain('SELECT COUNT(*) AS total FROM "user" u');
    });

    it('reports a total of zero when the list and count results carry no rows', async () => {
      querySpy
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] });

      await expect(registrationQueries.getRegisteredClients()).resolves.toEqual({
        total: 0,
        limit: 100,
        offset: 0,
        clients: [],
      });
    });

    it('runs the count query when the first row has no window total', async () => {
      querySpy
        .mockResolvedValueOnce({
          rows: [{ id: 'u-2', userName: 'No Total', isApproved: false, verificationStatus: null, sourceTypeRaw: 'email' }],
        })
        .mockResolvedValueOnce({ rows: [{ total: '9' }] });

      const result = await registrationQueries.getRegisteredClients();

      expect(result.total).toBe(9);
      expect(result.clients[0]).toEqual(expect.objectContaining({ id: 'u-2', status: 'New', sourceType: 'Email' }));
      expect(querySpy).toHaveBeenCalledTimes(2);
    });

    it('applies no filters when the filter values are absent or "all"', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await registrationQueries.getRegisteredClients({ search: '   ', sourceType: 'All', status: 'ALL', clientType: 'all' });

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).not.toContain('LOWER(COALESCE(u.source_type');
      expect(sql).not.toContain('LOWER(COALESCE(u.verification_status');
      expect(sql).not.toContain("LOWER(COALESCE(u.email, u.username, '')) LIKE");
      expect(params.slice(-2)).toEqual([100, 0]);
    });

    it('pushes the source, status, client type, and search filters into the query and clamps pagination', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [{
          id: 'filtered-user',
          userName: 'Filtered Buyer',
          userEmail: 'buyer@example.com',
          isApproved: false,
          verificationStatus: 'PENDING',
          sourceTypeRaw: 'whatsapp',
          isWhatsApp: true,
          roleName: 'clientinitiator',
          total: 7,
        }],
      });

      const result = await registrationQueries.getRegisteredClients({
        search: ' Buyer ', sourceType: 'WhatsApp', status: 'New', clientType: 'Seller', limit: 500, offset: -4,
      });

      expect(result).toEqual(expect.objectContaining({ total: 7, limit: 200, offset: 0 }));
      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain("LOWER(COALESCE(u.source_type, ''))");
      expect(sql).toContain("LOWER(COALESCE(u.verification_status, ''))");
      expect(sql).toContain("LOWER(COALESCE(u.email, u.username, '')) LIKE");
      expect(params).toEqual(expect.arrayContaining(['whatsapp', 'new', 'seller', '%buyer%']));
      expect(params.slice(-2)).toEqual([200, 0]);
    });

    it.each([
      ['a non-numeric limit and offset', { limit: 'invalid', offset: 'invalid' }, 100, 0],
      ['zero as the limit', { limit: 0 }, 100, 0],
    ])('falls back to default paging for %s', async (_label, filters, limit, offset) => {
      querySpy.mockResolvedValueOnce({ rows: [{ id: 'u-3', total: 2, isApproved: false, sourceTypeRaw: 'web_app' }] });

      const result = await registrationQueries.getRegisteredClients(filters);

      expect(result.limit).toBe(limit);
      expect(result.offset).toBe(offset);
    });

    it('maps each database row to a source, status, and client type without inventing values', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [
          {
            id: 'db-email', userName: 'Email User', companyName: null, phoneNumber: null, userEmail: null,
            regDate: null, isApproved: false, verificationStatus: 'rejected', sourceTypeRaw: 'email',
            isWhatsApp: false, roleName: 'vendor', total: 5,
          },
          {
            id: 'db-web', userName: null, companyName: 'Web Org', phoneNumber: '+919999922222', userEmail: 'web@u.com',
            regDate: 'invalid-date', isApproved: false, verificationStatus: 'pending', sourceTypeRaw: 'web_app',
            isWhatsApp: false, roleName: 'clientinitiator', total: 5,
          },
          {
            id: 'db-wa', userName: 'WA User', companyName: 'WA Company', phoneNumber: '+919876543210', userEmail: 'wa@test.com',
            regDate: '2026-02-03T00:00:00.000Z', isApproved: false, verificationStatus: 'accepted', sourceTypeRaw: 'whats_app',
            isWhatsApp: false, roleName: 'vendor', total: 5,
          },
          {
            id: 'db-active', userName: 'Active User', isApproved: false, verificationStatus: 'active', sourceTypeRaw: null,
            isWhatsApp: true, roleName: 'buyer', total: 5,
          },
          {
            id: 'db-no-status', userName: 'Unverified', isApproved: false, verificationStatus: null, sourceTypeRaw: null,
            isWhatsApp: false, roleName: null, total: 5,
          },
        ],
      });

      const { clients } = await registrationQueries.getRegisteredClients();
      const byId = Object.fromEntries(clients.map((client) => [client.id, client]));

      expect(byId['db-email']).toEqual(expect.objectContaining({
        sourceType: 'Email', status: 'Rejected', clientType: 'Seller', regDate: null, companyName: null, userEmail: null,
      }));
      expect(byId['db-web']).toEqual(expect.objectContaining({
        sourceType: 'Web App', status: 'New', clientType: 'Buyer', regDate: null, userName: null,
      }));
      expect(byId['db-wa']).toEqual(expect.objectContaining({
        sourceType: 'WhatsApp', status: 'Accepted', clientType: 'Seller', regDate: '2026-02-03T00:00:00.000Z',
      }));
      expect(byId['db-active']).toEqual(expect.objectContaining({ sourceType: 'WhatsApp', status: 'Accepted', clientType: 'Buyer' }));
      expect(byId['db-no-status']).toEqual(expect.objectContaining({ sourceType: null, status: 'New', clientType: null }));
    });

    it('fails closed when the list query fails', async () => {
      const cause = new Error('DB failure');
      querySpy.mockRejectedValueOnce(cause);

      await expect(registrationQueries.getRegisteredClients()).rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });

    it('fails closed when the count query fails', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('count failed'));

      await expect(registrationQueries.getRegisteredClients()).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('updateClientRegistrationStatus', () => {
    it('accepts a pending registration in one transaction and returns the updated client', async () => {
      const current = pendingRow({
        id: 'reg-client-102',
        userName: 'Govardhan',
        userEmail: 'govardhan.kilari@procucev.com',
        roleName: 'clientinitiator',
        sourceTypeRaw: 'web_app',
      });
      const client = transactionClient({ current, saved: verifiedOf(current) });
      runInTransaction(client);

      const result = await registrationQueries.updateClientRegistrationStatus(
        'reg-client-102', 'accept', 'Verified enterprise', { sub: 'admin-1' }
      );

      expect(result).toEqual(expect.objectContaining({
        id: 'reg-client-102',
        status: 'Accepted',
        isApproved: true,
        clientType: 'Buyer',
        sourceType: 'Web App',
        remarks: 'Verified enterprise',
      }));
      const updateCall = client.mock.calls.find(([sql]) => /^\s*UPDATE "user"/.test(sql));
      expect(updateCall[1]).toEqual(expect.arrayContaining([true, 'VERIFIED', 'reg-client-102']));
    });

    it('rejects a pending registration and marks its buyer account rejected', async () => {
      const current = pendingRow({ id: 'reg-client-103', roleName: 'clientinitiator' });
      const client = transactionClient({
        current,
        saved: { ...current, isApproved: false, verificationStatus: 'REJECTED' },
      });
      runInTransaction(client);

      const result = await registrationQueries.updateClientRegistrationStatus(
        'reg-client-103', 'reject', 'Incomplete tax details', { sub: 'admin-1' }
      );

      expect(result).toEqual(expect.objectContaining({
        status: 'Rejected',
        isApproved: false,
        remarks: 'Incomplete tax details',
      }));
      const accountCall = client.mock.calls.find(([sql]) => /UPDATE buyer_accounts/.test(sql));
      expect(accountCall[1][0]).toBe('REJECTED');
    });

    it.each([
      ['an unknown action', 'approve'],
      ['a missing action', undefined],
    ])('refuses %s with INVALID_REGISTRATION_ACTION before touching storage', async (_label, action) => {
      await expect(registrationQueries.updateClientRegistrationStatus('reg-1', action, '', { sub: 'admin-1' }))
        .rejects.toMatchObject({ code: 'INVALID_REGISTRATION_ACTION' });
      expect(transactionSpy).not.toHaveBeenCalled();
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('requires a signed-in actor before writing a decision', async () => {
      await expect(registrationQueries.updateClientRegistrationStatus('reg-1', 'accept'))
        .rejects.toMatchObject({ code: 'ACTOR_REQUIRED', statusCode: 401 });
      expect(transactionSpy).not.toHaveBeenCalled();
    });

    it('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(registrationQueries.updateClientRegistrationStatus('reg-1', 'accept', '', { sub: 'admin-1' }))
        .rejects.toMatchObject(UNAVAILABLE);
      expect(transactionSpy).not.toHaveBeenCalled();
    });

    it('returns null when no pending registration matches the id', async () => {
      runInTransaction(transactionClient({ current: null }));
      querySpy.mockResolvedValueOnce({ rows: [] });

      await expect(registrationQueries.updateClientRegistrationStatus('missing-db-user', 'accept', '', { sub: 'admin-1' }))
        .resolves.toBeNull();
    });

    it('reports a conflict when the registration was already decided', async () => {
      runInTransaction(transactionClient({ current: pendingRow({ isApproved: true, verificationStatus: 'VERIFIED' }) }));

      await expect(registrationQueries.updateClientRegistrationStatus('reg-client-101', 'reject', '', { sub: 'admin-1' }))
        .rejects.toMatchObject({ code: 'REGISTRATION_ALREADY_PROCESSED', status: 409 });
    });

    it('reports a conflict when the pending row changes before the conditional update', async () => {
      const client = jest.fn()
        .mockResolvedValueOnce({ rows: [pendingRow({ id: 'changed-user' })] })
        .mockResolvedValueOnce({ rows: [] });
      runInTransaction(client);

      await expect(registrationQueries.updateClientRegistrationStatus('changed-user', 'accept', '', { sub: 'admin-1' }))
        .rejects.toMatchObject({ code: 'REGISTRATION_ALREADY_PROCESSED', status: 409 });
      expect(client).toHaveBeenCalledTimes(2);
    });

    it('fails closed with the cause when the transaction cannot be completed', async () => {
      const cause = new Error('Update failed');
      transactionSpy.mockRejectedValueOnce(cause);

      await expect(registrationQueries.updateClientRegistrationStatus('reg-client-101', 'reject', '', { sub: 'admin-1' }))
        .rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });

    it('fails closed when the decision notification is not written', async () => {
      const current = pendingRow({ id: 'reg-client-101', roleName: 'vendor' });
      const client = transactionClient({ current, saved: verifiedOf(current), outboxRows: [] });
      runInTransaction(client);

      await expect(registrationQueries.updateClientRegistrationStatus('reg-client-101', 'accept', '', { sub: 'admin-1' }))
        .rejects.toMatchObject(UNAVAILABLE);
      expect(client).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO event_outbox'), expect.any(Array));
    });

    it('writes the rejection with its audit event and a decision email payload that carries no secrets', async () => {
      const current = pendingRow({ roleName: 'vendor' });
      const saved = { ...current, verificationStatus: 'REJECTED' };
      const client = transactionClient({ current, saved });
      runInTransaction(client);

      const result = await registrationQueries.updateClientRegistrationStatus(
        'reg-client-101', 'reject', 'Duplicate account', { sub: 'admin-1', email: 'admin@example.com' }
      );

      expect(result.status).toBe('Rejected');
      expect(result.clientType).toBe('Seller');
      expect(client).toHaveBeenCalledTimes(5);
      expect(client.mock.calls[0][0]).toContain('FOR UPDATE OF u');
      expect(client.mock.calls[1][0]).toContain('UPDATE "user"');
      expect(client.mock.calls[1][1]).toEqual(expect.arrayContaining(['REJECTED', 'reg-client-101']));
      expect(client.mock.calls[2][0]).toContain('UPDATE buyer_accounts');
      expect(client.mock.calls[3][0]).toContain('INSERT INTO client_registration_events');
      expect(client.mock.calls[3][1]).toEqual(expect.arrayContaining(['admin-1', 'admin@example.com', 'Duplicate account']));
      expect(client.mock.calls[4][0]).toContain('INSERT INTO event_outbox');
      expect(client.mock.calls[4][1][1]).toBe('registration_decision_email');
      expect(JSON.parse(client.mock.calls[4][1][2])).toEqual(expect.objectContaining({
        registrationId: 'reg-client-101',
        recipientEmail: 'veerababuv2002@gmail.com',
        accountType: 'Vendor',
        decision: 'rejected',
      }));
      expect(client.mock.calls[4][1][2]).not.toContain('temporary-password');
    });

    it.each([
      ['uuid and fullName', { uuid: 'u-1', fullName: 'Asha Admin', email: 'asha@procucev.com' }, ['u-1', 'Asha Admin', 'asha@procucev.com']],
      ['id and name', { id: 'i-2', name: 'Ravi' }, ['i-2', 'Ravi', null]],
      ['sub only', { sub: 's-3' }, ['s-3', null, null]],
    ])('records the decision actor from the %s', async (_label, actor, expected) => {
      const current = pendingRow({ id: 'reg-actor' });
      const client = transactionClient({ current, saved: verifiedOf(current) });
      runInTransaction(client);

      await registrationQueries.updateClientRegistrationStatus('reg-actor', 'accept', '', actor);

      const eventCall = client.mock.calls.find(([sql]) => /INSERT INTO client_registration_events/.test(sql));
      // Parameters are [eventId, userId, userEmail, action, actorId, actorName, actorEmail, remarks].
      expect(eventCall[1].slice(4, 7)).toEqual(expected);
    });

    it('updates matching process-local buyer accounts for each decision and leaves other buyers alone', async () => {
      const originalBuyers = storeService.buyerAccounts;
      storeService.buyerAccounts = [
        { id: 'different-id', corporateEmail: 'govardhan.kilari@procucev.com', status: 'PENDING' },
        { id: 'other-buyer', corporateEmail: 'other@example.com', status: 'PENDING' },
      ];
      const current = pendingRow({ id: 'reg-client-102', userEmail: 'govardhan.kilari@procucev.com', roleName: 'clientinitiator' });

      try {
        runInTransaction(transactionClient({ current, saved: verifiedOf(current) }));
        const accepted = await registrationQueries.updateClientRegistrationStatus(
          'reg-client-102', 'accept', 'Approved by admin', { sub: 'admin-1' }
        );
        expect(accepted.status).toBe('Accepted');
        expect(accepted.remarks).toBe('Approved by admin');
        expect(storeService.buyerAccounts[0]).toEqual(expect.objectContaining({ status: 'ACTIVE_VERIFIED', profileVerified: true }));
        expect(storeService.buyerAccounts[1].status).toBe('PENDING');

        runInTransaction(transactionClient({ current, saved: { ...current, isApproved: false, verificationStatus: 'REJECTED' } }));
        const rejected = await registrationQueries.updateClientRegistrationStatus('reg-client-102', 'reject', '', { sub: 'admin-1' });
        expect(rejected.status).toBe('Rejected');
        expect(storeService.buyerAccounts[0]).toEqual(expect.objectContaining({ status: 'REJECTED', profileVerified: false }));
      } finally {
        storeService.buyerAccounts = originalBuyers;
      }
    });

    it('keeps the durable decision when the process-local buyer cache cannot be read', async () => {
      const warnSpy = jest.spyOn(logger, 'warn');
      const descriptor = Object.getOwnPropertyDescriptor(storeService, 'buyerAccounts');
      Object.defineProperty(storeService, 'buyerAccounts', {
        configurable: true,
        get() { throw new Error('cache unavailable'); },
      });
      const current = pendingRow({ id: 'reg-client-102' });
      runInTransaction(transactionClient({ current, saved: verifiedOf(current) }));

      try {
        const result = await registrationQueries.updateClientRegistrationStatus('reg-client-102', 'accept', '', { sub: 'admin-1' });

        expect(result.status).toBe('Accepted');
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not synchronize'),
          expect.objectContaining({ operation: 'sync-registration-cache', registrationId: 'reg-client-102' }),
          'REGISTRATION_QUERIES'
        );
      } finally {
        Object.defineProperty(storeService, 'buyerAccounts', descriptor);
      }
    });

    it('uses one atomic D1 batch for the registration, buyer account, and audit event', async () => {
      const preparedStatements = [];
      const d1Binding = {
        prepare: jest.fn((sql) => ({
          bind: (...params) => {
            const statement = { sql, params };
            preparedStatements.push(statement);
            return statement;
          },
        })),
        batch: jest.fn().mockResolvedValue([
          {
            results: [{
              id: 'd1-user-1',
              userName: 'D1 Buyer',
              userEmail: 'd1@example.com',
              regDate: '2026-10-01T00:00:00.000Z',
              isApproved: true,
              verificationStatus: 'VERIFIED',
              sourceTypeRaw: 'W',
              isWhatsApp: false,
            }],
            meta: { changes: 1 },
          },
          { results: [{ id: 'registration-event-1' }], meta: { changes: 1 } },
          { results: [{ id: 'registration-decision-email:event-1' }], meta: { changes: 1 } },
          { results: [], meta: { changes: 0 } },
          { results: [{ roleName: 'vendor' }], meta: { changes: 0 } },
        ]),
      };
      const previousEnv = globalThis.__CF_ENV__;
      globalThis.__CF_ENV__ = { DB: d1Binding };

      try {
        const result = await registrationQueries.updateClientRegistrationStatus(
          'd1-user-1', 'accept', 'Reviewed', { sub: 'manager-1' }
        );

        expect(result.status).toBe('Accepted');
        expect(result.clientType).toBe('Seller');
        expect(d1Binding.batch).toHaveBeenCalledTimes(1);
        expect(preparedStatements).toHaveLength(5);
        expect(preparedStatements[0].sql).toContain('UPDATE "user"');
        expect(preparedStatements[1].sql).toContain('INSERT INTO client_registration_events');
        expect(preparedStatements[1].sql).toContain('changes() = 1');
        expect(preparedStatements[2].sql).toContain('INSERT INTO event_outbox');
        expect(preparedStatements[2].params[1]).toBe('registration_decision_email');
        expect(preparedStatements[2].sql).toContain("'accountType'");
        expect(preparedStatements[3].sql).toContain('UPDATE buyer_accounts');
        expect(preparedStatements[4].sql).toContain('SELECT r.role_name AS "roleName"');
        // The D1 bridge binds one value per $n occurrence in SQL order: the status
        // appears twice, and the registration id is the last placeholder. The actor
        // name and email are null because the actor carried only a subject id.
        expect(preparedStatements[1].params).toEqual([
          expect.any(String), 'Accepted', 'Accepted', 'manager-1', null, null, 'Reviewed', 'd1-user-1',
        ]);
      } finally {
        if (previousEnv === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousEnv;
      }
    });

    it('returns the D1 client without a client type when the role lookup finds no row', async () => {
      const previousEnv = globalThis.__CF_ENV__;
      globalThis.__CF_ENV__ = {
        DB: {
          prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
          batch: jest.fn().mockResolvedValue([
            { results: [{ id: 'd1-user-4', userEmail: 'buyer4@example.com', isApproved: true, verificationStatus: 'VERIFIED' }], meta: { changes: 1 } },
            { results: [{ id: 'registration-event-4' }], meta: { changes: 1 } },
            { results: [{ id: 'registration-decision-email:event-4' }], meta: { changes: 1 } },
            { results: [], meta: { changes: 0 } },
            { results: [], meta: { changes: 0 } },
          ]),
        },
      };

      try {
        const result = await registrationQueries.updateClientRegistrationStatus('d1-user-4', 'accept', '', { sub: 'manager-4' });

        expect(result.status).toBe('Accepted');
        expect(result.clientType).toBeNull();
      } finally {
        if (previousEnv === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousEnv;
      }
    });

    it('fails closed if a D1 batch changes the user without returning its event', async () => {
      const previousEnv = globalThis.__CF_ENV__;
      globalThis.__CF_ENV__ = {
        DB: {
          prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
          batch: jest.fn().mockResolvedValue([
            { results: [{ id: 'd1-user-2', userEmail: 'buyer2@example.com', isApproved: true, verificationStatus: 'VERIFIED' }], meta: { changes: 1 } },
            { results: [], meta: { changes: 0 } },
            { results: [], meta: { changes: 0 } },
          ]),
        },
      };

      try {
        await expect(registrationQueries.updateClientRegistrationStatus('d1-user-2', 'accept', '', { sub: 'admin-2' }))
          .rejects.toMatchObject(UNAVAILABLE);
      } finally {
        if (previousEnv === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousEnv;
      }
    });

    it('fails closed if a D1 registration decision has no durable notification row', async () => {
      const previousEnv = globalThis.__CF_ENV__;
      globalThis.__CF_ENV__ = {
        DB: {
          prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
          batch: jest.fn().mockResolvedValue([
            { results: [{ id: 'd1-user-3', userEmail: 'buyer3@example.com', isApproved: true, verificationStatus: 'VERIFIED' }], meta: { changes: 1 } },
            { results: [{ id: 'registration-event-3' }], meta: { changes: 1 } },
            { results: [], meta: { changes: 0 } },
            { results: [], meta: { changes: 0 } },
            { results: [{ roleName: 'buyer' }], meta: { changes: 0 } },
          ]),
        },
      };

      try {
        await expect(registrationQueries.updateClientRegistrationStatus('d1-user-3', 'accept', '', { sub: 'admin-3' }))
          .rejects.toMatchObject(UNAVAILABLE);
      } finally {
        if (previousEnv === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousEnv;
      }
    });

    it('returns null or a conflict when D1 conditionally updates no pending registration', async () => {
      const previousEnv = globalThis.__CF_ENV__;
      globalThis.__CF_ENV__ = {
        DB: {
          prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
          batch: jest.fn().mockResolvedValue([
            { results: [], meta: { changes: 0 } },
            { results: [], meta: { changes: 0 } },
            { results: [], meta: { changes: 0 } },
          ]),
        },
      };

      try {
        querySpy.mockResolvedValueOnce({ rows: [] });
        await expect(registrationQueries.updateClientRegistrationStatus('missing-d1-user', 'accept', '', { sub: 'admin-5' }))
          .resolves.toBeNull();
        expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('WHERE u.uuid = $1'), expect.any(Array), {
          d1: true,
          useCache: false,
        });

        querySpy.mockResolvedValueOnce({
          rows: [{
            id: 'processed-d1-user',
            userName: 'Processed',
            userEmail: 'processed@example.com',
            isApproved: true,
            verificationStatus: 'VERIFIED',
          }],
        });
        await expect(registrationQueries.updateClientRegistrationStatus('processed-d1-user', 'reject', '', { sub: 'admin-5' }))
          .rejects.toMatchObject({ code: 'REGISTRATION_ALREADY_PROCESSED', status: 409 });
      } finally {
        if (previousEnv === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousEnv;
      }
    });
  });
});
