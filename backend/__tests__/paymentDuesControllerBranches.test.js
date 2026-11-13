// paymentDuesController is a plain Express handler module. Its validator is imported by
// destructuring, so the validator module is wrapped here: the real validation runs unless a
// test asks for a validator failure. Storage, mailer, WhatsApp and store calls are spied.
jest.mock('../src/config/validationSchemas', () => {
  const actual = jest.requireActual('../src/config/validationSchemas');
  return { ...actual, validatePayload: jest.fn() };
});

const paymentDuesController = require('../src/controllers/paymentDuesController');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const pool = require('../src/db/pool');
const mailerService = require('../src/services/mailerService');
const whatsAppService = require('../src/services/whatsAppService');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');
const { PERSISTENCE_MESSAGES } = require('../src/config/constants');
const validationSchemas = require('../src/config/validationSchemas');
const actualValidationSchemas = jest.requireActual('../src/config/validationSchemas');

const STAFF_USER = { role: 'admin', email: 'staff@procucev.test', name: 'Staff Admin' };
const EMAIL_BODY = {
  accountId: 'acc-1',
  accountType: 'buyer',
  recipientEmail: 'buyer@buyer.test',
  subject: 'Credit balance alert',
  message: 'Your credit balance is low.',
};
const MESSAGE_BODY = {
  accountId: 'acc-1',
  accountType: 'seller',
  message: 'Please top up your credits.',
};
const WHATSAPP_BODY = {
  accountId: 'acc-1',
  accountType: 'buyer',
  phone: '+91 98765 43210',
  message: 'Your credit balance is low.',
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('paymentDuesController branches', () => {
  beforeEach(() => {
    validationSchemas.validatePayload.mockImplementation((...args) => actualValidationSchemas.validatePayload(...args));
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listPaymentDues', () => {
    test('falls back to the default page and limit when they are not numbers', async () => {
      const listSpy = jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockResolvedValue({
        accounts: [],
        total: 0,
        summary: {},
        page: 1,
        limit: 25,
      });
      const infoSpy = jest.spyOn(logger, 'info');
      const res = mockRes();

      await paymentDuesController.listPaymentDues({ query: { page: 'abc', limit: 'many' } }, res);

      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 25 }));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(infoSpy).toHaveBeenCalledWith(
        'Retrieved payment dues low-credit accounts',
        expect.objectContaining({ requester: 'anonymous' })
      );
    });
  });

  describe('sendEmailNotification', () => {
    test('answers 500 with the fallback message when the request validator itself fails', async () => {
      validationSchemas.validatePayload.mockImplementationOnce(() => {
        throw new Error('validator crashed');
      });
      const res = mockRes();

      await paymentDuesController.sendEmailNotification({ body: EMAIL_BODY, user: STAFF_USER }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'An internal server error occurred while sending email notification.',
      });
    });

    test('stores an omitted note as an empty note on the pending communication', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-1', deliveryStatus: 'Pending' });
      jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });
      jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue({ id: 'comm-1', deliveryStatus: 'Delivered' });
      const res = mockRes();

      await paymentDuesController.sendEmailNotification({ body: EMAIL_BODY, user: STAFF_USER }, res);

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ notes: '' }));
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('reports a provider that accepted nothing as a retryable 503 and records the failure', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-2', deliveryStatus: 'Pending' });
      jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: false });
      const updateSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue({
        id: 'comm-2',
        deliveryStatus: 'Failed',
      });
      const res = mockRes();

      await paymentDuesController.sendEmailNotification({ body: EMAIL_BODY, user: STAFF_USER }, res);

      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        notificationStatus: 'Failed',
        deliveryStatus: 'Failed',
      }));
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        retryable: true,
        error: expect.stringContaining('not configured'),
      }));
    });
  });

  describe('sendMessageNotification', () => {
    test('refuses an in-app message when no staff user is signed in', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication');
      const res = mockRes();

      await paymentDuesController.sendMessageNotification({ body: MESSAGE_BODY }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringContaining('Sign in with a staff account'),
      }));
      expect(recordSpy).not.toHaveBeenCalled();
    });

    test('answers 503 with the database message when the history write hits unavailable storage', async () => {
      jest.spyOn(storeService, 'createNotificationDurably').mockResolvedValue({ id: 'notif-1' });
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(
        Object.assign(new Error('storage down'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );
      const res = mockRes();

      await paymentDuesController.sendMessageNotification({ body: MESSAGE_BODY, user: STAFF_USER }, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        retryable: true,
        error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
      });
    });

    test('answers 500 with the fallback message for an unexpected history failure', async () => {
      jest.spyOn(storeService, 'createNotificationDurably').mockResolvedValue({ id: 'notif-2' });
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(new Error('insert failed'));
      const res = mockRes();

      await paymentDuesController.sendMessageNotification({ body: MESSAGE_BODY, user: STAFF_USER }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'An internal server error occurred while sending in-app notification.',
      });
    });
  });

  describe('sendWhatsAppNotification', () => {
    test('refuses a WhatsApp link when no staff user is signed in', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication');
      const res = mockRes();

      await paymentDuesController.sendWhatsAppNotification({ body: WHATSAPP_BODY }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(recordSpy).not.toHaveBeenCalled();
    });

    test('builds the wa.me link from the digits of the phone when the link builder is unavailable', async () => {
      const originalBuilder = whatsAppService.buildDirectWhatsAppLink;
      whatsAppService.buildDirectWhatsAppLink = undefined;
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-3', deliveryStatus: 'Pending' });
      const res = mockRes();
      try {
        await paymentDuesController.sendWhatsAppNotification({ body: WHATSAPP_BODY, user: STAFF_USER }, res);
      } finally {
        whatsAppService.buildDirectWhatsAppLink = originalBuilder;
      }

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        directLink: 'https://wa.me/919876543210?text=Your%20credit%20balance%20is%20low.',
      }));
    });

    test('answers 503 with the database message when the WhatsApp history write hits unavailable storage', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(
        Object.assign(new Error('storage down'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );
      const res = mockRes();

      await paymentDuesController.sendWhatsAppNotification({ body: WHATSAPP_BODY, user: STAFF_USER }, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        retryable: true,
        error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
      });
    });

    test('answers 500 with the fallback message for an unexpected WhatsApp failure', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(new Error('insert failed'));
      const res = mockRes();

      await paymentDuesController.sendWhatsAppNotification({ body: WHATSAPP_BODY, user: STAFF_USER }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'An internal server error occurred while initiating WhatsApp notification.',
      });
    });
  });

  describe('updateAcknowledgement', () => {
    test('refuses an acknowledgement change when no staff user is signed in', async () => {
      const updateSpy = jest.spyOn(paymentDuesQueries, 'updateAcknowledgementStatus');
      const res = mockRes();

      await paymentDuesController.updateAcknowledgement({
        body: { accountId: 'acc-1', accountType: 'buyer', acknowledgementStatus: 'Acknowledged' },
      }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    test('rejects a history request with no account id', async () => {
      const historySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory');
      const res = mockRes();

      await paymentDuesController.getHistory({ params: {} }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Account ID is required.' });
      expect(historySpy).not.toHaveBeenCalled();
    });
  });

  describe('exportCsv', () => {
    test('writes empty cells for missing contact values and an en dash for unrecorded activity', async () => {
      jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockResolvedValue({
        accounts: [{
          accountId: 'acc-1',
          accountType: 'buyer',
          companyName: 'Buyer Org One',
          contactPerson: null,
          email: null,
          phoneNumber: null,
          availableCredits: 5,
          totalCredits: 10,
          creditsUsed: 5,
          accountStatus: 'Active',
          registrationDate: '2026-01-01',
          lastActivity: '2026-02-01',
          assignedExecutive: null,
          lastNotification: null,
          notificationChannel: null,
          acknowledgementStatus: null,
        }],
      });
      const res = mockRes();

      await paymentDuesController.exportCsv({ query: {} }, res);

      const csv = res.send.mock.calls[0][0];
      const [header, row] = csv.split('\r\n');
      expect(header.startsWith('Account ID,Account Type,Company Name')).toBe(true);
      expect(row).toContain('"Buyer Org One",""');
      expect(row).toContain('"\u2013","\u2013","Not Notified"');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="payment_dues_report.csv"');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
