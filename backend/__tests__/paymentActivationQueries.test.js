const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const paymentActivationQueries = require('../src/db/paymentActivationQueries');

const linkFixture = (overrides = {}) => ({
  id: 'payment-link-1',
  payerType: 'vendor',
  vendorId: 'vendor-1',
  planId: 'connect',
  billingDuration: null,
  zohoPaymentLinkId: 'zoho-link-1',
  activated: false,
  status: 'active',
  ...overrides,
});

describe('paymentActivationQueries', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool.queryCache, 'invalidate');
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  test('parses persisted JSON and rejects corrupt stored rows with a typed cause', () => {
    expect(paymentActivationQueries.parseRaw('{"id":"p1"}')).toEqual({ id: 'p1' });
    expect(paymentActivationQueries.parseRaw('[]')).toEqual({});
    expect(paymentActivationQueries.parseRaw([])).toEqual({});
    expect(() => paymentActivationQueries.parseRaw('{bad')).toThrow(expect.objectContaining({
      code: 'INVALID_PERSISTED_RECORD',
      cause: expect.any(Error),
    }));
  });

  test('builds buyer and vendor entitlements without losing plan-specific values', () => {
    expect(paymentActivationQueries.payerConfig(linkFixture({ payerType: 'buyer', buyerAccountId: 'buyer-1' })))
      .toEqual({ table: 'buyer_accounts', id: 'buyer-1', cacheTag: 'buyer_accounts', payerType: 'buyer' });
    expect(paymentActivationQueries.payerConfig(linkFixture({ payerType: 'buyer', buyerAccountId: null })))
      .toMatchObject({ table: 'buyer_accounts', id: null, payerType: 'buyer' });
    expect(paymentActivationQueries.payerConfig(linkFixture()))
      .toEqual({ table: 'vendors', id: 'vendor-1', cacheTag: 'vendors', payerType: 'vendor' });
    expect(paymentActivationQueries.updatedPayer({ id: 'buyer-1', remainingFreeRFQs: 0 }, linkFixture({
      payerType: 'buyer', buyerAccountId: 'buyer-1', planId: 'free_trial', billingDuration: 'monthly',
    }))).toMatchObject({ subscriptionPlan: 'free_trial', billingDuration: 'monthly', remainingFreeRFQs: 5 });
    expect(paymentActivationQueries.updatedPayer({ id: 'vendor-1', rfqDownloadsUsed: 8 }, linkFixture()))
      .toMatchObject({ subscriptionPlan: 'connect', rfqDownloadsUsed: 0 });
    expect(paymentActivationQueries.updatedPayer({ id: 'buyer-1', billingDuration: 'annual' }, linkFixture({
      payerType: 'buyer', buyerAccountId: 'buyer-1', planId: 'version_1', billingDuration: null,
    }))).toEqual({ id: 'buyer-1', billingDuration: 'annual', subscriptionPlan: 'version_1' });
    expect(paymentActivationQueries.updatedLink(linkFixture(), null, true)).toMatchObject({ status: 'PAID', activated: true });
  });

  test('builds D1 statements with scoped ownership and an activation guard', () => {
    const buyerLink = linkFixture({ payerType: 'buyer', buyerAccountId: 'buyer-1', planId: 'free_trial', billingDuration: 'annual' });
    const buyer = paymentActivationQueries.buyerUpdateStatement(buyerLink, paymentActivationQueries.payerConfig(buyerLink));
    const vendorLink = linkFixture();
    const vendor = paymentActivationQueries.vendorUpdateStatement(vendorLink, paymentActivationQueries.payerConfig(vendorLink));
    const payment = paymentActivationQueries.paymentLinkUpdateStatement(vendorLink, paymentActivationQueries.payerConfig(vendorLink), { event: 'paid' });
    const buyerPayment = paymentActivationQueries.paymentLinkUpdateStatement(buyerLink, paymentActivationQueries.payerConfig(buyerLink), null);

    expect(buyer.text).toContain("json_set(raw, '$.subscriptionPlan', $4, '$.billingDuration', $5, '$.remainingFreeRFQs', 5)");
    expect(buyer.text).toContain("json_extract(raw, '$.activated')");
    expect(vendor.text).toContain("'$.rfqDownloadsUsed', 0");
    expect(payment.text).toContain("json_extract(raw, '$.activated')");
    expect(payment.params[3]).toBe('{"event":"paid"}');
    expect(buyerPayment.text).toContain('buyer_account_id = $2');
    expect(buyerPayment.params[3]).toBe('null');
  });

  test('commits vendor plan, link activation, and quota reset in one PostgreSQL transaction', async () => {
    const link = linkFixture();
    const payer = { id: 'vendor-1', name: 'Vendor One', rfqDownloadsUsed: 5 };
    const savedPayer = { ...payer, subscriptionPlan: 'connect', rfqDownloadsUsed: 0 };
    const savedLink = { ...link, status: 'PAID', activated: true, rawResponse: { event: 'paid' } };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ raw: link }] })
        .mockResolvedValueOnce({ rows: [{ raw: payer }] })
        .mockResolvedValueOnce({ rows: [{ raw: savedPayer }] })
        .mockResolvedValueOnce({ rows: [{ raw: savedLink }] }),
    };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    const result = await paymentActivationQueries.activatePaymentLinkSubscriptionInDB({
      paymentLinkId: link.id,
      rawResponse: { event: 'paid' },
    });

    expect(result).toMatchObject({ activated: true, replayed: false, payerType: 'vendor', payer: savedPayer, link: savedLink });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][0]).toContain('FROM vendors');
    expect(client.query.mock.calls[2][0]).toContain('UPDATE vendors');
    expect(client.query.mock.calls[3][0]).toContain('UPDATE payment_links');
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('payment_links');
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('vendors');
  });

  test('returns the existing subscription for an already activated PostgreSQL payment link', async () => {
    const link = linkFixture({ activated: true, status: 'PAID' });
    const payer = { id: 'vendor-1', subscriptionPlan: 'connect' };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ raw: link }] })
        .mockResolvedValueOnce({ rows: [{ raw: payer }] }),
    };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await expect(paymentActivationQueries.activateInPostgres(link.id, {})).resolves.toMatchObject({
      activated: false,
      replayed: true,
      link,
      payer,
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('does not activate PostgreSQL links without a payer or persisted owner', async () => {
    const noPayerLink = linkFixture({ vendorId: null });
    const missingOwnerLink = linkFixture({ id: 'missing-owner-link' });
    const client = { query: jest.fn() };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));
    client.query.mockResolvedValueOnce({ rows: [{ raw: noPayerLink }] });
    await expect(paymentActivationQueries.activateInPostgres(noPayerLink.id, {})).rejects.toMatchObject({
      code: 'PAYMENT_ACTIVATION_CONFLICT',
      statusCode: 409,
    });
    client.query.mockResolvedValueOnce({ rows: [{ raw: missingOwnerLink }] }).mockResolvedValueOnce({ rows: [] });
    await expect(paymentActivationQueries.activateInPostgres(missingOwnerLink.id, {})).rejects.toMatchObject({
      code: 'PAYMENT_OWNER_NOT_FOUND',
      statusCode: 409,
    });
    client.query.mockResolvedValueOnce({ rows: [] });
    await expect(paymentActivationQueries.activateInPostgres('unknown-link', {})).resolves.toBeNull();
  });

  test('rolls back PostgreSQL activation when either row does not return its committed state', async () => {
    const link = linkFixture();
    const payer = { id: 'vendor-1', name: 'Vendor One' };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ raw: link }] })
        .mockResolvedValueOnce({ rows: [{ raw: payer }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback(client));

    await expect(paymentActivationQueries.activateInPostgres(link.id, {})).rejects.toThrow(
      'Payment activation transaction did not persist both rows.'
    );
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  test('runs D1 activation as one guarded batch and returns persisted rows', async () => {
    const binding = { batch: jest.fn() };
    const link = linkFixture();
    const payer = { id: 'vendor-1', name: 'Vendor One', subscriptionPlan: 'connect', rfqDownloadsUsed: 0 };
    const savedLink = { ...link, status: 'PAID', activated: true, rawResponse: { event: 'paid' } };
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: link }] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ raw: payer }], rowCount: 1 },
      { rows: [{ raw: savedLink }], rowCount: 1 },
      { rows: [{ raw: savedLink }], rowCount: 1 },
      { rows: [{ raw: payer }], rowCount: 1 },
    ]);
    jest.spyOn(pool.queryAuditor, 'auditQuery');

    const result = await paymentActivationQueries.activatePaymentLinkSubscriptionInDB({ paymentLinkId: link.id, rawResponse: { event: 'paid' } });

    expect(result).toMatchObject({ activated: true, replayed: false, payerType: 'vendor', payer, link: savedLink });
    expect(d1Bridge.batchD1).toHaveBeenCalledTimes(1);
    expect(d1Bridge.batchD1.mock.calls[0][1]).toHaveLength(4);
    expect(pool.queryAuditor.auditQuery).toHaveBeenCalled();
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('payment_links');
  });

  test('activates a buyer in D1, refreshes its plan and invalidates the account cache', async () => {
    const binding = {};
    const link = linkFixture({ payerType: 'buyer', buyerAccountId: 'buyer-1', vendorId: null, planId: 'free_trial' });
    const payer = { id: 'buyer-1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 };
    const savedLink = { ...link, status: 'PAID', activated: true };
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: link }] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ raw: payer }], rowCount: 1 },
      { rows: [{ raw: savedLink }], rowCount: 1 },
      { rows: [{ raw: savedLink }], rowCount: 1 },
      { rows: [{ raw: payer }], rowCount: 1 },
    ]);
    jest.spyOn(pool.queryAuditor, 'auditQuery');

    await expect(paymentActivationQueries.activatePaymentLinkSubscriptionInDB({ paymentLinkId: link.id, rawResponse: null }))
      .resolves.toMatchObject({ activated: true, payerType: 'buyer', payer });
    expect(d1Bridge.batchD1.mock.calls[0][1][0].text).toContain('UPDATE buyer_accounts');
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('buyer_accounts');
  });

  test('treats activated D1 rows as idempotent replays and returns a non-activated conflict unchanged', async () => {
    const binding = {};
    const link = linkFixture({ activated: true, status: 'PAID' });
    const payer = { id: 'vendor-1', subscriptionPlan: 'connect' };
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: link }] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [{ raw: link }], rowCount: 1 },
      { rows: [{ raw: payer }], rowCount: 1 },
    ]);

    await expect(paymentActivationQueries.activateInD1(link.id, {}, binding)).resolves.toMatchObject({ replayed: true, activated: false });
    const notActivatedLink = { ...link, activated: false, status: 'active' };
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: notActivatedLink }] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [{ raw: notActivatedLink }], rowCount: 1 },
      { rows: [{ raw: payer }], rowCount: 1 },
    ]);
    await expect(paymentActivationQueries.activateInD1(link.id, {}, binding)).resolves.toMatchObject({ replayed: false, activated: false });
  });

  test('handles missing storage, missing D1 link, and rejects the non-atomic HTTP adapter', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(paymentActivationQueries.activatePaymentLinkSubscriptionInDB({ paymentLinkId: 'p1' })).resolves.toBeNull();

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const binding = {};
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    await expect(paymentActivationQueries.activateInD1('missing', {}, binding)).resolves.toBeNull();

    const link = linkFixture();
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: link }] });
    jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    await expect(paymentActivationQueries.activateInD1(link.id, {}, binding)).resolves.toBeNull();

    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback({
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    }));
    await expect(paymentActivationQueries.activatePaymentLinkSubscriptionInDB({ paymentLinkId: 'missing-postgres' })).resolves.toBeNull();

    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });
    await expect(paymentActivationQueries.activatePaymentLinkSubscriptionInDB({ paymentLinkId: 'p1' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'ATOMIC_D1_BATCH_REQUIRED' });
  });

  test('updates payment status with a single activation-guarded D1 and Postgres statement', async () => {
    const updatedLink = linkFixture({ status: 'CANCELED', rawResponse: { event_id: 'evt-cancel' } });
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: updatedLink }] });

    await expect(paymentActivationQueries.updatePaymentLinkStatusInDB('payment-link-1', {
      status: 'CANCELED',
      rawResponse: { event_id: 'evt-cancel' },
    })).resolves.toEqual(updatedLink);

    const [postgresSql, params, options] = pool.query.mock.calls[0];
    expect(postgresSql).toContain("COALESCE(raw->>'activated', 'false') <> 'true'");
    expect(postgresSql).toContain('RETURNING raw');
    expect(options).toMatchObject({ d1: true, useCache: false, tag: 'payment_links' });
    expect(options.d1Text).toContain("COALESCE(json_extract(raw, '$.activated'), 0) <> 1");
    expect(params).toEqual(['payment-link-1', 'CANCELED', JSON.stringify({ event_id: 'evt-cancel' }), expect.any(String)]);
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('payment_links');
  });

  test('returns null without writing when payment status input or storage is unavailable', async () => {
    jest.spyOn(pool, 'query');
    await expect(paymentActivationQueries.updatePaymentLinkStatusInDB('', { status: 'PAID' })).resolves.toBeNull();
    await expect(paymentActivationQueries.updatePaymentLinkStatusInDB('link-1', {})).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();

    pool.hasStorage.mockReturnValue(false);
    await expect(paymentActivationQueries.updatePaymentLinkStatusInDB('link-1', { status: 'PAID' })).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('returns null when the atomic status update is guarded by an existing activation', async () => {
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await expect(paymentActivationQueries.updatePaymentLinkStatusInDB('payment-link-1', { status: 'EXPIRED' }))
      .resolves.toBeNull();

    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('payment_links');
  });
});
