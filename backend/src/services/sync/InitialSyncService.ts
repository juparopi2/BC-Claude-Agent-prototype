/**
 * InitialSyncService (PRD-101, PRD-104)
 *
 * Orchestrates the initial full enumeration and ingestion of files from a
 * OneDrive connection scope into the local files table and processing queue.
 *
 * Design:
 * - syncScope() is fire-and-forget (called without await from the route handler).
 * - Delta queries are scope-aware: folder scopes use folder-scoped delta,
 *   root scopes use full drive delta (PRD-104).
 * - Only files (not folders) are ingested; folders are skipped.
 * - Files are upserted (not created) to prevent duplicates on re-sync (PRD-104).
 *   Only newly created files (pipeline_status='queued') are enqueued for processing.
 * - WebSocket events are emitted to `user:{userId}` room at each batch and on
 *   completion or error.
 * - The final deltaLink is persisted in connection_scopes.last_sync_cursor for
 *   incremental sync continuations.
 *
 * @module services/sync
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { FILE_SOURCE_TYPE, SYNC_WS_EVENTS, isFileSyncSupported } from '@bc-agent/shared';
import type { DeltaChange, DeltaQueryResult, ExternalFileItem } from '@bc-agent/shared';
import { getOneDriveService } from '@/services/connectors/onedrive';
import { getConnectionRepository } from '@/domains/connections';
import { getMessageQueue } from '@/infrastructure/queue';
import { getSocketIO, isSocketServiceInitialized } from '@/services/websocket/SocketService';

const logger = createChildLogger({ service: 'InitialSyncService' });

const BATCH_SIZE = 50;

// ============================================================================
// InitialSyncService
// ============================================================================

export class InitialSyncService {
  /**
   * Perform a full initial sync of a scope.
   *
   * This method is intentionally void (fire-and-forget).
   * It should NOT be awaited by the route handler — the HTTP response
   * is sent with 202 before this completes.
   *
   * Steps:
   * 1. Mark scope as syncing.
   * 2. Execute full delta query (all pages).
   * 3. Filter files only.
   * 4. Insert file records + enqueue processing in batches of BATCH_SIZE.
   * 5. Save deltaLink as last_sync_cursor.
   * 6. Mark scope as idle with final counts.
   * 7. Emit sync:completed or sync:error WebSocket event.
   */
  syncScope(connectionId: string, scopeId: string, userId: string): void {
    this._runSync(connectionId, scopeId, userId).catch((err) => {
      // Unhandled rejection safety net — _runSync has its own catch block,
      // but this prevents a silent unhandled promise rejection if that catch
      // itself throws.
      const errorInfo = err instanceof Error
        ? { message: err.message, name: err.name }
        : { value: String(err) };
      logger.error({ error: errorInfo, connectionId, scopeId, userId }, 'syncScope safety-net caught unexpected error');
    });
  }

  /**
   * Internal async implementation of syncScope.
   * All failures update the scope status and emit a sync:error event.
   */
  private async _runSync(connectionId: string, scopeId: string, userId: string): Promise<void> {
    try {
      logger.info({ connectionId, scopeId, userId }, 'Starting initial sync');

      const repo = getConnectionRepository();

      // Step 1: Mark scope as syncing
      await repo.updateScope(scopeId, { syncStatus: 'syncing' });

      // Check scope type — file scopes use a lightweight single-item path
      const scope = await repo.findScopeById(scopeId);
      if (!scope) throw new Error(`Scope not found: ${scopeId}`);

      if (scope.scope_type === 'file') {
        await this._runFileLevelSync(connectionId, scopeId, userId, scope);
        return;
      }

      // Step 2: Fetch connection info (need microsoft_drive_id)
      const connection = await prisma.connections.findUnique({
        where: { id: connectionId },
        select: { microsoft_drive_id: true },
      });

      if (!connection) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      // Step 3: Execute delta query — scope-aware routing
      const allChanges: DeltaChange[] = [];
      let deltaLink: string | null = null;
      let nextPageLink: string | null = null;

      // First call: route based on scope_type
      let page: DeltaQueryResult;

      if (scope.scope_type === 'folder' && scope.scope_resource_id) {
        logger.info({ connectionId, scopeId, folderId: scope.scope_resource_id }, 'Starting folder-scoped delta');
        page = await getOneDriveService().executeFolderDeltaQuery(connectionId, scope.scope_resource_id);
      } else {
        logger.info({ connectionId, scopeId }, 'Starting root-scoped delta');
        page = await getOneDriveService().executeDeltaQuery(connectionId);
      }

      allChanges.push(...page.changes);
      deltaLink = page.deltaLink;
      nextPageLink = page.nextPageLink;

      while (nextPageLink) {
        logger.debug({ connectionId, scopeId, collectedSoFar: allChanges.length }, 'Following delta nextPageLink');
        // nextPageLink is an absolute URL already scoped — works for both root and folder delta
        page = await getOneDriveService().executeDeltaQuery(connectionId, nextPageLink);
        allChanges.push(...page.changes);
        if (page.deltaLink) {
          deltaLink = page.deltaLink;
        }
        nextPageLink = page.nextPageLink ?? null;
      }

      logger.info({ connectionId, scopeId, totalChanges: allChanges.length }, 'Delta query complete');

      // Step 4: Filter files only (exclude deleted items, folders, and unsupported MIME types)
      const fileChanges = allChanges.filter(
        (c) => c.changeType !== 'deleted' && !c.item.isFolder && isFileSyncSupported(c.item.mimeType)
      );

      const skippedUnsupported = allChanges.filter(
        (c) => c.changeType !== 'deleted' && !c.item.isFolder && !isFileSyncSupported(c.item.mimeType)
      ).length;
      if (skippedUnsupported > 0) {
        logger.info({ connectionId, scopeId, skippedUnsupported }, 'Skipped unsupported file types');
      }

      logger.info({ connectionId, scopeId, fileCount: fileChanges.length }, 'Files to ingest');

      // PRD-107: Extract folder changes for tree hierarchy storage
      // Filter out the scoped folder itself (Microsoft Graph includes it in delta results)
      const folderChanges = allChanges.filter(
        (c) => c.changeType !== 'deleted' && c.item.isFolder && c.item.id !== scope.scope_resource_id
      );

      // PRD-107: Upsert folders sorted by depth (parents before children)
      // Build external-to-internal ID mapping for parent chain resolution
      // NOTE: Map and seeding are OUTSIDE the folderChanges guard because the scope
      // root folder and file parent resolution need the map even with zero subfolders.
      const externalToInternalId = new Map<string, string>();

      // Query existing folders for this connection to seed the map
      const existingFolders = await prisma.files.findMany({
        where: {
          connection_id: connectionId,
          is_folder: true,
          source_type: FILE_SOURCE_TYPE.ONEDRIVE,
        },
        select: { id: true, external_id: true },
      });
      for (const ef of existingFolders) {
        if (ef.external_id) {
          externalToInternalId.set(ef.external_id, ef.id);
        }
      }

      // PRD-112: Create the scope root folder itself (if folder-type scope).
      // The scope folder is filtered from delta results (it IS the scope, not a child),
      // but it must exist in the files table so children can reference it as parent.
      if (scope.scope_type === 'folder' && scope.scope_resource_id) {
        if (!externalToInternalId.has(scope.scope_resource_id)) {
          const existingScopeFolder = await prisma.files.findFirst({
            where: { connection_id: connectionId, external_id: scope.scope_resource_id },
            select: { id: true },
          });

          if (existingScopeFolder) {
            externalToInternalId.set(scope.scope_resource_id, existingScopeFolder.id);
          } else {
            const scopeFolderId = randomUUID().toUpperCase();
            await prisma.files.create({
              data: {
                id: scopeFolderId,
                user_id: userId,
                name: scope.scope_display_name ?? 'OneDrive Folder',
                mime_type: 'inode/directory',
                size_bytes: BigInt(0),
                blob_path: null,
                is_folder: true,
                source_type: FILE_SOURCE_TYPE.ONEDRIVE,
                external_id: scope.scope_resource_id,
                external_drive_id: connection.microsoft_drive_id,
                connection_id: connectionId,
                connection_scope_id: scopeId,
                external_url: null,
                external_modified_at: null,
                parent_folder_id: null,
                pipeline_status: 'ready',
                processing_retry_count: 0,
                embedding_retry_count: 0,
                is_favorite: false,
              },
            });
            externalToInternalId.set(scope.scope_resource_id, scopeFolderId);
            logger.info({ scopeId, scopeFolderId, name: scope.scope_display_name }, 'Created scope root folder');
          }
        }
      }

      if (folderChanges.length > 0) {
        // Sort by depth (count '/' in parentPath) — parents processed first
        // Defensive: null/undefined parentPath gets depth -1 (processed first as root-level items)
        const sortedFolders = [...folderChanges].sort((a, b) => {
          const pathA = a.item.parentPath;
          const pathB = b.item.parentPath;
          const depthA = pathA ? pathA.split('/').length : -1;
          const depthB = pathB ? pathB.split('/').length : -1;
          return depthA - depthB;
        });

        logger.info(
          {
            connectionId,
            scopeId,
            scopeResourceId: scope.scope_resource_id,
            folderCount: sortedFolders.length,
            folders: sortedFolders.map((f) => ({
              id: f.item.id,
              name: f.item.name,
              parentId: f.item.parentId,
              parentPath: f.item.parentPath,
            })),
          },
          'Sorted folders for hierarchy upsert'
        );

        for (const change of sortedFolders) {
          const item = change.item;
          try {
            // Resolve parent_folder_id from the external-to-internal ID map.
            // The scope root folder is now in the map (PRD-112), so children
            // whose parentId === scope_resource_id resolve naturally.
            let parentFolderId: string | null = null;
            if (item.parentId) {
              parentFolderId = externalToInternalId.get(item.parentId) ?? null;
            }

            logger.debug(
              {
                folderName: item.name,
                externalId: item.id,
                parentId: item.parentId,
                resolvedParentFolderId: parentFolderId,
                mapSize: externalToInternalId.size,
              },
              'Resolving folder parent'
            );

            const existing = await prisma.files.findFirst({
              where: { connection_id: connectionId, external_id: item.id },
              select: { id: true },
            });

            if (existing) {
              await prisma.files.update({
                where: { id: existing.id },
                data: {
                  name: item.name,
                  external_url: item.webUrl || null,
                  external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
                  parent_folder_id: parentFolderId,
                  connection_scope_id: scopeId,
                  last_synced_at: new Date(),
                },
              });
              externalToInternalId.set(item.id, existing.id);
            } else {
              const folderId = randomUUID().toUpperCase();
              await prisma.files.create({
                data: {
                  id: folderId,
                  user_id: userId,
                  name: item.name,
                  mime_type: 'inode/directory',
                  size_bytes: BigInt(0),
                  blob_path: null,
                  is_folder: true,
                  source_type: FILE_SOURCE_TYPE.ONEDRIVE,
                  external_id: item.id,
                  external_drive_id: connection.microsoft_drive_id,
                  connection_id: connectionId,
                  connection_scope_id: scopeId,
                  external_url: item.webUrl || null,
                  external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
                  parent_folder_id: parentFolderId,
                  pipeline_status: 'ready',
                  processing_retry_count: 0,
                  embedding_retry_count: 0,
                  is_favorite: false,
                },
              });
              externalToInternalId.set(item.id, folderId);
            }
          } catch (folderErr) {
            const errorInfo = folderErr instanceof Error
              ? { message: folderErr.message, name: folderErr.name }
              : { value: String(folderErr) };
            logger.warn(
              { error: errorInfo, folderId: item.id, folderName: item.name, connectionId, scopeId },
              'Skipping folder due to ingestion error'
            );
          }
        }

        logger.info({ connectionId, scopeId, folderCount: folderChanges.length }, 'Folders upserted');
      }

      const totalFiles = fileChanges.length;
      let processedFiles = 0;

      const messageQueue = getMessageQueue();

      // Step 5: Process in batches of BATCH_SIZE
      for (let i = 0; i < fileChanges.length; i += BATCH_SIZE) {
        const batch = fileChanges.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (change) => {
            const item = change.item;

            try {
              // Check if file already exists (dedup via filtered unique index)
              const existing = await prisma.files.findFirst({
                where: { connection_id: connectionId, external_id: item.id },
                select: { id: true, pipeline_status: true },
              });

              if (existing) {
                // Resolve parent folder for existing file update
                let parentFolderId: string | null = null;
                if (item.parentId) {
                  parentFolderId = externalToInternalId.get(item.parentId) ?? null;
                }

                // Update metadata only — do NOT touch pipeline_status to avoid re-processing
                await prisma.files.update({
                  where: { id: existing.id },
                  data: {
                    name: item.name,
                    mime_type: item.mimeType ?? 'application/octet-stream',
                    size_bytes: BigInt(item.sizeBytes ?? 0),
                    external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
                    content_hash_external: item.eTag ?? null,
                    parent_folder_id: parentFolderId,
                    connection_scope_id: scopeId,
                    last_synced_at: new Date(),
                  },
                });
              } else {
                // Resolve parent folder for new file creation
                let parentFolderId: string | null = null;
                if (item.parentId) {
                  parentFolderId = externalToInternalId.get(item.parentId) ?? null;
                }

                // Create new file record
                const fileId = randomUUID().toUpperCase();

                await prisma.files.create({
                  data: {
                    id: fileId,
                    user_id: userId,
                    name: item.name,
                    mime_type: item.mimeType ?? 'application/octet-stream',
                    size_bytes: BigInt(item.sizeBytes ?? 0),
                    blob_path: null,
                    is_folder: false,
                    source_type: FILE_SOURCE_TYPE.ONEDRIVE,
                    external_id: item.id,
                    external_drive_id: connection.microsoft_drive_id,
                    connection_id: connectionId,
                    connection_scope_id: scopeId,
                    external_url: item.webUrl || null,
                    external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
                    content_hash_external: item.eTag ?? null,
                    parent_folder_id: parentFolderId,
                    pipeline_status: 'queued',
                    processing_retry_count: 0,
                    embedding_retry_count: 0,
                    is_favorite: false,
                  },
                });

                // Only enqueue newly created files for processing
                await messageQueue.addFileProcessingFlow({
                  fileId,
                  batchId: scopeId,
                  userId,
                  mimeType: item.mimeType ?? 'application/octet-stream',
                  fileName: item.name,
                });
              }
            } catch (fileErr) {
              const errorInfo = fileErr instanceof Error
                ? { message: fileErr.message, name: fileErr.name }
                : { value: String(fileErr) };
              logger.warn(
                { error: errorInfo, fileId: item.id, fileName: item.name, connectionId, scopeId },
                'Skipping file due to ingestion error'
              );
            }
          })
        );

        processedFiles += batch.length;

        // Emit progress WebSocket event per batch
        this.emitProgress(userId, {
          connectionId,
          scopeId,
          processedFiles,
          totalFiles,
          percentage: totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 100,
        });
      }

      // Step 6: Save deltaLink as last_sync_cursor
      await repo.updateScope(scopeId, {
        syncStatus: 'idle',
        itemCount: totalFiles,
        lastSyncAt: new Date(),
        lastSyncError: null,
        lastSyncCursor: deltaLink,
      });

      logger.info({ connectionId, scopeId, totalFiles, processedFiles }, 'Initial sync completed');

      // Step 7: Emit sync:completed
      this.emitCompleted(userId, { connectionId, scopeId, totalFiles });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };

      logger.error({ error: errorInfo, connectionId, scopeId, userId }, 'Initial sync failed');

      try {
        const repo = getConnectionRepository();
        await repo.updateScope(scopeId, {
          syncStatus: 'error',
          lastSyncError: errorMessage,
        });
      } catch (updateErr) {
        const updateErrorInfo = updateErr instanceof Error
          ? { message: updateErr.message, name: updateErr.name }
          : { value: String(updateErr) };
        logger.error({ error: updateErrorInfo, scopeId }, 'Failed to update scope error status');
      }

      // Emit sync:error
      this.emitError(userId, { connectionId, scopeId, error: errorMessage });
    }
  }

  // ============================================================================
  // File-level sync (single file scope)
  // ============================================================================

  /**
   * Lightweight sync path for scope_type='file'.
   * Fetches a single file's metadata from Graph API and ingests it directly
   * without running a delta query.
   */
  private async _runFileLevelSync(
    connectionId: string,
    scopeId: string,
    userId: string,
    scope: { scope_resource_id: string | null }
  ): Promise<void> {
    try {
      if (!scope.scope_resource_id) {
        throw new Error(`File scope has no resource ID: ${scopeId}`);
      }

      // 1. Fetch file metadata from Graph API
      const item: ExternalFileItem = await getOneDriveService().getItemMetadata(
        connectionId,
        scope.scope_resource_id
      );

      // 1b. Skip unsupported file types (PRD-106)
      if (!isFileSyncSupported(item.mimeType)) {
        logger.info({ scopeId, fileName: item.name, mimeType: item.mimeType }, 'Skipping unsupported file type');
        const repo = getConnectionRepository();
        await repo.updateScope(scopeId, {
          syncStatus: 'idle',
          itemCount: 0,
          lastSyncAt: new Date(),
          lastSyncError: null,
        });
        this.emitCompleted(userId, { connectionId, scopeId, totalFiles: 0 });
        return;
      }

      // 2. Fetch connection's microsoft_drive_id
      const connection = await prisma.connections.findUnique({
        where: { id: connectionId },
        select: { microsoft_drive_id: true },
      });

      if (!connection) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      // 3. Check if file already exists (dedup via filtered unique index)
      const existing = await prisma.files.findFirst({
        where: { connection_id: connectionId, external_id: item.id },
        select: { id: true, pipeline_status: true },
      });

      let fileId: string;

      if (existing) {
        // Update metadata only — do NOT touch pipeline_status
        await prisma.files.update({
          where: { id: existing.id },
          data: {
            name: item.name,
            mime_type: item.mimeType ?? 'application/octet-stream',
            size_bytes: BigInt(item.sizeBytes ?? 0),
            external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
            content_hash_external: item.eTag ?? null,
            connection_scope_id: scopeId,
            last_synced_at: new Date(),
          },
        });
        fileId = existing.id;
      } else {
        // Create new file record
        fileId = randomUUID().toUpperCase();

        await prisma.files.create({
          data: {
            id: fileId,
            user_id: userId,
            name: item.name,
            mime_type: item.mimeType ?? 'application/octet-stream',
            size_bytes: BigInt(item.sizeBytes ?? 0),
            blob_path: null,
            is_folder: false,
            source_type: FILE_SOURCE_TYPE.ONEDRIVE,
            external_id: item.id,
            external_drive_id: connection.microsoft_drive_id,
            connection_id: connectionId,
            connection_scope_id: scopeId,
            external_url: item.webUrl || null,
            external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
            content_hash_external: item.eTag ?? null,
            pipeline_status: 'queued',
            processing_retry_count: 0,
            embedding_retry_count: 0,
            is_favorite: false,
          },
        });

        // Only enqueue newly created files for processing
        const messageQueue = getMessageQueue();
        await messageQueue.addFileProcessingFlow({
          fileId,
          batchId: scopeId,
          userId,
          mimeType: item.mimeType ?? 'application/octet-stream',
          fileName: item.name,
        });
      }

      // 4. Update scope as complete
      const repo = getConnectionRepository();
      await repo.updateScope(scopeId, {
        syncStatus: 'idle',
        itemCount: 1,
        lastSyncAt: new Date(),
        lastSyncError: null,
      });

      logger.info({ connectionId, scopeId, fileId, fileName: item.name }, 'File-level sync completed');

      // 6. Emit sync:completed
      this.emitCompleted(userId, { connectionId, scopeId, totalFiles: 1 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };

      logger.error({ error: errorInfo, connectionId, scopeId, userId }, 'File-level sync failed');

      try {
        const repo = getConnectionRepository();
        await repo.updateScope(scopeId, {
          syncStatus: 'error',
          lastSyncError: errorMessage,
        });
      } catch (updateErr) {
        const updateErrorInfo = updateErr instanceof Error
          ? { message: updateErr.message, name: updateErr.name }
          : { value: String(updateErr) };
        logger.error({ error: updateErrorInfo, scopeId }, 'Failed to update scope error status');
      }

      this.emitError(userId, { connectionId, scopeId, error: errorMessage });
    }
  }

  // ============================================================================
  // WebSocket emission helpers
  // ============================================================================

  private emitProgress(
    userId: string,
    data: {
      connectionId: string;
      scopeId: string;
      processedFiles: number;
      totalFiles: number;
      percentage: number;
    }
  ): void {
    if (!isSocketServiceInitialized()) {
      logger.debug({ userId }, 'SocketService not available — skipping sync:progress emission');
      return;
    }

    try {
      getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.SYNC_PROGRESS, data);
    } catch (err) {
      const errorInfo = err instanceof Error ? { message: err.message } : { value: String(err) };
      logger.warn({ error: errorInfo, userId }, 'Failed to emit sync:progress');
    }
  }

  private emitCompleted(
    userId: string,
    data: { connectionId: string; scopeId: string; totalFiles: number }
  ): void {
    if (!isSocketServiceInitialized()) {
      logger.debug({ userId }, 'SocketService not available — skipping sync:completed emission');
      return;
    }

    try {
      getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.SYNC_COMPLETED, data);
    } catch (err) {
      const errorInfo = err instanceof Error ? { message: err.message } : { value: String(err) };
      logger.warn({ error: errorInfo, userId }, 'Failed to emit sync:completed');
    }
  }

  private emitError(
    userId: string,
    data: { connectionId: string; scopeId: string; error: string }
  ): void {
    if (!isSocketServiceInitialized()) {
      logger.debug({ userId }, 'SocketService not available — skipping sync:error emission');
      return;
    }

    try {
      getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.SYNC_ERROR, data);
    } catch (err) {
      const errorInfo = err instanceof Error ? { message: err.message } : { value: String(err) };
      logger.warn({ error: errorInfo, userId }, 'Failed to emit sync:error');
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: InitialSyncService | undefined;

/**
 * Returns the singleton InitialSyncService instance.
 */
export function getInitialSyncService(): InitialSyncService {
  if (!instance) {
    instance = new InitialSyncService();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetInitialSyncService(): void {
  instance = undefined;
}
