// ==============================================================================
// BUYER SCOPE RESOLUTION
// ==============================================================================
// Turns a verified session into the ownership triple every RFQ read and write is
// filtered by. One module so the mapping is stated once.
//
// Two traps this exists to close:
//
//   The claim is `sub`, not `id`. generateSessionToken maps user.id -> sub, so a
//   handler reading req.user.id silently gets undefined. An undefined owner would
//   have written RFQs nobody could ever read back, or worse, matched other rows
//   with an undefined owner.
//
//   The owner is the organisation, not the user. Procurement is a team function:
//   anyone at the buyer company needs to see the company's RFQs, and someone
//   leaving must not orphan them. The individual is still recorded as the
//   creator for audit, but scoping is organisational.
// ==============================================================================

const { BUYER_SCOPE_REASONS, BUYER_SCOPE_MESSAGES } = require('../config/constants');

/**
 * Resolve the buyer ownership triple from a request's verified session claims.
 *
 * Never reads the request body. A client that could name its own owner could
 * read or write another organisation's RFQs, which is the whole attack this
 * guards against.
 *
 * @param {object} req an Express request that has passed `authenticate`
 * @returns {{ok: true, scope: {orgId: string, userId: string, email: string}}
 *          |{ok: false, reason: string, message: string}}
 */
function resolveBuyerScope(req) {
  const claims = (req && req.user) || null;

  if (!claims || !claims.sub) {
    return {
      ok: false,
      reason: BUYER_SCOPE_REASONS.NO_SESSION,
      message: BUYER_SCOPE_MESSAGES[BUYER_SCOPE_REASONS.NO_SESSION],
    };
  }

  if (!claims.orgId) {
    return {
      ok: false,
      reason: BUYER_SCOPE_REASONS.NO_ORGANISATION,
      message: BUYER_SCOPE_MESSAGES[BUYER_SCOPE_REASONS.NO_ORGANISATION],
    };
  }

  return {
    ok: true,
    scope: {
      orgId: String(claims.orgId),
      userId: String(claims.sub),
      email: claims.email ? String(claims.email) : '',
    },
  };
}

/**
 * Resolve the scope or answer the request, so handlers do not each repeat the
 * status-code choice.
 *
 * 401 for a missing session (sign in again) versus 403 for a session that is
 * valid but has no organisation (signing in again will not help; an
 * administrator has to link the account).
 *
 * @returns {object|null} the scope, or null when a response has been sent
 */
function requireBuyerScope(req, res) {
  const resolved = resolveBuyerScope(req);
  if (resolved.ok) return resolved.scope;

  const status = resolved.reason === BUYER_SCOPE_REASONS.NO_SESSION ? 401 : 403;
  res.status(status).json({
    success: false,
    reason: resolved.reason,
    error: resolved.message,
  });
  return null;
}

module.exports = {
  resolveBuyerScope,
  requireBuyerScope,
};
