const internalTaskController = require('../src/controllers/internalTaskController');
const registrationQueries = require('../src/db/registrationQueries');

describe('internalTaskController - Registrations', () => {
  let req, res;

  beforeEach(() => {
    jest.restoreAllMocks();
    req = {
      query: {},
      params: {},
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });

  describe('getRegistrations', () => {
    test('returns 200 with registered clients list', async () => {
      req.query = { search: 'verababu', sourceType: 'Web App', status: 'Accepted', limit: '10', offset: '0' };
      const mockResult = {
        total: 1,
        clients: [{ id: 'reg-client-101', userName: 'verababu', sourceType: 'Web App', status: 'Accepted' }],
        limit: 10,
        offset: 0,
      };
      jest.spyOn(registrationQueries, 'getRegisteredClients').mockResolvedValue(mockResult);

      await internalTaskController.getRegistrations(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        total: 1,
        data: mockResult.clients,
        limit: 10,
        offset: 0,
      });
    });

    test('handles default query parameters when none provided', async () => {
      req.query = {};
      const mockResult = {
        total: 44,
        clients: [{ id: 'reg-client-101' }],
        limit: 100,
        offset: 0,
      };
      jest.spyOn(registrationQueries, 'getRegisteredClients').mockResolvedValue(mockResult);

      await internalTaskController.getRegistrations(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, total: 44 })
      );
    });

    test('uses safe query defaults when the query object is absent', async () => {
      req.query = undefined;
      jest.spyOn(registrationQueries, 'getRegisteredClients').mockResolvedValue({
        total: 0, clients: [], limit: 100, offset: 0,
      });

      await internalTaskController.getRegistrations(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(registrationQueries.getRegisteredClients).toHaveBeenCalledWith({
        search: '', sourceType: 'all', status: 'all', clientType: 'all', limit: 100, offset: 0,
      });
    });

    test('returns 500 on database or query exception', async () => {
      req.query = {};
      jest.spyOn(registrationQueries, 'getRegisteredClients').mockRejectedValue(new Error('Store failure'));

      await internalTaskController.getRegistrations(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to retrieve registered clients.',
      });
    });

    test('rejects invalid query parameters before reading registration data', async () => {
      req.query = { limit: '201' };
      const querySpy = jest.spyOn(registrationQueries, 'getRegisteredClients');

      await internalTaskController.getRegistrations(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, details: expect.any(Object) }));
      expect(querySpy).not.toHaveBeenCalled();
    });

    test('returns retryable 503 when configured storage is unavailable', async () => {
      const error = Object.assign(new Error('DB unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' });
      jest.spyOn(registrationQueries, 'getRegisteredClients').mockRejectedValue(error);

      await internalTaskController.getRegistrations(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, retryable: true }));
    });
  });

  describe('handleRegistrationAction', () => {
    test('returns 400 when payload is invalid', async () => {
      req.params = { id: 'reg-client-101' };
      req.body = { action: 'invalid_action' };

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.any(String) })
      );
    });

    test('accepts a registration successfully', async () => {
      req.params = { id: 'reg-client-102' };
      req.body = { action: 'accept', remarks: 'Verified by CM' };

      const mockClient = {
        id: 'reg-client-102',
        userName: 'GOVARDHAN PVT LTD',
        status: 'Accepted',
        isApproved: true,
      };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue(mockClient);

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Client registration accepted successfully.',
        client: mockClient,
      });
      expect(registrationQueries.updateClientRegistrationStatus).toHaveBeenCalledWith(
        'reg-client-102', 'accept', 'Verified by CM', {}
      );
    });

    test('rejects a registration successfully', async () => {
      req.params = { id: 'reg-client-103' };
      req.body = { action: 'reject', remarks: 'Duplicate registration' };

      const mockClient = {
        id: 'reg-client-103',
        userName: 'Kishore Plywood',
        status: 'Rejected',
        isApproved: false,
      };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue(mockClient);

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Client registration rejected successfully.',
        client: mockClient,
      });
    });

    test('returns 500 on action processing error', async () => {
      req.params = { id: 'reg-client-102' };
      req.body = { action: 'accept' };

      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockRejectedValue(new Error('DB crash'));

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to update client registration status.',
      });
    });

    test('returns 404 when registration record is not found', async () => {
      req.params = { id: 'reg-client-999' };
      req.body = { action: 'accept' };

      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue(null);

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Registration record not found.',
        })
      );
    });

    test('returns conflict when a registration was already processed', async () => {
      req.params = { id: 'reg-client-102' };
      req.body = { action: 'accept' };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockRejectedValue(
        Object.assign(new Error('Already processed'), { code: 'REGISTRATION_ALREADY_PROCESSED' })
      );

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    test('returns retryable 503 when registration decision persistence is unavailable', async () => {
      req.params = { id: 'reg-client-102' };
      req.body = { action: 'accept' };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockRejectedValue(
        Object.assign(new Error('DB unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
    });

    test('returns 400 for an invalid action rejected by the persistence boundary', async () => {
      req.params = { id: 'reg-client-102' };
      req.body = { action: 'accept' };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockRejectedValue(
        Object.assign(new Error('Invalid action'), { code: 'INVALID_REGISTRATION_ACTION' })
      );

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('does not send a blank credential template when an approved buyer has no temporary password', async () => {
      req.params = { id: 'reg-buyer-101' };
      req.body = { action: 'accept' };

      const mockBuyer = {
        id: 'reg-buyer-101',
        userName: 'Priya Verma',
        userEmail: 'priya@acme.com',
        phoneNumber: '+919876543210',
        clientType: 'Buyer',
        status: 'Accepted',
        isApproved: true,
      };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue(mockBuyer);
      const mailerService = require('../src/services/mailerService');
      const mailSpy = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ success: true });

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mailSpy).not.toHaveBeenCalled();
    });

    test('does not send buyer credentials to an accepted vendor account', async () => {
      req.params = { id: 'reg-vendor-101' };
      req.body = { action: 'accept' };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue({
        id: 'reg-vendor-101',
        userName: 'Vendor User',
        userEmail: 'vendor@example.com',
        clientType: 'Seller',
        tempPassword: 'temporary-password',
        status: 'Accepted',
        isApproved: true,
      });
      const mailerService = require('../src/services/mailerService');
      const mailSpy = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail');

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mailSpy).not.toHaveBeenCalled();
    });

    test('records provider acceptance for buyer credentials when a temporary password is present', async () => {
      req.params = { id: 'reg-buyer-accepted-mail' };
      req.body = { action: 'accept' };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue({
        id: 'reg-buyer-accepted-mail',
        userName: 'Buyer User',
        userEmail: 'buyer@example.com',
        clientType: 'Buyer',
        tempPassword: 'temporary-password',
        status: 'Accepted',
        isApproved: true,
      });
      const mailerService = require('../src/services/mailerService');
      jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ sent: true });
      const { logger } = require('../src/services/loggerService');
      const infoSpy = jest.spyOn(logger, 'info');

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('was accepted by a provider'),
        expect.objectContaining({ registrationId: 'reg-buyer-accepted-mail', recipientPresent: true }),
        'INTERNAL_TASK_CONTROLLER'
      );
    });

    test('sends buyer credentials only with an explicit temporary password and logs provider refusal', async () => {
      req.params = { id: 'reg-buyer-103' };
      req.body = { action: 'accept' };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue({
        id: 'reg-buyer-103',
        userName: 'Priya Verma',
        userEmail: 'priya@acme.com',
        phoneNumber: '+919876543210',
        clientType: 'Buyer',
        tempPassword: 'one-time-password',
        status: 'Accepted',
        isApproved: true,
      });
      const mailerService = require('../src/services/mailerService');
      const mailSpy = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({
        sent: false,
        reason: 'provider_declined',
      });
      const { logger } = require('../src/services/loggerService');
      const warnSpy = jest.spyOn(logger, 'warn');

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mailSpy).toHaveBeenCalledWith(expect.objectContaining({
        to: 'priya@acme.com',
        recipientName: 'Priya Verma',
        tempPassword: 'one-time-password',
      }));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('was not accepted by a provider'),
        expect.objectContaining({ registrationId: 'reg-buyer-103', recipientPresent: true }),
        'INTERNAL_TASK_CONTROLLER'
      );
    });

    test('handles mailer error gracefully when credentials email dispatch fails', async () => {
      req.params = { id: 'reg-buyer-102' };
      req.body = { action: 'accept' };

      const mockBuyer = {
        id: 'reg-buyer-102',
        userName: 'Amit Singh',
        userEmail: 'amit@acme.com',
        phoneNumber: '+919876543211',
        clientType: 'Buyer',
        tempPassword: 'one-time-password',
        status: 'Accepted',
        isApproved: true,
      };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue(mockBuyer);
      const mailerService = require('../src/services/mailerService');
      jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockRejectedValue(new Error('SMTP connection error'));

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

  });
});
