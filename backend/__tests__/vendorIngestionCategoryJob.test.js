jest.mock('../src/db/vendorIngestionQueries');
jest.mock('../src/db/buyerProfileQueries', () => ({ findProfileByUserId: jest.fn() }));
jest.mock('../src/services/loggerService', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), audit: jest.fn() } }));
jest.mock('../src/services/storeService', () => ({ notifyBuyer: jest.fn() }));
jest.mock('../src/services/mailerService', () => ({}));
jest.mock('../src/services/vendorCategorizationService', () => ({
  ...jest.requireActual('../src/services/vendorCategorizationService'),
  runCategorizationBatch: jest.fn(),
}));

const service = require('../src/services/vendorIngestionService');
const queries = require('../src/db/vendorIngestionQueries');
const buyerQueries = require('../src/db/buyerProfileQueries');
const categorization = require('../src/services/vendorCategorizationService');
const { logger } = require('../src/services/loggerService');
const {
  VENDOR_INGESTION_SESSION_STATUS: SESSION_STATUS, VENDOR_INGESTION_STEP: STEP,
  VENDOR_INGESTION_AI_STATUS: AI_STATUS, VENDOR_INGESTION_MESSAGES: MESSAGES,
  VENDOR_INGESTION_JOB_STATUS: JOB_STATUS, VENDOR_INGESTION_JOB_TYPE: JOB_TYPE,
} = require('../src/config/constants');

const USER = { sub: 'buyer-user', email: 'buyer@example.test' };
const ORGANIZATION_ID = 'org-job';
const SESSION_ID = 'session-job';
const SESSION = {
  id: SESSION_ID, organizationId: ORGANIZATION_ID, status: SESSION_STATUS.JOINED, currentStep: STEP.AI_CATEGORY_JOIN,
  horizonStart: '2025-06-15', horizonEnd: '2026-06-15', poRowCount: 2, poFileName: 'purchase-orders.csv',
  aiStatus: AI_STATUS.IDLE, aiTotalCount: 0,
};
const PROFILE = {
  vendorRecordId: 'vr-1', vendorCode: 'V-1', companyName: 'Supplier One', email: 'one@example.test',
  hasPoHistory: true, poCount: 2, poLineCount: 2, totalSpend: 500, lineSummaries: ['Pump'],
  departments: [], existingCategories: [],
};
const QUEUED = { id: 'map-1', vendorRecordId: 'vr-1', companyName: 'Supplier One' };
const SUMMARY = { queued: 0, processing: 0, completed: 1, failed: 0, mapped: 1, pendingReview: 0, selfMapRequired: 0 };
const SUCCESS_OUTCOME = {
  mappingId: 'map-1', vendorRecordId: 'vr-1', companyName: 'Supplier One', status: categorization.CLASSIFICATION_STATUS.SUCCESS,
  suggestion: { majorCategory: 'Mechanical', minorCategories: ['Pumps'], confidence: 90, confidenceBand: 'HIGH', isNewCategorySuggestion: false, model: 'test-model' },
};
const RUN = { sessionUser: USER, sessionId: SESSION_ID, organizationId: ORGANIZATION_ID, jobId: 'job-1' };

const flushImmediates = () => new Promise((resolve) => setImmediate(resolve));
const progressPatches = () => queries.updateIngestionJobProgress.mock.calls.map(([, , patch]) => patch);

/** Start a job with a wait-until hook, then wait for the background run it registered. */
async function startAndSettle() {
  const waitUntil = jest.fn();
  globalThis.__CF_WAIT_UNTIL__ = waitUntil;
  const job = await service.startCategorizationJob(USER, SESSION_ID);
  await Promise.all(waitUntil.mock.calls.map(([background]) => background));
  return job;
}

beforeEach(() => {
  jest.resetAllMocks();
  buyerQueries.findProfileByUserId.mockResolvedValue({
    found: true,
    profile: { userId: USER.sub, organizationId: ORGANIZATION_ID, companyName: 'Job Buyer', contactEmail: 'buyer@example.test' },
  });
  queries.findSession.mockResolvedValue({ ...SESSION });
  queries.updateSession.mockImplementation(async (_id, _org, updates) => ({ ...SESSION, ...updates }));
  queries.findOrganizationCategoryMaster.mockResolvedValue([{ majorCategory: 'Mechanical', minorCategories: ['Pumps'] }]);
  queries.findVendorPurchasingProfiles.mockResolvedValue([{ ...PROFILE }]);
  queries.findQueuedCategoryMappings.mockResolvedValue([]);
  queries.summarizeCategoryMappings.mockResolvedValue({ ...SUMMARY });
  queries.findActiveIngestionJobs.mockResolvedValue([]);
  queries.createIngestionJob.mockResolvedValue({ id: 'job-new', status: JOB_STATUS.PROCESSING, jobType: JOB_TYPE.AI_CATEGORY });
  queries.updateIngestionJobProgress.mockResolvedValue({});
  categorization.runCategorizationBatch.mockResolvedValue([]);
  delete globalThis.__CF_WAIT_UNTIL__;
});

afterEach(() => {
  delete globalThis.__CF_WAIT_UNTIL__;
});

describe('runCategorizationJob', () => {
  test('runs the join, then each batch, and records progress and completion', async () => {
    queries.findQueuedCategoryMappings.mockResolvedValueOnce([{ ...QUEUED }]);
    queries.summarizeCategoryMappings
      .mockResolvedValueOnce({ ...SUMMARY, queued: 1, completed: 0, mapped: 0 })
      .mockResolvedValue({ ...SUMMARY });
    categorization.runCategorizationBatch.mockResolvedValueOnce([{ ...SUCCESS_OUTCOME }]);

    await service.runCategorizationJob(RUN);

    expect(progressPatches()).toEqual([
      expect.objectContaining({ status: JOB_STATUS.PROCESSING, totalRecords: 1 }),
      { processedRecords: 1, failedRecords: 0 },
      { processedRecords: 1, failedRecords: 0 },
      expect.objectContaining({ status: JOB_STATUS.COMPLETED, completedAt: expect.any(String) }),
    ]);
    expect(categorization.runCategorizationBatch).toHaveBeenCalledTimes(1);
    expect(queries.updateIngestionJobProgress).toHaveBeenCalledWith('job-1', ORGANIZATION_ID, expect.any(Object));
  });

  test('records the first classification error when every attempt fails', async () => {
    queries.findQueuedCategoryMappings.mockResolvedValueOnce([{ ...QUEUED }]);
    queries.summarizeCategoryMappings
      .mockResolvedValueOnce({ ...SUMMARY, queued: 1, completed: 0, mapped: 0 })
      .mockResolvedValue({ ...SUMMARY, mapped: 0, failed: 1, completed: 1 });
    categorization.runCategorizationBatch.mockResolvedValueOnce([
      { mappingId: 'map-1', vendorRecordId: 'vr-1', companyName: 'Supplier One', status: 'NOT_CONFIGURED', error: 'AI is not configured.' },
    ]);

    await service.runCategorizationJob(RUN);

    expect(progressPatches()).toContainEqual({ processedRecords: 1, failedRecords: 1 });
    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.FAILED, errorMessage: 'AI is not configured.' }));
  });

  test('keeps the first error when a later batch also fails', async () => {
    queries.findQueuedCategoryMappings
      .mockResolvedValueOnce([{ ...QUEUED }])
      .mockResolvedValueOnce([{ ...QUEUED, id: 'map-2', vendorRecordId: 'vr-2', companyName: 'Supplier Two' }]);
    queries.summarizeCategoryMappings
      .mockResolvedValueOnce({ ...SUMMARY, queued: 1, completed: 1, mapped: 0, failed: 1 })
      .mockResolvedValueOnce({ ...SUMMARY, queued: 0, completed: 2, mapped: 0, failed: 2 });
    categorization.runCategorizationBatch
      .mockResolvedValueOnce([{ mappingId: 'map-1', vendorRecordId: 'vr-1', companyName: 'Supplier One', status: 'NOT_CONFIGURED', error: 'first failure' }])
      .mockResolvedValueOnce([{ mappingId: 'map-2', vendorRecordId: 'vr-2', companyName: 'Supplier Two', status: 'NOT_CONFIGURED', error: 'second failure' }]);

    await service.runCategorizationJob(RUN);

    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.FAILED, errorMessage: 'first failure' }));
  });

  test('uses the generic failure message when every attempt fails without an error text', async () => {
    queries.findQueuedCategoryMappings.mockResolvedValueOnce([{ ...QUEUED }]);
    queries.summarizeCategoryMappings
      .mockResolvedValueOnce({ ...SUMMARY, queued: 1, completed: 0, mapped: 0 })
      .mockResolvedValue({ ...SUMMARY, mapped: 0, failed: 1, completed: 1 });
    categorization.runCategorizationBatch.mockResolvedValueOnce([
      { mappingId: 'map-1', vendorRecordId: 'vr-1', companyName: 'Supplier One', status: 'INVALID_RESPONSE', error: null },
    ]);

    await service.runCategorizationJob(RUN);

    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.FAILED, errorMessage: MESSAGES.AI_JOB_FAILED }));
  });

  test('records a generic failure message when a batch throws an unexpected error', async () => {
    queries.findQueuedCategoryMappings.mockResolvedValueOnce([{ ...QUEUED }]);
    categorization.runCategorizationBatch.mockRejectedValueOnce(new Error('provider timeout'));

    await expect(service.runCategorizationJob(RUN)).resolves.toBeUndefined();

    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.FAILED, errorMessage: MESSAGES.AI_JOB_FAILED }));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('job-1 stopped'), expect.any(Error), expect.any(String));
  });

  test('reports a readable reason when the PO dump is missing before the join', async () => {
    queries.findSession.mockResolvedValue({ ...SESSION, poRowCount: 0 });

    await service.runCategorizationJob(RUN);

    expect(categorization.runCategorizationBatch).not.toHaveBeenCalled();
    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.FAILED, errorMessage: MESSAGES.PO_DUMP_REQUIRED_FIRST }));
  });

  test('stops a queue that makes no progress instead of looping', async () => {
    queries.summarizeCategoryMappings.mockResolvedValue({ ...SUMMARY, queued: 1 });

    await service.runCategorizationJob(RUN);

    expect(categorization.runCategorizationBatch).not.toHaveBeenCalled();
    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.FAILED, errorMessage: MESSAGES.AI_JOB_FAILED }));
  });

  test('does not reject when the failure itself cannot be recorded', async () => {
    queries.updateIngestionJobProgress.mockRejectedValue(new Error('database unavailable'));

    await expect(service.runCategorizationJob(RUN)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Could not record the failure'), expect.any(Error), expect.any(String));
  });
});

describe('startCategorizationJob', () => {
  test('refuses a session with no PO dump before any job is created', async () => {
    queries.findSession.mockResolvedValue({ ...SESSION, poRowCount: 0 });

    await expect(service.startCategorizationJob(USER, SESSION_ID)).rejects.toMatchObject({ status: 409, message: MESSAGES.PO_DUMP_REQUIRED_FIRST });
    expect(queries.createIngestionJob).not.toHaveBeenCalled();
  });

  test('returns the AI run already in progress rather than starting a second one', async () => {
    const running = { id: 'job-running', jobType: JOB_TYPE.AI_CATEGORY, updatedAt: new Date().toISOString() };
    queries.findActiveIngestionJobs.mockResolvedValue([{ id: 'job-po', jobType: JOB_TYPE.PO_DUMP, updatedAt: new Date().toISOString() }, running]);
    const waitUntil = jest.fn();
    globalThis.__CF_WAIT_UNTIL__ = waitUntil;

    await expect(service.startCategorizationJob(USER, SESSION_ID)).resolves.toEqual(running);

    expect(queries.createIngestionJob).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  test('treats a run that only has a start time as live', async () => {
    queries.findActiveIngestionJobs.mockResolvedValue([{ id: 'job-started', jobType: JOB_TYPE.AI_CATEGORY, startedAt: new Date().toISOString() }]);

    await expect(service.startCategorizationJob(USER, SESSION_ID)).resolves.toMatchObject({ id: 'job-started' });
    expect(queries.createIngestionJob).not.toHaveBeenCalled();
  });

  test('starts a new run when the active AI run has gone stale', async () => {
    queries.findActiveIngestionJobs.mockResolvedValue([{ id: 'job-old', jobType: JOB_TYPE.AI_CATEGORY, updatedAt: '2020-01-01T00:00:00.000Z' }]);

    await expect(startAndSettle()).resolves.toMatchObject({ id: 'job-new' });

    expect(queries.createIngestionJob).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      organizationId: ORGANIZATION_ID,
      jobType: JOB_TYPE.AI_CATEGORY,
      fileName: SESSION.poFileName,
      totalRecords: 0,
    });
    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.COMPLETED }));
  });

  test('treats a run with no timestamps at all as stale', async () => {
    queries.findActiveIngestionJobs.mockResolvedValue([{ id: 'job-untimed', jobType: JOB_TYPE.AI_CATEGORY }]);

    await expect(startAndSettle()).resolves.toMatchObject({ id: 'job-new' });
    expect(queries.createIngestionJob).toHaveBeenCalledTimes(1);
  });

  test('hands the run to the wait-until hook and reports completion', async () => {
    await expect(startAndSettle()).resolves.toMatchObject({ id: 'job-new', status: JOB_STATUS.PROCESSING });

    expect(queries.createIngestionJob).toHaveBeenCalledWith(expect.objectContaining({ jobType: JOB_TYPE.AI_CATEGORY }));
    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.COMPLETED }));
  });

  test('still runs the job to completion on a host with no wait-until hook', async () => {
    const job = await service.startCategorizationJob(USER, SESSION_ID);

    expect(job).toMatchObject({ id: 'job-new' });
    await flushImmediates();
    await flushImmediates();
    expect(progressPatches().at(-1)).toEqual(expect.objectContaining({ status: JOB_STATUS.COMPLETED }));
  });
});
