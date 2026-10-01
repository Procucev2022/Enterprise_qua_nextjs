import { isDummyPincode, PINCODE_PATTERN } from './validationSchemas';

export interface PincodeLookupResult {
  valid: boolean;
  pincode: string;
  reason?: string;
  message?: string;
}

/**
 * Validates PIN / ZIP code using pure validation-based rules (no external network API).
 */
export async function lookupPincode(pincode: string): Promise<PincodeLookupResult> {
  const clean = pincode.trim();
  if (!clean) {
    return {
      valid: false,
      pincode: clean,
      reason: 'EMPTY_PINCODE',
      message: 'PIN code is required.',
    };
  }

  if (!PINCODE_PATTERN.test(clean)) {
    return {
      valid: false,
      pincode: clean,
      reason: 'INVALID_FORMAT',
      message: 'PIN / ZIP Code must be 3 to 10 letters, digits, spaces or hyphens.',
    };
  }

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
