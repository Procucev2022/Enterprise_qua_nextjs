const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const storeService = require('../src/services/storeService');
const { EVENT_OUTBOX_MAX_BATCH_SIZE } = require('../src/config/constants');

describe('durable RFQ vendor invitation intents', () => {
  const originalState = {};

  beforeAll(() => {
    originalState.vendors = storeService.vendors;
    originalState.rfqs = storeService.rfqs;
    originalState.notifications = storeService.notifications;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    storeService.vendors = [];
    storeService.rfqs = [];
    storeService.notifications = [];
  });

  afterAll(() => {
    storeService.vendors = originalState.vendors;
    storeService.rfqs = originalState.rfqs;
    storeService.notifications = originalState.notifications;
  });

  test('builds stable, case-insensitive recipient targets with safe vendor context', () => {
    const vendor = {
      id: 'vendor-1',
      email: 'supplies@example.test',
      name: 'Supply Co',
      contactPerson: 'Sam',
      source: 'buyer_uploaded',
      freeQuotationCredits: 3,
    };
    storeService.vendors = [vendor];

    const targets = storeService._buildRFQVendorInviteTargets(
      { id: 'rfq-1', raisedByEmail: 'buyer@example.test' },
      [vendor, { ...vendor, email: 'SUPPLIES@example.test' }],
      { includeBuyerEmail: true }
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      vendorId: 'vendor-1',
      recipientEmail: 'supplies@example.test',
      recipientName: 'Sam',
      freeCreditsRemaining: 3,
      isSubscribed: false,
      buyerEmail: 'buyer@example.test',
      vendor: { id: 'vendor-1', isBuyerUploaded: true },
    });
    expect(targets[0].key).toMatch(/^[a-f0-9]{64}$/);
    expect(targets[0].key).toBe(storeService._buildRFQVendorInviteTargets(
      { id: 'rfq-1' },
      [vendor]
    )[0].key);
  });

  test('skips missing email addresses and returns no dispatch when storage is unconfigured', () => {
    expect(storeService._buildRFQVendorInviteTargets({ id: 'rfq-2' }, [{ id: 'vendor-no-email' }])).toEqual([]);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    expect(storeService._dispatchRFQVendorInviteOutbox({ id: 'rfq-2' }, 'test')).toBe(false);
  });

  test('captures initial matched and assigned recipients before durable RFQ insertion', () => {
    const vendor = {
      id: 'vendor-initial-invite',
      email: 'initial-vendor@example.test',
      name: 'Initial Vendor',
      source: 'procucev_network',
    };
    storeService.vendors = [vendor];
    jest.spyOn(storeService, 'selectVendorsForRFQEmail').mockReturnValue([vendor]);
    jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([]);

    const created = storeService.createRFQ({
      id: 'rfq-initial-invite',
      rfqNumber: 'RFQ-INITIAL-INVITE',
      title: 'Initial invitation',
      category: 'Pumps',
      assignedVendors: [vendor],
    }, null, { deferPersistence: true, deferSideEffects: true });

    expect(created.vendorInvitationTargets).toHaveLength(1);
    expect(created.vendorInvitationTargets[0]).toMatchObject({
      vendorId: vendor.id,
      recipientEmail: vendor.email,
    });
    expect(storeService.getRFQById(created.id)).not.toHaveProperty('vendorInvitationTargets');
  });

  test('keeps the persisted RFQ gateway target out of public RFQ reads', () => {
    const created = storeService.createRFQ({
      id: 'rfq-private-gateway-target',
      rfqNumber: 'RFQ-PRIVATE-GATEWAY-TARGET',
      title: 'Pump spares',
      source: 'email_gateway',
      sourcingMode: 'mode_0',
      status: 'Draft',
      gatewayNotificationTarget: {
        recipientEmail: 'gateway@example.test',
        sourceEmail: 'buyer@example.test',
      },
    }, null, { deferPersistence: true, deferSideEffects: true });

    expect(created.gatewayNotificationTarget).toEqual({
      recipientEmail: 'gateway@example.test',
      sourceEmail: 'buyer@example.test',
    });
    expect(storeService.getRFQById(created.id)).not.toHaveProperty('gatewayNotificationTarget');
  });

  test('keeps invitation targets private in the durable RFQ update response', async () => {
    const rfq = {
      id: 'rfq-private-targets',
      status: 'Quotes Pending',
      vendorInvitationTargets: [{ key: 'private-key', recipientEmail: 'vendor@example.test' }],
    };
    storeService.rfqs = [rfq];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

    const updated = await storeService.updateRFQDurably(rfq.id, { title: 'Updated title' });

    expect(updated.title).toBe('Updated title');
    expect(updated).not.toHaveProperty('vendorInvitationTargets');
    expect(storeService.rfqs[0]).not.toHaveProperty('vendorInvitationTargets');
  });

  test('keeps invitation targets private in vendor-scoped RFQ reads', () => {
    const vendor = { id: 'vendor-private-read', email: 'private-read@example.test' };
    storeService.vendors = [vendor];
    storeService.rfqs = [{
      id: 'rfq-private-read',
      assignedVendors: [vendor],
      vendorInvitationTargets: [{ recipientEmail: vendor.email, key: 'private-key' }],
    }];
    jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(true);

    const [rfq] = storeService.getRFQsForVendor(vendor.id);

    expect(rfq).not.toHaveProperty('vendorInvitationTargets');
  });

  test('adds only newly committed vendor targets to the durable assignment update', async () => {
    const vendor = {
      id: 'vendor-new-assignment',
      email: 'new-vendor@example.test',
      name: 'New Vendor',
      source: 'procucev_network',
    };
    storeService.vendors = [vendor];
    const updateSpy = jest.spyOn(storeService, 'updateRFQDurably').mockImplementation(async (_id, resolveUpdates) => {
      const current = { id: 'rfq-assignment', raisedByEmail: 'buyer@example.test', assignedVendors: [] };
      return { ...current, ...resolveUpdates(current) };
    });

    const result = await storeService._appendRFQAssignmentsDurably('rfq-assignment', [vendor], {
      includeBuyerEmailInInvite: true,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.updatedRFQ.assignedVendors).toEqual([vendor]);
    expect(result.updatedRFQ.vendorInvitationTargets).toMatchObject([{
      vendorId: vendor.id,
      recipientEmail: vendor.email,
      buyerEmail: 'buyer@example.test',
    }]);
  });

  test('uses the persisted outbox instead of sending a new-RFQ email in the request path', () => {
    const target = { key: 'opaque-key', recipientEmail: 'vendor@example.test' };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, 'selectVendorsForRFQEmail').mockReturnValue([]);
    jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1 });
    const sendSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    const count = storeService.emailRFQToMatchedVendors({
      id: 'rfq-outbox',
      rfqNumber: 'RFQ-OUTBOX',
      status: 'Quotes Pending',
      assignedVendors: [],
      vendorInvitationTargets: [target],
    });

    expect(count).toBe(1);
    expect(eventOutboxService.dispatchDueEventOutboxJobs).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('manual assignment commits the invite intent and dispatches the outbox', async () => {
    const rfq = {
      id: 'rfq-manual-invite',
      rfqNumber: 'RFQ-MANUAL',
      status: 'Quotes Pending',
      category: 'Pumps',
      assignedVendors: [],
    };
    const vendor = {
      id: 'vendor-manual',
      name: 'Manual Supplier',
      email: 'manual@example.test',
      majorCategory: 'Pumps',
      source: 'procucev_network',
    };
    storeService.vendors = [vendor];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
    jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['pumps']);
    jest.spyOn(storeService, 'isVendorPrivateToDifferentBuyer').mockReturnValue(false);
    jest.spyOn(storeService, '_isInvitedVendor').mockReturnValue(false);
    jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockResolvedValue({
      updatedRFQ: { ...rfq, assignedVendors: [vendor] },
      committedAdditions: [vendor],
    });
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
    jest.spyOn(storeService, 'addAIFeedItem').mockImplementation(() => {});
    jest.spyOn(storeService, '_buildNotification').mockReturnValue({ id: 'notification-1' });
    jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
    jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1 });
    const sendSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    const result = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'manager@example.test');

    expect(result.invitedCount).toBe(1);
    expect(eventOutboxService.dispatchDueEventOutboxJobs).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('resolves corporateEmail and passes committed invitation event IDs on manual invite', async () => {
    const rfq = {
      id: 'rfq-corp-invite',
      rfqNumber: 'RFQ-CORP-1',
      status: 'Quotes Pending',
      category: 'Pumps',
      assignedVendors: [],
    };
    const vendor = {
      id: 'vendor-corp',
      name: 'Corp Supplier',
      corporateEmail: 'corp@example.test',
      majorCategory: 'Pumps',
      source: 'procucev_network',
    };
    storeService.vendors = [vendor];

    const builtTargets = storeService._buildRFQVendorInviteTargets(rfq, [vendor], { includeBuyerEmail: true });
    expect(builtTargets).toHaveLength(1);
    expect(builtTargets[0].recipientEmail).toBe('corp@example.test');
    const expectedOutboxId = `rfq-vendor-invite:${builtTargets[0].key}`;

    expect(storeService._resolveDispatchedInviteEventIds(null, builtTargets, [])).toEqual([]);
    expect(
      storeService._resolveDispatchedInviteEventIds(rfq, [...builtTargets, { key: 'second-key' }], [], { maxCount: 1 })
    ).toEqual([expectedOutboxId]);

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
    jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['pumps']);
    jest.spyOn(storeService, 'isVendorPrivateToDifferentBuyer').mockReturnValue(false);
    jest.spyOn(storeService, '_isInvitedVendor').mockReturnValue(false);
    jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockResolvedValue({
      updatedRFQ: { ...rfq, assignedVendors: [{ ...vendor, email: 'corp@example.test' }] },
      committedAdditions: [{ ...vendor, email: 'corp@example.test' }],
      invitationTargets: builtTargets,
    });
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
    jest.spyOn(storeService, 'addAIFeedItem').mockImplementation(() => {});
    jest.spyOn(storeService, '_buildNotification').mockReturnValue({ id: 'notification-corp-1' });
    jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
    const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1 });
    const sendSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    const result = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'manager@example.test');

    expect(result.invitedCount).toBe(1);
    expect(dispatchSpy).toHaveBeenCalledWith(1, [expectedOutboxId]);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('Workers runtime skips inline auto-assign email blasts and caps immediate outbox batch size', async () => {
    const previousCfEnv = globalThis.__CF_ENV__;
    const hasOwnCfEnv = Object.prototype.hasOwnProperty.call(globalThis, '__CF_ENV__');
    globalThis.__CF_ENV__ = { DB: {} };

    try {
      const totalVendors = EVENT_OUTBOX_MAX_BATCH_SIZE + 5;
      const networkVendors = Array.from({ length: totalVendors }, (_, index) => ({
        id: `net-v-${index}`,
        name: `Network Vendor ${index}`,
        email: `net-${index}@example.test`,
        majorCategory: 'Pumps',
        source: 'procucev_network',
      }));

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['pumps']);
      jest.spyOn(storeService, '_rfqDistinctCategories').mockReturnValue(['Pumps']);
      jest.spyOn(storeService, '_rfqMinorCategories').mockReturnValue([]);
      jest.spyOn(storeService, '_extractTargetLocation').mockReturnValue({});
      jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue(networkVendors);
      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue(networkVendors);
      jest.spyOn(storeService, 'selectVendorsForRFQ').mockImplementation((list) => list);
      jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockImplementation(async (rfqId, additions) => ({
        updatedRFQ: {
          id: rfqId,
          rfqNumber: rfqId.toUpperCase(),
          title: 'Workers Batch RFQ',
          sourcingMode: 'mode_0',
          assignedVendors: additions,
        },
        committedAdditions: additions,
        invitationTargets: additions.map((v, idx) => ({ key: `key-${rfqId}-${idx}`, vendorId: v.id })),
      }));
      jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
      jest.spyOn(storeService, '_buildNotification').mockReturnValue({ id: 'notif-workers' });
      jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
      jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
      const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 25 });
      const sendSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

      await storeService.augmentV0AssignmentsFromDB({
        id: 'rfq-workers-v0',
        rfqNumber: 'RFQ-WORKERS-V0',
        title: 'Workers V0',
        sourcingMode: 'mode_0',
        assignedVendors: [],
      });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy.mock.calls[0][0]).toBe(EVENT_OUTBOX_MAX_BATCH_SIZE);
      expect(dispatchSpy.mock.calls[0][1]).toHaveLength(EVENT_OUTBOX_MAX_BATCH_SIZE);

      dispatchSpy.mockClear();
      await storeService.autoAssignVendorsFromDB({
        id: 'rfq-workers-v3',
        rfqNumber: 'RFQ-WORKERS-V3',
        title: 'Workers V3',
        sourcingMode: 'mode_3',
        assignedVendors: [],
      });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy.mock.calls[0][0]).toBe(EVENT_OUTBOX_MAX_BATCH_SIZE);
      expect(dispatchSpy.mock.calls[0][1]).toHaveLength(EVENT_OUTBOX_MAX_BATCH_SIZE);
    } finally {
      if (hasOwnCfEnv) {
        globalThis.__CF_ENV__ = previousCfEnv;
      } else {
        delete globalThis.__CF_ENV__;
      }
    }
  });
});
