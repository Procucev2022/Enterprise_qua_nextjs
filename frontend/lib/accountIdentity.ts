// ==============================================================================
// SIGNED-IN ACCOUNT IDENTITY RESOLUTION
// ==============================================================================
// Pure helpers that turn a verified session record into the strings shown against
// the signed-in user. Extracted from the header so the header chrome and the
// Account & Security panel resolve identity the same way instead of each keeping
// its own copy — the organisation rule below is a safety check, and two
// implementations of it could drift apart.
// ==============================================================================

import type { BuyerAccount, UserSession } from '@/lib/types';

/**
 * Initials for the avatar chip, derived from the real account name and falling
 * back to the local part of the email when no display name was recorded.
 *
 * Returns `--` rather than an empty string so the avatar never collapses.
 */
export function deriveInitials(name?: string, email?: string): string {
  const source = (name || '').trim() || (email || '').split('@')[0] || '';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '--';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Organisation name to display for the signed-in user.
 *
 * The organisation recorded on the verified session is authoritative. The
 * currently active buyer account is only consulted as a fallback, and only when
 * its corporate email matches the session email — otherwise an unrelated account
 * selected from the buyer directory could be rendered as though it were the
 * signed-in user's own company.
 *
 * Returns an empty string when neither source can name an organisation, so the
 * caller renders nothing rather than a placeholder that looks like real data.
 */
export function resolveSessionOrgName(
  session: UserSession | null | undefined,
  activeBuyerAccount: BuyerAccount | null | undefined
): string {
  const sessionEmail = (session?.email || '').toLowerCase();
  const accountEmail = (activeBuyerAccount?.corporateEmail || '').toLowerCase();

  const alignedAccountName =
    accountEmail && sessionEmail && accountEmail === sessionEmail
      ? activeBuyerAccount?.organizationName || ''
      : '';

  return session?.orgName || alignedAccountName || '';
}
