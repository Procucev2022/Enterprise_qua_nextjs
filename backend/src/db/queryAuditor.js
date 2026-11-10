const { logger } = require('../services/loggerService');
const { DATABASE_QUERY_LOGGING } = require('../config/constants');
const crypto = require('crypto');

/**
 * Enterprise Database Query Performance Auditor & Profiler
 * Continuously tracks query efficiency, identifies slow queries,
 * and maintains infrastructure compute metrics.
 */

class QueryAuditor {
  constructor({ slowQueryThresholdMs = DATABASE_QUERY_LOGGING.SLOW_QUERY_THRESHOLD_MS_DEFAULT } = {}) {
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
      const normalizedQuery = queryText.trim().replace(/\s+/g, ' ');
      const queryId = crypto.createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 12);
      const operation = /^\s*([a-z]+)/i.exec(queryText)?.[1]?.toUpperCase() || 'UNKNOWN';
      const slowEntry = {
        id: `slow-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        queryId,
        operation,
        table,
        durationMs,
        timestamp: new Date().toISOString(),
      };
      this.slowQueries.unshift(slowEntry);
      if (this.slowQueries.length > this.maxSlowQueryLog) {
        this.slowQueries.pop();
      }

      logger.warn(
        `Slow database query detected on table '${table}' (${operation}): ${durationMs}ms`,
        { queryId, operation, durationMs, table },
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

function resolveSlowQueryThreshold(env = process.env) {
  const configuredThreshold = env.SLOW_QUERY_THRESHOLD_MS;
  if (configuredThreshold === undefined || configuredThreshold === '') {
    return DATABASE_QUERY_LOGGING.SLOW_QUERY_THRESHOLD_MS_DEFAULT;
  }
  const parsedThreshold = Number(configuredThreshold);
  if (!Number.isFinite(parsedThreshold) || parsedThreshold <= 0) {
    return DATABASE_QUERY_LOGGING.SLOW_QUERY_THRESHOLD_MS_DEFAULT;
  }
  return parsedThreshold;
}

queryAuditor.slowQueryThresholdMs = resolveSlowQueryThreshold();

module.exports = {
  QueryAuditor,
  queryAuditor,
  resolveSlowQueryThreshold,
};
