const app = require('./app');
const identityPoolModule = require('./db/identityPool');
const storeService = require('./services/storeService');
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

/**
 * Record a crash before the process dies.
 *
 * Node exits on an unhandled rejection, which closes every in-flight socket. The
 * client sees only "socket hang up" and nothing reaches app.log, so the cause is
 * unrecoverable after the fact — which is precisely how a failing extraction
 * became impossible to diagnose. Default exit behaviour is preserved; this just
 * makes the reason survive.
 *
 * `proc` is injectable so a test can assert the logging without exiting the
 * Jest worker.
 */
function installCrashHandlers(proc = process) {
  proc.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled promise rejection', err, 'SERVER');
  });

  proc.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — the process is exiting', err, 'SERVER');
    proc.exit(1);
  });

  return proc;
}

async function bootstrapServer(port = PORT) {
  await reportIdentityHealth();
  await storeService.hydrateFromDB();
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
  // Installed only on a real boot. Registering these on the Jest process would
  // both leak listeners across suites and swallow failures the runner should see.
  installCrashHandlers();
  start();
}

module.exports = { app, bootstrapServer, start, reportIdentityHealth, installCrashHandlers };
