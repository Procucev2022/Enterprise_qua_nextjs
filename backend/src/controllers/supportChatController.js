const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { SUPPORT_CHAT_MESSAGES } = require('../config/constants');

function sendMessage(req, res, next) {
  try {
    const { prompt, userRole } = req.body;
    if (!prompt) {
      logger.warn('Failed support chat message: Missing prompt', { body: req.body }, 'SUPPORT_CHAT_CONTROLLER');
      return res.status(400).json({ success: false, error: SUPPORT_CHAT_MESSAGES.PROMPT_REQUIRED });
    }
    logger.info(`Handling support chat query from ${userRole || 'buyer'}`, { prompt, userRole }, 'SUPPORT_CHAT_CONTROLLER');
    const response = storeService.handleSupportChat(prompt, userRole);
    // No assistant is connected, so the message was not answered. The response is
    // 503 with status not_configured, never a 200 that looks like a reply.
    logger.warn('Support chat is not connected; the message was not answered', { status: response.status }, 'SUPPORT_CHAT_CONTROLLER');
    res.status(503).json({ ...response });
  } catch (err) {
    logger.error('Error handling support chat message', err, 'SUPPORT_CHAT_CONTROLLER');
    next(err);
  }
}

module.exports = {
  sendMessage,
};
