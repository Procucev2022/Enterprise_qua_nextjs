import {
  FORM_SCHEMAS,
  validateFormData,
  validatePincode,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  INDIAN_MOBILE_PATTERN,
  EXACT_10_DIGIT_MOBILE_PATTERN,
  sanitize10DigitMobile,
  PINCODE_PATTERN,
  INDIAN_PINCODE_PATTERN,
  isDummyPincode,
  FormSchema,
  resolveLocationFromPostalResult,
  PASSWORD_MIN_LENGTH,
  PROCUCEV_EMAIL_PATTERN,
  PROCUCEV_EMAIL_MESSAGE,
  OTP_CODE_PATTERN,
  OTP_CODE_MESSAGE,
  DUMMY_PINCODES,
  PAN_PATTERN,
  CIN_PATTERN,
  WEBSITE_PATTERN,
  PUBLIC_VENDOR_QUERY_SCHEMA,
  INDIAN_STATES,
  VENDOR_DIRECTORY_AUTH_SCHEMA,
  PAYMENT_DUES_COMMUNICATION_SCHEMA,
  ACTIVITY_LOG_SCHEMA,
  INTERNAL_TASK_SCHEMA,
  ACCOUNT_DOCUMENT_UPLOAD_SCHEMA,
  SELLER_ADD_QUOTE_CREDITS_SCHEMA,
  BUYER_CREDIT_APPROVAL_REQUEST_SCHEMA,
  findMissingPoDumpFields,
  findMissingPoDumpHeaders,
} from '../../lib/validationSchemas';
import { UI_STRINGS } from '../../lib/uiStrings';

describe('Frontend validationSchemas Unit Tests', () => {
  test('validates enterprise inquiry details against bounded shared client rules', () => {
    expect(validateFormData(FORM_SCHEMAS.enterpriseInquiry, {
      companyName: ' Demo Company ',
      email: 'buyer@example.test',
      mobile: '+91 98765 43210',
    }).isValid).toBe(true);

    expect(validateFormData(FORM_SCHEMAS.enterpriseInquiry, {
      companyName: 'X',
      email: 'invalid',
      mobile: '123',
    }).fieldErrors).toEqual({
      companyName: expect.any(String),
      email: expect.any(String),
      mobile: expect.any(String),
    });
  });

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

    describe('EXACT_10_DIGIT_MOBILE_PATTERN and sanitize10DigitMobile', () => {
      test('accepts valid 10-digit Indian numbers starting with 6, 7, 8, or 9', () => {
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('9876543210')).toBe(true);
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('8765432109')).toBe(true);
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('7654321098')).toBe(true);
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('6543210987')).toBe(true);
      });

      test('rejects numbers that have fewer or more than 10 digits or invalid starting digit', () => {
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('987654321')).toBe(false); // 9 digits
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('98765432101')).toBe(false); // 11 digits
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('1234567890')).toBe(false); // starts with 1
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('5432167890')).toBe(false); // starts with 5
        expect(EXACT_10_DIGIT_MOBILE_PATTERN.test('+919876543210')).toBe(false);
      });

      test('sanitize10DigitMobile strips non-digits and trims country code prefixes', () => {
        expect(sanitize10DigitMobile('+91 98765 43210')).toBe('9876543210');
        expect(sanitize10DigitMobile('09876543210')).toBe('9876543210');
        expect(sanitize10DigitMobile('919876543210')).toBe('9876543210');
        expect(sanitize10DigitMobile('987654321012345')).toBe('9876543210');
        expect(sanitize10DigitMobile('abc-123')).toBe('123');
        expect(sanitize10DigitMobile('')).toBe('');
      });
    });

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

    test('validates buyerRegistrationForm schema', () => {
      const validReg = {
        fullName: 'Jane Doe',
        companyName: 'Acme Enterprises',
        gstNumber: '27AAAAA0000A1Z5',
        pincode: '411001',
        city: 'Pune',
        state: 'Maharashtra',
        email: 'jane@acme.com',
        mobile: '9876543210',
        password: 'Password123!',
      };

      const validRes = validateFormData(FORM_SCHEMAS.buyerRegistrationForm, validReg);
      expect(validRes.isValid).toBe(true);

      // Rejects invalid GSTIN
      const badGstRes = validateFormData(FORM_SCHEMAS.buyerRegistrationForm, { ...validReg, gstNumber: 'INVALIDGSTIN' });
      expect(badGstRes.isValid).toBe(false);
      expect(badGstRes.fieldErrors.gstNumber).toBe(UI_STRINGS.auth.gstinInvalid);

      // Rejects invalid mobile
      const badMobileRes = validateFormData(FORM_SCHEMAS.buyerRegistrationForm, { ...validReg, mobile: '12345' });
      expect(badMobileRes.isValid).toBe(false);
      expect(badMobileRes.fieldErrors.mobile).toBe(UI_STRINGS.auth.mobileInvalid);
    });
  });

  test('validates rfqIngestion schema with valid data', () => {
    const validData = {
      title: 'Centrifugal Pump Equipment',
      category: 'Mechanical',
      budget: 15000,
      targetDeliveryDate: '2026-03-30',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
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

    // String rule with non-string value (e.g. number coerced)
    const res4 = validateFormData({ strField: { type: 'string', minLength: 2 } }, { strField: 123 });
    expect(res4.isValid).toBe(true);
    const res5 = validateFormData({ strField: { type: 'string', minLength: 5 } }, { strField: 123 });
    expect(res5.isValid).toBe(false);
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

describe('INDIAN_PINCODE_PATTERN & isDummyPincode', () => {
  test('INDIAN_PINCODE_PATTERN validates Indian 6 digit pin', () => {
    expect(INDIAN_PINCODE_PATTERN.test('400701')).toBe(true);
    expect(INDIAN_PINCODE_PATTERN.test('012345')).toBe(false);
    expect(INDIAN_PINCODE_PATTERN.test('40070')).toBe(false);
    expect(INDIAN_PINCODE_PATTERN.test('4007011')).toBe(false);
  });

  test('isDummyPincode rejects dummy and sequential pin patterns', () => {
    expect(isDummyPincode('123456')).toBe(true);
    expect(isDummyPincode('654321')).toBe(true);
    expect(isDummyPincode('000000')).toBe(true);
    expect(isDummyPincode('111111')).toBe(true);
    expect(isDummyPincode('222222')).toBe(true);
    expect(isDummyPincode('999999')).toBe(true);
    expect(isDummyPincode('121212')).toBe(true);
    expect(isDummyPincode('7777777')).toBe(true);
    expect(isDummyPincode('400701')).toBe(false);
    expect(isDummyPincode('560001')).toBe(false);
    expect(isDummyPincode('')).toBe(false);
    expect(isDummyPincode('   ')).toBe(false);
    expect(isDummyPincode(null)).toBe(false);
    expect(isDummyPincode(undefined)).toBe(false);
    expect(isDummyPincode(123456)).toBe(false);
  });
});

describe('rfqIngestion schema', () => {
  // Optional so a document that prices nothing can still be saved.
  // The budget stays optional even though the destination is now mandatory.
  test('accepts a payload with no budget', () => {
    const { isValid } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
    });
    expect(isValid).toBe(true);
  });

  // Freight is rated on the destination, so a quote raised without one cannot be
  // compared against a quote that has one.
  test('requires a delivery location', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryPincode: '400701',
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.deliveryLocation).toBe(UI_STRINGS.rfqExtraction.deliveryLocationSchemaMessage);
  });

  test('requires a delivery pincode', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.deliveryPincode).toBe(UI_STRINGS.rfqExtraction.deliveryPincodeInvalidMessage);
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

describe('validatePincode async postal API validator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('returns invalid for empty or non-string input', async () => {
    const res1 = await validatePincode('');
    expect(res1.isValid).toBe(false);
    expect(res1.message).toBe('PIN code is required');

    const res2 = await validatePincode('   ');
    expect(res2.isValid).toBe(false);
    expect(res2.message).toBe('PIN code is required');

    const res3 = await validatePincode(null as any);
    expect(res3.isValid).toBe(false);
    expect(res3.message).toBe('PIN code is required');
  });

  test('handles non-Indian postal codes', async () => {
    const validUk = await validatePincode('SW1A 1AA', false);
    expect(validUk.isValid).toBe(true);

    const invalidUk = await validatePincode('!', false);
    expect(invalidUk.isValid).toBe(false);
    expect(invalidUk.message).toBe('Invalid postal code format');
  });

  test('rejects invalid Indian PIN format', async () => {
    const startsWithZero = await validatePincode('012345');
    expect(startsWithZero.isValid).toBe(false);
    expect(startsWithZero.message).toContain('cannot start with 0');

    const shortPin = await validatePincode('40070');
    expect(shortPin.isValid).toBe(false);
    expect(shortPin.message).toContain('must be 6 digits');
  });

  test('rejects dummy and sequential PIN codes', async () => {
    const dummy = await validatePincode('123456');
    expect(dummy.isValid).toBe(false);
    expect(dummy.message).toContain('Invalid test or sequential PIN code');
  });

  test('resolves successfully when postal API returns Success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          Status: 'Success',
          PostOffice: [
            {
              Name: 'Koparkhairane',
              District: 'Thane',
              State: 'Maharashtra',
            },
          ],
        },
      ],
    } as any);

    const res = await validatePincode('400709');
    expect(res.isValid).toBe(true);
    expect(res.postOffices?.[0].Name).toBe('Koparkhairane');
  });

  test('resolves successfully with empty postOffices when PostOffice is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          Status: 'Success',
        },
      ],
    } as any);

    const res = await validatePincode('400709');
    expect(res.isValid).toBe(true);
    expect(res.postOffices).toEqual([]);
  });

  test('returns invalid when postal API returns Error / not found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          Status: 'Error',
          Message: 'No records found',
        },
      ],
    } as any);

    const res = await validatePincode('400799');
    expect(res.isValid).toBe(false);
    expect(res.message).toBe('PIN Code is not found or invalid in postal records.');
  });

  test('falls back gracefully on non-ok HTTP status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    const res = await validatePincode('400701');
    expect(res.isValid).toBe(false);
  });

  test('falls back gracefully on network or JSON parse exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    const res = await validatePincode('400701');
    expect(res.isValid).toBe(false);
  });

  test('clears the request timeout after a network failure', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    const result = await validatePincode('400701');

    expect(result.isValid).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('handles empty, non-Indian, and dummy pincode validation branches', async () => {
    // Empty
    expect(await validatePincode('')).toEqual({ isValid: false, message: 'PIN code is required' });

    // Non-Indian valid
    expect(await validatePincode('SW1A 1AA', false)).toEqual({ isValid: true });

    // Non-Indian invalid
    expect(await validatePincode('??!!', false)).toEqual({ isValid: false, message: 'Invalid postal code format' });

    // Starts with 0
    expect(await validatePincode('012345')).toEqual({
      isValid: false,
      message: 'PIN Code must be 6 digits and cannot start with 0',
    });

    // Dummy PIN
    expect(await validatePincode('111111')).toEqual({
      isValid: false,
      message: 'Invalid test or sequential PIN code. Enter a valid postal code.',
    });
  });

  test('exercises timeout abort callback in validatePincode', async () => {
    jest.useFakeTimers();
    let abortCalled = false;
    global.fetch = jest.fn((url: any, init?: any) => {
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          abortCalled = true;
        });
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            json: async () => [{ Status: 'Success', PostOffice: [] }],
          } as any);
        }, 10000);
      });
    });

    const promise = validatePincode('400701');
    jest.advanceTimersByTime(6000);
    jest.advanceTimersByTime(5000);
    const res = await promise;
    expect(res.isValid).toBe(true);
    expect(abortCalled).toBe(true);
    jest.useRealTimers();
  });

  describe('resolveLocationFromPostalResult', () => {
    test('resolves location from postal office District and State', () => {
      const offices = [
        {
          Name: 'Vashi',
          Description: null,
          BranchType: 'Sub Post Office',
          DeliveryStatus: 'Delivery',
          Circle: 'Maharashtra',
          District: 'Thane',
          Division: 'Navi Mumbai',
          Region: 'Mumbai',
          Block: 'Thane',
          State: 'Maharashtra',
          Country: 'India',
          Pincode: '400703',
        },
      ];
      const loc = resolveLocationFromPostalResult('400703', offices);
      expect(loc).toBe('Thane, Maharashtra');
    });

    test('returns an empty location when no offices are returned, without guessing from the PIN', () => {
      expect(resolveLocationFromPostalResult('400701', [])).toBe('');
      expect(resolveLocationFromPostalResult('110001', [])).toBe('');
      expect(resolveLocationFromPostalResult('560001', [])).toBe('');
      expect(resolveLocationFromPostalResult('600001', [])).toBe('');
      expect(resolveLocationFromPostalResult('700001', [])).toBe('');
      expect(resolveLocationFromPostalResult('500001', [])).toBe('');
      expect(resolveLocationFromPostalResult('411001', [])).toBe('');
      expect(resolveLocationFromPostalResult('380001', [])).toBe('');
      expect(resolveLocationFromPostalResult('302001', [])).toBe('');
      expect(resolveLocationFromPostalResult('226001', [])).toBe('');
      expect(resolveLocationFromPostalResult('201301', [])).toBe('');
      expect(resolveLocationFromPostalResult('122001', [])).toBe('');
      expect(resolveLocationFromPostalResult('160001', [])).toBe('');
      expect(resolveLocationFromPostalResult('800001', [])).toBe('');
      expect(resolveLocationFromPostalResult('751001', [])).toBe('');
      expect(resolveLocationFromPostalResult('781001', [])).toBe('');
      expect(resolveLocationFromPostalResult('682001', [])).toBe('');
      expect(resolveLocationFromPostalResult('641001', [])).toBe('');
      expect(resolveLocationFromPostalResult('530001', [])).toBe('');
      expect(resolveLocationFromPostalResult('452001', [])).toBe('');
      expect(resolveLocationFromPostalResult('462001', [])).toBe('');
      expect(resolveLocationFromPostalResult('695001', [])).toBe('');
    });

    test('resolves location using fallback office properties or fallback pin lookup', () => {
      const officeWithDivisionOnly = [
        { Name: 'TestPO', Division: 'TestDivision' } as any,
      ];
      expect(resolveLocationFromPostalResult('400701', officeWithDivisionOnly)).toBe('TestDivision');

      const officeWithCircleOnly = [
        { Name: '', Circle: 'TestCircle' } as any,
      ];
      expect(resolveLocationFromPostalResult('400701', officeWithCircleOnly)).toBe('TestCircle');

      const officeWithBlankProperties = [
        { Name: '', District: '', Division: '', Circle: '', State: '' } as any,
      ];
      expect(resolveLocationFromPostalResult('400701', officeWithBlankProperties)).toBe('');
    });

    test('handles non-array response from postal API gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ Message: 'Rate limited' }),
      } as Response);

      const res = await validatePincode('400701');
      expect(res.isValid).toBe(false);
    });

    test('validates extendRFQ schema custom hours validation', () => {
      const extendRule = FORM_SCHEMAS.extendRFQ;
      expect(validateFormData(extendRule, { hours: 24 }).isValid).toBe(true);
      expect(validateFormData(extendRule, { hours: 48 }).isValid).toBe(true);
      expect(validateFormData(extendRule, { hours: 12 }).isValid).toBe(false);
      expect(validateFormData(extendRule, { hours: 'abc' }).isValid).toBe(false);
    });
  });
});


describe('validatePincode unverified state', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('marks a PIN unverified, not accepted, when the postal service returns an HTTP error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);

    const res = await validatePincode('400701');

    expect(res.isValid).toBe(false);
    expect(res.unverified).toBe(true);
    expect(res.message).toBe(UI_STRINGS.pincodeVerification.unverified);
    expect(res.postOffices).toBeUndefined();
  });

  test('marks a PIN unverified when the postal service cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    const res = await validatePincode('400701');

    expect(res.isValid).toBe(false);
    expect(res.unverified).toBe(true);
    expect(res.message).toBe(UI_STRINGS.pincodeVerification.unverified);
  });

  test('does not mark unverified when the postal records say the PIN does not exist', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ Status: 'Error', PostOffice: null }],
    } as Response);

    const res = await validatePincode('400799');

    expect(res.isValid).toBe(false);
    expect(res.unverified).toBeUndefined();
  });

  test('leaves the city and state blank when the lookup fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const res = await validatePincode('411001');

    expect(res.isValid).toBe(false);
    expect(resolveLocationFromPostalResult('411001', res.postOffices)).toBe('');
  });
});

describe('validationSchemas exported boundaries', () => {
  test('pins the account, identity and OTP boundaries', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PROCUCEV_EMAIL_PATTERN.test('ops@procucev.com')).toBe(true);
    expect(PROCUCEV_EMAIL_PATTERN.test('ops@example.com')).toBe(false);
    expect(PROCUCEV_EMAIL_MESSAGE).toBe('Must be a valid Procucev corporate email address ending in @procucev.com');
    expect(OTP_CODE_PATTERN.test('123456')).toBe(true);
    expect(OTP_CODE_PATTERN.test('12345')).toBe(false);
    expect(OTP_CODE_MESSAGE).toBe('OTP code must be exactly 6 numeric digits');
  });

  test('pins the dummy-pincode set and the tax identifier and website formats', () => {
    expect(DUMMY_PINCODES.has('111111')).toBe(true);
    expect(DUMMY_PINCODES.has('400701')).toBe(false);
    expect(PAN_PATTERN.test('AAACL1234F')).toBe(true);
    expect(PAN_PATTERN.test('AAACL12345')).toBe(false);
    expect(CIN_PATTERN.test('L28920MH1946PLC004768')).toBe(true);
    expect(CIN_PATTERN.test('X28920MH1946PLC004768')).toBe(false);
    expect(WEBSITE_PATTERN.test('https://www.lnt.com')).toBe(true);
    expect(WEBSITE_PATTERN.test('ftp://lnt.com')).toBe(false);
  });

  test('pins the vendor directory, payment, activity, task, document and credit schemas', () => {
    expect(PUBLIC_VENDOR_QUERY_SCHEMA.search).toEqual({ maxLength: 200 });
    expect(INDIAN_STATES).toContain('Maharashtra');
    expect(VENDOR_DIRECTORY_AUTH_SCHEMA.passkey).toEqual({ minLength: 1, maxLength: 100 });
    expect(PAYMENT_DUES_COMMUNICATION_SCHEMA.email).toBeDefined();
    expect(ACTIVITY_LOG_SCHEMA.channel).toBeDefined();
    expect(INTERNAL_TASK_SCHEMA.title).toEqual({ minLength: 2, maxLength: 512 });
    expect(ACCOUNT_DOCUMENT_UPLOAD_SCHEMA.documentName).toEqual({ minLength: 1, maxLength: 255 });
    expect(SELLER_ADD_QUOTE_CREDITS_SCHEMA.amount).toEqual({ min: 1, max: 5 });
    expect(BUYER_CREDIT_APPROVAL_REQUEST_SCHEMA.amount).toEqual({ min: 1 });
  });
});

describe('validationSchemas edge branches', () => {
  test('skips string-only length and pattern checks for a non-string value on an untyped rule', () => {
    const schema: FormSchema = { flag: { pattern: /^x$/ } };
    expect(validateFormData(schema, { flag: 42 })).toEqual({ isValid: true, fieldErrors: {} });
  });

  test('reports the PIN as unverified when the request cannot be set up, and sends nothing', async () => {
    const originalAbortController = global.AbortController;
    const originalFetch = global.fetch;
    global.AbortController = (function unavailableAbortController() {
      throw new Error('AbortController unavailable');
    }) as unknown as typeof AbortController;
    global.fetch = jest.fn();
    try {
      const res = await validatePincode('400701');
      expect(res).toEqual({ isValid: false, unverified: true, message: UI_STRINGS.pincodeVerification.unverified });
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.AbortController = originalAbortController;
      global.fetch = originalFetch;
    }
  });
});

describe('PO dump required columns', () => {
  it('reports no missing header when a sheet has the vendor, description and specifications columns', () => {
    expect(findMissingPoDumpHeaders(['PO Number', 'Vendor Name', 'Line Item Description', 'Specifications', 'Quantity'])).toEqual([]);
  });

  it('accepts the other spellings of each required column', () => {
    expect(findMissingPoDumpHeaders(['Vendor Code', 'Item Description', 'Technical Specs'])).toEqual([]);
  });

  it('names each required column that no header satisfies', () => {
    expect(findMissingPoDumpHeaders(['PO Number', 'Quantity'])).toEqual([
      UI_STRINGS.vendorPoIngestion.poDump.fieldVendor,
      UI_STRINGS.vendorPoIngestion.poDump.fieldDescription,
      UI_STRINGS.vendorPoIngestion.poDump.fieldSpecs,
    ]);
  });

  it('names only the specifications column when that is the one missing', () => {
    expect(findMissingPoDumpHeaders(['Vendor Name', 'Item Description'])).toEqual([
      UI_STRINGS.vendorPoIngestion.poDump.fieldSpecs,
    ]);
  });

  it('reports no missing field for a complete row and names each blank required field', () => {
    expect(findMissingPoDumpFields({ vendorIdentifier: 'Apex', itemName: 'Valve', specs: 'DN50' })).toEqual([]);
    expect(findMissingPoDumpFields({ vendorIdentifier: '  ', itemName: 'Valve', specs: undefined })).toEqual([
      UI_STRINGS.vendorPoIngestion.poDump.fieldVendor,
      UI_STRINGS.vendorPoIngestion.poDump.fieldSpecs,
    ]);
  });

  it('treats the description as missing when only the description is blank', () => {
    expect(findMissingPoDumpFields({ vendorIdentifier: 'Apex', itemName: '', specs: 'DN50' })).toEqual([
      UI_STRINGS.vendorPoIngestion.poDump.fieldDescription,
    ]);
  });
});
