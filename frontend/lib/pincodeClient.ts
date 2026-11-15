import { isDummyPincode, PINCODE_PATTERN } from './validationSchemas';
import { UI_STRINGS } from './uiStrings';

const PINCODE_MESSAGES = UI_STRINGS.pincodeVerification;

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
      message: PINCODE_MESSAGES.required,
    };
  }

  if (!PINCODE_PATTERN.test(clean)) {
    return {
      valid: false,
      pincode: clean,
      reason: 'INVALID_FORMAT',
      message: PINCODE_MESSAGES.invalidFormat,
    };
  }

  if (isDummyPincode(clean)) {
    return {
      valid: false,
      pincode: clean,
      reason: 'DUMMY_PINCODE',
      message: PINCODE_MESSAGES.dummy,
    };
  }

  // Format and dummy-value checks only. No postal records are consulted, so the result
  // says the format passed and does not claim the PIN exists.
  return {
    valid: true,
    pincode: clean,
    message: UI_STRINGS.pincodeVerification.formatValid,
  };
}
