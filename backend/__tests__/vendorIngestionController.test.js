// ==============================================================================
// VENDOR INGESTION CONTROLLER & ROUTES TEST SUITE
// ==============================================================================

const controller = require('../src/controllers/vendorIngestionController');
const largeFileIngestionService = require('../src/services/largeFileIngestionService');
const queries = require('../src/db/vendorIngestionQueries');

describe('vendorIngestionController unit tests', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      user: { sub: 'usr-1', organizationId: 'org-1' },
      params: { sessionId: 'sess-1', jobId: 'job-1' },
      body: {},
      query: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('cancelIngestionJob', () => {
    it('successfully cancels active job and returns 200', async () => {
      jest.spyOn(largeFileIngestionService, 'cancelJob').mockResolvedValueOnce(true);

      await controller.cancelIngestionJob(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { cancelled: true },
      });
    });

    it('handles unexpected errors and passes to next middleware', async () => {
      const err = new Error('Cancel failed');
      jest.spyOn(largeFileIngestionService, 'cancelJob').mockRejectedValueOnce(err);

      await controller.cancelIngestionJob(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('startIngestionJob', () => {
    it('starts an ingestion job and returns 202', async () => {
      mockReq.body = { rows: [{ companyName: 'V1' }], fileName: 'v.xlsx', jobType: 'VENDOR_MASTER' };
      jest.spyOn(largeFileIngestionService, 'startIngestionJob').mockResolvedValueOnce({ id: 'job-1' });

      await controller.startIngestionJob(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { job: { id: 'job-1' } },
      });
    });

    it('handles error in startIngestionJob and passes to next middleware', async () => {
      const err = new Error('Job start fail');
      jest.spyOn(largeFileIngestionService, 'startIngestionJob').mockRejectedValueOnce(err);

      await controller.startIngestionJob(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('getActiveJobStatus & getJobById', () => {
    it('returns active job status', async () => {
      mockReq.query = { type: 'VENDOR_MASTER' };
      jest.spyOn(largeFileIngestionService, 'getJobStatus').mockResolvedValueOnce({ id: 'job-act' });

      await controller.getActiveJobStatus(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { job: { id: 'job-act' } },
      });
    });

    it('returns 404 if job by id is not found', async () => {
      jest.spyOn(largeFileIngestionService, 'getJobStatus').mockResolvedValueOnce(null);

      await controller.getJobById(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Ingestion job not found' })
      );
    });

    it('returns 200 with job by id', async () => {
      jest.spyOn(largeFileIngestionService, 'getJobStatus').mockResolvedValueOnce({ id: 'job-1' });

      await controller.getJobById(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { job: { id: 'job-1' } },
      });
    });
  });
});
