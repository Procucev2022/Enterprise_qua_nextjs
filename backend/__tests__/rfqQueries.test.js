// ==============================================================================
// RFQ QUERIES
// ==============================================================================
// The query function is injected, so the SQL and the mapping are verified without
// a MySQL connection. The behaviour that matters most here is the org scoping:
// every read must carry buyer_org_id in its WHERE clause, because a read that
// does not is exactly how one buyer's RFQs reached another buyer's dashboard.
// ==============================================================================

const rfqQueries = require('../src/db/rfqQueries');
const { RFQ_PERSISTENCE } = require('../src/config/constants');

const { RFQ_TABLE } = RFQ_PERSISTENCE;

const ORG = 'org-buyer-01';

function dbRow(overrides = {}) {
  return {
    id: 41,
    rfq_id: 'RFQ260409000512',
    buyer_org_id: ORG,
    buyer_user_id: 'usr-buyer-001',
    buyer_email: 'buyer@procucev.com',
    title: 'Mechanical Spares Procurement',
    major_category: 'Engineering Spares - Mechanical',
    sourcing_mode: 'mode_2',
    status: 'Quotes Pending',
    source: 'manual_entry',
    source_file_name: 'BOQ.xlsx',
    budget: '348000.00',
    target_delivery_date: '2026-09-30',
    delivery_location: 'Navi Mumbai Plant, Gate 3',
    delivery_pincode: '400701',
    items_json: JSON.stringify([{ id: 'e1', itemName: 'Pump' }]),
    attachments_json: JSON.stringify([{ id: 'a1', fileName: 'annexure.pdf' }]),
    ai_summary_json: JSON.stringify({ headline: 'One pump' }),
    created_at: new Date('2026-09-04T10:00:00Z'),
    updated_at: new Date('2026-09-04T11:00:00Z'),
    ...overrides,
  };
}

describe('rfqQueries.parseJsonColumn', () => {
  test('parses a stored document', () => {
    expect(rfqQueries.parseJsonColumn('[1,2]', [], 'items_json')).toEqual([1, 2]);
  });

  test.each([[null], [undefined], ['']])('returns the fallback for %p', (value) => {
    expect(rfqQueries.parseJsonColumn(value, 'fallback', 'items_json')).toBe('fallback');
  });

  test('returns the fallback for a stored null', () => {
    expect(rfqQueries.parseJsonColumn('null', 'fallback', 'items_json')).toBe('fallback');
  });

  // One unreadable row must not take a whole listing down with it.
  test('returns the fallback rather than throwing on malformed JSON', () => {
    expect(rfqQueries.parseJsonColumn('{not json', [], 'items_json')).toEqual([]);
  });
});

describe('rfqQueries.toJsonColumn', () => {
  test('serialises a populated value', () => {
    expect(rfqQueries.toJsonColumn([{ a: 1 }])).toBe('[{"a":1}]');
  });

  test.each([[null], [undefined]])('stores %p as SQL NULL', (value) => {
    expect(rfqQueries.toJsonColumn(value)).toBeNull();
  });

  // NULL rather than '[]' so the column distinguishes "nothing stored" from
  // "an empty document".
  test('stores an empty array as SQL NULL', () => {
    expect(rfqQueries.toJsonColumn([])).toBeNull();
  });
});

describe('rfqQueries.mapRowToRFQ', () => {
  test('maps every column to the shape the frontend consumes', () => {
    const rfq = rfqQueries.mapRowToRFQ(dbRow());

    expect(rfq.id).toBe('41');
    // The Java scheme id is the human-facing number, so both names carry it.
    expect(rfq.rfqId).toBe('RFQ260409000512');
    expect(rfq.rfqNumber).toBe('RFQ260409000512');
    expect(rfq.title).toBe('Mechanical Spares Procurement');
    expect(rfq.category).toBe('Engineering Spares - Mechanical');
    // DECIMAL arrives as a string from mysql2 and must not reach the UI that way.
    expect(rfq.budget).toBe(348000);
    expect(typeof rfq.budget).toBe('number');
    expect(rfq.extractedEntities).toEqual([{ id: 'e1', itemName: 'Pump' }]);
    expect(rfq.attachments).toHaveLength(1);
    expect(rfq.aiSummary).toEqual({ headline: 'One pump' });
    expect(rfq.raisedByEmail).toBe('buyer@procucev.com');
    expect(rfq.createdAt).toBe('2026-09-04T10:00:00.000Z');
    expect(rfq.updatedAt).toBe('2026-09-04T11:00:00.000Z');
  });

  // Authorisation inputs, not display data. The client has no use for them and
  // shipping them would widen the payload for no reason.
  test('never returns the ownership columns', () => {
    const rfq = rfqQueries.mapRowToRFQ(dbRow());
    expect(rfq.buyerOrgId).toBeUndefined();
    expect(rfq.buyer_org_id).toBeUndefined();
    expect(rfq.buyerUserId).toBeUndefined();
  });

  test('substitutes defaults for every nullable column', () => {
    const rfq = rfqQueries.mapRowToRFQ(
      dbRow({
        major_category: null,
        sourcing_mode: null,
        status: null,
        source: null,
        source_file_name: null,
        budget: null,
        target_delivery_date: null,
        delivery_location: null,
        delivery_pincode: null,
        items_json: null,
        attachments_json: null,
        ai_summary_json: null,
      })
    );

    expect(rfq.category).toBe('');
    expect(rfq.sourcingMode).toBe('mode_1');
    expect(rfq.status).toBe('Quotes Pending');
    expect(rfq.source).toBeUndefined();
    expect(rfq.sourceFileName).toBeUndefined();
    expect(rfq.budget).toBe(0);
    expect(rfq.targetDeliveryDate).toBe('');
    expect(rfq.deliveryLocation).toBe('');
    expect(rfq.deliveryPincode).toBe('');
    expect(rfq.extractedEntities).toEqual([]);
    expect(rfq.attachments).toEqual([]);
    expect(rfq.aiSummary).toBeNull();
  });

  // Some drivers and mocks hand timestamps back as strings.
  test('passes a string timestamp through unchanged', () => {
    const rfq = rfqQueries.mapRowToRFQ(dbRow({ created_at: '2026-09-04 10:00:00', updated_at: null }));
    expect(rfq.createdAt).toBe('2026-09-04 10:00:00');
    expect(rfq.updatedAt).toBeNull();
  });

  // Quotations are not modelled yet. Reported as empty rather than omitted so the
  // dashboard reads one shape either way.
  test('reports quotations as empty rather than omitting them', () => {
    const rfq = rfqQueries.mapRowToRFQ(dbRow());
    expect(rfq.quotes).toEqual([]);
    expect(rfq.quotesCount).toBe(0);
    expect(rfq.chasingActive).toBe(false);
  });
});

describe('rfqQueries.insertRFQ', () => {
  test('writes every column and returns the row it read back', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([dbRow()]);

    const created = await rfqQueries.insertRFQ(
      {
        rfqId: 'RFQ260409000512',
        buyerOrgId: ORG,
        buyerUserId: 'usr-buyer-001',
        buyerEmail: 'buyer@procucev.com',
        title: 'Mechanical Spares Procurement',
        category: 'Engineering Spares - Mechanical',
        budget: 348000,
        extractedEntities: [{ id: 'e1' }],
      },
      { query, now: new Date('2026-09-04T10:00:00Z') }
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`INSERT INTO \`${RFQ_TABLE}\``);
    // Parameterised, never interpolated.
    expect(params[0]).toBe('RFQ260409000512');
    expect(params[1]).toBe(ORG);
    expect(created.rfqId).toBe('RFQ260409000512');
  });

  test('coerces a missing budget to zero and unset columns to NULL', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([dbRow()]);

    await rfqQueries.insertRFQ(
      { rfqId: 'RFQ1', buyerOrgId: ORG, buyerUserId: 'u', buyerEmail: 'e', title: 'T' },
      { query }
    );

    const params = query.mock.calls[0][1];
    expect(params).toContain(0);
    expect(params.filter((p) => p === null).length).toBeGreaterThan(0);
  });

  // A write that cannot be read back means the row is not owned by the
  // organisation it was written for, which would be invisible in the UI.
  test('fails loudly when the inserted row cannot be read back', async () => {
    const query = jest.fn().mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce([]);

    await expect(
      rfqQueries.insertRFQ(
        { rfqId: 'RFQ1', buyerOrgId: ORG, buyerUserId: 'u', buyerEmail: 'e', title: 'T' },
        { query }
      )
    ).rejects.toThrow('RFQ1 was inserted but could not be read back');
  });
});

describe('rfqQueries.listRFQsByOrg', () => {
  test('filters by organisation and orders newest first', async () => {
    const query = jest.fn(async () => [dbRow(), dbRow({ id: 42 })]);
    const list = await rfqQueries.listRFQsByOrg(ORG, { query });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE buyer_org_id = ?');
    // Matches idx_qua_rfq_org_created, so this does not filesort.
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(params).toEqual([ORG]);
    expect(list).toHaveLength(2);
  });

  // Without an organisation there is nothing to scope by, and returning
  // everything instead would be the leak this module exists to prevent.
  test.each([[undefined], [null], ['']])('returns nothing for an org id of %p', async (orgId) => {
    const query = jest.fn();
    expect(await rfqQueries.listRFQsByOrg(orgId, { query })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test('tolerates a driver returning no rows object', async () => {
    const query = jest.fn(async () => null);
    expect(await rfqQueries.listRFQsByOrg(ORG, { query })).toEqual([]);
  });
});

describe('rfqQueries.findRFQByRfqId', () => {
  test('scopes the lookup by organisation inside the WHERE clause', async () => {
    const query = jest.fn(async () => [dbRow()]);
    const found = await rfqQueries.findRFQByRfqId('RFQ260409000512', ORG, { query });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE rfq_id = ? AND buyer_org_id = ?');
    expect(params).toEqual(['RFQ260409000512', ORG]);
    expect(found.rfqId).toBe('RFQ260409000512');
  });

  // Same answer as a nonexistent id, so the endpoint cannot be used to probe
  // what other organisations have raised.
  test('returns null when the organisation does not own it', async () => {
    const query = jest.fn(async () => []);
    expect(await rfqQueries.findRFQByRfqId('RFQ260409000512', 'other-org', { query })).toBeNull();
  });

  test.each([
    ['', ORG],
    ['RFQ1', ''],
  ])('returns null without querying for (%p, %p)', async (rfqId, orgId) => {
    const query = jest.fn();
    expect(await rfqQueries.findRFQByRfqId(rfqId, orgId, { query })).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('rfqQueries.findRFQByAnyId', () => {
  test('accepts the RFQ number', async () => {
    const query = jest.fn(async () => [dbRow()]);
    const found = await rfqQueries.findRFQByAnyId('RFQ260409000512', ORG, { query });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('buyer_org_id = ? AND (rfq_id = ? OR id = ?)');
    expect(params).toEqual([ORG, 'RFQ260409000512', null]);
    expect(found.rfqId).toBe('RFQ260409000512');
  });

  // A numeric identifier is passed as a number so it can match the surrogate key
  // as well as the RFQ number.
  test('accepts the surrogate row id', async () => {
    const query = jest.fn(async () => [dbRow()]);
    await rfqQueries.findRFQByAnyId('41', ORG, { query });
    expect(query.mock.calls[0][1]).toEqual([ORG, '41', 41]);
  });

  test('returns null when nothing matches', async () => {
    const query = jest.fn(async () => []);
    expect(await rfqQueries.findRFQByAnyId('missing', ORG, { query })).toBeNull();
  });

  test.each([
    ['', ORG],
    ['RFQ1', null],
  ])('returns null without querying for (%p, %p)', async (identifier, orgId) => {
    const query = jest.fn();
    expect(await rfqQueries.findRFQByAnyId(identifier, orgId, { query })).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('rfqQueries.countRFQsByOrg', () => {
  test('counts within the organisation', async () => {
    const query = jest.fn(async () => [{ total: 7 }]);
    expect(await rfqQueries.countRFQsByOrg(ORG, { query })).toBe(7);
    expect(query.mock.calls[0][1]).toEqual([ORG]);
  });

  test.each([[[]], [[{}]], [null]])('reports zero for %p', async (rows) => {
    const query = jest.fn(async () => rows);
    expect(await rfqQueries.countRFQsByOrg(ORG, { query })).toBe(0);
  });

  test('reports zero without querying when there is no organisation', async () => {
    const query = jest.fn();
    expect(await rfqQueries.countRFQsByOrg('', { query })).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

// There must be no way to ask this module for RFQs across organisations. A helper
// that returned everything would let the original leak regress the moment
// somebody reached for it.
describe('rfqQueries surface', () => {
  test('exposes no unscoped listing function', () => {
    const unscoped = Object.keys(rfqQueries).filter((name) =>
      /^(getAll|listAll|findAll|getRFQs)$/.test(name)
    );
    expect(unscoped).toEqual([]);
  });

  // Every scoped read must refuse to touch the database when it has no
  // organisation to filter by, rather than falling back to returning everything.
  test.each([
    ['listRFQsByOrg', [undefined], []],
    ['findRFQByRfqId', ['RFQ1', undefined], null],
    ['findRFQByAnyId', ['RFQ1', undefined], null],
    ['countRFQsByOrg', [undefined], 0],
  ])('%s refuses to query without an organisation', async (fnName, args, expected) => {
    const query = jest.fn();
    const result = await rfqQueries[fnName](...args, { query });
    expect(result).toEqual(expected);
    expect(query).not.toHaveBeenCalled();
  });
});

// ==============================================================================
// EDIT AND DELETE
// ==============================================================================
// Both are scoped the same way as the reads: buyer_org_id sits in the WHERE
// clause, so an attempt on another organisation's RFQ touches zero rows and
// reports the same "not found" as an id that does not exist. The column whitelist
// matters just as much — a write that looped over the request body could move an
// RFQ to another organisation.
// ==============================================================================

describe('rfqQueries.updateRFQ', () => {
  /** Records the UPDATE, then answers the read-back with the given row. */
  function updateSpy(affectedRows = 1, row = dbRow()) {
    const calls = [];
    const query = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/^\s*UPDATE/.test(sql)) return { affectedRows };
      return [row];
    });
    return { query, calls };
  }

  test('writes only the fields the edit named', async () => {
    const { query, calls } = updateSpy();

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { title: 'Revised title' }, { query });

    const update = calls[0];
    expect(update.sql).toContain(`UPDATE \`${RFQ_TABLE}\``);
    expect(update.sql).toContain('title = ?');
    expect(update.sql).not.toContain('delivery_location = ?');
    expect(update.sql).not.toContain('status = ?');
  });

  // Without this an edit could hand an RFQ to another organisation.
  test.each([
    ['rfqId', { rfqId: 'RFQ-SOMEONE-ELSE' }],
    ['buyerOrgId', { buyerOrgId: 'org-attacker' }],
    ['buyerUserId', { buyerUserId: 'usr-attacker' }],
    ['buyerEmail', { buyerEmail: 'attacker@example.com' }],
    ['createdAt', { createdAt: '2000-01-01' }],
    ['id', { id: '999' }],
  ])('refuses to write %s', async (_field, changes) => {
    const { query, calls } = updateSpy();

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, changes, { query });

    // Nothing writable was named, so no UPDATE is issued at all.
    expect(calls.every((c) => !/^\s*UPDATE/.test(c.sql))).toBe(true);
  });

  test('scopes the write to the organisation', async () => {
    const { query, calls } = updateSpy();

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { status: 'In Evaluation' }, { query });

    const update = calls[0];
    expect(update.sql).toContain('WHERE rfq_id = ? AND buyer_org_id = ?');
    expect(update.params.slice(-2)).toEqual(['RFQ260409000512', ORG]);
  });

  test('stamps updated_at', async () => {
    const now = new Date('2026-09-06T09:15:00Z');
    const { query, calls } = updateSpy();

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { title: 'Revised' }, { query, now });

    expect(calls[0].sql).toContain('updated_at = ?');
    expect(calls[0].params).toContain(now);
  });

  test('serialises the JSON columns', async () => {
    const { query, calls } = updateSpy();
    const items = [{ id: 'e1', itemName: 'Pump' }];

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { extractedEntities: items }, { query });

    expect(calls[0].sql).toContain('items_json = ?');
    expect(calls[0].params[0]).toBe(JSON.stringify(items));
  });

  test('stores an emptied collection as NULL', async () => {
    const { query, calls } = updateSpy();

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { attachments: [] }, { query });

    expect(calls[0].params[0]).toBeNull();
  });

  test('coerces the budget and treats a non-number as none', async () => {
    const { query, calls } = updateSpy();

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { budget: '250000' }, { query });
    expect(calls[0].params[0]).toBe(250000);

    const second = updateSpy();
    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { budget: 'not a number' }, { query: second.query });
    expect(second.calls[0].params[0]).toBe(0);
  });

  // A cleared optional field and one that was never set must read alike.
  test('stores a cleared field as NULL', async () => {
    const { query, calls } = updateSpy();

    await rfqQueries.updateRFQ('RFQ260409000512', ORG, { deliveryPincode: '' }, { query });

    expect(calls[0].params[0]).toBeNull();
  });

  test('returns the stored record, not the requested change', async () => {
    const { query } = updateSpy(1, dbRow({ title: 'What the database holds' }));

    const updated = await rfqQueries.updateRFQ(
      'RFQ260409000512',
      ORG,
      { title: 'What the caller sent' },
      { query }
    );

    expect(updated.title).toBe('What the database holds');
    expect(updated.rfqNumber).toBe('RFQ260409000512');
  });

  // Zero affected rows means the id did not match *under this organisation*.
  test('reports nothing when the RFQ belongs to another organisation', async () => {
    const { query } = updateSpy(0);

    const updated = await rfqQueries.updateRFQ('RFQ260409000512', ORG, { title: 'Revised' }, { query });

    expect(updated).toBeNull();
  });

  // A save that changes nothing writable is not a failure.
  test('returns the current record when the edit named no writable field', async () => {
    const { query, calls } = updateSpy();

    const result = await rfqQueries.updateRFQ('RFQ260409000512', ORG, {}, { query });

    expect(result.rfqNumber).toBe('RFQ260409000512');
    expect(calls.every((c) => !/^\s*UPDATE/.test(c.sql))).toBe(true);
  });

  test.each([
    ['no rfq id', '', ORG],
    ['no organisation', 'RFQ260409000512', ''],
  ])('refuses to write with %s', async (_case, rfqId, orgId) => {
    const query = jest.fn();

    await expect(rfqQueries.updateRFQ(rfqId, orgId, { title: 'X' }, { query })).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('rfqQueries.deleteRFQ', () => {
  test('deletes the row, scoped to the organisation', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 1 });

    const removed = await rfqQueries.deleteRFQ('RFQ260409000512', ORG, { query });

    expect(removed).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`DELETE FROM \`${RFQ_TABLE}\``);
    expect(sql).toContain('WHERE rfq_id = ? AND buyer_org_id = ?');
    expect(params).toEqual(['RFQ260409000512', ORG]);
  });

  test('reports false when the RFQ belongs to another organisation', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 0 });

    await expect(rfqQueries.deleteRFQ('RFQ260409000512', ORG, { query })).resolves.toBe(false);
  });

  test('tolerates a driver that reports no affectedRows', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await expect(rfqQueries.deleteRFQ('RFQ260409000512', ORG, { query })).resolves.toBe(false);
  });

  test.each([
    ['no rfq id', '', ORG],
    ['no organisation', 'RFQ260409000512', ''],
  ])('refuses to delete with %s', async (_case, rfqId, orgId) => {
    const query = jest.fn();

    await expect(rfqQueries.deleteRFQ(rfqId, orgId, { query })).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
