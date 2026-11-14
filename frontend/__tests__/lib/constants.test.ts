import {
  SOURCING_MODES,
  RFQ_MODES,
  RFQ_MODE_LABELS,
  RFQ_MODE_MAP,
  rfqVersionLabel,
  CURRENCY,
  formatCurrency,
  formatFileSize,
  STORE_MESSAGES,
  AES_CONFIG,
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  DISPLAY_TIMEZONE,
  RFQ_STATUSES,
  formatIndianDate,
  formatIndianDateTime,
  parseRfqTimestamp,
  BUYER_SUBSCRIPTION_TO_SOURCING_MODE,
  resolveBuyerSourcingMode,
  entitledSourcingModes,
  normalizePoDate,
  ALLOWED_EXTENSION_HOURS,
  DEFAULT_EXTENSION_HOURS,
  calculateExtendedDeadline,
} from '@/lib/constants';


describe('lib/constants', () => {
  it('should export valid RFQ_MODES and RFQ_MODE_LABELS', () => {
    expect(RFQ_MODES.MODE_0).toBe('mode_0');
    expect(RFQ_MODES.MODE_1).toBe('mode_1');
    expect(RFQ_MODES.MODE_2).toBe('mode_2');
    expect(RFQ_MODES.MODE_3).toBe('mode_3');
    expect(RFQ_MODE_LABELS[RFQ_MODES.MODE_1]).toBe('Mode 1');
    expect(RFQ_MODE_LABELS[RFQ_MODES.MODE_2]).toBe('Mode 2');
    expect(RFQ_MODE_LABELS[RFQ_MODES.MODE_3]).toBe('Mode 3');
    expect(RFQ_MODE_LABELS[RFQ_MODES.MODE_0]).toBe('Mode 0');

    expect(RFQ_MODE_MAP['v1']).toBe('mode_1');
    expect(RFQ_MODE_MAP['v2']).toBe('mode_2');
    expect(RFQ_MODE_MAP['v3']).toBe('mode_3');
    expect(RFQ_MODE_MAP['mode 1']).toBe('mode_1');

    expect(rfqVersionLabel('mode_1')).toBe('Mode 1');
    expect(rfqVersionLabel('mode_2')).toBe('Mode 2');
    expect(rfqVersionLabel('mode_3')).toBe('Mode 3');
    expect(rfqVersionLabel('mode_0')).toBe('Mode 0');
    expect(rfqVersionLabel(null)).toBe('Mode 0');
  });

  it('should export valid SOURCING_MODES', () => {
    expect(Array.isArray(SOURCING_MODES)).toBe(true);
    expect(SOURCING_MODES.length).toBe(4);

    const mode0 = SOURCING_MODES.find(m => m.id === 'mode_0');
    expect(mode0).toBeDefined();
    expect(mode0?.code).toBe('Mode 0');

    const mode1 = SOURCING_MODES.find(m => m.id === 'mode_1');
    expect(mode1).toBeDefined();
    expect(mode1?.code).toBe('Mode 1');
    expect(mode1?.name).toContain('Client Roster');

    const mode2 = SOURCING_MODES.find(m => m.id === 'mode_2');
    expect(mode2).toBeDefined();
    expect(mode2?.code).toBe('Mode 2');

    const mode3 = SOURCING_MODES.find(m => m.id === 'mode_3');
    expect(mode3).toBeDefined();
    expect(mode3?.code).toBe('Mode 3');
  });

  it('no longer exports seeded plans, placeholder system config, Azure rows, or allow-list bypasses', () => {
    const constantsModule = require('@/lib/constants');
    [
      'INITIAL_SYSTEM_CONFIG',
      'INITIAL_AZURE_HEALTH',
      'BUYER_SUBSCRIPTION_PLANS',
      'VENDOR_SUBSCRIPTION_PLANS',
      'UNLIMITED_ACCESS_EMAILS',
      'hasUnlimitedAccess',
      'DEFAULT_INTERNAL_MEMBERS',
      'DEFAULT_VENDOR_DIRECTORY_PASSKEY',
    ].forEach((name) => {
      expect(constantsModule).not.toHaveProperty(name);
    });
  });

  it('exports STORE_MESSAGES with the notices the store shows when a server call fails or confirms', () => {
    expect(STORE_MESSAGES.chaserNotSentTitle).toBe('Chaser Not Sent');
    expect(STORE_MESSAGES.aiFeedLoadFailed).toContain('AI activity feed');
    expect(STORE_MESSAGES.vendorsRemovedMessage).toContain('{count}');
    expect(STORE_MESSAGES.chaserSentMessage).toContain('{sent} of {total}');
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
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
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

describe('formatFileSize', () => {
  test.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [2048, '2.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
    // Capped at GB rather than rolling on to TB, which no attachment reaches.
    [1024 * 1024 * 1024 * 5, '5.0 GB'],
  ])('renders %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  // A record written before size was captured yields NaN, and "NaN B" in a
  // document list is worse than reporting nothing.
  test.each([NaN, Infinity, -1, undefined as unknown as number])('renders %p as zero bytes', (bytes) => {
    expect(formatFileSize(bytes)).toBe('0 B');
  });
});

// ==============================================================================
// INDIAN DATE AND TIME FORMATTING
// ==============================================================================
// RFQ timestamps are stored in UTC, which is right for storage and wrong for
// display: everyone reading them is in India, so a raised-at of
// "2026-09-04T09:25:21.000Z" reads five and a half hours earlier than the moment
// the buyer actually pressed save.
// ==============================================================================

describe('DISPLAY_TIMEZONE', () => {
  it('presents timestamps in India', () => {
    expect(DISPLAY_TIMEZONE).toBe('Asia/Kolkata');
  });
});

describe('formatIndianDateTime', () => {
  // 09:25 UTC is 14:55 IST, so the shift is what proves the timezone applied.
  it('shifts a UTC instant into IST and names the zone', () => {
    expect(formatIndianDateTime('2026-09-04T09:25:21.000Z')).toBe('04 Sept 2026, 02:55 pm IST');
  });

  // MySQL hands a DATETIME back with no zone designator. It stores UTC, so it has
  // to be read as UTC — parsed as local time it would shift by the viewer's offset.
  it('reads a bare MySQL DATETIME as UTC', () => {
    expect(formatIndianDateTime('2026-09-02 11:07:16')).toBe('02 Sept 2026, 04:37 pm IST');
  });

  it('accepts a MySQL DATETIME without seconds', () => {
    expect(formatIndianDateTime('2026-09-02 11:07')).toBe('02 Sept 2026, 04:37 pm IST');
  });

  it('crosses midnight forward when the UTC time is late enough', () => {
    // 20:00 UTC on the 4th is 01:30 IST on the 5th.
    expect(formatIndianDateTime('2026-09-04T20:00:00.000Z')).toBe('05 Sept 2026, 01:30 am IST');
  });

  it('converts a UTC-stamped string into IST', () => {
    expect(formatIndianDateTime('2026-11-10 03:17 UTC')).toBe('10 Nov 2026, 08:47 am IST');
    expect(formatIndianDateTime('2026-11-10 03:17:00 UTC')).toBe('10 Nov 2026, 08:47 am IST');
  });

  it('preserves an already-formatted IST timestamp string', () => {
    expect(formatIndianDateTime('10 Nov 2026, 08:47 am IST')).toBe('10 Nov 2026, 08:47 am IST');
  });

  it.each([[''], ['   '], [undefined]])('reports nothing for %p', (value) => {
    expect(formatIndianDateTime(value)).toBe('');
  });

  // A legacy record should still show whatever it holds rather than "Invalid Date".
  it('returns an unparseable value unchanged', () => {
    expect(formatIndianDateTime('not a date')).toBe('not a date');
  });
});

describe('formatIndianDate', () => {
  // A date-only value must not slip to the previous day for a viewer behind UTC.
  it('formats a plain date without shifting the day', () => {
    expect(formatIndianDate('2026-09-15')).toBe('15 Sept 2026');
  });

  it('formats the date part of a full instant', () => {
    expect(formatIndianDate('2026-09-02T11:07:16.000Z')).toBe('02 Sept 2026');
  });

  it.each([[''], ['  '], [undefined]])('reports nothing for %p', (value) => {
    expect(formatIndianDate(value)).toBe('');
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatIndianDate('nope')).toBe('nope');
  });
});

describe('RFQ_STATUSES', () => {
  // The edit dialog builds its status dropdown from this list, so it has to match
  // the RFQItem['status'] union exactly or the dialog offers a status the type
  // does not allow.
  it('lists every RFQ state in pipeline order', () => {
    expect(RFQ_STATUSES).toEqual([
      'Parsing',
      'Quotes Pending',
      'In Evaluation',
      'AI Recommended',
      'PO Generated',
    ]);
  });
});

describe('resolveBuyerSourcingMode & BUYER_SUBSCRIPTION_TO_SOURCING_MODE', () => {
  it('maps subscription plan IDs to corresponding sourcing modes', () => {
    expect(BUYER_SUBSCRIPTION_TO_SOURCING_MODE.version_1).toBe('mode_1');
    expect(BUYER_SUBSCRIPTION_TO_SOURCING_MODE.version_2).toBe('mode_2');
    expect(BUYER_SUBSCRIPTION_TO_SOURCING_MODE.version_3).toBe('mode_3');
  });

  it('resolves version_1 plan to mode_1', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_1' })).toBe('mode_1');
    expect(resolveBuyerSourcingMode('version_1')).toBe('mode_1');
    expect(resolveBuyerSourcingMode('v1')).toBe('mode_1');
    expect(resolveBuyerSourcingMode('mode_1')).toBe('mode_1');
  });

  it('resolves version_2 plan to mode_2', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_2' })).toBe('mode_2');
    expect(resolveBuyerSourcingMode('version_2')).toBe('mode_2');
    expect(resolveBuyerSourcingMode('v2')).toBe('mode_2');
    expect(resolveBuyerSourcingMode('mode_2')).toBe('mode_2');
  });

  it('resolves version_3 plan to mode_3', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_3' })).toBe('mode_3');
    expect(resolveBuyerSourcingMode('version_3')).toBe('mode_3');
    expect(resolveBuyerSourcingMode('v3')).toBe('mode_3');
    expect(resolveBuyerSourcingMode('mode_3')).toBe('mode_3');
  });

  it('defaults to mode_0 for free_trial, unknown plan, empty object or null', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial' })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'starter_plan' })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({})).toBe('mode_0');
    expect(resolveBuyerSourcingMode(null)).toBe('mode_0');
    expect(resolveBuyerSourcingMode(undefined)).toBe('mode_0');
  });

  it('prioritizes active subscription over remaining free RFQ credits', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_1', remainingFreeRFQs: 0 })).toBe('mode_1');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_2', remainingFreeRFQs: 0 })).toBe('mode_2');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_3', remainingFreeRFQs: 0 })).toBe('mode_3');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'unlimited' })).toBe('mode_3');
  });

  it('for buyers without active V1/V2/V3 subscription, automatically assigns mode_0 by default regardless of free credits', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 1 })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({ remainingFreeRFQs: 5 })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({ remainingFreeRFQs: 0 })).toBe('mode_0');
  });

  it('handles multiple active subscriptions by selecting the highest active tier (V3 > V2 > V1)', () => {
    expect(resolveBuyerSourcingMode({
      subscriptions: [
        { plan: 'version_1', status: 'active' },
        { plan: 'version_2', status: 'active' },
      ],
    })).toBe('mode_2');

    expect(resolveBuyerSourcingMode({
      subscriptions: [
        { plan: 'version_1', status: 'active' },
        { plan: 'version_3', status: 'active' },
      ],
    })).toBe('mode_3');
  });

  it('disregards expired or inactive subscriptions and falls back to mode_0', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_2', subscriptionStatus: 'expired' })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_3', subscriptionStatus: 'inactive' })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({
      subscriptionPlan: 'version_1',
      subscriptionExpiry: new Date(Date.now() - 100000).toISOString(),
    })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({
      subscriptions: [{ plan: 'version_3', status: 'expired' }],
    })).toBe('mode_0');
  });
});

describe('entitledSourcingModes', () => {
  it('mirrors the backend SUBSCRIPTION_MODE_ENTITLEMENTS tiers exactly', () => {
    expect(entitledSourcingModes('free_trial')).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
    expect(entitledSourcingModes('version_1')).toEqual(['mode_0', 'mode_1']);
    expect(entitledSourcingModes('version_2')).toEqual(['mode_0', 'mode_1', 'mode_2']);
    expect(entitledSourcingModes('version_3')).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
    expect(entitledSourcingModes('unlimited')).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
  });

  it('entitles all sourcing modes when unlimitedRfqAccess is true regardless of credits or plan', () => {
    expect(entitledSourcingModes('free_trial', 0, true)).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
    expect(entitledSourcingModes(null, 0, true)).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
    expect(entitledSourcingModes('version_1', 0, true)).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
  });

  it('falls back to the most restrictive tier for an unrecognised plan string, not to allowing everything', () => {
    expect(entitledSourcingModes('some_unknown_plan')).toEqual(['mode_0', 'mode_1']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(entitledSourcingModes(' Version_2 ')).toEqual(['mode_0', 'mode_1', 'mode_2']);
    expect(entitledSourcingModes(' Unlimited ')).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
  });

  it('defaults to the most restrictive tier when the plan is unresolved (null/undefined), not to allowing everything', () => {
    expect(entitledSourcingModes(null)).toEqual(['mode_0', 'mode_1']);
    expect(entitledSourcingModes(undefined)).toEqual(['mode_0', 'mode_1']);
  });
});

describe('normalizePoDate', () => {
  it('returns empty string for null, undefined, or empty values', () => {
    expect(normalizePoDate(null)).toBe('');
    expect(normalizePoDate(undefined)).toBe('');
    expect(normalizePoDate('')).toBe('');
    expect(normalizePoDate('   ')).toBe('');
  });

  it('handles Date instances correctly', () => {
    expect(normalizePoDate(new Date('2025-12-04T00:00:00Z'))).toBe('2025-12-04');
    expect(normalizePoDate(new Date('invalid'))).toBe('');
  });

  it('converts Excel date serial numbers and decimal strings to ISO dates', () => {
    expect(normalizePoDate(45995)).toBe('2025-12-04');
    expect(normalizePoDate(45995.00011574074)).toBe('2025-12-04');
    expect(normalizePoDate('45995.00011574074')).toBe('2025-12-04');
    expect(normalizePoDate('45995')).toBe('2025-12-04');
    expect(normalizePoDate(25569)).toBe('1970-01-01');
    expect(normalizePoDate(0)).toBe('');
  });

  it('preserves and normalizes ISO format dates', () => {
    expect(normalizePoDate('2025-12-04')).toBe('2025-12-04');
    expect(normalizePoDate('2025/12/04')).toBe('2025-12-04');
    expect(normalizePoDate('2025.12.04')).toBe('2025-12-04');
  });

  it('normalizes DD-MM-YYYY and DD/MM/YYYY dates', () => {
    expect(normalizePoDate('12-04-2025')).toBe('2025-04-12');
    expect(normalizePoDate('25-12-2025')).toBe('2025-12-25');
    expect(normalizePoDate('05/12/2025')).toBe('2025-12-05');
    expect(normalizePoDate('12/25/2025')).toBe('2025-12-25');
  });

  it('handles generic date strings via Date.parse', () => {
    expect(normalizePoDate('Dec 4, 2025')).toBe('2025-12-04');
  });

  it('falls back to raw string when not parseable', () => {
    expect(normalizePoDate('not-a-valid-date')).toBe('not-a-valid-date');
  });

  describe('RFQ Extension Constants & Helper', () => {
    it('exports allowed extension hours and defaults', () => {
      expect(ALLOWED_EXTENSION_HOURS).toEqual([24, 48]);
      expect(DEFAULT_EXTENSION_HOURS).toBe(24);
    });

    it('calculates deadline extension with valid existing deadline', () => {
      const futureDeadline = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const extended24 = calculateExtendedDeadline(futureDeadline, 24);
      expect(new Date(extended24).getTime()).toBe(new Date(futureDeadline).getTime() + 24 * 60 * 60 * 1000);

      const extended48 = calculateExtendedDeadline(futureDeadline, 48);
      expect(new Date(extended48).getTime()).toBe(new Date(futureDeadline).getTime() + 48 * 60 * 60 * 1000);
    });

    it('calculates deadline extension from baseCreatedAt when deadline is not provided', () => {
      const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const extended = calculateExtendedDeadline(undefined, 24, createdAt);
      expect(new Date(extended).getTime()).toBeGreaterThan(Date.now());
    });

    it('calculates deadline extension from current time when neither deadline nor createdAt is provided', () => {
      const before = Date.now();
      const extended = calculateExtendedDeadline(undefined, 24);
      const extendedMs = new Date(extended).getTime();
      expect(extendedMs).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000 - 1000);
    });
  });

  describe('VENDOR_ASSIGNMENT_LIMITS & resolveBuyerSourcingMode branch boosts', () => {
    it('evaluates VENDOR_ASSIGNMENT_LIMITS getters with and without environment overrides', () => {
      const { VENDOR_ASSIGNMENT_LIMITS } = require('@/lib/constants');
      // Defaults
      delete process.env.NEXT_PUBLIC_MAX_CLIENT_VENDORS_PER_CATEGORY;
      delete process.env.NEXT_PUBLIC_MAX_PROCUCEV_VENDORS_PER_CATEGORY;
      expect(VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY).toBe(25);
      expect(VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY).toBe(25);

      // With overrides
      process.env.NEXT_PUBLIC_MAX_CLIENT_VENDORS_PER_CATEGORY = '12';
      process.env.NEXT_PUBLIC_MAX_PROCUCEV_VENDORS_PER_CATEGORY = '8';
      expect(VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY).toBe(12);
      expect(VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY).toBe(8);

      delete process.env.NEXT_PUBLIC_MAX_CLIENT_VENDORS_PER_CATEGORY;
      delete process.env.NEXT_PUBLIC_MAX_PROCUCEV_VENDORS_PER_CATEGORY;
    });

    it('resolves unlimitedRfqAccess and unlimitedAccess with various requested modes', () => {
      const { resolveBuyerSourcingMode, RFQ_MODES } = require('@/lib/constants');
      expect(resolveBuyerSourcingMode({ unlimitedRfqAccess: true, sourcingMode: 'mode_0' })).toBe(RFQ_MODES.MODE_0);
      expect(resolveBuyerSourcingMode({ unlimitedAccess: true, sourcing_mode: 'mode_1' })).toBe(RFQ_MODES.MODE_1);
      expect(resolveBuyerSourcingMode({ unlimitedRfqAccess: true, sourcingMode: 'v2' })).toBe(RFQ_MODES.MODE_2);
      expect(resolveBuyerSourcingMode({ unlimitedRfqAccess: true }, 'v3')).toBe(RFQ_MODES.MODE_3);
      expect(resolveBuyerSourcingMode({ unlimitedRfqAccess: true }, 'unknown_mode')).toBe(RFQ_MODES.MODE_3);
    });

    it('resolves subscriptions array and single plan variations', () => {
      const { resolveBuyerSourcingMode, RFQ_MODES } = require('@/lib/constants');
      // Subscriptions array with version_1 and version_0
      expect(resolveBuyerSourcingMode({ subscriptions: [{ plan: 'version_1', status: 'active' }] })).toBe(RFQ_MODES.MODE_1);
      expect(resolveBuyerSourcingMode({ subscriptions: [{ plan: 'version_0', status: 'active' }] })).toBe(RFQ_MODES.MODE_0);

      // Subscriptions with active === false or past expiry
      const expiredSub = { plan: 'version_3', status: 'active', expiresAt: new Date(Date.now() - 100000).toISOString() };
      const inactiveSub = { plan: 'version_3', status: 'active', active: false };
      expect(resolveBuyerSourcingMode({ subscriptions: [expiredSub, inactiveSub] })).toBe(RFQ_MODES.MODE_0);

      // Single plan version_0
      expect(resolveBuyerSourcingMode('version_0')).toBe(RFQ_MODES.MODE_0);
    });

    it('normalizePoDate handles number out of range and templates constants exist', () => {
      const { normalizePoDate, QUA_AI_TRANSACTIONAL_EMAIL_TEMPLATES, QUA_AI_EMAIL_SUPPORT, PRESENCE_ONLINE_THRESHOLD_MS } = require('@/lib/constants');
      expect(normalizePoDate('200000')).toBe('');
      expect(QUA_AI_TRANSACTIONAL_EMAIL_TEMPLATES.EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED).toBeDefined();
      expect(QUA_AI_EMAIL_SUPPORT.PHONE).toBe('+91 8247722944');
      expect(PRESENCE_ONLINE_THRESHOLD_MS).toBe(600000);
    });

    it('parseSearchTokens handles single terms, comma-separated lists, and multi-email search', () => {
      const { parseSearchTokens } = require('@/lib/constants');
      expect(parseSearchTokens(null)).toEqual([]);
      expect(parseSearchTokens('')).toEqual([]);
      expect(parseSearchTokens('   ')).toEqual([]);

      // Single phrase
      expect(parseSearchTokens('Sudheer Solutions pvt LTD')).toEqual(['Sudheer Solutions pvt LTD']);

      // Comma separated emails
      const multiEmail = 'govardhan.kilari@procucev.com, veerababu.v@procucev.com, nilesh.murme@procucev.com';
      expect(parseSearchTokens(multiEmail)).toEqual([
        'govardhan.kilari@procucev.com',
        'veerababu.v@procucev.com',
        'nilesh.murme@procucev.com',
      ]);

      // Semicolon and newlines
      expect(parseSearchTokens('a@b.com; c@d.com\ne@f.com')).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);

      // Space separated emails
      expect(parseSearchTokens('user1@x.com user2@y.com')).toEqual(['user1@x.com', 'user2@y.com']);
    });
  });
});


describe('getVendorCreditBalance', () => {
  const { getVendorCreditBalance, VENDOR_PLAN_RFQ_QUOTA } = require('@/lib/constants');

  it('returns plan quota less downloads used for Select and Connect subscribers', () => {
    expect(VENDOR_PLAN_RFQ_QUOTA).toEqual({ connect: 50, select: 100 });
    expect(getVendorCreditBalance({ subscriptionPlan: 'select', rfqDownloadsUsed: 9, freeQuotationCredits: 0 })).toBe(91);
    expect(getVendorCreditBalance({ subscriptionPlan: 'connect', rfqDownloadsUsed: 10 })).toBe(40);
    expect(getVendorCreditBalance({ subscriptionPlan: 'select', rfqDownloadsUsed: 0 })).toBe(100);
    expect(getVendorCreditBalance({ subscriptionPlan: 'select', rfqDownloadsUsed: 150 })).toBe(0);
    // Without the downloads count the balance is unknown, so no full quota is shown in its place.
    expect(getVendorCreditBalance({ subscriptionPlan: 'select' })).toBeNull();
    expect(getVendorCreditBalance({ subscriptionPlan: 'connect', rfqDownloadsUsed: Number.NaN })).toBeNull();
  });

  it('uses the stored free-tier balance for vendors without a subscription, and null when none is stored', () => {
    expect(getVendorCreditBalance({ subscriptionPlan: 'premium', freeQuotationCredits: 3 })).toBe(3);
    expect(getVendorCreditBalance({ freeQuotationCredits: -2 })).toBe(0);
    expect(getVendorCreditBalance({ freeQuotationCredits: 0 })).toBe(0);
    expect(getVendorCreditBalance({})).toBeNull();
    expect(getVendorCreditBalance({ subscriptionPlan: 'premium' })).toBeNull();
  });
});

describe('parseRfqTimestamp', () => {
  it('reads an ISO instant and a zone-less MySQL DATETIME as the same UTC moment', () => {
    expect(parseRfqTimestamp('2026-09-02T11:07:16.000Z')).toBe(parseRfqTimestamp('2026-09-02 11:07:16'));
  });

  it('reads a UTC-tagged string as UTC', () => {
    expect(parseRfqTimestamp('2026-11-10 03:17 UTC')).toBe(Date.parse('2026-11-10T03:17:00.000Z'));
  });

  it('reads a date-only value as midnight UTC', () => {
    expect(parseRfqTimestamp('2026-08-29')).toBe(Date.parse('2026-08-29T00:00:00.000Z'));
  });

  it.each([[undefined], [null], [''], ['   '], ['not a date']])('returns null for %p', (value) => {
    expect(parseRfqTimestamp(value)).toBeNull();
  });
});
