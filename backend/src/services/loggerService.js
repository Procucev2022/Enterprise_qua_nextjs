const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Log Levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  AUDIT: 4,
};

class LoggerService {
  constructor(options = {}) {
    this.logsDir = options.logsDir || path.resolve(__dirname, '../../logs');
    this.maxBufferSize = options.maxBufferSize || 1000;
    this.retentionDays = options.retentionDays || 30;
    this.maxFileSizeBytes = options.maxFileSizeBytes || 10 * 1024 * 1024; // 10MB default
    this.isLocalLoggingEnabled = options.isLocalLoggingEnabled !== undefined ? options.isLocalLoggingEnabled : true;
    this.inMemoryLogs = [];

    this.ensureLogsDirectory();
  }

  ensureLogsDirectory() {
    if (this.isLocalLoggingEnabled) {
      try {
        if (!fs.existsSync(this.logsDir)) {
          fs.mkdirSync(this.logsDir, { recursive: true });
        }
      } catch (err) {
        // Fallback for restricted environments
      }
    }
  }

  formatTimestamp(date = new Date()) {
    return date.toISOString().replace('T', ' ').substring(0, 23) + ' UTC';
  }

  createLogEntry(level, message, meta = {}, category = 'SYSTEM') {
    const timestamp = this.formatTimestamp();
    const id = `log-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    let stackTrace = undefined;
    let metadata = { ...meta };

    if (meta instanceof Error) {
      stackTrace = meta.stack;
      metadata = { errorMessage: meta.message, errorName: meta.name };
    } else if (meta && meta.error instanceof Error) {
      stackTrace = meta.error.stack;
      metadata = { ...meta, errorMessage: meta.error.message };
      delete metadata.error;
    }

    const logEntry = {
      id,
      timestamp,
      level,
      category,
      message,
      metadata,
      correlationId: metadata.correlationId || metadata.requestId || `corr-${Date.now()}`,
      userEmail: metadata.userEmail || 'system@procucev.ai',
      ipAddress: metadata.ipAddress || '127.0.0.1 (Local Environment)',
      ...(stackTrace ? { stackTrace } : {}),
    };

    return logEntry;
  }

  writeToDisk(logEntry) {
    if (!this.isLocalLoggingEnabled) return;

    try {
      this.ensureLogsDirectory();
      const line = JSON.stringify(logEntry) + '\n';

      // 1. General Application Log
      const appLogPath = path.join(this.logsDir, 'app.log');
      fs.appendFileSync(appLogPath, line, 'utf8');

      // 2. Specialized Error Log
      if (logEntry.level === 'ERROR') {
        const errorLogPath = path.join(this.logsDir, 'error.log');
        fs.appendFileSync(errorLogPath, line, 'utf8');
      }

      // 3. Specialized Audit Log
      if (logEntry.level === 'AUDIT') {
        const auditLogPath = path.join(this.logsDir, 'audit.log');
        fs.appendFileSync(auditLogPath, line, 'utf8');
      }
    } catch {
      // Graceful fallback if filesystem write fails
    }
  }

  log(level, message, meta = {}, category = 'SYSTEM') {
    const entry = this.createLogEntry(level, message, meta, category);

    // Keep within buffer limit
    this.inMemoryLogs.unshift(entry);
    if (this.inMemoryLogs.length > this.maxBufferSize) {
      this.inMemoryLogs.pop();
    }

    // Persist to local disk
    this.writeToDisk(entry);

    return entry;
  }

  info(message, meta = {}, category = 'SYSTEM') {
    return this.log('INFO', message, meta, category);
  }

  warn(message, meta = {}, category = 'SYSTEM') {
    return this.log('WARN', message, meta, category);
  }

  error(message, errorOrMeta = {}, category = 'SYSTEM') {
    return this.log('ERROR', message, errorOrMeta, category);
  }

  debug(message, meta = {}, category = 'SYSTEM') {
    return this.log('DEBUG', message, meta, category);
  }

  audit(action, userEmail, meta = {}, rfqNumber = null) {
    return this.log('AUDIT', action, { ...meta, userEmail, rfqNumber }, 'AUDIT_TRAIL');
  }

  queryLogs({ level, category, search, from, to, limit = 100, offset = 0 } = {}) {
    let results = [...this.inMemoryLogs];

    if (level) {
      const targetLevel = level.toUpperCase();
      results = results.filter((l) => l.level === targetLevel);
    }

    if (category) {
      const targetCategory = category.toUpperCase();
      results = results.filter((l) => l.category && l.category.toUpperCase().includes(targetCategory));
    }

    if (search) {
      const query = search.toLowerCase();
      results = results.filter(
        (l) =>
          l.message.toLowerCase().includes(query) ||
          (l.userEmail && l.userEmail.toLowerCase().includes(query)) ||
          (l.category && l.category.toLowerCase().includes(query)) ||
          JSON.stringify(l.metadata).toLowerCase().includes(query)
      );
    }

    if (from) {
      const fromDate = new Date(from).getTime();
      results = results.filter((l) => new Date(l.timestamp).getTime() >= fromDate);
    }

    if (to) {
      const toDate = new Date(to).getTime();
      results = results.filter((l) => new Date(l.timestamp).getTime() <= toDate);
    }

    const total = results.length;
    const paginated = results.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      count: paginated.length,
      logs: paginated,
    };
  }

  purgeExpiredLogs(options = {}) {
    const maxAgeDays = options.maxAgeDays || this.retentionDays;
    const now = Date.now();
    const cutoffTime = now - maxAgeDays * 24 * 60 * 60 * 1000;

    const initialCount = this.inMemoryLogs.length;
    this.inMemoryLogs = this.inMemoryLogs.filter((l) => {
      const logTime = new Date(l.timestamp).getTime();
      return !isNaN(logTime) && logTime >= cutoffTime;
    });
    const purgedCount = initialCount - this.inMemoryLogs.length;

    // Prune disk files if local logging is active
    let diskFilesPurged = 0;
    if (this.isLocalLoggingEnabled && fs.existsSync(this.logsDir)) {
      try {
        const files = fs.readdirSync(this.logsDir);
        files.forEach((file) => {
          const filePath = path.join(this.logsDir, file);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            if (stats.size > this.maxFileSizeBytes) {
              // Rotate / truncate oversized files, keeping last 500KB
              const content = fs.readFileSync(filePath, 'utf8');
              const lines = content.split('\n');
              const retainedLines = lines.slice(Math.floor(lines.length / 2)).join('\n');
              fs.writeFileSync(filePath, retainedLines, 'utf8');
              diskFilesPurged += 1;
            }
          }
        });
      } catch {
        // Disk purge fallback
      }
    }

    return {
      success: true,
      purgedMemoryCount: purgedCount,
      diskFilesPurged,
      retentionDays: maxAgeDays,
      purgedAt: this.formatTimestamp(),
    };
  }

  getLogStats() {
    const levelCounts = {
      DEBUG: 0,
      INFO: 0,
      WARN: 0,
      ERROR: 0,
      AUDIT: 0,
    };

    this.inMemoryLogs.forEach((l) => {
      if (levelCounts[l.level] !== undefined) {
        levelCounts[l.level] += 1;
      }
    });

    let diskLogFiles = [];
    if (this.isLocalLoggingEnabled && fs.existsSync(this.logsDir)) {
      try {
        diskLogFiles = fs.readdirSync(this.logsDir).map((f) => {
          const fp = path.join(this.logsDir, f);
          const stat = fs.statSync(fp);
          return {
            filename: f,
            sizeBytes: stat.size,
            lastModified: stat.mtime.toISOString(),
          };
        });
      } catch {
        diskLogFiles = [];
      }
    }

    return {
      totalLogs: this.inMemoryLogs.length,
      levelCounts,
      retentionDays: this.retentionDays,
      logsDirectory: this.logsDir,
      diskLogFiles,
      isLocalLoggingEnabled: this.isLocalLoggingEnabled,
    };
  }

  clear() {
    this.inMemoryLogs = [];
  }
}

// Singleton Instance
const defaultLogger = new LoggerService();

module.exports = {
  LoggerService,
  logger: defaultLogger,
  LOG_LEVELS,
};
