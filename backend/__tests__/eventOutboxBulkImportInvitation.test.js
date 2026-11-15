const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const identityQueries = require('../src/db/identityQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const storeService = require('../src/services/storeService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

describe('durable bulk-import vendor invitations', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(raw, attempts = 1) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry:vendor-bulk-invitation:test',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_BULK_IMPORT_INVITATION_EMAIL,
      raw,
      attempts,
      lease_token: 'lease-bulk-invitation',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  const vendor = {
    id: 'v-bulk-1',
    email: 'vendor@example.test',
    name: 'Vendor Ltd',
    contactPerson: 'Vendor Contact',
    vendorCode: 'CODE-1',
    addedByBuyerCompany: 'Buyer Corp',
    onboardingEmailStatus: 'skipped',
  };

  test('sends a credential-free email for a persisted skipped account and marks it sent', async () => {
    claim({ vendorId: vendor.id });
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'user-1' });
    const updateSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({
      ...vendor,
      onboardingEmailStatus: 'invitation_sent',
    });
    const emailSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(domainQueries.getVendorByIdFromDB).toHaveBeenCalledWith(vendor.id, { fresh: true });
    expect(identityQueries.findUserByEmail).toHaveBeenCalledWith(vendor.email);
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({
      to: vendor.email,
      subject: expect.stringContaining('account is ready'),
    }), 'bulk-import-invitation');
    expect(updateSpy).toHaveBeenCalledWith(vendor.id, { onboardingEmailStatus: 'invitation_sent' });
  });

  test('completes duplicate delivery jobs without sending another email', async () => {
    claim({ vendorId: vendor.id });
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      ...vendor,
      onboardingEmailStatus: 'invitation_sent',
    });
    const emailSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(emailSpy).not.toHaveBeenCalled();
  });

  test.each([
    ['invalid payload', { vendorId: '' }, vendor],
    ['missing vendor', { vendorId: vendor.id }, null],
    ['ineligible status', { vendorId: vendor.id }, { ...vendor, onboardingEmailStatus: 'account_exists' }],
    ['invalid email', { vendorId: vendor.id }, { ...vendor, email: 'bad-email' }],
  ])('dead-letters a %s', async (_label, raw, persistedVendor) => {
    claim(raw);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(persistedVendor);
    const updateSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: vendor.id });
    const emailSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
    expect(emailSpy).not.toHaveBeenCalled();
    if (raw.vendorId) {
      expect(updateSpy).toHaveBeenCalledWith(raw.vendorId, { onboardingEmailStatus: 'invitation_failed' });
    }
  });

  test('dead-letters an invitation after the vendor identity has been removed', async () => {
    claim({ vendorId: vendor.id });
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: vendor.id });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('retries a provider refusal and records invitation failure after the final attempt', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'user-1' });
    jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: false });
    const updateSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: vendor.id });

    claim({ vendorId: vendor.id }, 1);
    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      lastError: 'VENDOR_BULK_IMPORT_INVITATION_FAILED:Error',
    }));

    jest.restoreAllMocks();
    claim({ vendorId: vendor.id }, 99);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'user-1' });
    jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: false });
    const finalUpdateSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: vendor.id });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(finalUpdateSpy).toHaveBeenCalledWith(vendor.id, { onboardingEmailStatus: 'invitation_failed' });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
