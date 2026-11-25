/**
 * GST Validation Unit Tests
 * Covers validateGstin() function with valid and invalid GST formats
 * Note: Checksum validation is disabled in test environments (NODE_ENV=test)
 */

import { validateGstin, isGstValid } from '@/lib/validationSchemas';

describe('validateGstin - GST Validation Logic', () => {
  describe('Valid GST formats', () => {
    test('accepts valid GST with correct state code and format', () => {
      const result = validateGstin('27ABCDE1234F1Z5');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('accepts valid GST with different state codes', () => {
      const validGsts = [
        '01ABCDE1234F1Z5', // State 01
        '05ABCDE1234F1Z5', // State 05
        '36ABCDE1234F1Z5', // State 36 (Karnataka)
        '33ABCDE1234F1Z5', // State 33 (Telangana)
      ];
      validGsts.forEach((gst) => {
        const result = validateGstin(gst);
        expect(result.isValid).toBe(true);
      });
    });

    test('accepts GST with uppercase and lowercase (normalized to uppercase)', () => {
      const result = validateGstin('27abcde1234f1z5');
      expect(result.isValid).toBe(true);
    });

    test('accepts GST with leading/trailing whitespace', () => {
      const result = validateGstin('  27ABCDE1234F1Z5  ');
      expect(result.isValid).toBe(true);
    });

    test('accepts GST with internal whitespace (normalized)', () => {
      const result = validateGstin('27 ABCD E1234 F1Z5');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Invalid GST - Empty/Missing', () => {
    test('rejects empty string', () => {
      const result = validateGstin('');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Please enter GSTIN');
    });

    test('rejects null', () => {
      const result = validateGstin(null);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Please enter GSTIN');
    });

    test('rejects undefined', () => {
      const result = validateGstin(undefined);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Please enter GSTIN');
    });

    test('rejects whitespace-only string', () => {
      const result = validateGstin('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Please enter GSTIN');
    });

    test('rejects non-string input', () => {
      const result = validateGstin(123);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Please enter GSTIN');
    });
  });

  describe('Invalid GST - Wrong Length', () => {
    test('rejects GST shorter than 15 characters', () => {
      const result = validateGstin('27ABCDE1234F1Z');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('15 characters');
    });

    test('rejects GST longer than 15 characters', () => {
      const result = validateGstin('27ABCDE1234F1Z55');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('15 characters');
    });
  });

  describe('Invalid GST - Bad State Code', () => {
    test('rejects invalid state code (non-numeric)', () => {
      const result = validateGstin('XXABCDE1234F1Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('state code');
    });

    test('rejects invalid state code (00)', () => {
      const result = validateGstin('00ABCDE1234F1Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('state code');
    });
  });

  describe('Invalid GST - Bad PAN Format (characters 3-12)', () => {
    test('rejects PAN with invalid format (not matching [A-Z]{5}[0-9]{4}[A-Z])', () => {
      const result = validateGstin('27ABCD11234F1Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('PAN format');
    });

    test('rejects PAN with numbers in first 5 characters', () => {
      const result = validateGstin('27ABC1E1234F1Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('PAN format');
    });

    test('rejects PAN with letters in middle 4 digits', () => {
      const result = validateGstin('27ABCDEA234F1Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('PAN format');
    });
  });

  describe('Invalid GST - Bad Entity Code (character 13)', () => {
    test('rejects entity code 0', () => {
      const result = validateGstin('27ABCDE1234F0Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('entity code');
    });

    test('rejects entity code with special character', () => {
      const result = validateGstin('27ABCDE1234F@Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('entity code');
    });
  });

  describe('Invalid GST - Missing/Wrong Z (character 14)', () => {
    test('rejects when 14th character is not Z', () => {
      const result = validateGstin('27ABCDE1234F1A5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('14th character must be Z');
    });

    test('rejects when 14th character is number', () => {
      const result = validateGstin('27ABCDE1234F125');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('14th character must be Z');
    });
  });

  describe('isGstValid - Quick Format Check', () => {
    test('returns true for valid GST', () => {
      expect(isGstValid('27ABCDE1234F1Z5')).toBe(true);
    });

    test('returns false for invalid GST', () => {
      expect(isGstValid('INVALID')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isGstValid('')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('handles mixed case with spaces', () => {
      const result = validateGstin('27 abcd E1234f 1z5');
      expect(result.isValid).toBe(true);
    });

    test('rejects GST with special characters in state code', () => {
      const result = validateGstin('2*ABCDE1234F1Z5');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('state code');
    });

    test('rejects completely numeric GST', () => {
      const result = validateGstin('271234512345123');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('PAN format');
    });

    test('rejects completely alphabetic GST', () => {
      const result = validateGstin('ABCDEFGHIJKLMNO');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('state code');
    });
  });
});
