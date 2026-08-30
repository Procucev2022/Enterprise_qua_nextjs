const { DOMAIN_TYPES } = require('../src/config/types');

describe('Backend Domain Types Unit Tests', () => {
  test('exports valid domain types and enum arrays', () => {
    expect(Array.isArray(DOMAIN_TYPES.RFQ_STATUSES)).toBe(true);
    expect(DOMAIN_TYPES.RFQ_STATUSES).toContain('PO Awarded');

    expect(Array.isArray(DOMAIN_TYPES.SOURCING_MODES)).toBe(true);
    expect(DOMAIN_TYPES.SOURCING_MODES).toContain('mode_1');

    expect(Array.isArray(DOMAIN_TYPES.SEVERITY_LEVELS)).toBe(true);
    expect(DOMAIN_TYPES.SEVERITY_LEVELS).toContain('CRITICAL');

    expect(Array.isArray(DOMAIN_TYPES.AUDIT_CATEGORIES)).toBe(true);
    expect(DOMAIN_TYPES.AUDIT_CATEGORIES).toContain('SECURITY');
  });
});
