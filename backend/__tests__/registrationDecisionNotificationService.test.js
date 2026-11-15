const mailerService = require('../src/services/mailerService');
const notificationService = require('../src/services/registrationDecisionNotificationService');
const { REGISTRATION_DECISION_EMAIL_COPY, QUA_AI_EMAIL_SUPPORT } = require('../src/config/constants');

describe('registration decision notification service', () => {
  afterEach(() => jest.restoreAllMocks());

  const buyerPayload = {
    registrationId: 'registration-123',
    recipientEmail: 'buyer@example.test',
    recipientName: 'Asha Buyer',
    accountType: 'Buyer',
    decision: 'accepted',
  };

  test('builds an accepted buyer notice with password recovery guidance', () => {
    jest.spyOn(mailerService, 'buyerPortalUrl').mockReturnValue('https://portal.example.test/login');

    const message = notificationService.buildRegistrationDecisionEmail(buyerPayload);

    expect(message).toMatchObject({
      to: 'buyer@example.test',
      subject: 'Buyer account registration approved',
    });
    expect(message.text).toContain(REGISTRATION_DECISION_EMAIL_COPY.APPROVED.replace('{accountType}', 'Buyer'));
    expect(message.text).toContain('https://portal.example.test/login');
    expect(message.text).toContain(QUA_AI_EMAIL_SUPPORT.EMAIL);
    expect(message.html).toContain('<a href="https://portal.example.test/login">Sign in</a>');
    expect(message.text).not.toContain('temporary password');
  });

  test('builds an escaped rejection notice for a vendor and uses the vendor portal', () => {
    jest.spyOn(mailerService, 'vendorSignInUrl').mockReturnValue('https://vendor.example.test/login?role=vendor&next=home');

    const message = notificationService.buildRegistrationDecisionEmail({
      ...buyerPayload,
      recipientName: '<Asha & Co>',
      accountType: 'Seller',
      decision: 'rejected',
    });

    expect(message.subject).toBe('Vendor account registration not approved');
    expect(message.text).toContain('Your Vendor account registration could not be approved.');
    expect(message.html).toContain('&lt;Asha &amp; Co&gt;');
    expect(message.html).toContain('https://vendor.example.test/login?role=vendor&amp;next=home');
    expect(message.html).not.toContain('<Asha & Co>');
  });

  test('uses a safe greeting when no recipient name is persisted', () => {
    const message = notificationService.buildRegistrationDecisionEmail({
      ...buyerPayload,
      recipientName: null,
      accountType: 'vendor',
    });

    expect(message.text).toContain('Hello there,');
  });

  test.each([
    null,
    [],
    { ...buyerPayload, registrationId: '' },
    { ...buyerPayload, registrationId: 123 },
    { ...buyerPayload, registrationId: 'r'.repeat(129) },
    { ...buyerPayload, recipientEmail: 'bad-address' },
    { ...buyerPayload, recipientEmail: null },
    { ...buyerPayload, accountType: 'admin' },
    { ...buyerPayload, accountType: 7 },
    { ...buyerPayload, decision: 'pending' },
    { ...buyerPayload, decision: 7 },
  ])('rejects malformed persisted decision notification payloads', (payload) => {
    expect(() => notificationService.buildRegistrationDecisionEmail(payload))
      .toThrow(expect.objectContaining({ code: 'INVALID_PERSISTED_RECORD' }));
  });

  test('delivers buyer notices through the buyer mail channel', async () => {
    jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });

    await expect(notificationService.sendRegistrationDecisionNotification(buyerPayload)).resolves.toEqual({ sent: true });
    expect(mailerService.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.test' }),
      'Buyer registration decision email'
    );
  });

  test('delivers vendor notices through the vendor mail channel', async () => {
    jest.spyOn(mailerService, 'deliverVendor').mockResolvedValue({ sent: true });

    await expect(notificationService.sendRegistrationDecisionNotification({
      ...buyerPayload,
      accountType: 'Vendor',
    })).resolves.toEqual({ sent: true });
    expect(mailerService.deliverVendor).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.test' }),
      'Vendor registration decision email'
    );
  });
});
