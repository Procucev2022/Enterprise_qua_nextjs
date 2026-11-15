const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getRequestContext } = require('./requestContext');

// Log Levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  AUDIT: 4,
};

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_LOG_KEYS = new Set([
  'password', 'passwordhash', 'passcode', 'otp', 'otpcode', 'token', 'accesstoken',
  'refreshtoken', 'bearertoken', 'secret', 'authorization', 'cookie', 'apikey', 'apitoken',
  'sessionid', 'sessiontoken', 'jwt', 'privatekey', 'encryptionkey', 'secretkey', 'clientsecret',
]);
const IDENTIFIER_LOG_KEYS = new Set([
  'vendorid', 'buyerid', 'userid', 'rfqid', 'rfqnumber', 'requestid', 'correlationid',
  'taskid', 'approvalid', 'registrationid', 'documentid', 'paymentlinkid',
  'messageid', 'smsgid', 'jobid', 'shasignature', 'externalid',
]);

function maskEmail(value) {
  const separator = value.lastIndexOf('@');
  if (separator <= 0) return REDACTED_VALUE;
  return `${value.slice(0, 1)}***${value.slice(separator)}`;
}

function maskPhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return `***${digits.slice(-2)}`;
}

function redactLogText(value) {
  return String(value)
    .replace(/([?&](?:email|recipient|phone|mobile|token|otp|password|authorization)=)[^&#\s]*/gi, `$1${REDACTED_VALUE}`)
    .replace(/\b([A-Z0-9._%+-]{1,64})@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, (_match, local, domain) => `${local.slice(0, 1)}***@${domain}`)
    .replace(/(^|[^A-Z0-9-])(\+?\d{10,15})(?=$|[^A-Z0-9-])/gi, (_match, prefix, phone) => `${prefix}${maskPhone(phone)}`)
    .replace(/(^|[^A-Z0-9-])(\+?\d{1,3}[\s.-]\d{3,5}[\s.-]\d{4,6})(?=$|[^A-Z0-9-])/gi, (_match, prefix, phone) => `${prefix}${maskPhone(phone)}`);
}

function redactLogValue(value, key = '', seen = new WeakSet(), preserveAuditIdentity = false) {
  const normalizedKey = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (SENSITIVE_LOG_KEYS.has(normalizedKey)) return REDACTED_VALUE;
  if (IDENTIFIER_LOG_KEYS.has(normalizedKey)) return value;
  if (preserveAuditIdentity && normalizedKey === 'useremail') return value;

  if (typeof value === 'string') {
    if (/(email|recipientemail|^to)$/.test(normalizedKey) && value.includes('@')) return maskEmail(value);
    if (/(phone|mobile|msisdn|telephone|formattednumber)/.test(normalizedKey) && value.replace(/\D/g, '').length >= 7) {
      return maskPhone(value);
    }
    return redactLogText(value);
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return {
      errorName: value.name,
      errorMessage: redactLogText(value.message),
      stackTrace: value.stack ? redactLogText(value.stack) : undefined,
    };
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, key, seen, preserveAuditIdentity));
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    redactLogValue(childValue, childKey, seen, preserveAuditIdentity),
  ]));
}

/**
 * Adds the active request's id, method and path to a log line's metadata. A field the caller
 * already set keeps its value. Lines written outside a request are returned unchanged.
 */
function withRequestContext(meta) {
  const context = getRequestContext();
  if (!context) return meta;
  const requestFields = {
    requestId: context.requestId,
    requestMethod: context.requestMethod,
    requestPath: context.requestPath,
  };
  if (meta instanceof Error) {
    return { error: meta, errorName: meta.name, ...requestFields };
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { ...requestFields };
  }
  const merged = { ...meta };
  for (const [key, value] of Object.entries(requestFields)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

class LoggerService {
  constructor(options = {}) {
    this.logsDir = options.logsDir || LoggerService.resolveDefaultLogsDir();
    this.maxBufferSize = options.maxBufferSize ?? 1000;
    this.retentionDays = options.retentionDays ?? 30;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 10 * 1024 * 1024; // 10MB default
    this.purgeAfterWrites = options.purgeAfterWrites ?? 500;
    this.purgeCheckIntervalMs = options.purgeCheckIntervalMs ?? 15 * 60 * 1000;
    this.isLocalLoggingEnabled = options.isLocalLoggingEnabled !== undefined
      ? options.isLocalLoggingEnabled
      : LoggerService.isLocalEnvironment();
    this.inMemoryLogs = [];
    this.writesSincePurge = 0;
    this.lastPurgeAt = 0;
    this.lastDiskFailureNotificationAt = 0;
    this.lastDatabaseFailureNotificationAt = 0;
    this.suppressedDatabaseFailureCount = 0;

    this.ensureLogsDirectory();
  }

  /**
   * Determine whether the runtime is a local Node.js environment (localhost)
   * or a Cloudflare Worker environment. On Cloudflare, logs are streamed via
   * standard console output to Cloudflare Observability and file writes are skipped.
   */
  static isLocalEnvironment() {
    if (typeof globalThis !== 'undefined' && Boolean(globalThis.__CF_ENV__)) {
      return false;
    }
    if (process.env.CF_PAGES || process.env.CLOUDFLARE_WORKERS) {
      return false;
    }
    return true;
  }

  /**
   * `__dirname` doesn't exist on Cloudflare Workers (no real filesystem, and
   * the bundle isn't loaded from disk), which throws a ReferenceError at
   * import time before ensureLogsDirectory()'s own try/catch ever runs. Log
   * files themselves are best-effort everywhere (see ensureLogsDirectory) —
   * this just keeps constructing the service from throwing on Workers.
   */
  static resolveDefaultLogsDir() {
    try {
      // eslint-disable-next-line no-undef
      return path.resolve(__dirname, '../../logs');
    } catch {
      return './logs';
    }
  }

  ensureLogsDirectory() {
    if (this.isLocalLoggingEnabled && LoggerService.isLocalEnvironment()) {
      try {
        if (!fs.existsSync(this.logsDir)) {
          fs.mkdirSync(this.logsDir, { recursive: true });
        }
      } catch (err) {
        this.reportDiskFailure('create log directory', err);
      }
    }
  }

  reportDiskFailure(operation, error) {
    if (process.env.NODE_ENV === 'test') return;

    const now = Date.now();
    if (now - this.lastDiskFailureNotificationAt < 60 * 1000) return;
    this.lastDiskFailureNotificationAt = now;
    const detail = error instanceof Error
      ? { errorName: error.name, errorMessage: error.message, stackTrace: error.stack }
      : { errorMessage: String(error) };
    console.error(`[ERROR] [LOCAL_LOG_STORAGE] ${operation} failed ${JSON.stringify(detail)}`);
  }

  reportDatabaseFailure(error, entry = {}) {
    if (process.env.NODE_ENV === 'test') return;

    const now = Date.now();
    if (now - this.lastDatabaseFailureNotificationAt < 60 * 1000) {
      this.suppressedDatabaseFailureCount += 1;
      return;
    }
    this.lastDatabaseFailureNotificationAt = now;

    const errorDetails = error instanceof Error
      ? { errorName: error.name, errorMessage: error.message }
      : { errorMessage: String(error) };
    const metadata = redactLogValue({
      operation: 'persist_critical_log',
      sourceLevel: entry.level || 'UNKNOWN',
      sourceCategory: entry.category || 'SYSTEM',
      ...errorDetails,
      ...(this.suppressedDatabaseFailureCount > 0
        ? { suppressedFailures: this.suppressedDatabaseFailureCount }
        : {}),
    });
    this.suppressedDatabaseFailureCount = 0;

    const diagnosticEntry = {
      id: `log-db-storage-${now}-${crypto.randomBytes(3).toString('hex')}`,
      timestamp: this.formatTimestamp(),
      level: 'ERROR',
      category: 'DATABASE_LOG_STORAGE',
      message: 'Failed to persist a critical application log to the database',
      metadata,
      correlationId: entry.correlationId || `corr-${now}`,
      userEmail: 'system@procucev.ai',
      ipAddress: '127.0.0.1 (Local Environment)',
    };
    this.writeToDisk(diagnosticEntry);
    console.error(`[ERROR] [DATABASE_LOG_STORAGE] ${diagnosticEntry.message} ${JSON.stringify(metadata)}`);
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
    } else if (meta && typeof meta.stackTrace === 'string') {
      stackTrace = meta.stackTrace;
      delete metadata.stackTrace;
    }

    const auditLevel = level === 'AUDIT';
    metadata = redactLogValue(metadata, 'metadata', new WeakSet(), auditLevel);
    const logEntry = {
      id,
      timestamp,
      level,
      category,
      message: redactLogText(message),
      metadata,
      correlationId: metadata.correlationId || metadata.requestId || `corr-${Date.now()}`,
      userEmail: auditLevel
        ? (metadata.userEmail || 'system@procucev.ai')
        : redactLogText(metadata.userEmail || 'system@procucev.ai'),
      ipAddress: metadata.ipAddress || '127.0.0.1 (Local Environment)',
      ...(stackTrace ? { stackTrace: redactLogText(stackTrace) } : {}),
    };

    return logEntry;
  }

  writeToDisk(logEntry) {
    if (!this.isLocalLoggingEnabled || !LoggerService.isLocalEnvironment()) return;

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
      this.writesSincePurge += 1;
      const now = Date.now();
      if (
        this.writesSincePurge >= this.purgeAfterWrites ||
        now - this.lastPurgeAt >= this.purgeCheckIntervalMs
      ) {
        this.writesSincePurge = 0;
        this.lastPurgeAt = now;
        this.purgeExpiredLogs();
      }
    } catch (error) {
      // Keep console logging available while making local persistence failures visible.
      this.reportDiskFailure('write log entry', error);
    }
  }

  log(level, message, meta = {}, category = 'SYSTEM') {
    const entry = this.createLogEntry(level, message, withRequestContext(meta), category);

    // Output to console in non-test environment so cloud dashboards (Render, Railway) stream logs live
    if (process.env.NODE_ENV !== 'test') {
      // Use entry.metadata/entry.stackTrace (already normalized by createLogEntry) rather than the
      // raw `meta` — a plain Error's message/stack are non-enumerable, so Object.keys(meta) on the
      // raw value is empty and JSON.stringify(meta) silently drops the actual error detail.
      // Audit entries keep the full actor identity in the restricted audit
      // record, but stdout is also forwarded to hosted log providers. Redact
      // that console projection so the provider stream does not expose PII.
      const consoleMetadata = redactLogValue(entry.metadata, 'metadata');
      const metaStr = consoleMetadata && Object.keys(consoleMetadata).length > 0
        ? ` ${JSON.stringify(consoleMetadata)}`
        : '';
      const stackStr = entry.stackTrace ? `\n${entry.stackTrace}` : '';
      if (level === 'ERROR') {
        console.error(`[${level}] [${category}] ${entry.message}${metaStr}${stackStr}`);
      } else if (level === 'WARN') {
        console.warn(`[${level}] [${category}] ${entry.message}${metaStr}`);
      } else {
        console.log(`[${level}] [${category}] ${entry.message}${metaStr}`);
      }
    }

    // Keep within buffer limit
    this.inMemoryLogs.unshift(entry);
    if (this.inMemoryLogs.length > this.maxBufferSize) {
      this.inMemoryLogs.pop();
    }

    // Persist to local disk
    this.writeToDisk(entry);

    return entry;
  }

  static isDbLoggingRateLimited() {
    const now = Date.now();
    LoggerService._dbLogTimestamps = (LoggerService._dbLogTimestamps || []).filter((t) => now - t < 1000);
    if (LoggerService._dbLogTimestamps.length >= 5) {
      return true;
    }
    LoggerService._dbLogTimestamps.push(now);
    return false;
  }

  static resetDbLoggingRateLimit() {
    LoggerService._dbLogTimestamps = [];
  }

  /**
   * Persist to database is decommissioned per migration 0028.
   * Logs are streamed to Cloudflare observability or persisted to local filesystem.
   * Returns a resolved promise for backward compatibility.
   */
  persistToDatabase(_entry) {
    return Promise.resolve();
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
    const maxAgeDays = options.maxAgeDays ?? this.retentionDays;
    const maxFileSizeBytes = options.maxSizeBytes ?? this.maxFileSizeBytes;
    const now = Date.now();
    const cutoffTime = now - maxAgeDays * 24 * 60 * 60 * 1000;

    const initialCount = this.inMemoryLogs.length;
    this.inMemoryLogs = this.inMemoryLogs.filter((l) => {
      const logTime = new Date(l.timestamp).getTime();
      return !isNaN(logTime) && logTime >= cutoffTime;
    });
    const purgedCount = initialCount - this.inMemoryLogs.length;

    // Prune expired entries and cap every local log file at the configured size.
    let diskFilesPurged = 0;
    if (this.isLocalLoggingEnabled && LoggerService.isLocalEnvironment() && fs.existsSync(this.logsDir)) {
      try {
        const files = fs.readdirSync(this.logsDir);
        files.forEach((file) => {
          const filePath = path.join(this.logsDir, file);
          try {
            if (!fs.statSync(filePath).isFile()) return;
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            const recentLines = lines.filter((line) => {
              try {
                const entry = JSON.parse(line);
                const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : NaN;
                return !Number.isFinite(timestamp) || timestamp >= cutoffTime;
              } catch {
                // Preserve unstructured lines; age cannot be established safely.
                return true;
              }
            });

            const retainedLines = [];
            let retainedBytes = 0;
            for (let index = recentLines.length - 1; index >= 0; index -= 1) {
              const line = recentLines[index];
              const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8');
              if (retainedBytes + lineBytes <= maxFileSizeBytes) {
                retainedLines.unshift(line);
                retainedBytes += lineBytes;
              }
            }

            const nextContent = retainedLines.length > 0 ? `${retainedLines.join('\n')}\n` : '';
            if (nextContent !== content) {
              fs.writeFileSync(filePath, nextContent, 'utf8');
              diskFilesPurged += 1;
            }
          } catch (error) {
            this.reportDiskFailure('purge log file', error);
          }
        });
      } catch (error) {
        this.reportDiskFailure('list log files for purge', error);
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
    if (this.isLocalLoggingEnabled && LoggerService.isLocalEnvironment() && fs.existsSync(this.logsDir)) {
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
