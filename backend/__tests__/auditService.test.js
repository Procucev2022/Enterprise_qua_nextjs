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
    const validLogs = [
      createAuditEntry({ userEmail: 'user1@corp.com', action: 'Action 1' }),
      createAuditEntry({ userEmail: 'user2@corp.com', action: 'Action 2' }),
    ];

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
    expect(tamperedReport.compromisedEntries.length).toBe(1);
  });

  test('verifyAuditTrail handles empty list gracefully', () => {
    const report = verifyAuditTrail([]);
    expect(report.valid).toBe(true);
    expect(report.verifiedCount).toBe(0);
  });
});
