const app = require('./app');
const identityPoolModule = require('./db/identityPool');
const { logger } = require('./services/loggerService');

const PORT = process.env.PORT || 4000;

/**
 * Report identity-database reachability at boot. Authentication depends on this
 * connection, so a failure is logged loudly here instead of surfacing later as
 * an unexplained login rejection.
 */
async function reportIdentityHealth() {
  try {
    const health = await identityPoolModule.checkIdentityHealth();
    if (health.isConnected) {
      logger.info(
        `Identity database connected: ${health.providerLabel} (${health.database}) — ${health.userCount} active users, ${health.latencyMs}ms`,
        {},
        'SERVER'
      );
    } else {
      logger.error(
        `Identity database UNAVAILABLE (${health.providerLabel}): ${health.errorMessage}. Logins will be rejected until this is resolved.`,
        null,
        'SERVER'
      );
    }
    return health;
  } catch (err) {
    logger.error('Identity database health check threw', err, 'SERVER');
    return null;
  }
}

async function bootstrapServer(port = PORT) {
  await reportIdentityHealth();
  const server = app.listen(port);
  return server;
}

async function start(port = PORT) {
  try {
    return await bootstrapServer(port);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && (process.env.AUTO_START_SERVER === 'true' || require.main === module)) {
  start();
}

module.exports = { app, bootstrapServer, start, reportIdentityHealth };
