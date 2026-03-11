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
 * - DELETE /api/connections/:id/scopes/:scopeId → delete scope (cascade files)
 * - POST /api/connections/:id/scopes/batch   → batch add/remove scopes
 *
 * @module routes/connections
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getConnectionService, ConnectionNotFoundError, ConnectionForbiddenError, ScopeCurrentlySyncingError } from '@/domains/connections';
import { getConnectionRepository } from '@/domains/connections';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import {
  sendError,
  sendNotFound,
  sendForbidden,
  sendConflict,
  sendUnauthorized,
} from '@/shared/utils/error-response';
import {
  validateSafe,
  createConnectionSchema,
  updateConnectionSchema,
  connectionIdParamSchema,
  createScopesSchema,
  browseFolderQuerySchema,
  batchScopesSchema,
  isFileSyncSupported,
} from '@bc-agent/shared';
import type { FolderListResult } from '@bc-agent/shared';
import { getOneDriveService } from '@/services/connectors/onedrive';
import { getInitialSyncService } from '@/services/sync/InitialSyncService';

const logger = createChildLogger({ service: 'ConnectionsRoutes' });
const router = Router();

// ============================================================================
// Route helpers
// ============================================================================

/**
 * Enrich browse results with `isSupported` flag (PRD-106).
 * Folders are always marked supported; files check against ALLOWED_MIME_TYPES.
 */
function enrichBrowseItems(result: FolderListResult): FolderListResult {
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      isSupported: item.isFolder ? true : isFileSyncSupported(item.mimeType),
    })),
  };
}

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
 * Detect connector-layer auth errors (expired token or Graph API 401).
 * Uses duck-typing to avoid cross-module instanceof issues.
 */
function isConnectorAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ConnectionTokenExpiredError') return true;
  if (error.name === 'GraphApiError' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 401) return true;
  return false;
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
  if (error instanceof ScopeCurrentlySyncingError) {
    sendConflict(res, ErrorCode.CONFLICT);
    return true;
  }
  if (isConnectorAuthError(error)) {
    sendUnauthorized(res, ErrorCode.INVALID_TOKEN);
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
      const scopes = await service.listScopesWithStats(userId, connectionId);

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

/**
 * DELETE /api/connections/:id/scopes/:scopeId
 * Remove a scope and cascade-delete its files (PRD-105).
 */
router.delete(
  '/:id/scopes/:scopeId',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const scopeId = req.params.scopeId?.toUpperCase();
      if (!scopeId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid scope ID');
        return;
      }

      const userId = req.userId!;
      const service = getConnectionService();
      await service.deleteScope(userId, connectionId, scopeId);

      logger.info({ userId: userId.toUpperCase(), connectionId, scopeId }, 'Scope deleted');
      res.status(204).end();
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
          scopeId: req.params.scopeId,
        },
        'Failed to delete scope'
      );
      next(error);
    }
  }
);

/**
 * GET /api/connections/:id/browse
 * Browse the root folder of a OneDrive connection.
 */
router.get(
  '/:id/browse',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;

      // Verify ownership
      const service = getConnectionService();
      await service.getConnection(userId, connectionId);

      const queryResult = validateSafe(browseFolderQuerySchema, req.query);
      if (!queryResult.success) {
        sendError(res, ErrorCode.VALIDATION_ERROR, queryResult.error.errors[0]?.message ?? 'Invalid query parameters');
        return;
      }

      const { pageToken } = queryResult.data;
      const result = await getOneDriveService().listFolder(connectionId, undefined, pageToken);

      logger.info({ userId: userId.toUpperCase(), connectionId }, 'Root folder browsed');
      res.json(enrichBrowseItems(result));
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to browse root folder'
      );
      next(error);
    }
  }
);

/**
 * GET /api/connections/:id/browse/:folderId
 * Browse a specific folder of a OneDrive connection.
 */
router.get(
  '/:id/browse/:folderId',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const folderId = req.params.folderId;
      const userId = req.userId!;

      // Verify ownership
      const service = getConnectionService();
      await service.getConnection(userId, connectionId);

      const queryResult = validateSafe(browseFolderQuerySchema, req.query);
      if (!queryResult.success) {
        sendError(res, ErrorCode.VALIDATION_ERROR, queryResult.error.errors[0]?.message ?? 'Invalid query parameters');
        return;
      }

      const { pageToken } = queryResult.data;
      const result = await getOneDriveService().listFolder(connectionId, folderId, pageToken);

      logger.info({ userId: userId.toUpperCase(), connectionId, folderId }, 'Folder browsed');
      res.json(enrichBrowseItems(result));
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
          folderId: req.params.folderId,
        },
        'Failed to browse folder'
      );
      next(error);
    }
  }
);

/**
 * POST /api/connections/:id/scopes
 * Create sync scopes (selected folders) for a connection.
 */
router.post(
  '/:id/scopes',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;

      // Verify ownership
      const service = getConnectionService();
      await service.getConnection(userId, connectionId);

      const bodyResult = validateSafe(createScopesSchema, req.body);
      if (!bodyResult.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        );
        return;
      }

      const repo = getConnectionRepository();
      const createdScopes = await Promise.all(
        bodyResult.data.scopes.map(async (scope) => {
          const scopeId = await repo.createScope(connectionId, {
            scopeType: scope.scopeType,
            scopeResourceId: scope.scopeResourceId,
            scopeDisplayName: scope.scopeDisplayName,
            scopePath: scope.scopePath,
          });
          return repo.findScopeById(scopeId);
        })
      );

      logger.info(
        { userId: userId.toUpperCase(), connectionId, scopeCount: createdScopes.length },
        'Connection scopes created'
      );
      res.status(201).json({ scopes: createdScopes });
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to create connection scopes'
      );
      next(error);
    }
  }
);

/**
 * POST /api/connections/:id/scopes/batch
 * Batch add/remove scopes with cascading cleanup (PRD-105).
 */
router.post(
  '/:id/scopes/batch',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const bodyResult = validateSafe(batchScopesSchema, req.body);
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
      const result = await service.batchUpdateScopes(userId, connectionId, bodyResult.data);

      logger.info(
        { userId: userId.toUpperCase(), connectionId, addedCount: result.added.length, removedCount: result.removed.length },
        'Batch scope update complete'
      );
      res.json(result);
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to batch update scopes'
      );
      next(error);
    }
  }
);

/**
 * POST /api/connections/:id/scopes/:scopeId/sync
 * Trigger initial sync for a specific scope.
 */
router.post(
  '/:id/scopes/:scopeId/sync',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const scopeId = req.params.scopeId?.toUpperCase();
      if (!scopeId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid scope ID');
        return;
      }

      const userId = req.userId!;

      // Verify connection ownership
      const service = getConnectionService();
      await service.getConnection(userId, connectionId);

      // Verify scope belongs to this connection
      const repo = getConnectionRepository();
      const scope = await repo.findScopeById(scopeId);
      if (!scope) {
        sendNotFound(res, ErrorCode.NOT_FOUND);
        return;
      }
      if (scope.connection_id !== connectionId) {
        sendForbidden(res, ErrorCode.FORBIDDEN);
        return;
      }

      // PRD-108: Use delta sync if scope has a cursor, otherwise initial sync
      if (scope.last_sync_cursor) {
        import('@/services/sync/DeltaSyncService').then(({ getDeltaSyncService }) => {
          getDeltaSyncService().syncDelta(connectionId, scopeId, userId, 'manual')
            .catch((err) => {
              const errorInfo = err instanceof Error
                ? { message: err.message, name: err.name }
                : { value: String(err) };
              logger.error({ error: errorInfo, connectionId, scopeId }, 'Delta sync failed');
            });
        }).catch(() => {
          // Fallback to initial sync if dynamic import fails
          getInitialSyncService().syncScope(connectionId, scopeId, userId);
        });
      } else {
        getInitialSyncService().syncScope(connectionId, scopeId, userId);
      }

      logger.info(
        { userId: userId.toUpperCase(), connectionId, scopeId },
        'Sync triggered'
      );
      res.status(202).json({ status: 'started' });
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
          scopeId: req.params.scopeId,
        },
        'Failed to trigger initial sync'
      );
      next(error);
    }
  }
);

/**
 * GET /api/connections/:id/sync-status
 * Get sync status for all scopes of a connection.
 */
router.get(
  '/:id/sync-status',
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
        'Sync status retrieved'
      );
      res.json({ scopes });
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to get sync status'
      );
      next(error);
    }
  }
);

export default router;
