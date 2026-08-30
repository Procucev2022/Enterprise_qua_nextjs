const poolModule = require('../db/pool');
const seed = require('../db/seed');
const { logger } = require('../services/loggerService');

async function getDBStatus(req, res, next) {
  try {
    logger.info('Checking PostgreSQL database connection status', {}, 'DB_CONTROLLER');
    const health = await poolModule.checkDBHealth();
    res.json({ success: true, ...health });
  } catch (err) {
    logger.error('Error checking DB status', err, 'DB_CONTROLLER');
    next(err);
  }
}

async function initDBSchema(req, res, next) {
  try {
    logger.info('Initializing PostgreSQL database schema', {}, 'DB_CONTROLLER');
    const result = await poolModule.initializeSchema();
    res.json(result);
  } catch (err) {
    logger.error('Error initializing database schema', err, 'DB_CONTROLLER');
    next(err);
  }
}

async function syncDBData(req, res, next) {
  try {
    logger.info('Syncing initial seed data to PostgreSQL database', {}, 'DB_CONTROLLER');
    const result = await seed.seedInitialDataToPostgres();
    res.json(result);
  } catch (err) {
    logger.error('Error syncing seed data to database', err, 'DB_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getDBStatus,
  initDBSchema,
  syncDBData,
};
