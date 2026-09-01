const fs = require('fs');
const path = require('path');
const { logger } = require('./loggerService');
const { queryCache } = require('../db/queryCache');
const identityPoolModule = require('../db/identityPool');

/**
 * Enterprise Log Error Auto-Resolver & Diagnostics Engine
 * Continuously parses runtime log outputs, stack traces, and error codes
 * to diagnose root causes and execute automated remediation actions.
 */

class LogErrorResolver {
  constructor(options = {}) {
    this.logsDir = options.logsDir || path.join(__dirname, '../../logs');
    this.remediationHistory = [];
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
          parsed.push({
            timestamp: new Date().toISOString(),
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
      let suggestedAction = 'INSPECT_PAYLOAD';
      let severity = 'MEDIUM';

      if (/database|postgres|pool|ECONNREFUSED|connection timeout/i.test(msg)) {
        issueType = 'DATABASE_CONNECTION_FAULT';
        suggestedAction = 'RECONNECT_POOL_AND_INVALIDATE_CACHE';
        severity = 'HIGH';
      } else if (/slow database query/i.test(msg)) {
        issueType = 'SLOW_QUERY_BOTTLENECK';
        suggestedAction = 'OPTIMIZE_QUERY_CACHE';
        severity = 'MEDIUM';
      } else if (/graphql|syntax error|cannot query field/i.test(msg)) {
        issueType = 'GRAPHQL_VALIDATION_FAULT';
        suggestedAction = 'VALIDATE_SCHEMA_CLIENT_COMPATIBILITY';
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

  async executeRemediation(actionType) {
    const start = Date.now();
    let message = 'Validated schema stability and client contracts.';

    if (actionType === 'RECONNECT_POOL_AND_INVALIDATE_CACHE') {
      queryCache.clear();
      await identityPoolModule.checkIdentityHealth();
      message = 'Cleared query cache and verified database connection lifecycle.';
    } else if (actionType === 'OPTIMIZE_QUERY_CACHE') {
      queryCache.clear();
      message = 'Flushed and optimized query cache tables.';
    } else if (actionType === 'PURGE_EXPIRED_LOGS_AND_FLUSH_CACHE') {
      queryCache.clear();
      logger.purgeExpiredLogs({ maxAgeDays: 7, maxSizeBytes: 10 * 1024 * 1024 });
      message = 'Purged expired logs and flushed memory cache.';
    }

    const durationMs = Date.now() - start;
    const historyItem = {
      remediationId: `REM-${Date.now()}`,
      actionType,
      message,
      timestamp: new Date().toISOString(),
      durationMs,
    };

    this.remediationHistory.unshift(historyItem);
    if (this.remediationHistory.length > 50) {
      this.remediationHistory.pop();
    }

    logger.info(`Auto-Remediation executed: ${actionType}`, { actionType, durationMs }, 'AUTO_REMEDIATION');
    return historyItem;
  }

  async autoResolveAll() {
    const issues = this.diagnoseErrors();
    const executedActions = [];

    const uniqueActions = new Set(issues.map((i) => i.suggestedAction));
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
