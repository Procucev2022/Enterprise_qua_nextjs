const { checkDBHealth, initializeSchema } = require('../db/pool');
const { seedInitialDataToPostgres } = require('../db/seed');

async function getDBStatus(req, res, next) {
  try {
    const health = await checkDBHealth();
    res.json({ success: true, ...health });
  } catch (err) {
    next(err);
  }
}

async function initDBSchema(req, res, next) {
  try {
    const result = await initializeSchema();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function syncDBData(req, res, next) {
  try {
    const result = await seedInitialDataToPostgres();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDBStatus,
  initDBSchema,
  syncDBData,
};
