const { logger } = require('../services/loggerService');

/**
 * Enterprise Database Query Performance Auditor & Profiler
 * Continuously tracks query efficiency, identifies slow queries,
 * and maintains infrastructure compute metrics.
 */

class QueryAuditor {
  constructor({ slowQueryThresholdMs = 200 } = {}) {
    this.slowQueryThresholdMs = slowQueryThresholdMs;
    this.totalQueries = 0;
    this.totalExecutionTimeMs = 0;
    this.slowQueries = [];
    this.tableStats = {};
    this.maxSlowQueryLog = 50;
  }

  detectTable(queryText = '') {
    const match = queryText.match(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-zA-Z0-9_]+)/i);
    return match ? match[1].toLowerCase() : 'other';
  }

  auditQuery(queryText, params = [], durationMs = 0, isCacheHit = false) {
    this.totalQueries += 1;
    this.totalExecutionTimeMs += durationMs;

    const table = this.detectTable(queryText);
    if (!this.tableStats[table]) {
      this.tableStats[table] = { count: 0, totalDurationMs: 0, slowCount: 0 };
    }
    this.tableStats[table].count += 1;
    this.tableStats[table].totalDurationMs += durationMs;

    const isSlow = !isCacheHit && durationMs >= this.slowQueryThresholdMs;
    if (isSlow) {
      this.tableStats[table].slowCount += 1;
      const slowEntry = {
        id: `slow-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        query: queryText.trim().replace(/\s+/g, ' ').substring(0, 200),
        table,
        durationMs,
        timestamp: new Date().toISOString(),
      };
      this.slowQueries.unshift(slowEntry);
      if (this.slowQueries.length > this.maxSlowQueryLog) {
        this.slowQueries.pop();
      }

      logger.warn(
        `Slow database query detected on table '${table}': ${durationMs}ms`,
        { query: slowEntry.query, durationMs, table },
        'DATABASE_PERFORMANCE'
      );
    }

    return { isSlow, durationMs, table };
  }

  getAuditReport() {
    const avgDuration = this.totalQueries > 0 ? (this.totalExecutionTimeMs / this.totalQueries).toFixed(2) : '0.00';
    return {
      totalQueriesExecuted: this.totalQueries,
      totalExecutionTimeMs: this.totalExecutionTimeMs,
      averageQueryDurationMs: Number(avgDuration),
      slowQueryThresholdMs: this.slowQueryThresholdMs,
      slowQueriesCount: this.slowQueries.length,
      recentSlowQueries: this.slowQueries.slice(0, 10),
      tableExecutionBreakdown: this.tableStats,
    };
  }

  reset() {
    this.totalQueries = 0;
    this.totalExecutionTimeMs = 0;
    this.slowQueries = [];
    this.tableStats = {};
  }
}

const queryAuditor = new QueryAuditor();

module.exports = {
  QueryAuditor,
  queryAuditor,
};
