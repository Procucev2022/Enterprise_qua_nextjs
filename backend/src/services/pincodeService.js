// Known test/dummy pincodes and sequences that should be rejected
const DUMMY_PINCODE_SET = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '012345', '123456', '234567', '345678', '456789', '567890',
  '654321', '765432', '876543', '987654', '098765',
  '121212', '212121', '123123', '321321', '000001', '100000',
]);

/**
 * Checks if a string is a dummy, test, or sequential PIN code
 * @param {string} pincode
 * @returns {boolean}
 */
function isDummyPincode(pincode) {
  if (!pincode) return false;
  const clean = String(pincode).trim().replace(/\s+/g, '');
  if (!clean) return false;

  if (DUMMY_PINCODE_SET.has(clean)) return true;

  // All identical digits (e.g. 000000, 111111, 777777)
  if (/^(\d)\1{5,}$/.test(clean)) return true;

  return false;
}

/**
 * Validates PIN / ZIP code using pure validation-based rules (no external network API).
 *
 * @param {string} pincode
 * @returns {Promise<{ valid: boolean, pincode: string, reason?: string, message?: string }>}
 */
async function validateAndLookupPincode(pincode) {
  const clean = String(pincode || '').trim();

  if (!clean) {
    return {
      valid: false,
      pincode: clean,
      reason: 'EMPTY_PINCODE',
      message: 'PIN code is required.',
    };
  }

  // Format check: 3 to 10 alphanumeric characters / hyphens / spaces
  if (!/^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/.test(clean)) {
    return {
      valid: false,
      pincode: clean,
      reason: 'INVALID_FORMAT',
      message: 'PIN / ZIP Code must be 3 to 10 letters, digits, spaces or hyphens.',
    };
  }

  // Dummy PIN check
  if (isDummyPincode(clean)) {
    return {
      valid: false,
      pincode: clean,
      reason: 'DUMMY_PINCODE',
      message: 'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed.',
    };
  }

  return {
    valid: true,
    pincode: clean,
    message: 'PIN code is valid.',
  };
}

module.exports = {
  isDummyPincode,
  validateAndLookupPincode,
  DUMMY_PINCODE_SET,
};
