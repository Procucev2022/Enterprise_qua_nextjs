const request = require('supertest');
const app = require('../src/app');
const { logger } = require('../src/services/loggerService');

describe('Backend Logs Controller & Endpoints Suite', () => {
  beforeEach(() => {
    logger.clear();
  });

  test('GET /api/logs returns queried logs and accepts filtering parameters', async () => {
    logger.info('System boot completed', { version: '2.0.0' }, 'BOOT');
    logger.error('Failed API call', new Error('Timeout'), 'API');
    logger.audit('Vendor modified', 'admin@procucev.com');

    const resAll = await request(app).get('/api/logs').expect(200);
    expect(resAll.body.success).toBe(true);
    expect(resAll.body.total).toBe(3);

    // Query with filter
    const resFiltered = await request(app)
      .get('/api/logs?level=ERROR&category=API&search=Timeout&limit=10&offset=0')
      .expect(200);
    expect(resFiltered.body.success).toBe(true);
    expect(resFiltered.body.count).toBe(1);
    expect(resFiltered.body.logs[0].level).toBe('ERROR');
  });

  test('POST /api/logs ingests valid log entries and rejects empty message', async () => {
    // Missing message
    const resBad = await request(app)
      .post('/api/logs')
      .send({ level: 'INFO', category: 'UI' })
      .expect(400);
    expect(resBad.body.success).toBe(false);
    expect(resBad.body.error).toMatch(/message is required/i);

    // Valid log with default level and category
    const resDefaults = await request(app)
      .post('/api/logs')
      .send({ message: 'Default log test' })
      .expect(201);
    expect(resDefaults.body.success).toBe(true);
    expect(resDefaults.body.data.level).toBe('INFO');
    expect(resDefaults.body.data.category).toBe('FRONTEND');

    // Valid log with custom values
    const resGood = await request(app)
      .post('/api/logs')
      .send({
        level: 'WARN',
        message: 'User clicked dispatch RFQ button',
        category: 'BUYER_UI',
        metadata: { rfqNumber: 'RFQ-2026-00450', mode: 'mode_3' },
      })
      .expect(201);
    expect(resGood.body.success).toBe(true);
    expect(resGood.body.data.message).toBe('User clicked dispatch RFQ button');
    expect(resGood.body.data.category).toBe('BUYER_UI');
  });

  test('POST /api/logs/purge triggers log purge mechanism with and without body', async () => {
    logger.info('Log entry to purge');
    const res1 = await request(app)
      .post('/api/logs/purge')
      .send({ maxAgeDays: 30 })
      .expect(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.report.success).toBe(true);

    const res2 = await request(app)
      .post('/api/logs/purge')
      .send()
      .expect(200);
    expect(res2.body.success).toBe(true);
  });

  test('GET /api/logs/stats returns structured statistics of logs and disk storage', async () => {
    logger.info('Info log');
    logger.warn('Warn log');
    logger.error('Error log');

    const res = await request(app).get('/api/logs/stats').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stats.totalLogs).toBe(3);
    expect(res.body.stats.levelCounts.INFO).toBe(1);
    expect(res.body.stats.levelCounts.WARN).toBe(1);
    expect(res.body.stats.levelCounts.ERROR).toBe(1);
  });

  test('error handler branches when unexpected exception is thrown in logsController methods', async () => {
    // 1. getLogs error
    const origQueryLogs = logger.queryLogs;
    logger.queryLogs = () => {
      throw new Error('Unexpected Query Failure');
    };
    const resGet = await request(app).get('/api/logs').expect(500);
    expect(resGet.body.success).toBe(false);
    expect(resGet.body.error).toBe('Unexpected Query Failure');
    logger.queryLogs = origQueryLogs;

    // 2. createLog error
    const origLog = logger.log;
    logger.log = () => {
      throw new Error('Unexpected Create Failure');
    };
    const resCreate = await request(app).post('/api/logs').send({ message: 'Valid message' }).expect(500);
    expect(resCreate.body.success).toBe(false);
    expect(resCreate.body.error).toBe('Unexpected Create Failure');
    logger.log = origLog;

    // 3. purgeLogs error
    const origPurge = logger.purgeExpiredLogs;
    logger.purgeExpiredLogs = () => {
      throw new Error('Unexpected Purge Failure');
    };
    const resPurge = await request(app).post('/api/logs/purge').send().expect(500);
    expect(resPurge.body.success).toBe(false);
    expect(resPurge.body.error).toBe('Unexpected Purge Failure');
    logger.purgeExpiredLogs = origPurge;

    // 4. getLogStats error
    const origStats = logger.getLogStats;
    logger.getLogStats = () => {
      throw new Error('Unexpected Stats Failure');
    };
    const resStats = await request(app).get('/api/logs/stats').expect(500);
    expect(resStats.body.success).toBe(false);
    expect(resStats.body.error).toBe('Unexpected Stats Failure');
    logger.getLogStats = origStats;
  });
});
