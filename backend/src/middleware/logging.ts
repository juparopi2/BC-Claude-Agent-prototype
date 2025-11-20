/**
 * HTTP request/response logging middleware using pino-http
 *
 * Features:
 * - Automatic request/response logging with duration
 * - Request ID generation and propagation (X-Request-ID header)
 * - Dynamic log level based on response status code
 * - Automatic redaction of sensitive headers (authorization, cookie)
 * - Correlation with user session data
 *
 * Usage:
 * ```typescript
 * import { httpLogger } from './middleware/logging';
 *
 * app.use(httpLogger);
 *
 * // Access request logger in routes
 * app.get('/api/data', (req, res) => {
 *   req.log.info('Fetching data');
 *   res.json({ data: [] });
 * });
 * ```
 */

import pinoHttp from 'pino-http';
import { logger } from '../utils/logger';
import { RequestHandler } from 'express';

/**
 * HTTP request/response logging middleware
 *
 * Automatically logs:
 * - Request method, URL, headers, query params
 * - Response status code, duration
 * - Errors with full stack traces
 */
export const httpLogger: RequestHandler = pinoHttp({
  logger,

  // Automatically log request completion
  autoLogging: true,

  // Custom request ID generator
  // Reuses existing X-Request-ID header or generates a new one
  genReqId: (req, res) => {
    const existingId = req.headers['x-request-id'];
    if (existingId && typeof existingId === 'string') {
      return existingId;
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    res.setHeader('X-Request-ID', id);
    return id;
  },

  // Customize log level based on status code
  // Errors (5xx) = error, Client errors (4xx) = warn, Success = info
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.statusCode >= 300) return 'info';
    return 'info';
  },

  // Custom success message format
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  // Custom error message format
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },

  // Customize request/response serialization
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      path: req.raw.url,
      query: req.raw.query,
      params: (req.raw as any).params,
      // Redact sensitive headers
      headers: {
        ...req.headers,
        authorization: req.headers.authorization ? '[REDACTED]' : undefined,
        cookie: req.headers.cookie ? '[REDACTED]' : undefined,
      },
      // Include session info if available
      userId: (req.raw as any).session?.userId,
      sessionId: (req.raw as any).session?.id,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: res.getHeaders ? res.getHeaders() : {},
    }),
  },

  // Don't log health check endpoints (reduce noise)
  autoLogging: {
    ignore: (req) => {
      return req.url === '/health' || req.url === '/ping';
    },
  } as any,
}) as RequestHandler;
