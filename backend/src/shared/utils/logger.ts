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
import '@/types/session.types';
import {
  getApplicationInsightsClient,
  isApplicationInsightsEnabled,
} from '@/infrastructure/telemetry/ApplicationInsightsSetup';

// Environment-based configuration
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Service filtering for diagnostics (LOG_SERVICES=Service1,Service2,...)
const allowedServices = process.env.LOG_SERVICES?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

// Transport configuration
const targets = [];

// Console output (pretty in dev, JSON in production)
if (isDevelopment) {
  targets.push({
    level: logLevel,
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,env',
      singleLine: false,
      messageFormat: '[{service}] {msg}',
    },
  });
} else {
  // Production: JSON to stdout
  targets.push({
    level: logLevel,
    target: 'pino/file',
    options: {
      destination: 1, // stdout file descriptor
    },
  });
}

// File output (optional, for production persistence)
if (process.env.ENABLE_FILE_LOGGING === 'true') {
  targets.push({
    level: 'info',
    target: 'pino/file',
    options: {
      destination: process.env.LOG_FILE_PATH || './logs/app.log',
      mkdir: true,
    },
  });

  // Error-only file
  targets.push({
    level: 'error',
    target: 'pino/file',
    options: {
      destination: process.env.ERROR_LOG_FILE_PATH || './logs/error.log',
      mkdir: true,
    },
  });
}

const transport = pino.transport({ targets });

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

// Map Pino levels to App Insights severity (SeverityLevel enum values)
const SEVERITY_MAP: Record<string, number> = {
  trace: 0, // Verbose
  debug: 0, // Verbose
  info: 1, // Information
  warn: 2, // Warning
  error: 3, // Error
  fatal: 4, // Critical
};

/**
 * Send log entry to Application Insights as a trace
 */
function trackToAppInsights(
  level: string,
  context: Record<string, unknown>,
  msg: string
): void {
  if (!msg) return; // Skip empty messages

  const client = getApplicationInsightsClient();
  if (!client) return;

  const properties: Record<string, string> = {};

  // Extract custom dimensions for filtering/searching in App Insights
  if (context.userId) properties.userId = String(context.userId);
  if (context.sessionId) properties.sessionId = String(context.sessionId);
  if (context.service) properties.service = String(context.service);
  if (context.jobId) properties.jobId = String(context.jobId);
  if (context.fileId) properties.fileId = String(context.fileId);
  if (context.correlationId)
    properties.correlationId = String(context.correlationId);
  if (context.requestId) properties.requestId = String(context.requestId);

  client.trackTrace({
    message: msg,
    severity: SEVERITY_MAP[level] ?? 1,
    properties,
  });
}

/**
 * Wrap a Pino logger to also send logs to Application Insights
 *
 * Uses a Proxy to intercept log method calls without modifying Pino's behavior.
 */
function wrapLoggerWithAppInsights(
  pinoLogger: pino.Logger,
  context: Record<string, unknown>
): pino.Logger {
  if (!isApplicationInsightsEnabled()) {
    return pinoLogger;
  }

  const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

  return new Proxy(pinoLogger, {
    get(target, prop) {
      if (levels.includes(prop as (typeof levels)[number])) {
        return (...args: unknown[]) => {
          // Call original Pino logger first
          (target[prop as keyof typeof target] as (...a: unknown[]) => void)(
            ...args
          );

          // Extract message (last string arg) and merge context
          const msg =
            typeof args[args.length - 1] === 'string'
              ? (args[args.length - 1] as string)
              : '';
          const logContext =
            typeof args[0] === 'object' && args[0] !== null
              ? { ...context, ...(args[0] as Record<string, unknown>) }
              : context;

          // Send to App Insights
          trackToAppInsights(prop as string, logContext, msg);
        };
      }
      return target[prop as keyof typeof target];
    },
  }) as pino.Logger;
}

/**
 * Create a child logger with additional context
 *
 * Use this for service-scoped or request-scoped logging.
 * Child loggers inherit configuration from parent and add context.
 *
 * Supports LOG_SERVICES environment variable for filtering:
 * - When LOG_SERVICES is set, only logs from listed services are shown
 * - Example: LOG_SERVICES=AgentOrchestrator,PersistenceCoordinator
 *
 * When Application Insights is enabled, logs are also sent as traces
 * with custom dimensions for filtering.
 *
 * @example
 * const serviceLogger = createChildLogger({ service: 'DirectAgentService' });
 * serviceLogger.info({ sessionId: '123' }, 'Processing message');
 */
export const createChildLogger = (context: Record<string, unknown>) => {
  const serviceName = context.service as string | undefined;

  // If LOG_SERVICES is set and service is not in the list, return silent logger
  if (allowedServices.length > 0 && serviceName && !allowedServices.includes(serviceName)) {
    return pino({ level: 'silent' });
  }

  const childLogger = logger.child(context);
  return wrapLoggerWithAppInsights(childLogger, context);
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
    userId: req.session?.microsoftOAuth?.userId,
    sessionId: req.session?.id,
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
