const { buyerScopeIdsFor } = require('../src/services/buyerVendorScope');

describe('buyerScopeIdsFor', () => {
  test('returns no identifiers when there is no signed-in user and no buyer account', () => {
    expect(buyerScopeIdsFor(null)).toEqual([]);
    expect(buyerScopeIdsFor(undefined, null)).toEqual([]);
  });

  test('lists the buyer account identifiers first, then the sign-in identifiers, in roster order', () => {
    const ids = buyerScopeIdsFor(
      { sub: 'sub-1', id: 'user-1', email: 'buyer@acme.test', orgId: 'org-user-9' },
      { id: 'buyer-acc-1', corporateEmail: 'procurement@acme.test', organizationId: 'org-acc-9' }
    );

    expect(ids).toEqual([
      'buyer-acc-1',
      'procurement@acme.test',
      'org-acc-9',
      'sub-1',
      'user-1',
      'buyer@acme.test',
      'org-user-9',
    ]);
  });

  test('skips every identifier that is missing or blank', () => {
    expect(buyerScopeIdsFor({ email: 'buyer@acme.test' }, { id: '', organizationId: null })).toEqual(['buyer@acme.test']);
  });
});
