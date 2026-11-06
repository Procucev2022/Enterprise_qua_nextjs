const registrationQueries = require('../src/db/registrationQueries');
const pool = require('../src/db/pool');

describe('registrationQueries', () => {
  beforeEach(() => {
    registrationQueries.resetMemoryClients();
    jest.restoreAllMocks();
  });

  test('getRegisteredClients returns all initial clients without filters', async () => {
    const result = await registrationQueries.getRegisteredClients();
    expect(result.total).toBe(44);
    expect(result.clients.length).toBe(44);
    expect(result.clients[0].userName).toBe('verababu');
    expect(result.clients[0].sourceType).toBe('Web App');
  });

  test('getRegisteredClients filters by search term', async () => {
    const byName = await registrationQueries.getRegisteredClients({ search: 'Raghavendra' });
    expect(byName.total).toBe(1);
    expect(byName.clients[0].userName).toBe('Raghavendra');
    expect(byName.clients[0].sourceType).toBe('WhatsApp');

    const byEmail = await registrationQueries.getRegisteredClients({ search: 'veerababu' });
    expect(byEmail.total).toBe(1);

    const byPhone = await registrationQueries.getRegisteredClients({ search: '+917780755357' });
    expect(byPhone.total).toBe(2);

    const byCompany = await registrationQueries.getRegisteredClients({ search: 'Plywood' });
    expect(byCompany.total).toBe(1);
  });

  test('getRegisteredClients filters by sourceType', async () => {
    const wa = await registrationQueries.getRegisteredClients({ sourceType: 'WhatsApp' });
    expect(wa.total).toBeGreaterThan(0);
    wa.clients.forEach((c) => expect(c.sourceType).toBe('WhatsApp'));

    const em = await registrationQueries.getRegisteredClients({ sourceType: 'Email' });
    expect(em.total).toBeGreaterThan(0);
    em.clients.forEach((c) => expect(c.sourceType).toBe('Email'));

    const web = await registrationQueries.getRegisteredClients({ sourceType: 'Web App' });
    expect(web.total).toBeGreaterThan(0);
    web.clients.forEach((c) => expect(c.sourceType).toBe('Web App'));
  });

  test('getRegisteredClients filters by status', async () => {
    const accepted = await registrationQueries.getRegisteredClients({ status: 'Accepted' });
    expect(accepted.total).toBeGreaterThan(0);
    accepted.clients.forEach((c) => expect(c.status).toBe('Accepted'));

    const pending = await registrationQueries.getRegisteredClients({ status: 'New' });
    expect(pending.total).toBeGreaterThan(0);
    pending.clients.forEach((c) => expect(c.status).toBe('New'));
  });

  test('getRegisteredClients handles pagination with limit and offset', async () => {
    const page1 = await registrationQueries.getRegisteredClients({ limit: 5, offset: 0 });
    expect(page1.clients.length).toBe(5);
    expect(page1.total).toBe(44);

    const page2 = await registrationQueries.getRegisteredClients({ limit: 5, offset: 5 });
    expect(page2.clients.length).toBe(5);
    expect(page2.clients[0].id).not.toBe(page1.clients[0].id);

    // Fallbacks for invalid limit and offset
    const fallback = await registrationQueries.getRegisteredClients({ limit: 'invalid', offset: 'invalid' });
    expect(fallback.limit).toBe(100);
    expect(fallback.offset).toBe(0);
  });

  test('updateClientRegistrationStatus accepts a client', async () => {
    const client = await registrationQueries.updateClientRegistrationStatus('reg-client-102', 'accept', 'Verified enterprise');
    expect(client.status).toBe('Accepted');
    expect(client.isApproved).toBe(true);
    await expect(registrationQueries.updateClientRegistrationStatus('reg-client-102', 'accept'))
      .rejects.toMatchObject({ code: 'REGISTRATION_ALREADY_PROCESSED' });

    const recheck = await registrationQueries.getRegisteredClients({ search: 'GOVARDHAN' });
    expect(recheck.clients[0].status).toBe('Accepted');
  });

  test('updateClientRegistrationStatus rejects a client', async () => {
    const client = await registrationQueries.updateClientRegistrationStatus('reg-client-103', 'reject', 'Incomplete tax details');
    expect(client.status).toBe('Rejected');
    expect(client.isApproved).toBe(false);

    const recheck = await registrationQueries.getRegisteredClients({ search: 'Kishore Plywood' });
    expect(recheck.clients[0].status).toBe('Rejected');
  });

  test('updateClientRegistrationStatus returns null for an unknown ID', async () => {
    const missing = await registrationQueries.updateClientRegistrationStatus('unknown-999', 'accept');
    expect(missing).toBeNull();
  });

  test('queries database when pool has storage and handles errors gracefully', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const mockDbRow = {
      id: 'db-user-1',
      userName: 'DB Client',
      companyName: 'DB Org',
      phoneNumber: '+919999911111',
      userEmail: 'db@client.com',
      regDate: new Date().toISOString(),
      isApproved: true,
      verificationStatus: 'verified',
      sourceTypeRaw: 'whatsapp',
      isWhatsApp: true,
      isWebApp: false,
      total: 1,
    };

    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [mockDbRow] });

    const result = await registrationQueries.getRegisteredClients();
    expect(result.clients.some((c) => c.id === 'db-user-1')).toBe(true);
    expect(result.total).toBe(1);
    expect(querySpy.mock.calls[0][0]).toContain('INNER JOIN role r ON r.uuid = u.role_uuid');
    expect(querySpy.mock.calls[0][0]).toContain('COUNT(*) OVER() AS total');
    expect(querySpy.mock.calls[0][1]).toEqual(expect.arrayContaining(['clientinitiator', 'prapprover1.1']));

    // Query error branch
    querySpy.mockRejectedValueOnce(new Error('DB failure'));
    await expect(registrationQueries.getRegisteredClients()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      status: 503,
    });
  });

  test('database mapping handles different source types and statuses', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const rows = [
      {
        id: 'db-u-email',
        userName: 'Email User',
        companyName: null,
        phoneNumber: null,
        userEmail: null,
        regDate: null,
        isApproved: false,
        verificationStatus: 'rejected',
        sourceTypeRaw: 'email',
        isWhatsApp: false,
        total: 2,
      },
      {
        id: 'db-u-web',
        userName: null,
        companyName: 'Web Org',
        phoneNumber: '+919999922222',
        userEmail: 'web@u.com',
        regDate: 'invalid-date',
        isApproved: false,
        verificationStatus: 'pending',
        sourceTypeRaw: 'web_app',
        isWhatsApp: false,
        total: 3,
      },
      {
        id: 'db-u-missing-status',
        userName: 'Unverified User',
        companyName: 'Unverified Org',
        userEmail: 'unverified@example.com',
        isApproved: false,
        verificationStatus: null,
        sourceTypeRaw: null,
        isWhatsApp: false,
        total: 3,
      },
    ];

    jest.spyOn(pool, 'query').mockResolvedValue({ rows });
    const result = await registrationQueries.getRegisteredClients();
    const emailClient = result.clients.find((c) => c.id === 'db-u-email');
    expect(emailClient.sourceType).toBe('Email');
    expect(emailClient.status).toBe('Rejected');

    const webClient = result.clients.find((c) => c.id === 'db-u-web');
    expect(webClient.sourceType).toBe('Web App');
    expect(webClient.status).toBe('New');
    expect(result.clients.find((client) => client.id === 'db-u-missing-status').status).toBe('New');
  });

  test('pushes source, status, and search filters into the database query and clamps pagination', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({
      rows: [{
        id: 'filtered-user',
        userName: 'Filtered Buyer',
        userEmail: 'buyer@example.com',
        isApproved: false,
        verificationStatus: 'PENDING',
        sourceTypeRaw: 'whatsapp',
        isWhatsApp: true,
        total: 7,
      }],
    });

    const result = await registrationQueries.getRegisteredClients({
      search: ' Buyer ', sourceType: 'WhatsApp', status: 'New', limit: 500, offset: -4,
    });

    expect(result.total).toBe(7);
    expect(result.limit).toBe(200);
    expect(result.offset).toBe(0);
    expect(querySpy.mock.calls[0][0]).toContain('LOWER(COALESCE(u.source_type');
    expect(querySpy.mock.calls[0][0]).toContain('LOWER(COALESCE(u.verification_status');
    expect(querySpy.mock.calls[0][0]).toContain('LOWER(COALESCE(u.email, u.username, \'\')) LIKE');
    expect(querySpy.mock.calls[0][1]).toEqual(expect.arrayContaining(['whatsapp', 'new', '%buyer%', 200, 0]));
  });

  test('fails closed when persistent registration writes fail', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'withTransaction').mockRejectedValue(new Error('Update failed'));

    await expect(registrationQueries.updateClientRegistrationStatus('reg-client-101', 'reject')).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      status: 503,
    });
  });

  test('updateClientRegistrationStatus updates storeService buyer accounts when present', async () => {
    const storeService = require('../src/services/storeService');
    const originalBuyers = storeService.buyerAccounts;
    storeService.buyerAccounts = [
      { id: 'different-id', corporateEmail: 'govardhjan.kilari@procucev.com', status: 'PENDING' },
      { id: 'other-buyer', corporateEmail: 'other@example.com', status: 'PENDING' },
    ];

    try {
      const accepted = await registrationQueries.updateClientRegistrationStatus('reg-client-102', 'accept', 'Approved by admin');
      expect(accepted.status).toBe('Accepted');
      expect(accepted.remarks).toBe('Approved by admin');
      expect(storeService.buyerAccounts[0].status).toBe('ACTIVE_VERIFIED');
      expect(storeService.buyerAccounts[0].profileVerified).toBe(true);

      registrationQueries.resetMemoryClients();
      const rejected = await registrationQueries.updateClientRegistrationStatus('reg-client-102', 'reject');
      expect(rejected.status).toBe('Rejected');
      expect(storeService.buyerAccounts[0].status).toBe('REJECTED');
      expect(storeService.buyerAccounts[0].profileVerified).toBe(false);

      registrationQueries.resetMemoryClients();
      await expect(registrationQueries.updateClientRegistrationStatus('reg-client-102'))
        .rejects.toMatchObject({ code: 'INVALID_REGISTRATION_ACTION' });
    } finally {
      storeService.buyerAccounts = originalBuyers;
    }
  });

  test('logs buyer-cache synchronization failures while keeping the durable decision result', async () => {
    const storeService = require('../src/services/storeService');
    const { logger } = require('../src/services/loggerService');
    const descriptor = Object.getOwnPropertyDescriptor(storeService, 'buyerAccounts');
    const warnSpy = jest.spyOn(logger, 'warn');
    Object.defineProperty(storeService, 'buyerAccounts', {
      configurable: true,
      get() { throw new Error('cache unavailable'); },
    });

    try {
      const result = await registrationQueries.updateClientRegistrationStatus('reg-client-102', 'accept');
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

  test('getRegisteredClients handles empty DB rows gracefully', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '4' }] });

    const result = await registrationQueries.getRegisteredClients();
    expect(result.total).toBe(4);
    expect(result.clients).toEqual([]);
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(querySpy.mock.calls[1][0]).toContain('SELECT COUNT(*) AS total FROM "user" u');
  });

  test('database mapping covers whats_app string and accepted/active verification status', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const rows = [
      {
        id: 'db-u-whats-app',
        userName: 'WA User',
        companyName: 'WA Company',
        phoneNumber: '+919876543210',
        userEmail: 'wa@test.com',
        regDate: new Date().toISOString(),
        isApproved: false,
        verificationStatus: 'accepted',
        sourceTypeRaw: 'whats_app',
        isWhatsApp: false,
        total: 2,
      },
      {
        id: 'db-u-active',
        userName: 'Active User',
        companyName: 'Active Org',
        phoneNumber: '+919876543211',
        userEmail: 'active@test.com',
        regDate: new Date().toISOString(),
        isApproved: false,
        verificationStatus: 'active',
        sourceTypeRaw: null,
        isWhatsApp: false,
        total: 2,
      },
    ];

    jest.spyOn(pool, 'query').mockResolvedValue({ rows });
    const result = await registrationQueries.getRegisteredClients();
    const waClient = result.clients.find((c) => c.id === 'db-u-whats-app');
    expect(waClient.sourceType).toBe('WhatsApp');
    expect(waClient.status).toBe('Accepted');

    const activeClient = result.clients.find((c) => c.id === 'db-u-active');
    expect(activeClient.sourceType).toBe('Web App');
    expect(activeClient.status).toBe('Accepted');
  });

  test('updateClientRegistrationStatus persists rejection in pool when storage is enabled', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const currentRow = {
      id: 'reg-client-101',
      userName: 'verababu',
      companyName: 'Verababu eneterprises',
      userEmail: 'veerababuv2002@gmail.com',
      regDate: '2026-06-30T10:30:00.000Z',
      isApproved: false,
      verificationStatus: 'PENDING',
      sourceTypeRaw: 'W',
      isWhatsApp: false,
    };
    const savedRow = { ...currentRow, verificationStatus: 'REJECTED' };
    const querySpy = jest.fn(async (sql) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: [currentRow] };
      if (/UPDATE "user"/i.test(sql)) return { rows: [savedRow] };
      return { rows: [] };
    });
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback({ query: querySpy }));

    const client = await registrationQueries.updateClientRegistrationStatus(
      'reg-client-101', 'reject', 'Duplicate account', { sub: 'admin-1', email: 'admin@example.com' }
    );
    expect(client.status).toBe('Rejected');
    expect(querySpy).toHaveBeenCalledTimes(4);
    expect(querySpy.mock.calls[0][0]).toContain('FOR UPDATE OF u');
    expect(querySpy.mock.calls[1][0]).toContain('UPDATE "user"');
    expect(querySpy.mock.calls[1][1]).toEqual(expect.arrayContaining(['REJECTED', 'reg-client-101']));
    expect(querySpy.mock.calls[2][0]).toContain('UPDATE buyer_accounts');
    expect(querySpy.mock.calls[3][0]).toContain('INSERT INTO client_registration_events');
    expect(querySpy.mock.calls[3][1]).toEqual(expect.arrayContaining(['admin-1', 'admin@example.com', 'Duplicate account']));
  });

  test('returns null for missing database registrations and conflicts for an already processed row', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback({
      query: jest.fn().mockResolvedValue({ rows: [] }),
    }));
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await expect(registrationQueries.updateClientRegistrationStatus('missing-db-user', 'accept')).resolves.toBeNull();

    const processedRow = {
      id: 'processed-user', userName: 'Processed', companyName: 'Org', userEmail: 'done@example.com',
      isApproved: true, verificationStatus: 'VERIFIED',
    };
    pool.withTransaction.mockImplementationOnce((callback) => callback({
      query: jest.fn().mockResolvedValue({ rows: [processedRow] }),
    }));
    await expect(registrationQueries.updateClientRegistrationStatus('processed-user', 'reject'))
      .rejects.toMatchObject({ code: 'REGISTRATION_ALREADY_PROCESSED', status: 409 });
  });

  test('conflicts if a pending database row changes before the conditional update', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const currentRow = {
      id: 'changed-user', userName: 'Changed', companyName: 'Org', userEmail: 'changed@example.com',
      isApproved: false, verificationStatus: 'PENDING',
    };
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [currentRow] })
      .mockResolvedValueOnce({ rows: [] });
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback({ query: clientQuery }));

    await expect(registrationQueries.updateClientRegistrationStatus('changed-user', 'accept'))
      .rejects.toMatchObject({ code: 'REGISTRATION_ALREADY_PROCESSED', status: 409 });
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  test('uses one atomic D1 batch for the registration, buyer account, and audit event', async () => {
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
        { results: [], meta: { changes: 0 } },
      ]),
    };
    const previousEnv = globalThis.__CF_ENV__;
    globalThis.__CF_ENV__ = { DB: d1Binding };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    try {
      const result = await registrationQueries.updateClientRegistrationStatus(
        'd1-user-1', 'accept', 'Reviewed', { sub: 'manager-1' }
      );

      expect(result.status).toBe('Accepted');
      expect(d1Binding.batch).toHaveBeenCalledTimes(1);
      expect(preparedStatements).toHaveLength(3);
      expect(preparedStatements[0].sql).toContain('UPDATE "user"');
      expect(preparedStatements[1].sql).toContain('INSERT INTO client_registration_events');
      expect(preparedStatements[1].sql).toContain('changes() = 1');
      expect(preparedStatements[2].sql).toContain('UPDATE buyer_accounts');
      expect(preparedStatements[1].params).toEqual(expect.arrayContaining([
        'Accepted', 'manager-1', 'Management Authority', null, 'Reviewed',
      ]));
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
    }
  });

  test('fails closed if a D1 batch changes the user without returning its event', async () => {
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
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    try {
      await expect(registrationQueries.updateClientRegistrationStatus('d1-user-2', 'accept'))
        .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', status: 503 });
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
    }
  });

  test('returns null or conflict when D1 conditionally updates no pending registration', async () => {
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
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    try {
      await expect(registrationQueries.updateClientRegistrationStatus('missing-d1-user', 'accept')).resolves.toBeNull();
      expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('WHERE u.uuid = $1'), expect.any(Array), {
        d1: true,
        useCache: false,
      });

      querySpy.mockResolvedValueOnce({ rows: [{
        id: 'processed-d1-user', userName: 'Processed', userEmail: 'processed@example.com',
        isApproved: true, verificationStatus: 'VERIFIED',
      }] });
      await expect(registrationQueries.updateClientRegistrationStatus('processed-d1-user', 'reject'))
        .rejects.toMatchObject({ code: 'REGISTRATION_ALREADY_PROCESSED', status: 409 });
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
    }
  });
});

