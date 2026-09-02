import {
  SOURCING_MODES,
  CURRENCY,
  formatCurrency,
  MANUAL_LINE_ITEM_DEFAULTS,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  BUYER_SUBSCRIPTION_PLANS,
  VENDOR_SUBSCRIPTION_PLANS,
  AES_CONFIG,
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
} from '@/lib/constants';


describe('lib/constants', () => {
  it('should export valid SOURCING_MODES', () => {
    expect(Array.isArray(SOURCING_MODES)).toBe(true);
    expect(SOURCING_MODES.length).toBe(3);
    
    const mode1 = SOURCING_MODES.find(m => m.id === 'mode_1');
    expect(mode1).toBeDefined();
    expect(mode1?.code).toBe('Version 1');
    expect(mode1?.name).toContain('Client Roster');

    const mode2 = SOURCING_MODES.find(m => m.id === 'mode_2');
    expect(mode2).toBeDefined();
    expect(mode2?.code).toBe('Version 2');

    const mode3 = SOURCING_MODES.find(m => m.id === 'mode_3');
    expect(mode3).toBeDefined();
    expect(mode3?.code).toBe('Version 3');
  });

  it('should export valid subscription plans', () => {
    expect(Array.isArray(BUYER_SUBSCRIPTION_PLANS)).toBe(true);
    expect(BUYER_SUBSCRIPTION_PLANS.length).toBeGreaterThan(0);
    expect(Array.isArray(VENDOR_SUBSCRIPTION_PLANS)).toBe(true);
    expect(VENDOR_SUBSCRIPTION_PLANS.length).toBeGreaterThan(0);
  });

  it('should export valid INITIAL_SYSTEM_CONFIG', () => {
    expect(INITIAL_SYSTEM_CONFIG).toBeDefined();
    expect(INITIAL_SYSTEM_CONFIG.ollamaModel).toBe('Llama 3 (8B Instruct)');
    expect(INITIAL_SYSTEM_CONFIG.ollamaActive).toBe(true);
    expect(INITIAL_SYSTEM_CONFIG.ocrExtractionThreshold).toBe(85);
    expect(INITIAL_SYSTEM_CONFIG.escalationIntervalHours).toBe(24);
    expect(INITIAL_SYSTEM_CONFIG.azureDbBackupFrequency).toBe('Daily');
    expect(INITIAL_SYSTEM_CONFIG.rbacEnforced).toBe(true);
  });

  it('should export valid INITIAL_AZURE_HEALTH services', () => {
    expect(Array.isArray(INITIAL_AZURE_HEALTH)).toBe(true);
    expect(INITIAL_AZURE_HEALTH.length).toBeGreaterThanOrEqual(5);
    
    const services = INITIAL_AZURE_HEALTH.map(s => s.service);
    expect(services.some(s => s.includes('PostgreSQL'))).toBe(true);
    expect(services.some(s => s.includes('OpenAI'))).toBe(true);
    expect(services.some(s => s.includes('Cosmos DB'))).toBe(true);
    expect(services.some(s => s.includes('Communication Services'))).toBe(true);
    expect(services.some(s => s.includes('Key Vault'))).toBe(true);
  });

  it('should re-export validation schemas, regex patterns, and validation helpers', () => {
    expect(FORM_SCHEMAS).toBeDefined();
    expect(FORM_SCHEMAS.rfqIngestion).toBeDefined();
    expect(EMAIL_PATTERN).toBeDefined();
    expect(GSTIN_PATTERN).toBeDefined();
    expect(PHONE_PATTERN).toBeDefined();
    expect(typeof validateFormData).toBe('function');

    const result = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Valid RFQ Title',
      category: 'Mechanical',
      budget: 20000,
      targetDeliveryDate: '2026-03-30',
    });
    expect(result.isValid).toBe(true);
  });

  it('should export valid AES_CONFIG constants', () => {
    expect(AES_CONFIG).toBeDefined();
    expect(AES_CONFIG.ALGORITHM).toBe('AES-GCM');
    expect(AES_CONFIG.KEY_LENGTH_BITS).toBe(256);
    expect(AES_CONFIG.IV_LENGTH_BYTES).toBe(12);
    expect(AES_CONFIG.TAG_LENGTH_BITS).toBe(128);
    expect(AES_CONFIG.PBKDF2_ITERATIONS).toBe(100000);
  });
});

describe('CURRENCY and formatCurrency', () => {
  it('pairs the rupee symbol with Indian grouping', () => {
    expect(CURRENCY.SYMBOL).toBe('₹');
    expect(CURRENCY.CODE).toBe('INR');
    expect(CURRENCY.LOCALE).toBe('en-IN');
  });

  it('groups amounts the Indian way, not in thousands', () => {
    // 1,45,000 rather than 145,000: the symbol and the grouping must agree.
    expect(formatCurrency(145000)).toBe('₹1,45,000');
    expect(formatCurrency(0)).toBe('₹0');
  });

  it('rounds to whole rupees because every figure shown is a total', () => {
    expect(formatCurrency(1500.4)).toBe('₹1,500');
    expect(formatCurrency(1500.6)).toBe('₹1,501');
  });

  // A record written before budget was persisted yields NaN here, and a crash on
  // a missing budget is exactly the defect this guard exists to prevent.
  it('renders a non-finite amount as zero instead of NaN', () => {
    expect(formatCurrency(NaN)).toBe('₹0');
    expect(formatCurrency(Infinity)).toBe('₹0');
    expect(formatCurrency(undefined as unknown as number)).toBe('₹0');
  });
});

describe('MANUAL_LINE_ITEM_DEFAULTS', () => {
  // These mirror RFQ_INGESTION_CONFIG on the backend so a row keyed by hand and a
  // row parsed from a document carry identical defaults.
  it('matches the backend ingestion defaults', () => {
    expect(MANUAL_LINE_ITEM_DEFAULTS.QUANTITY).toBe(1);
    expect(MANUAL_LINE_ITEM_DEFAULTS.UNIT).toBe('Nos');
    expect(MANUAL_LINE_ITEM_DEFAULTS.TARGET_DATE_OFFSET_DAYS).toBe(5);
  });
});
