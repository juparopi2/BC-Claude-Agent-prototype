/**
 * Logger utility for standardized logging across the application
 * Wraps console methods with timestamps and log levels
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      ...(data !== undefined && { data }),
    };

    return JSON.stringify(logEntry);
  }

  info(message: string, data?: unknown): void {
    console.info(this.formatMessage('info', message, data));
  }

  warn(message: string, data?: unknown): void {
    console.warn(this.formatMessage('warn', message, data));
  }

  error(message: string, data?: unknown): void {
    console.error(this.formatMessage('error', message, data));
  }

  debug(message: string, data?: unknown): void {
    console.debug(this.formatMessage('debug', message, data));
  }
}

// Export singleton instance
export const logger = new Logger();

// Export individual methods for convenience
export const { info, warn, error, debug } = logger;
