/**
 * DeltaSyncService (PRD-108)
 *
 * Orchestrates incremental (delta) sync of files from a OneDrive connection
 * scope using a previously stored deltaLink cursor. Handles new, updated, and
 * deleted files/folders and emits real-time WebSocket events.
 *
 * Design:
 * - syncDelta() is the main entry point; returns a DeltaSyncResult.
 * - Guards against concurrent syncs (returns early if scope is already syncing).
 * - Falls back to InitialSyncService when no cursor exists.
 * - Processes all delta pages before committing the new cursor.
 * - Changes are processed in three phases: deletions → folders → files.
 *   Folders are sorted by depth so parents are always created before children,
 *   which enables correct parent_folder_id resolution for both folders and files.
 * - Each individual change is wrapped in its own try/catch so one failure
 *   does not abort the entire sync.
 * - WebSocket events are emitted per file change and on completion/error.
 *
 * @module services/sync
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { FILE_SOURCE_TYPE, SYNC_WS_EVENTS, isFileSyncSupported } from '@bc-agent/shared';
import type { DeltaChange, DeltaQueryResult } from '@bc-agent/shared';
import { getOneDriveService } from '@/services/connectors/onedrive';
import { getConnectionRepository } from '@/domains/connections';
import { getMessageQueue } from '@/infrastructure/queue';
import { getInitialSyncService } from '@/services/sync/InitialSyncService';
import { getSocketIO, isSocketServiceInitialized } from '@/services/websocket/SocketService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import {
  buildFolderMap,
  ensureScopeRootFolder,
  resolveParentFolderId,
  sortFoldersByDepth,
  upsertFolder,
} from '@/services/sync/FolderHierarchyResolver';

const logger = createChildLogger({ service: 'DeltaSyncService' });

// ============================================================================
// Result interface
// ============================================================================

export interface DeltaSyncResult {
  newFiles: number;
  updatedFiles: number;
  deletedFiles: number;
  skipped: number;
}

// ============================================================================
// DeltaSyncService
// ============================================================================

export class DeltaSyncService {
  /**
   * Perform an incremental delta sync for the given scope.
   *
   * Steps:
   * 1. Load scope; guard against concurrent syncs.
   * 2. Mark scope as syncing.
   * 3. If no cursor exists, delegate to InitialSyncService.
   * 4. Load connection to get microsoft_drive_id.
   * 5. Execute delta query across all pages.
   * 5b. Build folder hierarchy map; ensure scope root folder exists.
   * 6. Process changes in three phases: deletions → folders → files.
   * 7. Persist new deltaLink and mark scope idle.
   * 8. Emit sync:completed.
   * 9. Return result counters.
   */
  async syncDelta(
    connectionId: string,
    scopeId: string,
    userId: string,
    triggerType: 'webhook' | 'polling' | 'manual'
  ): Promise<DeltaSyncResult> {
    const result: DeltaSyncResult = { newFiles: 0, updatedFiles: 0, deletedFiles: 0, skipped: 0 };

    logger.info({ connectionId, scopeId, userId, triggerType }, 'Starting delta sync');

    const repo = getConnectionRepository();

    // Step 1: Load scope and guard against concurrent syncs
    const scope = await repo.findScopeById(scopeId);
    if (!scope) {
      throw new Error(`Scope not found: ${scopeId}`);
    }

    if (scope.sync_status === 'syncing') {
      logger.warn({ connectionId, scopeId, userId }, 'Scope already syncing — skipping delta sync');
      return result;
    }

    try {
      // Step 2: Mark scope as syncing
      await repo.updateScope(scopeId, { syncStatus: 'syncing' });

      // Step 3: If no cursor, delegate to InitialSyncService (shouldn't happen normally)
      if (!scope.last_sync_cursor) {
        logger.warn(
          { connectionId, scopeId, userId },
          'No last_sync_cursor found — falling back to InitialSyncService'
        );
        getInitialSyncService().syncScope(connectionId, scopeId, userId);
        return result;
      }

      // Step 4: Load connection info (need microsoft_drive_id)
      const connection = await prisma.connections.findUnique({
        where: { id: connectionId },
        select: { microsoft_drive_id: true, provider: true },
      });

      if (!connection) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      // PRD-111: Resolve effective drive ID
      const effectiveDriveId = scope.remote_drive_id
        ?? (connection.provider === 'sharepoint' && scope.scope_type === 'library' ? scope.scope_resource_id : null)
        ?? connection.microsoft_drive_id;

      if (!effectiveDriveId) {
        throw new Error(
          `Cannot resolve driveId for scope ${scopeId} (provider=${connection.provider}, ` +
          `type=${scope.scope_type}). SharePoint folder scopes require remote_drive_id. Re-add the scope to fix.`
        );
      }

      // Step 5: Execute delta query across all pages
      const allChanges: DeltaChange[] = [];
      let deltaLink: string | null = null;

      let page: DeltaQueryResult;

      // PRD-111: Provider-aware delta dispatch
      if (connection.provider === 'sharepoint') {
        const { getSharePointService } = await import('@/services/connectors/sharepoint');
        const spService = getSharePointService();
        if (scope.scope_type === 'folder' && scope.scope_resource_id) {
          logger.info({ connectionId, scopeId, folderId: scope.scope_resource_id, driveId: effectiveDriveId }, 'Starting SharePoint folder-scoped delta with cursor');
          page = await spService.executeFolderDeltaQuery(connectionId, effectiveDriveId!, scope.scope_resource_id, scope.last_sync_cursor);
        } else {
          logger.info({ connectionId, scopeId, driveId: effectiveDriveId }, 'Starting SharePoint library-scoped delta with cursor');
          page = await spService.executeDeltaQuery(connectionId, effectiveDriveId!, scope.last_sync_cursor);
        }
      } else {
        if (scope.scope_type === 'folder' && scope.scope_resource_id) {
          logger.info({ connectionId, scopeId, folderId: scope.scope_resource_id }, 'Starting folder-scoped delta with cursor');
          page = await getOneDriveService().executeFolderDeltaQuery(connectionId, scope.scope_resource_id, scope.last_sync_cursor);
        } else {
          logger.info({ connectionId, scopeId }, 'Starting root-scoped delta with cursor');
          page = await getOneDriveService().executeDeltaQuery(connectionId, scope.last_sync_cursor);
        }
      }

      allChanges.push(...page.changes);
      deltaLink = page.deltaLink;

      // Follow pagination
      while (page.nextPageLink) {
        logger.debug(
          { connectionId, scopeId, collectedSoFar: allChanges.length },
          'Following delta nextPageLink'
        );
        if (connection.provider === 'sharepoint') {
          const { getSharePointService } = await import('@/services/connectors/sharepoint');
          page = await getSharePointService().executeDeltaQuery(connectionId, effectiveDriveId, page.nextPageLink);
        } else {
          page = await getOneDriveService().executeDeltaQuery(connectionId, page.nextPageLink);
        }
        allChanges.push(...page.changes);
        if (page.deltaLink) {
          deltaLink = page.deltaLink;
        }
      }

      logger.info(
        { connectionId, scopeId, totalChanges: allChanges.length },
        'Delta query complete'
      );

      // Step 5b: Build folder hierarchy map for parent resolution
      const folderMap = await buildFolderMap(connectionId, connection.provider);

      if (scope.scope_type === 'folder' && scope.scope_resource_id) {
        await ensureScopeRootFolder({
          connectionId,
          scopeId,
          userId,
          scopeResourceId: scope.scope_resource_id,
          scopeDisplayName: scope.scope_display_name,
          microsoftDriveId: effectiveDriveId,
          folderMap,
          provider: connection.provider,
        });
      }

      // Step 6: Process changes in phases (deletions → folders → files)

      // 6a: Categorize changes
      const deletedChanges: DeltaChange[] = [];
      let folderChanges: DeltaChange[] = [];
      let fileChanges: DeltaChange[] = [];

      for (const change of allChanges) {
        if (change.changeType === 'deleted') {
          deletedChanges.push(change);
        } else if (change.item.isFolder) {
          // Filter out the scope root folder itself (same pattern as InitialSyncService)
          if (change.item.id !== scope.scope_resource_id) {
            folderChanges.push(change);
          }
        } else {
          fileChanges.push(change);
        }
      }

      // PRD-112: Exclusion filtering
      const exclusions = await repo.findExclusionScopesByConnection(connectionId);
      const excludedResourceIds = new Set(
        exclusions.map(e => e.scope_resource_id).filter(Boolean) as string[]
      );

      if (excludedResourceIds.size > 0) {
        const origFileCount = fileChanges.length;
        const origFolderCount = folderChanges.length;
        fileChanges = fileChanges.filter(c => !excludedResourceIds.has(c.item.id));
        folderChanges = folderChanges.filter(c => !excludedResourceIds.has(c.item.id));

        const excludedCount = (origFileCount - fileChanges.length) + (origFolderCount - folderChanges.length);
        if (excludedCount > 0) {
          logger.info({ connectionId, scopeId, excludedCount }, 'Filtered excluded items from delta');
        }
      }

      logger.info({
        connectionId, scopeId,
        deletions: deletedChanges.map(c => ({ id: c.item.id, name: c.item.name })),
        folders: folderChanges.map(c => ({ id: c.item.id, name: c.item.name })),
        files: fileChanges.map(c => ({ id: c.item.id, name: c.item.name, eTag: c.item.eTag })),
      }, 'Delta changes categorized');

      // 6b: Process deletions
      for (const change of deletedChanges) {
        const item = change.item;

        try {
          const existing = await prisma.files.findFirst({
            where: { connection_id: connectionId, external_id: item.id },
            select: { id: true, is_folder: true, name: true, deletion_status: true },
          });

          logger.debug({
            externalId: item.id, itemName: item.name,
            foundInDb: !!existing, internalId: existing?.id, isFolder: existing?.is_folder,
          }, 'Deletion lookup result');

          if (!existing) {
            // Already removed or never synced
            continue;
          }

          // Skip files already soft-deleted (e.g., processed as part of a folder deletion above)
          if (existing.deletion_status != null) {
            continue;
          }

          if (existing.is_folder) {
            // Recursively collect all descendants (files + subfolders)
            const descendantFiles: Array<{ id: string; name: string }> = [];
            const descendantSubfolders: string[] = [];

            const collectDescendants = async (parentId: string): Promise<void> => {
              const children = await prisma.files.findMany({
                where: { parent_folder_id: parentId, connection_id: connectionId },
                select: { id: true, name: true, is_folder: true },
              });
              for (const child of children) {
                if (child.is_folder) {
                  descendantSubfolders.push(child.id);
                  await collectDescendants(child.id);
                } else {
                  descendantFiles.push({ id: child.id, name: child.name });
                }
              }
            };

            await collectDescendants(existing.id);

            logger.info({
              folderId: existing.id, externalId: item.id,
              descendantFiles: descendantFiles.length,
              descendantSubfolders: descendantSubfolders.length,
            }, 'Collected folder descendants for deletion');

            // 1. Soft-delete all descendant files (with embedding cleanup)
            for (const fileRecord of descendantFiles) {
              try {
                try {
                  await VectorSearchService.getInstance().deleteChunksForFile(fileRecord.id, userId);
                } catch (vecErr) {
                  const errorInfo =
                    vecErr instanceof Error
                      ? { message: vecErr.message, name: vecErr.name }
                      : { value: String(vecErr) };
                  logger.warn(
                    { error: errorInfo, fileId: fileRecord.id, connectionId, scopeId },
                    'Failed to delete vector chunks for descendant file during folder deletion — continuing'
                  );
                }
                await prisma.file_chunks.deleteMany({ where: { file_id: fileRecord.id } });

                await prisma.files.update({
                  where: { id: fileRecord.id },
                  data: { deleted_at: new Date(), deletion_status: 'pending', parent_folder_id: null },
                });
                this.emitSyncEvent(userId, SYNC_WS_EVENTS.SYNC_FILE_REMOVED, {
                  connectionId,
                  scopeId,
                  fileId: fileRecord.id,
                  fileName: fileRecord.name,
                });
                result.deletedFiles++;

                logger.info({
                  fileId: fileRecord.id, fileName: fileRecord.name,
                }, 'Descendant file soft-deleted during folder deletion (delta sync)');
              } catch (childErr) {
                const errorInfo =
                  childErr instanceof Error
                    ? { message: childErr.message, name: childErr.name }
                    : { value: String(childErr) };
                logger.warn(
                  { error: errorInfo, fileId: fileRecord.id, connectionId, scopeId },
                  'Failed to soft-delete descendant file during folder deletion'
                );
              }
            }

            // 2. Hard-delete subfolders bottom-up (deepest first to avoid FK issues)
            for (const subfolderId of descendantSubfolders.reverse()) {
              await prisma.files.delete({ where: { id: subfolderId } });
            }

            // 3. Hard-delete the folder itself
            await prisma.files.delete({ where: { id: existing.id } });
            logger.debug(
              { folderId: existing.id, externalId: item.id, connectionId, scopeId,
                deletedSubfolders: descendantSubfolders.length },
              'Deleted folder record and subfolders'
            );
          } else {
            // Clean up embeddings + chunks before soft-delete
            try {
              await VectorSearchService.getInstance().deleteChunksForFile(existing.id, userId);
            } catch (vecErr) {
              const errorInfo =
                vecErr instanceof Error
                  ? { message: vecErr.message, name: vecErr.name }
                  : { value: String(vecErr) };
              logger.warn(
                { error: errorInfo, fileId: existing.id, connectionId, scopeId },
                'Failed to delete vector chunks for deleted file — continuing'
              );
            }
            await prisma.file_chunks.deleteMany({ where: { file_id: existing.id } });

            // Soft-delete the file
            await prisma.files.update({
              where: { id: existing.id },
              data: { deleted_at: new Date(), deletion_status: 'pending' },
            });
            const resolvedName = item.name || existing.name;
            this.emitSyncEvent(userId, SYNC_WS_EVENTS.SYNC_FILE_REMOVED, {
              connectionId,
              scopeId,
              fileId: existing.id,
              fileName: resolvedName,
            });
            result.deletedFiles++;

            logger.info({
              fileId: existing.id, externalId: item.id, fileName: resolvedName,
            }, 'File soft-deleted during delta sync');
          }
        } catch (changeErr) {
          const errorInfo =
            changeErr instanceof Error
              ? { message: changeErr.message, name: changeErr.name }
              : { value: String(changeErr) };
          logger.warn(
            {
              error: errorInfo,
              externalItemId: item.id,
              itemName: item.name,
              changeType: change.changeType,
              connectionId,
              scopeId,
            },
            'Skipping change due to processing error'
          );
        }
      }

      // 6c: Process folders sorted by depth (parents before children)
      const sortedFolders = sortFoldersByDepth(folderChanges);

      for (const change of sortedFolders) {
        try {
          await upsertFolder({
            item: change.item,
            connectionId,
            scopeId,
            userId,
            microsoftDriveId: effectiveDriveId,
            folderMap,
            provider: connection.provider,
          });
        } catch (folderErr) {
          const errorInfo =
            folderErr instanceof Error
              ? { message: folderErr.message, name: folderErr.name }
              : { value: String(folderErr) };
          logger.warn(
            {
              error: errorInfo,
              externalItemId: change.item.id,
              itemName: change.item.name,
              connectionId,
              scopeId,
            },
            'Skipping folder change due to processing error'
          );
        }
      }

      // 6d: Process files
      for (const change of fileChanges) {
        const item = change.item;

        try {
          if (!isFileSyncSupported(item.mimeType)) {
            result.skipped++;
            continue;
          }

          const existing = await prisma.files.findFirst({
            where: { connection_id: connectionId, external_id: item.id },
            select: { id: true, content_hash_external: true },
          });

          if (existing) {
            // eTag matches — no content change
            if (existing.content_hash_external === (item.eTag ?? null)) {
              result.skipped++;
              continue;
            }

            // eTag changed — clear embeddings, reset pipeline, re-enqueue
            try {
              await VectorSearchService.getInstance().deleteChunksForFile(existing.id, userId);
            } catch (vecErr) {
              const errorInfo =
                vecErr instanceof Error
                  ? { message: vecErr.message, name: vecErr.name }
                  : { value: String(vecErr) };
              logger.warn(
                { error: errorInfo, fileId: existing.id, connectionId, scopeId },
                'Failed to delete vector chunks for updated file — continuing'
              );
            }

            await prisma.file_chunks.deleteMany({ where: { file_id: existing.id } });

            const parentFolderId = resolveParentFolderId(item.parentId, folderMap);

            await prisma.files.update({
              where: { id: existing.id },
              data: {
                name: item.name,
                mime_type: item.mimeType ?? 'application/octet-stream',
                size_bytes: BigInt(item.sizeBytes ?? 0),
                external_url: item.webUrl || null,
                external_modified_at: item.lastModifiedAt
                  ? new Date(item.lastModifiedAt)
                  : null,
                file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
                content_hash_external: item.eTag ?? null,
                parent_folder_id: parentFolderId,
                pipeline_status: 'queued',
                last_synced_at: new Date(),
              },
            });

            await getMessageQueue().addFileProcessingFlow({
              fileId: existing.id,
              batchId: scopeId,
              userId,
              mimeType: item.mimeType ?? 'application/octet-stream',
              fileName: item.name,
            });

            this.emitSyncEvent(userId, SYNC_WS_EVENTS.SYNC_FILE_UPDATED, {
              connectionId,
              scopeId,
              fileId: existing.id,
              fileName: item.name,
              sourceType: connection.provider === 'sharepoint'
                ? FILE_SOURCE_TYPE.SHAREPOINT
                : FILE_SOURCE_TYPE.ONEDRIVE,
            });

            result.updatedFiles++;
          } else {
            // New file
            const fileId = randomUUID().toUpperCase();
            const parentFolderId = resolveParentFolderId(item.parentId, folderMap);

            await prisma.files.create({
              data: {
                id: fileId,
                user_id: userId,
                name: item.name,
                mime_type: item.mimeType ?? 'application/octet-stream',
                size_bytes: BigInt(item.sizeBytes ?? 0),
                blob_path: null,
                is_folder: false,
                source_type: connection.provider === 'sharepoint'
                  ? FILE_SOURCE_TYPE.SHAREPOINT
                  : FILE_SOURCE_TYPE.ONEDRIVE,
                external_id: item.id,
                external_drive_id: effectiveDriveId,
                connection_id: connectionId,
                connection_scope_id: scopeId,
                external_url: item.webUrl || null,
                external_modified_at: item.lastModifiedAt
                  ? new Date(item.lastModifiedAt)
                  : null,
                file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
                content_hash_external: item.eTag ?? null,
                parent_folder_id: parentFolderId,
                pipeline_status: 'queued',
                is_favorite: false,
              },
            });

            await getMessageQueue().addFileProcessingFlow({
              fileId,
              batchId: scopeId,
              userId,
              mimeType: item.mimeType ?? 'application/octet-stream',
              fileName: item.name,
            });

            this.emitSyncEvent(userId, SYNC_WS_EVENTS.SYNC_FILE_ADDED, {
              connectionId,
              scopeId,
              fileId,
              fileName: item.name,
              sourceType: connection.provider === 'sharepoint'
                ? FILE_SOURCE_TYPE.SHAREPOINT
                : FILE_SOURCE_TYPE.ONEDRIVE,
            });

            result.newFiles++;
          }
        } catch (changeErr) {
          const errorInfo =
            changeErr instanceof Error
              ? { message: changeErr.message, name: changeErr.name }
              : { value: String(changeErr) };
          logger.warn(
            {
              error: errorInfo,
              externalItemId: item.id,
              itemName: item.name,
              changeType: change.changeType,
              connectionId,
              scopeId,
            },
            'Skipping change due to processing error'
          );
        }
      }

      const processingTotal = result.newFiles + result.updatedFiles;

      // Step 7: Persist new deltaLink and mark scope synced
      await repo.updateScope(scopeId, {
        syncStatus: 'synced',
        lastSyncAt: new Date(),
        lastSyncError: null,
        lastSyncCursor: deltaLink,
        processingTotal,
        processingCompleted: 0,
        processingFailed: 0,
        processingStatus: processingTotal > 0 ? 'processing' : 'completed',
      });

      logger.info(
        {
          connectionId,
          scopeId,
          userId,
          triggerType,
          newFiles: result.newFiles,
          updatedFiles: result.updatedFiles,
          deletedFiles: result.deletedFiles,
          skipped: result.skipped,
        },
        'Delta sync completed'
      );

      // Step 8: Emit sync:completed
      this.emitSyncEvent(userId, SYNC_WS_EVENTS.SYNC_COMPLETED, {
        connectionId,
        scopeId,
        totalFiles: result.newFiles + result.updatedFiles + result.deletedFiles,
        newFiles: result.newFiles,
        updatedFiles: result.updatedFiles,
        deletedFiles: result.deletedFiles,
        skipped: result.skipped,
        processingTotal,
      });

      // Step 9: Return result
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name, cause: error.cause }
          : { value: String(error) };

      logger.error(
        { error: errorInfo, connectionId, scopeId, userId, triggerType },
        'Delta sync failed'
      );

      try {
        await repo.updateScope(scopeId, {
          syncStatus: 'error',
          lastSyncError: errorMessage,
        });
      } catch (updateErr) {
        const updateErrorInfo =
          updateErr instanceof Error
            ? { message: updateErr.message, name: updateErr.name }
            : { value: String(updateErr) };
        logger.error(
          { error: updateErrorInfo, scopeId },
          'Failed to update scope error status after delta sync failure'
        );
      }

      this.emitSyncEvent(userId, SYNC_WS_EVENTS.SYNC_ERROR, {
        connectionId,
        scopeId,
        error: errorMessage,
      });

      throw error;
    }
  }

  // ============================================================================
  // WebSocket emission helper
  // ============================================================================

  private emitSyncEvent(userId: string, eventName: string, data: unknown): void {
    if (!isSocketServiceInitialized()) return;
    try {
      getSocketIO().to(`user:${userId}`).emit(eventName, data);
    } catch (err) {
      const errorInfo =
        err instanceof Error ? { message: err.message } : { value: String(err) };
      logger.warn({ error: errorInfo, userId, eventName }, 'Failed to emit sync event');
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: DeltaSyncService | undefined;

/**
 * Returns the singleton DeltaSyncService instance.
 */
export function getDeltaSyncService(): DeltaSyncService {
  if (!instance) {
    instance = new DeltaSyncService();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetDeltaSyncService(): void {
  instance = undefined;
}
