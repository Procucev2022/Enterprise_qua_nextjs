const { generateShaHash, createAuditEntry, verifyAuditTrail } = require('../src/services/auditService');

describe('Audit Service & SHA-256 Cryptographic Chain', () => {
  test('generateShaHash generates valid 64-char hex string', () => {
    const hash = generateShaHash('test-payload');
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  test('createAuditEntry formats entry with timestamp and shaSignature', () => {
    const entry = createAuditEntry({
      userEmail: 'auditor@procucev.ai',
      action: 'Verified GSTIN and Bank Mandate',
      rfqNumber: 'RFQ-2026-0891',
    });

    expect(entry.id).toBeDefined();
    expect(entry.userEmail).toBe('auditor@procucev.ai');
    expect(entry.action).toContain('Verified GSTIN');
    expect(entry.shaSignature.length).toBe(64);
    expect(entry.status).toBe('TAMPER_CHECK_OK');
  });

  test('verifyAuditTrail detects compromised or missing hashes', () => {
    const older = createAuditEntry({ userEmail: 'user1@corp.com', action: 'Action 1' });
    const newer = createAuditEntry({
      userEmail: 'user2@corp.com', action: 'Action 2', previousHash: older.shaSignature,
    });
    const validLogs = [newer, older];

    const validReport = verifyAuditTrail(validLogs);
    expect(validReport.valid).toBe(true);
    expect(validReport.verifiedCount).toBe(2);
    expect(validReport.compromisedEntries.length).toBe(0);

    const tamperedLogs = [
      ...validLogs,
      { id: 'bad-log', timestamp: '2026-08-30', userEmail: 'hacker@bad.com', action: 'Tampered', shaSignature: 'invalid-hash' },
    ];

    const tamperedReport = verifyAuditTrail(tamperedLogs);
    expect(tamperedReport.valid).toBe(false);
    expect(tamperedReport.compromisedEntries.length).toBeGreaterThan(0);
    expect(tamperedReport.compromisedEntries.map(({ id }) => id)).toContain('bad-log');
  });

  test('verifyAuditTrail handles empty list gracefully', () => {
    const report = verifyAuditTrail([]);
    expect(report.valid).toBe(true);
    expect(report.verifiedCount).toBe(0);
  });

  test('verifies persisted head, root, and entry count anchors', () => {
    const oldest = createAuditEntry({ userEmail: 'user1@corp.com', action: 'Oldest' });
    const newest = createAuditEntry({
      userEmail: 'user2@corp.com', action: 'Newest', previousHash: oldest.shaSignature,
    });
    const report = verifyAuditTrail([newest, oldest], {
      expectedHeadHash: newest.shaSignature,
      expectedRootHash: oldest.shaSignature,
      expectedEntryCount: 2,
    });
    expect(report.valid).toBe(true);

    const truncated = verifyAuditTrail([newest], {
      expectedHeadHash: newest.shaSignature,
      expectedRootHash: oldest.shaSignature,
      expectedEntryCount: 2,
    });
    expect(truncated.valid).toBe(false);
    expect(truncated.compromisedEntries.map(({ reason }) => reason)).toContain(
      'Persisted audit entry count does not match the verified records'
    );
  });

  test('detects an empty previous hash inside a multi-entry chain', () => {
    const newest = createAuditEntry({ userEmail: 'user1@corp.com', action: 'Newest' });
    const oldest = createAuditEntry({ userEmail: 'user2@corp.com', action: 'Oldest' });
    const report = verifyAuditTrail([newest, oldest]);
    expect(report.valid).toBe(false);
    expect(report.compromisedEntries[0].reason).toContain('chain broken');
  });

  test('does not treat legacy entries without persisted chain links as verified', () => {
    const entry = createAuditEntry({ userEmail: 'user1@corp.com', action: 'Legacy entry' });
    const { previousHash, ...legacyEntry } = entry;

    expect(previousHash).toBe('');
    const report = verifyAuditTrail([legacyEntry]);
    expect(report.valid).toBe(false);
    expect(report.compromisedEntries[0].reason).toContain('Missing previousHash link');
  });

  test('normalizes non-array trails and reports missing anchor identifiers', () => {
    expect(verifyAuditTrail().valid).toBe(true);
    expect(verifyAuditTrail(null).valid).toBe(true);
    expect(verifyAuditTrail([null, 'primitive']).valid).toBe(false);

    const entry = createAuditEntry({ userEmail: 'user1@corp.com', action: 'Anchor mismatch' });
    const missingId = { ...entry, id: undefined };
    const report = verifyAuditTrail([missingId], {
      expectedHeadHash: 'different-head',
      expectedRootHash: 'different-root',
    });

    expect(report.valid).toBe(false);
    expect(report.compromisedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: null, reason: 'Newest audit entry does not match the persisted chain head' }),
      expect.objectContaining({ id: null, reason: 'Oldest audit entry does not match the persisted chain root' }),
    ]));
  });
});

describe('Audit entry identity, network, and identifier defaults', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('an entry with no signed-in actor is attributed to the documented system actor', () => {
    const { SYSTEM_ACTOR_EMAIL } = require('../src/config/constants');
    expect(createAuditEntry({ action: 'Background sweep' }).userEmail).toBe(SYSTEM_ACTOR_EMAIL);
  });

  test('an entry with no request IP records unknown, never a fixed network address', () => {
    expect(createAuditEntry({ userEmail: 'a@b.com', action: 'x' }).ipAddress).toBe('unknown');
    expect(createAuditEntry({ userEmail: 'a@b.com', action: 'x', ipAddress: null }).ipAddress).toBe('unknown');
    expect(createAuditEntry({ userEmail: 'a@b.com', action: 'x', ipAddress: '203.0.113.9' }).ipAddress).toBe('203.0.113.9');
  });

  test('entry ids and empty-payload seals never draw from Math.random', () => {
    const random = jest.spyOn(Math, 'random');
    const entry = createAuditEntry({ userEmail: 'a@b.com', action: 'x' });
    expect(entry.id).toMatch(/^log-\d+-[0-9a-f]{6}$/);
    expect(generateShaHash('')).toMatch(/^[0-9a-f]{64}$/);
    expect(random).not.toHaveBeenCalled();
  });
});
