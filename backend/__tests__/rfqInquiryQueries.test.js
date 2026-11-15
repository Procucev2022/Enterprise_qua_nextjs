const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const rfqInquiryQueries = require('../src/db/rfqInquiryQueries');
const { queryCache } = require('../src/db/queryCache');
const { logger } = require('../src/services/loggerService');

const previous = {
  id: 'rfq-inquiry-atomic',
  rfqNumber: 'RFQ-INQUIRY-ATOMIC',
  title: 'Previous',
  status: 'Quotes Pending',
  budget: 250,
};
const updated = { ...previous, title: 'Updated', inquiries: [{ id: 'inquiry-1' }] };
const snapshot = { id: previous.id, rfq: previous, raw: JSON.stringify(previous) };
const event = {
  id: 'retry:rfq_vendor_inquiry_ack_email:abc123',
  eventType: 'rfq_vendor_inquiry_ack_email',
  payload: { rfqId: previous.id, inquiryId: 'inquiry-1', messageId: 'message-1' },
};

describe('atomic RFQ inquiry and acknowledgement persistence', () => {
  afterEach(() => jest.restoreAllMocks());

  test('does not attempt durable writes without configured storage', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event)).resolves.toBeNull();
  });

  test('rejects incomplete persistence inputs before opening a transaction', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, null))
      .rejects.toMatchObject({ code: 'INVALID_RFQ_INQUIRY_PERSISTENCE' });
    expect(loggerSpy).not.toHaveBeenCalled();
  });

  test('falls back to the ordinary CAS writer when only the non-atomic D1 HTTP adapter is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });

    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event))
      .resolves.toEqual({ atomicUnsupported: true });
  });

  test('commits the RFQ and outbox insert through one D1 batch', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const batchSpy = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ raw: JSON.stringify(updated) }] },
      { rows: [{ id: event.id, status: 'pending' }] },
      { rows: [] },
    ]);
    const cacheSpy = jest.spyOn(queryCache, 'invalidate').mockImplementation(() => {});

    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event)).resolves.toEqual({
      rfq: updated,
      outboxEvent: { id: event.id, status: 'pending' },
    });
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const statements = batchSpy.mock.calls[0][1];
    expect(statements).toHaveLength(3);
    expect(statements[0].text).toContain('WHERE id = $1 AND raw = $8');
    expect(statements[0].text).not.toContain('::jsonb');
    expect(statements[1].text).toContain('WHERE EXISTS (SELECT 1 FROM rfqs WHERE id = $4 AND raw = $5)');
    expect(cacheSpy).toHaveBeenCalledWith('rfqs');
  });

  test('returns null without an outbox lookup when the D1 compare-and-swap loses', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const batchSpy = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event)).resolves.toBeNull();
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  test('reads an existing D1 outbox row when the idempotency key was already committed', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ raw: updated }] },
      { rows: [] },
      { rows: [{ id: event.id, status: 'completed' }] },
    ]);

    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event)).resolves.toMatchObject({
      outboxEvent: { id: event.id, status: 'completed' },
    });
  });

  test('updates RFQ and enqueues the email in a PostgreSQL transaction', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: updated }] })
      .mockResolvedValueOnce({ rows: [{ id: event.id, status: 'pending' }] });
    jest.spyOn(pool, 'withTransaction').mockImplementation((run) => run({ query }));

    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event)).resolves.toEqual({
      rfq: updated,
      outboxEvent: { id: event.id, status: 'pending' },
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('WHERE id = $1 AND raw = $8::jsonb');
    expect(query.mock.calls[1][0]).toContain('INSERT INTO event_outbox');
  });

  test('returns null when PostgreSQL reports a lost CAS update', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const query = jest.fn().mockResolvedValue({ rows: [] });
    jest.spyOn(pool, 'withTransaction').mockImplementation((run) => run({ query }));

    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('looks up an existing PostgreSQL idempotency row and errors if it is missing', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: updated }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: event.id, status: 'completed' }] });
    jest.spyOn(pool, 'withTransaction').mockImplementation((run) => run({ query }));
    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event)).resolves.toMatchObject({
      outboxEvent: { id: event.id, status: 'completed' },
    });

    jest.restoreAllMocks();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const missingQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: updated }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    jest.spyOn(pool, 'withTransaction').mockImplementation((run) => run({ query: missingQuery }));
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(snapshot, updated, event))
      .rejects.toThrow('RFQ inquiry transaction did not persist its acknowledgement outbox row.');
    expect(loggerSpy).toHaveBeenCalledWith(
      'Atomic RFQ inquiry and acknowledgement persistence failed',
      expect.objectContaining({ rfqId: updated.id, outboxId: event.id, provider: 'postgres' }),
      'RFQ_INQUIRY'
    );
  });

  test('normalizes budget values and parses string or object snapshots', () => {
    expect(rfqInquiryQueries.parseRaw(JSON.stringify(updated))).toEqual(updated);
    expect(rfqInquiryQueries.parseRaw(updated)).toEqual(updated);
    expect(rfqInquiryQueries.buildRFQParams({ ...updated, budget: 'not-a-number' }, { raw: previous })[5]).toBeNull();
    expect(rfqInquiryQueries.buildEventParams(event, updated)[4]).toBe(JSON.stringify(updated));
  });

  test('labels malformed stored RFQ JSON as an invalid persisted record', () => {
    expect(() => rfqInquiryQueries.parseRaw('{')).toThrow(expect.objectContaining({
      code: 'INVALID_PERSISTED_RECORD',
    }));
  });
});
