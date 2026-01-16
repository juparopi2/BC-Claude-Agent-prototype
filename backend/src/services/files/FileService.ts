import { createChildLogger } from '@/shared/utils/logger';
import { executeQuery, SqlParams } from '@/infrastructure/database/database';
import type { Logger } from 'pino';
import { randomUUID } from 'crypto';
import {
  FileDbRecord,
  ParsedFile,
  parseFile,
  GetFilesOptions,
  CreateFileOptions,
  UpdateFileOptions,
  ProcessingStatus,
} from '@/types/file.types';
import { VectorSearchService } from '@services/search/VectorSearchService';
import { getDeletionAuditService } from './DeletionAuditService';
import { getFileRetryService } from '@/domains/files/retry';

/**
 * File Service
 *
 * Provides CRUD operations for files and folders with multi-tenant isolation.
 * All operations are scoped to userId to prevent cross-user access.
 */
export class FileService {
  private static instance: FileService | null = null;
  private logger: Logger;

  private constructor() {
    this.logger = createChildLogger({ service: 'FileService' });
    this.logger.info('FileService initialized');
  }

  public static getInstance(): FileService {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  /**
   * 1. Get files with filtering, sorting, pagination
   *
   * @param options - Query options
   * @returns Array of parsed files
   */
  public async getFiles(options: GetFilesOptions): Promise<ParsedFile[]> {
    const { userId, folderId, sortBy = 'date', favoritesFirst, limit = 50, offset = 0 } = options;

    this.logger.info({ userId, folderId, sortBy, favoritesFirst, limit, offset }, 'Getting files');

    try {
      // Build WHERE clause
      let whereClause = 'WHERE user_id = @user_id';
      const isAtRoot = folderId === undefined || folderId === null;

      if (favoritesFirst) {
        // "Favorites first" mode - show all items, favorites sorted first
        if (isAtRoot) {
          // At root: return favorites from ANY folder + all root items
          whereClause += ' AND (is_favorite = 1 OR parent_folder_id IS NULL)';
        } else {
          // In folder: return all items in folder (sorting handles favorites first)
          whereClause += ' AND parent_folder_id = @parent_folder_id';
        }
      } else {
        // Standard behavior: filter by folder only
        if (isAtRoot) {
          whereClause += ' AND parent_folder_id IS NULL';
        } else {
          whereClause += ' AND parent_folder_id = @parent_folder_id';
        }
      }

      // Build ORDER BY clause
      let orderByClause = 'ORDER BY ';

      // When favoritesFirst is enabled, sort favorites to the top
      if (favoritesFirst) {
        orderByClause += 'is_favorite DESC, ';
      }

      // Then folders before files
      orderByClause += 'is_folder DESC, ';

      // Then by user's sort preference
      switch (sortBy) {
        case 'name':
          orderByClause += 'name ASC';
          break;
        case 'size':
          orderByClause += 'size_bytes DESC';
          break;
        case 'date':
        default:
          orderByClause += 'created_at DESC';
      }

      const query = `
        SELECT *
        FROM files
        ${whereClause}
        ${orderByClause}
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      const params: SqlParams = {
        user_id: userId,
        offset,
        limit,
      };

      // Add parent_folder_id parameter if in a subfolder (not at root)
      if (!isAtRoot || (favoritesFirst && !isAtRoot)) {
        if (folderId !== undefined && folderId !== null) {
          params.parent_folder_id = folderId;
        }
      }

      const result = await executeQuery<FileDbRecord>(query, params);

      this.logger.info({ userId, count: result.recordset.length }, 'Files retrieved');

      return result.recordset.map((record) => parseFile(record));
    } catch (error) {
      this.logger.error({ error, userId, folderId }, 'Failed to get files');
      throw error;
    }
  }

  /**
   * 2. Get single file with ownership validation
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @returns Parsed file or null if not found
   */
  public async getFile(userId: string, fileId: string): Promise<ParsedFile | null> {
    this.logger.info({ userId, fileId }, 'Getting file');

    try {
      const query = `
        SELECT *
        FROM files
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery<FileDbRecord>(query, params);

      if (result.recordset.length === 0) {
        this.logger.info({ userId, fileId }, 'File not found');
        return null;
      }

      const record = result.recordset[0];
      if (!record) {
        this.logger.info({ userId, fileId }, 'File not found');
        return null;
      }

      this.logger.info({ userId, fileId }, 'File retrieved');
      return parseFile(record);
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to get file');
      throw error;
    }
  }

  /**
   * 2b. Verify ownership of multiple files
   *
   * Returns only the file IDs that the user owns.
   * Used for bulk operations to filter out unauthorized file IDs.
   *
   * @param userId - User ID to verify ownership against
   * @param fileIds - Array of file IDs to verify
   * @returns Array of file IDs that the user owns
   */
  public async verifyOwnership(userId: string, fileIds: string[]): Promise<string[]> {
    if (fileIds.length === 0) {
      return [];
    }

    this.logger.info({ userId, fileCount: fileIds.length }, 'Verifying file ownership');

    try {
      // Build parameterized query to prevent SQL injection
      const placeholders = fileIds.map((_, i) => `@id${i}`).join(', ');
      const query = `
        SELECT id
        FROM files
        WHERE user_id = @user_id AND id IN (${placeholders})
      `;

      const params: SqlParams = { user_id: userId };
      fileIds.forEach((id, i) => {
        params[`id${i}`] = id;
      });

      const result = await executeQuery<{ id: string }>(query, params);
      const ownedIds = result.recordset.map(r => r.id);

      this.logger.info({
        userId,
        requestedCount: fileIds.length,
        ownedCount: ownedIds.length,
      }, 'Ownership verification complete');

      return ownedIds;
    } catch (error) {
      this.logger.error({ error, userId, fileCount: fileIds.length }, 'Failed to verify file ownership');
      throw error;
    }
  }

  /**
   * 3. Create folder
   *
   * @param userId - User ID
   * @param name - Folder name
   * @param parentId - Parent folder ID (optional)
   * @returns Created folder ID
   */
  public async createFolder(
    userId: string,
    name: string,
    parentId?: string
  ): Promise<string> {
    // All IDs must be UPPERCASE per CLAUDE.md
    const folderId = randomUUID().toUpperCase();

    this.logger.info({ userId, name, parentId, folderId }, 'Creating folder');

    try {
      const query = `
        INSERT INTO files (
          id, user_id, parent_folder_id, name, mime_type, size_bytes, blob_path,
          is_folder, is_favorite, processing_status, embedding_status, extracted_text,
          created_at, updated_at
        )
        VALUES (
          @id, @user_id, @parent_folder_id, @name, @mime_type, @size_bytes, @blob_path,
          @is_folder, @is_favorite, @processing_status, @embedding_status, @extracted_text,
          GETUTCDATE(), GETUTCDATE()
        )
      `;

      const params: SqlParams = {
        id: folderId,
        user_id: userId,
        parent_folder_id: parentId || null,
        name,
        mime_type: 'inode/directory',
        size_bytes: 0,
        blob_path: '',
        is_folder: true,
        is_favorite: false,
        processing_status: 'completed',
        embedding_status: 'completed',
        extracted_text: null,
      };

      await executeQuery(query, params);

      this.logger.info({ userId, folderId }, 'Folder created');
      return folderId;
    } catch (error) {
      this.logger.error({ error, userId, name, parentId }, 'Failed to create folder');
      throw error;
    }
  }

  /**
   * 4. Create file record (called after blob upload)
   *
   * @param options - File creation options
   * @returns Created file ID
   */
  public async createFileRecord(options: CreateFileOptions): Promise<string> {
    // All IDs must be UPPERCASE per CLAUDE.md
    const fileId = randomUUID().toUpperCase();
    const { userId, name, mimeType, sizeBytes, blobPath, parentFolderId, contentHash } = options;

    // Prevent storing blob path as name (catches bugs early)
    if (name.match(/^\d{13}-/) || name.includes('users/')) {
      this.logger.error({ name, blobPath }, 'Invalid file name: looks like blob path');
      throw new Error('File name cannot be a blob path. Use original filename.');
    }

    this.logger.info({ userId, name, sizeBytes, fileId, hasHash: !!contentHash }, 'Creating file record');

    try {
      const query = `
        INSERT INTO files (
          id, user_id, parent_folder_id, name, mime_type, size_bytes, blob_path,
          is_folder, is_favorite, processing_status, embedding_status, extracted_text,
          content_hash, created_at, updated_at
        )
        VALUES (
          @id, @user_id, @parent_folder_id, @name, @mime_type, @size_bytes, @blob_path,
          @is_folder, @is_favorite, @processing_status, @embedding_status, @extracted_text,
          @content_hash, GETUTCDATE(), GETUTCDATE()
        )
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
        parent_folder_id: parentFolderId || null,
        name,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        blob_path: blobPath,
        is_folder: false,
        is_favorite: false,
        processing_status: 'pending',
        embedding_status: 'pending',
        extracted_text: null,
        content_hash: contentHash || null,
      };

      await executeQuery(query, params);

      this.logger.info({ userId, fileId }, 'File record created');
      return fileId;
    } catch (error) {
      this.logger.error({ error, userId, name }, 'Failed to create file record');
      throw error;
    }
  }

  /**
   * 5. Update file metadata
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @param updates - Fields to update
   */
  public async updateFile(
    userId: string,
    fileId: string,
    updates: UpdateFileOptions
  ): Promise<void> {
    this.logger.info({ userId, fileId, updates }, 'Updating file');

    try {
      // Build SET clause dynamically
      const setClauses: string[] = ['updated_at = GETUTCDATE()'];
      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      if (updates.name !== undefined) {
        setClauses.push('name = @name');
        params.name = updates.name;
      }

      if (updates.parentFolderId !== undefined) {
        setClauses.push('parent_folder_id = @parent_folder_id');
        params.parent_folder_id = updates.parentFolderId;
      }

      if (updates.isFavorite !== undefined) {
        setClauses.push('is_favorite = @is_favorite');
        params.is_favorite = updates.isFavorite;
      }

      if (setClauses.length === 1) {
        this.logger.info({ userId, fileId }, 'No updates to apply');
        return;
      }

      const query = `
        UPDATE files
        SET ${setClauses.join(', ')}
        WHERE id = @id AND user_id = @user_id
      `;

      const result = await executeQuery(query, params);

      if (result.rowsAffected[0] === 0) {
        throw new Error('File not found or unauthorized');
      }

      this.logger.info({ userId, fileId }, 'File updated');
    } catch (error) {
      this.logger.error({ error, userId, fileId, updates }, 'Failed to update file');
      throw error;
    }
  }

  /**
   * 6. Toggle favorite flag
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @returns New favorite status
   */
  public async toggleFavorite(userId: string, fileId: string): Promise<boolean> {
    this.logger.info({ userId, fileId }, 'Toggling favorite');

    try {
      // First, get current status
      const currentFile = await this.getFile(userId, fileId);
      if (!currentFile) {
        throw new Error('File not found or unauthorized');
      }

      const newStatus = !currentFile.isFavorite;

      // Update favorite status
      const query = `
        UPDATE files
        SET is_favorite = @is_favorite, updated_at = GETUTCDATE()
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
        is_favorite: newStatus,
      };

      await executeQuery(query, params);

      this.logger.info({ userId, fileId, newStatus }, 'Favorite toggled');
      return newStatus;
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to toggle favorite');
      throw error;
    }
  }

  /**
   * 7. Move file to different folder
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @param newParentId - New parent folder ID (null for root)
   */
  public async moveFile(
    userId: string,
    fileId: string,
    newParentId: string | null
  ): Promise<void> {
    this.logger.info({ userId, fileId, newParentId }, 'Moving file');

    try {
      const query = `
        UPDATE files
        SET parent_folder_id = @parent_folder_id, updated_at = GETUTCDATE()
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
        parent_folder_id: newParentId,
      };

      const result = await executeQuery(query, params);

      if (result.rowsAffected[0] === 0) {
        throw new Error('File not found or unauthorized');
      }

      this.logger.info({ userId, fileId, newParentId }, 'File moved');
    } catch (error) {
      this.logger.error({ error, userId, fileId, newParentId }, 'Failed to move file');
      throw error;
    }
  }

  /**
   * 8. Delete file/folder recursively (returns list of blob_paths for cleanup)
   *
   * GDPR Compliance: This method now implements cascading deletion across all storage:
   * - Database (files, file_chunks via CASCADE)
   * - Azure Blob Storage (returned paths for caller to delete)
   * - Azure AI Search (vector embeddings deleted directly)
   * - Audit logging for compliance reporting
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @param options - Optional deletion options
   * @returns Array of blob paths to cleanup
   */
  public async deleteFile(
    userId: string,
    fileId: string,
    options?: { skipAudit?: boolean; deletionReason?: 'user_request' | 'gdpr_erasure' | 'retention_policy' | 'admin_action' }
  ): Promise<string[]> {
    this.logger.info({ userId, fileId }, 'Deleting file/folder (GDPR-compliant cascade)');

    // Collect all blob paths and file IDs for cleanup
    const blobsToDelete: string[] = [];
    const fileIdsToCleanFromSearch: string[] = [];
    let auditId: string | undefined;
    let childFilesCount = 0;

    try {
      // 1. Get file metadata
      const query = `
        SELECT blob_path, is_folder, name, mime_type, size_bytes
        FROM files
        WHERE id = @id AND user_id = @user_id
        `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery<{
        blob_path: string;
        is_folder: boolean;
        name: string;
        mime_type: string;
        size_bytes: number;
      }>(query, params);

      if (result.recordset.length === 0) {
        // Idempotent: if not found, assume deleted
        return [];
      }

      const record = result.recordset[0];
      if (!record) {
          return [];
      }
      const { blob_path, is_folder, name, mime_type, size_bytes } = record;

      // 2. Start GDPR audit logging (only for top-level deletion, not recursive calls)
      if (!options?.skipAudit) {
        try {
          const auditService = getDeletionAuditService();
          auditId = await auditService.logDeletionRequest({
            userId,
            resourceType: is_folder ? 'folder' : 'file',
            resourceId: fileId,
            resourceName: name,
            deletionReason: options?.deletionReason || 'user_request',
            metadata: {
              mimeType: mime_type,
              sizeBytes: size_bytes,
              isFolder: is_folder,
            },
          });
        } catch (auditError) {
          // Log but don't fail deletion if audit fails
          this.logger.warn({ error: auditError, fileId }, 'Failed to create deletion audit record');
        }
      }

      // 3. If folder, recursively delete children first (skip audit for children)
      if (is_folder) {
        const childrenQuery = `
          SELECT id
          FROM files
          WHERE parent_folder_id = @id AND user_id = @user_id
        `;

        const childrenResult = await executeQuery<{ id: string }>(childrenQuery, params);
        childFilesCount = childrenResult.recordset.length;

        for (const child of childrenResult.recordset) {
          const childBlobs = await this.deleteFile(userId, child.id, { skipAudit: true });
          blobsToDelete.push(...childBlobs);
        }
      } else {
        // If file (not folder), collect for AI Search cleanup
        fileIdsToCleanFromSearch.push(fileId);

        if (blob_path) {
          blobsToDelete.push(blob_path);
        }
      }

      // 4. Delete current record from database
      // CASCADE FK will automatically delete file_chunks
      const deleteQuery = `
        DELETE FROM files
        WHERE id = @id AND user_id = @user_id
      `;

      await executeQuery(deleteQuery, params);

      this.logger.info({ userId, fileId, isFolder: is_folder }, 'Record deleted from DB');

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
      // This runs after DB deletion - if it fails, data is orphaned but DB is clean
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
            // We mark deletedFromBlob as true since we're returning paths for cleanup
            deletedFromBlob: blobsToDelete.length > 0 || is_folder,
          });
          // Mark as completed (blob deletion is eventual consistency - happens after this returns)
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
   * This ensures the primary deletion (DB + Blob) succeeds even if AI Search is down
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileIds - Array of file IDs to clean up
   * @returns true if all cleanups succeeded, false if any failed
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
          // Orphaned embeddings can be cleaned up by scheduled job
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

  /**
   * 9. Update file processing status (for background workers)
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @param status - New processing status
   * @param extractedText - Optional extracted text content
   */
  public async updateProcessingStatus(
    userId: string,
    fileId: string,
    status: ProcessingStatus,
    extractedText?: string
  ): Promise<void> {
    this.logger.info({ userId, fileId, status, hasText: !!extractedText }, 'Updating processing status');

    try {
      const setClauses: string[] = [
        'processing_status = @status',
        'updated_at = GETUTCDATE()',
      ];
      const params: SqlParams = {
        id: fileId,
        user_id: userId,
        status,
      };

      if (extractedText !== undefined) {
        setClauses.push('extracted_text = @extracted_text');
        params.extracted_text = extractedText;
      }

      const query = `
        UPDATE files
        SET ${setClauses.join(', ')}
        WHERE id = @id AND user_id = @user_id
      `;

      const result = await executeQuery(query, params);

      if (result.rowsAffected[0] === 0) {
        throw new Error('File not found or unauthorized');
      }

      this.logger.info({ userId, fileId, status }, 'Processing status updated');
    } catch (error) {
      this.logger.error({ error, userId, fileId, status }, 'Failed to update processing status');
      throw error;
    }
  }

  /**
   * 10. Check for duplicate file (D20)
   *
   * Detects if a file with the same name already exists in the specified folder.
   * Used during upload to warn users about potential overwrites.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileName - Name of the file to check
   * @param folderId - Folder ID to check in (null/undefined for root)
   * @returns Object with isDuplicate flag and existing file if found
   */
  public async checkDuplicate(
    userId: string,
    fileName: string,
    folderId?: string | null
  ): Promise<{ isDuplicate: boolean; existingFile?: ParsedFile }> {
    this.logger.info({ userId, fileName, folderId }, 'Checking for duplicate file');

    try {
      const isAtRoot = folderId === undefined || folderId === null;

      // Build query to find matching file (not folder) with same name
      let query: string;
      const params: SqlParams = {
        user_id: userId,
        name: fileName,
      };

      if (isAtRoot) {
        query = `
          SELECT *
          FROM files
          WHERE user_id = @user_id
            AND name = @name
            AND parent_folder_id IS NULL
            AND is_folder = 0
        `;
      } else {
        query = `
          SELECT *
          FROM files
          WHERE user_id = @user_id
            AND name = @name
            AND parent_folder_id = @parent_folder_id
            AND is_folder = 0
        `;
        params.parent_folder_id = folderId;
      }

      const result = await executeQuery<FileDbRecord>(query, params);

      if (result.recordset.length === 0) {
        this.logger.info({ userId, fileName, folderId }, 'No duplicate found');
        return { isDuplicate: false };
      }

      const existingFile = parseFile(result.recordset[0]!);
      this.logger.info(
        { userId, fileName, folderId, existingFileId: existingFile.id },
        'Duplicate file found'
      );

      return { isDuplicate: true, existingFile };
    } catch (error) {
      this.logger.error({ error, userId, fileName, folderId }, 'Failed to check for duplicate');
      throw error;
    }
  }

  /**
   * 11. Check for multiple duplicate files (D20 - batch)
   *
   * Efficiently checks multiple files for duplicates in a single operation.
   * Used during multi-file upload to detect conflicts.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param files - Array of files to check (name and optional folderId)
   * @returns Array of results with duplicate status for each file
   */
  public async checkDuplicatesBatch(
    userId: string,
    files: Array<{ name: string; folderId?: string | null }>
  ): Promise<Array<{ name: string; isDuplicate: boolean; existingFile?: ParsedFile }>> {
    this.logger.info({ userId, fileCount: files.length }, 'Checking for duplicate files (batch)');

    try {
      // For simplicity and correctness, check each file individually
      // This could be optimized with a single query if performance becomes an issue
      const results: Array<{ name: string; isDuplicate: boolean; existingFile?: ParsedFile }> = [];

      for (const file of files) {
        const checkResult = await this.checkDuplicate(userId, file.name, file.folderId);
        results.push({
          name: file.name,
          isDuplicate: checkResult.isDuplicate,
          existingFile: checkResult.existingFile,
        });
      }

      this.logger.info(
        { userId, total: files.length, duplicates: results.filter((r) => r.isDuplicate).length },
        'Batch duplicate check completed'
      );

      return results;
    } catch (error) {
      this.logger.error({ error, userId, fileCount: files.length }, 'Failed batch duplicate check');
      throw error;
    }
  }

  /**
   * 12. Find files by content hash (for duplicate detection)
   *
   * Searches the user's entire repository for files with matching SHA-256 hash.
   * Used to detect duplicates based on file content regardless of filename.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param contentHash - SHA-256 hash to search for (64-char hex string)
   * @returns Matching files (if any)
   */
  public async findByContentHash(
    userId: string,
    contentHash: string
  ): Promise<ParsedFile[]> {
    this.logger.info({ userId, contentHash: contentHash.substring(0, 8) + '...' }, 'Finding files by content hash');

    try {
      const query = `
        SELECT *
        FROM files
        WHERE user_id = @user_id
          AND content_hash = @content_hash
          AND is_folder = 0
      `;

      const params: SqlParams = {
        user_id: userId,
        content_hash: contentHash,
      };

      const result = await executeQuery<FileDbRecord>(query, params);

      this.logger.info({ userId, matches: result.recordset.length }, 'Content hash search completed');

      return result.recordset.map((record) => parseFile(record));
    } catch (error) {
      this.logger.error({ error, userId, contentHash }, 'Failed to find files by content hash');
      throw error;
    }
  }

  /**
   * 13. Check duplicates by content hash (batch)
   *
   * Efficiently checks multiple files for duplicates based on content hash.
   * Used during multi-file upload to detect content-identical files.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param items - Array of files to check with their content hashes
   * @returns Array of results with duplicate status for each file
   */
  public async checkDuplicatesByHash(
    userId: string,
    items: Array<{ tempId: string; contentHash: string; fileName: string }>
  ): Promise<Array<{ tempId: string; isDuplicate: boolean; existingFile?: ParsedFile }>> {
    this.logger.info({ userId, itemCount: items.length }, 'Checking duplicates by content hash (batch)');

    try {
      const results: Array<{ tempId: string; isDuplicate: boolean; existingFile?: ParsedFile }> = [];

      for (const item of items) {
        const matches = await this.findByContentHash(userId, item.contentHash);

        if (matches.length > 0) {
          results.push({
            tempId: item.tempId,
            isDuplicate: true,
            existingFile: matches[0], // Return first match
          });
        } else {
          results.push({
            tempId: item.tempId,
            isDuplicate: false,
          });
        }
      }

      this.logger.info(
        { userId, total: items.length, duplicates: results.filter((r) => r.isDuplicate).length },
        'Batch content hash duplicate check completed'
      );

      return results;
    } catch (error) {
      this.logger.error({ error, userId, itemCount: items.length }, 'Failed batch content hash duplicate check');
      throw error;
    }
  }

  /**
   * 14. Get file count in folder (for UI badges)
   *
   * @param userId - User ID
   * @param folderId - Folder ID (undefined for root)
   * @param options - Optional filter options (favoritesFirst)
   * @returns File count
   */
  public async getFileCount(
    userId: string,
    folderId?: string | null,
    options?: { favoritesFirst?: boolean }
  ): Promise<number> {
    this.logger.info({ userId, folderId, options }, 'Getting file count');

    try {
      let whereClause = 'WHERE user_id = @user_id';
      const params: SqlParams = {
        user_id: userId,
      };
      const isAtRoot = folderId === undefined || folderId === null;

      if (options?.favoritesFirst) {
        // "Favorites first" mode - count all items that would be shown
        if (isAtRoot) {
          // At root: count favorites from ANY folder + root items
          whereClause += ' AND (is_favorite = 1 OR parent_folder_id IS NULL)';
        } else {
          // In folder: count all items in folder
          whereClause += ' AND parent_folder_id = @parent_folder_id';
          params.parent_folder_id = folderId;
        }
      } else {
        // Standard behavior: count by folder only
        if (isAtRoot) {
          whereClause += ' AND parent_folder_id IS NULL';
        } else {
          whereClause += ' AND parent_folder_id = @parent_folder_id';
          params.parent_folder_id = folderId;
        }
      }

      const query = `
        SELECT COUNT(*) as count
        FROM files
        ${whereClause}
      `;

      const result = await executeQuery<{ count: number }>(query, params);

      const record = result.recordset[0];
      if (!record) {
        throw new Error('Failed to get file count');
      }

      const count = record.count;
      this.logger.info({ userId, folderId, count }, 'File count retrieved');

      return count;
    } catch (error) {
      this.logger.error({ error, userId, folderId }, 'Failed to get file count');
      throw error;
    }
  }

  // ============================================
  // Phase 5: Retry Tracking Methods (Delegated to FileRetryService)
  // ============================================
  // These methods delegate to FileRetryService for SRP compliance.
  // Direct usage of FileRetryService is preferred for new code.

  /**
   * 15. Increment processing retry count (Phase 5)
   * @deprecated Prefer using getFileRetryService().incrementProcessingRetryCount() directly
   */
  public async incrementProcessingRetryCount(
    userId: string,
    fileId: string
  ): Promise<number> {
    return getFileRetryService().incrementProcessingRetryCount(userId, fileId);
  }

  /**
   * 16. Increment embedding retry count (Phase 5)
   * @deprecated Prefer using getFileRetryService().incrementEmbeddingRetryCount() directly
   */
  public async incrementEmbeddingRetryCount(
    userId: string,
    fileId: string
  ): Promise<number> {
    return getFileRetryService().incrementEmbeddingRetryCount(userId, fileId);
  }

  /**
   * 17. Set last processing error (Phase 5)
   * @deprecated Prefer using getFileRetryService().setLastProcessingError() directly
   */
  public async setLastProcessingError(
    userId: string,
    fileId: string,
    errorMessage: string
  ): Promise<void> {
    return getFileRetryService().setLastProcessingError(userId, fileId, errorMessage);
  }

  /**
   * 18. Set last embedding error (Phase 5)
   * @deprecated Prefer using getFileRetryService().setLastEmbeddingError() directly
   */
  public async setLastEmbeddingError(
    userId: string,
    fileId: string,
    errorMessage: string
  ): Promise<void> {
    return getFileRetryService().setLastEmbeddingError(userId, fileId, errorMessage);
  }

  /**
   * 19. Mark file as permanently failed (Phase 5)
   * @deprecated Prefer using getFileRetryService().markAsPermanentlyFailed() directly
   */
  public async markAsPermanentlyFailed(
    userId: string,
    fileId: string
  ): Promise<void> {
    return getFileRetryService().markAsPermanentlyFailed(userId, fileId);
  }

  /**
   * 20. Clear failed status for retry (Phase 5)
   * @deprecated Prefer using getFileRetryService().clearFailedStatus() directly
   */
  public async clearFailedStatus(
    userId: string,
    fileId: string,
    scope: 'full' | 'embedding_only' = 'full'
  ): Promise<void> {
    return getFileRetryService().clearFailedStatus(userId, fileId, scope);
  }

  /**
   * 21. Update embedding status (Phase 5)
   * @deprecated Prefer using getFileRetryService().updateEmbeddingStatus() directly
   */
  public async updateEmbeddingStatus(
    userId: string,
    fileId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed'
  ): Promise<void> {
    return getFileRetryService().updateEmbeddingStatus(userId, fileId, status);
  }
}

// Convenience getter
export function getFileService(): FileService {
  return FileService.getInstance();
}

// Reset for testing
export async function __resetFileService(): Promise<void> {
  (FileService as any).instance = null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
