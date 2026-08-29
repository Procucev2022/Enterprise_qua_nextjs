const storeService = require('../services/storeService');

function getAIFeed(req, res, next) {
  try {
    const feed = storeService.getAIFeed();
    res.json({ success: true, data: feed });
  } catch (err) {
    next(err);
  }
}

function createFeedItem(req, res, next) {
  try {
    const body = req.body;
    if (!body.title || !body.message) {
      return res.status(400).json({ success: false, error: 'title and message are required.' });
    }
    const created = storeService.addAIFeedItem(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAIFeed,
  createFeedItem,
};
