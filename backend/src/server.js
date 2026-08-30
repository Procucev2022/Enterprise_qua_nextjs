const app = require('./app');
const storeService = require('./services/storeService');
const poolModule = require('./db/pool');

const PORT = process.env.PORT || 4000;

async function bootstrapServer(port = PORT) {
  try {
    const dbHealth = await poolModule.checkDBHealth();
    if (dbHealth && dbHealth.isConnected) {
      await storeService.hydrateFromDB();
    }
  } catch (err) {
    // Database initialization fallback handled in memory
  }

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

if (process.env.AUTO_START_SERVER === 'true' || require.main === module) {
  start();
}

module.exports = { app, bootstrapServer, start };
