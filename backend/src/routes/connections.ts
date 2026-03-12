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
 * - POST /api/connections/:id/refresh → silent token refresh via login session
 * - GET /api/connections/:id/scopes → list scopes
 * - DELETE /api/connections/:id/scopes/:scopeId → delete scope (cascade files)
 * - POST /api/connections/:id/scopes/batch   → batch add/remove scopes
 *
 * @module routes/connections
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ConfidentialClientApplication } from '@azure/msal-node';
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
  GRAPH_API_SCOPES,
} from '@bc-agent/shared';
import type { FolderListResult } from '@bc-agent/shared';
import { getOneDriveService } from '@/services/connectors/onedrive';
import { getInitialSyncService } from '@/services/sync/InitialSyncService';
import { MsalRedisCachePlugin } from '@/domains/auth/oauth/MsalRedisCachePlugin';
import { getEagerRedis } from '@/infrastructure/redis/redis';
import { getGraphTokenManager } from '@/services/connectors/GraphTokenManager';
import { prisma } from '@/infrastructure/database/prisma';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';

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

/**
 * Build a fresh MSAL ConfidentialClientApplication backed by Redis cache.
 * Same pattern as onedrive-auth.ts / sharepoint-auth.ts.
 */
function buildMsalClient(partitionKey: string): ConfidentialClientApplication {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const authority =
    process.env.MICROSOFT_AUTHORITY ??
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`;

  if (!clientId || !clientSecret) {
    throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be configured');
  }

  return new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority },
    cache: { cachePlugin: new MsalRedisCachePlugin(partitionKey) },
  });
}

/** Scopes to request per provider during silent refresh. */
const PROVIDER_SCOPES: Record<string, string[]> = {
  onedrive: [GRAPH_API_SCOPES.FILES_READ_ALL],
  sharepoint: [GRAPH_API_SCOPES.SITES_READ_ALL, GRAPH_API_SCOPES.FILES_READ_ALL],
};

/** Value for scopes_granted column per provider. */
const PROVIDER_SCOPES_GRANTED: Record<string, string> = {
  onedrive: GRAPH_API_SCOPES.FILES_READ_ALL,
  sharepoint: `${GRAPH_API_SCOPES.SITES_READ_ALL} ${GRAPH_API_SCOPES.FILES_READ_ALL}`,
};

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
 * POST /api/connections/:id/refresh
 * Attempt silent token refresh using the user's login session.
 * Returns { status: 'refreshed' } or { status: 'requires_reauth' }.
 */
router.post(
  '/:id/refresh',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;

      // Verify ownership and get provider info
      const connection = await prisma.connections.findFirst({
        where: { id: connectionId, user_id: userId },
        select: { id: true, provider: true, scopes_granted: true },
      });

      if (!connection) {
        sendNotFound(res, ErrorCode.NOT_FOUND);
        return;
      }

      const scopes = PROVIDER_SCOPES[connection.provider];
      if (!scopes) {
        res.json({ status: 'requires_reauth', connectionId });
        return;
      }

      // Extract login session credentials
      const oauthSession = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;
      const homeAccountId = oauthSession?.homeAccountId;
      const msalPartitionKey = oauthSession?.msalPartitionKey;

      if (!homeAccountId || !msalPartitionKey) {
        logger.info({ userId, connectionId }, 'No login session credentials for silent refresh');
        res.json({ status: 'requires_reauth', connectionId });
        return;
      }

      // Attempt silent token acquisition using login session MSAL cache
      try {
        const msalClient = buildMsalClient(msalPartitionKey);
        const tokenCache = msalClient.getTokenCache();
        const account = await tokenCache.getAccountByHomeId(homeAccountId);

        if (!account) {
          logger.info({ userId, connectionId }, 'MSAL account not found in login cache');
          res.json({ status: 'requires_reauth', connectionId });
          return;
        }

        const silentResult = await msalClient.acquireTokenSilent({ account, scopes });

        if (!silentResult?.accessToken) {
          res.json({ status: 'requires_reauth', connectionId });
          return;
        }

        const expiresAt = silentResult.expiresOn ?? new Date(Date.now() + 3600 * 1000);

        // Store refreshed tokens
        const tokenManager = getGraphTokenManager();
        await tokenManager.storeTokens(connectionId, {
          accessToken: silentResult.accessToken,
          expiresAt,
        });

        // Update MSAL metadata on the connection
        await prisma.connections.update({
          where: { id: connectionId },
          data: {
            msal_home_account_id: homeAccountId,
            scopes_granted: PROVIDER_SCOPES_GRANTED[connection.provider] ?? connection.scopes_granted,
            updated_at: new Date(),
          },
        });

        // Align MSAL cache: copy to homeAccountId key for GraphTokenManager background refresh
        if (homeAccountId && msalPartitionKey !== homeAccountId) {
          try {
            const redis = getEagerRedis();
            const cacheData = await redis.get(`msal:token:${msalPartitionKey}`);
            if (cacheData) {
              await redis.setex(`msal:token:${homeAccountId}`, 90 * 24 * 60 * 60, cacheData);
              logger.info({ oldKey: msalPartitionKey, newKey: homeAccountId },
                'Aligned MSAL cache partition key during connection refresh');
            }
          } catch (err) {
            logger.warn({ error: err instanceof Error ? err.message : String(err) },
              'Failed to align MSAL cache partition key during connection refresh');
          }
        }

        logger.info({ userId, connectionId, provider: connection.provider }, 'Connection refreshed via silent acquisition');
        res.json({ status: 'refreshed', connectionId });
      } catch (silentError) {
        const errorInfo = silentError instanceof Error
          ? { message: silentError.message, name: silentError.name }
          : { value: String(silentError) };
        logger.info(
          { userId, connectionId, error: errorInfo },
          'Silent token refresh failed; requires re-authentication'
        );
        res.json({ status: 'requires_reauth', connectionId });
      }
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to refresh connection token'
      );
      next(error);
    }
  }
);

/**
 * GET /api/connections/:id/disconnect-summary
 * Returns a summary of what a full disconnect will remove.
 */
router.get(
  '/:id/disconnect-summary',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;
      const service = getConnectionService();
      const summary = await service.getDisconnectSummary(userId, connectionId);

      logger.info({ userId: userId.toUpperCase(), connectionId }, 'Disconnect summary retrieved');
      res.json(summary);
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
        },
        'Failed to get disconnect summary'
      );
      next(error);
    }
  }
);

/**
 * DELETE /api/connections/:id/full-disconnect
 * Performs a full disconnect: removes all scopes, files, embeddings, tokens, and MSAL cache.
 */
router.delete(
  '/:id/full-disconnect',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;
      const service = getConnectionService();
      const result = await service.fullDisconnect(userId, connectionId);

      logger.info({ userId: userId.toUpperCase(), ...result }, 'Full disconnect completed');
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
        'Failed to perform full disconnect'
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
 * GET /api/connections/:id/browse-shared
 * List items shared with the user on OneDrive (PRD-110).
 */
router.get(
  '/:id/browse-shared',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const userId = req.userId!;

      // Verify ownership
      const service = getConnectionService();
      await service.getConnection(userId, connectionId);

      const result = await getOneDriveService().listSharedWithMe(connectionId);

      logger.info({ userId: userId.toUpperCase(), connectionId }, 'Shared items browsed');
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
        'Failed to browse shared items'
      );
      next(error);
    }
  }
);

/**
 * GET /api/connections/:id/browse-shared/:driveId/:itemId
 * Browse inside a shared folder on a remote drive (PRD-110).
 */
router.get(
  '/:id/browse-shared/:driveId/:itemId',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const connectionId = parseConnectionId(req, res);
      if (!connectionId) return;

      const driveId = req.params.driveId;
      const itemId = req.params.itemId;
      if (!driveId || !itemId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Missing driveId or itemId');
        return;
      }
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
      const result = await getOneDriveService().listSharedFolder(connectionId, driveId, itemId, pageToken);

      logger.info({ userId: userId.toUpperCase(), connectionId, driveId, itemId }, 'Shared folder browsed');
      res.json(enrichBrowseItems(result));
    } catch (error) {
      if (handleDomainError(error, res)) return;

      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error) },
          connectionId: req.params.id,
          driveId: req.params.driveId,
          itemId: req.params.itemId,
        },
        'Failed to browse shared folder'
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
            scopePath: scope.scopePath ?? undefined,
            remoteDriveId: scope.remoteDriveId,
            scopeMode: scope.scopeMode,
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
      const batchData = {
        add: bodyResult.data.add.map((s) => ({
          ...s,
          scopePath: s.scopePath ?? undefined,
        })),
        remove: bodyResult.data.remove,
      };
      const result = await service.batchUpdateScopes(userId, connectionId, batchData);

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
