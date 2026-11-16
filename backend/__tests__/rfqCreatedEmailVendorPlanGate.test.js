const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { splitStatements } = require('../scripts/migrate-d1');
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const rfqController = require('../src/controllers/rfqController');
const rfqSummaryService = require('../src/services/rfqSummaryService');
const storeService = require('../src/services/storeService');
const { EVENT_OUTBOX_DEFERRED_STATUS } = require('../src/config/constants');

function createResponse() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
}

describe('RFQ creation acknowledgement vendor-plan outbox gate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('SQLite triggers hold rfq_created_email in planning status until vendorPlanPending clears', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const schemaSql = fs.readFileSync(path.resolve(__dirname, '../src/db/schema.d1.sql'), 'utf8');
      const outboxTableSql = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations/0012_event_outbox.d1.sql'), 'utf8');
      const legacyAckSql = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations/0020_rfq_created_email_outbox.d1.sql'), 'utf8');
      const gateSql = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations/0038_rfq_created_email_vendor_plan_gate.d1.sql'), 'utf8');

      for (const stmt of [...splitStatements(schemaSql), ...splitStatements(outboxTableSql), ...splitStatements(legacyAckSql), ...splitStatements(gateSql)]) {
        db.exec(stmt);
      }

      db.prepare('INSERT INTO rfqs (id, rfq_number, sourcing_mode, raw) VALUES (?, ?, ?, ?)').run(
        'rfq-v0-race',
        'RFQ-V0-RACE',
        'mode_0',
        JSON.stringify({
          id: 'rfq-v0-race',
          rfqNumber: 'RFQ-V0-RACE',
          creationAcknowledgementRequested: true,
          buyerEmail: 'buyer@example.test',
          vendorPlanPending: true,
          assignedVendors: [],
          procucevVendorCount: 0,
        })
      );

      const staged = db.prepare('SELECT id, status FROM event_outbox WHERE id = ?').get('rfq-created-email:rfq-v0-race');
      expect(staged).toEqual({
        id: 'rfq-created-email:rfq-v0-race',
        status: EVENT_OUTBOX_DEFERRED_STATUS.VENDOR_PLAN,
      });

      // An intermediate update that still preserves vendorPlanPending keeps the email held.
      db.prepare('UPDATE rfqs SET raw = ? WHERE id = ?').run(
        JSON.stringify({
          id: 'rfq-v0-race',
          rfqNumber: 'RFQ-V0-RACE',
          creationAcknowledgementRequested: true,
          buyerEmail: 'buyer@example.test',
          vendorPlanPending: true,
          assignedVendors: [{ id: 'v-1' }],
        }),
        'rfq-v0-race'
      );
      expect(db.prepare('SELECT status FROM event_outbox WHERE id = ?').get('rfq-created-email:rfq-v0-race').status)
        .toBe(EVENT_OUTBOX_DEFERRED_STATUS.VENDOR_PLAN);

      // Finalizing the vendor plan flips the queued event to pending with all matched vendors present.
      db.prepare('UPDATE rfqs SET raw = ? WHERE id = ?').run(
        JSON.stringify({
          id: 'rfq-v0-race',
          rfqNumber: 'RFQ-V0-RACE',
          creationAcknowledgementRequested: true,
          buyerEmail: 'buyer@example.test',
          vendorPlanPending: false,
          assignedVendors: Array.from({ length: 25 }, (_, i) => ({ id: `v-${i + 1}` })),
          procucevVendorCount: 25,
        }),
        'rfq-v0-race'
      );
      expect(db.prepare('SELECT status FROM event_outbox WHERE id = ?').get('rfq-created-email:rfq-v0-race').status)
        .toBe('pending');

      // Already completed acknowledgements are never re-queued by subsequent RFQ updates.
      db.prepare("UPDATE event_outbox SET status = 'completed' WHERE id = ?").run('rfq-created-email:rfq-v0-race');
      db.prepare('UPDATE rfqs SET raw = ? WHERE id = ?').run(
        JSON.stringify({
          id: 'rfq-v0-race',
          rfqNumber: 'RFQ-V0-RACE',
          creationAcknowledgementRequested: true,
          buyerEmail: 'buyer@example.test',
          status: 'Closed',
        }),
        'rfq-v0-race'
      );
      expect(db.prepare('SELECT status FROM event_outbox WHERE id = ?').get('rfq-created-email:rfq-v0-race').status)
        .toBe('completed');

      // Direct insert without vendorPlanPending still queues immediately as pending.
      db.prepare('INSERT INTO rfqs (id, rfq_number, sourcing_mode, raw) VALUES (?, ?, ?, ?)').run(
        'rfq-immediate',
        'RFQ-IMMEDIATE',
        'mode_1',
        JSON.stringify({
          id: 'rfq-immediate',
          rfqNumber: 'RFQ-IMMEDIATE',
          creationAcknowledgementRequested: true,
          buyerEmail: 'buyer@example.test',
        })
      );
      expect(db.prepare('SELECT status FROM event_outbox WHERE id = ?').get('rfq-created-email:rfq-immediate').status)
        .toBe('pending');
    } finally {
      db.close();
    }
  });

  test('PostgreSQL migration mirrors D1 enqueue/release trigger semantics', () => {
    const pgSql = fs.readFileSync(
      path.resolve(__dirname, '../src/db/migrations/0038_rfq_created_email_vendor_plan_gate.pg.sql'),
      'utf8'
    );
    expect(pgSql).toContain('CREATE OR REPLACE FUNCTION enqueue_rfq_created_email_event()');
    expect(pgSql).toContain('CREATE OR REPLACE FUNCTION release_rfq_created_email_event()');
    expect(pgSql).toContain("THEN 'planning'");
    expect(pgSql).toContain("AND status = 'planning'");
    expect(pgSql).toContain('CREATE TRIGGER rfqs_release_created_email_event');
  });

  test('Mode 0 createRFQ stages vendorPlanPending until V0 augmentation completes and skips empty create-time invite flush', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const buyer = {
      id: 'buyer-gate-v0',
      corporateEmail: 'buyer@example.test',
      organizationName: 'Buyer Co',
      subscriptionPlan: 'free_trial',
    };
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(buyer);
    jest.spyOn(rfqSummaryService, 'buildRFQSummary').mockResolvedValue({ summary: 'Semiconductors' });
    const createdRfq = {
      id: 'rfq-gate-v0-1',
      rfqNumber: 'RFQ-GATE-V0-1',
      title: 'Semiconductors',
      category: 'Engineering Spares - Electrical',
      sourcingMode: 'mode_0',
      creationAcknowledgementRequested: true,
      assignedVendors: [],
      procucevVendorCount: 0,
      vendorInvitationTargets: [],
      extractedEntities: [],
    };
    const augmentedRfq = {
      ...createdRfq,
      assignedVendors: Array.from({ length: 25 }, (_, i) => ({ id: `v-${i + 1}` })),
      procucevVendorCount: 25,
    };
    const createSpy = jest.spyOn(storeService, 'createRFQDurably').mockResolvedValue(createdRfq);
    const augmentSpy = jest.spyOn(storeService, 'augmentV0AssignmentsFromDB').mockResolvedValue(augmentedRfq);
    const upsertSpy = jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue(augmentedRfq);
    const outboxSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ completed: 1 });

    // emailRFQToMatchedVendors skips empty vendorInvitationTargets when storage is configured.
    expect(storeService.emailRFQToMatchedVendors(createdRfq)).toBe(0);
    expect(outboxSpy).not.toHaveBeenCalled();

    const res = createResponse();
    await rfqController.createRFQ({
      body: {
        title: 'Semiconductors',
        category: 'Engineering Spares - Electrical',
        sourcingMode: 'mode_0',
        targetDeliveryDate: '2099-01-01',
        deliveryLocation: 'Central Delhi, Delhi',
        deliveryPincode: '110002',
        extractedEntities: [{
          itemName: 'Semiconductors',
          technicalSpecs: 'Standard IC',
          quantity: 25,
          unit: 'Nos',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategory: 'Semiconductors',
        }],
      },
      user: { role: 'buyer', email: buyer.corporateEmail, name: 'Veera' },
    }, res, jest.fn());

    expect(res.statusCode).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      creationAcknowledgementRequested: true,
      vendorPlanPending: true,
    }), buyer);
    expect(augmentSpy).toHaveBeenCalledWith(createdRfq, { notifyShortfall: true });
    expect(upsertSpy).toHaveBeenCalledWith(augmentedRfq);
    expect(outboxSpy).toHaveBeenCalledWith(1, [`rfq-created-email:${augmentedRfq.id}`]);
  });

  test('preserves vendorPlanPending when DB vendor plan defers and releases it once completeRFQVendorPlan finishes', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockRejectedValue(new Error('D1 DB is overloaded'));
    jest.spyOn(eventOutboxService, 'enqueueEventOutbox').mockResolvedValue({ id: 'queued' });
    const upsertSpy = jest.spyOn(domainQueries, 'upsertRFQInDB').mockImplementation(async (rfq) => rfq);
    const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1 });

    const rfq = {
      id: 'rfq-deferred-ack-1',
      rfqNumber: 'RFQ-DEF-1',
      sourcingMode: 'mode_0',
      category: 'Engineering Spares - Electrical',
      creationAcknowledgementRequested: true,
      vendorPlanPending: true,
      extractedEntities: [{ minorCategory: 'Semiconductors', majorCategory: 'Engineering Spares - Electrical' }],
      assignedVendors: [],
    };

    const deferred = await storeService.augmentV0AssignmentsFromDB(rfq, { notifyShortfall: true });
    expect(storeService.isVendorPlanDeferred(deferred)).toBe(true);

    await storeService.confirmRfqPersisted(deferred);
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ id: rfq.id, vendorPlanPending: true }));
    await storeService.persistRFQDurably(deferred);
    expect(upsertSpy).toHaveBeenLastCalledWith(expect.objectContaining({ id: rfq.id, vendorPlanPending: true }));
    expect(dispatchSpy).not.toHaveBeenCalled();

    // Once retry succeeds even with 0 new additions, completeRFQVendorPlan releases vendorPlanPending and dispatches ack.
    const plannedRfq = { ...rfq };
    jest.spyOn(storeService, 'augmentV0AssignmentsFromDB').mockResolvedValue(plannedRfq);
    const releasedRfq = { ...rfq, vendorPlanPending: false };
    const updateSpy = jest.spyOn(storeService, 'updateRFQDurably').mockResolvedValue(releasedRfq);

    const completed = await storeService.completeRFQVendorPlan(plannedRfq, { notifyShortfall: true });
    expect(updateSpy).toHaveBeenCalledWith(plannedRfq.id, { vendorPlanPending: false });
    expect(dispatchSpy).toHaveBeenCalledWith(1, [`rfq-created-email:${plannedRfq.id}`]);
    expect(completed).toEqual(releasedRfq);

    // _dispatchRFQCreatedEmailOutbox ignores ineligible inputs.
    expect(storeService._dispatchRFQCreatedEmailOutbox(null)).toBe(false);
    expect(storeService._dispatchRFQCreatedEmailOutbox({ id: 'no-ack' })).toBe(false);
  });
});
