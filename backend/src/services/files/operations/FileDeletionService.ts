/**
 * FileDeletionService
 *
 * Handles GDPR-compliant cascading deletion of files.
 * Coordinates deletion across:
 * - Database (files table + CASCADE to file_chunks)
 * - Azure Blob Storage (returns paths for cleanup)
 * - Azure AI Search (vector embeddings)
 * - Audit logging for compliance
 *
 * Design:
 * - Eventual consistency for AI Search (errors logged, not thrown)
 * - Recursive deletion for folders
 * - Audit trail for GDPR Article 17 compliance
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import { VectorSearchService } from '@services/search/VectorSearchService';
import { getDeletionAuditService } from '../DeletionAuditService';
import { getFileRepository, type IFileRepository } from '../repository/FileRepository';

/**
 * Options for file deletion
 */
export interface DeletionOptions {
  /** Skip audit logging (used for recursive child deletions) */
  skipAudit?: boolean;
  /** Reason for deletion */
  deletionReason?: 'user_request' | 'gdpr_erasure' | 'retention_policy' | 'admin_action';
}

/**
 * Interface for dependency injection
 */
export interface IFileDeletionService {
  delete(userId: string, fileId: string, options?: DeletionOptions): Promise<string[]>;
}

/**
 * FileDeletionService - GDPR-compliant cascading deletion
 */
export class FileDeletionService implements IFileDeletionService {
  private static instance: FileDeletionService | null = null;
  private logger: Logger;
  private repository: IFileRepository;

  private constructor(deps?: { repository?: IFileRepository }) {
    this.logger = createChildLogger({ service: 'FileDeletionService' });
    this.repository = deps?.repository ?? getFileRepository();
  }

  public static getInstance(): FileDeletionService {
    if (!FileDeletionService.instance) {
      FileDeletionService.instance = new FileDeletionService();
    }
    return FileDeletionService.instance;
  }

  /**
   * Delete a file or folder with GDPR-compliant cascade
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File or folder ID
   * @param options - Deletion options
   * @returns Array of blob paths to cleanup
   */
  public async delete(
    userId: string,
    fileId: string,
    options?: DeletionOptions
  ): Promise<string[]> {
    this.logger.info({ userId, fileId }, 'Deleting file/folder (GDPR-compliant cascade)');

    // Collect blob paths and file IDs for cleanup
    const blobsToDelete: string[] = [];
    const fileIdsToCleanFromSearch: string[] = [];
    let auditId: string | undefined;
    let childFilesCount = 0;

    try {
      // 1. Get file metadata
      const metadata = await this.repository.getFileMetadata(userId, fileId);

      if (!metadata) {
        // Idempotent: if not found, assume deleted
        return [];
      }

      const { blobPath, isFolder, name, mimeType, sizeBytes } = metadata;

      // 2. Start GDPR audit logging (only for top-level deletion)
      if (!options?.skipAudit) {
        try {
          const auditService = getDeletionAuditService();
          auditId = await auditService.logDeletionRequest({
            userId,
            resourceType: isFolder ? 'folder' : 'file',
            resourceId: fileId,
            resourceName: name,
            deletionReason: options?.deletionReason || 'user_request',
            metadata: {
              mimeType,
              sizeBytes,
              isFolder,
            },
          });
        } catch (auditError) {
          // Log but don't fail deletion if audit fails
          this.logger.warn({ error: auditError, fileId }, 'Failed to create deletion audit record');
        }
      }

      // 3. If folder, recursively delete children first (skip audit for children)
      if (isFolder) {
        const childrenIds = await this.repository.getChildrenIds(userId, fileId);
        childFilesCount = childrenIds.length;

        for (const childId of childrenIds) {
          const childBlobs = await this.delete(userId, childId, { skipAudit: true });
          blobsToDelete.push(...childBlobs);
        }
      } else {
        // If file (not folder), collect for AI Search cleanup
        fileIdsToCleanFromSearch.push(fileId);

        if (blobPath) {
          blobsToDelete.push(blobPath);
        }
      }

      // 4. Delete current record from database
      // CASCADE FK will automatically delete file_chunks
      await this.repository.delete(userId, fileId);

      this.logger.info({ userId, fileId, isFolder }, 'Record deleted from DB');

      // Update audit: DB deletion successful
      if (auditId) {
        try {
          const auditService = getDeletionAuditService();
          await auditService.updateStorageStatus(auditId, {
            deletedFromDb: true,
            childFilesDeleted: childFilesCount,
          });
        } catch (auditError) {
          this.logger.warn({ error: auditError, auditId }, 'Failed to update audit record (DB)');
        }
      }

      // 5. GDPR: Clean up AI Search embeddings (eventual consistency)
      let searchCleanupSuccess = true;
      if (fileIdsToCleanFromSearch.length > 0) {
        searchCleanupSuccess = await this.cleanupAISearchEmbeddings(userId, fileIdsToCleanFromSearch);
      }

      // Update audit: AI Search cleanup status and mark completed
      if (auditId) {
        try {
          const auditService = getDeletionAuditService();
          await auditService.updateStorageStatus(auditId, {
            deletedFromSearch: searchCleanupSuccess,
            // Blob deletion happens in the route after this returns
            deletedFromBlob: blobsToDelete.length > 0 || isFolder,
          });
          // Mark as completed (blob deletion is eventual consistency)
          const finalStatus = searchCleanupSuccess ? 'completed' : 'partial';
          await auditService.markCompleted(auditId, finalStatus);
        } catch (auditError) {
          this.logger.warn({ error: auditError, auditId }, 'Failed to finalize audit record');
        }
      }

      return blobsToDelete;
    } catch (error) {
      // Mark audit as failed if we have an audit ID
      if (auditId) {
        try {
          const auditService = getDeletionAuditService();
          await auditService.markCompleted(auditId, 'failed', String(error));
        } catch (auditError) {
          this.logger.warn({ error: auditError, auditId }, 'Failed to mark audit as failed');
        }
      }

      this.logger.error({ error, userId, fileId }, 'Failed to delete file');
      throw error;
    }
  }

  /**
   * Clean up AI Search embeddings for deleted files
   *
   * Uses eventual consistency - errors are logged but don't fail the deletion
   */
  private async cleanupAISearchEmbeddings(userId: string, fileIds: string[]): Promise<boolean> {
    let allSucceeded = true;

    try {
      const vectorSearchService = VectorSearchService.getInstance();

      for (const fileId of fileIds) {
        try {
          await vectorSearchService.deleteChunksForFile(fileId, userId);
          this.logger.info({ userId, fileId }, 'AI Search embeddings deleted');
        } catch (searchError) {
          // Log but don't fail - eventual consistency model
          allSucceeded = false;
          this.logger.warn(
            { error: searchError, userId, fileId },
            'Failed to delete AI Search embeddings (will be cleaned by orphan cleanup job)'
          );
        }
      }
    } catch (error) {
      // Catch-all for VectorSearchService initialization errors
      allSucceeded = false;
      this.logger.warn(
        { error, userId, fileIds },
        'VectorSearchService unavailable - AI Search cleanup skipped'
      );
    }

    return allSucceeded;
  }
}

/**
 * Get singleton instance of FileDeletionService
 */
export function getFileDeletionService(): FileDeletionService {
  return FileDeletionService.getInstance();
}

/**
 * Reset singleton for testing
 */
export function __resetFileDeletionService(): void {
  (FileDeletionService as unknown as { instance: FileDeletionService | null }).instance = null;
}
