const poolModule = require('../db/pool');
const seed = require('../db/seed');

async function getDBStatus(req, res, next) {
  try {
    const health = await poolModule.checkDBHealth();
    res.json({ success: true, ...health });
  } catch (err) {
    next(err);
  }
}

async function initDBSchema(req, res, next) {
  try {
    const result = await poolModule.initializeSchema();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function syncDBData(req, res, next) {
  try {
    const result = await seed.seedInitialDataToPostgres();
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
