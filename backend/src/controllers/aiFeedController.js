const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { validatePayload } = require('../config/validationSchemas');

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

async function createFeedItem(req, res, next) {
  try {
    const user = req.user;
    if (!user || !['buyer', 'admin', 'category_manager'].includes(user.role)) {
      return res.status(user ? 403 : 401).json({ success: false, error: 'An authorized session is required to create a feed item.' });
    }

    const { isValid, errors, sanitizedData } = validatePayload('createAIFeedItem', req.body || {});
    if (!isValid) {
      logger.warn('Rejected invalid AI feed item', { fields: Object.keys(errors), role: user.role }, 'AI_FEED_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const { title, message, type, channel, recipient, rfqNumber, channelDetails } = sanitizedData;
    let rfq = rfqNumber ? storeService.getRFQById(rfqNumber) : null;
    if (rfqNumber && !rfq) {
      return res.status(404).json({ success: false, error: 'The referenced RFQ was not found.' });
    }

    let buyerAccountId = null;
    if (user.role === 'buyer') {
      const account = await storeService.getBuyerAccountByEmail(user.email);
      buyerAccountId = (account && account.id) || user.orgId || user.sub || null;
      if (!buyerAccountId) {
        return res.status(403).json({ success: false, error: 'A verified buyer account is required to create feed activity.' });
      }
      if (rfq && rfq.buyerAccountId !== buyerAccountId) {
        logger.warn('Buyer attempted to attach feed activity to an RFQ outside their account', {
          buyerAccountId,
          rfqNumber,
        }, 'AI_FEED_CONTROLLER');
        return res.status(404).json({ success: false, error: 'The referenced RFQ was not found.' });
      }
      if (sanitizedData.buyerAccountId && sanitizedData.buyerAccountId !== buyerAccountId) {
        logger.warn('Ignored client supplied buyer account on AI feed item', {
          buyerAccountId,
          requestedBuyerAccountId: sanitizedData.buyerAccountId,
        }, 'AI_FEED_CONTROLLER');
      }
    } else {
      buyerAccountId = sanitizedData.buyerAccountId || (rfq && rfq.buyerAccountId) || null;
      if (rfq && buyerAccountId && rfq.buyerAccountId !== buyerAccountId) {
        return res.status(400).json({ success: false, error: 'The feed item account must match the referenced RFQ account.' });
      }
    }

    logger.info('Creating AI feed alert', { title, type, channel, buyerAccountId, rfqNumber }, 'AI_FEED_CONTROLLER');
    const created = await storeService.addAIFeedItemDurably({
      title,
      message,
      type,
      channel,
      recipient,
      rfqNumber,
      channelDetails,
      buyerAccountId,
    });
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
