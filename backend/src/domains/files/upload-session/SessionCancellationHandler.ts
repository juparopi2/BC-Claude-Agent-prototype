/**
 * SessionCancellationHandler
 *
 * Handles cancellation of upload sessions with intelligent rollback.
 * Cleans up files created during the upload process based on their state.
 *
 * Rollback Logic:
 * - Files in 'pending' state: No action needed (nothing created yet)
 * - Files registered in DB: Soft delete via existing deletion pipeline
 * - Files uploaded to blob: Deleted via deletion worker
 * - Files with embeddings: Search docs cleaned up via deletion worker
 *
 * Key Design:
 * - Reuses existing SoftDeleteService for consistent deletion
 * - Non-blocking: Returns quickly, cleanup happens asynchronously
 * - Idempotent: Safe to call multiple times
 *
 * @module domains/files/upload-session/SessionCancellationHandler
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import type { CancelSessionResult, UploadSession } from '@bc-agent/shared';
import type { IUploadSessionStore } from './IUploadSessionStore';
import { getUploadSessionStore } from './UploadSessionStore';
import { getSoftDeleteService, type ISoftDeleteService } from '@/services/files/operations/SoftDeleteService';
import { getFileRepository, type IFileRepository } from '@/services/files/repository/FileRepository';

/**
 * Dependencies for SessionCancellationHandler (DI support for testing)
 */
export interface SessionCancellationHandlerDependencies {
  logger?: Logger;
  sessionStore?: IUploadSessionStore;
  softDeleteService?: ISoftDeleteService;
  fileRepository?: IFileRepository;
}

/**
 * SessionCancellationHandler - Cancels upload sessions with cleanup
 *
 * @example
 * ```typescript
 * const handler = getSessionCancellationHandler();
 * const result = await handler.cancelSession(sessionId, userId);
 * console.log(`Deleted ${result.filesDeleted} files`);
 * ```
 */
export class SessionCancellationHandler {
  private static instance: SessionCancellationHandler | null = null;

  private readonly log: Logger;
  private readonly sessionStore: IUploadSessionStore;
  private readonly getSoftDelete: () => ISoftDeleteService;
  private readonly getFileRepo: () => IFileRepository;

  private constructor(deps?: SessionCancellationHandlerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'SessionCancellationHandler' });
    this.sessionStore = deps?.sessionStore ?? getUploadSessionStore();

    // Use getter functions for lazy initialization
    if (deps?.softDeleteService) {
      const svc = deps.softDeleteService;
      this.getSoftDelete = () => svc;
    } else {
      this.getSoftDelete = () => getSoftDeleteService();
    }

    if (deps?.fileRepository) {
      const repo = deps.fileRepository;
      this.getFileRepo = () => repo;
    } else {
      this.getFileRepo = () => getFileRepository();
    }
  }

  public static getInstance(deps?: SessionCancellationHandlerDependencies): SessionCancellationHandler {
    if (!SessionCancellationHandler.instance) {
      SessionCancellationHandler.instance = new SessionCancellationHandler(deps);
    }
    return SessionCancellationHandler.instance;
  }

  public static resetInstance(): void {
    SessionCancellationHandler.instance = null;
  }

  /**
   * Cancel an upload session and rollback any created resources
   *
   * Process:
   * 1. Validate session exists and belongs to user
   * 2. Collect all file IDs from folder batches
   * 3. Soft-delete all files (triggers async cleanup)
   * 4. Delete empty folders created during upload
   * 5. Remove session from Redis
   *
   * @param sessionId - Session ID to cancel
   * @param userId - User ID (for ownership verification)
   * @returns Cancellation result with cleanup summary
   */
  async cancelSession(sessionId: string, userId: string): Promise<CancelSessionResult> {
    this.log.info({ sessionId, userId }, 'Cancelling upload session');

    // Get session
    const session = await this.sessionStore.get(sessionId);

    if (!session) {
      this.log.warn({ sessionId }, 'Session not found for cancellation');
      return {
        sessionId,
        completedFolders: 0,
        cancelledFolders: 0,
        filesDeleted: 0,
        blobsDeleted: 0,
        searchDocsDeleted: 0,
        foldersDeleted: 0,
        errors: [{ fileId: sessionId, error: 'Session not found' }],
      };
    }

    // Verify ownership
    if (session.userId !== userId) {
      this.log.warn({ sessionId, userId, sessionUserId: session.userId }, 'Access denied for session cancellation');
      throw new Error('Access denied: session belongs to another user');
    }

    // Check if session is already completed or failed
    if (session.status === 'completed') {
      this.log.info({ sessionId }, 'Session already completed, skipping cleanup');
      // Still delete the session from Redis
      await this.sessionStore.delete(sessionId);
      return {
        sessionId,
        completedFolders: session.totalFolders,
        cancelledFolders: 0,
        filesDeleted: 0,
        blobsDeleted: 0,
        searchDocsDeleted: 0,
        foldersDeleted: 0,
        errors: [],
      };
    }

    // Calculate folder counts
    const completedFolders = session.folderBatches.filter(b => b.status === 'completed').length;
    const cancelledFolders = session.totalFolders - completedFolders;

    const result: CancelSessionResult = {
      sessionId,
      completedFolders,
      cancelledFolders,
      filesDeleted: 0,
      blobsDeleted: 0, // Will be updated by async deletion worker
      searchDocsDeleted: 0, // Will be updated by async deletion worker
      foldersDeleted: 0,
      errors: [],
    };

    try {
      // Mark session as cancelled first (so no new operations can start)
      await this.sessionStore.update(sessionId, { status: 'cancelled' });

      // Collect all file IDs from batches that have been registered
      const folderIds = this.collectCreatedFolderIds(session);
      const fileIds = await this.collectRegisteredFileIds(session.userId, folderIds);

      this.log.info(
        { sessionId, fileCount: fileIds.length, folderCount: folderIds.length },
        'Collected resources for cleanup'
      );

      // Soft-delete all files (this triggers async blob/search cleanup)
      if (fileIds.length > 0) {
        const softDeleteService = this.getSoftDelete();
        const deleteResult = await softDeleteService.markForDeletion(userId, fileIds, {
          deletionReason: 'user_request',
        });
        result.filesDeleted = deleteResult.markedForDeletion;
        // Note: blobsDeleted and searchDocsDeleted will be handled by the async worker
      }

      // Delete empty folders (folders created during upload that are now empty)
      if (folderIds.length > 0) {
        const foldersDeleted = await this.deleteEmptyFolders(userId, folderIds);
        result.foldersDeleted = foldersDeleted;
      }

      // Remove session from Redis
      await this.sessionStore.delete(sessionId);

      this.log.info(
        { sessionId, result },
        'Upload session cancelled successfully'
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error(
        { sessionId, error: errorMessage },
        'Error during session cancellation'
      );
      result.errors.push({ fileId: sessionId, error: errorMessage });

      // Still try to delete the session from Redis
      try {
        await this.sessionStore.delete(sessionId);
      } catch (deleteError) {
        this.log.error({ sessionId, error: deleteError }, 'Failed to delete session from Redis');
      }
    }

    return result;
  }

  /**
   * Collect file IDs from folders created during the upload session
   *
   * Queries the database to find all files (not folders) within the
   * folders created during this upload session.
   *
   * @param userId - User ID for the query
   * @param folderIds - Folder IDs to search for files
   * @returns Array of file IDs to delete
   */
  private async collectRegisteredFileIds(userId: string, folderIds: string[]): Promise<string[]> {
    if (folderIds.length === 0) {
      return [];
    }

    const fileRepo = this.getFileRepo();
    const allFileIds: string[] = [];

    for (const folderId of folderIds) {
      try {
        const childIds = await fileRepo.getChildrenIds(userId, folderId);

        // Filter to only include files (not subfolders)
        // We need to check each child to see if it's a file or folder
        // For now, include all children - the soft delete will handle both
        this.log.debug(
          { folderId, childCount: childIds.length },
          'Found children in folder for cleanup'
        );

        allFileIds.push(...childIds);
      } catch (error) {
        this.log.warn(
          { folderId, error: error instanceof Error ? error.message : String(error) },
          'Failed to get children for folder during cancellation'
        );
      }
    }

    // Remove duplicates (in case of nested structures)
    const uniqueFileIds = [...new Set(allFileIds)];

    this.log.info(
      { totalFiles: uniqueFileIds.length, folderCount: folderIds.length },
      'Collected file IDs for rollback'
    );

    return uniqueFileIds;
  }

  /**
   * Collect folder IDs that were created during the upload
   */
  private collectCreatedFolderIds(session: UploadSession): string[] {
    const folderIds: string[] = [];

    // Process in reverse order (children before parents)
    const batches = [...session.folderBatches].reverse();

    for (const batch of batches) {
      if (batch.folderId) {
        folderIds.push(batch.folderId);
      }
    }

    return folderIds;
  }

  /**
   * Delete folders created during upload (children first)
   *
   * Uses soft-delete pipeline to handle cascade deletion properly.
   * Files inside folders are already soft-deleted, so we just need
   * to mark the folders for deletion as well.
   */
  private async deleteEmptyFolders(userId: string, folderIds: string[]): Promise<number> {
    if (folderIds.length === 0) {
      return 0;
    }

    // Folders are already in reverse order (children first from collectCreatedFolderIds)
    // Delete all folders - their children (files) are already soft-deleted
    try {
      const softDeleteService = this.getSoftDelete();
      const result = await softDeleteService.markForDeletion(userId, folderIds, {
        deletionReason: 'user_request',
      });

      this.log.info(
        { folderCount: folderIds.length, deletedCount: result.markedForDeletion },
        'Folders marked for deletion during cancellation'
      );

      return result.markedForDeletion;
    } catch (error) {
      this.log.error(
        { folderIds, error: error instanceof Error ? error.message : String(error) },
        'Failed to delete folders during cancellation'
      );
      return 0;
    }
  }
}

/**
 * Get singleton instance of SessionCancellationHandler
 */
export function getSessionCancellationHandler(
  deps?: SessionCancellationHandlerDependencies
): SessionCancellationHandler {
  return SessionCancellationHandler.getInstance(deps);
}

/**
 * Reset singleton for testing
 */
export function __resetSessionCancellationHandler(): void {
  SessionCancellationHandler.resetInstance();
}
