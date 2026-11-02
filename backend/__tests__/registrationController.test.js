const internalTaskController = require('../src/controllers/internalTaskController');
const registrationQueries = require('../src/db/registrationQueries');
const storeService = require('../src/services/storeService');

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

    test('accepts a registration successfully and records audit log', async () => {
      req.params = { id: 'reg-client-102' };
      req.body = { action: 'accept', remarks: 'Verified by CM' };

      const mockClient = {
        id: 'reg-client-102',
        userName: 'GOVARDHAN PVT LTD',
        status: 'Accepted',
        isApproved: true,
      };
      jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue(mockClient);
      const auditSpy = jest.spyOn(storeService, 'addAuditLog').mockReturnValue();

      await internalTaskController.handleRegistrationAction(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Client registration accepted successfully.',
        client: mockClient,
      });
      expect(auditSpy).toHaveBeenCalledWith(expect.stringContaining('ACCEPTED'));
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
  });
});

