/**
 * Log ingestion endpoint for frontend client logs
 *
 * Receives batched logs from the frontend and logs them server-side
 * with proper formatting and context.
 *
 * Endpoint: POST /api/logs
 *
 * Request Body:
 * {
 *   "logs": [
 *     {
 *       "timestamp": "2025-01-20T12:00:00.000Z",
 *       "level": "error",
 *       "message": "Failed to fetch data",
 *       "context": { "userId": 123, "error": {...} },
 *       "userAgent": "Mozilla/5.0...",
 *       "url": "https://app.example.com/chat"
 *     }
 *   ]
 * }
 *
 * Response: 204 No Content (success) or 400 Bad Request (validation error)
 */

import { Router, Request, Response } from 'express';
import { createChildLogger } from '@/shared/utils/logger';
import { z } from 'zod';
import { ErrorCode } from '@/shared/constants/errors';
import { sendError } from '@/shared/utils/error-response';

const logger = createChildLogger({ service: 'LogRoutes' });
const router = Router();

// Validation schema for log entries
const LogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
  userAgent: z.string().optional(),
  url: z.string().optional(),
});

const ClientLogsSchema = z.object({
  logs: z.array(LogEntrySchema),
});

/**
 * POST /api/logs
 *
 * Ingest client-side logs and persist them server-side.
 * Logs are batched by the client and sent every 10 seconds or on error.
 */
router.post('/logs', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const { logs } = ClientLogsSchema.parse(req.body);

    // Create child logger with "client" source
    const clientLogger = logger.child({ source: 'client' });

    // Log each entry with appropriate level
    logs.forEach((log) => {
      // Build log context
      const logContext = {
        ...log.context,
        clientTimestamp: log.timestamp,
        userAgent: log.userAgent,
        clientUrl: log.url,
        // Include request context if available
        requestId: req.id as string | undefined,
        userId: req.session?.microsoftOAuth?.userId,
      };

      // Log with appropriate level
      switch (log.level) {
        case 'debug':
          clientLogger.debug(logContext, log.message);
          break;
        case 'info':
          clientLogger.info(logContext, log.message);
          break;
        case 'warn':
          clientLogger.warn(logContext, log.message);
          break;
        case 'error':
          clientLogger.error(logContext, log.message);
          break;
      }
    });

    // Return 204 No Content (successful, no response body needed)
    res.status(204).send();
  } catch (error) {
    // Log validation errors
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.errors }, 'Invalid client logs received');
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid log format');
    } else {
      logger.error({ err: error }, 'Failed to process client logs');
      sendError(res, ErrorCode.INTERNAL_ERROR);
    }
  }
});

export default router;
