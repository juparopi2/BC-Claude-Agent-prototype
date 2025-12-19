/**
 * HTTP request/response logging middleware using pino-http
 *
 * Features:
 * - Automatic request/response logging with duration
 * - Request ID generation and propagation (X-Request-ID header)
 * - Dynamic log level based on response status code
 * - Automatic redaction of sensitive headers (authorization, cookie, x-api-key)
 * - Correlation with user session data
 *
 * Security Notes:
 * - Headers containing secrets are redacted: Authorization, Cookie, X-API-Key
 * - PII Compliance: userId and sessionId are logged for debugging purposes.
 *   In production environments subject to GDPR/CCPA, ensure logs are:
 *   1. Encrypted at rest
 *   2. Access-controlled
 *   3. Retained only as long as necessary
 *   4. Anonymized if exported for analytics
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
import type { IncomingMessage, ServerResponse } from 'http';

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

  // Custom request ID generator
  // Reuses existing X-Request-ID header or generates a new one
  genReqId: (req: IncomingMessage, res: ServerResponse) => {
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
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.statusCode >= 300) return 'info';
    return 'info';
  },

  // Custom success message format
  customSuccessMessage: (req: IncomingMessage, res: ServerResponse) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  // Custom error message format
  customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },

  // Customize request/response serialization
  serializers: {
    req: (req) => {
      const expressReq = req.raw as Express.Request;
      // Use type assertion for params since Express adds it dynamically
      const reqParams = 'params' in expressReq ? (expressReq as Express.Request & { params: Record<string, string> }).params : {};

      return {
        id: req.id,
        method: req.method,
        url: req.url,
        path: req.raw.url,
        query: req.raw.query,
        params: reqParams,
        // Redact sensitive headers (security: prevent secret leakage in logs)
        headers: {
          ...req.headers,
          authorization: req.headers.authorization ? '[REDACTED]' : undefined,
          cookie: req.headers.cookie ? '[REDACTED]' : undefined,
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : undefined,
        },
        // Include session info if available
        userId: expressReq.session?.microsoftOAuth?.userId,
        sessionId: expressReq.session?.id,
      };
    },
    res: (res) => ({
      statusCode: res.statusCode,
      headers: res.getHeaders ? res.getHeaders() : {},
    }),
  },

  // Don't log health check endpoints (reduce noise in logs)
  // Includes common Kubernetes probes and monitoring endpoints
  autoLogging: {
    ignore: (req: IncomingMessage) => {
      const healthEndpoints = ['/health', '/ping', '/ready', '/live', '/liveness', '/readiness'];
      return healthEndpoints.includes(req.url || '');
    },
  },
}) as RequestHandler;
