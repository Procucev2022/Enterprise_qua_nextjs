// ==============================================================================
// BUYER SCOPE RESOLUTION
// ==============================================================================
// This is the single place that decides which buyer organisation a request may
// read. Getting it wrong reintroduces the cross-buyer RFQ leak, so the traps are
// pinned explicitly: the claim is `sub` and not `id`, and the owner is the
// organisation rather than the individual user.
// ==============================================================================

const { resolveBuyerScope, requireBuyerScope } = require('../src/services/buyerScopeService');
const { BUYER_SCOPE_REASONS, BUYER_SCOPE_MESSAGES } = require('../src/config/constants');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const CLAIMS = {
  sub: 'usr-buyer-001',
  orgId: 'org-buyer-01',
  email: 'buyer@procucev.com',
  role: 'buyer',
  orgName: 'Test Buyer Org',
};

describe('resolveBuyerScope', () => {
  test('resolves the ownership triple from verified claims', () => {
    const resolved = resolveBuyerScope({ user: CLAIMS });

    expect(resolved.ok).toBe(true);
    expect(resolved.scope).toEqual({
      orgId: 'org-buyer-01',
      userId: 'usr-buyer-001',
      email: 'buyer@procucev.com',
    });
  });

  // generateSessionToken maps user.id -> sub. A handler reading req.user.id gets
  // undefined, which would have written RFQs nobody could read back.
  test('reads the user id from sub, not id', () => {
    const resolved = resolveBuyerScope({ user: { id: 'ignored', sub: 'usr-1', orgId: 'org-1' } });
    expect(resolved.scope.userId).toBe('usr-1');
  });

  test.each([
    [undefined],
    [null],
    [{}],
    [{ user: null }],
    [{ user: {} }],
    [{ user: { orgId: 'org-1' } }],
  ])('reports NO_SESSION for %p', (req) => {
    const resolved = resolveBuyerScope(req);
    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe(BUYER_SCOPE_REASONS.NO_SESSION);
    expect(resolved.message).toBe(BUYER_SCOPE_MESSAGES[BUYER_SCOPE_REASONS.NO_SESSION]);
  });

  // A real state in the shared schema: a user row can exist with no linked
  // organisation. There is no owner to scope by, and listing everything instead
  // would be the leak this scoping prevents.
  test('reports NO_ORGANISATION for a session with no orgId', () => {
    const resolved = resolveBuyerScope({ user: { sub: 'usr-1', email: 'a@b.com' } });

    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe(BUYER_SCOPE_REASONS.NO_ORGANISATION);
    // The message has to say an administrator must act; signing in again cannot fix it.
    expect(resolved.message).toMatch(/administrator/i);
  });

  test('tolerates a session with no email', () => {
    const resolved = resolveBuyerScope({ user: { sub: 'usr-1', orgId: 'org-1' } });
    expect(resolved.scope.email).toBe('');
  });

  test('coerces non-string claims to strings', () => {
    const resolved = resolveBuyerScope({ user: { sub: 77, orgId: 88, email: 99 } });
    expect(resolved.scope).toEqual({ orgId: '88', userId: '77', email: '99' });
  });

  // The body is never consulted. A client that could name its own owner could
  // read or write another organisation's RFQs.
  test('ignores an owner supplied in the request body', () => {
    const resolved = resolveBuyerScope({
      user: CLAIMS,
      body: { buyerOrgId: 'org-someone-else', buyerUserId: 'usr-someone-else' },
    });
    expect(resolved.scope.orgId).toBe('org-buyer-01');
    expect(resolved.scope.userId).toBe('usr-buyer-001');
  });
});

describe('requireBuyerScope', () => {
  test('returns the scope and answers nothing when resolution succeeds', () => {
    const res = mockRes();
    const scope = requireBuyerScope({ user: CLAIMS }, res);

    expect(scope.orgId).toBe('org-buyer-01');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  // 401 says "sign in again"; 403 says "signing in again will not help".
  test('answers 401 for a missing session', () => {
    const res = mockRes();
    expect(requireBuyerScope({}, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, reason: BUYER_SCOPE_REASONS.NO_SESSION })
    );
  });

  test('answers 403 for a session with no organisation', () => {
    const res = mockRes();
    expect(requireBuyerScope({ user: { sub: 'usr-1' } }, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reason: BUYER_SCOPE_REASONS.NO_ORGANISATION })
    );
  });
});
