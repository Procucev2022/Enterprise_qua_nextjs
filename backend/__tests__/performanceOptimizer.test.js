const { PerformanceOptimizer, performanceOptimizer } = require('../src/services/performanceOptimizer');
const { queryAuditor } = require('../src/db/queryAuditor');
const { queryCache } = require('../src/db/queryCache');

describe('PerformanceOptimizer Unit Tests', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new PerformanceOptimizer();
  });

  test('auditPerformance calculates scores, grades, and returns system and database telemetry', () => {
    const audit = optimizer.auditPerformance();

    expect(audit.healthScore).toBeGreaterThanOrEqual(0);
    expect(audit.grade).toBeDefined();
    expect(audit.memory).toBeDefined();
    expect(audit.memory.heapUsedMB).toBeGreaterThan(0);
    expect(audit.system.cpuCores).toBeGreaterThan(0);
    expect(audit.database.queryStats).toBeDefined();
    expect(audit.recommendations.length).toBeGreaterThan(0);
  });

  test('auditPerformance evaluates all grade branches: A, B, and C', () => {
    // 1. Grade A branch (score 85)
    jest.spyOn(queryAuditor, 'getAuditReport').mockReturnValueOnce({
      averageQueryDurationMs: 150, // -15 => 85 => Grade A
      slowQueriesCount: 1,
    });
    jest.spyOn(queryCache, 'getMetrics').mockReturnValueOnce({
      cacheHitRatioNumber: 80,
      totalQueriesProcessed: 20,
    });
    const auditA = optimizer.auditPerformance();
    expect(auditA.grade).toBe('A');
    expect(auditA.healthScore).toBe(85);

    // 2. Grade B branch (score 75)
    jest.spyOn(queryAuditor, 'getAuditReport').mockReturnValueOnce({
      averageQueryDurationMs: 150, // -15
      slowQueriesCount: 1,
    });
    jest.spyOn(queryCache, 'getMetrics').mockReturnValueOnce({
      cacheHitRatioNumber: 20, // -10 => 75 => Grade B
      totalQueriesProcessed: 20,
    });
    const auditB = optimizer.auditPerformance();
    expect(auditB.grade).toBe('B');
    expect(auditB.healthScore).toBe(75);

    // 3. Grade C branch (score 60)
    jest.spyOn(queryAuditor, 'getAuditReport').mockReturnValueOnce({
      averageQueryDurationMs: 150, // -15
      slowQueriesCount: 2,
    });
    jest.spyOn(queryCache, 'getMetrics').mockReturnValueOnce({
      cacheHitRatioNumber: 20, // -10
      totalQueriesProcessed: 20,
    });
    jest.spyOn(process, 'memoryUsage').mockReturnValueOnce({
      heapUsed: 600 * 1024 * 1024, // -15 => 60 => Grade C
      heapTotal: 700 * 1024 * 1024,
      rss: 800 * 1024 * 1024,
    });
    const auditC = optimizer.auditPerformance();
    expect(auditC.grade).toBe('C');
    expect(auditC.healthScore).toBe(60);
  });

  test('generateRecommendations suggests targeted optimizations based on metrics', () => {
    const recs1 = optimizer.generateRecommendations(
      70,
      { slowQueriesCount: 2, averageQueryDurationMs: 150 },
      { cacheHitRatioNumber: 30, totalQueriesProcessed: 20 }
    );
    expect(recs1.length).toBe(2);

    const recsClean = optimizer.generateRecommendations(
      95,
      { slowQueriesCount: 0, averageQueryDurationMs: 10 },
      { cacheHitRatioNumber: 80, totalQueriesProcessed: 20 }
    );
    expect(recsClean[0]).toMatch(/peak efficiency/i);
  });

  test('optimizePerformance applies tuning actions and stores history exceeding buffer limit', () => {
    // Fill queryAuditor slowQueries to > 30
    for (let i = 0; i < 35; i++) {
      queryAuditor.slowQueries.push({ query: `test_${i}` });
    }

    const res = optimizer.optimizePerformance('aggressive');

    expect(res.status).toBe('OPTIMIZED');
    expect(res.level).toBe('aggressive');
    expect(res.actionsApplied.length).toBeGreaterThan(0);

    // Fill history to > 50
    for (let i = 0; i < 55; i++) {
      optimizer.optimizePerformance('standard');
    }
    const history = optimizer.getOptimizationHistory();
    expect(history.length).toBe(50);
  });

  test('singleton performanceOptimizer instance methods execute properly', () => {
    const audit = performanceOptimizer.auditPerformance();
    expect(audit.timestamp).toBeDefined();

    const opt = performanceOptimizer.optimizePerformance();
    expect(opt.status).toBe('OPTIMIZED');
  });
});
