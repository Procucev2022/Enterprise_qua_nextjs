const service = require('../src/services/vendorIngestionService');
const queries = require('../src/db/vendorIngestionQueries');
const buyerProfiles = require('../src/db/buyerProfileQueries');
const mailer = require('../src/services/mailerService');
const store = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');
const {
  VENDOR_MAPPING_STATUS: mappingStatus,
  VENDOR_DISPATCH_TEMPLATE: templates,
  VENDOR_EMAIL_STATUS: emailStatus,
  VENDOR_DISPATCH_STATUS: dispatchStatus,
  VENDOR_INGESTION_CONFIG: config,
  VENDOR_INGESTION_MESSAGES: messages,
} = require('../src/config/constants');

jest.mock('../src/db/vendorIngestionQueries');
jest.mock('../src/db/buyerProfileQueries');
jest.mock('../src/services/mailerService');
jest.mock('../src/services/storeService');
jest.mock('../src/services/loggerService', () => ({ logger: { audit: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

const user = { sub: 'buyer-1', email: 'buyer@example.com' };
const context = { userId: user.sub, email: user.email, organizationId: 'org-1', organizationName: 'Buyer company' };
const sessionId = 'session-1';
const mapping = {
  id: 'mapping-1', vendorRecordId: 'record-1', vendorId: 'vendor-1',
  companyName: 'Apex Supplies', email: 'vendor@example.com', vendorCode: 'VC-1',
  status: mappingStatus.BUYER_APPROVED, source: 'AI', hasPoHistory: true,
  buyerMajorCategory: 'Electrical', buyerMinorCategories: ['Copper'],
  aiSuggestion: { majorCategory: 'Electrical', minorCategories: ['Copper'], confidence: 95, reason: 'Purchase history' },
  totalSpend: 1000, poCount: 2,
};
const vendorRecord = { id: mapping.vendorRecordId, contactPerson: 'Vendor contact', phone: '9876543210', address: 'Pune', gstin: '27ABCDE1234F1Z5' };

beforeEach(() => {
  jest.resetAllMocks();
  buyerProfiles.findProfileByUserId.mockResolvedValue({ found: true, profile: {
    userId: context.userId, organizationId: context.organizationId, companyName: context.organizationName, contactEmail: context.email,
  } });
  queries.findSession.mockResolvedValue({ id: sessionId, currentStep: 4 });
  queries.findCategoryMappingByVendorRecord.mockResolvedValue(mapping);
  queries.findVendorMasterRecord.mockResolvedValue(vendorRecord);
  queries.findVendorMasterRecords.mockResolvedValue([vendorRecord]);
  queries.findCategoryMappings.mockResolvedValue([mapping]);
  queries.findOrganizationCategoryMaster.mockResolvedValue([{ majorCategory: 'Electrical', minorCategories: ['Copper', 'Switches'] }]);
  queries.saveBuyerReview.mockImplementation(async (id, org, review) => ({
    ...mapping, id, buyerMajorCategory: review.majorCategory, buyerMinorCategories: review.minorCategories, status: review.status,
  }));
  queries.summarizeCategoryMappings.mockResolvedValue({ total: 1 });
  queries.findEmailLogsByIdempotencyKeys.mockResolvedValue([]);
  queries.buildIdempotencyKey.mockImplementation(({ template, recipientEmail }) => `${template}:${recipientEmail}`);
  queries.insertDispatch.mockResolvedValue({ id: 'dispatch-1' });
  queries.claimEmailSlot.mockResolvedValue({ id: 'slot-1' });
  queries.finalizeDispatch.mockImplementation(async (id, org, totals) => ({ id, ...totals }));
  queries.updateSession.mockResolvedValue({ id: sessionId, currentStep: 5 });
  queries.summarizeEmailLogs.mockResolvedValue({ sent: 1, failed: 0 });
  queries.findEmailLogs.mockResolvedValue([]);
  queries.findDispatches.mockResolvedValue([]);
  store.empanelIngestedVendor.mockReturnValue({ id: 'live-vendor' });
  mailer.buildVendorSelfMappingEmail.mockImplementation((data) => ({ ...data, subject: 'self-map' }));
  mailer.buildVendorCategoryMappingEmail.mockImplementation((data) => ({ ...data, subject: 'mapped' }));
  mailer.buildVendorOnboardingEmail.mockImplementation((data) => ({ ...data, subject: 'onboard' }));
  mailer.sendVendorIngestionEmail.mockResolvedValue({ sent: true, messageId: 'message-1' });
});

describe('buyer review and live vendor empanelment', () => {
  test('rejects malformed review and an unknown vendor record before writing', async () => {
    await expect(service.reviewMapping(user, sessionId, 'record-1', { action: 'UNKNOWN' })).rejects.toMatchObject({ status: 400 });
    queries.findCategoryMappingByVendorRecord.mockResolvedValue(null);
    await expect(service.reviewMapping(user, sessionId, 'record-1', { action: 'APPROVE' })).rejects.toMatchObject({ status: 404 });
    expect(queries.saveBuyerReview).not.toHaveBeenCalled();
  });

  test.each([true, false])('cannot approve an empty AI suggestion (new category: %s)', async (isNewCategorySuggestion) => {
    queries.findCategoryMappingByVendorRecord.mockResolvedValue({ ...mapping, isNewCategorySuggestion,
      aiSuggestion: { ...mapping.aiSuggestion, majorCategory: '' } });
    await expect(service.reviewMapping(user, sessionId, mapping.vendorRecordId, { action: 'APPROVE' })).rejects.toMatchObject({ status: 409 });
    expect(queries.saveBuyerReview).not.toHaveBeenCalled();
  });

  test('approves an AI suggestion, attaches the live vendor and preserves the original suggestion in the audit', async () => {
    const result = await service.reviewMapping(user, sessionId, mapping.vendorRecordId, { action: 'APPROVE' });
    expect(queries.saveBuyerReview).toHaveBeenCalledWith(mapping.id, context.organizationId, expect.objectContaining({
      majorCategory: mapping.aiSuggestion.majorCategory, source: 'AI', reviewAction: 'APPROVED', reviewedBy: user.email,
    }));
    expect(queries.attachVendorId).toHaveBeenCalledWith(mapping.id, context.organizationId, 'live-vendor');
    expect(queries.insertAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      oldValue: expect.objectContaining({ majorCategory: mapping.buyerMajorCategory }),
      newValue: expect.objectContaining({ aiSuggested: expect.objectContaining({ confidence: 95 }) }),
    }));
    expect(result.mapping.status).toBe(mappingStatus.BUYER_APPROVED);
  });

  test('rejects a mapping into self-mapping without creating a live vendor', async () => {
    const result = await service.reviewMapping(user, sessionId, mapping.vendorRecordId, { action: 'REJECT' });
    expect(result.mapping).toMatchObject({ buyerMajorCategory: '', buyerMinorCategories: [], status: mappingStatus.SELF_MAP_REQUIRED });
    expect(store.empanelIngestedVendor).not.toHaveBeenCalled();
  });

  test('requires a category for an edit and canonicalizes selected minor categories', async () => {
    await expect(service.reviewMapping(user, sessionId, mapping.vendorRecordId, { action: 'EDIT' })).rejects.toMatchObject({ status: 400 });
    await service.reviewMapping(user, sessionId, mapping.vendorRecordId, {
      action: 'EDIT', majorCategory: ' electrical ', minorCategories: [null, '', ' Copper ', 'Copper'],
    });
    expect(queries.saveBuyerReview).toHaveBeenCalledWith(mapping.id, context.organizationId, expect.objectContaining({
      majorCategory: 'Electrical', minorCategories: ['Copper'], source: 'BUYER', reviewAction: 'EDITED',
    }));
  });

  test('supports an edited category with no minor categories', async () => {
    await service.reviewMapping(user, sessionId, mapping.vendorRecordId, { action: 'EDIT', majorCategory: 'Electrical' });
    expect(queries.saveBuyerReview).toHaveBeenCalledWith(mapping.id, context.organizationId, expect.objectContaining({ minorCategories: [] }));
  });

  test('does not empanel a missing mapping or one without an email', async () => {
    expect(await service.empanelApprovedVendor(context, sessionId, null)).toBeNull();
    expect(await service.empanelApprovedVendor(context, sessionId, { ...mapping, email: '' })).toBeNull();
    expect(store.empanelIngestedVendor).not.toHaveBeenCalled();
  });

  test('updates existing private vendors by email instead of creating duplicates', async () => {
    store.getVendorById.mockReturnValue({ id: 'existing-private' });
    store.updateVendor.mockReturnValue({ id: 'existing-private' });
    await service.empanelApprovedVendor(context, sessionId, mapping);
    expect(store.getVendorById).toHaveBeenCalledWith(mapping.email, 'all');
    expect(store.updateVendor).toHaveBeenCalledWith('existing-private', expect.objectContaining({
      contactPerson: vendorRecord.contactPerson, phone: vendorRecord.phone, location: vendorRecord.address, gstin: vendorRecord.gstin,
    }));
    expect(store.empanelIngestedVendor).not.toHaveBeenCalled();
  });

  test.each([null, {}])('uses AI categories and nullable contact fields when the master record is incomplete: %j', async (record) => {
    queries.findVendorMasterRecord.mockResolvedValue(record);
    store.empanelIngestedVendor.mockReturnValue(null);
    await expect(service.empanelApprovedVendor({ ...context, organizationName: '' }, sessionId, {
      ...mapping, vendorCode: '', buyerMajorCategory: '', buyerMinorCategories: [],
    })).resolves.toBeNull();
    expect(store.empanelIngestedVendor).toHaveBeenCalledWith(expect.objectContaining({
      majorCategory: mapping.aiSuggestion.majorCategory, minorCategories: mapping.aiSuggestion.minorCategories,
      phone: null, contactPerson: null, location: null, gstin: null, vendorCode: null, addedByBuyerCompany: null,
    }), context.email);
    expect(queries.attachVendorId).not.toHaveBeenCalled();
  });

  test('stores a null category when no reviewed or suggested category exists', async () => {
    await service.empanelApprovedVendor(context, sessionId, { ...mapping, buyerMajorCategory: '', aiSuggestion: { ...mapping.aiSuggestion, majorCategory: '' } });
    expect(store.empanelIngestedVendor).toHaveBeenCalledWith(expect.objectContaining({ majorCategory: null }), user.email);
  });
});

describe('mapping review reads', () => {
  const pending = { ...mapping, id: 'pending', vendorRecordId: 'pending-record', companyName: 'Beta Supplies', vendorCode: 'BETA',
    status: mappingStatus.PENDING_REVIEW, buyerMajorCategory: '', buyerMinorCategories: [], hasPoHistory: false,
    aiSuggestion: { ...mapping.aiSuggestion, majorCategory: 'Plumbing', minorCategories: ['Pipes'], confidence: 50 } };

  beforeEach(() => queries.findCategoryMappings.mockResolvedValue([mapping, pending]));

  test('decorates all mappings and uses reviewed categories over the original suggestion', async () => {
    const result = await service.listMappings(user, sessionId);
    expect(result).toMatchObject({ total: 2, limit: 25, offset: 0, summary: { total: 1 } });
    expect(result.vendors[0]).toMatchObject({ finalMajorCategory: 'Electrical', finalMinorCategories: ['Copper'], confidenceBand: 'HIGH' });
    expect(result.vendors[1]).toMatchObject({ finalMajorCategory: 'Plumbing', finalMinorCategories: ['Pipes'], confidenceBand: 'NEEDS_REVIEW' });
  });

  test.each([
    [{ status: mappingStatus.BUYER_APPROVED }, 'mapping-1'],
    [{ confidence: 'NEEDS_REVIEW' }, 'pending'],
    [{ hasPoHistory: 'YES' }, 'mapping-1'],
    [{ hasPoHistory: 'NO' }, 'pending'],
    [{ search: ' BETA ' }, 'pending'],
    [{ search: 'pipes' }, 'pending'],
    [{ search: 'vendor@example.com', status: 'ALL', confidence: 'ALL', limit: 1 }, 'mapping-1'],
  ])('filters mappings by %j', async (filters, expectedId) => {
    const result = await service.listMappings(user, sessionId, filters);
    expect(result.vendors.map((item) => item.id)).toEqual([expectedId]);
  });

  test('bounds pagination and reports the filtered count before slicing', async () => {
    expect(await service.listMappings(user, sessionId, { limit: -2, offset: -4 })).toMatchObject({ limit: 1, offset: 0, total: 2 });
    expect(await service.listMappings(user, sessionId, { limit: 999, offset: 2 })).toMatchObject({ limit: 200, offset: 2, vendors: [] });
    expect(await service.listMappings(user, sessionId, { search: 'does-not-exist' })).toMatchObject({ total: 0, vendors: [] });
  });

  test('merges category buckets by spend and separates self-mapping suppliers', async () => {
    queries.findCategorySegmentation.mockResolvedValue([
      { status: mappingStatus.BUYER_APPROVED, majorCategory: 'Electrical', vendorCount: 1, totalSpend: 100, companies: ['A'] },
      { status: mappingStatus.BUYER_APPROVED, majorCategory: 'Plumbing', vendorCount: 1, totalSpend: 300, companies: ['B'] },
      { status: mappingStatus.BUYER_APPROVED, majorCategory: 'Electrical', vendorCount: 1, totalSpend: 250, companies: ['C'] },
      { status: mappingStatus.SELF_MAP_REQUIRED, majorCategory: 'Electrical', companies: ['D'] },
      { status: mappingStatus.SELF_MAPPED, majorCategory: 'Electrical', companies: ['E'] },
      { status: mappingStatus.PENDING_REVIEW, majorCategory: '', companies: ['F'] },
    ]);
    expect(await service.getCategorySegmentation(user, sessionId)).toEqual({
      categories: [
        { majorCategory: 'Electrical', vendorCount: 2, totalSpend: 350, companies: ['A', 'C'] },
        { majorCategory: 'Plumbing', vendorCount: 1, totalSpend: 300, companies: ['B'] },
      ], selfMappingRequired: ['D', 'E', 'F'],
    });
  });
});

describe('dispatch recipient selection and previews', () => {
  test('re-derives requested recipients from the stored records and excludes empty email addresses', async () => {
    queries.findCategoryMappings.mockResolvedValue([
      mapping, { ...mapping, vendorRecordId: 'not-requested' }, { ...mapping, vendorRecordId: 'missing-email', email: '' },
    ]);
    const recipients = await service.resolveDispatchRecipients(context, sessionId, {
      template: templates.GENERAL_ONBOARDING, vendorRecordIds: [mapping.vendorRecordId, 'missing-email'],
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({ email: mapping.email, contactPerson: vendorRecord.contactPerson, phone: vendorRecord.phone, contactPhone: vendorRecord.phone });
  });

  test('selects only self-mapping suppliers for the self-mapping template', async () => {
    queries.findCategoryMappings.mockResolvedValue([mapping, { ...mapping, id: 'self-map', status: mappingStatus.SELF_MAP_REQUIRED }]);
    expect(await service.resolveDispatchRecipients(context, sessionId, { template: templates.SELF_MAP_REQUIRED, vendorRecordIds: [] }))
      .toEqual([expect.objectContaining({ mappingId: 'self-map' })]);
  });

  test('selects only approved nonempty categories and respects the chosen category', async () => {
    queries.findCategoryMappings.mockResolvedValue([
      mapping, { ...mapping, status: mappingStatus.PENDING_REVIEW },
      { ...mapping, buyerMajorCategory: '' }, { ...mapping, buyerMajorCategory: 'Plumbing' },
    ]);
    expect(await service.resolveDispatchRecipients(context, sessionId, { template: templates.CATEGORY_MAPPED, majorCategory: 'Electrical' }))
      .toEqual([expect.objectContaining({ majorCategory: 'Electrical' })]);
    expect(await service.resolveDispatchRecipients(context, sessionId, { template: templates.CATEGORY_MAPPED })).toHaveLength(2);
  });

  test('falls back to AI categories and blank contacts when master records cannot be loaded', async () => {
    queries.findVendorMasterRecords.mockRejectedValue(new Error('Master unavailable'));
    queries.findCategoryMappings.mockResolvedValue([{ ...mapping, buyerMajorCategory: '', buyerMinorCategories: [] }]);
    expect(await service.resolveDispatchRecipients(context, sessionId, { template: templates.GENERAL_ONBOARDING }))
      .toEqual([expect.objectContaining({ contactPerson: '', phone: '', majorCategory: 'Electrical', minorCategories: ['Copper'] })]);
    queries.findVendorMasterRecords.mockResolvedValue(null);
    expect(await service.resolveDispatchRecipients(context, sessionId, { template: templates.GENERAL_ONBOARDING })).toHaveLength(1);
  });

  test('rejects invalid previews with field validation errors', async () => {
    await expect(service.previewDispatch(user, sessionId, {})).rejects.toMatchObject({ status: 400, details: expect.any(Object) });
  });

  test.each([templates.CATEGORY_MAPPED, templates.SELF_MAP_REQUIRED])('explains an empty recipient set for %s', async (template) => {
    queries.findCategoryMappings.mockResolvedValue([]);
    expect(await service.previewDispatch(user, sessionId, { template })).toMatchObject({ recipients: [], sendable: [], alreadySent: [], warning: expect.any(String) });
  });

  test('splits already-sent recipients from sendable recipients without treating failures as sent', async () => {
    queries.findCategoryMappings.mockResolvedValue([mapping, { ...mapping, id: 'mapping-2', email: 'second@example.com' }]);
    queries.findEmailLogsByIdempotencyKeys.mockResolvedValue([
      { status: emailStatus.SENT, idempotencyKey: `${templates.CATEGORY_MAPPED}:${mapping.email}` },
      { status: emailStatus.FAILED, idempotencyKey: `${templates.CATEGORY_MAPPED}:second@example.com` },
    ]);
    const result = await service.previewDispatch(user, sessionId, { template: templates.CATEGORY_MAPPED, majorCategory: 'Electrical' });
    expect(result.alreadySent).toEqual([expect.objectContaining({ email: mapping.email })]);
    expect(result.sendable).toEqual([expect.objectContaining({ email: 'second@example.com' })]);
    expect(result.warning).toContain('1');
    expect(queries.buildIdempotencyKey).toHaveBeenCalledWith(expect.objectContaining({ majorCategory: 'Electrical' }));
  });

  test('returns no duplicate warning for a new onboarding dispatch', async () => {
    expect(await service.previewDispatch(user, sessionId, { template: templates.GENERAL_ONBOARDING })).toMatchObject({ warning: null, alreadySent: [] });
    expect(queries.buildIdempotencyKey).toHaveBeenCalledWith(expect.objectContaining({ majorCategory: '' }));
  });
});

describe('delivery and retries', () => {
  test.each([
    [templates.SELF_MAP_REQUIRED, 'buildVendorSelfMappingEmail'],
    [templates.CATEGORY_MAPPED, 'buildVendorCategoryMappingEmail'],
    [templates.GENERAL_ONBOARDING, 'buildVendorOnboardingEmail'],
  ])('builds the correct %s message with contact and temporary password data', (template, method) => {
    service.buildDispatchMessage(context, template, { ...mapping, contactPerson: 'Contact', contactPhone: '123', tempPassword: 'temporary-fixture' });
    expect(mailer[method]).toHaveBeenCalledWith(expect.objectContaining({ to: mapping.email, recipientName: 'Contact', contactPhone: '123', tempPassword: 'temporary-fixture' }));
    service.buildDispatchMessage(context, template, { ...mapping, phone: '456' });
    expect(mailer[method]).toHaveBeenLastCalledWith(expect.objectContaining({ recipientName: mapping.companyName, contactPhone: '456', tempPassword: '' }));
    service.buildDispatchMessage(context, template, mapping);
    expect(mailer[method]).toHaveBeenLastCalledWith(expect.objectContaining({ contactPhone: '' }));
  });

  test('claims each recipient once, skips successful duplicates, and continues after declined or thrown sends', async () => {
    const recipients = Array.from({ length: 5 }, (_, i) => ({ ...mapping, email: `recipient-${i}@example.com`, majorCategory: 'Electrical' }));
    queries.claimEmailSlot.mockResolvedValueOnce(null).mockResolvedValue({ id: 'slot-1' });
    mailer.sendVendorIngestionEmail.mockResolvedValueOnce({ sent: true, messageId: 'accepted' })
      .mockResolvedValueOnce({ sent: false, reason: 'SMTP unavailable' })
      .mockResolvedValueOnce({ sent: false }).mockRejectedValueOnce(new Error('Transport failed'));
    const result = await service.deliverToRecipients(context, { sessionId, dispatchId: 'dispatch-1', template: templates.CATEGORY_MAPPED, recipients });
    expect(result).toMatchObject({ sent: 1, failed: 3, skipped: 1 });
    expect(result.perRecipient.map((r) => r.status)).toEqual(['SKIPPED_ALREADY_SENT', emailStatus.SENT, emailStatus.FAILED, emailStatus.FAILED, emailStatus.FAILED]);
    expect(queries.markEmailSent).toHaveBeenCalledWith('slot-1', context.organizationId, 'accepted');
    expect(queries.markEmailFailed).toHaveBeenCalledWith('slot-1', context.organizationId, 'SMTP unavailable');
    expect(queries.markEmailFailed).toHaveBeenCalledWith('slot-1', context.organizationId, 'Email was not dispatched.');
    expect(logger.error).toHaveBeenCalled();
  });

  test('validates send requests and rejects empty and oversized campaigns before creating a dispatch', async () => {
    await expect(service.sendDispatch(user, sessionId, {})).rejects.toMatchObject({ status: 400 });
    queries.findCategoryMappings.mockResolvedValue([]);
    for (const template of [templates.CATEGORY_MAPPED, templates.SELF_MAP_REQUIRED]) {
      await expect(service.sendDispatch(user, sessionId, { template })).rejects.toMatchObject({ status: 422 });
    }
    queries.findCategoryMappings.mockResolvedValue(Array.from({ length: config.MAX_RECIPIENTS_PER_DISPATCH + 1 }, () => mapping));
    await expect(service.sendDispatch(user, sessionId, { template: templates.GENERAL_ONBOARDING })).rejects.toMatchObject({ status: 413 });
    expect(queries.insertDispatch).not.toHaveBeenCalled();
  });

  test.each([
    [[{ sent: true }, { sent: true }], dispatchStatus.COMPLETED],
    [[{ sent: true }, { sent: false, reason: 'Failure' }], dispatchStatus.PARTIAL],
    [[{ sent: false }, { sent: false }], dispatchStatus.FAILED],
  ])('finalizes campaign totals from actual deliveries: %j', async (deliveries, expectedStatus) => {
    queries.findCategoryMappings.mockResolvedValue([mapping, { ...mapping, email: 'second@example.com' }]);
    deliveries.forEach((delivery) => mailer.sendVendorIngestionEmail.mockResolvedValueOnce(delivery));
    const result = await service.sendDispatch(user, sessionId, { template: templates.CATEGORY_MAPPED, majorCategory: 'Electrical' });
    expect(queries.finalizeDispatch).toHaveBeenCalledWith('dispatch-1', context.organizationId, expect.objectContaining({ status: expectedStatus }));
    expect(result.dispatch.status).toBe(expectedStatus);
    expect(store.notifyBuyer).toHaveBeenCalledWith(user.email, expect.objectContaining({ kind: 'vendor_dispatch_completed' }));
  });

  test('records a self-mapping campaign even when no dispatch row was returned and notifications fail', async () => {
    queries.findCategoryMappings.mockResolvedValue([{ ...mapping, status: mappingStatus.SELF_MAP_REQUIRED }]);
    queries.insertDispatch.mockResolvedValue(null);
    store.notifyBuyer.mockImplementation(() => { throw new Error('Notifications unavailable'); });
    const result = await service.sendDispatch(user, sessionId, { template: templates.SELF_MAP_REQUIRED });
    expect(result).toMatchObject({ dispatch: null, sent: 1 });
    expect(queries.finalizeDispatch).not.toHaveBeenCalled();
    expect(queries.claimEmailSlot).toHaveBeenCalledWith(expect.objectContaining({ dispatchId: null, majorCategory: '' }));
    expect(logger.warn).toHaveBeenCalled();
  });

  test('reports when no failed emails are available to retry', async () => {
    await expect(service.retryFailedDispatches(user, sessionId)).rejects.toMatchObject({ status: 409, message: messages.DISPATCH_NOTHING_TO_RETRY });
  });

  test('groups retries by template and recovers available names and categories from stored mappings', async () => {
    queries.findEmailLogs.mockResolvedValue([
      { template: templates.CATEGORY_MAPPED, dispatchId: 'retry-dispatch', vendorRecordId: mapping.vendorRecordId, recipientEmail: 'a@example.com', recipientName: '', majorCategory: '' },
      { template: templates.CATEGORY_MAPPED, vendorRecordId: 'missing', recipientEmail: 'b@example.com', recipientName: '', majorCategory: '' },
      { template: templates.GENERAL_ONBOARDING, vendorRecordId: 'missing', recipientEmail: 'c@example.com', recipientName: 'Recorded name', majorCategory: 'Recorded category' },
    ]);
    queries.claimEmailSlot.mockResolvedValueOnce(null).mockResolvedValue({ id: 'retry-slot' });
    mailer.sendVendorIngestionEmail.mockResolvedValueOnce({ sent: false, reason: 'Still unavailable' }).mockResolvedValueOnce({ sent: true });
    expect(await service.retryFailedDispatches(user, sessionId)).toMatchObject({ attempted: 3, sent: 1, failed: 1, skipped: 1 });
    expect(queries.claimEmailSlot).toHaveBeenCalledWith(expect.objectContaining({ recipientName: mapping.companyName, majorCategory: mapping.buyerMajorCategory }));
    expect(queries.claimEmailSlot).toHaveBeenCalledWith(expect.objectContaining({ recipientName: '', majorCategory: '' }));
    expect(mailer.buildVendorOnboardingEmail).toHaveBeenCalledWith(expect.objectContaining({ recipientName: 'Recorded name' }));
  });
});

describe('organization-scoped read endpoints', () => {
  test('returns dispatch status with default and explicit filters', async () => {
    expect(await service.getDispatchStatus(user, sessionId)).toEqual({ dispatches: [], logs: [], summary: { sent: 1, failed: 0 } });
    await service.getDispatchStatus(user, sessionId, { status: emailStatus.SENT, limit: 10 });
    expect(queries.findEmailLogs).toHaveBeenLastCalledWith(sessionId, context.organizationId, { status: emailStatus.SENT, limit: 10 });
  });

  test('explains empty category masters and returns configured categories', async () => {
    expect(await service.getCategoryMaster(user)).toMatchObject({ isEmpty: false, total: 1, reason: null });
    queries.findOrganizationCategoryMaster.mockResolvedValue([]);
    expect(await service.getCategoryMaster(user)).toEqual({ categories: [], isEmpty: true, total: 0, reason: messages.CATEGORY_MASTER_EMPTY });
  });

  test('loads audit entries with optional session scoping and classification logs with limits', async () => {
    queries.findAuditEntries.mockResolvedValue([{ id: 'audit-1' }]);
    expect(await service.getAuditTrail(user)).toEqual({ entries: [{ id: 'audit-1' }], total: 1 });
    await service.getAuditTrail(user, { sessionId, limit: 5, offset: 2 });
    expect(queries.findAuditEntries).toHaveBeenLastCalledWith(context.organizationId, { sessionId, limit: 5, offset: 2 });
    queries.findAiClassificationLogs.mockResolvedValue([{ id: 'classification-1' }]);
    expect(await service.getAiClassificationLogs(user, sessionId)).toEqual({ logs: [{ id: 'classification-1' }], total: 1 });
    await service.getAiClassificationLogs(user, sessionId, { limit: 7 });
    expect(queries.findAiClassificationLogs).toHaveBeenLastCalledWith(sessionId, context.organizationId, { limit: 7 });
  });

  test('returns approved mappings with reviewed and AI fallback categories', async () => {
    queries.findApprovedMappingsForOrganization.mockResolvedValue([mapping, { ...mapping, buyerMajorCategory: '', buyerMinorCategories: [] }]);
    const result = await service.getApprovedMappings(user);
    expect(result.total).toBe(2);
    expect(result.mappings).toEqual([expect.objectContaining({ majorCategory: 'Electrical', minorCategories: ['Copper'] }), expect.objectContaining({ majorCategory: 'Electrical', minorCategories: ['Copper'] })]);
    await service.getApprovedMappings(user, 25);
    expect(queries.findApprovedMappingsForOrganization).toHaveBeenLastCalledWith(context.organizationId, 25);
  });
});
