jest.mock('../src/services/pincodeService', () => ({
  validateAndLookupPincode: jest.fn(),
}));

const pincodeController = require('../src/controllers/pincodeController');
const { validateAndLookupPincode } = require('../src/services/pincodeService');

function mockRes() {
  const res = {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

describe('pincodeController 100% Branch Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lookupPincode with req.params.pincode valid', async () => {
    validateAndLookupPincode.mockResolvedValue({
      valid: true,
      pincode: '400001',
      district: 'Mumbai',
    });

    const res = mockRes();
    await pincodeController.lookupPincode({ params: { pincode: '400001' } }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.valid).toBe(true);
  });

  test('lookupPincode with req.query.pincode invalid with custom message', async () => {
    validateAndLookupPincode.mockResolvedValue({
      valid: false,
      message: 'PIN code not found in postal database.',
    });

    const res = mockRes();
    await pincodeController.lookupPincode({ params: {}, query: { pincode: '999999' } }, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.data.error).toBe('PIN code not found in postal database.');
  });

  test('lookupPincode with empty pincode fallback and empty result message fallback', async () => {
    validateAndLookupPincode.mockResolvedValue({
      valid: false,
    });

    const res = mockRes();
    await pincodeController.lookupPincode({ params: {}, query: {} }, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.data.error).toBe('Invalid PIN code.');
  });

  test('lookupPincode catch block forwards error to next', async () => {
    validateAndLookupPincode.mockRejectedValue(new Error('lookup crash'));
    const next = jest.fn();

    await pincodeController.lookupPincode({ params: {} }, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
