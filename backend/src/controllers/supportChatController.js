const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

function sendMessage(req, res, next) {
  try {
    const { prompt, userRole } = req.body;
    if (!prompt) {
      logger.warn('Failed support chat message: Missing prompt', { body: req.body }, 'SUPPORT_CHAT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'prompt is required.' });
    }
    logger.info(`Handling support chat query from ${userRole || 'buyer'}`, { prompt, userRole }, 'SUPPORT_CHAT_CONTROLLER');
    const response = storeService.handleSupportChat(prompt, userRole);
    res.json({ success: true, ...response });
  } catch (err) {
    logger.error('Error handling support chat message', err, 'SUPPORT_CHAT_CONTROLLER');
    next(err);
  }
}

module.exports = {
  sendMessage,
};
