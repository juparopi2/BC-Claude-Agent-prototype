/**
 * Connections Routes (PRD-100)
 *
 * REST API endpoints for managing external service connections.
 *
 * Endpoints:
 * - GET /api/connections           → list connections
 * - GET /api/connections/:id       → get single connection
 * - POST /api/connections          → create connection
 * - PATCH /api/connections/:id     → update connection
 * - DELETE /api/connections/:id    → disconnect/delete
 * - GET /api/connections/:id/scopes → list scopes
 *
 * @module routes/connections
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getConnectionService, ConnectionNotFoundError, ConnectionForbiddenError } from '@/domains/connections';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import {
  sendError,
  sendNotFound,
  sendForbidden,
} from '@/shared/utils/error-response';
import {
  validateSafe,
  createConnectionSchema,
  updateConnectionSchema,
  connectionIdParamSchema,
} from '@bc-agent/shared';

const logger = createChildLogger({ service: 'ConnectionsRoutes' });
const router = Router();

// ============================================================================
// Route helpers
// ============================================================================

/**
 * Parse and validate the :id path parameter as a UUID.
 * Returns the normalized connection ID or sends a 400 response and returns null.
 */
function parseConnectionId(
  req: Request,
  res: Response
): string | null {
  const paramResult = validateSafe(connectionIdParamSchema, req.params);
  if (!paramResult.success) {
    sendError(res, ErrorCode.VALIDATION_ERROR, paramResult.error.errors[0]?.message ?? 'Invalid connection ID');
    return null;
  }
  return paramResult.data.id.toUpperCase();
}

/**
 * Map domain errors to appropriate HTTP responses.
 * Returns true if the error was handled, false if it should propagate.
 */
function handleDomainError(error: unknown, res: Response): boolean {
  if (error instanceof ConnectionNotFoundError) {
    sendNotFound(res, ErrorCode.NOT_FOUND);
    return true;
  }
  if (error instanceof ConnectionForbiddenError) {
    sendForbidden(res, ErrorCode.FORBIDDEN);
    return true;
  }
  return false;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/connections
 * Returns all connections for the authenticated user.
 */
router.get(
  '/',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const service = getConnectionService();
      const result = await service.listConnections(userId);

      logger.info({ userId: userId.toUpperCase(), count: result.count }, 'Connections listed');
      res.json(result);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
        },
        'Failed to list connections'
      );
      next(error);
    }
  }
);

/**
 * GET /api/connections/:id
 * Returns a single connection by ID.
 */
router.get(
  '/:id',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;
      const service = getConnectionService();
      const connection = await service.getConnection(userId, connectionId);

      logger.info({ userId: userId.toUpperCase(), connectionId }, 'Connection retrieved');
      res.json(connection);
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to get connection'
      );
      next(error);
    }
  }
);

/**
 * POST /api/connections
 * Creates a new connection for the authenticated user.
 */
router.post(
  '/',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const bodyResult = validateSafe(createConnectionSchema, req.body);
      if (!bodyResult.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        );
        return;
      }

      const userId = req.userId!;
      const service = getConnectionService();
      const connection = await service.createConnection(userId, bodyResult.data);

      logger.info(
        { userId: userId.toUpperCase(), connectionId: connection.id, provider: connection.provider },
        'Connection created'
      );
      res.status(201).json(connection);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
        },
        'Failed to create connection'
      );
      next(error);
    }
  }
);

/**
 * PATCH /api/connections/:id
 * Updates mutable fields on a connection (displayName, status).
 */
router.patch(
  '/:id',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const bodyResult = validateSafe(updateConnectionSchema, req.body);
      if (!bodyResult.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        );
        return;
      }

      const userId = req.userId!;
      const service = getConnectionService();
      await service.updateConnection(userId, connectionId, bodyResult.data);

      logger.info({ userId: userId.toUpperCase(), connectionId }, 'Connection updated');
      res.status(204).end();
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to update connection'
      );
      next(error);
    }
  }
);

/**
 * DELETE /api/connections/:id
 * Deletes (disconnects) a connection and all its scopes.
 */
router.delete(
  '/:id',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;
      const service = getConnectionService();
      await service.deleteConnection(userId, connectionId);

      logger.info({ userId: userId.toUpperCase(), connectionId }, 'Connection deleted');
      res.status(204).end();
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to delete connection'
      );
      next(error);
    }
  }
);

/**
 * GET /api/connections/:id/scopes
 * Returns all sync scopes for a connection.
 */
router.get(
  '/:id/scopes',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;
      const service = getConnectionService();
      const scopes = await service.listScopes(userId, connectionId);

      logger.info(
        { userId: userId.toUpperCase(), connectionId, scopeCount: scopes.length },
        'Connection scopes listed'
      );
      res.json({ scopes, count: scopes.length });
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to list connection scopes'
      );
      next(error);
    }
  }
);

export default router;
