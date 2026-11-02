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

  test('updateClientRegistrationStatus returns fallback object for unknown ID', async () => {
    const fallback = await registrationQueries.updateClientRegistrationStatus('unknown-999', 'accept');
    expect(fallback.id).toBe('unknown-999');
    expect(fallback.status).toBe('Accepted');
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
    };

    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [mockDbRow] });

    const result = await registrationQueries.getRegisteredClients();
    expect(result.clients.some((c) => c.id === 'db-user-1')).toBe(true);

    // Update with DB storage
    await registrationQueries.updateClientRegistrationStatus('db-user-1', 'accept');
    expect(querySpy).toHaveBeenCalled();

    // Query error branch
    querySpy.mockRejectedValueOnce(new Error('DB failure'));
    const fallbackResult = await registrationQueries.getRegisteredClients();
    expect(fallbackResult.total).toBeGreaterThan(0);
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
  });

  test('handles database error in updateClientRegistrationStatus gracefully', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockRejectedValue(new Error('Update failed'));

    const client = await registrationQueries.updateClientRegistrationStatus('reg-client-101', 'reject');
    expect(client.status).toBe('Rejected');
  });

  test('updateClientRegistrationStatus updates storeService buyer accounts when present', async () => {
    const storeService = require('../src/services/storeService');
    const originalBuyers = storeService.buyerAccounts;
    storeService.buyerAccounts = [
      { id: 'reg-client-101', corporateEmail: 'veerababuv2002@gmail.com', status: 'PENDING' },
      { id: 'other-buyer', corporateEmail: 'other@example.com', status: 'PENDING' },
    ];

    try {
      const accepted = await registrationQueries.updateClientRegistrationStatus('reg-client-101', 'accept', 'Approved by admin');
      expect(accepted.status).toBe('Accepted');
      expect(accepted.remarks).toBe('Approved by admin');
      expect(storeService.buyerAccounts[0].status).toBe('ACTIVE_VERIFIED');
      expect(storeService.buyerAccounts[0].profileVerified).toBe(true);

      const rejected = await registrationQueries.updateClientRegistrationStatus('reg-client-101', 'reject');
      expect(rejected.status).toBe('Rejected');
      expect(storeService.buyerAccounts[0].status).toBe('REJECTED');
      expect(storeService.buyerAccounts[0].profileVerified).toBe(false);

      // Default / empty action
      const defaultAction = await registrationQueries.updateClientRegistrationStatus('reg-client-101');
      expect(defaultAction.status).toBe('Rejected');
    } finally {
      storeService.buyerAccounts = originalBuyers;
    }
  });

  test('getRegisteredClients handles empty DB rows gracefully', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    const result = await registrationQueries.getRegisteredClients();
    expect(result.total).toBe(44);
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
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    const client = await registrationQueries.updateClientRegistrationStatus('reg-client-101', 'reject');
    expect(client.status).toBe('Rejected');
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "user"'),
      [false, 'REJECTED', 'reg-client-101'],
      { d1: true }
    );
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE buyer_accounts'),
      ['REJECTED', 'reg-client-101'],
      { d1: true }
    );
  });
});

