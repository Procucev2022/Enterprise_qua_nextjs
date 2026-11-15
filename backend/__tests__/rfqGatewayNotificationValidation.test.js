const { VALIDATION_SCHEMAS, validatePayload } = require('../src/config/validationSchemas');

describe('RFQ gateway notification validation', () => {
  const baseRFQ = {
    title: 'Pump spares',
    deliveryLocation: 'Mumbai',
    deliveryPincode: '400001',
    targetDeliveryDate: '2099-01-01',
  };

  test('accepts a valid optional gateway notification address', () => {
    const result = validatePayload(VALIDATION_SCHEMAS.createRFQ, {
      ...baseRFQ,
      targetGatewayEmail: 'gateway@example.test',
    });

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData.targetGatewayEmail).toBe('gateway@example.test');
  });

  test('rejects malformed and oversized gateway notification addresses', () => {
    const malformed = validatePayload(VALIDATION_SCHEMAS.createRFQ, {
      ...baseRFQ,
      targetGatewayEmail: 'gateway-address',
    });
    const oversized = validatePayload(VALIDATION_SCHEMAS.createRFQ, {
      ...baseRFQ,
      targetGatewayEmail: `${'a'.repeat(310)}@example.test`,
    });

    expect(malformed.isValid).toBe(false);
    expect(malformed.errors.targetGatewayEmail).toMatch(/valid email address/i);
    expect(oversized.isValid).toBe(false);
    expect(oversized.errors.targetGatewayEmail).toMatch(/320 characters/i);
  });
});
