const {
  VALIDATION_SCHEMAS,
  validatePayload,
  EMAIL_REGEX,
  GSTIN_REGEX,
  PHONE_REGEX,
} = require('../src/config/validationSchemas');

describe('Backend Validation Schemas Unit Tests', () => {
  test('validates createRFQ schema with valid data', () => {
    const validRFQ = {
      title: 'High Pressure Water Pump',
      category: 'Mechanical',
      budget: 50000,
      targetDeliveryDate: '2026-04-15',
      lineItems: [{ name: 'Pump', qty: 2 }],
    };
    const res = validatePayload(VALIDATION_SCHEMAS.createRFQ, validRFQ);
    expect(res.isValid).toBe(true);
    expect(res.errors).toEqual({});
  });

  test('flags missing required fields in createRFQ schema', () => {
    const invalidRFQ = {
      title: 'Hi', // too short
      category: '',
      budget: -10, // below min
    };
    const res = validatePayload(VALIDATION_SCHEMAS.createRFQ, invalidRFQ);
    expect(res.isValid).toBe(false);
    expect(res.errors.title).toBeDefined();
    expect(res.errors.category).toBeDefined();
    expect(res.errors.budget).toBeDefined();
    expect(res.errors.targetDeliveryDate).toBeDefined();
  });

  test('validates vendorRegistration schema including email and GSTIN format', () => {
    const validVendor = {
      name: 'Apex Industrial Supplies',
      corporateEmail: 'procurement@apexsupplies.com',
      gstin: '29ABCDE1234F1Z5',
      majorCategory: 'Engineering',
      contactPhone: '+91 9876543210',
    };
    const res = validatePayload(VALIDATION_SCHEMAS.vendorRegistration, validVendor);
    expect(res.isValid).toBe(true);
  });

  test('flags invalid email and invalid phone in vendorRegistration', () => {
    const invalidVendor = {
      name: 'Apex',
      corporateEmail: 'invalid-email',
      gstin: '123-bad-gstin',
      majorCategory: 'Engineering',
      contactPhone: 'bad-phone',
    };
    const res = validatePayload(VALIDATION_SCHEMAS.vendorRegistration, invalidVendor);
    expect(res.isValid).toBe(false);
    expect(res.errors.corporateEmail).toBeDefined();
    expect(res.errors.gstin).toBeDefined();
    expect(res.errors.contactPhone).toBeDefined();
  });

  test('validates submitQuote schema with numeric boundaries', () => {
    const quote = {
      rfqId: 'rfq-1',
      vendorId: 'v-1',
      unitPrice: 1500,
      totalPrice: 15000,
      leadTimeDays: 10,
      warrantyYears: 2,
    };
    const res = validatePayload(VALIDATION_SCHEMAS.submitQuote, quote);
    expect(res.isValid).toBe(true);
  });

  test('validates rating revision score boundaries (0 to 100)', () => {
    const validRevision = {
      vendorId: 'v-1',
      revisedScore: 85,
      revisionReason: 'Consistent on-time delivery across Q1 projects.',
    };
    const resValid = validatePayload(VALIDATION_SCHEMAS.updateRatingRevision, validRevision);
    expect(resValid.isValid).toBe(true);

    const invalidRevision = {
      vendorId: 'v-1',
      revisedScore: 150, // exceeds max
      revisionReason: 'Bad', // too short
    };
    const resInvalid = validatePayload(VALIDATION_SCHEMAS.updateRatingRevision, invalidRevision);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.errors.revisedScore).toBeDefined();
    expect(resInvalid.errors.revisionReason).toBeDefined();
  });

  test('validates audit query parameters with enum checking', () => {
    const validQuery = {
      page: 1,
      limit: 50,
      severity: 'ERROR',
    };
    const res = validatePayload(VALIDATION_SCHEMAS.auditQuery, validQuery);
    expect(res.isValid).toBe(true);

    const invalidQuery = {
      page: 'not-a-number',
      severity: 'SUPER_CRITICAL', // invalid enum
    };
    const resInvalid = validatePayload(VALIDATION_SCHEMAS.auditQuery, invalidQuery);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.errors.page).toBeDefined();
    expect(resInvalid.errors.severity).toBeDefined();
  });

  test('handles empty or null schema gracefully', () => {
    const res = validatePayload(null, { any: 'data' });
    expect(res.isValid).toBe(true);
  });

  test('handles invalid array type rule', () => {
    const schema = { items: { type: 'array', required: true } };
    const res = validatePayload(schema, { items: 'not-an-array' });
    expect(res.isValid).toBe(false);
    expect(res.errors.items).toBeDefined();
  });

  test('validates crypto validation schemas', () => {
    const validEncrypt = { plaintext: 'Secret RFQ budget' };
    const encRes = validatePayload(VALIDATION_SCHEMAS.encryptPayload, validEncrypt);
    expect(encRes.isValid).toBe(true);

    const invalidEncrypt = { plaintext: '' };
    const encBadRes = validatePayload(VALIDATION_SCHEMAS.encryptPayload, invalidEncrypt);
    expect(encBadRes.isValid).toBe(false);

    const validDecrypt = {
      ciphertext: '0123456789abcdef',
      iv: '0123456789abcdef',
      authTag: '0123456789abcdef0123456789abcdef',
    };
    const decRes = validatePayload(VALIDATION_SCHEMAS.decryptPayload, validDecrypt);
    expect(decRes.isValid).toBe(true);

    const validIntegrity = {
      ciphertext: '0123456789abcdef',
      iv: '0123456789abcdef',
      authTag: '0123456789abcdef0123456789abcdef',
    };
    const intRes = validatePayload(VALIDATION_SCHEMAS.verifyCryptoIntegrity, validIntegrity);
    expect(intRes.isValid).toBe(true);
  });
});

