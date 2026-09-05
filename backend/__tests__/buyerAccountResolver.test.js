// ==============================================================================
// ACTIVE BUYER ACCOUNT RESOLUTION
// ==============================================================================
// This replaced SEED_BUYER_ACCOUNTS, where `activeBuyerAccount` was simply
// `buyerAccounts[0]` — so whoever signed in, the dashboard attributed their work
// to Tata Motors and showed $4,280,000 of spend that did not exist.
//
// The behaviour these tests protect is that every failure mode reports itself.
// Falling back to a fabricated account is precisely the bug being fixed, so a
// resolver that cannot answer must say so rather than inventing an organisation.
// ==============================================================================

const buyerAccountResolver = require('../src/services/buyerAccountResolver');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const dbPool = require('../src/db/pool');
const { BUYER_ACCOUNT_RESOLUTION } = require('../src/config/constants');

const { MESSAGES } = BUYER_ACCOUNT_RESOLUTION;

const SESSION = { sub: 'usr-buyer-001', email: 'buyer@procucev.com', orgId: 'org-buyer-01' };

function profile(overrides = {}) {
  return {
    organizationId: 'org-real-01',
    userId: 'usr-buyer-001',
    companyName: 'Real Buyer Pvt Ltd',
    contactEmail: 'buyer@procucev.com',
    contactName: 'A Buyer',
    contactPhone: '+919876543210',
    gstNumber: '27AAACT2727Q1ZW',
    panNumber: 'AAACT2727Q',
    city: 'Navi Mumbai',
    state: 'Maharashtra',
    categories: [],
    ...overrides,
  };
}

describe('mapProfileToBuyerAccount', () => {
  test('maps the organisation onto the account shape the dashboard reads', () => {
    const account = buyerAccountResolver.mapProfileToBuyerAccount(profile());

    expect(account.id).toBe('org-real-01');
    expect(account.organizationId).toBe('org-real-01');
    expect(account.userId).toBe('usr-buyer-001');
    expect(account.organizationName).toBe('Real Buyer Pvt Ltd');
    expect(account.corporateEmail).toBe('buyer@procucev.com');
    expect(account.gstin).toBe('27AAACT2727Q1ZW');
    expect(account.accountSource).toBe(BUYER_ACCOUNT_RESOLUTION.SOURCE_IDENTITY_DB);
    expect(account.status).toBe(BUYER_ACCOUNT_RESOLUTION.STATUS_ACTIVE);
  });

  // The seed carried '$4,280,000' as a hardcoded string. These are counted from
  // real rows or left at zero, never invented.
  test('reports spend and RFQ counts as zero rather than inventing them', () => {
    const account = buyerAccountResolver.mapProfileToBuyerAccount(profile());
    expect(account.totalSpend).toBe(0);
    expect(account.totalRFQsCreated).toBe(0);
  });

  test('accepts counted totals from the caller', () => {
    const account = buyerAccountResolver.mapProfileToBuyerAccount(profile(), {
      totalRFQsCreated: 4,
      totalSpend: 125000,
    });
    expect(account.totalRFQsCreated).toBe(4);
    expect(account.totalSpend).toBe(125000);
  });

  test('joins the plant location from city and state', () => {
    expect(buyerAccountResolver.mapProfileToBuyerAccount(profile()).primaryPlantLocation).toBe(
      'Navi Mumbai, Maharashtra'
    );
  });

  test.each([
    [{ city: '', state: 'Maharashtra' }, 'Maharashtra'],
    [{ city: 'Pune', state: '' }, 'Pune'],
    [{ city: '', state: '' }, ''],
  ])('tolerates a partial address %j', (address, expected) => {
    expect(buyerAccountResolver.mapProfileToBuyerAccount(profile(address)).primaryPlantLocation).toBe(
      expected
    );
  });

  // `profile.categories` is a flat list of { major, minor } pairs — one per
  // selected minor category — which is the shape org_division_category stores and
  // the shape loadCategories returns. This used to be asserted against the
  // taxonomy endpoint's grouped { majorCategory, minorCategories } shape, which
  // the resolver also read; both arrays therefore came out empty on every real
  // account and a buyer appeared to have no procurement scope at all.
  test('de-duplicates majors and minors from the flat pair list', () => {
    const account = buyerAccountResolver.mapProfileToBuyerAccount(
      profile({
        categories: [
          { major: 'Mechanical', minor: 'Pumps' },
          { major: 'Mechanical', minor: 'Valves' },
          { major: 'Mechanical', minor: 'Bearings' },
          // A repeated pair is collapsed rather than counted twice.
          { major: 'Mechanical', minor: 'Pumps' },
          { major: 'Electrical', minor: 'Panels' },
        ],
      })
    );

    expect(account.supportedMajorCategories).toEqual(['Mechanical', 'Electrical']);
    expect(account.supportedMinorCategories).toEqual(['Pumps', 'Valves', 'Bearings', 'Panels']);
  });

  test.each([[undefined], [null], [[]]])('tolerates categories of %p', (categories) => {
    const account = buyerAccountResolver.mapProfileToBuyerAccount(profile({ categories }));
    expect(account.supportedMajorCategories).toEqual([]);
    expect(account.supportedMinorCategories).toEqual([]);
  });

  test('skips a pair missing either half rather than emitting a blank entry', () => {
    const account = buyerAccountResolver.mapProfileToBuyerAccount(
      profile({ categories: [{ major: 'Mechanical' }, { minor: 'Pumps' }, {}] })
    );
    expect(account.supportedMajorCategories).toEqual(['Mechanical']);
    expect(account.supportedMinorCategories).toEqual(['Pumps']);
  });
});

describe('resolveActiveBuyerAccount', () => {
  const originalPool = dbPool.pool;

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('returns the caller\'s own organisation', async () => {
    dbPool.pool = { stub: true };
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ profile: profile() });

    const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(SESSION);

    expect(resolved.ok).toBe(true);
    expect(resolved.account.organizationName).toBe('Real Buyer Pvt Ltd');
  });

  // Looked up by the session's own user id, so one session cannot resolve
  // another organisation's account.
  test('looks the account up by the session user id', async () => {
    dbPool.pool = { stub: true };
    const spy = jest
      .spyOn(buyerProfileQueries, 'findProfileByUserId')
      .mockResolvedValue({ profile: profile() });

    await buyerAccountResolver.resolveActiveBuyerAccount(SESSION);

    expect(spy).toHaveBeenCalledWith('usr-buyer-001');
  });

  test.each([[undefined], [null], [{}], [{ email: 'a@b.com' }]])(
    'reports 401 for a session of %p',
    async (session) => {
      const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(session);
      expect(resolved.ok).toBe(false);
      expect(resolved.status).toBe(401);
      expect(resolved.error).toBe(MESSAGES.NO_SESSION);
    }
  );

  // Fails closed. Returning a fabricated account here is exactly what made the
  // dashboard show another company's data.
  test('reports 503 when the identity database is not configured', async () => {
    dbPool.pool = null;
    const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(SESSION);

    expect(resolved.ok).toBe(false);
    expect(resolved.status).toBe(503);
    expect(resolved.error).toBe(MESSAGES.IDENTITY_UNAVAILABLE);
    expect(resolved.account).toBeUndefined();
  });

  test('reports 503 when the lookup throws', async () => {
    dbPool.pool = { stub: true };
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValue(new Error('timeout'));

    const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(SESSION);

    expect(resolved.status).toBe(503);
    expect(resolved.error).toBe(MESSAGES.LOOKUP_FAILED);
  });

  test('reports 404 when no account matches the session', async () => {
    dbPool.pool = { stub: true };
    jest
      .spyOn(buyerProfileQueries, 'findProfileByUserId')
      .mockResolvedValue({ reason: 'USER_NOT_FOUND' });

    const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(SESSION);

    expect(resolved.status).toBe(404);
    expect(resolved.error).toBe(MESSAGES.USER_NOT_FOUND);
  });

  // A real state in the shared schema: a user row can exist with no organisation.
  test('reports 409 when the account has no linked organisation', async () => {
    dbPool.pool = { stub: true };
    jest
      .spyOn(buyerProfileQueries, 'findProfileByUserId')
      .mockResolvedValue({ reason: 'ORG_NOT_LINKED' });

    const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(SESSION);

    expect(resolved.status).toBe(409);
    expect(resolved.error).toBe(MESSAGES.ORG_NOT_LINKED);
  });

  test.each([[null], [{}], [{ profile: null }]])(
    'treats a lookup result of %p as not found',
    async (result) => {
      dbPool.pool = { stub: true };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue(result);

      const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(SESSION);
      expect(resolved.ok).toBe(false);
      expect(resolved.status).toBe(404);
    }
  );
});
