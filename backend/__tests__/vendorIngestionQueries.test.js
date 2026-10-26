const pool = require('../src/db/pool');
const bridge = require('../src/db/d1Bridge');
const queries = require('../src/db/vendorIngestionQueries');
const {
  VENDOR_INGESTION_CONFIG,
  VENDOR_MAPPING_STATUS,
  VENDOR_AI_PROCESSING_STATUS,
  VENDOR_EMAIL_STATUS,
  VENDOR_MATCH_STRATEGY,
} = require('../src/config/constants');

jest.mock('../src/db/d1Bridge', () => ({
  ...jest.requireActual('../src/db/d1Bridge'),
  getD1Binding: jest.fn(), getD1HttpClient: jest.fn(), batchD1: jest.fn(),
}));

const SESSION = 'ingestion-session';
const ORG = 'buyer-organization';
const RECORD = {
  id: 'record-id', session_id: SESSION, organization_id: ORG, company_name: ' Supplier Ltd. ',
  vendor_code: ' V-1 ', email: 'supplier@example.test', recipient_email: 'supplier@example.test',
  status: 'PROCESSING', total_records: '10', processed_records: '3', imported_records: '2',
  skipped_records: '1', failed_records: 0, current_step: '2',
  horizon_start: new Date('2026-01-01T00:00:00Z'), horizon_end: '2026-10-26',
  rating: '4.2', raw: { source: 'workbook' }, has_po_history: 1, is_new_category_suggestion: '1',
  ai_minor_categories: ['Valves'], ai_relevant_products: ['Pumps'], buyer_minor_categories: ['Pipes'],
  total_spend: '1000', po_count: '4', attempt_count: '2',
};

beforeEach(() => {
  jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(pool, 'rows').mockResolvedValue([RECORD]);
  jest.spyOn(pool, 'query').mockResolvedValue({ rows: [RECORD], rowCount: 1 });
  bridge.getD1Binding.mockReturnValue(null);
  bridge.getD1HttpClient.mockReturnValue(null);
  bridge.batchD1.mockReset();
});

afterEach(() => { jest.restoreAllMocks(); });

describe('ingestion value conversion', () => {
  test.each([
    [null, '', null, null], [undefined, '', null, null], ['', '', null, null],
    [' 42 ', '42', '42', 42], ['bad', 'bad', 'bad', null], [Infinity, 'Infinity', 'Infinity', null],
  ])('normalizes %p while preserving missing numeric values', (value, text, nullable, numeric) => {
    expect(queries.text(value)).toBe(text);
    expect(queries.nullable(value)).toBe(nullable);
    expect(queries.numeric(value)).toBe(numeric);
  });

  test('parses counters, dates and defensive JSON arrays', () => {
    expect(queries.counter('4')).toBe(4);
    expect(queries.counter('not numeric')).toBe(0);
    expect(queries.dateOnly(null)).toBeNull();
    expect(queries.dateOnly(new Date('2026-10-26T12:00:00Z'))).toBe('2026-10-26');
    expect(queries.dateOnly('2026-10-26T12:00:00Z')).toBe('2026-10-26');
    expect(queries.jsonArray(['Pumps', '', ' ', null, 2, ' Valves '])).toEqual(['Pumps', ' Valves ']);
    expect(queries.jsonArray('[]')).toEqual([]);
    expect(queries.newId('row')).toMatch(/^row-[\da-f-]{36}$/);
  });

  test.each([
    ['  Apex, Supplies Pvt Ltd Co. ', 'apex supplies'], ['', ''], [null, ''],
    ['ACME & Sons Limited', 'acme sons'], ['Limited', 'limited'], ['Distinct Valve', 'distinct valve'],
  ])('normalizes vendor name %p without merging meaningful words', (input, expected) => {
    expect(queries.normalizeVendorName(input)).toBe(expected);
  });

  test('makes email send identities case insensitive and category scoped', () => {
    expect(queries.buildIdempotencyKey({ organizationId: ORG, template: 'mapping', recipientEmail: ' Supplier@Example.test ', majorCategory: ' VALVES ' }))
      .toBe(`${ORG}|mapping|supplier@example.test|valves`);
    expect(queries.buildIdempotencyKey({ organizationId: ORG, template: 'mapping' })).toBe(`${ORG}|mapping||`);
  });

  test('maps every stored entity without inventing values for absent fields', () => {
    expect(queries.mapRowToSession(RECORD)).toMatchObject({ organizationId: ORG, currentStep: 2, horizonStart: '2026-01-01', meta: { source: 'workbook' } });
    expect(queries.mapRowToSession({})).toMatchObject({ currentStep: 0, meta: {}, horizonStart: null });
    expect(queries.mapRowToVendorMaster(RECORD)).toMatchObject({ companyName: 'Supplier Ltd.', vendorCode: 'V-1', rating: 4.2 });
    expect(queries.mapRowToMapping(RECORD)).toMatchObject({ hasPoHistory: true, isNewCategorySuggestion: true, totalSpend: 1000, aiSuggestion: { minorCategories: ['Valves'] } });
    expect(queries.mapRowToMapping({ has_po_history: true, is_new_category_suggestion: false })).toMatchObject({ hasPoHistory: true, isNewCategorySuggestion: false });
    expect(queries.mapRowToMapping({ has_po_history: '1', is_new_category_suggestion: 0 })).toMatchObject({ hasPoHistory: true, isNewCategorySuggestion: false });
    expect(queries.mapRowToMapping({})).toMatchObject({ hasPoHistory: false, aiSuggestion: { minorCategories: [], relevantProducts: [], confidence: null } });
    expect(queries.mapRowToDispatch(RECORD)).toMatchObject({ organizationId: ORG, sentCount: 0 });
    expect(queries.mapRowToEmailLog(RECORD)).toMatchObject({ organizationId: ORG, attemptCount: 2, recipientEmail: 'supplier@example.test' });
    expect(queries.mapRowToIngestionJob(null)).toBeNull();
    expect(queries.mapRowToIngestionJob(RECORD)).toMatchObject({ totalRecords: 10, processedRecords: 3, errorMessage: null, errorDetails: null });
    expect(queries.mapRowToIngestionJob({ error_message: 'parse error', error_details: { row: 1 } })).toMatchObject({ errorMessage: 'parse error', errorDetails: { row: 1 } });
  });
});

const SCOPED_READS = [
  ['findSession', [], null], ['updateSession', [], null], ['findIngestionJob', [], null],
  ['updateIngestionJobProgress', [], null], ['findLatestIngestionJob', [], null], ['findActiveIngestionJobs', [], []],
  ['bulkUpsertVendorMasterRecords', [[{}]], []], ['findVendorMasterRecords', [], []],
  ['findVendorMasterRecord', [], null], ['countVendorMasterRecords', [], 0], ['deleteVendorMasterRecords', [], 0],
  ['bulkInsertPoLineItems', [[{}]], 0], ['countPoLineItems', [], { total: 0, inHorizon: 0, outsideHorizon: 0 }],
  ['deletePoLineItems', [], 0], ['matchPoLineItemsToVendors', [], { byVendorCode: 0, byGstin: 0, byName: 0, unmatched: 0 }],
  ['findVendorPurchasingProfiles', [], []], ['findUnmatchedPoVendors', [], []], ['seedCategoryMappings', [[{}]], []],
  ['findCategoryMappings', [], []], ['findCategoryMappingByVendorRecord', ['vendor'], null],
  ['findQueuedCategoryMappings', [], []], ['markMappingProcessing', [], null], ['saveAiSuggestion', [{}], null],
  ['markMappingFailed', [], null], ['requeueMapping', [], null], ['saveBuyerReview', [{}], null], ['attachVendorId', [], null],
  ['findCategorySegmentation', [], []], ['finalizeDispatch', [{}], null], ['findDispatches', [], []],
  ['markEmailSent', [], null], ['markEmailFailed', [], null], ['findEmailLogs', [], []], ['findAiClassificationLogs', [], []],
];

describe('organization and storage boundaries', () => {
  test.each(SCOPED_READS)('%s refuses absent storage and either missing scope key', async (name, extra, expected) => {
    pool.hasStorage.mockReturnValue(false);
    expect(await queries[name](SESSION, ORG, ...extra)).toEqual(expected);
    pool.hasStorage.mockReturnValue(true);
    expect(await queries[name](null, ORG, ...extra)).toEqual(expected);
    expect(await queries[name](SESSION, null, ...extra)).toEqual(expected);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.rows).not.toHaveBeenCalled();
  });

  test.each([
    ['findSessionById', [SESSION], null], ['findLatestSession', [ORG], null],
    ['findOrganizationCategoryMaster', [ORG], []], ['findApprovedMappingsForOrganization', [ORG], []],
    ['findEmailLogsByIdempotencyKeys', [ORG, ['key']], []], ['findAuditEntries', [ORG], []],
  ])('%s refuses absent storage and an empty primary scope', async (name, args, expected) => {
    pool.hasStorage.mockReturnValue(false);
    expect(await queries[name](...args)).toEqual(expected);
    pool.hasStorage.mockReturnValue(true);
    expect(await queries[name](null, ...args.slice(1))).toEqual(expected);
    expect(pool.rows).not.toHaveBeenCalled();
  });

  test('requires a vendor record before looking up a category mapping and requires idempotency keys', async () => {
    expect(await queries.findCategoryMappingByVendorRecord(SESSION, ORG, null)).toBeNull();
    expect(await queries.findEmailLogsByIdempotencyKeys(ORG)).toEqual([]);
    expect(await queries.bulkUpsertVendorMasterRecords(SESSION, ORG)).toEqual([]);
    expect(await queries.bulkInsertPoLineItems(SESSION, ORG)).toBe(0);
    expect(await queries.seedCategoryMappings(SESSION, ORG)).toEqual([]);
    expect(pool.rows).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each(['insertSession', 'insertDispatch', 'claimEmailSlot', 'insertAuditEntry', 'insertAiClassificationLog'])('%s returns null with no configured storage', async (name) => {
    pool.hasStorage.mockReturnValue(false);
    expect(await queries[name]({})).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('keeps a local progress job available without storage, but never makes a database request', async () => {
    pool.hasStorage.mockReturnValue(false);
    expect(await queries.createIngestionJob({ sessionId: SESSION, organizationId: ORG, jobType: 'PO', fileName: 'po.xlsx' }))
      .toMatchObject({ id: expect.stringMatching(/^job-/), totalRecords: 0, processedRecords: 0, status: 'PROCESSING' });
    pool.hasStorage.mockReturnValue(true);
    expect(await queries.createIngestionJob({ organizationId: ORG, totalRecords: 3 })).toMatchObject({ totalRecords: 3 });
    expect(await queries.createIngestionJob({ sessionId: SESSION })).toMatchObject({ sessionId: SESSION });
    expect(pool.rows).not.toHaveBeenCalled();
  });
});

describe('sessions and background job persistence', () => {
  test.each([null, { type: 'custom', startDate: '2026-01-01', endDate: '2026-10-26' }])('creates sessions with an optional validated horizon %p', async (horizon) => {
    expect(await queries.insertSession({ organizationId: ORG, userId: ' user ', userEmail: ' email@example.test ', horizon })).toEqual(queries.mapRowToSession(RECORD));
    const [sql, params, options] = pool.query.mock.calls[0];
    expect(sql).toContain('returning *');
    expect(params.slice(1, 4)).toEqual([ORG, 'user', 'email@example.test']);
    expect(params.slice(6, 9)).toEqual(horizon ? ['custom', horizon.startDate, horizon.endDate] : [null, null, null]);
    expect(options).toEqual({ d1: true });
    pool.query.mockResolvedValue({ rows: [] });
    expect(await queries.insertSession({ organizationId: ORG })).toBeNull();
  });

  test.each([
    ['findSession', [SESSION, ORG]], ['findSessionById', [SESSION]], ['findLatestSession', [ORG]],
    ['findIngestionJob', ['job', ORG]], ['findLatestIngestionJob', [SESSION, ORG]],
  ])('%s returns a typed row or null for a missing record', async (name, args) => {
    const result = await queries[name](...args);
    expect(result).toMatchObject({ id: RECORD.id, organizationId: ORG });
    expect(pool.rows.mock.calls[0][1]).toEqual(args);
    pool.rows.mockResolvedValue([]);
    expect(await queries[name](...args)).toBeNull();
  });

  test('updates only whitelisted session fields and reads unchanged sessions for an empty patch', async () => {
    expect(await queries.updateSession(SESSION, ORG)).toEqual(queries.mapRowToSession(RECORD));
    expect(pool.query).not.toHaveBeenCalled();
    const patch = Object.fromEntries(queries.SESSION_COLUMN_MAP.map(({ field }) => [field, field === 'currentStep' ? 3 : field]));
    patch.organizationId = 'other-organization';
    await queries.updateSession(SESSION, ORG, patch);
    const [sql, values, options] = pool.query.mock.calls[0];
    expect(values.slice(-2)).toEqual([SESSION, ORG]);
    expect(values).not.toContain('other-organization');
    expect(sql).toContain('organization_id = $21');
    expect(options.d1Text).toContain('strftime');
    pool.query.mockResolvedValue({ rows: [] });
    expect(await queries.updateSession(SESSION, ORG, { currentStep: null })).toBeNull();
  });

  test('creates a database-backed job and applies progress with serialized optional error details', async () => {
    expect(await queries.createIngestionJob({ sessionId: SESSION, organizationId: ORG, jobType: 'PO', fileName: 'po.xlsx', totalRecords: 100 }))
      .toEqual(queries.mapRowToIngestionJob(RECORD));
    expect(pool.rows.mock.calls[0][1].slice(1)).toEqual([SESSION, ORG, 'PO', 'po.xlsx', 100]);
    pool.rows.mockResolvedValueOnce([]);
    expect(await queries.createIngestionJob({ sessionId: SESSION, organizationId: ORG })).toBeNull();
    expect(await queries.updateIngestionJobProgress('job', ORG)).toEqual(queries.mapRowToIngestionJob(RECORD));
    const patch = { totalRecords: 20, processedRecords: 10, importedRecords: 7, skippedRecords: 2, failedRecords: 1, status: 'FAILED', errorMessage: 'bad row', errorDetails: { row: 7 }, completedAt: '2026-10-26' };
    await queries.updateIngestionJobProgress('job', ORG, patch);
    expect(pool.query.mock.calls[0][1]).toEqual([20, 10, 7, 2, 1, 'FAILED', 'bad row', '{"row":7}', '2026-10-26', 'job', ORG]);
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await queries.updateIngestionJobProgress('job', ORG, { errorDetails: null })).toBeNull();
    expect(pool.query.mock.calls[1][1]).toEqual([null, 'job', ORG]);
    await queries.findLatestIngestionJob(SESSION, ORG, 'PO');
    expect(pool.rows.mock.calls.at(-1)[1]).toEqual([SESSION, ORG, 'PO']);
    expect(await queries.findActiveIngestionJobs(SESSION, ORG)).toEqual([queries.mapRowToIngestionJob(RECORD)]);
  });
});

describe('vendor master and purchase order bulk writes', () => {
  const vendorRows = [
    { sourceRowNumber: 4, vendorCode: ' V1 ', companyName: 'ACME Pvt Ltd', email: ' SUPPLIER@EXAMPLE.TEST ', gstin: ' gst1 ', rating: '4.5', raw: { workbook: 1 } },
    { companyName: 'Other', gstNumber: ' gst2 ' }, {},
  ];
  const poRows = [
    { sourceRowNumber: 2, poNumber: 'PO1', poDate: '2026-01-01', vendorCode: 'V1', vendorName: 'ACME Ltd', vendorGstin: ' gst1 ', quantity: '3', spend: '120', inHorizon: false },
    { vendorName: 'Second', gstNumber: ' gst2 ' }, {},
  ];
  const profiles = [
    { vendorRecordId: 'master-1', vendorCode: 'V1', companyName: 'Company', email: ' SUPPLIER@EXAMPLE.TEST ', poCount: 3, totalSpend: 100, hasPoHistory: true, departments: ['Purchase'], existingCategories: ['Valves'] },
    { vendorRecordId: 'master-2', companyName: 'New Vendor', hasPoHistory: false },
  ];

  test.each(['postgres', 'binding', 'http'])('upserts normalized vendor identifiers through %s', async (storage) => {
    if (storage === 'binding') bridge.getD1Binding.mockReturnValue({ name: 'binding' });
    if (storage === 'http') bridge.getD1HttpClient.mockReturnValue({ name: 'http' });
    bridge.batchD1.mockResolvedValue([{ rows: [RECORD] }, {}]);
    expect(await queries.bulkUpsertVendorMasterRecords(SESSION, ORG, vendorRows)).toEqual([queries.mapRowToVendorMaster(RECORD)]);
    if (storage === 'postgres') {
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('on conflict (session_id, vendor_code)');
      expect(params).toHaveLength(42);
      expect(params.slice(1, 7)).toEqual([SESSION, ORG, 4, 'V1', 'ACME Pvt Ltd', 'acme']);
      expect(params[8]).toBe('supplier@example.test');
      expect(params[11]).toBe('GST1');
      expect(params[25]).toBe('GST2');
    } else {
      const statements = bridge.batchD1.mock.calls[0][1];
      expect(statements).toHaveLength(3);
      expect(statements[0].params.slice(1, 3)).toEqual([SESSION, ORG]);
      expect(statements[1].params[11]).toBe('GST2');
      expect(statements[2].params[8]).toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    }
  });

  test.each(['postgres', 'd1'])('inserts PO lines preserving nullable measures and horizon flags on %s', async (storage) => {
    if (storage === 'd1') bridge.getD1Binding.mockReturnValue({});
    bridge.batchD1.mockResolvedValue([{ rowCount: 2 }, { rows: [RECORD] }, {}]);
    expect(await queries.bulkInsertPoLineItems(SESSION, ORG, poRows)).toBe(storage === 'd1' ? 4 : 1);
    const params = storage === 'd1' ? bridge.batchD1.mock.calls[0][1][0].params : pool.query.mock.calls[0][1];
    expect(params.slice(1, 5)).toEqual([SESSION, ORG, 2, 'PO1']);
    expect(params.slice(8, 10)).toEqual(['acme', 'GST1']);
    expect(params[12]).toBe(3);
    expect(params[20]).toBe(storage === 'd1' ? 0 : false);
    if (storage === 'postgres') {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      expect(await queries.bulkInsertPoLineItems(SESSION, ORG, [{}])).toBe(0);
    } else {
      const all = bridge.batchD1.mock.calls[0][1];
      expect(all[1].params[9]).toBe('GST2');
      expect(all[2].params[8]).toBeNull();
      expect(all[2].params[20]).toBe(1);
    }
  });

  test.each(['postgres', 'd1'])('seeds suppliers with history for AI and suppliers without history for self mapping on %s', async (storage) => {
    if (storage === 'd1') bridge.getD1Binding.mockReturnValue({});
    bridge.batchD1.mockResolvedValue([{ rows: [RECORD] }, {}]);
    expect(await queries.seedCategoryMappings(SESSION, ORG, profiles)).toEqual([queries.mapRowToMapping(RECORD)]);
    const params = storage === 'd1' ? bridge.batchD1.mock.calls[0][1][0].params : pool.query.mock.calls[0][1];
    expect(params.slice(1, 4)).toEqual([SESSION, ORG, 'master-1']);
    expect(params.slice(10, 12)).toEqual([VENDOR_MAPPING_STATUS.PENDING_REVIEW, VENDOR_AI_PROCESSING_STATUS.QUEUED]);
    const noHistory = storage === 'd1' ? bridge.batchD1.mock.calls[0][1][1].params : params.slice(13);
    expect(noHistory.slice(10, 12)).toEqual([VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED, VENDOR_AI_PROCESSING_STATUS.COMPLETED]);
    expect(noHistory[12]).toBe('{"departments":[],"existingCategories":[]}');
  });

  test.each([
    ['bulkUpsertVendorMasterRecords', 101, 50], ['bulkInsertPoLineItems', 81, 40], ['seedCategoryMappings', 101, 50],
  ])('%s splits large batches into bounded SQL statements', async (name, count, batchSize) => {
    const result = await queries[name](SESSION, ORG, Array.from({ length: count }, () => ({})));
    expect(pool.query).toHaveBeenCalledTimes(3);
    const stride = name === 'bulkUpsertVendorMasterRecords' ? 14 : name === 'bulkInsertPoLineItems' ? 21 : 13;
    expect(pool.query.mock.calls.map(([, values]) => values.length)).toEqual([batchSize * stride, batchSize * stride, stride]);
    expect(name === 'bulkInsertPoLineItems' ? result : result.length).toBe(3);
  });
});

describe('scoped reads, limits and deletion results', () => {
  test('groups only nonempty taxonomy divisions and deduplicates minor categories', async () => {
    pool.rows.mockResolvedValue([
      { division: ' Engineering ', category: ' Pumps ' }, { division: 'Engineering', category: 'Pumps' },
      { division: 'Engineering', category: 'Valves' }, { division: 'Services', category: null }, { division: ' ', category: 'Ignored' },
    ]);
    expect(await queries.findOrganizationCategoryMaster(ORG)).toEqual([
      { majorCategory: 'Engineering', minorCategories: ['Pumps', 'Valves'] }, { majorCategory: 'Services', minorCategories: [] },
    ]);
    expect(pool.rows.mock.calls[0][1]).toEqual([ORG]);
    expect(pool.rows.mock.calls[0][2]).toMatchObject({ tag: 'taxonomy', useCache: true });
  });

  test.each(['findVendorMasterRecords', 'findCategoryMappings'])('%s binds bounded integer limits and falls back for invalid limits', async (name) => {
    for (const limit of [undefined, 'no', -1, 1.5, 25, 9999]) {
      const result = await queries[name](SESSION, ORG, limit);
      expect(result).toHaveLength(1);
      expect(pool.rows.mock.calls.at(-1)[1]).toEqual(typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? [SESSION, ORG, Math.min(limit, 2000)] : [SESSION, ORG]);
    }
  });

  test.each([
    ['findVendorMasterRecord', [SESSION, ORG]], ['findCategoryMappingByVendorRecord', [SESSION, ORG, 'master']],
  ])('%s distinguishes missing rows from mapped records without broadening the organization', async (name, args) => {
    expect(await queries[name](...args)).toMatchObject({ id: RECORD.id, organizationId: ORG });
    expect(pool.rows.mock.calls[0][1]).toEqual(args);
    pool.rows.mockResolvedValue([]);
    expect(await queries[name](...args)).toBeNull();
  });

  test('reads master and horizon counts and handles absent aggregate rows', async () => {
    pool.rows.mockResolvedValue([{ total: '8', in_horizon: '6', outside_horizon: '2' }]);
    expect(await queries.countVendorMasterRecords(SESSION, ORG)).toBe(8);
    expect(await queries.countPoLineItems(SESSION, ORG)).toEqual({ total: 8, inHorizon: 6, outsideHorizon: 2 });
    pool.rows.mockResolvedValue([]);
    expect(await queries.countVendorMasterRecords(SESSION, ORG)).toBe(0);
    expect(await queries.countPoLineItems(SESSION, ORG)).toEqual({ total: 0, inHorizon: 0, outsideHorizon: 0 });
  });

  test.each(['deleteVendorMasterRecords', 'deletePoLineItems'])('%s returns the affected count and keeps the organization predicate', async (name) => {
    expect(await queries[name](SESSION, ORG)).toBe(1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('organization_id = $2'), [SESSION, ORG], { d1: true });
    pool.query.mockResolvedValue({ rows: [] });
    expect(await queries[name](SESSION, ORG)).toBe(0);
  });

  test('matches PO data in identifier priority order and reports each outcome', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 20 }).mockResolvedValueOnce({ rowCount: 5 })
      .mockResolvedValueOnce({ rowCount: 3 }).mockResolvedValueOnce({ rowCount: 2 }).mockResolvedValueOnce({ rowCount: 1 });
    expect(await queries.matchPoLineItemsToVendors(SESSION, ORG)).toEqual({ byVendorCode: 5, byGstin: 3, byName: 2, unmatched: 1 });
    expect(pool.query.mock.calls.map(([, params]) => params)).toEqual([
      [SESSION, ORG], [SESSION, ORG, VENDOR_MATCH_STRATEGY.VENDOR_CODE], [SESSION, ORG, VENDOR_MATCH_STRATEGY.GSTIN],
      [SESSION, ORG, VENDOR_MATCH_STRATEGY.NORMALIZED_NAME], [SESSION, ORG, VENDOR_MATCH_STRATEGY.UNMATCHED],
    ]);
    pool.query.mockResolvedValue({});
    expect(await queries.matchPoLineItemsToVendors(SESSION, ORG)).toEqual({ byVendorCode: 0, byGstin: 0, byName: 0, unmatched: 0 });
  });

  test('maps Postgres and D1 purchasing profiles, limits descriptions, and retains vendors with no history', async () => {
    pool.rows.mockResolvedValue([
      { ...RECORD, vendor_record_id: 'master', po_line_count: '2', departments: ['Purchase', ''], existing_categories: ['Valves', null], line_summaries: ['First', 'Second', 'Third'] },
      { ...RECORD, po_line_count: 1, departments: '["Engineering",null]', existing_categories: '["Mechanical",""]', line_parts: JSON.stringify([{ desc: 'Pump', spec: 'SS', qty: 2, uom: 'Nos' }, {}, { desc: 'Valve' }]) },
      {},
    ]);
    const result = await queries.findVendorPurchasingProfiles(SESSION, ORG, { descriptionLimit: 2 });
    expect(result[0]).toMatchObject({ vendorRecordId: 'master', hasPoHistory: true, departments: ['Purchase'], existingCategories: ['Valves'], lineSummaries: ['First', 'Second'] });
    expect(result[1]).toMatchObject({ departments: ['Engineering'], existingCategories: ['Mechanical'], lineSummaries: ['Pump | SS | 2 Nos', 'Valve'] });
    expect(result[2]).toMatchObject({ hasPoHistory: false, lineSummaries: [], totalSpend: 0 });
    await queries.findVendorPurchasingProfiles(SESSION, ORG);
    expect(pool.rows.mock.calls.at(-1)[0]).toContain(`[1:${VENDOR_INGESTION_CONFIG.AI_MAX_PO_LINES_PER_VENDOR}]`);
    expect(await queries.findUnmatchedPoVendors(SESSION, ORG)).toEqual(expect.arrayContaining([expect.objectContaining({ totalSpend: 1000, poLineCount: 2 })]));
  });
});

describe('mapping decisions and summaries', () => {
  test.each([
    ['markMappingProcessing', []], ['markMappingFailed', [' failed parsing ']], ['requeueMapping', []],
    ['saveAiSuggestion', [{ majorCategory: 'Engineering', minorCategories: ['Valves'], relevantProducts: ['Pumps'], confidence: 95, isNewCategorySuggestion: true }]],
    ['saveBuyerReview', [{ majorCategory: 'Engineering', minorCategories: ['Pipes'], reviewedBy: 'buyer' }]], ['attachVendorId', ['vendor']],
  ])('%s returns a mapped row and null when nothing belongs to the organization', async (name, extra) => {
    expect(await queries[name]('mapping', ORG, ...extra)).toEqual(queries.mapRowToMapping(RECORD));
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('where id = $1 and organization_id = $2');
    expect(params.slice(0, 2)).toEqual(['mapping', ORG]);
    if (name === 'saveAiSuggestion') {
      expect(sql).not.toContain('buyer_major_category =');
      expect(params[3]).toBe('["Valves"]');
    }
    if (name === 'saveBuyerReview') expect(sql).not.toContain('ai_major_category =');
    pool.query.mockResolvedValue({ rows: [] });
    expect(await queries[name]('mapping', ORG, ...extra)).toBeNull();
  });

  test('stores missing AI and review arrays as empty arrays', async () => {
    await queries.saveAiSuggestion('mapping', ORG, {});
    expect(pool.query.mock.calls[0][1].slice(2, 6)).toEqual([null, '[]', '[]', null]);
    await queries.saveBuyerReview('mapping', ORG, {});
    expect(pool.query.mock.calls[1][1].slice(2, 4)).toEqual([null, '[]']);
  });

  test('reads queued mappings and approved mappings with defaults and bounded limits', async () => {
    expect(await queries.findQueuedCategoryMappings(SESSION, ORG)).toEqual([queries.mapRowToMapping(RECORD)]);
    expect(pool.rows.mock.calls.at(-1)[1].at(-1)).toBe(VENDOR_INGESTION_CONFIG.AI_BATCH_SIZE);
    await queries.findQueuedCategoryMappings(SESSION, ORG, 7);
    expect(pool.rows.mock.calls.at(-1)[1].at(-1)).toBe(7);
    for (const limit of [undefined, -1, 'invalid', 5, 2000]) {
      expect(await queries.findApprovedMappingsForOrganization(ORG, limit)).toEqual([queries.mapRowToMapping(RECORD)]);
      expect(pool.rows.mock.calls.at(-1)[1].at(-1)).toBe(typeof limit === 'number' && limit > 0 ? Math.min(limit, 1000) : 500);
    }
  });

  test('summarizes mappings and email counts and returns zeros without rows or scope', async () => {
    pool.rows.mockResolvedValue([{ total: '8', ai_mapped: '2', approved: '3', pending_review: '1', sent: '5', failed: '2' }]);
    expect(await queries.summarizeCategoryMappings(SESSION, ORG)).toMatchObject({ total: 8, mapped: 5, approved: 3, pendingReview: 1, failed: 2, selfMapped: 0 });
    expect(await queries.summarizeEmailLogs(SESSION, ORG)).toMatchObject({ total: 8, sent: 5, failed: 2, queued: 0 });
    pool.rows.mockResolvedValue([]);
    for (const name of ['summarizeCategoryMappings', 'summarizeEmailLogs']) {
      const empty = await queries[name](SESSION, ORG);
      expect(Object.values(empty).every((value) => value === 0)).toBe(true);
      expect(await queries[name](null, ORG)).toEqual(empty);
      expect(await queries[name](SESSION, null)).toEqual(empty);
      pool.hasStorage.mockReturnValue(false);
      expect(await queries[name](SESSION, ORG)).toEqual(empty);
      pool.hasStorage.mockReturnValue(true);
    }
  });

  test('maps category segmentation from native arrays, D1 JSON and missing company groups', async () => {
    pool.rows.mockResolvedValue([
      { major_category: ' Valves ', vendor_count: '2', total_spend: '20', companies: ['A', '', null] },
      { companies: '["B",null]' }, {},
    ]);
    expect(await queries.findCategorySegmentation(SESSION, ORG)).toEqual([
      expect.objectContaining({ majorCategory: 'Valves', vendorCount: 2, totalSpend: 20, companies: ['A'] }),
      expect.objectContaining({ companies: ['B'] }), expect.objectContaining({ companies: [] }),
    ]);
  });
});

describe('dispatch and email idempotency ledger', () => {
  test.each([
    ['insertDispatch', [{ sessionId: SESSION, organizationId: ORG, template: 'mapping', recipientCount: 3 }]],
    ['finalizeDispatch', ['dispatch', ORG, { sentCount: 2, failedCount: 1, skippedCount: 0, status: 'PARTIAL' }]],
    ['claimEmailSlot', [{ sessionId: SESSION, organizationId: ORG, dispatchId: 'dispatch', recipientEmail: ' SUPPLIER@EXAMPLE.TEST ', template: 'mapping' }]],
    ['markEmailSent', ['log', ORG, ' message ']], ['markEmailFailed', ['log', ORG, ' failed ']],
  ])('%s returns the saved ledger entity or null without a returned row', async (name, args) => {
    expect(await queries[name](...args)).toMatchObject({ id: RECORD.id, organizationId: ORG });
    expect(pool.query.mock.calls[0][1]).toContain(ORG);
    pool.query.mockResolvedValue({ rows: [] });
    expect(await queries[name](...args)).toBeNull();
  });

  test('only retries queued or failed idempotent email slots and normalizes recipient identity', async () => {
    await queries.claimEmailSlot({ dispatchId: 'dispatch', sessionId: SESSION, organizationId: ORG, recipientEmail: ' SUPPLIER@EXAMPLE.TEST ', template: 'mapping', majorCategory: 'Valves' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('on conflict (idempotency_key)');
    expect(sql).toContain('where vendor_email_dispatch_log.status in ($12, $13)');
    expect(params[5]).toBe('supplier@example.test');
    expect(params.slice(-3)).toEqual([VENDOR_EMAIL_STATUS.QUEUED, VENDOR_EMAIL_STATUS.FAILED, VENDOR_EMAIL_STATUS.PENDING]);
    await queries.claimEmailSlot({ organizationId: ORG });
    expect(pool.query.mock.calls[1][1][5]).toBe('');
  });

  test('binds all idempotency keys in one lookup with a D1-compatible parameter list', async () => {
    expect(await queries.findEmailLogsByIdempotencyKeys(ORG, ['key1', 'key2'])).toEqual([queries.mapRowToEmailLog(RECORD)]);
    expect(pool.rows).toHaveBeenCalledWith(expect.stringContaining('any($2)'), [ORG, ['key1', 'key2']], {
      d1: true, d1Text: expect.stringContaining('in ($2, $3)'), d1Params: [ORG, 'key1', 'key2'],
    });
  });

  test('reads dispatches and email logs with optional status and bounded result size', async () => {
    expect(await queries.findDispatches(SESSION, ORG)).toEqual([queries.mapRowToDispatch(RECORD)]);
    expect(await queries.findEmailLogs(SESSION, ORG)).toEqual([queries.mapRowToEmailLog(RECORD)]);
    expect(pool.rows.mock.calls.at(-1)[1]).toEqual([SESSION, ORG, 500]);
    await queries.findEmailLogs(SESSION, ORG, { status: 'SENT', limit: 2000 });
    expect(pool.rows.mock.calls.at(-1)[1]).toEqual([SESSION, ORG, 'SENT', 1000]);
  });
});

describe('audit and classification logs', () => {
  test('rejects audit and classification entries missing their required scope', async () => {
    expect(await queries.insertAuditEntry({ action: 'UPDATE' })).toBeNull();
    expect(await queries.insertAuditEntry({ organizationId: ORG })).toBeNull();
    expect(await queries.insertAiClassificationLog({ organizationId: ORG })).toBeNull();
    expect(await queries.insertAiClassificationLog({ sessionId: SESSION })).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([undefined, null, { changed: true }])('serializes audit payloads and preserves optional null values: %p', async (value) => {
    expect(await queries.insertAuditEntry({ sessionId: SESSION, organizationId: ORG, action: 'UPDATE', oldValue: value, newValue: value })).toEqual(RECORD);
    const params = pool.query.mock.calls[0][1];
    expect(params.slice(-2)).toEqual(value ? [JSON.stringify(value), JSON.stringify(value)] : [null, null]);
    pool.query.mockResolvedValue({ rows: [] });
    expect(await queries.insertAuditEntry({ organizationId: ORG, action: 'UPDATE' })).toBeNull();
  });

  test('maps audit values from Postgres objects and D1 JSON while binding paging filters', async () => {
    pool.rows.mockResolvedValue([{ sequence: '2', old_value: '{"old":1}', new_value: '{"new":2}' }, { sequence: 1, old_value: { old: true }, new_value: null }]);
    const results = await queries.findAuditEntries(ORG);
    expect(results[0]).toMatchObject({ sequence: 2, oldValue: { old: 1 }, newValue: { new: 2 } });
    expect(results[1]).toMatchObject({ sequence: 1, oldValue: { old: true }, newValue: null });
    expect(pool.rows.mock.calls[0][1]).toEqual([ORG, 100, 0]);
    await queries.findAuditEntries(ORG, { sessionId: SESSION, limit: 1000, offset: 10 });
    expect(pool.rows.mock.calls.at(-1)[1]).toEqual([ORG, SESSION, 500, 10]);
  });

  test.each([undefined, null, { classified: true }])('records classification metadata and an optional JSON result: %p', async (response) => {
    expect(await queries.insertAiClassificationLog({ sessionId: SESSION, organizationId: ORG, response, attempt: response ? 2 : 0 })).toEqual(RECORD);
    expect(pool.query.mock.calls[0][1][7]).toBe(response ? 2 : 1);
    expect(pool.query.mock.calls[0][1].at(-1)).toBe(response ? JSON.stringify(response) : null);
    pool.query.mockResolvedValue({ rows: [] });
    expect(await queries.insertAiClassificationLog({ sessionId: SESSION, organizationId: ORG })).toBeNull();
  });

  test('maps classification metrics and caps log retrieval', async () => {
    pool.rows.mockResolvedValue([{ id: 'ai-log', vendor_code: ' V1 ', attempt: '2', prompt_chars: '100', po_count: '3', duration_ms: '50', error: null }]);
    expect(await queries.findAiClassificationLogs(SESSION, ORG)).toEqual([expect.objectContaining({ id: 'ai-log', vendorCode: 'V1', attempt: 2, promptChars: 100, poCount: 3, durationMs: 50, error: '' })]);
    expect(pool.rows.mock.calls[0][1]).toEqual([SESSION, ORG, 200]);
    await queries.findAiClassificationLogs(SESSION, ORG, { limit: 1000 });
    expect(pool.rows.mock.calls.at(-1)[1]).toEqual([SESSION, ORG, 500]);
  });
});
