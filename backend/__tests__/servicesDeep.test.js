const aiChaserService = require('../src/services/aiChaserService');
const emailService = require('../src/services/emailService');
const evaluationService = require('../src/services/evaluationService');
const auditService = require('../src/services/auditService');

describe('Services Deep Branch Unit Tests', () => {
  test('aiChaserService handles all communication channels and vendor phone formats', () => {
    const mockRfq = {
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'Centrifugal Pump',
      category: 'Mechanical',
      budget: 50000,
    };
    const mockVendor1 = {
      id: 'v-1',
      name: 'Apex Supplies',
      phone: '+919876543210',
      contactPerson: 'Rajesh',
    };
    const mockVendor2 = {
      id: 'v-2',
      name: 'Delta Corp',
      contactPerson: 'Amit',
    };

    const logs1 = aiChaserService.simulateChaserOutreach(mockRfq, mockVendor1);
    expect(logs1.length).toBeGreaterThan(0);

    const logs2 = aiChaserService.simulateChaserOutreach(mockRfq, mockVendor2);
    expect(logs2.length).toBeGreaterThan(0);
  });

  test('emailService handles onboarding emails for existing and new vendors with temp password', () => {
    const mockVendor = {
      id: 'v-1',
      name: 'Apex Supplies',
      email: 'rajesh@apex.in',
      contactPerson: 'Rajesh Sharma',
      majorCategory: 'Mechanical',
    };

    const newVendorEmail = emailService.generateVendorOnboardingEmail(mockVendor, false, 'TempPass123!');
    expect(newVendorEmail.subject).toContain('Welcome');
    expect(newVendorEmail.htmlBody).toContain('TempPass123!');

    const existingVendorEmail = emailService.generateVendorOnboardingEmail(mockVendor, true);
    expect(existingVendorEmail.subject).toContain('Welcome');

    const rfqEmail = emailService.generateStandardRFQEmail(
      { rfqNumber: 'RFQ-1', title: 'Pumps', buyerCompany: 'L&T', deadline: '2026-09-01' },
      mockVendor
    );
    expect(rfqEmail.subject).toContain('RFQ-1');
  });

  test('evaluationService tests all 6 qualification pillars and score calculators', () => {
    expect(evaluationService.evaluateQuotes([])).toEqual([]);

    const quotes = [
      { vendorName: 'Vendor A', totalPrice: 10000, leadTimeDays: 10, warrantyYears: 2 },
      { vendorName: 'Vendor B', unitPrice: 12000, leadTimeDays: 20, warrantyYears: 1 },
      { vendorName: 'Vendor C', totalPrice: 0 },
    ];
    const evaluated = evaluationService.evaluateQuotes(quotes);
    expect(evaluated[0].isBestPrice).toBe(true);

    const eval360High = evaluationService.calculate360Evaluation({
      commercial: { score: 95 },
      technical: { score: 90 },
      quality: { score: 95 },
      delivery: { score: 90 },
      financial: { score: 90 },
      governance: { score: 95 },
    });
    expect(eval360High.status).toBe('PREFERRED ENTERPRISE SUPPLIER');

    const eval360Prob = evaluationService.calculate360Evaluation({
      commercial: { score: 70 },
      technical: { score: 65 },
      quality: { score: 70 },
      delivery: { score: 65 },
      financial: { score: 60 },
      governance: { score: 65 },
    });
    expect(eval360Prob.status).toBe('PROBATIONARY / CONDITIONAL');

    const eval360Rej = evaluationService.calculate360Evaluation({
      commercial: { score: 40 },
      technical: { score: 40 },
      quality: { score: 40 },
      delivery: { score: 40 },
      financial: { score: 40 },
      governance: { score: 40 },
    });
    expect(eval360Rej.status).toBe('NON-COMPLIANT / REJECTED');

    const rating = evaluationService.calculateRevisedRating({
      qualityScore: 90,
      costScore: 85,
      deliveryScore: 95,
      previousScore: 80,
    });
    expect(rating.newRating).toBeGreaterThanOrEqual(4.0);
  });

  test('auditService tests tamper detection and SHA validation chain', () => {
    const hash = auditService.generateShaHash('test-payload');
    expect(hash).toBeDefined();

    const emptyHash = auditService.generateShaHash();
    expect(emptyHash).toBeDefined();

    const log1 = auditService.createAuditEntry({
      userEmail: 'admin@procucev.com',
      action: 'INIT_SYSTEM',
      previousHash: 'GENESIS',
    });
    expect(log1.shaSignature).toBeDefined();

    const log2 = auditService.createAuditEntry({
      userEmail: 'admin@procucev.com',
      action: 'SECOND_ACTION',
      previousHash: log1.shaSignature,
    });
    expect(log2.shaSignature).toBeDefined();

    const emptyCheck = auditService.verifyAuditTrail([]);
    expect(emptyCheck.valid).toBe(true);

    // verifyAuditTrail walks the chain newest-first (matching how
    // storeService.addAuditLog actually stores entries via unshift).
    const validCheck = auditService.verifyAuditTrail([log2, log1]);
    expect(validCheck.valid).toBe(true);

    const invalidCheck = auditService.verifyAuditTrail([{ id: 'log-bad', shaSignature: 'short' }]);
    expect(invalidCheck.valid).toBe(false);

    // Content tamper: mutating a field after sealing must invalidate the
    // recomputed hash, not just its length.
    const tamperedLog2 = { ...log2, action: 'TAMPERED_ACTION' };
    const tamperedCheck = auditService.verifyAuditTrail([tamperedLog2, log1]);
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.compromisedEntries[0].reason).toMatch(/Hash does not match/);

    // Broken chain: an internally-consistent entry paired with the wrong
    // "older" neighbor must still be caught by the previousHash linkage check.
    const log3 = auditService.createAuditEntry({
      userEmail: 'admin@procucev.com',
      action: 'UNRELATED_ACTION',
      previousHash: 'SOME_OTHER_GENESIS',
    });
    const brokenChainCheck = auditService.verifyAuditTrail([log2, log3]);
    expect(brokenChainCheck.valid).toBe(false);
    expect(brokenChainCheck.compromisedEntries[0].reason).toMatch(/chain broken/);
  });
});
