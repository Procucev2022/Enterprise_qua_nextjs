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
  EXTENSION_HOURS_PER_DAY,
  DEFAULT_EXTENSION_DAYS,
  EXTENSION_MIN_DAYS,
  EXTENSION_MAX_DAYS,
  isWholeExtensionDays,
  parseExtensionDays,
  stepExtensionDays,
  extensionDaysFromHours,
  formatExtensionDayCount,
  calculateExtendedDeadline,
  resolveRfqClosingDeadline,
  RFQ_AUTO_CLOSE_HOURS,
  VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
  loadVendorUploadHistoryFromStorage,
  reconcileBuyerVendorsWithUploadHistory,
  isVendorActive,
  isVendorInactive,
  setVendorsActiveStateInStorage,
} from '@/lib/constants';
import type { BuyerAccount } from '@/lib/types';


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
    it('exports the extension day range, the default, and the hours in a day', () => {
      expect(EXTENSION_HOURS_PER_DAY).toBe(24);
      expect(EXTENSION_MIN_DAYS).toBe(1);
      expect(EXTENSION_MAX_DAYS).toBe(30);
      expect(DEFAULT_EXTENSION_DAYS).toBe(1);
    });

    it('calculates deadline extension with valid existing deadline', () => {
      const futureDeadline = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const extendedOneDay = calculateExtendedDeadline(futureDeadline, 1);
      expect(new Date(extendedOneDay).getTime()).toBe(new Date(futureDeadline).getTime() + 24 * 60 * 60 * 1000);

      const extendedThreeDays = calculateExtendedDeadline(futureDeadline, 3);
      expect(new Date(extendedThreeDays).getTime()).toBe(new Date(futureDeadline).getTime() + 72 * 60 * 60 * 1000);
    });

    it('extends by one day when no day count is passed', () => {
      const futureDeadline = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const extended = calculateExtendedDeadline(futureDeadline);
      expect(new Date(extended).getTime()).toBe(new Date(futureDeadline).getTime() + 24 * 60 * 60 * 1000);
    });

    it('extends from now when the closing time has already passed', () => {
      const before = Date.now();
      const extended = calculateExtendedDeadline('2020-01-01T00:00:00.000Z', 2);
      const extendedMs = new Date(extended).getTime();
      expect(extendedMs).toBeGreaterThanOrEqual(before + 2 * 24 * 60 * 60 * 1000);
      expect(extendedMs).toBeLessThanOrEqual(Date.now() + 2 * 24 * 60 * 60 * 1000);
    });

    it('extends from now when there is no closing time', () => {
      const before = Date.now();
      const extended = calculateExtendedDeadline(undefined, 1);
      const extendedMs = new Date(extended).getTime();
      expect(extendedMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
      expect(extendedMs).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
    });

    it('uses the stored closing time when there is one', () => {
      expect(resolveRfqClosingDeadline({
        closingDeadline: '2026-11-16T02:19:00.000Z',
        createdAt: '2026-11-14 02:19 UTC',
      })).toBe('2026-11-16T02:19:00.000Z');
    });

    it('closes 48 hours after creation when no closing time is stored, whatever the target date is', () => {
      // A record raised 14 Nov 2026 at 07:49 am IST with a target delivery date of 09 Dec 2026.
      const rfq = { createdAt: '2026-11-14 02:19 UTC', deadline: '2026-12-09' };
      const closing = resolveRfqClosingDeadline(rfq);

      expect(RFQ_AUTO_CLOSE_HOURS).toBe(48);
      expect(closing).toBe(new Date(Date.parse('2026-11-14T02:19:00Z') + 48 * 60 * 60 * 1000).toISOString());
      expect(closing).toBe('2026-11-16T02:19:00.000Z');
    });

    it('returns null when neither a closing time nor a creation time can be read', () => {
      expect(resolveRfqClosingDeadline({})).toBeNull();
      expect(resolveRfqClosingDeadline({ createdAt: 'not-a-date', closingDeadline: 'not-a-date' })).toBeNull();
    });

    it('accepts only whole days inside the range', () => {
      expect(isWholeExtensionDays(1)).toBe(true);
      expect(isWholeExtensionDays(30)).toBe(true);
      expect(isWholeExtensionDays('7')).toBe(true);
      expect(isWholeExtensionDays(0)).toBe(false);
      expect(isWholeExtensionDays(31)).toBe(false);
      expect(isWholeExtensionDays(2.5)).toBe(false);
      expect(isWholeExtensionDays('')).toBe(false);
      expect(isWholeExtensionDays(null)).toBe(false);
      expect(isWholeExtensionDays(undefined)).toBe(false);
    });

    it('parses a typed day count and returns null for anything that is not a valid whole-day count', () => {
      expect(parseExtensionDays(' 3 ')).toBe(3);
      expect(parseExtensionDays('30')).toBe(30);
      expect(parseExtensionDays('')).toBeNull();
      expect(parseExtensionDays('0')).toBeNull();
      expect(parseExtensionDays('31')).toBeNull();
      expect(parseExtensionDays('1.5')).toBeNull();
      expect(parseExtensionDays('abc')).toBeNull();
    });

    it('steps the day count by one and keeps the result inside the range', () => {
      expect(stepExtensionDays('3', 1)).toBe(4);
      expect(stepExtensionDays('3', -1)).toBe(2);
      expect(stepExtensionDays('1', -1)).toBe(1);
      expect(stepExtensionDays('30', 1)).toBe(30);
      expect(stepExtensionDays('45', 1)).toBe(30);
      expect(stepExtensionDays('0', -1)).toBe(1);
      expect(stepExtensionDays('2.7', 1)).toBe(3);
      expect(stepExtensionDays('', 1)).toBe(2);
      expect(stepExtensionDays('abc', -1)).toBe(1);
    });

    it('reads a stored extension in hours back as whole days', () => {
      expect(extensionDaysFromHours(24)).toBe(1);
      expect(extensionDaysFromHours(72)).toBe(3);
      expect(extensionDaysFromHours(720)).toBe(30);
      expect(extensionDaysFromHours(undefined)).toBe(1);
      expect(extensionDaysFromHours(0)).toBe(1);
    });

    it('labels a day count in the singular for one day and the plural otherwise', () => {
      expect(formatExtensionDayCount(1)).toBe('1 day');
      expect(formatExtensionDayCount(3)).toBe('3 days');
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

describe('Indian address location extraction helpers', () => {
  const {
    looksLikeCombinedAddress,
    extractIndianAddressLocation,
    resolveVendorLocationFields,
  } = require('@/lib/constants');

  it('detects combined address strings vs plain city names', () => {
    expect(looksLikeCombinedAddress('')).toBe(false);
    expect(looksLikeCombinedAddress(null)).toBe(false);
    expect(looksLikeCombinedAddress('Bengaluru')).toBe(false);
    expect(looksLikeCombinedAddress('Kolkata, WB')).toBe(true);
    expect(looksLikeCombinedAddress('Bengaluru 560037')).toBe(true);
    expect(looksLikeCombinedAddress('12 MG Road')).toBe(true);
    expect(looksLikeCombinedAddress('Navi Mumbai')).toBe(false);
    expect(looksLikeCombinedAddress('AECS Layout')).toBe(true);
  });

  it('extracts city, state, and pincode from full Indian street addresses and aliases', () => {
    expect(extractIndianAddressLocation(null)).toEqual({ city: '', state: '', pincode: '' });
    expect(
      extractIndianAddressLocation('302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560037')
    ).toEqual({
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560037',
    });
    expect(
      extractIndianAddressLocation('Plot 18, Chakan MIDC, Pune, Maharashtra - 410501, India')
    ).toEqual({
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '410501',
    });
    expect(extractIndianAddressLocation('Bangalore - 560038')).toEqual({
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    });
    expect(extractIndianAddressLocation('Sector 17, Chandigarh - 160017')).toEqual({
      city: 'Chandigarh',
      state: 'Chandigarh',
      pincode: '160017',
    });
    expect(extractIndianAddressLocation('New Delhi - 110001')).toEqual({
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110001',
    });
    expect(extractIndianAddressLocation('Kundalahalli Bengaluru 560037')).toEqual({
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560037',
    });
    expect(extractIndianAddressLocation('Gujarat')).toEqual({
      city: '',
      state: 'Gujarat',
      pincode: '',
    });
    expect(extractIndianAddressLocation('12345, CustomTown, MH')).toEqual({
      city: 'CustomTown',
      state: 'Maharashtra',
      pincode: '',
    });
    expect(extractIndianAddressLocation('302, Sharada, AECS Layout')).toEqual({
      city: '',
      state: '',
      pincode: '',
    });
  });

  it('reconciles stuffed city values and explicit address/city/state/pincode inputs', () => {
    expect(resolveVendorLocationFields(null)).toEqual({
      location: '',
      address: '',
      city: '',
      state: '',
      pincode: '',
    });
    expect(
      resolveVendorLocationFields({
        city: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560037',
      })
    ).toEqual({
      location: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560037',
      address: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560037',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560037',
    });
    expect(
      resolveVendorLocationFields({
        address: 'Plot 5, Whitefield',
        city: 'Bengaluru',
        state: 'ka',
        pincode: '560 066',
      })
    ).toEqual({
      location: 'Plot 5, Whitefield',
      address: 'Plot 5, Whitefield',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560066',
    });
    expect(resolveVendorLocationFields({ city: 'Nagpur' })).toEqual({
      location: 'Nagpur, Maharashtra',
      address: '',
      city: 'Nagpur',
      state: 'Maharashtra',
      pincode: '',
    });
    expect(resolveVendorLocationFields({ state: 'Texas', pincode: '78701' })).toEqual({
      location: 'Texas',
      address: '',
      city: '',
      state: 'Texas',
      pincode: '78701',
    });
  });

  it('defines PO_DUMP_TEMPLATE_HEADERS matching the Step 3 upload screen fields without legacy PO columns', () => {
    const { PO_DUMP_TEMPLATE_HEADERS } = require('@/lib/constants');
    const { UI_STRINGS } = require('@/lib/uiStrings');
    expect(PO_DUMP_TEMPLATE_HEADERS).toEqual([
      UI_STRINGS.vendorPoIngestion.poDump.fieldVendor,
      UI_STRINGS.vendorPoIngestion.poDump.fieldDescription,
      UI_STRINGS.vendorPoIngestion.poDump.fieldSpecsOptional,
    ]);
    expect(PO_DUMP_TEMPLATE_HEADERS).not.toContain('PO Number');
    expect(PO_DUMP_TEMPLATE_HEADERS).not.toContain('PO Date');
    expect(PO_DUMP_TEMPLATE_HEADERS).not.toContain('Quantity');
    expect(PO_DUMP_TEMPLATE_HEADERS).not.toContain('Unit Price (INR)');
    expect(PO_DUMP_TEMPLATE_HEADERS).not.toContain('Total Spend (INR)');
  });

  it('reconciles buyer vendors from local upload history with deduplication and storage guards', () => {
    const {
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      isBuyerUploadedVendor,
      isProcucevNetworkVendor,
      loadVendorUploadHistoryFromStorage,
      reconcileBuyerVendorsWithUploadHistory,
    } = require('@/lib/constants');

    expect(isBuyerUploadedVendor(null)).toBe(false);
    expect(isBuyerUploadedVendor({ source: 'buyer_uploaded' })).toBe(true);
    expect(isProcucevNetworkVendor({ source: 'procucev_network' })).toBe(true);

    localStorage.removeItem(VENDOR_UPLOAD_HISTORY_STORAGE_KEY);
    expect(loadVendorUploadHistoryFromStorage()).toEqual([]);
    localStorage.setItem(VENDOR_UPLOAD_HISTORY_STORAGE_KEY, '{bad-json');
    expect(loadVendorUploadHistoryFromStorage()).toEqual([]);
    localStorage.setItem(VENDOR_UPLOAD_HISTORY_STORAGE_KEY, JSON.stringify({ notArray: true }));
    expect(loadVendorUploadHistoryFromStorage()).toEqual([]);
    localStorage.setItem(
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      JSON.stringify([{ id: 'b-1', records: [{ vendorName: 'Uploaded Co', email: 'up@co.test' }] }])
    );
    expect(loadVendorUploadHistoryFromStorage()).toHaveLength(1);

    const existing = [
      {
        id: 'v-existing',
        name: 'Existing Vendor',
        contactPerson: 'Owner',
        phone: '9999999999',
        email: 'existing@co.test',
        majorCategory: 'Mechanical',
        minorCategories: [],
        location: 'Pune',
        rating: 4,
        source: 'buyer_manual',
      },
    ];
    expect(reconcileBuyerVendorsWithUploadHistory(existing, [])).toEqual(existing);

    const merged = reconcileBuyerVendorsWithUploadHistory(
      existing,
      [
        {
          id: 'batch-1',
          records: [
            { name: 'Dup Email', email: 'EXISTING@CO.TEST' },
            { name: 'Failed Row', email: 'fail@co.test', status: 'FAILED' },
            { name: '', email: '' },
            {
              vendorName: 'Veera Solutions Pvt LTD',
              email: 'veerababu@procucev.com',
              contactPerson: 'Veera',
              phone: '9381877013',
              city: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560037',
              majorCategory: 'Vendor Master',
              minorCategories: ['Valves'],
              gstin: '27AAACK3921P1Z9',
              rating: 85,
            },
            {
              email: 'emailonly@co.test',
              status: 'IMPORTED',
            },
          ],
        },
        { records: null },
      ],
      { id: 'ba-1', organizationName: 'Buyer Org' }
    );

    expect(merged).toHaveLength(3);
    expect(merged[1]).toMatchObject({
      name: 'Veera Solutions Pvt LTD',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560037',
      source: 'buyer_uploaded',
      addedByBuyerCompany: 'Buyer Org',
      buyerId: 'ba-1',
      rating: 85,
    });
    expect(merged[2]).toMatchObject({
      name: 'emailonly@co.test',
      rating: 0,
    });
  });

  it('subscribes to cross-tab storage events for vendor upload history and handles unavailable window guards', () => {
    const {
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      subscribeVendorUploadHistory,
    } = require('@/lib/constants');

    localStorage.setItem(
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      JSON.stringify([{ id: 'batch-sub-1', records: [{ vendorName: 'Subscribed Co', email: 'sub@co.test' }] }])
    );

    const updates: unknown[] = [];
    const unsubscribe = subscribeVendorUploadHistory((batches: unknown[]) => {
      updates.push(batches);
    });

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key' }));
    expect(updates).toHaveLength(0);

    window.dispatchEvent(new StorageEvent('storage', { key: VENDOR_UPLOAD_HISTORY_STORAGE_KEY }));
    expect(updates).toHaveLength(1);

    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(updates).toHaveLength(2);

    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: VENDOR_UPLOAD_HISTORY_STORAGE_KEY }));
    expect(updates).toHaveLength(2);

    const addSpy = jest.spyOn(window, 'addEventListener');
    const origAdd = window.addEventListener;
    try {
      Object.defineProperty(window, 'addEventListener', { configurable: true, value: undefined });
      const noop = subscribeVendorUploadHistory(() => {});
      expect(() => noop()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'addEventListener', { configurable: true, value: origAdd });
      addSpy.mockRestore();
      localStorage.removeItem(VENDOR_UPLOAD_HISTORY_STORAGE_KEY);
    }
  });

  it('removes deleted vendors from local storage upload batches and dispatches update event', () => {
    const {
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      removeVendorsFromUploadHistoryInStorage,
      loadVendorUploadHistoryFromStorage,
    } = require('@/lib/constants');

    localStorage.setItem(
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'batch-del-1',
          records: [
            { id: 'v-keep-1', vendorName: 'Keep Vendor', email: 'keep@test.com' },
            { id: 'v-del-1', vendorName: 'Delete By ID', email: 'del1@test.com' },
            { id: 'v-del-2', vendorName: 'Delete By Email', email: 'delete-me@test.com' },
            { id: 'v-del-3', vendorName: 'Delete By Name', email: 'del3@test.com' },
          ],
        },
        {
          id: 'batch-del-2',
          records: [
            { id: 'v-del-4', vendorName: 'Only Vendor To Delete', email: 'del4@test.com' },
          ],
        },
      ])
    );

    // Call with empty / null identifiers
    expect(removeVendorsFromUploadHistoryInStorage([] as any)).toHaveLength(2);
    expect(removeVendorsFromUploadHistoryInStorage(['   '])).toHaveLength(2);

    let eventFired = false;
    const listener = () => { eventFired = true; };
    window.addEventListener('vendor_upload_history_updated', listener);

    const updated = removeVendorsFromUploadHistoryInStorage([
      'v-del-1',
      'delete-me@test.com',
      'Delete By Name',
      'v-del-4',
    ]);

    window.removeEventListener('vendor_upload_history_updated', listener);

    expect(eventFired).toBe(true);
    expect(updated).toHaveLength(1);
    expect(updated[0].records).toHaveLength(1);
    expect(updated[0].records[0]).toMatchObject({ id: 'v-keep-1', vendorName: 'Keep Vendor' });

    // Verify localStorage reflects the filtered batches
    const stored = loadVendorUploadHistoryFromStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0].records).toHaveLength(1);

    localStorage.removeItem(VENDOR_UPLOAD_HISTORY_STORAGE_KEY);
  });

  it('normalizes vendor categories, strips placeholders, and updates stored upload history batches', () => {
    const {
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      isPlaceholderVendorCategory,
      normalizeVendorCategoryList,
      reconcileBuyerVendorsWithUploadHistory,
      updateVendorInUploadHistoryStorage,
      loadVendorUploadHistoryFromStorage,
    } = require('@/lib/constants');

    expect(isPlaceholderVendorCategory('')).toBe(true);
    expect(isPlaceholderVendorCategory(null)).toBe(true);
    expect(isPlaceholderVendorCategory('Vendor Master')).toBe(true);
    expect(isPlaceholderVendorCategory('Uncategorized (No Past POs)')).toBe(true);
    expect(isPlaceholderVendorCategory('Mechanical')).toBe(false);

    expect(
      normalizeVendorCategoryList(['Valves', 'Vendor Master', 'valves', 'Pumps', '', null, 'None'])
    ).toEqual(['Valves', 'Pumps']);
    expect(normalizeVendorCategoryList(null)).toEqual([]);

    const reconciled = reconcileBuyerVendorsWithUploadHistory(
      [],
      [
        {
          id: 'batch-placeholder',
          majorCategory: 'Vendor Master',
          records: [
            {
              name: 'Placeholder Vendor Co',
              email: 'placeholder@vendor.test',
              category: 'Uncategorised',
              minorCategories: ['Vendor Master', 'Bearings'],
            },
          ],
        },
      ]
    );
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].majorCategory).toBe('');
    expect(reconciled[0].minorCategories).toEqual(['Bearings']);

    localStorage.setItem(
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'batch-upd-1',
          records: [
            { id: 'v-master-1', vendorName: 'Govardhan Co', email: 'gov@co.test', category: 'Vendor Master' },
            { id: 'v-other', vendorName: 'Other Co', email: 'other@co.test', category: 'Electrical' },
          ],
        },
      ])
    );

    updateVendorInUploadHistoryStorage(['v-master-1', 'gov@co.test'], {
      id: 'v-promoted-1',
      majorCategory: 'IT Infrastructure',
      minorCategories: ['Laptops', 'Vendor Master'],
    });

    const updated = loadVendorUploadHistoryFromStorage();
    expect(updated[0].records[0]).toMatchObject({
      id: 'v-promoted-1',
      category: 'IT Infrastructure',
      majorCategory: 'IT Infrastructure',
      minorCategories: ['Laptops'],
    });
    expect(updated[0].records[1]).toMatchObject({ id: 'v-other', category: 'Electrical' });

    localStorage.removeItem(VENDOR_UPLOAD_HISTORY_STORAGE_KEY);
  });

  it('tracks active/inactive vendor states via isVendorInactive, isVendorActive, setVendorsActiveStateInStorage, and reconciliation', () => {
    expect(isVendorInactive(null)).toBe(false);
    expect(isVendorActive(null)).toBe(false);
    expect(isVendorActive({ id: 'v-1', status: 'REGISTERED / NOT EVALUATED' })).toBe(true);
    expect(isVendorInactive({ id: 'v-2', isActive: false })).toBe(true);
    expect(isVendorInactive({ id: 'v-3', disabled: true })).toBe(true);
    expect(isVendorInactive({ id: 'v-4', status: 'INACTIVE' })).toBe(true);
    expect(isVendorActive({ id: 'v-4', status: 'INACTIVE' })).toBe(false);

    localStorage.setItem(
      VENDOR_UPLOAD_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'batch-status-sync',
          records: [
            { id: 'rec-a', vendorName: 'Inactive Master Co', email: 'inactive@master.test', category: 'Mechanical' },
            { id: 'rec-b', vendorName: 'Active Master Co', email: 'active@master.test', category: 'Mechanical' },
          ],
        },
      ])
    );

    setVendorsActiveStateInStorage(['inactive@master.test'], false);
    let stored = loadVendorUploadHistoryFromStorage();
    expect(stored[0].records).toHaveLength(2);
    expect((stored[0].records ?? [])[0]).toMatchObject({ isActive: false, disabled: true, status: 'INACTIVE' });
    expect((stored[0].records ?? [])[1].isActive).toBeUndefined();

    const reconciled = reconcileBuyerVendorsWithUploadHistory([], stored, {
      id: 'buyer-1',
      organizationName: 'Acme Buyer',
    } as unknown as BuyerAccount);
    expect(isVendorInactive(reconciled[0])).toBe(true);
    expect(isVendorActive(reconciled[1])).toBe(true);

    setVendorsActiveStateInStorage(['inactive@master.test'], true);
    stored = loadVendorUploadHistoryFromStorage();
    expect((stored[0].records ?? [])[0]).toMatchObject({ isActive: true, disabled: false, status: 'REGISTERED / NOT EVALUATED' });

    localStorage.removeItem(VENDOR_UPLOAD_HISTORY_STORAGE_KEY);
  });

  it('scopes upload history reconciliation to matching buyer identity and excludes other buyers batches', () => {
    const activeBuyer = {
      id: 'buyer-owner-a',
      organizationName: 'Owner A Corp',
      corporateEmail: 'a@ownera.com',
    } as unknown as BuyerAccount;

    const batches = [
      {
        id: 'batch-other-buyer',
        buyerId: 'buyer-owner-b',
        buyerEmail: 'b@ownerb.com',
        records: [{ vendorName: 'Other Buyer Vendor', email: 'other@vendor.test', category: 'Mechanical' }],
      },
      {
        id: 'batch-same-buyer',
        buyerId: 'buyer-owner-a',
        records: [{ vendorName: 'Same Buyer Vendor', email: 'same@vendor.test', category: 'Mechanical' }],
      },
    ];

    const reconciled = reconcileBuyerVendorsWithUploadHistory([], batches, activeBuyer);
    expect(reconciled.map((v) => v.name)).toEqual(['Same Buyer Vendor']);
  });

  it('enforces comparison confidentiality helpers isRfqConcluded, resolveQuotesUnsealIso, and isBuyerQuotesSealed', () => {
    const {
      isRfqConcluded,
      resolveQuotesUnsealIso,
      isBuyerQuotesSealed,
    } = require('@/lib/constants');

    expect(isRfqConcluded(null)).toBe(false);
    expect(isBuyerQuotesSealed(null, 'buyer')).toBe(false);
    expect(resolveQuotesUnsealIso(null)).toBeNull();
    expect(resolveQuotesUnsealIso({ quotesHiddenUntil: '2026-12-01T00:00:00.000Z' })).toBe('2026-12-01T00:00:00.000Z');
    expect(resolveQuotesUnsealIso({ createdAt: 'not-a-date' })).toBeNull();

    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const fiftyHoursAgo = new Date(Date.now() - 50 * 3600 * 1000).toISOString();
    const futureClosing = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    expect(isBuyerQuotesSealed({ status: 'In Evaluation', sourcingMode: 'mode_1', createdAt: twoHoursAgo }, 'buyer')).toBe(true);
    expect(isBuyerQuotesSealed({ status: 'In Evaluation', sourcingMode: 'mode_1', createdAt: twoHoursAgo }, 'admin')).toBe(false);
    expect(isBuyerQuotesSealed({ status: 'In Evaluation', sourcingMode: 'mode_0', createdAt: twoHoursAgo }, 'buyer')).toBe(false);
    expect(isBuyerQuotesSealed({ status: 'In Evaluation', sourcingMode: 'mode_2', createdAt: fiftyHoursAgo, closingDeadline: futureClosing }, 'buyer')).toBe(true);
    expect(isBuyerQuotesSealed({ status: 'Closed', sourcingMode: 'mode_1', createdAt: twoHoursAgo }, 'buyer')).toBe(false);
    expect(isBuyerQuotesSealed({ status: 'PO Generated', sourcingMode: 'mode_1', createdAt: twoHoursAgo }, 'buyer')).toBe(false);
    expect(isBuyerQuotesSealed({ poFinalised: true, sourcingMode: 'mode_1', createdAt: twoHoursAgo }, 'buyer')).toBe(false);
    expect(isBuyerQuotesSealed({ poNumber: 'PO-9', sourcingMode: 'mode_1', createdAt: twoHoursAgo }, 'buyer')).toBe(false);
    expect(isBuyerQuotesSealed({ status: 'Expired', sourcingMode: 'mode_1', createdAt: twoHoursAgo }, 'buyer')).toBe(false);
    expect(resolveQuotesUnsealIso({ createdAt: fiftyHoursAgo, closingDeadline: futureClosing })).toBe(futureClosing);
  });

  it('handles createBackdropClickHandler and registerOutsideClickClose for modal backdrops and popovers', () => {
    const {
      createBackdropClickHandler,
      registerOutsideClickClose,
    } = require('@/lib/constants');

    const backdrop = document.createElement('div');
    const child = document.createElement('span');
    backdrop.appendChild(child);

    // 1. No-arg close callback
    const onClose = jest.fn();
    const handleBackdrop = createBackdropClickHandler(onClose);
    handleBackdrop({ target: child, currentTarget: backdrop });
    expect(onClose).not.toHaveBeenCalled();
    handleBackdrop({ target: backdrop, currentTarget: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);

    // 2. Setter callback with explicit closeValue
    const setOpen = jest.fn();
    const handleSetterBackdrop = createBackdropClickHandler(setOpen, false);
    handleSetterBackdrop({ target: backdrop, currentTarget: backdrop });
    expect(setOpen).toHaveBeenCalledWith(false);

    // 3. Blocked or null callback
    const blockedClose = jest.fn();
    createBackdropClickHandler(blockedClose, false, true)({ target: backdrop, currentTarget: backdrop });
    expect(blockedClose).not.toHaveBeenCalled();
    expect(() => createBackdropClickHandler(null)({ target: backdrop, currentTarget: backdrop })).not.toThrow();

    // 4. registerOutsideClickClose when closed vs open
    expect(registerOutsideClickClose(false, { current: backdrop }, onClose)).toBeUndefined();

    const closeDropdown = jest.fn();
    const cleanup = registerOutsideClickClose(true, { current: backdrop }, closeDropdown, false);
    expect(typeof cleanup).toBe('function');

    // Click inside container does not close
    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(closeDropdown).not.toHaveBeenCalled();

    // Click outside container closes with closeValue
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(closeDropdown).toHaveBeenCalledWith(false);
    cleanup?.();

    // Zero-arg close callback on outside click
    const zeroArgClose = jest.fn();
    const cleanupZeroArg = registerOutsideClickClose(true, { current: backdrop }, zeroArgClose);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(zeroArgClose).toHaveBeenCalledTimes(1);
    cleanupZeroArg?.();

    const { collectExistingBuyerVendorCodes } = require('@/lib/constants');
    expect(Array.from(collectExistingBuyerVendorCodes(null))).toEqual([]);
    expect(
      Array.from(
        collectExistingBuyerVendorCodes([
          { source: 'buyer_uploaded', vendorCode: ' VC-01 ' },
          { source: 'procucev_network', vendorCode: 'NET-1' },
          { source: 'buyer_uploaded', vendorCode: '   ' },
        ])
      )
    ).toEqual(['vc-01']);
  });

  it('covers table sorting, column visibility classes, sort indicators, and column reset helpers', () => {
    const {
      BUYER_VENDOR_DIRECTORY_COLUMNS,
      BUYER_RFQ_SUMMARY_COLUMNS,
      BUYER_EVALUATION_SUMMARY_COLUMNS,
      BUYER_ACCOUNTS_TABLE_COLUMNS,
      CM_ALL_RFQS_TABLE_COLUMNS,
      nextTableSortState,
      createColumnSortClickHandler,
      createColumnResetHandler,
      createBooleanSetterHandler,
      getTableColumnClass,
      getTableAriaSort,
      getSortIndicatorSymbol,
      resolveSortableCellValue,
      sortTableRows,
    } = require('@/lib/constants');

    expect(BUYER_VENDOR_DIRECTORY_COLUMNS.length).toBeGreaterThan(10);
    expect(BUYER_RFQ_SUMMARY_COLUMNS.length).toBeGreaterThan(8);
    expect(BUYER_EVALUATION_SUMMARY_COLUMNS.length).toBeGreaterThan(8);
    expect(BUYER_ACCOUNTS_TABLE_COLUMNS.length).toBeGreaterThan(10);
    expect(CM_ALL_RFQS_TABLE_COLUMNS.length).toBeGreaterThan(10);

    // Sort state cycling
    let sortState = { key: null as string | null, dir: 'asc' as 'asc' | 'desc' };
    sortState = nextTableSortState(sortState, 'name');
    expect(sortState).toEqual({ key: 'name', dir: 'asc' });
    sortState = nextTableSortState(sortState, 'name');
    expect(sortState).toEqual({ key: 'name', dir: 'desc' });
    sortState = nextTableSortState(sortState, 'name');
    expect(sortState).toEqual({ key: 'name', dir: 'asc' });
    sortState = nextTableSortState(sortState, 'email');
    expect(sortState).toEqual({ key: 'email', dir: 'asc' });

    const setSort = jest.fn((updater) => {
      sortState = updater(sortState);
    });
    const clickSort = createColumnSortClickHandler('email', setSort);
    clickSort();
    expect(sortState).toEqual({ key: 'email', dir: 'desc' });

    const setColumns = jest.fn();
    createColumnResetHandler(BUYER_RFQ_SUMMARY_COLUMNS, setColumns)();
    expect(setColumns).toHaveBeenCalledWith(BUYER_RFQ_SUMMARY_COLUMNS);

    const setBool = jest.fn();
    createBooleanSetterHandler(setBool, true)();
    expect(setBool).toHaveBeenCalledWith(true);

    // Column display class
    const cols = [
      { key: 'name', label: 'Name', visible: true },
      { key: 'email', label: 'Email', visible: false },
    ];
    expect(getTableColumnClass(null, 'name', 'px-2')).toBe('px-2');
    expect(getTableColumnClass(cols, 'name', 'px-2')).toBe('px-2');
    expect(getTableColumnClass(cols, 'email', 'px-2')).toBe('px-2 hidden');
    expect(getTableColumnClass(cols, 'email')).toBe('hidden');
    expect(getTableColumnClass(cols, 'unknown', 'px-2')).toBe('px-2');

    // Aria sort & indicator symbol
    expect(getTableAriaSort(null, 'name')).toBe('none');
    expect(getTableAriaSort({ key: 'other', dir: 'asc' }, 'name')).toBe('none');
    expect(getTableAriaSort({ key: 'name', dir: 'asc' }, 'name')).toBe('ascending');
    expect(getTableAriaSort({ key: 'name', dir: 'desc' }, 'name')).toBe('descending');
    expect(getSortIndicatorSymbol(null, 'name')).toBe('↕');
    expect(getSortIndicatorSymbol({ key: 'name', dir: 'asc' }, 'name')).toBe('↑');
    expect(getSortIndicatorSymbol({ key: 'name', dir: 'desc' }, 'name')).toBe('↓');

    // Cell value resolution
    expect(resolveSortableCellValue(null, 'name')).toBe('');
    expect(resolveSortableCellValue({ extractedEntities: [1, 2, 3] }, 'items')).toBe(3);
    expect(resolveSortableCellValue({ lineItems: [1, 2] }, 'items')).toBe(2);
    expect(resolveSortableCellValue({ items: 'fallback' }, 'items')).toBe('fallback');
    expect(resolveSortableCellValue({ quotesCount: 4 }, 'quotes')).toBe(4);
    expect(resolveSortableCellValue({ quotesCount: '7' }, 'quotes')).toBe(7);
    expect(resolveSortableCellValue({}, 'quotes')).toBe(0);
    expect(resolveSortableCellValue({ targetDeliveryDate: '2026-12-01' }, 'delivery')).toBe('2026-12-01');
    expect(resolveSortableCellValue({ deadline: '2026-11-30' }, 'delivery')).toBe('2026-11-30');
    expect(resolveSortableCellValue({}, 'delivery')).toBe('');
    expect(resolveSortableCellValue({ minorCategories: ['Valves', 'Pumps'] }, 'minorCategories')).toBe('Valves, Pumps');
    expect(resolveSortableCellValue({ minorCategories: null }, 'minorCategories')).toBe('');
    expect(resolveSortableCellValue({ city: 'Pune' }, 'location')).toBe('Pune');
    expect(resolveSortableCellValue({}, 'location')).toBe('');
    expect(resolveSortableCellValue({ totalSpend: '₹1,25,000' }, 'totalSpend')).toBe(125000);
    expect(resolveSortableCellValue({ totalSpend: 'abc' }, 'totalSpend')).toBe(0);
    expect(resolveSortableCellValue({ score: 88 }, 'score')).toBe(88);
    expect(resolveSortableCellValue({ vendorCode: '42' }, 'vendorCode')).toBe(42);
    expect(resolveSortableCellValue({ name: ' Apex ' }, 'name')).toBe('apex');
    expect(resolveSortableCellValue({ tags: ['a', 'b'] }, 'tags')).toBe(2);
    expect(resolveSortableCellValue({ flag: true }, 'flag')).toBe('');

    // Row sorting
    expect(sortTableRows(null as unknown as unknown[], { key: 'name', dir: 'asc' })).toEqual([]);
    const sampleRows = [
      { name: 'Beta', score: 90 },
      { name: 'Alpha', score: 75 },
    ];
    expect(sortTableRows(sampleRows, { key: null, dir: 'asc' })).toEqual(sampleRows);
    expect(sortTableRows(sampleRows, { key: 'name', dir: 'asc' }).map((r: { name: string }) => r.name)).toEqual(['Alpha', 'Beta']);
    expect(sortTableRows(sampleRows, { key: 'name', dir: 'desc' }).map((r: { name: string }) => r.name)).toEqual(['Beta', 'Alpha']);
    expect(sortTableRows(sampleRows, { key: 'score', dir: 'asc' }).map((r: { score: number }) => r.score)).toEqual([75, 90]);
    expect(sortTableRows(sampleRows, { key: 'score', dir: 'desc' }).map((r: { score: number }) => r.score)).toEqual([90, 75]);
  });
});
