/**
 * Enterprise Structured Frontend Logger
 * Provides persistent in-memory buffering, formatted console debugging, and API stream syncing.
 */

import { authClient } from './authClient';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'AUDIT';

export interface FrontendLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  metadata?: Record<string, any>;
  userEmail?: string;
  url?: string;
  stackTrace?: string;
}

let logEntrySequence = 0;

/**
 * Identifier for one log entry. Uses the platform's cryptographic UUID when the runtime provides it. Otherwise it
 * falls back to a per-session sequence number, which is unique within this page session and is never random.
 */
export function nextLogEntryId(now: number): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `flog-${cryptoApi.randomUUID()}`;
  }
  logEntrySequence += 1;
  return `flog-${now}-${logEntrySequence}`;
}

export class ClientLogger {
  public buffer: FrontendLogEntry[] = [];
  public maxBufferSize: number = 200;
  public isRemoteSyncEnabled: boolean = true;
  private lastRemoteSyncFailureAt: number = 0;
  private suppressedRemoteSyncFailures: number = 0;

  constructor(maxBufferSize: number = 200) {
    this.maxBufferSize = maxBufferSize;
  }

  private formatTimestamp(date: Date = new Date()): string {
    return date.toISOString().replace('T', ' ').substring(0, 23) + ' UTC';
  }

  public log(
    level: LogLevel,
    message: string,
    metadata: Record<string, any> = {},
    category: string = 'UI_ACTION'
  ): FrontendLogEntry {
    const timestamp = this.formatTimestamp();
    const id = nextLogEntryId(Date.now());
    const url = typeof window !== 'undefined' && window.location ? window.location.pathname : '/app';

    const stackTrace = metadata.error instanceof Error ? metadata.error.stack : undefined;
    const identifiedUserEmail = typeof metadata.userEmail === 'string' ? metadata.userEmail.trim() : undefined;
    const safeMetadata = { ...metadata };
    delete safeMetadata.userEmail;

    const entry: FrontendLogEntry = {
      id,
      timestamp,
      level,
      category,
      message,
      metadata: safeMetadata,
      ...(identifiedUserEmail ? { userEmail: identifiedUserEmail } : {}),
      url,
      stackTrace,
    };

    this.buffer.unshift(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.pop();
    }

    // Formatted Console output in non-test mode
    if (process.env.NODE_ENV !== 'test') {
      const prefix = `[${timestamp}] [${level}] [${category}]`;
      if (level === 'ERROR') {
        console.error(prefix, message, metadata);
      } else if (level === 'WARN') {
        console.warn(prefix, message, metadata);
      } else {
        console.log(prefix, message, metadata);
      }
    }

    // Asynchronous non-blocking post to backend logs endpoint
    if (this.isRemoteSyncEnabled && typeof fetch === 'function') {
      try {
        const token = authClient.getToken();
        const remoteMetadata: Record<string, unknown> = { ...safeMetadata, url, id };
        if (metadata.error instanceof Error) {
          delete remoteMetadata.error;
          remoteMetadata.errorName = metadata.error.name;
          remoteMetadata.errorMessage = metadata.error.message;
        }
        const endpoint = token ? '/api/logs' : '/api/logs/client-error';
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        body: JSON.stringify({
            level,
            message,
            category,
            metadata: remoteMetadata,
            ...(stackTrace ? { stackTrace } : {}),
          }),
        })
          .then((response) => {
            if (!response.ok) this.recordRemoteSyncFailure({ status: response.status });
          })
          .catch((error: unknown) => {
            this.recordRemoteSyncFailure({
              errorName: error instanceof Error ? error.name : 'UnknownError',
            });
          });
      } catch (error: unknown) {
        this.recordRemoteSyncFailure({
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }

    return entry;
  }

  public info(message: string, metadata: Record<string, any> = {}, category: string = 'UI_ACTION'): FrontendLogEntry {
    return this.log('INFO', message, metadata, category);
  }

  public warn(message: string, metadata: Record<string, any> = {}, category: string = 'UI_ACTION'): FrontendLogEntry {
    return this.log('WARN', message, metadata, category);
  }

  public error(message: string, metadata: Record<string, any> = {}, category: string = 'UI_ACTION'): FrontendLogEntry {
    return this.log('ERROR', message, metadata, category);
  }

  public debug(message: string, metadata: Record<string, any> = {}, category: string = 'UI_ACTION'): FrontendLogEntry {
    return this.log('DEBUG', message, metadata, category);
  }

  public audit(action: string, userEmail: string, metadata: Record<string, any> = {}): FrontendLogEntry {
    return this.log('AUDIT', action, { ...metadata, userEmail }, 'AUDIT_TRAIL');
  }

  public getLogs(filter?: { level?: LogLevel; category?: string; search?: string }): FrontendLogEntry[] {
    let result = [...this.buffer];
    if (filter?.level) {
      result = result.filter((l) => l.level === filter.level);
    }
    if (filter?.category) {
      const cat = filter.category.toUpperCase();
      result = result.filter((l) => l.category.toUpperCase().includes(cat));
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter((l) => l.message.toLowerCase().includes(q) || JSON.stringify(l.metadata).toLowerCase().includes(q));
    }
    return result;
  }

  public clearLogs(): void {
    this.buffer = [];
  }

  private recordRemoteSyncFailure(metadata: Record<string, number | string>): void {
    const now = Date.now();
    if (now - this.lastRemoteSyncFailureAt < 60_000) {
      this.suppressedRemoteSyncFailures += 1;
      return;
    }

    const entryMetadata = {
      ...metadata,
      ...(this.suppressedRemoteSyncFailures > 0
        ? { suppressedRemoteSyncFailures: this.suppressedRemoteSyncFailures }
        : {}),
    };
    this.suppressedRemoteSyncFailures = 0;
    this.lastRemoteSyncFailureAt = now;

    const entry: FrontendLogEntry = {
      id: nextLogEntryId(now),
      timestamp: this.formatTimestamp(),
      level: 'ERROR',
      category: 'LOG_SYNC',
      message: 'Failed to persist frontend log to the backend',
      metadata: entryMetadata,
      url: typeof window !== 'undefined' && window.location ? window.location.pathname : '/app',
    };
    this.buffer.unshift(entry);
    if (this.buffer.length > this.maxBufferSize) this.buffer.pop();

    if (process.env.NODE_ENV !== 'test') {
      console.error(`[${entry.timestamp}] [ERROR] [LOG_SYNC] ${entry.message}`, entryMetadata);
    }
  }
}

export const logger = new ClientLogger();
export default logger;
