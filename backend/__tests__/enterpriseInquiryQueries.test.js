const pool = require('../src/db/pool');
const enterpriseInquiryQueries = require('../src/db/enterpriseInquiryQueries');
const { logger } = require('../src/services/loggerService');

const DB_ROW = {
  id: 'ent-inq-test-1',
  company_name: 'Demo Company',
  email: 'buyer@example.test',
  mobile: '+919876543210',
  buyer_account_id: null,
  notes: '',
  status: 'NEW',
  contacted_by: null,
  contacted_at: null,
  created_at: new Date('2026-11-01T00:00:00.000Z'),
  updated_at: '2026-11-01T00:00:00.000Z',
};

describe('enterpriseInquiryQueries', () => {
  beforeEach(() => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [DB_ROW] });
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test('maps database rows to the API record shape and handles empty input', () => {
    expect(enterpriseInquiryQueries.mapInquiry(null)).toBeNull();
    expect(enterpriseInquiryQueries.mapInquiry(DB_ROW)).toEqual({
      id: 'ent-inq-test-1',
      companyName: 'Demo Company',
      email: 'buyer@example.test',
      mobile: '+919876543210',
      buyerAccountId: null,
      notes: '',
      status: 'NEW',
      contactedBy: null,
      contactedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(enterpriseInquiryQueries.mapInquiry({
      ...DB_ROW,
      buyer_account_id: 'buyer-1',
      notes: 'Follow up',
      contacted_by: 'Manager',
      contacted_at: new Date('2026-11-02T00:00:00.000Z'),
    })).toMatchObject({
      buyerAccountId: 'buyer-1',
      notes: 'Follow up',
      contactedBy: 'Manager',
      contactedAt: '2026-11-02T00:00:00.000Z',
    });
  });

  test('creates an inquiry through the shared PostgreSQL and D1 query boundary', async () => {
    const result = await enterpriseInquiryQueries.createEnterpriseInquiry({
      companyName: ' Demo Company ',
      email: ' Buyer@Example.test ',
      mobile: ' +919876543210 ',
      notes: ' Call next week ',
    });

    expect(result.created).toBe(true);
    expect(result.inquiry.id).toMatch(/^ent-inq-/);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO enterprise_inquiries'),
      expect.arrayContaining(['Demo Company', 'buyer@example.test', '+919876543210', null, ' Call next week ']),
      { d1: true }
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Enterprise inquiry persistence completed',
      expect.objectContaining({ operation: 'create', inquiryId: result.inquiry.id, created: true }),
      'ENTERPRISE_INQUIRIES'
    );
  });

  test('fails closed if the database has not returned a created row', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(enterpriseInquiryQueries.createEnterpriseInquiry({
      companyName: 'Demo Company', email: 'buyer@example.test', mobile: '+919876543210',
    })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(logger.error).toHaveBeenCalledWith(
      'Enterprise inquiry database operation failed; refusing process-local fallback',
      expect.objectContaining({ operation: 'create' }),
      'ENTERPRISE_INQUIRIES'
    );
  });

  test('reuses the saved record for duplicate idempotency keys without creating another row', async () => {
    const duplicateId = 'ent-inq-b714f6d8-83a1-4f34-9d89-72ebddb1186d';
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...DB_ROW, id: duplicateId }] });
    const result = await enterpriseInquiryQueries.createEnterpriseInquiry({
      companyName: 'Retry Company',
      email: 'retry@example.test',
      mobile: '+919876543210',
      idempotencyKey: 'b714f6d8-83a1-4f34-9d89-72ebddb1186d',
    });
    expect(result).toEqual({ inquiry: expect.objectContaining({ id: duplicateId }), created: false });
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM enterprise_inquiries WHERE id = $1'),
      ['ent-inq-b714f6d8-83a1-4f34-9d89-72ebddb1186d'],
      { d1: true }
    );
  });

  test('wraps query failures and preserves an existing persistence error', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection dropped'));
    await expect(enterpriseInquiryQueries.createEnterpriseInquiry({
      companyName: 'Demo Company', email: 'buyer@example.test', mobile: '+919876543210',
    })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', cause: expect.any(Error) });

    const unavailable = Object.assign(new Error('already wrapped'), { code: 'PERSISTENCE_UNAVAILABLE' });
    pool.query.mockRejectedValueOnce(unavailable);
    await expect(enterpriseInquiryQueries.getEnterpriseInquiries()).rejects.toBe(unavailable);
  });

  test('lists newest database records with a bounded limit and maps empty results', async () => {
    await expect(enterpriseInquiryQueries.getEnterpriseInquiries(12)).resolves.toEqual([
      expect.objectContaining({ id: 'ent-inq-test-1' }),
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at DESC, id DESC'),
      [12],
      { d1: true, useCache: false }
    );

    pool.query.mockResolvedValueOnce({ rows: [null] });
    await expect(enterpriseInquiryQueries.getEnterpriseInquiries(800)).resolves.toEqual([]);
    expect(pool.query).toHaveBeenLastCalledWith(expect.any(String), [500], { d1: true, useCache: false });

    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(enterpriseInquiryQueries.getEnterpriseInquiries('bad')).resolves.toEqual([]);
    expect(pool.query).toHaveBeenLastCalledWith(expect.any(String), [100], { d1: true, useCache: false });
  });

  test('loads one inquiry by id without using the query cache', async () => {
    await expect(enterpriseInquiryQueries.getEnterpriseInquiryById('ent-inq-test-1'))
      .resolves.toMatchObject({ id: 'ent-inq-test-1', email: 'buyer@example.test' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM enterprise_inquiries WHERE id = $1 LIMIT 1'),
      ['ent-inq-test-1'],
      { d1: true, useCache: false }
    );

    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(enterpriseInquiryQueries.getEnterpriseInquiryById('missing')).resolves.toBeNull();
    pool.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(enterpriseInquiryQueries.getEnterpriseInquiryById('outage'))
      .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  });

  test('updates all supported fields and returns null for empty updates or missing rows', async () => {
    await expect(enterpriseInquiryQueries.updateEnterpriseInquiry('ent-inq-test-1', {
      status: 'CONTACTED',
      notes: 'Call next week',
      contactedBy: 'Ops Manager',
      contactedAt: '2026-11-03T00:00:00.000Z',
    })).resolves.toMatchObject({ id: 'ent-inq-test-1' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('contacted_at = $4'),
      ['CONTACTED', 'Call next week', 'Ops Manager', '2026-11-03T00:00:00.000Z', 'ent-inq-test-1'],
      { d1: true }
    );

    await expect(enterpriseInquiryQueries.updateEnterpriseInquiry('x', {})).resolves.toBeNull();
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(enterpriseInquiryQueries.updateEnterpriseInquiry('missing', { notes: '' })).resolves.toBeNull();
  });

  test('reports persistence outages without attempting filesystem or process-local recovery', async () => {
    pool.hasStorage.mockReturnValue(false);
    await expect(enterpriseInquiryQueries.getEnterpriseInquiries()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: expect.any(Error),
    });
    expect(pool.query).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Enterprise inquiry database operation failed; refusing process-local fallback',
      expect.objectContaining({ operation: 'list' }),
      'ENTERPRISE_INQUIRIES'
    );
  });

  test('does not query when background delivery lookup has no storage', async () => {
    pool.hasStorage.mockReturnValue(false);
    await expect(enterpriseInquiryQueries.getEnterpriseInquiryById('ent-inq-test-1'))
      .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
