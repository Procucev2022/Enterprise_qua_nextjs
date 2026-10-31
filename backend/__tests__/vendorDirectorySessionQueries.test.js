const vendorDirectorySessionQueries = require('../src/db/vendorDirectorySessionQueries');
const pool = require('../src/db/pool');
const {
  VENDOR_DIRECTORY_SESSION_STATUS,
  VENDOR_DIRECTORY_LOGOUT_REASONS,
  VENDOR_DIRECTORY_AUTH_CONFIG,
} = require('../src/config/constants');

describe('vendorDirectorySessionQueries', () => {
  beforeEach(() => {
    vendorDirectorySessionQueries.clearMemoryStoreForTesting();
    jest.clearAllMocks();
  });

  afterEach(() => {
    vendorDirectorySessionQueries.clearMemoryStoreForTesting();
    jest.restoreAllMocks();
  });

  describe('toIsoString helper', () => {
    test('handles null, undefined, and empty string', () => {
      expect(vendorDirectorySessionQueries.toIsoString(null)).toBeNull();
      expect(vendorDirectorySessionQueries.toIsoString(undefined)).toBeNull();
      expect(vendorDirectorySessionQueries.toIsoString('')).toBeNull();
    });

    test('handles valid and invalid Date objects', () => {
      const now = new Date();
      expect(vendorDirectorySessionQueries.toIsoString(now)).toBe(now.toISOString());

      const invalidDate = new Date('invalid');
      expect(vendorDirectorySessionQueries.toIsoString(invalidDate)).toBeNull();
    });

    test('handles timestamp strings and numbers', () => {
      const ts = 1730000000000;
      expect(vendorDirectorySessionQueries.toIsoString(ts)).toBe(new Date(ts).toISOString());
      expect(vendorDirectorySessionQueries.toIsoString(String(ts))).toBe(new Date(ts).toISOString());
    });

    test('handles SQL datetime strings without timezone', () => {
      const sqlDate = '2026-10-29 10:30:00';
      const iso = vendorDirectorySessionQueries.toIsoString(sqlDate);
      expect(iso).toBe('2026-10-29T10:30:00.000Z');
    });

    test('handles invalid string by returning null', () => {
      expect(vendorDirectorySessionQueries.toIsoString('not-a-date')).toBeNull();
    });
  });

  describe('mapRowToSession helper', () => {
    test('returns null for falsy row', () => {
      expect(vendorDirectorySessionQueries.mapRowToSession(null)).toBeNull();
      expect(vendorDirectorySessionQueries.mapRowToSession(undefined)).toBeNull();
    });

    test('maps raw row with explicit duration', () => {
      const row = {
        id: 'sess-123',
        user_uuid: 'u-1',
        email: 'CM@PROCUCEV.COM',
        role: 'category_manager',
        auth_method: 'EMAIL_OTP',
        login_at: '2026-10-29T10:00:00.000Z',
        last_activity_at: '2026-10-29T10:05:00.000Z',
        logout_at: '2026-10-29T10:05:00.000Z',
        duration_seconds: 300,
        logout_reason: 'MANUAL',
        status: 'CLOSED',
        ip_address: '1.2.3.4',
        user_agent: 'JestAgent',
        created_at: '2026-10-29T10:00:00.000Z',
      };

      const session = vendorDirectorySessionQueries.mapRowToSession(row);
      expect(session).toEqual({
        id: 'sess-123',
        userUuid: 'u-1',
        email: 'cm@procucev.com',
        role: 'category_manager',
        authMethod: 'EMAIL_OTP',
        loginAt: '2026-10-29T10:00:00.000Z',
        lastActivityAt: '2026-10-29T10:05:00.000Z',
        logoutAt: '2026-10-29T10:05:00.000Z',
        durationSeconds: 300,
        logoutReason: 'MANUAL',
        status: 'CLOSED',
        ipAddress: '1.2.3.4',
        userAgent: 'JestAgent',
        createdAt: '2026-10-29T10:00:00.000Z',
      });
    });

    test('calculates duration_seconds if omitted or zero when logout_at is present, and falls back to loginAt for missing last_activity_at/created_at', () => {
      const row = {
        id: 'sess-124',
        user_uuid: 'u-2',
        email: 'cm2@procucev.com',
        login_at: '2026-10-29T10:00:00.000Z',
        last_activity_at: null, // tests fallback to loginAt
        logout_at: '2026-10-29T10:02:30.000Z',
        created_at: null, // tests fallback to loginAt
        duration_seconds: 0,
      };

      const session = vendorDirectorySessionQueries.mapRowToSession(row);
      expect(session.durationSeconds).toBe(150);
      expect(session.lastActivityAt).toBe('2026-10-29T10:00:00.000Z');
      expect(session.createdAt).toBe('2026-10-29T10:00:00.000Z');
      expect(session.role).toBe(VENDOR_DIRECTORY_AUTH_CONFIG.REQUIRED_ROLE);
      expect(session.authMethod).toBe('EMAIL_OTP');
      expect(session.status).toBe(VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE);
    });
  });

  describe('createSession', () => {
    test('creates session successfully writing to DB and memory store', async () => {
      const poolSpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const session = await vendorDirectorySessionQueries.createSession({
        id: 'sess-test-1',
        userUuid: 'user-cm-1',
        email: 'cm.user@procucev.com',
        role: 'category_manager',
        authMethod: 'EMAIL_OTP',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(session.id).toBe('sess-test-1');
      expect(session.userUuid).toBe('user-cm-1');
      expect(session.email).toBe('cm.user@procucev.com');
      expect(session.status).toBe(VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE);
      expect(poolSpy).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO vendor_directory_sessions'),
        expect.any(Array),
        { d1: true }
      );
    });

    test('supports userId fallback when userUuid is omitted', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      const session = await vendorDirectorySessionQueries.createSession({
        userId: 'fallback-user-id',
        email: 'uid@procucev.com',
      });
      expect(session.userUuid).toBe('fallback-user-id');
    });

    test('handles DB write failure gracefully with memory fallback', async () => {
      jest.spyOn(pool, 'query').mockRejectedValue(new Error('DB Connection Timeout'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const session = await vendorDirectorySessionQueries.createSession({
        email: 'FALLBACK@PROCUCEV.COM',
      });

      expect(session.id).toBeDefined();
      expect(session.email).toBe('fallback@procucev.com');
      expect(session.status).toBe(VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('findSessionById', () => {
    test('returns null for empty id', async () => {
      expect(await vendorDirectorySessionQueries.findSessionById('')).toBeNull();
      expect(await vendorDirectorySessionQueries.findSessionById(null)).toBeNull();
    });

    test('finds session from DB when present', async () => {
      const row = {
        id: 'sess-find-1',
        user_uuid: 'u-find-1',
        email: 'found@procucev.com',
        role: 'category_manager',
        status: 'ACTIVE',
        login_at: new Date().toISOString(),
      };
      jest.spyOn(pool, 'rows').mockResolvedValue([row]);

      const session = await vendorDirectorySessionQueries.findSessionById('sess-find-1');
      expect(session).not.toBeNull();
      expect(session.id).toBe('sess-find-1');
      expect(session.email).toBe('found@procucev.com');
    });

    test('falls back to memory store when DB throws error', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      await vendorDirectorySessionQueries.createSession({
        id: 'sess-mem-only',
        email: 'mem@procucev.com',
      });

      jest.spyOn(pool, 'rows').mockRejectedValue(new Error('DB read error'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const found = await vendorDirectorySessionQueries.findSessionById('sess-mem-only');
      expect(found).not.toBeNull();
      expect(found.id).toBe('sess-mem-only');
      expect(found.email).toBe('mem@procucev.com');
    });

    test('returns null if not in DB and not in memory', async () => {
      jest.spyOn(pool, 'rows').mockResolvedValue([]);
      expect(await vendorDirectorySessionQueries.findSessionById('non-existent')).toBeNull();
    });
  });

  describe('findActiveSession', () => {
    test('returns null for empty id', async () => {
      expect(await vendorDirectorySessionQueries.findActiveSession('')).toBeNull();
    });

    test('returns active session from DB', async () => {
      const row = {
        id: 'sess-act-1',
        user_uuid: 'u-act-1',
        email: 'act@procucev.com',
        status: VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE,
        login_at: new Date().toISOString(),
      };
      jest.spyOn(pool, 'rows').mockResolvedValue([row]);

      const session = await vendorDirectorySessionQueries.findActiveSession('sess-act-1');
      expect(session).not.toBeNull();
      expect(session.status).toBe(VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE);
    });

    test('falls back to memory store if DB fails and session is active', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      await vendorDirectorySessionQueries.createSession({
        id: 'sess-mem-act',
        email: 'actmem@procucev.com',
      });

      jest.spyOn(pool, 'rows').mockRejectedValue(new Error('DB failure'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const session = await vendorDirectorySessionQueries.findActiveSession('sess-mem-act');
      expect(session).not.toBeNull();
      expect(session.id).toBe('sess-mem-act');
    });

    test('returns null if DB returns no rows and memory store is empty', async () => {
      jest.spyOn(pool, 'rows').mockResolvedValue([]);
      expect(await vendorDirectorySessionQueries.findActiveSession('sess-no-rows')).toBeNull();
    });

    test('returns null if memory session is CLOSED when DB fails', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      await vendorDirectorySessionQueries.createSession({
        id: 'sess-closed',
        email: 'closed@procucev.com',
      });
      await vendorDirectorySessionQueries.closeSession('sess-closed');

      jest.spyOn(pool, 'rows').mockRejectedValue(new Error('DB failure'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      expect(await vendorDirectorySessionQueries.findActiveSession('sess-closed')).toBeNull();
    });
  });

  describe('updateSessionActivity', () => {
    test('returns false for empty id', async () => {
      expect(await vendorDirectorySessionQueries.updateSessionActivity('')).toBe(false);
    });

    test('updates activity timestamp in DB and memory', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      await vendorDirectorySessionQueries.createSession({
        id: 'sess-act-upd',
        email: 'update@procucev.com',
      });

      const updated = await vendorDirectorySessionQueries.updateSessionActivity('sess-act-upd');
      expect(updated).toBe(true);

      const mem = await vendorDirectorySessionQueries.findSessionById('sess-act-upd');
      expect(mem.lastActivityAt).toBeDefined();
    });

    test('updates activity in DB even if not present in memory store', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      const updated = await vendorDirectorySessionQueries.updateSessionActivity('sess-db-only-id');
      expect(updated).toBe(true);
    });

    test('returns false if session in memory is already closed', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      await vendorDirectorySessionQueries.createSession({ id: 'sess-closed-act' });
      await vendorDirectorySessionQueries.closeSession('sess-closed-act');

      const result = await vendorDirectorySessionQueries.updateSessionActivity('sess-closed-act');
      expect(result).toBe(false);
    });

    test('handles DB error gracefully during activity update', async () => {
      jest.spyOn(pool, 'query').mockResolvedValueOnce({ rowCount: 1 }); // create
      await vendorDirectorySessionQueries.createSession({ id: 'sess-act-err' });

      jest.spyOn(pool, 'query').mockRejectedValue(new Error('DB Timeout'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await vendorDirectorySessionQueries.updateSessionActivity('sess-act-err');
      expect(result).toBe(true); // updated in memory
    });
  });

  describe('closeSession', () => {
    test('returns null if id is empty or session not found', async () => {
      expect(await vendorDirectorySessionQueries.closeSession('')).toBeNull();
      jest.spyOn(pool, 'rows').mockResolvedValue([]);
      expect(await vendorDirectorySessionQueries.closeSession('not-found')).toBeNull();
    });

    test('closes session with reason and calculates duration', async () => {
      const now = Date.now();
      const loginIso = new Date(now - 120000).toISOString(); // 2 mins ago
      const row = {
        id: 'sess-to-close',
        user_uuid: 'u-close',
        email: 'close@procucev.com',
        login_at: loginIso,
        status: 'ACTIVE',
      };

      jest.spyOn(pool, 'rows').mockResolvedValue([row]);
      const updateSpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const closed = await vendorDirectorySessionQueries.closeSession('sess-to-close', {
        logoutReason: VENDOR_DIRECTORY_LOGOUT_REASONS.MANUAL,
        logoutAt: new Date(),
      });

      expect(closed).not.toBeNull();
      expect(closed.status).toBe(VENDOR_DIRECTORY_SESSION_STATUS.CLOSED);
      expect(closed.logoutReason).toBe(VENDOR_DIRECTORY_LOGOUT_REASONS.MANUAL);
      expect(closed.durationSeconds).toBeGreaterThanOrEqual(119);
      expect(updateSpy).toHaveBeenCalled();
    });

    test('handles DB error during closeSession with memory update', async () => {
      jest.spyOn(pool, 'query').mockResolvedValueOnce({ rowCount: 1 });
      await vendorDirectorySessionQueries.createSession({ id: 'sess-err-close' });

      jest.spyOn(pool, 'query').mockRejectedValue(new Error('DB error on close'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const closed = await vendorDirectorySessionQueries.closeSession('sess-err-close');
      expect(closed).not.toBeNull();
      expect(closed.status).toBe(VENDOR_DIRECTORY_SESSION_STATUS.CLOSED);
    });
  });

  describe('listSessionHistory', () => {
    test('queries DB with all filter conditions and pagination', async () => {
      jest.spyOn(pool, 'rows')
        .mockResolvedValueOnce([{ total: 1 }]) // count
        .mockResolvedValueOnce([
          {
            id: 'sess-hist-1',
            user_uuid: 'u-1',
            email: 'hist@procucev.com',
            status: 'CLOSED',
            login_at: '2026-10-29T10:00:00.000Z',
          },
        ]); // list

      const result = await vendorDirectorySessionQueries.listSessionHistory({
        email: 'hist@procucev.com',
        userUuid: 'u-1',
        status: 'CLOSED',
        logoutReason: 'MANUAL',
        startDate: '2026-10-29T00:00:00.000Z',
        endDate: '2026-10-29T23:59:59.000Z',
        limit: 10,
        page: 1,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.sessions).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    test('falls back to memory filtering when DB query fails', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      await vendorDirectorySessionQueries.createSession({
        id: 'sess-m1',
        email: 'filter@procucev.com',
        userUuid: 'u-filt',
      });
      await vendorDirectorySessionQueries.createSession({
        id: 'sess-m2',
        email: 'other@procucev.com',
      });

      jest.spyOn(pool, 'rows').mockRejectedValue(new Error('DB read error'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const resAll = await vendorDirectorySessionQueries.listSessionHistory();
      expect(resAll.total).toBe(2);

      const resEmail = await vendorDirectorySessionQueries.listSessionHistory({
        email: 'filter@procucev.com',
        userUuid: 'u-filt',
        status: VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE,
        startDate: new Date(Date.now() - 60000).toISOString(),
        endDate: new Date(Date.now() + 60000).toISOString(),
      });
      expect(resEmail.total).toBe(1);
      expect(resEmail.sessions[0].id).toBe('sess-m1');

      const resReason = await vendorDirectorySessionQueries.listSessionHistory({
        logoutReason: 'NON_EXISTENT',
      });
      expect(resReason.total).toBe(0);
    });
  });

  describe('reconcileAbandonedSessions', () => {
    test('reconciles stale active sessions in DB and memory', async () => {
      const now = Date.now();
      const staleLoginIso = new Date(now - 600000).toISOString();
      const staleActIso = new Date(now - 400000).toISOString(); // 400s ago (> 300s)

      const staleRow = {
        id: 'sess-stale-1',
        login_at: staleLoginIso,
        last_activity_at: staleActIso,
      };

      // Populate memory store too so in-memory update branch is covered
      const memStore = vendorDirectorySessionQueries.getMemoryStoreForTesting();
      memStore.set('sess-stale-1', {
        id: 'sess-stale-1',
        loginAt: staleLoginIso,
        lastActivityAt: staleActIso,
        status: VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE,
      });

      jest.spyOn(pool, 'rows').mockResolvedValue([staleRow]);
      const updateSpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const result = await vendorDirectorySessionQueries.reconcileAbandonedSessions(300);
      expect(result.reconciledCount).toBe(1);
      expect(result.reconciledIds).toContain('sess-stale-1');
      expect(updateSpy).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE vendor_directory_sessions'),
        expect.arrayContaining([
          'sess-stale-1',
          VENDOR_DIRECTORY_SESSION_STATUS.CLOSED,
          expect.any(String),
          VENDOR_DIRECTORY_LOGOUT_REASONS.INACTIVITY,
          expect.any(Number),
        ]),
        { d1: true }
      );
    });

    test('reconciles in-memory store when DB query fails', async () => {
      jest.spyOn(pool, 'query').mockResolvedValueOnce({ rowCount: 1 });
      await vendorDirectorySessionQueries.createSession({
        id: 'sess-mem-stale',
        email: 'stale@procucev.com',
      });

      // Update in-memory entry to be stale
      const memStore = vendorDirectorySessionQueries.getMemoryStoreForTesting();
      const mem = memStore.get('sess-mem-stale');
      mem.lastActivityAt = new Date(Date.now() - 600000).toISOString();

      jest.spyOn(pool, 'rows').mockRejectedValue(new Error('DB check error'));
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await vendorDirectorySessionQueries.reconcileAbandonedSessions();
      expect(result.reconciledCount).toBe(1);
      expect(result.reconciledIds).toContain('sess-mem-stale');

      const updated = await vendorDirectorySessionQueries.findSessionById('sess-mem-stale');
      expect(updated.status).toBe(VENDOR_DIRECTORY_SESSION_STATUS.CLOSED);
      expect(updated.logoutReason).toBe(VENDOR_DIRECTORY_LOGOUT_REASONS.INACTIVITY);
    });
  });

  describe('isTableMissingError helper', () => {
    test('detects table missing errors correctly', () => {
      expect(vendorDirectorySessionQueries.isTableMissingError(null)).toBe(false);
      expect(vendorDirectorySessionQueries.isTableMissingError(undefined)).toBe(false);
      expect(vendorDirectorySessionQueries.isTableMissingError(new Error('no such table: vendor_directory_sessions'))).toBe(true);
      expect(vendorDirectorySessionQueries.isTableMissingError(new Error('relation "vendor_directory_sessions" does not exist'))).toBe(true);
      expect(vendorDirectorySessionQueries.isTableMissingError(new Error('table vendor_directory_sessions not found'))).toBe(true);
      expect(vendorDirectorySessionQueries.isTableMissingError(new Error('error: undefined table'))).toBe(true);
      expect(vendorDirectorySessionQueries.isTableMissingError(new Error('connection timeout'))).toBe(false);
    });
  });

  describe('ensureVendorDirectorySessionsTable self-healing', () => {
    test('creates table and indexes successfully', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 0 });

      await vendorDirectorySessionQueries.ensureVendorDirectorySessionsTable();

      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS vendor_directory_sessions'),
        [],
        { d1: true }
      );
    });

    test('handles index creation failure gracefully', async () => {
      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rowCount: 0 }) // table create succeeds
        .mockRejectedValueOnce(new Error('Index already exists')) // index 1 fails
        .mockResolvedValueOnce({ rowCount: 0 });

      await expect(vendorDirectorySessionQueries.ensureVendorDirectorySessionsTable()).resolves.not.toThrow();
    });

    test('handles table DDL failure gracefully and logs warning', async () => {
      jest.spyOn(pool, 'query').mockRejectedValue(new Error('DDL restricted'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(vendorDirectorySessionQueries.ensureVendorDirectorySessionsTable()).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('table missing self-healing integration in DB queries', () => {
    test('createSession auto-creates table and retries on missing table error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      let callCount = 0;
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('INSERT INTO vendor_directory_sessions')) {
          callCount++;
          if (callCount === 1) {
            throw new Error('no such table: vendor_directory_sessions');
          }
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      });

      const session = await vendorDirectorySessionQueries.createSession({
        id: 'auto-heal-create',
        email: 'cm@procucev.com',
      });

      expect(session.id).toBe('auto-heal-create');
      expect(callCount).toBe(2);
    });

    test('createSession falls back to memory if retry also fails', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('INSERT INTO vendor_directory_sessions')) {
          throw new Error('no such table: vendor_directory_sessions');
        }
        return { rowCount: 0 };
      });

      const session = await vendorDirectorySessionQueries.createSession({
        id: 'auto-heal-retry-fail',
        email: 'cm@procucev.com',
      });

      expect(session.id).toBe('auto-heal-retry-fail');
      const inMem = vendorDirectorySessionQueries.getMemoryStoreForTesting().get('auto-heal-retry-fail');
      expect(inMem).toBeDefined();
    });

    test('findSessionById auto-creates table and retries on missing table error', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      let callCount = 0;
      jest.spyOn(pool, 'rows').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('no such table: vendor_directory_sessions');
        }
        return [{
          id: 'auto-heal-find',
          user_uuid: 'u-1',
          email: 'cm@procucev.com',
          role: 'category_manager',
          status: 'ACTIVE',
          login_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        }];
      });
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 0 });

      const session = await vendorDirectorySessionQueries.findSessionById('auto-heal-find');
      expect(session).not.toBeNull();
      expect(session.id).toBe('auto-heal-find');
      expect(callCount).toBe(2);
    });

    test('findSessionById handles retry error gracefully and uses memory fallback', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      vendorDirectorySessionQueries.getMemoryStoreForTesting().set('mem-find-sess', {
        id: 'mem-find-sess',
        userUuid: 'u-1',
        email: 'cm@procucev.com',
        status: 'ACTIVE',
      });

      jest.spyOn(pool, 'rows').mockRejectedValue(new Error('no such table: vendor_directory_sessions'));
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 0 });

      const session = await vendorDirectorySessionQueries.findSessionById('mem-find-sess');
      expect(session).not.toBeNull();
      expect(session.id).toBe('mem-find-sess');
    });

    test('findActiveSession auto-creates table and retries on missing table error', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      let callCount = 0;
      jest.spyOn(pool, 'rows').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('no such table: vendor_directory_sessions');
        }
        return [{
          id: 'auto-heal-active',
          user_uuid: 'u-1',
          email: 'cm@procucev.com',
          role: 'category_manager',
          status: 'ACTIVE',
          login_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        }];
      });
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 0 });

      const session = await vendorDirectorySessionQueries.findActiveSession('auto-heal-active');
      expect(session).not.toBeNull();
      expect(session.id).toBe('auto-heal-active');
      expect(callCount).toBe(2);
    });

    test('findActiveSession handles retry failure and falls back to memory', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      vendorDirectorySessionQueries.getMemoryStoreForTesting().set('mem-active-sess', {
        id: 'mem-active-sess',
        userUuid: 'u-1',
        email: 'cm@procucev.com',
        status: 'ACTIVE',
      });

      jest.spyOn(pool, 'rows').mockRejectedValue(new Error('no such table: vendor_directory_sessions'));
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 0 });

      const session = await vendorDirectorySessionQueries.findActiveSession('mem-active-sess');
      expect(session).not.toBeNull();
      expect(session.id).toBe('mem-active-sess');
    });
  });

});
