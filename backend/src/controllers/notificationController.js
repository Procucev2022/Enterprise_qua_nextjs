const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

/**
 * Resolve the authenticated caller to a notification recipient.
 *
 * A vendor's notifications are keyed by their vendor-record id, a buyer's by
 * their Neon buyer-account id — both resolved server-side from the session
 * email, never taken from the request. Category managers and admins have no
 * notification inbox of their own (they oversee, they are not a recipient), so
 * they resolve to null and every endpoint treats that as an empty inbox rather
 * than an error — a shared notification bell can call this for any role.
 */
async function resolveRecipient(req) {
  if (!req.user) return null;
  if (req.user.role === 'vendor') {
    const vendor = storeService.getVendorById(req.user.email);
    return vendor ? { type: 'vendor', id: vendor.id } : null;
  }
  if (req.user.role === 'buyer') {
    const account = await storeService.getBuyerAccountByEmail(req.user.email);
    return account ? { type: 'buyer', id: account.id } : null;
  }
  return null;
}

async function listNotifications(req, res, next) {
  try {
    const recipient = await resolveRecipient(req);
    if (!recipient) {
      return res.json({ success: true, data: [], unreadCount: 0 });
    }
    const data = storeService.getNotificationsFor(recipient.type, recipient.id);
    const unreadCount = data.filter((n) => !n.read).length;
    logger.info(
      'Fetching notifications',
      { recipientType: recipient.type, count: data.length, unreadCount },
      'NOTIFICATION_CONTROLLER'
    );
    res.json({ success: true, data, unreadCount });
  } catch (err) {
    logger.error('Error fetching notifications', err, 'NOTIFICATION_CONTROLLER');
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const recipient = await resolveRecipient(req);
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'Notification not found.' });
    }
    const updated = storeService.markNotificationRead(req.params.id, recipient.type, recipient.id);
    if (!updated) {
      // Another recipient's notification reports as "not found", the same as an
      // id that does not exist, so ids cannot be probed.
      return res.status(404).json({ success: false, error: 'Notification not found.' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Error marking notification read', err, 'NOTIFICATION_CONTROLLER');
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    const recipient = await resolveRecipient(req);
    if (!recipient) {
      return res.json({ success: true, updated: 0 });
    }
    const updated = storeService.markAllNotificationsRead(recipient.type, recipient.id);
    res.json({ success: true, updated });
  } catch (err) {
    logger.error('Error marking all notifications read', err, 'NOTIFICATION_CONTROLLER');
    next(err);
  }
}

module.exports = {
  resolveRecipient,
  listNotifications,
  markRead,
  markAllRead,
};
