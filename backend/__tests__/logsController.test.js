const request = require('supertest');
const app = require('../src/app');
const { logger } = require('../src/services/loggerService');
const { logErrorResolver } = require('../src/services/logErrorResolver');
const { performanceOptimizer } = require('../src/services/performanceOptimizer');
const logsController = require('../src/controllers/logsController');

describe('Backend Logs Controller & Endpoints Suite', () => {
  beforeEach(() => {
    logger.clear();
  });

  test('GET /api/logs returns queried logs and accepts filtering parameters and default query', async () => {
    logger.info('System boot completed', { version: '2.0.0' }, 'BOOT');
    logger.error('Failed API call', new Error('Timeout'), 'API');
    logger.audit('Vendor modified', 'admin@procucev.com');

    // Default call without query parameters
    const resAll = await request(app).get('/api/logs').expect(200);
    expect(resAll.body.success).toBe(true);
    expect(resAll.body.total).toBe(3);

    // Query with all filters including limit and offset
    const resFiltered = await request(app)
      .get('/api/logs?level=ERROR&category=API&search=Timeout&limit=10&offset=0')
      .expect(200);
    expect(resFiltered.body.success).toBe(true);
    expect(resFiltered.body.count).toBe(1);
    expect(resFiltered.body.logs[0].level).toBe('ERROR');

    // Query with only search and from/to
    const resDates = await request(app)
      .get('/api/logs?from=2026-01-01&to=2026-12-31')
      .expect(200);
    expect(resDates.body.success).toBe(true);
  });

  test('POST /api/logs ingests valid log entries and rejects empty message', async () => {
    // Missing message
    const resBad = await request(app)
      .post('/api/logs')
      .send({ level: 'INFO', category: 'UI' })
      .expect(400);
    expect(resBad.body.success).toBe(false);
    expect(resBad.body.error).toMatch(/message is required/i);

    // Valid log with default level, category, and metadata
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

  test('GET /api/logs/diagnose and POST /api/logs/auto-resolve diagnose and resolve log errors', async () => {
    const resDiag = await request(app).get('/api/logs/diagnose').expect(200);
    expect(resDiag.body.success).toBe(true);
    expect(Array.isArray(resDiag.body.issues)).toBe(true);

    // Auto resolve all
    const resResolveAll = await request(app).post('/api/logs/auto-resolve').send({}).expect(200);
    expect(resResolveAll.body.success).toBe(true);
    expect(resResolveAll.body.report).toBeDefined();

    // Auto resolve specific action
    const resResolveAction = await request(app)
      .post('/api/logs/auto-resolve')
      .send({ action: 'OPTIMIZE_QUERY_CACHE' })
      .expect(200);
    expect(resResolveAction.body.success).toBe(true);
    expect(resResolveAction.body.remediation.actionType).toBe('OPTIMIZE_QUERY_CACHE');
  });

  test('GET /api/logs/performance and POST /api/logs/performance/optimize audit and optimize performance', async () => {
    const resPerf = await request(app).get('/api/logs/performance').expect(200);
    expect(resPerf.body.success).toBe(true);
    expect(resPerf.body.audit).toBeDefined();

    // Standard optimization (no body)
    const resOptDefault = await request(app).post('/api/logs/performance/optimize').send().expect(200);
    expect(resOptDefault.body.success).toBe(true);
    expect(resOptDefault.body.result.status).toBe('OPTIMIZED');

    // Level optimization (with body)
    const resOptAggressive = await request(app)
      .post('/api/logs/performance/optimize')
      .send({ level: 'aggressive' })
      .expect(200);
    expect(resOptAggressive.body.success).toBe(true);
    expect(resOptAggressive.body.result.level).toBe('aggressive');
  });

  test('direct controller function calls with null/empty parameters cover all optional branches', async () => {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();

    // 1. getLogs without query
    logsController.getLogs({}, res, next);
    expect(res.json).toHaveBeenCalled();

    // 2. createLog with empty object
    logsController.createLog({}, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // 3. purgeLogs without body
    logsController.purgeLogs({}, res, next);
    expect(res.json).toHaveBeenCalled();

    // 4. autoResolveLogErrors with null body
    await logsController.autoResolveLogErrors({}, res, next);
    expect(res.json).toHaveBeenCalled();

    // 5. optimizePerformance with null body
    logsController.optimizePerformance({}, res, next);
    expect(res.json).toHaveBeenCalled();
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

    // 5. diagnoseLogErrors error
    const origDiag = logErrorResolver.diagnoseErrors;
    logErrorResolver.diagnoseErrors = () => {
      throw new Error('Unexpected Diagnose Failure');
    };
    const resDiagErr = await request(app).get('/api/logs/diagnose').expect(500);
    expect(resDiagErr.body.error).toBe('Unexpected Diagnose Failure');
    logErrorResolver.diagnoseErrors = origDiag;

    // 6. autoResolveLogErrors error
    const origAutoResolve = logErrorResolver.autoResolveAll;
    logErrorResolver.autoResolveAll = () => {
      throw new Error('Unexpected AutoResolve Failure');
    };
    const resAutoResolveErr = await request(app).post('/api/logs/auto-resolve').send().expect(500);
    expect(resAutoResolveErr.body.error).toBe('Unexpected AutoResolve Failure');
    logErrorResolver.autoResolveAll = origAutoResolve;

    // 7. getPerformanceAudit error
    const origAudit = performanceOptimizer.auditPerformance;
    performanceOptimizer.auditPerformance = () => {
      throw new Error('Unexpected Perf Audit Failure');
    };
    const resAuditErr = await request(app).get('/api/logs/performance').expect(500);
    expect(resAuditErr.body.error).toBe('Unexpected Perf Audit Failure');
    performanceOptimizer.auditPerformance = origAudit;

    // 8. optimizePerformance error
    const origOpt = performanceOptimizer.optimizePerformance;
    performanceOptimizer.optimizePerformance = () => {
      throw new Error('Unexpected Optimize Failure');
    };
    const resOptErr = await request(app).post('/api/logs/performance/optimize').send().expect(500);
    expect(resOptErr.body.error).toBe('Unexpected Optimize Failure');
    performanceOptimizer.optimizePerformance = origOpt;
  });
});
