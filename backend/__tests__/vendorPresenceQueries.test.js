const pool = require('../src/db/pool');
const vendorPresenceQueries = require('../src/db/vendorPresenceQueries');

describe('vendorPresenceQueries', () => {
  afterEach(() => jest.restoreAllMocks());

  it('upserts a heartbeat and returns the persisted row', async () => {
    const row = { identifier: 'vendor@example.com', vendor_id: 'vendor-1', status: 'online', last_active_at: 1000 };
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [row] });

    await expect(vendorPresenceQueries.upsertVendorPresence({
      identifier: row.identifier,
      vendorId: row.vendor_id,
      status: row.status,
      timestamp: 1000,
      writeCutoff: 900,
    })).resolves.toBe(row);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (identifier)'), [
      row.identifier,
      row.vendor_id,
      row.status,
      1000,
      900,
    ], { d1: true });
    expect(query.mock.calls[0][0]).toContain('SELECT id FROM vendors WHERE email = $1');
  });

  it('reads the existing row when the write was throttled', async () => {
    const row = { identifier: 'vendor@example.com', vendor_id: 'vendor-1', status: 'online', last_active_at: 1000 };
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] });

    await expect(vendorPresenceQueries.upsertVendorPresence({
      identifier: row.identifier,
      vendorId: row.vendor_id,
      status: row.status,
      timestamp: 1000,
      writeCutoff: 900,
    })).resolves.toBe(row);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('SELECT identifier, vendor_id, status, last_active_at');
  });

  it('returns null if a throttled row disappeared before it could be read', async () => {
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await expect(vendorPresenceQueries.upsertVendorPresence({
      identifier: 'vendor@example.com',
      vendorId: 'vendor-1',
      status: 'online',
      timestamp: 1000,
      writeCutoff: 900,
    })).resolves.toBeNull();
  });

  it('handles database adapters that omit the rows array', async () => {
    const query = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await expect(vendorPresenceQueries.upsertVendorPresence({
      identifier: 'vendor@example.com',
      vendorId: 'vendor-1',
      status: 'online',
      timestamp: 1000,
      writeCutoff: 900,
    })).resolves.toBeNull();
    await expect(vendorPresenceQueries.getVendorPresenceByIdentifiers(['vendor@example.com']))
      .resolves.toEqual([]);
    await expect(vendorPresenceQueries.getRecentOnlineVendorPresence({ cutoff: 500, limit: 100 }))
      .resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('does not query for an empty identifier list', async () => {
    const query = jest.spyOn(pool, 'query');
    await expect(vendorPresenceQueries.getVendorPresenceByIdentifiers([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('queries matching email and vendor identifiers with bound parameters', async () => {
    const rows = [{ identifier: 'vendor@example.com', vendor_id: 'vendor-1' }];
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows });
    await expect(vendorPresenceQueries.getVendorPresenceByIdentifiers(['vendor@example.com', 'vendor-1']))
      .resolves.toBe(rows);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('identifier IN ($1, $2) OR vendor_id IN ($3, $4)'), [
      'vendor@example.com', 'vendor-1', 'vendor@example.com', 'vendor-1',
    ], { d1: true });
  });

  it('loads a bounded set of recent online rows', async () => {
    const rows = [{ identifier: 'vendor@example.com' }];
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows });
    await expect(vendorPresenceQueries.getRecentOnlineVendorPresence({ cutoff: 500, limit: 100 })).resolves.toBe(rows);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'online'"), [500, 100], { d1: true });
  });
});
