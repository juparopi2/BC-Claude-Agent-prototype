/**
 * Production-grade logger using Pino
 *
 * Features:
 * - JSON structured logging (production) / Pretty printing (development)
 * - Environment-based log levels (debug in dev, info in prod)
 * - Async/non-blocking architecture using worker threads
 * - Multiple transports (console, optional file logging)
 * - Standard serializers for errors, requests, responses
 * - Automatic redaction of sensitive data
 * - Child loggers for request context
 *
 * Performance:
 * - 5-10x faster than Winston
 * - 30,000+ logs/second throughput
 * - Non-blocking I/O (doesn't block Node.js event loop)
 *
 * Usage:
 * ```typescript
 * // Basic logging
 * logger.info({ userId: 123 }, 'User logged in');
 *
 * // Child logger with context
 * const serviceLogger = createChildLogger({ service: 'DirectAgentService' });
 * serviceLogger.info({ sessionId }, 'Processing message');
 *
 * // Error logging with stack traces
 * try {
 *   await operation();
 * } catch (err) {
 *   logger.error({ err }, 'Operation failed');
 * }
 * ```
 */

import pino from 'pino';
import { Request } from 'express';

// Environment-based configuration
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Transport configuration
const transport = pino.transport({
  targets: [
    // Console output (pretty in dev, JSON in production)
    {
      level: logLevel,
      target: isDevelopment ? 'pino-pretty' : 'pino/file',
      options: isDevelopment
        ? {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            singleLine: false,
            messageFormat: '{levelLabel} - {msg}',
          }
        : {
            destination: 1, // stdout
          },
    },
    // File output (production only, optional)
    ...(process.env.ENABLE_FILE_LOGGING === 'true'
      ? [
          {
            level: 'info',
            target: 'pino/file',
            options: {
              destination: process.env.LOG_FILE_PATH || './logs/app.log',
              mkdir: true,
            },
          },
          // Error-only file
          {
            level: 'error',
            target: 'pino/file',
            options: {
              destination: process.env.ERROR_LOG_FILE_PATH || './logs/error.log',
              mkdir: true,
            },
          },
        ]
      : []),
  ],
});

// Create base logger
export const logger = pino(
  {
    level: logLevel,

    // Standard serializers for common objects
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },

    // Base metadata included in every log
    base: {
      env: process.env.NODE_ENV,
      service: 'bc-claude-agent',
    },

    // ISO timestamp format
    timestamp: pino.stdTimeFunctions.isoTime,

    // Redact sensitive data automatically
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'token',
        'apiKey',
        'bcToken',
        'encryptedToken',
        'accessToken',
        'refreshToken',
        'clientSecret',
      ],
      remove: true,
    },
  },
  transport
);

/**
 * Create a child logger with additional context
 *
 * Use this for service-scoped or request-scoped logging.
 * Child loggers inherit configuration from parent and add context.
 *
 * @example
 * const serviceLogger = createChildLogger({ service: 'DirectAgentService' });
 * serviceLogger.info({ sessionId: '123' }, 'Processing message');
 */
export const createChildLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
};

/**
 * Create a request logger with correlation ID
 *
 * Automatically extracts request context (requestId, userId, sessionId)
 * for correlation across logs.
 *
 * @example
 * const reqLogger = createRequestLogger(req);
 * reqLogger.info('Processing request');
 */
export const createRequestLogger = (req: Request) => {
  return logger.child({
    requestId: req.headers['x-request-id'] || generateRequestId(),
    userId: (req as any).session?.userId,
    sessionId: (req as any).session?.id,
  });
};

/**
 * Generate unique request ID for correlation
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Export convenience methods for backward compatibility
export const { info, warn, error, debug, fatal, trace } = logger;
