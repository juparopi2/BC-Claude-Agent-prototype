/**
 * ConnectionService (PRD-100)
 *
 * Business logic layer for connection management.
 * Validates ownership, maps DB rows to API shapes, and delegates to
 * ConnectionRepository for all persistence operations.
 *
 * Key features:
 * - Ownership validation with timing-safe compare
 * - Maps ConnectionRow → ConnectionSummary (shared API contract)
 * - All IDs normalized to UPPERCASE at ingestion
 *
 * @module domains/connections
 */

import { createChildLogger } from '@/shared/utils/logger';
import { timingSafeCompare } from '@/shared/utils/session-ownership';
import { getConnectionRepository, createScopeWriter } from './ConnectionRepository';
import type { ConnectionRow, ScopeRow } from './ConnectionRepository';
import type {
  ConnectionSummary,
  ConnectionScopeDetail,
  ConnectionListResponse,
  DisconnectSummary,
  FullDisconnectResult,
} from '@bc-agent/shared';
import type { ProviderId } from '@bc-agent/shared';
import type { ConnectionStatus, SyncStatus } from '@bc-agent/shared';
import type { CreateConnectionInput, UpdateConnectionInput } from '@bc-agent/shared/schemas';
import type { ConnectionScopeWithStats, ScopeBatchInput, ScopeBatchResult } from '@bc-agent/shared';
import { getScopeCleanupService } from '@/services/sync/ScopeCleanupService';
import { prisma } from '@/infrastructure/database/prisma';
import { getMessageQueue } from '@/infrastructure/queue';

const logger = createChildLogger({ service: 'ConnectionService' });

// ============================================================================
// ConnectionService
// ============================================================================

export class ConnectionService {
  /**
   * List all connections for the authenticated user.
   */
  async listConnections(userId: string): Promise<ConnectionListResponse> {
    const normalizedUserId = userId.toUpperCase();
    logger.debug({ userId: normalizedUserId }, 'Listing connections');

    const repo = getConnectionRepository();
    const rows = await repo.findByUser(normalizedUserId);

    // Fetch scope counts and file counts in parallel for all connections
    const [scopeCounts, fileCounts] = await Promise.all([
      Promise.all(rows.map((row) => repo.countScopesByConnection(row.id))),
      Promise.all(rows.map((row) => repo.countFilesByConnection(row.id))),
    ]);

    const connections = rows.map((row, index) =>
      this.toSummary(row, scopeCounts[index] ?? 0, fileCounts[index] ?? 0)
    );

    return { connections, count: connections.length };
  }

  /**
   * Get a single connection by ID, verifying ownership.
   * Throws if not found or owned by another user.
   */
  async getConnection(userId: string, connectionId: string): Promise<ConnectionSummary> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Getting connection');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    const [scopeCount, fileCount] = await Promise.all([
      repo.countScopesByConnection(row.id),
      repo.countFilesByConnection(row.id),
    ]);
    return this.toSummary(row, scopeCount, fileCount);
  }

  /**
   * Create a new connection for the authenticated user.
   * Returns the created ConnectionSummary.
   */
  async createConnection(
    userId: string,
    input: CreateConnectionInput
  ): Promise<ConnectionSummary> {
    const normalizedUserId = userId.toUpperCase();
    logger.debug({ userId: normalizedUserId, provider: input.provider }, 'Creating connection');

    const repo = getConnectionRepository();
    const id = await repo.create(normalizedUserId, {
      provider: input.provider,
      displayName: input.displayName,
    });

    const row = await repo.findById(normalizedUserId, id);
    if (!row) {
      // Should never happen — we just created it
      throw new Error(`Failed to retrieve newly created connection ${id}`);
    }

    return this.toSummary(row, 0, 0);
  }

  /**
   * Update mutable fields on a connection, verifying ownership.
   * Throws if not found or owned by another user.
   */
  async updateConnection(
    userId: string,
    connectionId: string,
    input: UpdateConnectionInput
  ): Promise<void> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Updating connection');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    await repo.update(normalizedConnectionId, {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.displayName !== undefined && { displayName: input.displayName }),
    });
  }

  /**
   * Delete a connection, verifying ownership first.
   * Throws if not found or owned by another user.
   */
  async deleteConnection(userId: string, connectionId: string): Promise<void> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Deleting connection');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    await repo.delete(normalizedConnectionId);
    logger.info({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Connection deleted');
  }

  /**
   * List all scopes for a connection, verifying ownership.
   * Throws if not found or owned by another user.
   */
  async listScopes(userId: string, connectionId: string): Promise<ConnectionScopeDetail[]> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Listing connection scopes');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    const scopes = await repo.findScopesByConnection(normalizedConnectionId);
    return scopes.map((scope) => this.toScopeDetail(scope));
  }

  /**
   * List scopes with actual file counts from the DB (PRD-105).
   */
  async listScopesWithStats(userId: string, connectionId: string): Promise<ConnectionScopeWithStats[]> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Listing scopes with stats');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    const scopesWithCounts = await repo.findScopesWithFileCounts(normalizedConnectionId);
    return scopesWithCounts.map((scope) => ({
      ...this.toScopeDetail(scope),
      fileCount: scope.file_count,
    }));
  }

  /**
   * Delete a single scope with cascading file cleanup (PRD-105).
   */
  async deleteScope(userId: string, connectionId: string, scopeId: string): Promise<{ scopeId: string; filesDeleted: number }> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    const normalizedScopeId = scopeId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId, scopeId: normalizedScopeId }, 'Deleting scope');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    const cleanupService = getScopeCleanupService();
    const result = await cleanupService.removeScope(normalizedConnectionId, normalizedScopeId, normalizedUserId);

    logger.info(
      { userId: normalizedUserId, connectionId: normalizedConnectionId, scopeId: normalizedScopeId, filesDeleted: result.filesDeleted },
      'Scope deleted'
    );

    return result;
  }

  /**
   * Batch add/remove scopes for a connection (PRD-105).
   * Removes are processed first, then adds. Each operation is independent.
   */
  async batchUpdateScopes(
    userId: string,
    connectionId: string,
    input: ScopeBatchInput
  ): Promise<ScopeBatchResult> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug(
      { userId: normalizedUserId, connectionId: normalizedConnectionId, addCount: input.add.length, removeCount: input.remove.length },
      'Batch updating scopes'
    );

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    // Phase 1: Process removes (outside transaction — external side effects)
    const removed: Array<{ scopeId: string; filesDeleted: number }> = [];
    const cleanupService = getScopeCleanupService();

    for (const scopeId of input.remove) {
      const normalizedScopeId = scopeId.toUpperCase();
      const result = await cleanupService.removeScope(normalizedConnectionId, normalizedScopeId, normalizedUserId);
      removed.push(result);
    }

    // Phase 2: Create scopes atomically inside transaction
    const scopeCreationInputs = input.add.map((scopeInput) => ({
      scopeType: scopeInput.scopeType,
      scopeResourceId: scopeInput.scopeResourceId,
      scopeDisplayName: scopeInput.scopeDisplayName,
      scopePath: scopeInput.scopePath,
      remoteDriveId: scopeInput.remoteDriveId,
      scopeMode: scopeInput.scopeMode,
      scopeSiteId: scopeInput.scopeSiteId,
    }));

    const createdScopeIds: string[] = await prisma.$transaction(async (tx) => {
      const scopeWriter = createScopeWriter(tx);
      const ids: string[] = [];
      for (const scopeInput of scopeCreationInputs) {
        // Set syncStatus at creation time — avoids separate update round-trip
        const syncStatus = scopeInput.scopeMode !== 'exclude' ? 'sync_queued' : 'idle';
        const scopeId = await scopeWriter.createScope(normalizedConnectionId, {
          ...scopeInput,
          syncStatus,
        });
        ids.push(scopeId);
      }
      return ids;
    }, { timeout: 15000 });

    // Build response
    const added: Array<ConnectionScopeDetail & { syncJobId?: string }> = [];

    for (let i = 0; i < createdScopeIds.length; i++) {
      const scopeId = createdScopeIds[i]!;

      const scopeRow = await repo.findScopeById(scopeId);
      if (!scopeRow) continue;

      const detail: ConnectionScopeDetail & { syncJobId?: string } = {
        ...this.toScopeDetail(scopeRow),
      };

      added.push(detail);
    }

    // Phase 3: Post-transaction — enqueue sync jobs
    const messageQueue = getMessageQueue();

    for (let i = 0; i < createdScopeIds.length; i++) {
      const scopeId = createdScopeIds[i]!;
      const scopeInput = input.add[i]!;

      if (scopeInput.scopeMode === 'exclude') {
        // PRD-112: Exclusion scopes don't trigger sync — clean up existing file if present
        cleanupService.removeFileByExternalId(normalizedConnectionId, scopeInput.scopeResourceId, normalizedUserId);
      } else if (scopeInput.scopeType === 'site') {
        // PRD-111: Site-scope expansion — enumerate libraries and create child library scopes
        this._expandSiteScope(normalizedConnectionId, scopeId, scopeInput.scopeResourceId, scopeInput.scopeDisplayName ?? '', normalizedUserId)
          .catch((err) => {
            const errorInfo = err instanceof Error
              ? { message: err.message, name: err.name }
              : { value: String(err) };
            logger.error({ error: errorInfo, connectionId: normalizedConnectionId, scopeId }, 'Site-scope expansion failed');
          });
      } else {
        // PRD-116: Enqueue initial sync job via BullMQ
        try {
          const syncJobId = await messageQueue.addInitialSyncJob({
            scopeId,
            connectionId: normalizedConnectionId,
            userId: normalizedUserId,
          });
          // Attach syncJobId to the response
          const addedEntry = added.find(a => a.id === scopeId);
          if (addedEntry) {
            addedEntry.syncJobId = syncJobId;
          }
        } catch (err) {
          const errorInfo = err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
          logger.error({ error: errorInfo, connectionId: normalizedConnectionId, scopeId }, 'Failed to enqueue initial sync job');
          // Mark scope as error if enqueue fails
          try {
            await repo.updateScope(scopeId, {
              syncStatus: 'error',
              lastSyncError: 'Failed to enqueue sync job',
            });
          } catch { /* best effort */ }
        }
      }
    }

    logger.info(
      { userId: normalizedUserId, connectionId: normalizedConnectionId, addedCount: added.length, removedCount: removed.length },
      'Batch scope update complete'
    );

    return { added, removed };
  }

  /**
   * Get a summary of what a full disconnect will remove.
   * Used by the frontend confirmation modal.
   */
  async getDisconnectSummary(userId: string, connectionId: string): Promise<DisconnectSummary> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Getting disconnect summary');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    const [scopeCount, fileCount, chunkCount] = await Promise.all([
      repo.countScopesByConnection(normalizedConnectionId),
      repo.countFilesByConnection(normalizedConnectionId),
      repo.countChunksByConnection(normalizedConnectionId),
    ]);

    return {
      connectionId: normalizedConnectionId,
      provider: row.provider,
      displayName: row.display_name,
      scopeCount,
      fileCount,
      chunkCount,
    };
  }

  /**
   * Full disconnect: remove all traces of a connection (scopes, files, embeddings, tokens, MSAL cache).
   * Reuses ScopeCleanupService.removeScope() per scope for consistent cleanup.
   */
  async fullDisconnect(userId: string, connectionId: string): Promise<FullDisconnectResult> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.info({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Starting full disconnect');

    const repo = getConnectionRepository();
    const row = await repo.findByIdWithMsal(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    // 1. Fetch all scopes
    const scopes = await repo.findScopesByConnection(normalizedConnectionId);

    // 2. Remove each scope (subscriptions, citations, AI Search, files, scope record)
    let scopesRemoved = 0;
    let totalFilesDeleted = 0;
    let searchCleanupFailures = 0;
    const cleanupService = getScopeCleanupService();

    for (const scope of scopes) {
      try {
        // Force-update syncing scopes to idle to avoid ScopeCurrentlySyncingError
        if (scope.sync_status === 'syncing') {
          await repo.updateScope(scope.id, { syncStatus: 'idle' });
        }

        const result = await cleanupService.removeScope(normalizedConnectionId, scope.id, normalizedUserId);
        scopesRemoved++;
        totalFilesDeleted += result.filesDeleted;
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
        logger.error({ error: errorInfo, scopeId: scope.id, connectionId: normalizedConnectionId }, 'Scope cleanup failed during full disconnect');
        searchCleanupFailures++;
      }
    }

    // 3. Revoke tokens
    let tokenRevoked = false;
    try {
      const { getGraphTokenManager } = await import('@/services/connectors/GraphTokenManager');
      await getGraphTokenManager().revokeTokens(normalizedConnectionId);
      tokenRevoked = true;
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };
      logger.error({ error: errorInfo, connectionId: normalizedConnectionId }, 'Token revocation failed during full disconnect');
    }

    // 4. Delete MSAL cache
    let msalCacheDeleted = false;
    if (row.msal_home_account_id) {
      try {
        const { deleteMsalCache } = await import('@/domains/auth/oauth/MsalRedisCachePlugin');
        await deleteMsalCache(row.msal_home_account_id);
        msalCacheDeleted = true;
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
        logger.error({ error: errorInfo, connectionId: normalizedConnectionId }, 'MSAL cache deletion failed during full disconnect');
      }
    } else {
      msalCacheDeleted = true; // Nothing to delete
    }

    // 5. Delete connection record (cascades remaining scope records if any)
    await repo.delete(normalizedConnectionId);

    // 6. Emit WebSocket event
    try {
      const { isSocketServiceInitialized, getSocketIO } = await import('@/services/websocket/SocketService');
      const { SYNC_WS_EVENTS } = await import('@bc-agent/shared');
      if (isSocketServiceInitialized()) {
        getSocketIO().to(`user:${normalizedUserId}`).emit(SYNC_WS_EVENTS.CONNECTION_DISCONNECTED, {
          connectionId: normalizedConnectionId,
          provider: row.provider,
        });
      }
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };
      logger.warn({ error: errorInfo, connectionId: normalizedConnectionId }, 'WebSocket emit failed during full disconnect');
    }

    const result: FullDisconnectResult = {
      connectionId: normalizedConnectionId,
      scopesRemoved,
      filesDeleted: totalFilesDeleted,
      searchCleanupFailures,
      tokenRevoked,
      msalCacheDeleted,
    };

    logger.info({ ...result, userId: normalizedUserId }, 'Full disconnect completed');
    return result;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * PRD-111: Expand a site-scope into individual library scopes.
   * Enumerates non-system libraries from SharePoint and creates one
   * 'library' scope per library, then triggers initial sync for each.
   */
  private async _expandSiteScope(
    connectionId: string,
    parentScopeId: string,
    siteId: string,
    siteName: string,
    userId: string
  ): Promise<void> {
    logger.info({ connectionId, parentScopeId, siteId }, 'Expanding site scope into library scopes');

    const { getSharePointService } = await import('@/services/connectors/sharepoint');
    const spService = getSharePointService();
    const repo = getConnectionRepository();
    const messageQueue = getMessageQueue();

    const MAX_LIBRARIES = 20;

    const result = await spService.getLibraries(connectionId, siteId, false);
    const libraries = result.libraries.slice(0, MAX_LIBRARIES);

    for (const lib of libraries) {
      const libScopeId = await repo.createScope(connectionId, {
        scopeType: 'library',
        scopeResourceId: lib.driveId,
        scopeDisplayName: lib.displayName,
        scopePath: `${siteName} / ${lib.displayName}`,
        scopeSiteId: siteId,
        syncStatus: 'sync_queued',
      });

      try {
        await messageQueue.addInitialSyncJob({
          scopeId: libScopeId,
          connectionId,
          userId,
        });
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        logger.error({ error: errorInfo, connectionId, scopeId: libScopeId }, 'Failed to enqueue initial sync for library scope');
        await repo.updateScope(libScopeId, { syncStatus: 'error', lastSyncError: 'Failed to enqueue sync job' });
      }
    }

    // Mark parent site scope as idle with library count
    await repo.updateScope(parentScopeId, {
      syncStatus: 'idle',
      itemCount: libraries.length,
      lastSyncAt: new Date(),
      lastSyncError: null,
    });

    logger.info(
      { connectionId, parentScopeId, siteId, libraryCount: libraries.length },
      'Site scope expanded into library scopes'
    );
  }

  /**
   * Fire-and-forget: persist detected token expiration to DB and notify via WebSocket.
   */
  private persistExpiredStatus(connectionId: string, userId: string): void {
    const repo = getConnectionRepository();
    repo.update(connectionId, {
      status: 'expired',
      lastError: 'Token expired — re-authentication required',
      lastErrorAt: new Date(),
    }).then(async () => {
      try {
        const { isSocketServiceInitialized, getSocketIO } = await import('@/services/websocket/SocketService');
        const { SYNC_WS_EVENTS } = await import('@bc-agent/shared');
        if (isSocketServiceInitialized()) {
          getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.CONNECTION_EXPIRED, { connectionId });
        }
      } catch { /* socket not available in tests */ }
    }).catch((err: unknown) => {
      const errorInfo = err instanceof Error
        ? { message: err.message, name: err.name }
        : { value: String(err) };
      logger.warn({ error: errorInfo, connectionId }, 'Failed to persist expired status');
    });
  }

  /**
   * Map a DB row to the public-facing ConnectionSummary shape.
   */
  private toSummary(row: ConnectionRow, scopeCount: number, fileCount: number): ConnectionSummary {
    // Proactive expiry: if token is definitively past expiry, report as expired
    let effectiveStatus = row.status as ConnectionStatus;
    if (
      effectiveStatus === 'connected' &&
      row.token_expires_at &&
      new Date(row.token_expires_at).getTime() < Date.now()
    ) {
      effectiveStatus = 'expired' as ConnectionStatus;
      // Persist the expiration detected at presentation time (fire-and-forget)
      this.persistExpiredStatus(row.id, row.user_id);
    }

    return {
      id: row.id,
      provider: row.provider as ProviderId,
      status: effectiveStatus,
      displayName: row.display_name,
      lastError: row.last_error,
      lastErrorAt: row.last_error_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      scopeCount,
      fileCount,
    };
  }

  /**
   * Map a DB scope row to the public-facing ConnectionScopeDetail shape.
   */
  private toScopeDetail(row: ScopeRow): ConnectionScopeDetail {
    return {
      id: row.id,
      connectionId: row.connection_id,
      scopeType: row.scope_type,
      scopeResourceId: row.scope_resource_id,
      scopeDisplayName: row.scope_display_name,
      syncStatus: row.sync_status as SyncStatus,
      lastSyncAt: row.last_sync_at?.toISOString() ?? null,
      lastSyncError: row.last_sync_error,
      itemCount: row.item_count,
      createdAt: row.created_at.toISOString(),
      scopeMode: (row.scope_mode ?? 'include') as 'include' | 'exclude',
      scopeSiteId: row.scope_site_id ?? null,
      processingTotal: row.processing_total,
      processingCompleted: row.processing_completed,
      processingFailed: row.processing_failed,
      processingStatus: row.processing_status,
    };
  }

  /**
   * Assert that the connection's recorded owner matches the requesting user.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  private assertOwnership(
    ownerId: string,
    requestingUserId: string,
    connectionId: string
  ): void {
    if (!timingSafeCompare(ownerId, requestingUserId)) {
      logger.warn(
        { connectionId, requestingUserId, ownershipMismatch: true },
        'Connection ownership validation failed'
      );
      throw new ConnectionForbiddenError(connectionId);
    }
  }
}

// ============================================================================
// Domain errors
// ============================================================================

export class ConnectionNotFoundError extends Error {
  readonly code = 'CONNECTION_NOT_FOUND';
  constructor(connectionId: string) {
    super(`Connection ${connectionId} not found`);
    this.name = 'ConnectionNotFoundError';
  }
}

export class ConnectionForbiddenError extends Error {
  readonly code = 'CONNECTION_FORBIDDEN';
  constructor(connectionId: string) {
    super(`Access to connection ${connectionId} is forbidden`);
    this.name = 'ConnectionForbiddenError';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ConnectionService | null = null;

/**
 * Returns the singleton ConnectionService instance.
 */
export function getConnectionService(): ConnectionService {
  if (!instance) {
    instance = new ConnectionService();
  }
  return instance;
}
