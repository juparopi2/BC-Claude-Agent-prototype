/**
 * Mock Pino Factory for Unit Tests
 *
 * Provides utilities to test Pino logger configuration and behavior
 * without relying on actual console output or file transports.
 *
 * IMPORTANT: This factory uses official Pino types to ensure
 * compatibility with library updates.
 *
 * @example
 * ```typescript
 * const { testLogger, logs, clearLogs } = createTestLogger();
 *
 * testLogger.info({ userId: '123' }, 'User logged in');
 *
 * expect(logs).toHaveLength(1);
 * expect(logs[0].msg).toBe('User logged in');
 * expect(logs[0].userId).toBe('123');
 * ```
 *
 * @module __tests__/helpers/mockPinoFactory
 */

import pino, { Logger, Level, LoggerOptions } from 'pino';
import { Writable } from 'stream';

/**
 * Captured log entry type - uses generic Record with required Pino fields.
 * This avoids duplicating Pino's internal types.
 */
export type CapturedLog = Record<string, unknown> & {
  level: number;
  msg: string;
  time: string | number;
};

/**
 * Configuration options for test logger.
 * Uses official Pino Level type.
 */
export interface TestLoggerConfig {
  /** Log level (default: 'trace' to capture all) - uses Pino Level type */
  level?: Level;
  /** Base metadata to include in all logs */
  base?: Record<string, unknown>;
}

/**
 * Result of createTestLogger factory
 */
export interface TestLoggerResult {
  /** The Pino logger instance - official Pino Logger type */
  testLogger: Logger;
  /** Array of captured log entries */
  logs: CapturedLog[];
  /** Clears all captured logs */
  clearLogs: () => void;
  /** Gets logs at a specific level - uses official Pino Level type */
  getLogsByLevel: (level: Level) => CapturedLog[];
  /** Gets the last captured log */
  getLastLog: () => CapturedLog | undefined;
  /** Checks if any log contains a specific message */
  hasLogWithMessage: (message: string) => boolean;
  /** Checks if any log contains specific data */
  hasLogWithData: (key: string, value: unknown) => boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<TestLoggerConfig> = {
  level: 'trace',
  base: {
    env: 'test',
    service: 'test-service',
  },
};

/**
 * Creates a test Pino logger that captures logs in memory
 *
 * @param config - Optional configuration
 * @returns Test logger with captured logs and helper methods
 */
export function createTestLogger(config: TestLoggerConfig = {}): TestLoggerResult {
  const finalConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    base: { ...DEFAULT_CONFIG.base, ...config.base },
  };

  const logs: CapturedLog[] = [];

  // Create writable stream that captures logs
  const stream = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      try {
        const logEntry = JSON.parse(chunk.toString()) as CapturedLog;
        logs.push(logEntry);
        callback();
      } catch (err) {
        // Handle pretty-printed output (non-JSON)
        callback(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });

  // Create Pino logger with the capturing stream
  const loggerOptions: LoggerOptions = {
    level: finalConfig.level,
    base: finalConfig.base,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  const testLogger = pino(loggerOptions, stream);

  // Helper methods using official pino.levels.values
  const clearLogs = () => {
    logs.length = 0;
  };

  const getLogsByLevel = (level: Level): CapturedLog[] => {
    // Use official Pino level values
    const levelNum = pino.levels.values[level];
    return logs.filter(log => log.level === levelNum);
  };

  const getLastLog = (): CapturedLog | undefined => {
    return logs[logs.length - 1];
  };

  const hasLogWithMessage = (message: string): boolean => {
    return logs.some(log => log.msg === message || log.msg?.includes(message));
  };

  const hasLogWithData = (key: string, value: unknown): boolean => {
    return logs.some(log => log[key] === value);
  };

  return {
    testLogger,
    logs,
    clearLogs,
    getLogsByLevel,
    getLastLog,
    hasLogWithMessage,
    hasLogWithData,
  };
}

/**
 * Re-export Pino types for convenience in tests
 */
export type { Logger, Level, LoggerOptions } from 'pino';
