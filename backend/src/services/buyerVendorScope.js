/**
 * The identifiers a signed-in buyer's vendors can be owned by. The buyer roster, the supplier lookups and the
 * evaluation request all read this one list, so a supplier the buyer can see is also one the buyer can act on.
 *
 * @param {object|null} user The signed-in user from the auth middleware.
 * @param {object|null} resolvedBuyerAccount The buyer account the roster is built from, when one exists.
 * @returns {string[]} Identifiers in the order the buyer roster has always used them.
 */
function buyerScopeIdsFor(user, resolvedBuyerAccount = null) {
  const ids = [];
  if (resolvedBuyerAccount) {
    if (resolvedBuyerAccount.id) ids.push(resolvedBuyerAccount.id);
    if (resolvedBuyerAccount.corporateEmail) ids.push(resolvedBuyerAccount.corporateEmail);
    if (resolvedBuyerAccount.organizationId) ids.push(resolvedBuyerAccount.organizationId);
  }
  if (user?.sub) ids.push(user.sub);
  if (user?.id) ids.push(user.id);
  if (user?.email) ids.push(user.email);
  if (user?.orgId) ids.push(user.orgId);
  return ids;
}

module.exports = { buyerScopeIdsFor };
