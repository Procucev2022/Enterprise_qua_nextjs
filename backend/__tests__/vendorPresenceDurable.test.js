const pool = require('../src/db/pool');
const vendorPresenceQueries = require('../src/db/vendorPresenceQueries');
const vendorPresenceService = require('../src/services/vendorPresenceService');
const { PRESENCE_ONLINE_THRESHOLD_MS } = require('../src/config/constants');

describe('vendorPresenceService durable adapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    vendorPresenceService.resetAll();
  });

  it('uses memory presence when no database is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const result = await vendorPresenceService.recordHeartbeatDurably({
      identifier: 'Memory@Example.com',
      timestamp: 1000,
    });
    expect(result.success).toBe(true);
    expect(vendorPresenceService.isVendorOnline('memory@example.com', 1000)).toBe(true);
    await expect(vendorPresenceService.getPresenceDurably(['memory@example.com'], 1000))
      .resolves.toMatchObject({ onlineVendors: ['memory@example.com'] });
  });

  it('rejects invalid durable writes through the existing identifier validation', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const upsert = jest.spyOn(vendorPresenceQueries, 'upsertVendorPresence');
    await expect(vendorPresenceService.recordHeartbeatDurably({ identifier: '' }))
      .resolves.toMatchObject({ success: false, error: 'Identifier is required.' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes normalized identity and returns the database timestamp', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const upsert = jest.spyOn(vendorPresenceQueries, 'upsertVendorPresence').mockResolvedValue({
      identifier: 'vendor@example.com',
      vendor_id: 'vendor-1',
      status: 'online',
      last_active_at: 2000,
    });
    const result = await vendorPresenceService.recordHeartbeatDurably({
      identifier: ' Vendor@Example.com ',
      vendorId: ' VENDOR-1 ',
      timestamp: 2000,
    });
    expect(result).toMatchObject({
      success: true,
      identifier: 'vendor@example.com',
      isOnline: true,
      lastActive: new Date(2000).toISOString(),
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      identifier: 'vendor@example.com',
      vendorId: 'vendor-1',
      status: 'online',
      timestamp: 2000,
    }));
  });

  it('records offline status and treats old rows as offline', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const upsert = jest.spyOn(vendorPresenceQueries, 'upsertVendorPresence').mockResolvedValue({
      identifier: 'vendor@example.com',
      vendor_id: 'vendor-1',
      status: 'offline',
      last_active_at: 1000,
    });
    const result = await vendorPresenceService.recordHeartbeatDurably({
      identifier: 'vendor@example.com',
      status: 'offline',
      timestamp: 1000,
    });
    expect(result.isOnline).toBe(false);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline' }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ vendorId: null }));
  });

  it('does not store email or overlong values as a vendor ID alias', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const upsert = jest.spyOn(vendorPresenceQueries, 'upsertVendorPresence').mockResolvedValue({
      identifier: 'vendor@example.com',
      vendor_id: null,
      status: 'online',
      last_active_at: 2000,
    });

    await vendorPresenceService.recordHeartbeatDurably({
      identifier: 'vendor@example.com',
      vendorId: 'vendor@example.com',
      timestamp: 2000,
    });
    await vendorPresenceService.recordHeartbeatDurably({
      identifier: 'vendor@example.com',
      vendorId: 'v'.repeat(65),
      timestamp: 4000,
    });

    expect(upsert.mock.calls.map(([params]) => params.vendorId)).toEqual([null, null]);
  });

  it('fails closed and logs when configured storage cannot write', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(vendorPresenceQueries, 'upsertVendorPresence').mockRejectedValue(new Error('db down'));
    await expect(vendorPresenceService.recordHeartbeatDurably({ identifier: 'vendor@example.com' }))
      .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
  });

  it('maps durable email and vendor ID aliases to current online status', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(vendorPresenceQueries, 'getVendorPresenceByIdentifiers').mockResolvedValue([{
      identifier: 'vendor@example.com',
      vendor_id: 'vendor-1',
      status: 'online',
      last_active_at: 9000,
    }]);
    const result = await vendorPresenceService.getPresenceDurably(
      ['VENDOR@example.com', 'vendor-1', 'missing@example.com'],
      10000
    );
    expect(result.onlineVendors).toEqual(['vendor@example.com', 'vendor-1']);
    expect(result.details['vendor-1'].isOnline).toBe(true);
    expect(result.details['missing@example.com']).toEqual({ isOnline: false, lastActive: undefined });
  });

  it('treats stale, future, and offline durable rows as offline', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const now = PRESENCE_ONLINE_THRESHOLD_MS + 10;
    jest.spyOn(vendorPresenceQueries, 'getVendorPresenceByIdentifiers').mockResolvedValue([
      { identifier: 'stale@example.com', vendor_id: '', status: 'online', last_active_at: 1 },
      { identifier: 'future@example.com', vendor_id: null, status: 'online', last_active_at: now + 10000 },
      { identifier: 'offline@example.com', vendor_id: null, status: 'offline', last_active_at: now - 1000 },
    ]);
    const result = await vendorPresenceService.getPresenceDurably(
      ['stale@example.com', 'future@example.com', 'offline@example.com'],
      now
    );
    expect(result.onlineVendors).toEqual([]);
    expect(result.details['stale@example.com'].lastActive).toBe(new Date(1).toISOString());
  });

  it('loads a capped recent online list when no identifiers are provided', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const recent = jest.spyOn(vendorPresenceQueries, 'getRecentOnlineVendorPresence').mockResolvedValue([
      { identifier: 'vendor@example.com', vendor_id: 'vendor-1', status: 'online', last_active_at: 10000 },
    ]);
    const result = await vendorPresenceService.getPresenceDurably(undefined, 10000);
    expect(result.onlineVendors).toEqual(['vendor@example.com', 'vendor-1']);
    expect(recent).toHaveBeenCalledWith(expect.objectContaining({ limit: expect.any(Number) }));
  });

  it('deduplicates and bounds the configured-store identifier query', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const lookup = jest.spyOn(vendorPresenceQueries, 'getVendorPresenceByIdentifiers').mockResolvedValue([]);
    const tooMany = Array.from({ length: 105 }, (_, index) => `vendor-${index}`);
    await vendorPresenceService.getPresenceDurably([...tooMany, 'VENDOR-1']);
    expect(lookup.mock.calls[0][0]).toHaveLength(100);
    expect(lookup.mock.calls[0][0][1]).toBe('vendor-1');
  });

  it('fails closed and logs when configured storage cannot read', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(vendorPresenceQueries, 'getVendorPresenceByIdentifiers').mockRejectedValue(new Error('db down'));
    await expect(vendorPresenceService.getPresenceDurably(['vendor@example.com']))
      .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
  });
});
