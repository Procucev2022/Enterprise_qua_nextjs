jest.mock('../src/db/vendorIngestionQueries');
jest.mock('../src/db/buyerProfileQueries', () => ({ findProfileByUserId: jest.fn() }));
jest.mock('../src/services/loggerService', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), audit: jest.fn() } }));
jest.mock('../src/services/storeService', () => ({
  reset: jest.fn(), addAuditLog: jest.fn(), notifyBuyer: jest.fn(), getVendorById: jest.fn(),
  updateVendor: jest.fn(), empanelIngestedVendor: jest.fn(),
}));
jest.mock('../src/services/mailerService', () => ({}));
jest.mock('../src/services/vendorCategorizationService', () => ({
  ...jest.requireActual('../src/services/vendorCategorizationService'),
  runCategorizationBatch: jest.fn(), classifyVendor: jest.fn(),
}));

const service = require('../src/services/vendorIngestionService');
const queries = require('../src/db/vendorIngestionQueries');
const buyerQueries = require('../src/db/buyerProfileQueries');
const categorization = require('../src/services/vendorCategorizationService');
const store = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');
const {
  VALIDATION_SCHEMAS, VENDOR_INGESTION_SESSION_STATUS: SESSION_STATUS, VENDOR_INGESTION_STEP: STEP,
  VENDOR_INGESTION_HORIZON: HORIZON, VENDOR_INGESTION_AI_STATUS: AI_STATUS,
  VENDOR_MAPPING_STATUS: MAPPING_STATUS, VENDOR_MAPPING_SOURCE: MAPPING_SOURCE,
  VENDOR_INGESTION_CONFIG: CONFIG, VENDOR_INGESTION_MESSAGES: MESSAGES,
} = require('../src/config/constants');

const USER = { sub: 'buyer-user', email: 'buyer@example.test', orgId: 'stale-token-org' };
const CONTEXT = { userId: USER.sub, email: USER.email, organizationId: 'current-org', organizationName: 'Current Buyer Organization' };
const CATEGORY_MASTER = [{ majorCategory: 'Mechanical', minorCategories: ['Pumps', 'Valves'] }];
const SESSION = {
  id: 'session-1', organizationId: CONTEXT.organizationId, status: SESSION_STATUS.JOINED, currentStep: STEP.AI_CATEGORY_JOIN,
  horizonType: HORIZON.LAST_1_YEAR, horizonStart: '2025-06-15', horizonEnd: '2026-06-15',
  poRowCount: 2, vendorMasterRowCount: 2, aiStatus: AI_STATUS.IDLE, aiTotalCount: 2,
  vendorMasterFileName: 'vendors.csv', poFileName: 'purchase-orders.csv',
};
const MAPPING = {
  id: 'mapping-1', vendorRecordId: 'vendor-record-1', vendorCode: 'V-001', companyName: 'Pump Supplier',
  email: 'supplier@example.test', hasPoHistory: true, status: MAPPING_STATUS.AI_MAPPED,
  buyerMajorCategory: '', buyerMinorCategories: [],
  aiSuggestion: { majorCategory: 'Mechanical', minorCategories: ['Pumps'], confidence: 95, reason: 'Repeated pump purchases' },
};
const VENDOR_ROW = { vendorCode: 'V-001', companyName: 'Pump Supplier', email: 'supplier@example.test', gstin: '27ABCDE1234F1Z5' };
const PO_ROW = { poNumber: 'PO-001', poDate: '2026-06-01', itemDescription: 'Industrial pump', quantity: 2, uom: 'Nos', spend: 2000, department: 'Maintenance', vendorCode: 'V-001' };
const SUMMARY = { queued: 0, processing: 0, completed: 2, failed: 0, mapped: 2, pendingReview: 0, selfMapRequired: 0 };

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:30:00Z'));
  buyerQueries.findProfileByUserId.mockResolvedValue({ found: true, profile: { userId: USER.sub, organizationId: CONTEXT.organizationId, companyName: CONTEXT.organizationName, contactEmail: 'profile@example.test' } });
  queries.findSession.mockResolvedValue({ ...SESSION });
  queries.findLatestSession.mockResolvedValue({ ...SESSION });
  queries.insertSession.mockResolvedValue({ ...SESSION });
  queries.updateSession.mockImplementation(async (_id, _org, updates) => ({ ...SESSION, ...updates }));
  queries.findOrganizationCategoryMaster.mockResolvedValue(CATEGORY_MASTER);
  queries.summarizeCategoryMappings.mockResolvedValue({ ...SUMMARY });
  queries.summarizeEmailLogs.mockResolvedValue({ sent: 0, failed: 0 });
  queries.countPoLineItems.mockResolvedValue({ total: 2, inHorizon: 1, outsideHorizon: 1 });
  queries.findVendorMasterRecords.mockResolvedValue([{ id: MAPPING.vendorRecordId, ...VENDOR_ROW, contactPerson: 'Supplier Contact', phone: '+919900000000', address: 'Mumbai' }]);
  queries.countVendorMasterRecords.mockResolvedValue(1);
  queries.bulkUpsertVendorMasterRecords.mockResolvedValue([{ id: MAPPING.vendorRecordId }]);
  queries.findCategoryMappingByVendorRecord.mockResolvedValue({ ...MAPPING });
  queries.findVendorMasterRecord.mockResolvedValue({ ...VENDOR_ROW, contactPerson: 'Supplier Contact', phone: '+919900000000', address: 'Mumbai' });
  queries.findCategoryMappings.mockResolvedValue([{ ...MAPPING }]);
  queries.findQueuedCategoryMappings.mockResolvedValue([]);
  queries.findVendorPurchasingProfiles.mockResolvedValue([{ vendorRecordId: MAPPING.vendorRecordId, vendorCode: 'V-001', companyName: 'Pump Supplier', hasPoHistory: true, poCount: 2, poLineCount: 2, totalSpend: 2000, lineSummaries: ['Industrial pump'] }]);
  queries.saveBuyerReview.mockImplementation(async (_id, _org, review) => ({ ...MAPPING, buyerMajorCategory: review.majorCategory, buyerMinorCategories: review.minorCategories, status: review.status }));
  queries.saveAiSuggestion.mockResolvedValue({ ...MAPPING });
  store.empanelIngestedVendor.mockReturnValue({ id: 'live-vendor-1' });
});

afterEach(() => jest.useRealTimers());

describe('vendor ingestion identity, validation and audit helpers', () => {
  test('uses a client validation status by default and preserves structured error details', () => {
    const error = new service.VendorIngestionError('Invalid vendor input');
    expect(error).toMatchObject({ name: 'VendorIngestionError', status: 400, details: null });
    expect(new service.VendorIngestionError('Conflicting input', 409, { vendorCode: 'Duplicated' }).details).toEqual({ vendorCode: 'Duplicated' });
  });

  test('takes organization ownership from the current profile rather than the token', async () => {
    await expect(service.resolveBuyerContext(USER)).resolves.toEqual(CONTEXT);
    await expect(service.resolveBuyerContext({ sub: USER.sub })).resolves.toMatchObject({ email: 'profile@example.test' });
    buyerQueries.findProfileByUserId.mockResolvedValue({ found: true, profile: { userId: USER.sub, organizationId: CONTEXT.organizationId } });
    await expect(service.resolveBuyerContext({ sub: USER.sub, orgName: 'Token Fallback' })).resolves.toMatchObject({ email: '', organizationName: 'Token Fallback' });
    await expect(service.resolveBuyerContext({ sub: USER.sub })).resolves.toMatchObject({ organizationName: '' });
  });

  test.each([undefined, {}, { email: USER.email }])('rejects an unidentified session (%p)', async (user) => {
    await expect(service.resolveBuyerContext(user)).rejects.toMatchObject({ status: 401, message: MESSAGES.SESSION_MISSING_USER });
    expect(buyerQueries.findProfileByUserId).not.toHaveBeenCalled();
  });

  test.each([['ORG_NOT_LINKED', 409, MESSAGES.ORGANIZATION_NOT_LINKED], ['USER_NOT_FOUND', 401, MESSAGES.SESSION_MISSING_USER]])('fails closed for unavailable identity: %s', async (reason, status, message) => {
    buyerQueries.findProfileByUserId.mockResolvedValue({ found: false, reason });
    await expect(service.resolveBuyerContext(USER)).rejects.toMatchObject({ status, message });
  });

  test('requires a session scoped to the resolved organization', async () => {
    expect(await service.requireSession(CONTEXT, SESSION.id)).toEqual(SESSION);
    expect(queries.findSession).toHaveBeenCalledWith(SESSION.id, CONTEXT.organizationId);
    queries.findSession.mockResolvedValue(null);
    await expect(service.requireSession(CONTEXT, SESSION.id)).rejects.toMatchObject({ status: 404 });
  });

  test('records both audit channels independently, preserving the operation when either log fails', async () => {
    const event = { sessionId: SESSION.id, action: 'TEST_ACTION', entityType: 'SESSION', entityId: SESSION.id };
    await service.recordAudit(CONTEXT, event);
    expect(queries.insertAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ organizationId: CONTEXT.organizationId, action: event.action }));
    expect(store.addAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'Vendor ingestion: TEST_ACTION' }));
    const error = new Error('audit unavailable');
    queries.insertAuditEntry.mockRejectedValue(error);
    store.addAuditLog.mockImplementation(() => { throw error; });
    await expect(service.recordAudit(CONTEXT, { ...event, summary: 'Explicit audit summary' })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  test('resolves predefined and custom horizons and clamps month ends', () => {
    expect(service.todayIso()).toBe('2026-06-15');
    expect(service.subtractMonths('2024-03-31', 1)).toBe('2024-02-29');
    expect(service.subtractMonths('2026-01-31', 2)).toBe('2025-11-30');
    expect(service.resolveTimeHorizon({ horizonType: HORIZON.LAST_1_YEAR })).toEqual({ type: HORIZON.LAST_1_YEAR, startDate: '2025-06-15', endDate: '2026-06-15' });
    expect(service.resolveTimeHorizon({ horizonType: HORIZON.CUSTOM, startDate: '2025-01-01', endDate: '2026-01-01' })).toEqual({ type: HORIZON.CUSTOM, startDate: '2025-01-01', endDate: '2026-01-01' });
  });

  test.each([
    [undefined, undefined],
    [{ horizonType: HORIZON.CUSTOM }, MESSAGES.HORIZON_CUSTOM_DATES_REQUIRED],
    [{ horizonType: HORIZON.CUSTOM, startDate: '2026-06-01' }, MESSAGES.HORIZON_CUSTOM_DATES_REQUIRED],
    [{ horizonType: HORIZON.CUSTOM, startDate: '2026-03-01', endDate: '2026-02-01' }, MESSAGES.HORIZON_START_AFTER_END],
    [{ horizonType: HORIZON.CUSTOM, startDate: '2026-01-01', endDate: '2027-01-01' }, MESSAGES.HORIZON_END_IN_FUTURE],
  ])('rejects an invalid horizon (%p)', (payload, message) => {
    expect(() => service.resolveTimeHorizon(payload)).toThrow(message);
  });

  test.each([
    [SESSION_STATUS.DISPATCHED, STEP.DISPATCH], [SESSION_STATUS.AI_COMPLETED, STEP.DISPATCH],
    [SESSION_STATUS.JOINED, STEP.AI_CATEGORY_JOIN], [SESSION_STATUS.PO_STORED, STEP.AI_CATEGORY_JOIN],
    [SESSION_STATUS.VENDOR_MASTER_STORED, STEP.PO_DUMP], [SESSION_STATUS.DRAFT, STEP.VENDOR_MASTER],
  ])('unlocks only the legitimate step for %s', (status, step) => expect(service.unlockedStepFor({ status })).toBe(step));

  test('enforces chunk bounds before per-row work', () => {
    expect(() => service.assertChunkSize([VENDOR_ROW])).not.toThrow();
    for (const rows of [undefined, {}, []]) expect(() => service.assertChunkSize(rows)).toThrow(service.VendorIngestionError);
    expect(() => service.assertChunkSize(Array(CONFIG.MAX_ROWS_PER_REQUEST + 1).fill(VENDOR_ROW))).toThrow(expect.objectContaining({ status: 413 }));
  });

  test('partitions row failures, preserving source row numbers and the raw accepted row', () => {
    const rows = [{ ...VENDOR_ROW, rowNumber: 7 }, { ...VENDOR_ROW, vendorCode: '', rowNumber: 'invalid' }, { ...VENDOR_ROW, vendorCode: 'BLOCKED' }];
    const result = service.partitionRows(rows, VALIDATION_SCHEMAS.vendorMasterRow, (row) => row.vendorCode === 'BLOCKED' ? 'Supplier is blocked' : null);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({ sourceRowNumber: 7, raw: rows[0] });
    expect(result.invalid.map((row) => row.rowNumber)).toEqual([3, 4]);
    expect(result.invalid[1].errors).toEqual(['Supplier is blocked']);
    expect(service.partitionRows([VENDOR_ROW], VALIDATION_SCHEMAS.vendorMasterRow).valid).toHaveLength(1);
  });

  test('keeps unkeyed rows while reporting duplicate keys at their source row', () => {
    const rows = [{ code: '', sourceRowNumber: 2 }, { code: 'A', sourceRowNumber: 3 }, { code: 'A', sourceRowNumber: 4 }];
    expect(service.rejectDuplicateKeys(rows, (row) => row.code, 'code')).toEqual({ kept: rows.slice(0, 2), duplicates: [{ rowNumber: 4, errors: [expect.stringContaining('row 3')] }] });
  });
});

describe('vendor ingestion session lifecycle', () => {
  test('creates and audits a session, rejecting a failed persistence', async () => {
    expect(await service.createSession(USER, { horizonType: HORIZON.LAST_1_YEAR })).toEqual(SESSION);
    expect(queries.insertSession).toHaveBeenCalledWith(expect.objectContaining({ organizationId: CONTEXT.organizationId, userId: USER.sub }));
    queries.insertSession.mockResolvedValue(null);
    await expect(service.createSession(USER, { horizonType: HORIZON.LAST_1_YEAR })).rejects.toMatchObject({ status: 503, message: MESSAGES.SESSION_SAVE_FAILED });
  });

  test.each([SESSION_STATUS.DRAFT, SESSION_STATUS.JOINED])('changing the horizon clears derived PO/AI data in %s', async (status) => {
    queries.findSession.mockResolvedValue({ ...SESSION, status });
    const result = await service.updateSessionHorizon(USER, SESSION.id, { horizonType: HORIZON.LAST_2_YEARS });
    expect(result.poDataCleared).toBe(true);
    expect(queries.deletePoLineItems).toHaveBeenCalledWith(SESSION.id, CONTEXT.organizationId);
    expect(result.session).toMatchObject({ poRowCount: 0, aiProcessedCount: 0, aiStatus: AI_STATUS.IDLE, currentStep: STEP.PO_DUMP, status: status === SESSION_STATUS.DRAFT ? SESSION_STATUS.DRAFT : SESSION_STATUS.VENDOR_MASTER_STORED });
  });

  test('changing an unused horizon preserves session progress', async () => {
    queries.findSession.mockResolvedValue({ ...SESSION, poRowCount: 0 });
    expect((await service.updateSessionHorizon(USER, SESSION.id, { horizonType: HORIZON.LAST_3_YEARS })).poDataCleared).toBe(false);
    expect(queries.deletePoLineItems).not.toHaveBeenCalled();
  });

  test('resumes the latest or explicitly requested session with its dependent counters', async () => {
    const result = await service.getResumeState(USER);
    expect(result).toMatchObject({ session: SESSION, categoryMaster: CATEGORY_MASTER, mappingSummary: SUMMARY, unlockedStep: STEP.AI_CATEGORY_JOIN });
    expect(queries.findLatestSession).toHaveBeenCalledWith(CONTEXT.organizationId);
    await service.getResumeState(USER, SESSION.id);
    expect(queries.findSession).toHaveBeenCalledWith(SESSION.id, CONTEXT.organizationId);
    queries.findLatestSession.mockResolvedValue(null);
    expect(await service.getResumeState(USER)).toEqual({ session: null, categoryMaster: CATEGORY_MASTER });
  });
});

describe('vendor and purchase order uploads', () => {
  test('reports invalid rows and duplicate supplier identities while storing distinct valid rows', async () => {
    queries.findSession.mockResolvedValue({ ...SESSION, status: SESSION_STATUS.DRAFT });
    const rows = [
      { ...VENDOR_ROW, rowNumber: 2 }, { ...VENDOR_ROW, rowNumber: 3 },
      { ...VENDOR_ROW, vendorCode: 'V-002', rowNumber: 4 }, { ...VENDOR_ROW, vendorCode: '', rowNumber: 5 },
      { vendorCode: 'V-003', companyName: 'Another Supplier', email: 'another@example.test', rowNumber: 6 },
    ];
    const result = await service.confirmVendorMaster(USER, SESSION.id, { rows, fileName: 'new-vendors.csv', replaceExisting: true });
    expect(result).toMatchObject({ validRows: 2, duplicateRows: 2, invalidRows: 1, totalRows: 5, totalStored: 1 });
    expect(result.rejected.map((row) => row.rowNumber)).toEqual([3, 4, 5]);
    expect(result.session.status).toBe(SESSION_STATUS.VENDOR_MASTER_STORED);
    expect(queries.deleteVendorMasterRecords).toHaveBeenCalledWith(SESSION.id, CONTEXT.organizationId);
    queries.findSession.mockResolvedValue(SESSION);
    await service.confirmVendorMaster(USER, SESSION.id, { rows: [VENDOR_ROW] });
    expect(queries.updateSession).toHaveBeenLastCalledWith(SESSION.id, CONTEXT.organizationId, expect.objectContaining({ vendorMasterFileName: SESSION.vendorMasterFileName, status: SESSION.status }));
  });

  test('rejects empty/over-limit vendor uploads and never reports an invalid-only file as success', async () => {
    await expect(service.confirmVendorMaster(USER, SESSION.id, { rows: [{}] })).rejects.toMatchObject({ status: 422, details: { invalidRows: [expect.any(Object)] } });
    expect(queries.bulkUpsertVendorMasterRecords).not.toHaveBeenCalled();
    queries.countVendorMasterRecords.mockResolvedValue(CONFIG.MAX_VENDOR_MASTER_ROWS + 1);
    await expect(service.confirmVendorMaster(USER, SESSION.id, { rows: [VENDOR_ROW] })).rejects.toMatchObject({ status: 413 });
  });

  test('returns preview rows with total count and falls back to the returned row count', async () => {
    expect(await service.getVendorMasterPreview(USER, SESSION.id)).toMatchObject({ total: 1 });
    expect(queries.findVendorMasterRecords).toHaveBeenCalledWith(SESSION.id, CONTEXT.organizationId, 100);
    queries.countVendorMasterRecords.mockResolvedValue(0);
    expect(await service.getVendorMasterPreview(USER, SESSION.id, 20)).toMatchObject({ total: 1 });
  });

  test.each([{ vendorMasterRowCount: 0 }, { horizonStart: null }, { horizonEnd: null }])('requires vendor identities and a full time horizon before PO upload (%p)', async (changes) => {
    queries.findSession.mockResolvedValue({ ...SESSION, ...changes });
    await expect(service.confirmPoDump(USER, SESSION.id, { rows: [PO_ROW] })).rejects.toMatchObject({ status: 409 });
    expect(queries.bulkInsertPoLineItems).not.toHaveBeenCalled();
  });

  test('normalizes dates, flags period boundaries, accepts names, and reports unattributable lines', async () => {
    const rows = [
      PO_ROW, { ...PO_ROW, vendorCode: '', vendorName: 'Named Supplier', poDate: undefined, date: '2024-01-01' },
      { ...PO_ROW, poDate: '2027-01-01' }, { ...PO_ROW, vendorCode: '' }, { ...PO_ROW, poDate: 'invalid' },
    ];
    const result = await service.confirmPoDump(USER, SESSION.id, { rows, replaceExisting: true, fileName: 'new-pos.csv' });
    expect(result).toMatchObject({ validRows: 3, invalidRows: 2, insidePeriod: 1, outsidePeriod: 1 });
    expect(queries.deletePoLineItems).toHaveBeenCalledWith(SESSION.id, CONTEXT.organizationId);
    const stored = queries.bulkInsertPoLineItems.mock.calls[0][2];
    expect(stored.map((row) => row.inHorizon)).toEqual([true, false, false]);
    expect(stored[1].poDate).toBe('2024-01-01');
    await service.confirmPoDump(USER, SESSION.id, { rows: [PO_ROW] });
    expect(queries.updateSession).toHaveBeenLastCalledWith(SESSION.id, CONTEXT.organizationId, expect.objectContaining({ poFileName: SESSION.poFileName, status: SESSION_STATUS.PO_STORED }));
  });

  test('rejects an invalid-only PO file and enforces the session row cap', async () => {
    await expect(service.confirmPoDump(USER, SESSION.id, { rows: [{}] })).rejects.toMatchObject({ status: 422, details: { invalidRows: [expect.any(Object)] } });
    queries.countPoLineItems.mockResolvedValue({ total: CONFIG.MAX_PO_ROWS + 1 });
    await expect(service.confirmPoDump(USER, SESSION.id, { rows: [PO_ROW] })).rejects.toMatchObject({ status: 413 });
  });
});

describe('vendor history matching and AI progress', () => {
  test('joins history, separates self-mapping suppliers and resets prior AI progress', async () => {
    const matched = (await queries.findVendorPurchasingProfiles())[0];
    const unmatched = { ...matched, vendorRecordId: 'no-history', vendorCode: 'V-002', companyName: 'No History Supplier', hasPoHistory: false, email: 'no-history@example.test' };
    queries.findVendorPurchasingProfiles.mockResolvedValue([matched, unmatched]);
    queries.matchPoLineItemsToVendors.mockResolvedValue({ byCode: 2 });
    queries.findUnmatchedPoVendors.mockResolvedValue(['Unidentified Supplier']);
    const result = await service.runVendorPoJoin(USER, SESSION.id);
    expect(result).toMatchObject({ totalVendors: 2, matchedVendorCount: 1, unmatchedVendorCount: 1, selfMapVendors: [{ vendorRecordId: 'no-history', status: MAPPING_STATUS.SELF_MAP_REQUIRED }] });
    expect(result.matchedVendors[0].purchasedItems).toEqual(matched.lineSummaries);
    expect(result.session).toMatchObject({ status: SESSION_STATUS.JOINED, aiStatus: AI_STATUS.IDLE, aiTotalCount: 1 });
    queries.findSession.mockResolvedValue({ ...SESSION, poRowCount: 0 });
    await expect(service.runVendorPoJoin(USER, SESSION.id)).rejects.toMatchObject({ status: 409, message: MESSAGES.PO_DUMP_REQUIRED_FIRST });
  });

  test('refuses classification without a buyer category master', async () => {
    expect(await service.requireCategoryMaster(CONTEXT.organizationId)).toEqual(CATEGORY_MASTER);
    queries.findOrganizationCategoryMaster.mockResolvedValue([]);
    await expect(service.requireCategoryMaster(CONTEXT.organizationId)).rejects.toMatchObject({ status: 409, message: MESSAGES.CATEGORY_MASTER_EMPTY });
  });

  test.each([SESSION_STATUS.DRAFT, SESSION_STATUS.VENDOR_MASTER_STORED])('requires the PO join before AI processing in %s', async (status) => {
    queries.findSession.mockResolvedValue({ ...SESSION, status });
    await expect(service.processCategorizationBatch(USER, SESSION.id)).rejects.toMatchObject({ status: 409 });
  });

  test('audits successful recommendations and failed outcomes while work remains queued', async () => {
    queries.findQueuedCategoryMappings.mockResolvedValue([MAPPING]);
    const suggestion = { ...MAPPING.aiSuggestion, confidenceBand: 'HIGH', model: 'test-model', isNewCategorySuggestion: false };
    categorization.runCategorizationBatch.mockResolvedValue([
      { mappingId: MAPPING.id, vendorRecordId: MAPPING.vendorRecordId, companyName: MAPPING.companyName, status: categorization.CLASSIFICATION_STATUS.SUCCESS, suggestion },
      { mappingId: 'mapping-2', vendorRecordId: 'vendor-2', companyName: 'New Category Supplier', status: categorization.CLASSIFICATION_STATUS.SUCCESS, suggestion: { ...suggestion, majorCategory: '', confidence: null } },
      { vendorRecordId: 'vendor-3', companyName: 'Failed Supplier', status: categorization.CLASSIFICATION_STATUS.AI_FAILED, error: 'Provider unavailable' },
    ]);
    queries.summarizeCategoryMappings.mockResolvedValue({ ...SUMMARY, queued: 1 });
    const result = await service.processCategorizationBatch(USER, SESSION.id, { batchSize: 999 });
    expect(result).toMatchObject({ done: false, processedInBatch: 3, session: { aiStatus: AI_STATUS.PROCESSING } });
    expect(result.outcomes[0].error).toBeNull();
    expect(result.outcomes[2].error).toBe('Provider unavailable');
    expect(queries.findQueuedCategoryMappings).toHaveBeenCalledWith(SESSION.id, CONTEXT.organizationId, CONFIG.AI_BATCH_SIZE);
    expect(categorization.runCategorizationBatch).toHaveBeenCalledWith(expect.objectContaining({ profilesByRecordId: expect.any(Map), categoryMaster: CATEGORY_MASTER }));
    expect(store.notifyBuyer).not.toHaveBeenCalled();
  });

  test.each([
    [AI_STATUS.QUEUED, { ...SUMMARY }, AI_STATUS.COMPLETED],
    [AI_STATUS.PROCESSING, { ...SUMMARY, mapped: 0, failed: 2 }, AI_STATUS.FAILED],
    [AI_STATUS.PROCESSING, { ...SUMMARY, mapped: 0, pendingReview: 1, failed: 1 }, AI_STATUS.COMPLETED],
  ])('finalizes an exhausted batch (%s, %p) as %s', async (initialStatus, summary, expectedStatus) => {
    queries.findSession.mockResolvedValue({ ...SESSION, aiStatus: initialStatus });
    queries.summarizeCategoryMappings.mockResolvedValue(summary);
    store.notifyBuyer.mockImplementation(() => { throw new Error('notification unavailable'); });
    const result = await service.processCategorizationBatch(USER, SESSION.id, { batchSize: -1 });
    expect(result).toMatchObject({ done: true, processedInBatch: 0, session: { aiStatus: expectedStatus, aiCompletedAt: expect.any(String) } });
    expect(logger.warn).toHaveBeenCalled();
  });

  test('re-runs only the requested vendor and preserves the saved suggestion', async () => {
    categorization.classifyVendor.mockResolvedValue({ status: categorization.CLASSIFICATION_STATUS.SUCCESS, suggestion: MAPPING.aiSuggestion });
    const result = await service.reRunCategorization(USER, SESSION.id, MAPPING.vendorRecordId);
    expect(result.mapping).toEqual(MAPPING);
    expect(queries.requeueMapping).toHaveBeenCalledWith(MAPPING.id, CONTEXT.organizationId);
    expect(queries.saveAiSuggestion).toHaveBeenCalledWith(MAPPING.id, CONTEXT.organizationId, MAPPING.aiSuggestion);
    expect(categorization.classifyVendor.mock.calls[0][0].vendorProfile.vendorRecordId).toBe(MAPPING.vendorRecordId);
  });

  test('rejects missing/unattributable re-runs and records model failures', async () => {
    queries.findCategoryMappingByVendorRecord.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...MAPPING, hasPoHistory: false }).mockResolvedValue(MAPPING);
    await expect(service.reRunCategorization(USER, SESSION.id, 'missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.reRunCategorization(USER, SESSION.id, 'no-history')).rejects.toMatchObject({ status: 409 });
    categorization.classifyVendor.mockResolvedValue({ status: categorization.CLASSIFICATION_STATUS.AI_FAILED, error: 'Model failed' });
    await expect(service.reRunCategorization(USER, SESSION.id, MAPPING.vendorRecordId)).rejects.toMatchObject({ status: 502, message: 'Model failed' });
    categorization.classifyVendor.mockResolvedValue({ status: categorization.CLASSIFICATION_STATUS.INVALID_RESPONSE });
    await expect(service.reRunCategorization(USER, SESSION.id, MAPPING.vendorRecordId)).rejects.toMatchObject({ message: MESSAGES.AI_INVALID_RESPONSE });
  });
});

describe('buyer category review and vendor empanelment', () => {
  test('resolves canonical categories, removes repeated minors and rejects unknown/oversized choices', () => {
    expect(service.assertCategoriesInMaster(CATEGORY_MASTER, ' mechanical ', ['pumps', 'PUMPS'])).toEqual({ majorCategory: 'Mechanical', minorCategories: ['Pumps'] });
    expect(() => service.assertCategoriesInMaster(CATEGORY_MASTER, 'Invented', [])).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => service.assertCategoriesInMaster(CATEGORY_MASTER, 'Mechanical', ['Wrong Minor'])).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => service.assertCategoriesInMaster(CATEGORY_MASTER, 'Mechanical', Array(CONFIG.MAX_MINOR_CATEGORIES_PER_VENDOR + 1).fill('Pumps'))).toThrow(expect.objectContaining({ status: 422 }));
  });

  test.each(['APPROVE', 'EDIT', 'REJECT'])('persists the %s decision while retaining the original AI columns', async (action) => {
    const result = await service.reviewMapping(USER, SESSION.id, MAPPING.vendorRecordId, { action, majorCategory: 'Mechanical', minorCategories: ['Pumps', '', 42] });
    expect(result.mapping.aiSuggestion).toEqual(MAPPING.aiSuggestion);
    const review = queries.saveBuyerReview.mock.calls[0][2];
    expect(review.source).toBe(action === 'APPROVE' ? MAPPING_SOURCE.AI : MAPPING_SOURCE.BUYER);
    expect(review.status).toBe(action === 'REJECT' ? MAPPING_STATUS.SELF_MAP_REQUIRED : MAPPING_STATUS.BUYER_APPROVED);
    expect(review).not.toHaveProperty('aiSuggestion');
    expect(store.empanelIngestedVendor).toHaveBeenCalledTimes(action === 'REJECT' ? 0 : 1);
  });

  test('allows editing a major category without assigning a minor', async () => {
    await service.reviewMapping(USER, SESSION.id, MAPPING.vendorRecordId, { action: 'EDIT', majorCategory: 'Mechanical' });
    expect(queries.saveBuyerReview.mock.calls[0][2].minorCategories).toEqual([]);
  });

  test('refuses invalid review actions, missing mappings and edits with no category', async () => {
    await expect(service.reviewMapping(USER, SESSION.id, MAPPING.vendorRecordId, { action: 'INVALID' })).rejects.toMatchObject({ status: 400 });
    queries.findCategoryMappingByVendorRecord.mockResolvedValueOnce(null);
    await expect(service.reviewMapping(USER, SESSION.id, 'missing', { action: 'APPROVE' })).rejects.toMatchObject({ status: 404 });
    await expect(service.reviewMapping(USER, SESSION.id, MAPPING.vendorRecordId, { action: 'EDIT' })).rejects.toMatchObject({ status: 400, message: MESSAGES.EDIT_REQUIRES_CATEGORY });
  });

  test.each([true, false])('requires a real category before approving an empty AI suggestion (new suggestion: %s)', async (isNewCategorySuggestion) => {
    queries.findCategoryMappingByVendorRecord.mockResolvedValue({ ...MAPPING, isNewCategorySuggestion, aiSuggestion: { ...MAPPING.aiSuggestion, majorCategory: '' } });
    await expect(service.reviewMapping(USER, SESSION.id, MAPPING.vendorRecordId, { action: 'APPROVE' })).rejects.toMatchObject({ status: 409 });
    expect(queries.saveBuyerReview).not.toHaveBeenCalled();
  });

  test('skips contactless mappings and updates an existing scoped vendor without duplicating it', async () => {
    expect(await service.empanelApprovedVendor(CONTEXT, SESSION.id, null)).toBeNull();
    expect(await service.empanelApprovedVendor(CONTEXT, SESSION.id, { ...MAPPING, email: '' })).toBeNull();
    store.getVendorById.mockReturnValue({ id: 'existing-vendor' });
    store.updateVendor.mockReturnValue({ id: 'existing-vendor' });
    const mapping = { ...MAPPING, buyerMajorCategory: 'Mechanical', buyerMinorCategories: ['Valves'] };
    expect(await service.empanelApprovedVendor(CONTEXT, SESSION.id, mapping)).toEqual({ id: 'existing-vendor' });
    expect(store.getVendorById).toHaveBeenCalledWith(mapping.email, 'all');
    expect(store.updateVendor).toHaveBeenCalledWith('existing-vendor', expect.objectContaining({ minorCategories: ['Valves'], contactPerson: 'Supplier Contact', gstin: VENDOR_ROW.gstin }));
    expect(queries.attachVendorId).toHaveBeenCalledWith(MAPPING.id, CONTEXT.organizationId, 'existing-vendor');
  });

  test.each([null, {}])('preserves absent source attributes without inventing vendor data (%p)', async (record) => {
    queries.findVendorMasterRecord.mockResolvedValue(record);
    store.empanelIngestedVendor.mockReturnValue(null);
    const mapping = { ...MAPPING, vendorCode: '', aiSuggestion: { ...MAPPING.aiSuggestion, majorCategory: '' } };
    expect(await service.empanelApprovedVendor({ ...CONTEXT, organizationName: '' }, SESSION.id, mapping)).toBeNull();
    expect(store.empanelIngestedVendor).toHaveBeenCalledWith(expect.objectContaining({ majorCategory: null, gstin: null, phone: null, contactPerson: null, location: null, vendorCode: null, addedByBuyerCompany: null }), CONTEXT.email);
    expect(queries.attachVendorId).not.toHaveBeenCalled();
  });
});

describe('mapping review reads', () => {
  test('uses buyer decisions ahead of AI suggestions and applies each server-side filter', async () => {
    const approved = { ...MAPPING, buyerMajorCategory: 'Mechanical', buyerMinorCategories: ['Valves'], status: MAPPING_STATUS.BUYER_APPROVED };
    const selfMapping = { ...MAPPING, id: 'mapping-2', vendorRecordId: 'record-2', companyName: 'Other Supplier', hasPoHistory: false, status: MAPPING_STATUS.SELF_MAP_REQUIRED, aiSuggestion: { ...MAPPING.aiSuggestion, confidence: 50 } };
    queries.findCategoryMappings.mockResolvedValue([approved, selfMapping]);
    expect((await service.listMappings(USER, SESSION.id)).vendors[0]).toMatchObject({ finalMajorCategory: 'Mechanical', finalMinorCategories: ['Valves'], confidenceBand: 'HIGH' });
    expect((await service.listMappings(USER, SESSION.id, { status: MAPPING_STATUS.BUYER_APPROVED, confidence: 'HIGH', hasPoHistory: 'YES', search: 'valves' })).total).toBe(1);
    expect((await service.listMappings(USER, SESSION.id, { status: 'ALL', confidence: 'NEEDS_REVIEW', hasPoHistory: 'NO' })).vendors[0].id).toBe(selfMapping.id);
    expect((await service.listMappings(USER, SESSION.id, { confidence: 'ALL', search: 'missing', limit: 999, offset: -5 })).total).toBe(0);
    expect((await service.listMappings(USER, SESSION.id, { limit: -5, offset: 1 }))).toMatchObject({ limit: 1, offset: 1 });
    expect((await service.listMappings(USER, SESSION.id, { hasPoHistory: 'YES' })).total).toBe(1);
    expect((await service.listMappings(USER, SESSION.id, { hasPoHistory: 'NO' })).total).toBe(1);
  });

  test('aggregates approved category spend while keeping self-mapping suppliers in their own bucket', async () => {
    queries.findCategorySegmentation.mockResolvedValue([
      { majorCategory: 'Mechanical', status: MAPPING_STATUS.BUYER_APPROVED, vendorCount: 1, totalSpend: 100, companies: ['A'] },
      { majorCategory: 'Mechanical', status: MAPPING_STATUS.AI_MAPPED, vendorCount: 2, totalSpend: 200, companies: ['B', 'C'] },
      { majorCategory: 'Electrical', status: MAPPING_STATUS.BUYER_APPROVED, vendorCount: 1, totalSpend: 500, companies: ['D'] },
      { majorCategory: '', status: MAPPING_STATUS.PENDING_REVIEW, companies: ['E'] },
      { majorCategory: 'Mechanical', status: MAPPING_STATUS.SELF_MAP_REQUIRED, companies: ['F'] },
      { majorCategory: 'Mechanical', status: MAPPING_STATUS.SELF_MAPPED, companies: ['G'] },
    ]);
    expect(await service.getCategorySegmentation(USER, SESSION.id)).toEqual({
      categories: [
        { majorCategory: 'Electrical', vendorCount: 1, totalSpend: 500, companies: ['D'] },
        { majorCategory: 'Mechanical', vendorCount: 3, totalSpend: 300, companies: ['A', 'B', 'C'] },
      ],
      selfMappingRequired: ['E', 'F', 'G'],
    });
  });
});
