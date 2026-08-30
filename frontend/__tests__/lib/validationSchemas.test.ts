import {
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  FormSchema,
} from '../../lib/validationSchemas';

describe('Frontend validationSchemas Unit Tests', () => {
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
});
