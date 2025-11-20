/**
 * Lightweight client-side logger for Next.js frontend
 *
 * Features:
 * - Minimal bundle size (~2KB, no external dependencies)
 * - Batch buffering (sends logs every 10s to reduce HTTP requests)
 * - Immediate flush on errors (don't lose critical logs)
 * - Automatic flush on page unload
 * - Console logging in development only
 * - Silent in production (only sends to backend)
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/lib/logger';
 *
 * logger.info('Component mounted', { componentName: 'ChatInterface' });
 * logger.error('Failed to fetch data', error, { userId: 123 });
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  userAgent?: string;
  url?: string;
}

class ClientLogger {
  private apiUrl: string;
  private isDevelopment: boolean;
  private buffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private maxBufferSize: number = 50; // Flush if buffer exceeds this size

  constructor() {
    this.apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
    this.isDevelopment = process.env.NODE_ENV === 'development';

    // Only set up batching in browser environment
    if (typeof window !== 'undefined') {
      // Batch logs and send every 10 seconds
      this.flushInterval = setInterval(() => this.flush(), 10000);

      // Send logs before page unload (critical for capturing errors before navigation)
      window.addEventListener('beforeunload', () => this.flush());

      // Also flush on visibility change (user switching tabs)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.flush();
        }
      });
    }
  }

  /**
   * Create a log entry with metadata
   */
  private createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    };
  }

  /**
   * Flush buffered logs to backend
   *
   * Sends all pending logs to the backend /api/logs endpoint.
   * Uses keepalive: true to ensure logs are sent even if page is closing.
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const logs = [...this.buffer];
    this.buffer = [];

    try {
      // Send logs to backend (don't await response to avoid blocking)
      await fetch(`${this.apiUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs }),
        // Keep connection alive during page unload
        keepalive: true,
      });
    } catch (error) {
      // Failed to send logs - re-add error logs to buffer (don't lose them)
      if (logs.some((log) => log.level === 'error')) {
        this.buffer.unshift(...logs.filter((log) => log.level === 'error'));
      }

      // Log to console as fallback in development
      if (this.isDevelopment) {
        console.error('[Logger] Failed to send logs to backend:', error);
      }
    }
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry = this.createEntry(level, message, context);

    // Always log to console in development
    if (this.isDevelopment) {
      const consoleMethod = level === 'debug' ? console.debug : console[level];
      const contextStr = context ? ` ${JSON.stringify(context)}` : '';
      consoleMethod(`[${level.toUpperCase()}] ${message}${contextStr}`);
    }

    // Send info+ logs to backend in production, all logs in development
    if (!this.isDevelopment || level === 'error' || level === 'warn') {
      this.buffer.push(entry);

      // Flush immediately for errors (don't wait for batch)
      if (level === 'error') {
        this.flush();
      }

      // Flush if buffer is getting too large
      if (this.buffer.length >= this.maxBufferSize) {
        this.flush();
      }
    }
  }

  /**
   * Log debug message (development only)
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * Log error message
   *
   * Automatically serializes Error objects with stack traces.
   *
   * @example
   * try {
   *   await fetchData();
   * } catch (error) {
   *   logger.error('Failed to fetch data', error);
   * }
   */
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const errorContext = {
      ...context,
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
    };
    this.log('error', message, errorContext);
  }

  /**
   * Manually flush logs (useful for testing or critical operations)
   */
  async forceFlush(): Promise<void> {
    await this.flush();
  }

  /**
   * Clean up resources (call on app unmount if needed)
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // Final flush
    this.flush();
  }
}

// Export singleton instance
export const logger = new ClientLogger();
