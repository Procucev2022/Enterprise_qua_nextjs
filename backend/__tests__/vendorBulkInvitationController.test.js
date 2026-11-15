const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const identityQueries = require('../src/db/identityQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const storeService = require('../src/services/storeService');
const vendorController = require('../src/controllers/vendorController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('bulk-import vendor invitation controller', () => {
  afterEach(() => jest.restoreAllMocks());

  const vendor = {
    id: 'v-bulk-1',
    email: 'vendor@example.test',
    onboardingEmailStatus: 'skipped',
  };

  test('rejects callers without a bulk-import role', async () => {
    const res = mockRes();
    await vendorController.sendBulkImportInvitations({
      user: { role: 'vendor', email: 'vendor@example.test' },
      body: { vendorIds: [vendor.id] },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('validates a non-empty bounded vendor ID list before database access', async () => {
    const hasStorageSpy = jest.spyOn(pool, 'hasStorage');
    const res = mockRes();
    await vendorController.sendBulkImportInvitations({
      user: { role: 'admin' },
      body: { vendorIds: ['v-1', 'v-1'] },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(hasStorageSpy).not.toHaveBeenCalled();
  });

  test('returns retry guidance when database storage is unavailable', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const res = mockRes();
    await vendorController.sendBulkImportInvitations({
      user: { role: 'category_manager' },
      body: { vendorIds: [vendor.id] },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
  });

  test('queues the invitation durably for the scheduled dispatcher', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'identity-1' });
    jest.spyOn(eventOutboxService, 'enqueueEventOutbox').mockResolvedValue({ id: 'outbox-1', status: 'pending' });
    const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ completed: 1 });
    const updateSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({
      ...vendor,
      onboardingEmailStatus: 'invitation_pending',
    });
    const res = mockRes();

    await vendorController.sendBulkImportInvitations({
      user: { role: 'category_manager', email: 'manager@procucev.com' },
      body: { vendorIds: [vendor.id] },
    }, res, jest.fn());

    expect(identityQueries.findUserByEmail).toHaveBeenCalledWith(vendor.email);
    expect(updateSpy).toHaveBeenCalledWith(vendor.id, { onboardingEmailStatus: 'invitation_pending' });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        sentCount: 0,
        queuedCount: 1,
        results: [{ vendorId: vendor.id, status: 'queued' }],
      }),
    }));
  });

  test('does not invite a buyer who does not own the vendor profile', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({ ...vendor, buyerId: 'other-buyer' });
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
    const enqueueSpy = jest.spyOn(eventOutboxService, 'enqueueEventOutbox');
    const res = mockRes();

    await vendorController.sendBulkImportInvitations({
      user: { role: 'buyer', email: 'buyer@example.test', sub: 'current-buyer' },
      body: { vendorIds: [vendor.id] },
    }, res, jest.fn());

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ results: [{ vendorId: vendor.id, status: 'not_found' }] }),
    }));
  });

  test('reports ineligible, already-sent, missing-identity and missing-vendor records without queueing', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockImplementation(async (id) => {
      if (id === 'missing') return null;
      if (id === 'sent') return { ...vendor, id, onboardingEmailStatus: 'invitation_sent' };
      if (id === 'existing') return { ...vendor, id, onboardingEmailStatus: 'account_exists' };
      if (id === 'no-identity') return { ...vendor, id, onboardingEmailStatus: 'skipped' };
      if (id === 'no-email') return { ...vendor, id, email: null, onboardingEmailStatus: 'skipped' };
      return null;
    });
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    const enqueueSpy = jest.spyOn(eventOutboxService, 'enqueueEventOutbox');
    const res = mockRes();

    await vendorController.sendBulkImportInvitations({
      user: { role: 'admin' },
      body: { vendorIds: ['missing', 'sent', 'existing', 'no-identity', 'no-email'] },
    }, res, jest.fn());

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sentCount: 1,
        failedCount: 4,
        results: [
          { vendorId: 'missing', status: 'not_found' },
          { vendorId: 'sent', status: 'already_sent' },
          { vendorId: 'existing', status: 'not_eligible' },
          { vendorId: 'no-identity', status: 'identity_missing' },
          { vendorId: 'no-email', status: 'missing_email' },
        ],
      }),
    }));
  });

  test('keeps a durable invitation queued when the pending status write fails', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'identity-1' });
    jest.spyOn(eventOutboxService, 'enqueueEventOutbox').mockResolvedValue({ id: 'outbox-1', status: 'pending' });
    jest.spyOn(storeService, 'updateVendorDurably').mockRejectedValue(new Error('status write unavailable'));
    const res = mockRes();

    await vendorController.sendBulkImportInvitations({
      user: { role: 'admin' },
      body: { vendorIds: [vendor.id] },
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ queuedCount: 1, results: [{ vendorId: vendor.id, status: 'queued' }] }),
    }));
  });

  test('returns an existing completed outbox invitation as already sent', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'identity-1' });
    jest.spyOn(eventOutboxService, 'enqueueEventOutbox').mockResolvedValue({ id: 'outbox-1', status: 'completed' });
    const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs');
    const res = mockRes();

    await vendorController.sendBulkImportInvitations({
      user: { role: 'admin' },
      body: { vendorIds: [vendor.id] },
    }, res, jest.fn());

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ results: [{ vendorId: vendor.id, status: 'already_sent' }] }),
    }));
  });
});
