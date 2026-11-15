const fs = require('fs');
const path = require('path');
const { logger } = require('./loggerService');
const { queryCache } = require('../db/queryCache');
const pool = require('../db/pool');

/**
 * Enterprise Log Error Auto-Resolver & Diagnostics Engine
 * Continuously parses runtime log outputs, stack traces, and error codes
 * to diagnose root causes and execute automated remediation actions.
 */

// The only remediation actions this resolver can run. Anything else is refused.
const SUPPORTED_REMEDIATION_ACTIONS = Object.freeze([
  'RECONNECT_POOL_AND_INVALIDATE_CACHE',
  'OPTIMIZE_QUERY_CACHE',
  'PURGE_EXPIRED_LOGS_AND_FLUSH_CACHE',
]);

class LogErrorResolver {
  constructor(options = {}) {
    this.logsDir = options.logsDir || LogErrorResolver.resolveDefaultLogsDir();
    this.remediationHistory = [];
  }

  // See LoggerService.resolveDefaultLogsDir — __dirname doesn't exist on
  // Cloudflare Workers and would otherwise throw at construction time.
  static resolveDefaultLogsDir() {
    try {
      // eslint-disable-next-line no-undef
      return path.join(__dirname, '../../logs');
    } catch {
      return './logs';
    }
  }

  getLogFilePath(logType = 'error') {
    let filename = 'app.log';
    if (logType === 'error') {
      filename = 'error.log';
    } else if (logType === 'audit') {
      filename = 'audit.log';
    }
    return path.join(this.logsDir, filename);
  }

  parseLogLines(logType = 'error', maxLines = 200) {
    const filePath = this.getLogFilePath(logType);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const rawContent = fs.readFileSync(filePath, 'utf8');
      const lines = rawContent
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const parsed = [];
      const slice = lines.slice(-maxLines);

      for (const line of slice) {
        try {
          const entry = JSON.parse(line);
          parsed.push(entry);
        } catch {
          // Unstructured line fallback
          // The line carries no timestamp of its own, so none is invented for it.
          parsed.push({
            timestamp: null,
            level: 'ERROR',
            message: line,
            category: 'UNSTRUCTURED',
          });
        }
      }

      return parsed;
    } catch (err) {
      logger.error('Failed to parse log file', err, 'LOG_ERROR_RESOLVER');
      return [];
    }
  }

  diagnoseErrors() {
    const errorEntries = this.parseLogLines('error', 300);
    const diagnosedIssues = new Map();

    for (const entry of errorEntries) {
      const msg = entry.message || entry.error || 'Unknown Error';
      const category = entry.category || 'GENERAL_FAULT';

      let issueType = 'APPLICATION_EXCEPTION';
      // Null when no automated remediation exists for the issue. Nothing is suggested
      // that the resolver cannot actually run.
      let suggestedAction = null;
      let severity = 'MEDIUM';

      // Checked before the connection pattern: a slow-query message also contains "database",
      // so the connection check would otherwise claim it and the slow-query branch never ran.
      if (/slow database query/i.test(msg)) {
        issueType = 'SLOW_QUERY_BOTTLENECK';
        suggestedAction = 'OPTIMIZE_QUERY_CACHE';
        severity = 'MEDIUM';
      } else if (/database|postgres|pool|ECONNREFUSED|connection timeout/i.test(msg)) {
        issueType = 'DATABASE_CONNECTION_FAULT';
        suggestedAction = 'RECONNECT_POOL_AND_INVALIDATE_CACHE';
        severity = 'HIGH';
      } else if (/graphql|syntax error|cannot query field/i.test(msg)) {
        issueType = 'GRAPHQL_VALIDATION_FAULT';
        severity = 'LOW';
      } else if (/out of memory|heap/i.test(msg)) {
        issueType = 'MEMORY_PRESSURE';
        suggestedAction = 'PURGE_EXPIRED_LOGS_AND_FLUSH_CACHE';
        severity = 'CRITICAL';
      }

      const key = `${issueType}::${category}`;
      if (!diagnosedIssues.has(key)) {
        diagnosedIssues.set(key, {
          issueId: `ISSUE-${diagnosedIssues.size + 1}`,
          issueType,
          category,
          severity,
          suggestedAction,
          count: 0,
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp,
          sampleMessage: msg.substring(0, 160),
        });
      }

      const issue = diagnosedIssues.get(key);
      issue.count += 1;
      issue.lastSeen = entry.timestamp;
    }

    return Array.from(diagnosedIssues.values());
  }

  /**
   * Run one remediation action and return what really happened.
   *
   * Unknown actions are refused with status 'not_supported' and are not recorded.
   * A real action that fails, such as a database that does not answer, is recorded
   * with status 'failed'. Only an action that ran is recorded as 'applied'.
   */
  async executeRemediation(actionType) {
    const start = Date.now();
    const timestamp = new Date().toISOString();

    if (!SUPPORTED_REMEDIATION_ACTIONS.includes(actionType)) {
      logger.warn(`Unsupported remediation action refused: ${actionType}`, { actionType }, 'AUTO_REMEDIATION');
      return {
        remediationId: null,
        actionType,
        success: false,
        status: 'not_supported',
        message: `No automated remediation exists for ${actionType}. Nothing was changed.`,
        timestamp,
        durationMs: Date.now() - start,
      };
    }

    let success = true;
    let status = 'applied';
    let message;
    try {
      if (actionType === 'RECONNECT_POOL_AND_INVALIDATE_CACHE') {
        queryCache.clear();
        const health = await pool.checkDatabaseHealth();
        if (health && health.isConnected) {
          message = 'Cleared query cache and confirmed the database connection.';
        } else {
          success = false;
          status = 'failed';
          message = `Cleared query cache, but the database did not respond: ${(health && health.errorMessage) || 'no response'}.`;
        }
      } else if (actionType === 'OPTIMIZE_QUERY_CACHE') {
        queryCache.clear();
        message = 'Cleared the query cache.';
      } else {
        queryCache.clear();
        logger.purgeExpiredLogs({ maxAgeDays: 7, maxSizeBytes: 10 * 1024 * 1024 });
        message = 'Purged expired logs and cleared the query cache.';
      }
    } catch (err) {
      success = false;
      status = 'failed';
      message = `Remediation ${actionType} failed: ${(err && err.message) || 'unknown error'}.`;
    }

    const durationMs = Date.now() - start;
    const historyItem = {
      remediationId: `REM-${Date.now()}`,
      actionType,
      success,
      status,
      message,
      timestamp,
      durationMs,
    };

    this.remediationHistory.unshift(historyItem);
    if (this.remediationHistory.length > 50) {
      this.remediationHistory.pop();
    }

    logger.info(`Auto-Remediation ${status}: ${actionType}`, { actionType, durationMs, success }, 'AUTO_REMEDIATION');
    return historyItem;
  }

  async autoResolveAll() {
    const issues = this.diagnoseErrors();
    const executedActions = [];

    // Only issues that have an automated remediation run one.
    const uniqueActions = new Set(issues.map((i) => i.suggestedAction).filter(Boolean));
    for (const action of Array.from(uniqueActions)) {
      const res = await this.executeRemediation(action);
      executedActions.push(res);
    }

    return {
      diagnosedCount: issues.length,
      issues,
      remediationsApplied: executedActions,
    };
  }

  getRemediationHistory() {
    return this.remediationHistory;
  }
}

const logErrorResolver = new LogErrorResolver();

module.exports = {
  LogErrorResolver,
  logErrorResolver,
};
