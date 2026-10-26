const service = require('../src/services/vendorCategorizationService');
const gemini = require('../src/services/geminiService');
const queries = require('../src/db/vendorIngestionQueries');
const { logger } = require('../src/services/loggerService');
const { VENDOR_INGESTION_CONFIG: config, VENDOR_MAPPING_STATUS: status } = require('../src/config/constants');

const master = [{ majorCategory: 'Mechanical', minorCategories: ['Pumps', 'Bearings'] }];
const mapping = { id: 'map-1', vendorRecordId: 'vm-1', vendorCode: 'V1', companyName: 'Supplier' };
const profile = {
  vendorCode: 'V1', companyName: 'Supplier', hasPoHistory: true, poCount: 3, poLineCount: 4,
  totalSpend: 500, lineSummaries: ['Pump | 2 ea', 'Pump | 2 ea', 'Bearing | 1 ea'],
  departments: ['Maintenance'], existingCategories: ['Mechanical'], firstPoDate: '2025-01-01', lastPoDate: '2025-12-01',
};
const reply = { primaryCategory: ' mechanical ', minorCategories: ['pumps', 'PUMPS', 'Unknown'], relevantProducts: ['Pump'], confidenceScore: 95, reason: 'Repeated pump purchases.' };
const args = { session: { id: 's1', horizonStart: '2025-01-01', horizonEnd: '2025-12-31' }, organizationId: 'org1', mapping, vendorProfile: profile, categoryMaster: master };

describe('vendor categorization evidence, validation and persistence', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(queries, 'insertAiClassificationLog').mockResolvedValue({ id: 'log' });
    jest.spyOn(queries, 'markMappingProcessing').mockResolvedValue(null);
    jest.spyOn(queries, 'markMappingFailed').mockResolvedValue(null);
    jest.spyOn(queries, 'saveAiSuggestion').mockResolvedValue({ id: 'saved' });
    jest.spyOn(gemini, 'generateJson').mockResolvedValue({ status: gemini.EXTRACTION_STATUS.SUCCESS, data: reply, model: 'test-model' });
  });
  afterEach(() => jest.restoreAllMocks());

  test('normalizes and caps source evidence while retaining frequency', () => {
    expect(service.clampDescription(null)).toBe('');
    expect(service.clampDescription(undefined)).toBe('');
    expect(service.clampDescription(' pump\n  set ')).toBe('pump set');
    expect(service.clampDescription('x'.repeat(config.AI_MAX_DESCRIPTION_CHARS + 1))).toHaveLength(config.AI_MAX_DESCRIPTION_CHARS + 1);
    expect(service.summarizePurchasePattern()).toEqual([]);
    expect(service.summarizePurchasePattern(['', null, 'pump', 'pump', 'bearing'])).toEqual([
      { description: 'pump', occurrences: 2 }, { description: 'bearing', occurrences: 1 },
    ]);
    expect(service.renderCategoryMaster()).toBe('');
    expect(service.renderCategoryMaster([{ majorCategory: 'Other', minorCategories: [null, ''] }, { majorCategory: 'Empty' }])).toContain('(no sub-categories defined)');
    expect(service.renderCategoryMaster(master)).toContain('Pumps; Bearings');
    const prompt = service.buildCategorizationPrompt({ vendorProfile: profile, categoryMaster: master, horizon: { startDate: '2025-01-01', endDate: '2025-12-31' } });
    expect(prompt).toContain('[appears on 2 PO lines]');
    expect(prompt).toContain('2025-01-01 to 2025-12-31');
    expect(prompt).toContain('Maintenance');
    const sparse = service.buildCategorizationPrompt({ vendorProfile: { companyName: 'Sparse', departments: [], existingCategories: [], lineSummaries: [] }, categoryMaster: [] });
    expect(sparse).toContain('not specified');
    expect(sparse).toContain('(unknown)');
    expect(sparse).toContain('(not stated)');
    expect(sparse).toContain('(none in the source data)');
    expect(service.buildCategorizationPrompt({ vendorProfile: { companyName: 'Sparse' }, categoryMaster: [], horizon: {} })).toContain('(none)');
  });

  test('canonicalizes master categories and filters invalid or repeated strings', () => {
    expect(service.categoryKey(null)).toBe('');
    expect(service.categoryKey(undefined)).toBe('');
    expect(service.categoryKey(' A   B ')).toBe('a b');
    expect(service.indexCategoryMaster().size).toBe(0);
    const indexed = service.indexCategoryMaster([{ majorCategory: '' }, { majorCategory: ' A ', minorCategories: [null, '', ' X '] }, { majorCategory: 'B' }]);
    expect(indexed.get('a').minors.get('x')).toBe('X');
    expect(indexed.get('b').minors.size).toBe(0);
    expect(service.cleanStringList(null, 2)).toEqual([]);
    expect(service.cleanStringList([null, 1, '', ' A  B ', 'a b', 'C', 'D'], 2)).toEqual(['A B', 'C']);
  });

  test.each([[-1, 0], [101, 100], ['bad', null], [45.6, 46]])('normalizes confidence %p', (input, expected) => {
    expect(service.normalizeConfidence(input)).toBe(expected);
  });
  test.each([[null, 'NEEDS_REVIEW'], [undefined, 'NEEDS_REVIEW'], [0, 'NEEDS_REVIEW'], [70, 'MEDIUM'], [100, 'HIGH']])('bands confidence %p', (input, expected) => {
    expect(service.confidenceBand(input)).toBe(expected);
  });
  test.each([null, 'text', [], {}, { primaryCategory: 2 }])('rejects invalid response %p', (input) => {
    expect(service.validateAiResult(input).valid).toBe(false);
  });
  test('keeps only canonical minor categories and requires review at low confidence', () => {
    expect(service.validateAiResult(reply, { categoryMaster: master })).toMatchObject({ valid: true, suggestion: { majorCategory: 'Mechanical', minorCategories: ['Pumps'], status: status.AI_MAPPED } });
    expect(service.validateAiResult({ ...reply, confidenceScore: 'bad', reason: 3 }, { categoryMaster: master })).toMatchObject({ suggestion: { confidence: null, reason: '', status: status.PENDING_REVIEW } });
    expect(service.validateAiResult({ primaryCategory: 'Other' })).toMatchObject({ suggestion: { isNewCategorySuggestion: true, suggestedNewCategory: 'Other' } });
  });
  test.each(['Custom service', undefined, 123])('explicit new-category suggestion remains pending human approval (%p)', (suggestedNewCategory) => {
    expect(service.validateAiResult({ ...reply, primaryCategory: service.NEW_CATEGORY_SENTINEL, suggestedNewCategory })).toMatchObject({ valid: true, suggestion: { majorCategory: '', minorCategories: [], isNewCategorySuggestion: true, suggestedNewCategory: typeof suggestedNewCategory === 'string' ? suggestedNewCategory : '' } });
  });
  test.each([null, { hasPoHistory: false }])('never sends suppliers without PO evidence to the model', async (vendorProfile) => {
    expect(await service.classifyVendor({ ...args, vendorProfile })).toMatchObject({ status: service.CLASSIFICATION_STATUS.NO_CONTENT });
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });
  test('refuses an empty category master', async () => {
    expect(await service.classifyVendor({ ...args, categoryMaster: [] })).toMatchObject({ status: service.CLASSIFICATION_STATUS.NO_CONTENT });
  });
  test('does not retry missing configuration', async () => {
    gemini.generateJson.mockResolvedValue({ status: gemini.EXTRACTION_STATUS.NOT_CONFIGURED });
    expect(await service.classifyVendor(args)).toMatchObject({ status: service.CLASSIFICATION_STATUS.NOT_CONFIGURED });
    expect(gemini.generateJson).toHaveBeenCalledTimes(1);
    expect(queries.insertAiClassificationLog).toHaveBeenCalledWith(expect.objectContaining({ status: service.CLASSIFICATION_STATUS.NOT_CONFIGURED, model: null }));
  });
  test('retries transport and shape failures before accepting a canonical response', async () => {
    gemini.generateJson.mockResolvedValueOnce({ status: 'ERROR', error: 'offline' }).mockResolvedValueOnce({ status: gemini.EXTRACTION_STATUS.SUCCESS, data: {} });
    const result = await service.classifyVendor(args);
    if (config.AI_MAX_ATTEMPTS > 2) expect(result).toMatchObject({ status: service.CLASSIFICATION_STATUS.SUCCESS, attempt: 3 });
    else expect(result.status).toBe(service.CLASSIFICATION_STATUS.INVALID_RESPONSE);
    expect(queries.insertAiClassificationLog).toHaveBeenCalledWith(expect.objectContaining({ status: service.CLASSIFICATION_STATUS.INVALID_RESPONSE, response: {} }));
  });
  test.each([{ status: 'ERROR' }, { status: gemini.EXTRACTION_STATUS.SUCCESS, data: null }])('exhausts retry budget for %p', async (response) => {
    gemini.generateJson.mockResolvedValue(response);
    expect(await service.classifyVendor({ ...args, mapping: { ...mapping, vendorCode: '' } })).toMatchObject({ status: service.CLASSIFICATION_STATUS.AI_FAILED });
    expect(gemini.generateJson).toHaveBeenCalledTimes(config.AI_MAX_ATTEMPTS);
  });
  test('audit failures do not discard classification results', async () => {
    queries.insertAiClassificationLog.mockRejectedValue(new Error('audit unavailable'));
    expect(await service.classifyVendor(args)).toMatchObject({ status: service.CLASSIFICATION_STATUS.SUCCESS, suggestion: { model: 'test-model', source: 'AI' } });
    expect(logger.error).toHaveBeenCalled();
    await service.logClassification({ session: { id: 's1' }, prompt: null, vendorProfile: null, mapping });
  });
  test('processes each mapping sequentially and persists successes and failures separately', async () => {
    const noHistory = { ...mapping, id: 'map-2', vendorRecordId: 'vm-2' };
    const unknown = { ...mapping, id: 'map-3', vendorRecordId: 'vm-3' };
    gemini.generateJson.mockResolvedValueOnce({ status: gemini.EXTRACTION_STATUS.SUCCESS, data: reply }).mockResolvedValueOnce({ status: gemini.EXTRACTION_STATUS.SUCCESS, data: { ...reply, primaryCategory: 'Unknown' } });
    const outcomes = await service.runCategorizationBatch({ ...args, mappings: [mapping, noHistory, unknown], profilesByRecordId: new Map([['vm-1', profile], ['vm-3', profile]]) });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['SUCCESS', 'NO_CONTENT', 'SUCCESS']);
    expect(queries.markMappingProcessing).toHaveBeenCalledTimes(3);
    expect(queries.saveAiSuggestion).toHaveBeenCalledTimes(2);
    expect(queries.markMappingFailed).toHaveBeenCalledWith('map-2', 'org1', expect.any(String));
    expect(await service.runCategorizationBatch({ ...args, mappings: [], profilesByRecordId: new Map() })).toEqual([]);
  });
});
