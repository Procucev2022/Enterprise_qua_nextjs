const botBridgeQueries = require('../src/db/botBridgeQueries');
const domainQueries = require('../src/db/domainQueries');
const mailerService = require('../src/services/mailerService');
const cryptoService = require('../src/services/cryptoService');
const credentialOutboxService = require('../src/services/whatsAppCredentialOutboxService');
const { logger } = require('../src/services/loggerService');

const KEY = 'whatsapp-credential-outbox-test-key';

function user(role = 'buyer', overrides = {}) {
  return {
    id: 'user-1',
    email: role === 'vendor' ? 'vendor@example.test' : 'buyer@example.test',
    name: 'Test Account',
    role,
    mobile: '+919876543210',
    isActive: true,
    resetPasswordRequired: true,
    verificationStatus: 'EMAIL_VERIFIED',
    ...overrides,
  };
}

function encryptedPassword(accountId = 'user-1', password = 'Temp#123') {
  return cryptoService.encrypt(password, {
    additionalData: `whatsapp-registration-credentials:${accountId}`,
  }).encoded;
}

function job(role = 'buyer', extra = {}) {
  return {
    id: 'outbox-1',
    raw: {
      accountId: 'user-1',
      role,
      encryptedTempPassword: encryptedPassword(),
      ...extra,
    },
  };
}

describe('WhatsApp credential email outbox dispatcher', () => {
  let previousKey;
  let previousSecret;

  beforeEach(() => {
    previousKey = process.env.AES_ENCRYPTION_KEY;
    previousSecret = process.env.AES_SECRET_KEY;
    process.env.AES_ENCRYPTION_KEY = KEY;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousKey === undefined) delete process.env.AES_ENCRYPTION_KEY;
    else process.env.AES_ENCRYPTION_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.AES_SECRET_KEY;
    else process.env.AES_SECRET_KEY = previousSecret;
  });

  test('reloads and validates the account before sending buyer credentials', async () => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(user());
    const send = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ sent: true });
    const info = jest.spyOn(logger, 'info');

    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job())).resolves.toBeUndefined();

    expect(botBridgeQueries.findUserByUuid).toHaveBeenCalledWith('user-1', { fresh: true });
    expect(send).toHaveBeenCalledWith({
      to: 'buyer@example.test',
      recipientName: 'Test Account',
      tempPassword: 'Temp#123',
      contactPhone: '+919876543210',
    });
    expect(info).toHaveBeenCalledWith('WhatsApp credential email was accepted by a provider', expect.not.objectContaining({ tempPassword: 'Temp#123' }), 'WHATSAPP_CREDENTIAL_OUTBOX');
  });

  test('sends vendor credentials using the persisted vendor profile and marks delivery sent', async () => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(user('vendor'));
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: 'vendor-1', name: 'Steel Co', email: 'vendor@example.test', contactPerson: 'Vendor Contact',
    });
    const send = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    const update = jest.spyOn(require('../src/services/storeService'), 'updateVendorDurably').mockResolvedValue({ id: 'vendor-1' });

    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job('vendor', { vendorId: 'vendor-1' }))).resolves.toBeUndefined();

    expect(domainQueries.getVendorByIdFromDB).toHaveBeenCalledWith('vendor-1', { fresh: true });
    expect(JSON.stringify(send.mock.calls[0][0])).toContain('Temp#123');
    expect(send.mock.calls[0][1]).toBe('onboarding');
    expect(update).toHaveBeenCalledWith('vendor-1', { onboardingEmailStatus: 'sent' });
  });

  test('falls back to account identity when the optional vendor profile cannot be loaded', async () => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(user('vendor'));
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockRejectedValue(new Error('profile unavailable'));
    const send = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    jest.spyOn(require('../src/services/storeService'), 'updateVendorDurably').mockResolvedValue({ id: 'vendor-1' });
    const errors = jest.spyOn(logger, 'error');

    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job('vendor', { vendorId: 'vendor-1' }))).resolves.toBeUndefined();

    expect(JSON.stringify(send.mock.calls[0][0])).toContain('vendor-1');
    expect(errors).toHaveBeenCalledWith('Could not load vendor details for WhatsApp credential email', expect.any(Object), 'WHATSAPP_CREDENTIAL_OUTBOX');
  });

  test.each([
    ['missing job', null],
    ['missing account id', { raw: { role: 'buyer', encryptedTempPassword: 'cipher' } }],
    ['unsupported role', { raw: { accountId: 'user-1', role: 'admin', encryptedTempPassword: 'cipher' } }],
    ['missing encrypted password', { raw: { accountId: 'user-1', role: 'buyer' } }],
    ['invalid vendor id', { raw: { accountId: 'user-1', role: 'vendor', encryptedTempPassword: 'cipher', vendorId: 12 } }],
  ])('rejects %s persisted payloads before account lookup', async (_label, persistedJob) => {
    const find = jest.spyOn(botBridgeQueries, 'findUserByUuid');
    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(persistedJob))
      .rejects.toMatchObject({ code: 'INVALID_PERSISTED_RECORD' });
    expect(find).not.toHaveBeenCalled();
  });

  test.each([
    ['missing account', null],
    ['role mismatch', user('vendor')],
    ['inactive account', user('buyer', { isActive: false })],
    ['unverified account', user('buyer', { verificationStatus: 'PENDING_EMAIL_VERIFICATION' })],
    ['password no longer requires change', user('buyer', { resetPasswordRequired: false })],
    ['missing email', user('buyer', { email: null })],
    ['malformed email', user('buyer', { email: 'not-an-email' })],
  ])('dead-letter validation rejects a %s account state', async (_label, account) => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(account);
    const send = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail');
    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job('buyer')))
      .rejects.toMatchObject({ code: 'INVALID_PERSISTED_RECORD' });
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects undecryptable or empty credential payloads without provider delivery', async () => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(user());
    jest.spyOn(cryptoService, 'decrypt').mockImplementationOnce(() => { throw new Error('bad tag'); }).mockReturnValueOnce('');
    const send = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail');

    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job()))
      .rejects.toMatchObject({ code: 'INVALID_PERSISTED_RECORD' });
    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job()))
      .rejects.toMatchObject({ code: 'INVALID_PERSISTED_RECORD' });
    expect(send).not.toHaveBeenCalled();
  });

  test.each(['buyer', 'vendor'])('reschedules a %s credential email when the provider does not accept it', async (role) => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(user(role));
    if (role === 'buyer') {
      jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ sent: false });
    } else {
      jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: false });
    }
    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job(role)))
      .rejects.toMatchObject({ code: 'WHATSAPP_CREDENTIAL_EMAIL_FAILED' });
  });

  test('reschedules credential delivery when a provider call throws', async () => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(user());
    jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockRejectedValue(new Error('smtp down'));
    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job()))
      .rejects.toMatchObject({ code: 'WHATSAPP_CREDENTIAL_EMAIL_FAILED' });
  });

  test.each(['missing status row', 'status write failure'])('does not resend vendor credentials for a %s', async (failure) => {
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(user('vendor'));
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({ id: 'vendor-1' });
    const send = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    const update = jest.spyOn(require('../src/services/storeService'), 'updateVendorDurably');
    const log = failure === 'missing status row' ? jest.spyOn(logger, 'warn') : jest.spyOn(logger, 'error');
    update.mockImplementationOnce(failure === 'missing status row'
      ? async () => null
      : async () => { throw new Error('D1 unavailable'); });

    await expect(credentialOutboxService.dispatchWhatsAppCredentialEmail(job('vendor', { vendorId: 'vendor-1' }))).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalled();
  });
});
