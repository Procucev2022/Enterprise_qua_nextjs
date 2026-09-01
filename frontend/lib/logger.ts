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

export class ClientLogger {
  public buffer: FrontendLogEntry[] = [];
  public maxBufferSize: number = 200;
  public isRemoteSyncEnabled: boolean = true;

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
    const id = `flog-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const url = typeof window !== 'undefined' && window.location ? window.location.pathname : '/app';

    const stackTrace = metadata.error instanceof Error ? metadata.error.stack : undefined;
    const userEmail = metadata.userEmail || 'buyer@tatasteel.com';

    const entry: FrontendLogEntry = {
      id,
      timestamp,
      level,
      category,
      message,
      metadata,
      userEmail,
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
        fetch('/api/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            level,
            message,
            category,
            metadata: { ...metadata, url, id },
          }),
        }).catch(() => {});
      } catch {
        // Fallback
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
}

export const logger = new ClientLogger();
export default logger;
