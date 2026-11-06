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
        search: '', sourceType: 'all', status: 'all', limit: 100, offset: 0,
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

  });
});
