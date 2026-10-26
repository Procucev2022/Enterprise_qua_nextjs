const { EventEmitter } = require('events');
const controller = require('../src/controllers/vendorIngestionController');
const service = require('../src/services/vendorIngestionService');
const jobs = require('../src/services/largeFileIngestionService');
const { logger } = require('../src/services/loggerService');
const { VENDOR_INGESTION_CONFIG } = require('../src/config/constants');

describe('vendor ingestion HTTP boundary', () => {
  let req;
  let res;
  let next;
  beforeEach(() => {
    req = { user: { sub: 'buyer', email: 'buyer@example.test' }, params: { sessionId: 's1', vendorRecordId: 'v1', jobId: 'j1' }, query: {}, body: {} };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    next = jest.fn();
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['createSession', 'createSession', (r) => [r.user, r.body], { id: 's1' }, { id: 's1' }, 201],
    ['getSession', 'getResumeState', (r) => [r.user, 's1'], { session: null }, { session: null }],
    ['updateTimeHorizon', 'updateSessionHorizon', (r) => [r.user, 's1', r.body], { session: { id: 's1' }, poDataCleared: true }, { id: 's1' }],
    ['uploadVendorMaster', 'confirmVendorMaster', (r) => [r.user, 's1', { rows: undefined, fileName: undefined, replaceExisting: false }], { imported: 1 }, { imported: 1 }],
    ['getVendorMasterPreview', 'getVendorMasterPreview', (r) => [r.user, 's1', 100], { rows: [] }, { rows: [] }],
    ['uploadPoDump', 'confirmPoDump', (r) => [r.user, 's1', { rows: undefined, fileName: undefined, replaceExisting: false }], { imported: 1 }, { imported: 1 }],
    ['runJoin', 'runVendorPoJoin', (r) => [r.user, 's1'], { matched: 1 }, { matched: 1 }],
    ['categorizeBatch', 'processCategorizationBatch', (r) => [r.user, 's1', { batchSize: undefined }], { done: true }, { done: true }],
    ['reRunAi', 'reRunCategorization', (r) => [r.user, 's1', 'v1'], { mapping: { id: 'm1' } }, { id: 'm1' }],
    ['listVendors', 'listMappings', (r) => [r.user, 's1', { status: undefined, confidence: undefined, hasPoHistory: undefined, search: undefined, limit: undefined, offset: undefined }], { vendors: [] }, { vendors: [] }],
    ['reviewVendorCategory', 'reviewMapping', (r) => [r.user, 's1', 'v1', r.body], { mapping: { id: 'm1' } }, { id: 'm1' }],
    ['getSegmentation', 'getCategorySegmentation', (r) => [r.user, 's1'], { groups: [] }, { groups: [] }],
    ['getCategories', 'getCategoryMaster', (r) => [r.user], { categories: [] }, { categories: [] }],
    ['previewDispatch', 'previewDispatch', (r) => [r.user, 's1', r.body], { recipients: [] }, { recipients: [] }],
    ['sendDispatch', 'sendDispatch', (r) => [r.user, 's1', r.body], { sent: 1 }, { sent: 1 }],
    ['retryDispatch', 'retryFailedDispatches', (r) => [r.user, 's1'], { sent: 1 }, { sent: 1 }],
    ['getDispatchStatus', 'getDispatchStatus', (r) => [r.user, 's1', { status: undefined, limit: undefined }], { total: 1 }, { total: 1 }],
    ['getAudit', 'getAuditTrail', (r) => [r.user, { sessionId: undefined, limit: undefined, offset: undefined }], { entries: [] }, { entries: [] }],
    ['getAiLogs', 'getAiClassificationLogs', (r) => [r.user, 's1', { limit: undefined }], { entries: [] }, { entries: [] }],
    ['getApprovedMappings', 'getApprovedMappings', (r) => [r.user, 500], { mappings: [] }, { mappings: [] }],
  ])('%s forwards caller identity and shapes success and unexpected errors', async (...parameters) => {
    const [handler, operation, expectedArgs, result, data, statusCode] = parameters;
    const spy = jest.spyOn(service, operation).mockResolvedValue(result);
    await controller[handler](req, res, next);
    expect(spy).toHaveBeenCalledWith(...expectedArgs(req));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data }));
    if (statusCode) expect(res.status).toHaveBeenCalledWith(statusCode);
    if (handler === 'updateTimeHorizon') expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ poDataCleared: true }));
    const error = new Error('storage unavailable');
    spy.mockRejectedValueOnce(error);
    await controller[handler](req, res, next);
    expect(next).toHaveBeenCalledWith(error);
  });

  test('returns expected validation status and field errors without invoking global error handling', () => {
    controller.respondWithError(new service.VendorIngestionError('Invalid horizon', 400, { startDate: 'Required' }), res, next, 'failed');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid horizon', fieldErrors: { startDate: 'Required' } });
    controller.respondWithError(new service.VendorIngestionError('Missing', 404), res, next, 'failed');
    expect(res.json).toHaveBeenLastCalledWith({ success: false, error: 'Missing' });
    expect(next).not.toHaveBeenCalled();
    controller.respondWithError(null, res, next, 'failed');
    expect(next).toHaveBeenCalledWith(null);
  });

  test.each([['getVendorMasterPreview', 'getVendorMasterPreview', 100], ['getApprovedMappings', 'getApprovedMappings', 500]])('%s bounds preview limits', async (handler, operation, fallback) => {
    const spy = jest.spyOn(service, operation).mockResolvedValue({});
    for (const [query, expected] of [[undefined, fallback], [{ limit: '-1' }, fallback], [{ limit: '2.5' }, fallback], [{ limit: 'bad' }, fallback], [{ limit: '50' }, 50], [{ limit: '1000' }, handler === 'getApprovedMappings' ? 500 : 1000]]) {
      req.query = query;
      await controller[handler](req, res, next);
      expect(spy.mock.calls.at(-1).at(-1)).toBe(expected);
    }
  });

  test.each([['uploadVendorMaster', 'confirmVendorMaster'], ['uploadPoDump', 'confirmPoDump']])('%s accepts explicit replace requests and counts rows', async (handler, operation) => {
    const spy = jest.spyOn(service, operation).mockResolvedValue({});
    req.body = { rows: [{ vendorCode: 'V1' }], fileName: 'upload.csv', replaceExisting: true };
    await controller[handler](req, res, next);
    expect(spy).toHaveBeenCalledWith(req.user, 's1', req.body);
  });

  test('handles absent categorization and dispatch bodies', async () => {
    jest.spyOn(service, 'processCategorizationBatch').mockResolvedValue({});
    jest.spyOn(service, 'sendDispatch').mockResolvedValue({});
    req.body = undefined;
    await controller.categorizeBatch(req, res, next);
    await controller.sendDispatch(req, res, next);
    expect(service.processCategorizationBatch).toHaveBeenCalledWith(req.user, 's1', { batchSize: undefined });
    expect(service.sendDispatch).toHaveBeenCalledWith(req.user, 's1', undefined);
  });

  test.each([['PO_DUMP', 'po_dump.xlsx'], [undefined, 'vendor_master.xlsx']])('starts %s jobs with default filenames', async (jobType, fileName) => {
    jest.spyOn(jobs, 'startIngestionJob').mockResolvedValue({ id: 'j1' });
    req.body = { rows: [], jobType };
    await controller.startIngestionJob(req, res, next);
    expect(jobs.startIngestionJob).toHaveBeenCalledWith(expect.objectContaining({ fileName, jobType: jobType || 'VENDOR_MASTER' }));
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test.each(['getActiveJobStatus', 'getJobById', 'cancelIngestionJob'])('%s propagates background job failures', async (handler) => {
    const operation = handler === 'cancelIngestionJob' ? 'cancelJob' : 'getJobStatus';
    const error = new Error('job unavailable');
    jest.spyOn(jobs, operation).mockRejectedValue(error);
    await controller[handler](req, res, next);
    expect(next).toHaveBeenCalledWith(error);
  });

  test('uses explicit cancellation ids', async () => {
    jest.spyOn(jobs, 'cancelJob').mockResolvedValue(false);
    req.body.jobId = 'j2';
    await controller.cancelIngestionJob(req, res, next);
    expect(jobs.cancelJob).toHaveBeenCalledWith(req.user, 's1', 'j2');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { cancelled: false } });
    delete req.body;
    await controller.cancelIngestionJob(req, res, next);
    expect(jobs.cancelJob).toHaveBeenLastCalledWith(req.user, 's1', null);
  });

  function streamingRequest(query = {}) {
    const stream = Object.assign(new EventEmitter(), req, { query, destroy: jest.fn() });
    return stream;
  }
  test.each([{}, { fileName: 'po.csv', type: 'PO_DUMP' }])('buffers streaming uploads before starting a job: %p', async (query) => {
    jest.spyOn(jobs, 'startIngestionJob').mockResolvedValue({ id: 'j1' });
    const stream = streamingRequest(query);
    const pending = controller.streamUploadFile(stream, res, next);
    stream.emit('data', Buffer.from('a,'));
    stream.emit('data', Buffer.from('b'));
    stream.emit('end');
    await pending;
    expect(jobs.startIngestionJob).toHaveBeenCalledWith({ sessionUser: req.user, sessionId: 's1', fileBuffer: Buffer.from('a,b'), fileName: query.fileName || 'uploaded_data.csv', jobType: query.type || 'VENDOR_MASTER' });
    expect(res.status).toHaveBeenCalledWith(202);
  });
  test('rejects oversized uploads before scheduling any job', async () => {
    jest.spyOn(jobs, 'startIngestionJob');
    const stream = streamingRequest();
    const pending = controller.streamUploadFile(stream, res, next);
    stream.emit('data', { length: VENDOR_INGESTION_CONFIG.MAX_UPLOAD_BYTES + 1 });
    await pending;
    expect(stream.destroy).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 413 }));
    expect(jobs.startIngestionJob).not.toHaveBeenCalled();
  });
  test('forwards stream errors to error handling', async () => {
    const stream = streamingRequest();
    const pending = controller.streamUploadFile(stream, res, next);
    const error = new Error('connection closed');
    stream.emit('error', error);
    await pending;
    expect(next).toHaveBeenCalledWith(error);
  });
});
