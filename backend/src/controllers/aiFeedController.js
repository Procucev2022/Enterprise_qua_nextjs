const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

/**
 * Which AI feed / follow-up alerts a caller may see.
 *
 * Follows the same isolation pattern as rfqController's resolveRfqReadScope:
 * Buyers are scoped to their own buyerAccountId, even if a query parameter
 * requests a different account. Management roles may request one account.
 * Missing or unsupported principals receive an empty scope as defense in depth.
 */
async function resolveAiFeedReadScope(req) {
  // A buyer's identity comes from the signed session, never from query input.
  if (req.user && req.user.role === 'buyer') {
    const account = await storeService.getBuyerAccountByEmail(req.user.email);
    const buyerAccountId = (account && account.id) || req.user.orgId || req.user.sub || null;
    return { restricted: true, buyerAccountId };
  }

  // Management roles may narrow their broader access to one buyer account.
  if (req.user && ['admin', 'category_manager'].includes(req.user.role)) {
    const queryBuyerId = req.query && (req.query.buyerAccountId || req.query.buyerId);
    if (queryBuyerId) {
      return { restricted: true, buyerAccountId: queryBuyerId };
    }
    return { restricted: false, buyerAccountId: null };
  }

  return { restricted: true, buyerAccountId: null };
}

async function getAIFeed(req, res, next) {
  try {
    const scope = await resolveAiFeedReadScope(req);
    logger.info('Fetching AI opportunity feed alerts', { restricted: scope.restricted, buyerAccountId: scope.buyerAccountId }, 'AI_FEED_CONTROLLER');
    if (scope.restricted && !scope.buyerAccountId) {
      return res.json({ success: true, data: [] });
    }

    const parsedLimit = req.query && req.query.limit ? Number(req.query.limit) : null;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 50;
    const all = await storeService.getAIFeedDurably(100);
    let feed = all;

    if (scope.restricted) {
      if (scope.buyerAccountId) {
        const buyerRfqs = storeService.getRFQs(scope.buyerAccountId).filter((r) => r.buyerAccountId === scope.buyerAccountId);
        const buyerRfqNumbers = new Set(buyerRfqs.map((r) => r.rfqNumber).filter(Boolean));

        feed = all.filter((item) => {
          if (item.buyerAccountId) {
            return item.buyerAccountId === scope.buyerAccountId;
          }
          if (item.rfqNumber) {
            return buyerRfqNumbers.has(item.rfqNumber);
          }
          return false;
        });
      }
    }

    if (limit) {
      feed = feed.slice(0, limit);
    }

    res.json({ success: true, data: feed });
  } catch (err) {
    logger.error('Error fetching AI feed', err, 'AI_FEED_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getAIFeed,
  resolveAiFeedReadScope,
};
