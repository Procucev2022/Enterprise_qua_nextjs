const { isDummyPincode, validateAndLookupPincode } = require('../src/services/pincodeService');

describe('pincodeService', () => {
  describe('isDummyPincode', () => {
    test('identifies dummy sequences and repeated digits', () => {
      expect(isDummyPincode('123456')).toBe(true);
      expect(isDummyPincode('654321')).toBe(true);
      expect(isDummyPincode('000000')).toBe(true);
      expect(isDummyPincode('111111')).toBe(true);
      expect(isDummyPincode('999999')).toBe(true);
      expect(isDummyPincode('121212')).toBe(true);
      expect(isDummyPincode('212121')).toBe(true);
    });

    test('returns false for legitimate pincodes', () => {
      expect(isDummyPincode('400701')).toBe(false);
      expect(isDummyPincode('560001')).toBe(false);
      expect(isDummyPincode('110001')).toBe(false);
      expect(isDummyPincode('SW1A 1AA')).toBe(false);
    });

    test('handles empty / falsy values gracefully', () => {
      expect(isDummyPincode('')).toBe(false);
      expect(isDummyPincode(null)).toBe(false);
      expect(isDummyPincode(undefined)).toBe(false);
    });
  });

  describe('validateAndLookupPincode', () => {
    test('rejects empty pincode', async () => {
      const res = await validateAndLookupPincode('');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('EMPTY_PINCODE');
    });

    test('rejects malformed format', async () => {
      const res = await validateAndLookupPincode('!!');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('INVALID_FORMAT');
    });

    test('rejects dummy pincode', async () => {
      const res = await validateAndLookupPincode('123456');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('DUMMY_PINCODE');
    });

    test('validates legitimate Indian pincodes', async () => {
      const res = await validateAndLookupPincode('385310');
      expect(res.valid).toBe(true);
      expect(res.pincode).toBe('385310');
      expect(res.message).toBe('PIN code is valid.');
    });

    test('validates legitimate international postal formats', async () => {
      const res = await validateAndLookupPincode('SW1A 1AA');
      expect(res.valid).toBe(true);
      expect(res.pincode).toBe('SW1A 1AA');
    });

    test('handles default null pincode parameter', async () => {
      const res = await validateAndLookupPincode(null);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('EMPTY_PINCODE');
    });
  });

  describe('pincodeController', () => {
    const { lookupPincode } = require('../src/controllers/pincodeController');

    test('responds with 200 for valid pincode', async () => {
      const req = { params: { pincode: '400701' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      await lookupPincode(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(payload.valid).toBe(true);
    });

    test('responds with 400 for invalid/dummy pincode', async () => {
      const req = { params: { pincode: '123456' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      await lookupPincode(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(false);
      expect(payload.valid).toBe(false);
    });

    test('calls next(err) if unexpected exception occurs', async () => {
      const req = null;
      const res = {};
      const next = jest.fn();

      await lookupPincode(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
