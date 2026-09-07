const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

/**
 * Which AI feed / follow-up alerts a caller may see.
 *
 * Follows the same isolation pattern as rfqController's resolveRfqReadScope:
 * Buyers are scoped to their own buyerAccountId (resolved from the session or
 * explicitly requested via query parameter ?buyerAccountId=... / ?buyerId=...).
 * Cross-buyer follow-up events or telemetry are never leaked across accounts.
 */
function resolveAiFeedReadScope(req) {
  // 1. Explicit query parameter
  const queryBuyerId = req.query && (req.query.buyerAccountId || req.query.buyerId);
  if (queryBuyerId) {
    return { restricted: true, buyerAccountId: queryBuyerId };
  }

  // 2. Authenticated buyer session
  if (req.user && req.user.role === 'buyer') {
    const account = storeService.getBuyerAccountByEmail(req.user.email);
    const buyerAccountId = (account && account.id) || req.user.orgId || req.user.sub || null;
    return { restricted: true, buyerAccountId };
  }

  return { restricted: false, buyerAccountId: null };
}

function getAIFeed(req, res, next) {
  try {
    const scope = resolveAiFeedReadScope(req);
    logger.info('Fetching AI opportunity feed alerts', { restricted: scope.restricted, buyerAccountId: scope.buyerAccountId }, 'AI_FEED_CONTROLLER');
    const all = storeService.getAIFeed();
    let feed = all;

    if (scope.restricted) {
      if (scope.buyerAccountId) {
        const buyerRfqs = storeService.getRFQs().filter((r) => r.buyerAccountId === scope.buyerAccountId);
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
      } else {
        feed = [];
      }
    }

    res.json({ success: true, data: feed });
  } catch (err) {
    logger.error('Error fetching AI feed', err, 'AI_FEED_CONTROLLER');
    next(err);
  }
}

function createFeedItem(req, res, next) {
  try {
    const body = req.body;
    if (!body.title || !body.message) {
      logger.warn('Failed to create feed item: Missing title or message', { body }, 'AI_FEED_CONTROLLER');
      return res.status(400).json({ success: false, error: 'title and message are required.' });
    }

    let buyerAccountId = body.buyerAccountId || null;
    if (!buyerAccountId && req.user && req.user.role === 'buyer') {
      const account = storeService.getBuyerAccountByEmail(req.user.email);
      if (account) {
        buyerAccountId = account.id;
      }
    } else if (!buyerAccountId && body.rfqNumber) {
      const rfq = storeService.getRFQById(body.rfqNumber);
      if (rfq && rfq.buyerAccountId) {
        buyerAccountId = rfq.buyerAccountId;
      }
    }

    logger.info(`Creating AI feed alert: ${body.title}`, { title: body.title, priority: body.priority, buyerAccountId }, 'AI_FEED_CONTROLLER');
    const created = storeService.addAIFeedItem({ ...body, buyerAccountId });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating AI feed item', err, 'AI_FEED_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getAIFeed,
  createFeedItem,
  resolveAiFeedReadScope,
};
