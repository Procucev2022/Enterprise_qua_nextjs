import {
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  INDIAN_MOBILE_PATTERN,
  PINCODE_PATTERN,
  FormSchema,
} from '../../lib/validationSchemas';
import { UI_STRINGS } from '../../lib/uiStrings';

describe('Frontend validationSchemas Unit Tests', () => {
  describe('loginForm schema (email + mobile + password)', () => {
    const validLogin = {
      email: 'buyer@procucev.com',
      mobile: '9157154504',
      password: 'Pass@123',
    };

    test('accepts a complete, well-formed sign-in payload', () => {
      const res = validateFormData(FORM_SCHEMAS.loginForm, validLogin);
      expect(res.isValid).toBe(true);
      expect(res.fieldErrors).toEqual({});
    });

    test.each(['9157154504', '09157154504', '919157154504', '+919157154504', '+91 9157154504'])(
      'accepts the accepted Indian mobile form %s',
      (mobile) => {
        expect(INDIAN_MOBILE_PATTERN.test(mobile)).toBe(true);
        expect(validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, mobile }).isValid).toBe(true);
      }
    );

    test.each(['12345', '5157154504', '91571545040', '915715450', 'nine1five', ''])(
      'rejects the malformed mobile number %s',
      (mobile) => {
        const res = validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, mobile });
        expect(res.isValid).toBe(false);
        expect(res.fieldErrors.mobile).toBe(UI_STRINGS.auth.mobileInvalid);
      }
    );

    test('rejects a malformed email address', () => {
      const res = validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, email: 'not-an-email' });
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors.email).toBe(UI_STRINGS.auth.emailInvalid);
    });

    test('rejects a missing password', () => {
      const res = validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, password: '' });
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors.password).toBe(UI_STRINGS.auth.passwordRequired);
    });
  });

  test('validates rfqIngestion schema with valid data', () => {
    const validData = {
      title: 'Centrifugal Pump Equipment',
      category: 'Mechanical',
      budget: 15000,
      targetDeliveryDate: '2026-03-30',
    };
    const res = validateFormData(FORM_SCHEMAS.rfqIngestion, validData);
    expect(res.isValid).toBe(true);
    expect(res.fieldErrors).toEqual({});
  });

  test('flags missing or invalid fields in rfqIngestion schema', () => {
    const invalidData = {
      title: 'A', // too short
      budget: -100, // below min
    };
    const res = validateFormData(FORM_SCHEMAS.rfqIngestion, invalidData);
    expect(res.isValid).toBe(false);
    expect(res.fieldErrors.title).toBeDefined();
    expect(res.fieldErrors.category).toBeDefined();
    expect(res.fieldErrors.budget).toBeDefined();
    expect(res.fieldErrors.targetDeliveryDate).toBeDefined();
  });

  test('validates vendorQualification schema regex checks', () => {
    const validData = {
      companyName: 'Apex Tools Ltd',
      corporateEmail: 'info@apex.com',
      contactPhone: '+1-555-0199',
      gstin: '29ABCDE1234F1Z5',
      category: 'Machinery',
    };
    const res = validateFormData(FORM_SCHEMAS.vendorQualification, validData);
    expect(res.isValid).toBe(true);

    const invalidData = {
      companyName: 'A', // too short
      corporateEmail: 'invalid-email',
      contactPhone: 'bad-phone',
      gstin: 'bad-gstin',
      category: '',
    };
    const resInvalid = validateFormData(FORM_SCHEMAS.vendorQualification, invalidData);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.fieldErrors.corporateEmail).toBeDefined();
    expect(resInvalid.fieldErrors.gstin).toBeDefined();
    expect(resInvalid.fieldErrors.contactPhone).toBeDefined();
  });

  test('validates quotationForm numeric constraints', () => {
    const validData = {
      unitPrice: 500,
      totalPrice: 5000,
      leadTimeDays: 7,
      paymentTerms: 'Net 30',
    };
    const res = validateFormData(FORM_SCHEMAS.quotationForm, validData);
    expect(res.isValid).toBe(true);

    const invalidData = {
      unitPrice: 'not-a-number',
      totalPrice: 0,
      leadTimeDays: 0,
      paymentTerms: '',
    };
    const resInvalid = validateFormData(FORM_SCHEMAS.quotationForm, invalidData);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.fieldErrors.unitPrice).toBeDefined();
    expect(resInvalid.fieldErrors.totalPrice).toBeDefined();
  });

  test('validates vendorRatingRevision schema boundaries', () => {
    const validData = {
      revisedScore: 92,
      revisionReason: 'Consistent performance and quality delivery',
    };
    const res = validateFormData(FORM_SCHEMAS.vendorRatingRevision, validData);
    expect(res.isValid).toBe(true);

    const invalidData = {
      revisedScore: 120, // exceeds max 100
      revisionReason: 'Bad', // too short
    };
    const resInvalid = validateFormData(FORM_SCHEMAS.vendorRatingRevision, invalidData);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.fieldErrors.revisedScore).toBeDefined();
    expect(resInvalid.fieldErrors.revisionReason).toBeDefined();
  });

  test('covers all fallback error messages and string maxLength rules', () => {
    const customSchema: FormSchema = {
      plainReq: { required: true },
      plainNum: { type: 'number', min: 10, max: 50 },
      plainStr: { type: 'string', minLength: 3, maxLength: 5, pattern: /^[A-Z]+$/ },
    };

    // Missing plainReq
    const res1 = validateFormData(customSchema, { plainNum: 'abc', plainStr: 'a' });
    expect(res1.isValid).toBe(false);
    expect(res1.fieldErrors.plainReq).toBe('plainReq is required');
    expect(res1.fieldErrors.plainNum).toBe('plainNum must be a number');
    expect(res1.fieldErrors.plainStr).toBe('plainStr must be at least 3 characters');

    // Number min/max fallbacks
    const res2 = validateFormData(customSchema, { plainReq: 'ok', plainNum: 5, plainStr: 'TOOLONG' });
    expect(res2.fieldErrors.plainNum).toBe('plainNum must be at least 10');
    expect(res2.fieldErrors.plainStr).toBe('plainStr cannot exceed 5 characters');

    // Number exceeding max and pattern mismatch fallback
    const res3 = validateFormData(customSchema, { plainReq: 'ok', plainNum: 100, plainStr: '123' });
    expect(res3.fieldErrors.plainNum).toBe('plainNum cannot exceed 50');
    expect(res3.fieldErrors.plainStr).toBe('plainStr format is invalid');
  });

  test('handles null schema and empty inputs safely', () => {
    const res = validateFormData(null as any, { any: 'val' });
    expect(res.isValid).toBe(true);
  });

  test('validates buyerAccount schema', () => {
    const validData = {
      name: 'Jane Doe',
      email: 'jane@enterprise.com',
      department: 'Procurement',
      approvalLimit: 50000,
    };
    const res = validateFormData(FORM_SCHEMAS.buyerAccount, validData);
    expect(res.isValid).toBe(true);
  });

  test('validates cryptoEncryption and cryptoDecryption schemas', () => {
    const validEnc = { plaintext: 'Confidential ERP item' };
    const encRes = validateFormData(FORM_SCHEMAS.cryptoEncryption, validEnc);
    expect(encRes.isValid).toBe(true);

    const invalidEnc = { plaintext: '' };
    const encBad = validateFormData(FORM_SCHEMAS.cryptoEncryption, invalidEnc);
    expect(encBad.isValid).toBe(false);
    expect(encBad.fieldErrors.plaintext).toBeDefined();

    const validDec = {
      ciphertext: '0123456789abcdef',
      iv: '0123456789abcdef',
      authTag: '0123456789abcdef0123456789abcdef',
    };
    const decRes = validateFormData(FORM_SCHEMAS.cryptoDecryption, validDec);
    expect(decRes.isValid).toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Delivery pincode / zipcode
//
// Deliberately broader than an Indian six-digit PIN: the same field carries
// international zipcodes for export orders.
// ══════════════════════════════════════════════════════════════════════════════
describe('PINCODE_PATTERN', () => {
  test.each([
    ['400701', 'Indian six-digit PIN'],
    ['110 001', 'PIN written with a space'],
    ['SW1A 1AA', 'UK postcode'],
    ['12345-6789', 'US ZIP+4'],
    ['751', 'short three-character code'],
  ])('accepts %s (%s)', (value) => {
    expect(PINCODE_PATTERN.test(value)).toBe(true);
  });

  test.each([
    ['', 'empty string'],
    ['40', 'shorter than three characters'],
    ['-400701', 'leading separator'],
    ['400!701', 'punctuation'],
    ['12345678901', 'longer than ten characters'],
  ])('rejects %s (%s)', (value) => {
    expect(PINCODE_PATTERN.test(value)).toBe(false);
  });
});

describe('rfqIngestion schema', () => {
  // Optional so a document that prices nothing can still be saved.
  test('accepts a payload with no budget', () => {
    const { isValid } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
    });
    expect(isValid).toBe(true);
  });

  test('rejects a negative budget', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      budget: -1,
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.budget).toBeDefined();
  });

  test('rejects a malformed delivery pincode', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryPincode: '!!',
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.deliveryPincode).toBe(UI_STRINGS.rfqExtraction.deliveryPincodeInvalidMessage);
  });
});
