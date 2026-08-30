const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

function getAIFeed(req, res, next) {
  try {
    logger.info('Fetching AI opportunity feed alerts', { query: req.query }, 'AI_FEED_CONTROLLER');
    const feed = storeService.getAIFeed();
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
    logger.info(`Creating AI feed alert: ${body.title}`, { title: body.title, priority: body.priority }, 'AI_FEED_CONTROLLER');
    const created = storeService.addAIFeedItem(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating AI feed item', err, 'AI_FEED_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getAIFeed,
  createFeedItem,
};
