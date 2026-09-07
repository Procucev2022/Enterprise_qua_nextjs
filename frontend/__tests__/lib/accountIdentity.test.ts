import { deriveInitials, resolveSessionOrgName } from '@/lib/accountIdentity';
import type { BuyerAccount, UserSession } from '@/lib/types';

// ==============================================================================
// SIGNED-IN ACCOUNT IDENTITY
// ==============================================================================
// These two helpers decide what name and organisation are shown against the
// signed-in user. resolveSessionOrgName in particular is a safety check: it must
// refuse to borrow an organisation name from a buyer account that belongs to
// somebody else, so the mismatch cases below matter as much as the happy path.
// ==============================================================================

const session = (overrides: Partial<UserSession> = {}): UserSession =>
  ({
    id: 'u1',
    email: 'buyer@procucev.com',
    name: 'Navin Chaudhary',
    role: 'buyer',
    orgId: 'org-1',
    orgName: 'Navin Chaudhary Enterprises',
    ...overrides,
  }) as UserSession;

const account = (overrides: Partial<BuyerAccount> = {}): BuyerAccount =>
  ({
    id: 'buyer-acc-1',
    organizationName: 'Tata Motors Commercial Vehicles Ltd.',
    corporateEmail: 'buyer@procucev.com',
    ...overrides,
  }) as BuyerAccount;

describe('deriveInitials', () => {
  it('takes the first and last initial of a multi-word name', () => {
    expect(deriveInitials('Navin Chaudhary', 'ignored@procucev.com')).toBe('NC');
  });

  it('takes the first two characters of a single-word name', () => {
    expect(deriveInitials('Navin')).toBe('NA');
  });

  it('splits on dots, underscores and hyphens as well as spaces', () => {
    expect(deriveInitials('navin.chaudhary')).toBe('NC');
    expect(deriveInitials('navin_chaudhary')).toBe('NC');
    expect(deriveInitials('navin-chaudhary')).toBe('NC');
  });

  it('falls back to the local part of the email when there is no name', () => {
    expect(deriveInitials('', 'navin.chaudhary@procucev.com')).toBe('NC');
  });

  it('treats a whitespace-only name as absent', () => {
    expect(deriveInitials('   ', 'navin@procucev.com')).toBe('NA');
  });

  // Rendering an empty avatar would collapse the chip, so a placeholder is used.
  it('returns a placeholder when neither a name nor an email is available', () => {
    expect(deriveInitials()).toBe('--');
    expect(deriveInitials('', '')).toBe('--');
    expect(deriveInitials('', '@procucev.com')).toBe('--');
  });
});

describe('resolveSessionOrgName', () => {
  it('prefers the organisation recorded on the verified session', () => {
    expect(resolveSessionOrgName(session(), account())).toBe('Navin Chaudhary Enterprises');
  });

  it('falls back to the active buyer account when its corporate email matches', () => {
    expect(resolveSessionOrgName(session({ orgName: '' }), account())).toBe(
      'Tata Motors Commercial Vehicles Ltd.'
    );
  });

  it('matches the corporate email case-insensitively', () => {
    expect(
      resolveSessionOrgName(
        session({ orgName: '', email: 'BUYER@Procucev.com' }),
        account({ corporateEmail: 'buyer@procucev.com' })
      )
    ).toBe('Tata Motors Commercial Vehicles Ltd.');
  });

  // The important one: a buyer account selected from the directory belongs to a
  // different company and must never be presented as the user's own.
  it('ignores a buyer account whose corporate email belongs to someone else', () => {
    expect(
      resolveSessionOrgName(
        session({ orgName: '' }),
        account({ corporateEmail: 'someone.else@othercorp.com' })
      )
    ).toBe('');
  });

  it('ignores a buyer account when the session records no email to match against', () => {
    expect(resolveSessionOrgName(session({ orgName: '', email: '' }), account())).toBe('');
  });

  it('ignores a buyer account that carries no corporate email', () => {
    expect(
      resolveSessionOrgName(session({ orgName: '' }), account({ corporateEmail: '' }))
    ).toBe('');
  });

  it('returns an empty string when a matched account has no organisation name', () => {
    expect(
      resolveSessionOrgName(session({ orgName: '' }), account({ organizationName: '' }))
    ).toBe('');
  });

  it('returns an empty string when there is no session at all', () => {
    expect(resolveSessionOrgName(null, null)).toBe('');
    expect(resolveSessionOrgName(undefined, undefined)).toBe('');
    expect(resolveSessionOrgName(null, account())).toBe('');
  });
});
