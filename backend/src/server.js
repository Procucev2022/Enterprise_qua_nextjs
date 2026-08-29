const app = require('./app');
const storeService = require('./services/storeService');
const { checkDBHealth } = require('./db/pool');

const PORT = process.env.PORT || 4000;

async function bootstrapServer() {
  console.log('\n================================================================');
  console.log('  PROCUCEV ENTERPRISE (QUA AI 2.0) - NODE.JS PLATFORM SERVER');
  console.log('================================================================\n');

  try {
    // Check Database status and hydrate if available
    const dbHealth = await checkDBHealth();
    console.log(`[Database Provider]: ${dbHealth.providerLabel}`);
    console.log(`[Database Status]:   ${dbHealth.isConnected ? 'CONNECTED' : 'RUNNING IN IN-MEMORY FALLBACK MODE'}`);

    if (dbHealth.isConnected) {
      await storeService.hydrateFromDB();
      console.log('✅ Synchronized state from PostgreSQL database.');
    } else {
      console.log('ℹ️  Initialized in-memory enterprise state store with seed baseline.');
    }
  } catch (err) {
    console.warn('⚠️  Database initialization skipped, continuing in memory:', err.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server listening on http://localhost:${PORT}`);
    console.log(`📊 API Base URL:       http://localhost:${PORT}/api`);
    console.log(`💻 Web Dashboard:      http://localhost:${PORT}`);
    console.log(`🔍 Health Check:       http://localhost:${PORT}/health\n`);
  });

  // Graceful Shutdown
  const shutdown = () => {
    console.log('\nStopping Procucev Node.js server...');
    server.close(() => {
      console.log('Server terminated cleanly.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  bootstrapServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;
