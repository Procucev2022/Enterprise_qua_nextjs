import {
  expandCategorySelection,
  fetchBuyerProfile,
  fetchCategoryTaxonomy,
  flattenCategorySelection,
  saveBuyerProfile,
} from '@/lib/buyerProfileClient';
import buyerProfileClient from '@/lib/buyerProfileClient';
import { authClient } from '@/lib/authClient';
import { BUYER_PROFILE_ENDPOINTS } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { BuyerProfile } from '@/lib/types';

const PROFILE: BuyerProfile = {
  organizationId: 'org-1',
  userId: 'user-1',
  companyName: 'Larsen & Toubro Limited',
  brandName: 'L&T Heavy Engineering',
  organizationType: 'Public Limited',
  panNumber: 'AAACL1234F',
  gstNumber: '27AAACL1234F1Z5',
  cinNumber: 'L28920MH1946PLC004768',
  website: 'https://www.larsentoubro.com',
  annualTurnover: 'INR 1,80,000 Cr+',
  street: 'L&T House',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  contactName: 'Rajesh Sharma',
  contactDesignation: 'Chief Procurement Officer (CPO)',
  contactEmail: 'buyer@procucev.com',
  contactPhone: '+919820144820',
  categories: [{ major: 'IT', minor: 'Laptop' }],
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe('buyerProfileClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  // ── Read ──────────────────────────────────────────────────────────────────
  describe('fetchBuyerProfile', () => {
    test('reads the profile from the buyer profile endpoint', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: PROFILE }));

      const res = await fetchBuyerProfile();

      expect(res.success).toBe(true);
      expect(res.data).toEqual(PROFILE);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(BUYER_PROFILE_ENDPOINTS.ME);
    });

    test('attaches the session token when one is held', async () => {
      authClient.setSession(
        { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
        'jwt-token'
      );
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: PROFILE }));

      await fetchBuyerProfile();

      const init = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(init.headers.Authorization).toBe('Bearer jwt-token');
    });

    test('omits the Authorization header when no token is held', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: PROFILE }));
      await fetchBuyerProfile();
      const init = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(init.headers.Authorization).toBeUndefined();
    });

    // Fail closed: an unreachable API must never look like an empty profile,
    // because the buyer would then "fix" it by re-keying data that already exists.
    test('reports an unreachable API without fabricating a profile', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchBuyerProfile();

      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error).toBe(UI_STRINGS.buyerProfile.loadUnreachable);
    });

    test('wraps a server-side reason in the load-failure template', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ success: false, error: 'Not linked to an organization.' }, { ok: false, status: 409 }));

      const res = await fetchBuyerProfile();

      expect(res.success).toBe(false);
      expect(res.status).toBe(409);
      expect(res.error).toBe(
        formatString(UI_STRINGS.buyerProfile.loadRejected, { reason: 'Not linked to an organization.' })
      );
    });

    test('surfaces a 401 as a sign-in instruction, unwrapped', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }));
      const res = await fetchBuyerProfile();
      expect(res.error).toBe(UI_STRINGS.buyerProfile.sessionExpired);
    });

    test('surfaces a 403 as a permissions instruction, unwrapped', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 403 }));
      const res = await fetchBuyerProfile();
      expect(res.error).toBe(UI_STRINGS.buyerProfile.notPermitted);
    });

    test('handles a response body that is not JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      });

      const res = await fetchBuyerProfile();
      expect(res.success).toBe(false);
      expect(res.error).toContain(UI_STRINGS.buyerProfile.serverErrorFallback);
    });

    test('treats a 200 with no data as a failure', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true }));
      const res = await fetchBuyerProfile();
      expect(res.success).toBe(false);
    });
  });

  // ── Write ─────────────────────────────────────────────────────────────────
  describe('saveBuyerProfile', () => {
    test('PUTs the payload and returns the stored record', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({ success: true, data: PROFILE, message: 'Saved.', categoryCount: 1 })
      );

      const res = await saveBuyerProfile({ companyName: 'ACME Ltd' });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(PROFILE);
      expect(res.message).toBe('Saved.');
      expect(res.categoryCount).toBe(1);

      const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(path).toBe(BUYER_PROFILE_ENDPOINTS.ME);
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ companyName: 'ACME Ltd' });
    });

    // The buyer's edits are still on screen, so the message has to say the save
    // did not happen rather than implying the data was lost.
    test('reports an unreachable API as a save that did not happen', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await saveBuyerProfile({ companyName: 'ACME Ltd' });

      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.buyerProfile.saveUnreachable);
    });

    test('passes per-field validation messages through', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(
          { success: false, error: 'PAN is invalid.', fieldErrors: { panNumber: 'PAN is invalid.' } },
          { ok: false, status: 400 }
        )
      );

      const res = await saveBuyerProfile({ companyName: 'ACME Ltd', panNumber: 'NOPE' });

      expect(res.success).toBe(false);
      expect(res.fieldErrors).toEqual({ panNumber: 'PAN is invalid.' });
      expect(res.error).toBe(formatString(UI_STRINGS.buyerProfile.saveRejected, { reason: 'PAN is invalid.' }));
    });

    test('surfaces a 401 as a sign-in instruction, unwrapped', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }));
      const res = await saveBuyerProfile({ companyName: 'ACME Ltd' });
      expect(res.error).toBe(UI_STRINGS.buyerProfile.sessionExpired);
    });

    test('surfaces a 403 as a permissions instruction, unwrapped', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 403 }));
      const res = await saveBuyerProfile({ companyName: 'ACME Ltd' });
      expect(res.error).toBe(UI_STRINGS.buyerProfile.notPermitted);
    });

    test('succeeds even when the server returns no record to re-apply', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true }));
      const res = await saveBuyerProfile({ companyName: 'ACME Ltd' });
      expect(res.success).toBe(true);
      expect(res.data).toBeUndefined();
      expect(res.categoryCount).toBeNull();
    });

    test('handles a response body that is not JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      });
      const res = await saveBuyerProfile({ companyName: 'ACME Ltd' });
      expect(res.success).toBe(false);
      expect(res.error).toContain(UI_STRINGS.buyerProfile.serverErrorFallback);
    });
  });

  // ── Taxonomy ──────────────────────────────────────────────────────────────
  describe('fetchCategoryTaxonomy', () => {
    const taxonomy = [
      { majorCategory: 'Civil Works', minorCategories: ['Piling'] },
      { majorCategory: 'IT', minorCategories: ['Laptop'] },
    ];

    test('returns the taxonomy in the order the database supplied', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: taxonomy }));

      const res = await fetchCategoryTaxonomy();

      expect(res.success).toBe(true);
      expect(res.data).toEqual(taxonomy);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(BUYER_PROFILE_ENDPOINTS.CATEGORIES);
    });

    // A checkbox the buyer can tick has to be a category the master actually
    // contains, because the selection drives RFQ vendor matching. So there is no
    // offline fallback list.
    test('returns an empty list rather than an offline taxonomy when unreachable', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchCategoryTaxonomy();

      expect(res.success).toBe(false);
      expect(res.data).toEqual([]);
      expect(res.error).toBe(UI_STRINGS.buyerProfile.loadUnreachable);
    });

    test('returns an empty list when the server rejects the request', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ success: false, error: 'Master unavailable.' }, { ok: false, status: 503 }));

      const res = await fetchCategoryTaxonomy();

      expect(res.data).toEqual([]);
      expect(res.error).toBe(
        formatString(UI_STRINGS.buyerProfile.loadRejected, { reason: 'Master unavailable.' })
      );
    });

    test('surfaces a 401 unwrapped', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }));
      const res = await fetchCategoryTaxonomy();
      expect(res.error).toBe(UI_STRINGS.buyerProfile.sessionExpired);
    });

    test('surfaces a 403 unwrapped', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 403 }));
      const res = await fetchCategoryTaxonomy();
      expect(res.error).toBe(UI_STRINGS.buyerProfile.notPermitted);
    });

    test('rejects a payload whose data is not an array', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: { IT: ['Laptop'] } }));
      const res = await fetchCategoryTaxonomy();
      expect(res.success).toBe(false);
      expect(res.data).toEqual([]);
    });
  });

  // ── Selection shape conversion ────────────────────────────────────────────
  describe('flattenCategorySelection', () => {
    test('produces one pair per selected minor', () => {
      expect(
        flattenCategorySelection(['IT', 'Civil Works'], {
          IT: ['Laptop', 'Servers'],
          'Civil Works': ['Piling'],
        })
      ).toEqual([
        { major: 'IT', minor: 'Laptop' },
        { major: 'IT', minor: 'Servers' },
        { major: 'Civil Works', minor: 'Piling' },
      ]);
    });

    // De-selecting a major leaves its minors in the map so the choice can be
    // restored with one click; those must not reach the database.
    test('ignores minors whose major is no longer selected', () => {
      expect(
        flattenCategorySelection(['IT'], { IT: ['Laptop'], 'Civil Works': ['Piling'] })
      ).toEqual([{ major: 'IT', minor: 'Laptop' }]);
    });

    test('tolerates a selected major with no minors recorded', () => {
      expect(flattenCategorySelection(['IT'], {})).toEqual([]);
    });

    test('returns an empty list for an empty selection', () => {
      expect(flattenCategorySelection([], {})).toEqual([]);
    });
  });

  describe('expandCategorySelection', () => {
    test('groups stored pairs back into the screen shape', () => {
      expect(
        expandCategorySelection([
          { major: 'IT', minor: 'Laptop' },
          { major: 'IT', minor: 'Servers' },
          { major: 'Civil Works', minor: 'Piling' },
        ])
      ).toEqual({
        selectedMajor: ['IT', 'Civil Works'],
        selectedMinor: { IT: ['Laptop', 'Servers'], 'Civil Works': ['Piling'] },
      });
    });

    test('collapses a duplicated stored pair', () => {
      expect(
        expandCategorySelection([
          { major: 'IT', minor: 'Laptop' },
          { major: 'IT', minor: 'Laptop' },
        ])
      ).toEqual({ selectedMajor: ['IT'], selectedMinor: { IT: ['Laptop'] } });
    });

    // Rows with a blank division exist in org_division_category from earlier
    // imports and have no accordion row to appear under.
    test('skips rows missing a major or a minor', () => {
      expect(
        expandCategorySelection([
          { major: '', minor: 'Other' },
          { major: 'IT', minor: '' },
          { major: 'IT', minor: 'Laptop' },
        ])
      ).toEqual({ selectedMajor: ['IT'], selectedMinor: { IT: ['Laptop'] } });
    });

    test('handles a missing category list', () => {
      expect(expandCategorySelection(undefined)).toEqual({ selectedMajor: [], selectedMinor: {} });
      expect(expandCategorySelection([])).toEqual({ selectedMajor: [], selectedMinor: {} });
    });

    test('round-trips a selection through flatten and expand', () => {
      const selectedMajor = ['IT', 'Civil Works'];
      const selectedMinor = { IT: ['Laptop'], 'Civil Works': ['Piling', 'Roofing'] };
      expect(expandCategorySelection(flattenCategorySelection(selectedMajor, selectedMinor))).toEqual({
        selectedMajor,
        selectedMinor,
      });
    });
  });

  test('the default export exposes the whole client surface', () => {
    expect(Object.keys(buyerProfileClient).sort()).toEqual([
      'expandCategorySelection',
      'fetchBuyerProfile',
      'fetchCategoryTaxonomy',
      'flattenCategorySelection',
      'saveBuyerProfile',
    ]);
  });
});
