const storeService = require('../services/storeService');

function sendMessage(req, res, next) {
  try {
    const { prompt, userRole } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'prompt is required.' });
    }
    const response = storeService.handleSupportChat(prompt, userRole);
    res.json({ success: true, ...response });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  sendMessage,
};
