const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const queries = require('../src/db/vendorQuoteSubmissionQueries');

const RFQ_ID = 'rfq-atomic-quote';
const VENDOR_ID = 'vendor-atomic-quote';
const rfq = (overrides = {}) => ({
  id: RFQ_ID,
  rfqNumber: 'RFQ-ATOMIC-QUOTE',
  category: 'Pumps',
  status: 'Open',
  sourcingMode: 'mode_1',
  budget: 1000,
  quotes: [],
  quotesCount: 0,
  assignedVendors: [],
  ...overrides,
});
const vendor = (overrides = {}) => ({
  id: VENDOR_ID,
  name: 'Atomic Vendor',
  subscriptionPlan: 'free_trial',
  freeQuotationCredits: 2,
  freeRfqDownloadCredits: 2,
  quotedRfqIds: [],
  unlockedRfqIds: [],
  ...overrides,
});
const baseOptions = (overrides = {}) => {
  const expectedRFQ = rfq();
  const expectedVendor = vendor();
  const updatedRFQ = rfq({
    status: 'In Evaluation',
    quotes: [{ vendorId: VENDOR_ID, unitPrice: 250 }],
    quotesCount: 1,
  });
  return {
    vendorId: VENDOR_ID,
    rfqId: RFQ_ID,
    rfqNumber: expectedRFQ.rfqNumber,
    transactionId: 'tx-atomic-quote',
    idempotencyKey: `rfq-quote:${VENDOR_ID}:${RFQ_ID}`,
    isBuyerMapped: false,
    isResubmission: false,
    expectedVendor,
    expectedRFQ,
    updatedRFQ,
    ...overrides,
  };
};
const d1Rows = ({ initialVendor = vendor(), savedVendor = vendor({ freeQuotationCredits: 1, freeRfqDownloadCredits: 1, quotedRfqIds: [RFQ_ID], unlockedRfqIds: [RFQ_ID, 'RFQ-ATOMIC-QUOTE'] }), savedRFQ = rfq({ status: 'In Evaluation', quotes: [{ vendorId: VENDOR_ID, unitPrice: 250 }], quotesCount: 1 }), existingLedger = null, newLedger = { id: 'tx-atomic-quote', amount: -1 } } = {}) => [
  { rows: [{ raw: initialVendor }] },
  { rows: [{ raw: rfq() }] },
  { rows: existingLedger ? [existingLedger] : [] },
  { rows: [{ raw: savedRFQ }] },
  { rows: [{ raw: savedVendor }] },
  { rows: newLedger ? [newLedger] : [] },
];

describe('atomic vendor quote submission queries', () => {
  afterEach(() => jest.restoreAllMocks());

  test('builds one guarded D1 batch for RFQ, vendor, and ledger writes', () => {
    const built = queries.makeD1VendorQuoteSubmissionStatements(baseOptions());
    expect(built.statements).toHaveLength(6);
    expect(built.statements[3].text).toContain('raw = $9');
    expect(built.statements[3].text).toContain('freeQuotationCredits');
    expect(built.statements[4].text).toContain('changes() > 0');
    expect(built.statements[5].text).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(built.creditCharged).toBe(1);
    expect(built.updatedVendor.freeQuotationCredits).toBe(1);
  });

  test('adds a quote email intent to the same D1 batch as the quote and credit writes', () => {
    const built = queries.makeD1VendorQuoteSubmissionStatements(baseOptions({
      quoteId: 'quote-atomic-1',
      quoteNotificationEventId: 'outbox-quote-atomic-1',
      quoteNotificationRecipient: 'buyer@example.test',
      quoteNotificationRecipientName: 'Buyer Org',
    }));
    const event = built.statements[6];

    expect(built.statements).toHaveLength(7);
    expect(event.text).toContain('INSERT OR IGNORE INTO event_outbox');
    expect(event.text).toContain("json_each(CASE");
    expect(event.text).toContain("'$.quotes'");
    expect(event.params).toEqual([
      'outbox-quote-atomic-1',
      'rfq_quote_received_email',
      RFQ_ID,
      'quote-atomic-1',
      'buyer@example.test',
      'Buyer Org',
    ]);
  });

  test('rejects an incomplete durable quote notification intent', () => {
    expect(() => queries.makeD1VendorQuoteSubmissionStatements(baseOptions({
      quoteNotificationEventId: 'outbox-quote-invalid',
      quoteNotificationRecipient: 'buyer@example.test',
    }))).toThrow(expect.objectContaining({ code: 'INVALID_VENDOR_QUOTE_SUBMISSION' }));
  });

  test('adds an auto-closure acknowledgement to the same D1 batch as the closing quote', () => {
    const built = queries.makeD1VendorQuoteSubmissionStatements(baseOptions({
      quoteId: 'quote-closing-1',
      autoClosureEmailEventId: 'outbox-auto-close-1',
      autoClosureRecipientEmail: 'buyer@example.test',
      autoClosureRecipientName: 'Buyer Org',
      updatedRFQ: rfq({ status: 'Closed', quotes: [{ id: 'quote-closing-1', vendorId: VENDOR_ID }] }),
    }));
    const event = built.statements[6];

    expect(built.statements).toHaveLength(7);
    expect(event.text).toContain('INSERT OR IGNORE INTO event_outbox');
    expect(event.text).toContain("r.status = 'Closed'");
    expect(event.text).toContain("json_each(CASE");
    expect(event.params).toEqual([
      'outbox-auto-close-1',
      'rfq_auto_closure_ack_email',
      RFQ_ID,
      'quote-closing-1',
      'buyer@example.test',
      'Buyer Org',
    ]);
  });

  test('rejects an incomplete durable auto-closure acknowledgement intent', () => {
    expect(() => queries.makeD1VendorQuoteSubmissionStatements(baseOptions({
      autoClosureEmailEventId: 'outbox-auto-close-invalid',
      autoClosureRecipientEmail: 'buyer@example.test',
    }))).toThrow(expect.objectContaining({ code: 'INVALID_VENDOR_QUOTE_SUBMISSION' }));
  });

  test('builds a zero-charge resubmission when the vendor already has an RFQ marker', () => {
    const options = baseOptions({ expectedVendor: vendor({ freeQuotationCredits: 0, quotedRfqIds: [RFQ_ID] }) });
    const built = queries.makeD1VendorQuoteSubmissionStatements(options);
    expect(built.alreadyQuoted).toBe(true);
    expect(built.creditCharged).toBe(0);
    expect(built.updatedVendor.freeQuotationCredits).toBe(0);
  });

  test('parses raw record variants and serializes snapshot inputs', () => {
    expect(queries.parseRaw('{"id":"rfq-parsed"}')).toEqual({ id: 'rfq-parsed' });
    expect(queries.parseRaw({ id: 'rfq-object' })).toEqual({ id: 'rfq-object' });
    expect(queries.parseRaw('[]')).toEqual({});
    expect(queries.parseRaw(null)).toEqual({});
    expect(() => queries.parseRaw('{invalid json')).toThrow(expect.objectContaining({ code: 'INVALID_RFQ_RECORD' }));
    expect(queries.serializeExpectedRaw('{"id":"raw"}')).toBe('{"id":"raw"}');
    expect(queries.serializeExpectedRaw({ id: 'object' })).toBe('{"id":"object"}');
    expect(queries.serializeExpectedRaw(null)).toBe('{}');
    expect(queries.isAlreadyQuoted(vendor(), RFQ_ID, null)).toBe(false);
    expect(queries.isAlreadyQuoted(vendor({ quotedRfqIds: [RFQ_ID] }), RFQ_ID, null)).toBe(true);
    expect(queries.isAlreadyQuoted(vendor(), RFQ_ID, { id: 'ledger' })).toBe(true);
  });

  test('builds nullable RFQ fields and zero-value ledger decisions', () => {
    const options = baseOptions({
      rfqNumber: null,
      isBuyerMapped: true,
      updatedRFQ: { id: RFQ_ID },
      expectedRFQ: JSON.stringify(rfq()),
      expectedVendor: JSON.stringify(vendor()),
    });
    const built = queries.makeD1VendorQuoteSubmissionStatements(options);
    expect(built.creditCharged).toBe(0);
    expect(built.statements[3].params.slice(2, 7)).toEqual([null, null, null, null, null]);
    expect(built.statements[4].params[3]).toBeNull();
  });

  test('does nothing when storage is not configured and validates required snapshots', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(queries.submitVendorQuoteInDB(baseOptions())).resolves.toBeNull();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    await expect(queries.submitVendorQuoteInDB({ vendorId: VENDOR_ID })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_VENDOR_QUOTE_SUBMISSION',
    });
  });

  test('commits the RFQ, vendor balance, and ledger in one PostgreSQL transaction', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const savedVendor = vendor({ freeQuotationCredits: 1, freeRfqDownloadCredits: 1, quotedRfqIds: [RFQ_ID], unlockedRfqIds: [RFQ_ID, 'RFQ-ATOMIC-QUOTE'] });
    const savedRFQ = rfq({ status: 'In Evaluation', quotes: [{ vendorId: VENDOR_ID, unitPrice: 250 }], quotesCount: 1 });
    const ledger = { id: 'tx-atomic-quote', vendor_id: VENDOR_ID, amount: -1 };
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: savedVendor }] })
      .mockResolvedValueOnce({ rows: [{ raw: savedRFQ }] })
      .mockResolvedValueOnce({ rows: [ledger] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    const result = await queries.submitVendorQuoteInDB(baseOptions());

    expect(result).toMatchObject({ rfq: savedRFQ, vendor: savedVendor, creditCharged: 1 });
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[5][0]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  });

  test('queues the buyer quote email in the same PostgreSQL transaction', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const savedVendor = vendor({ freeQuotationCredits: 1, freeRfqDownloadCredits: 1 });
    const savedRFQ = rfq({ status: 'In Evaluation', quotes: [{ id: 'quote-pg-1', vendorId: VENDOR_ID }] });
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: savedVendor }] })
      .mockResolvedValueOnce({ rows: [{ raw: savedRFQ }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-atomic-quote', amount: -1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'outbox-quote-pg-1' }] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await queries.submitVendorQuoteInDB(baseOptions({
      quoteId: 'quote-pg-1',
      quoteNotificationEventId: 'outbox-quote-pg-1',
      quoteNotificationRecipient: 'buyer@example.test',
      quoteNotificationRecipientName: 'Buyer Org',
    }));

    expect(client.query).toHaveBeenCalledTimes(7);
    expect(client.query.mock.calls[6][0]).toContain('INSERT INTO event_outbox');
    expect(client.query.mock.calls[6][1]).toEqual([
      'outbox-quote-pg-1',
      'rfq_quote_received_email',
      JSON.stringify({
        rfqId: RFQ_ID,
        quoteId: 'quote-pg-1',
        recipientEmail: 'buyer@example.test',
        recipientName: 'Buyer Org',
      }),
    ]);
  });

  test('queues an auto-closure acknowledgement in the same PostgreSQL transaction', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const savedVendor = vendor({ freeQuotationCredits: 1, freeRfqDownloadCredits: 1 });
    const savedRFQ = rfq({ status: 'Closed', quotes: [{ id: 'quote-pg-close-1', vendorId: VENDOR_ID }] });
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: savedVendor }] })
      .mockResolvedValueOnce({ rows: [{ raw: savedRFQ }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-atomic-quote', amount: -1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'outbox-auto-close-pg-1' }] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await queries.submitVendorQuoteInDB(baseOptions({
      quoteId: 'quote-pg-close-1',
      autoClosureEmailEventId: 'outbox-auto-close-pg-1',
      autoClosureRecipientEmail: 'buyer@example.test',
      autoClosureRecipientName: 'Buyer Org',
      updatedRFQ: rfq({ status: 'Closed', quotes: [{ id: 'quote-pg-close-1', vendorId: VENDOR_ID }] }),
    }));

    expect(client.query).toHaveBeenCalledTimes(7);
    expect(client.query.mock.calls[6][0]).toContain('INSERT INTO event_outbox');
    expect(client.query.mock.calls[6][1]).toEqual([
      'outbox-auto-close-pg-1',
      'rfq_auto_closure_ack_email',
      JSON.stringify({
        rfqId: RFQ_ID,
        quoteId: 'quote-pg-close-1',
        recipientEmail: 'buyer@example.test',
        recipientName: 'Buyer Org',
      }),
    ]);
  });

  test('writes null optional RFQ columns for a sparse PostgreSQL quote update', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const updatedRFQ = { id: RFQ_ID };
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: updatedRFQ }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-sparse', amount: -1 }] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await queries.submitVendorQuoteInDB(baseOptions({ updatedRFQ }));

    expect(client.query.mock.calls[4][1]).toEqual([RFQ_ID, null, null, null, null, null, JSON.stringify(updatedRFQ)]);
  });

  test('returns missing and concurrent snapshot outcomes without writes', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
    await expect(queries.submitVendorQuoteInDB(baseOptions())).resolves.toEqual({ notFound: true });

    client.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ raw: vendor({ name: 'newer vendor state' }) }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] });
    await expect(queries.submitVendorQuoteInDB(baseOptions())).resolves.toEqual({ conflict: true });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('rejects exhausted PostgreSQL credits and leaves both rows unchanged', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const exhausted = vendor({ freeQuotationCredits: 0, freeRfqDownloadCredits: 0 });
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: exhausted }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
    await expect(queries.submitVendorQuoteInDB(baseOptions({ expectedVendor: exhausted }))).resolves.toMatchObject({
      creditsExhausted: true,
      freeCreditsRemaining: 0,
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('allows a replay without a second debit and records the missing zero-value ledger row', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const replayVendor = vendor({ freeQuotationCredits: 0, freeRfqDownloadCredits: 0, quotedRfqIds: [RFQ_ID] });
    const replayRFQ = rfq({ quotes: [{ vendorId: VENDOR_ID, unitPrice: 200 }] });
    const savedVendor = { ...replayVendor, unlockedRfqIds: [RFQ_ID, 'RFQ-ATOMIC-QUOTE'] };
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: replayVendor }] })
      .mockResolvedValueOnce({ rows: [{ raw: replayRFQ }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: savedVendor }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq({ ...replayRFQ, quotesCount: 1 }) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-replay', amount: 0 }] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    const result = await queries.submitVendorQuoteInDB(baseOptions({ expectedVendor: replayVendor, expectedRFQ: replayRFQ, isResubmission: true }));
    expect(result.creditCharged).toBe(0);
    expect(Math.abs(client.query.mock.calls[5][1][3])).toBe(0);
    expect(client.query).toHaveBeenCalledTimes(7);
  });

  test('rejects missing PostgreSQL row writes and a missing idempotency ledger', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] }) };
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    await expect(queries.submitVendorQuoteInDB(baseOptions())).rejects.toThrow('updated no persisted vendor or RFQ row');

    client.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(queries.submitVendorQuoteInDB(baseOptions())).rejects.toThrow('updated no persisted vendor or RFQ row');

    client.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ raw: vendor() }] })
      .mockResolvedValueOnce({ rows: [{ raw: rfq() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(queries.submitVendorQuoteInDB(baseOptions())).rejects.toThrow('did not persist its idempotency ledger');
  });

  test('rejects the non-atomic D1 HTTP adapter and records the failure', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });
    await expect(queries.submitVendorQuoteInDB(baseOptions())).rejects.toMatchObject({
      statusCode: 503,
      code: 'ATOMIC_PERSISTENCE_REQUIRED',
    });
  });

  test('commits through the D1 batch and returns its persisted rows', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue(d1Rows());
    const result = await queries.submitVendorQuoteInDB(baseOptions());
    expect(result.creditCharged).toBe(1);
    expect(result.rfq.quotesCount).toBe(1);
    expect(batch).toHaveBeenCalledWith(expect.any(Object), expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('changes() > 0') }),
    ]));
  });

  test('classifies missing D1 rows, stale snapshots, and exhausted credits', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    const batch = jest.spyOn(d1Bridge, 'batchD1');
    batch.mockResolvedValueOnce([{ rows: [] }, { rows: [{ raw: rfq() }] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    await expect(queries.submitVendorQuoteInDB(baseOptions())).resolves.toEqual({ notFound: true });

    batch.mockResolvedValueOnce([{ rows: [{ raw: vendor({ name: 'newer' }) }] }, { rows: [{ raw: rfq() }] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    await expect(queries.submitVendorQuoteInDB(baseOptions())).resolves.toEqual({ conflict: true });

    const noCredits = vendor({ freeQuotationCredits: 0, freeRfqDownloadCredits: 0 });
    batch.mockResolvedValueOnce([{ rows: [{ raw: noCredits }] }, { rows: [{ raw: rfq() }] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    await expect(queries.submitVendorQuoteInDB(baseOptions({ expectedVendor: noCredits }))).resolves.toMatchObject({
      creditsExhausted: true,
      freeCreditsRemaining: 0,
    });
  });

  test('reports failed D1 guarded writes and transaction errors', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    const batch = jest.spyOn(d1Bridge, 'batchD1');
    batch.mockResolvedValueOnce([{ rows: [{ raw: vendor() }] }, { rows: [{ raw: rfq() }] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    await expect(queries.submitVendorQuoteInDB(baseOptions())).resolves.toEqual({ conflict: true });

    batch.mockResolvedValueOnce([{ rows: [{ raw: vendor() }] }, { rows: [{ raw: rfq() }] }, { rows: [] }, { rows: [{ raw: rfq() }] }, { rows: [] }, { rows: [] }]);
    await expect(queries.submitVendorQuoteInDB(baseOptions())).rejects.toThrow('not followed by its vendor credit write');

    batch.mockResolvedValueOnce([{ rows: [{ raw: vendor() }] }, { rows: [{ raw: rfq() }] }, { rows: [] }, { rows: [{ raw: rfq() }] }, { rows: [{ raw: vendor() }] }, { rows: [] }]);
    await expect(queries.submitVendorQuoteInDB(baseOptions())).rejects.toThrow('did not persist its idempotency ledger');

    batch.mockRejectedValueOnce(new Error('D1 batch failed'));
    await expect(queries.submitVendorQuoteInDB(baseOptions())).rejects.toThrow('D1 batch failed');
  });

  test('accepts an existing ledger during a D1 replay without double charging', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
    const replayVendor = vendor({ freeQuotationCredits: 0, freeRfqDownloadCredits: 0, quotedRfqIds: [RFQ_ID] });
    const ledger = { id: 'existing-ledger', amount: -1 };
    const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue(d1Rows({
      initialVendor: replayVendor,
      existingLedger: ledger,
      newLedger: null,
      savedVendor: { ...replayVendor, unlockedRfqIds: [RFQ_ID, 'RFQ-ATOMIC-QUOTE'] },
      savedRFQ: rfq({ status: 'In Evaluation', quotes: [{ vendorId: VENDOR_ID, unitPrice: 250 }], quotesCount: 1 }),
    }));
    const result = await queries.submitVendorQuoteInDB(baseOptions({ expectedVendor: replayVendor, isResubmission: true }));
    expect(result).toMatchObject({ vendor: expect.any(Object), rfq: expect.any(Object), transaction: ledger });
    expect(result.creditCharged).toBe(0);
    expect(result.transaction).toBe(ledger);
    expect(batch).toHaveBeenCalledTimes(1);
  });
});
