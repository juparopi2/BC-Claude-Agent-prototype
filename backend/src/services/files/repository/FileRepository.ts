/**
 * FileRepository
 *
 * Responsible for database operations on files.
 * Uses FileQueryBuilder for SQL construction.
 *
 * Key Responsibilities:
 * - CRUD operations for files and folders
 * - Multi-tenant isolation (all queries include user_id)
 * - Result parsing (snake_case -> camelCase)
 *
 * Design:
 * - Uses dependency injection for testability
 * - Delegates query construction to FileQueryBuilder
 * - All IDs are UPPERCASE per project convention
 */

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
import { getFileQueryBuilder, type FileQueryBuilder } from './FileQueryBuilder';

/**
 * File metadata for deletion operations
 */
export interface FileMetadata {
  blobPath: string;
  isFolder: boolean;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Result of marking files for deletion
 */
export interface MarkForDeletionResult {
  /** IDs that were successfully marked */
  markedIds: string[];
  /** Number of files marked */
  markedCount: number;
}

/**
 * Repository interface for dependency injection
 */
export interface IFileRepository {
  findById(userId: string, fileId: string): Promise<ParsedFile | null>;
  findByIdIncludingDeleted(userId: string, fileId: string): Promise<ParsedFile | null>;
  findMany(options: GetFilesOptions): Promise<ParsedFile[]>;
  count(userId: string, folderId?: string | null, options?: { favoritesFirst?: boolean }): Promise<number>;
  create(options: CreateFileOptions): Promise<string>;
  createFolder(userId: string, name: string, parentId?: string): Promise<string>;
  findIdsByOwner(userId: string, fileIds: string[]): Promise<string[]>;
  update(userId: string, fileId: string, updates: UpdateFileOptions): Promise<void>;
  updateProcessingStatus(userId: string, fileId: string, status: ProcessingStatus, extractedText?: string): Promise<void>;
  delete(userId: string, fileId: string): Promise<void>;
  getFileMetadata(userId: string, fileId: string): Promise<FileMetadata | null>;
  getChildrenIds(userId: string, folderId: string): Promise<string[]>;
  markForDeletion(userId: string, fileIds: string[]): Promise<MarkForDeletionResult>;
  updateDeletionStatus(userId: string, fileIds: string[], status: 'deleting' | 'failed'): Promise<void>;
}

/**
 * FileRepository - Database operations for files
 */
export class FileRepository implements IFileRepository {
  private static instance: FileRepository | null = null;
  private logger: Logger;
  private queryBuilder: FileQueryBuilder;

  private constructor(deps?: { queryBuilder?: FileQueryBuilder }) {
    this.logger = createChildLogger({ service: 'FileRepository' });
    this.queryBuilder = deps?.queryBuilder ?? getFileQueryBuilder();
  }

  public static getInstance(): FileRepository {
    if (!FileRepository.instance) {
      FileRepository.instance = new FileRepository();
    }
    return FileRepository.instance;
  }

  /**
   * Find a single file by ID with ownership check
   */
  public async findById(userId: string, fileId: string): Promise<ParsedFile | null> {
    this.logger.info({ userId, fileId }, 'Finding file by ID');

    try {
      const { query, params } = this.queryBuilder.buildGetFileByIdQuery(userId, fileId);
      const result = await executeQuery<FileDbRecord>(query, params as SqlParams);

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
      this.logger.error({ error, userId, fileId }, 'Failed to find file by ID');
      throw error;
    }
  }

  /**
   * Find multiple files with filtering, sorting, and pagination
   */
  public async findMany(options: GetFilesOptions): Promise<ParsedFile[]> {
    const { userId, folderId, sortBy, favoritesFirst, limit, offset } = options;

    this.logger.info({ userId, folderId, sortBy, favoritesFirst, limit, offset }, 'Getting files');

    try {
      const { query, params } = this.queryBuilder.buildGetFilesQuery(options);
      const result = await executeQuery<FileDbRecord>(query, params as SqlParams);

      this.logger.info({ userId, count: result.recordset.length }, 'Files retrieved');

      return result.recordset.map((record) => parseFile(record));
    } catch (error) {
      this.logger.error({ error, userId, folderId }, 'Failed to get files');
      throw error;
    }
  }

  /**
   * Count files in a folder
   */
  public async count(
    userId: string,
    folderId?: string | null,
    options?: { favoritesFirst?: boolean }
  ): Promise<number> {
    this.logger.info({ userId, folderId, options }, 'Getting file count');

    try {
      const { query, params } = this.queryBuilder.buildGetFileCountQuery(userId, folderId, options);
      const result = await executeQuery<{ count: number }>(query, params as SqlParams);

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

  /**
   * Create a file record
   */
  public async create(options: CreateFileOptions): Promise<string> {
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
   * Create a folder
   */
  public async createFolder(userId: string, name: string, parentId?: string): Promise<string> {
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
   * Find IDs of files owned by user (batch ownership check)
   */
  public async findIdsByOwner(userId: string, fileIds: string[]): Promise<string[]> {
    if (fileIds.length === 0) {
      return [];
    }

    this.logger.info({ userId, fileCount: fileIds.length }, 'Verifying file ownership');

    try {
      const { query, params } = this.queryBuilder.buildVerifyOwnershipQuery(userId, fileIds);
      const result = await executeQuery<{ id: string }>(query, params as SqlParams);
      const ownedIds = result.recordset.map((r) => r.id);

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
   * Update file metadata
   */
  public async update(userId: string, fileId: string, updates: UpdateFileOptions): Promise<void> {
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

      if (updates.blobPath !== undefined) {
        setClauses.push('blob_path = @blob_path');
        params.blob_path = updates.blobPath;
      }

      if (updates.contentHash !== undefined) {
        setClauses.push('content_hash = @content_hash');
        params.content_hash = updates.contentHash;
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
   * Update file processing status
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
   * Delete a file record
   */
  public async delete(userId: string, fileId: string): Promise<void> {
    this.logger.info({ userId, fileId }, 'Deleting file record');

    try {
      const query = `
        DELETE FROM files
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      await executeQuery(query, params);

      this.logger.info({ userId, fileId }, 'File record deleted');
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to delete file record');
      throw error;
    }
  }

  /**
   * Get file metadata for deletion operations
   */
  public async getFileMetadata(userId: string, fileId: string): Promise<FileMetadata | null> {
    this.logger.info({ userId, fileId }, 'Getting file metadata');

    try {
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
        return null;
      }

      const record = result.recordset[0];
      if (!record) {
        return null;
      }

      return {
        blobPath: record.blob_path,
        isFolder: record.is_folder,
        name: record.name,
        mimeType: record.mime_type,
        sizeBytes: record.size_bytes,
      };
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to get file metadata');
      throw error;
    }
  }

  /**
   * Get IDs of children in a folder
   */
  public async getChildrenIds(userId: string, folderId: string): Promise<string[]> {
    this.logger.info({ userId, folderId }, 'Getting children IDs');

    try {
      const query = `
        SELECT id
        FROM files
        WHERE parent_folder_id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: folderId,
        user_id: userId,
      };

      const result = await executeQuery<{ id: string }>(query, params);

      return result.recordset.map((r) => r.id);
    } catch (error) {
      this.logger.error({ error, userId, folderId }, 'Failed to get children IDs');
      throw error;
    }
  }

  /**
   * Mark files for deletion (soft delete Phase 1)
   *
   * Sets deletion_status = 'pending' and deleted_at = NOW() for files
   * that are currently active (deletion_status IS NULL).
   *
   * @param userId - User ID
   * @param fileIds - Array of file IDs to mark for deletion
   * @returns IDs that were successfully marked
   */
  public async markForDeletion(userId: string, fileIds: string[]): Promise<MarkForDeletionResult> {
    if (fileIds.length === 0) {
      return { markedIds: [], markedCount: 0 };
    }

    this.logger.info({ userId, fileCount: fileIds.length }, 'Marking files for deletion');

    try {
      const { query, params } = this.queryBuilder.buildMarkForDeletionQuery(userId, fileIds);
      const result = await executeQuery<{ id: string }>(query, params as SqlParams);

      const markedIds = result.recordset.map((r) => r.id);

      this.logger.info({
        userId,
        requestedCount: fileIds.length,
        markedCount: markedIds.length,
      }, 'Files marked for deletion');

      return { markedIds, markedCount: markedIds.length };
    } catch (error) {
      this.logger.error({ error, userId, fileCount: fileIds.length }, 'Failed to mark files for deletion');
      throw error;
    }
  }

  /**
   * Update deletion status for files
   *
   * Used during physical deletion process to track progress.
   *
   * @param userId - User ID
   * @param fileIds - Array of file IDs to update
   * @param status - New deletion status ('deleting' or 'failed')
   */
  public async updateDeletionStatus(
    userId: string,
    fileIds: string[],
    status: 'deleting' | 'failed'
  ): Promise<void> {
    if (fileIds.length === 0) {
      return;
    }

    this.logger.info({ userId, fileCount: fileIds.length, status }, 'Updating deletion status');

    try {
      const { query, params } = this.queryBuilder.buildUpdateDeletionStatusQuery(userId, fileIds, status);
      await executeQuery(query, params as SqlParams);

      this.logger.info({ userId, fileCount: fileIds.length, status }, 'Deletion status updated');
    } catch (error) {
      this.logger.error({ error, userId, fileCount: fileIds.length, status }, 'Failed to update deletion status');
      throw error;
    }
  }

  /**
   * Find a single file by ID including deleted files
   *
   * Used by deletion worker to process files that are marked for deletion.
   *
   * @param userId - User ID
   * @param fileId - File ID
   * @returns File or null if not found
   */
  public async findByIdIncludingDeleted(userId: string, fileId: string): Promise<ParsedFile | null> {
    this.logger.info({ userId, fileId }, 'Finding file by ID (including deleted)');

    try {
      const { query, params } = this.queryBuilder.buildGetFileByIdIncludingDeletedQuery(userId, fileId);
      const result = await executeQuery<FileDbRecord>(query, params as SqlParams);

      if (result.recordset.length === 0) {
        this.logger.info({ userId, fileId }, 'File not found');
        return null;
      }

      const record = result.recordset[0];
      if (!record) {
        this.logger.info({ userId, fileId }, 'File not found');
        return null;
      }

      this.logger.info({ userId, fileId }, 'File retrieved (including deleted)');
      return parseFile(record);
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to find file by ID (including deleted)');
      throw error;
    }
  }
}

/**
 * Get singleton instance of FileRepository
 */
export function getFileRepository(): FileRepository {
  return FileRepository.getInstance();
}

/**
 * Reset singleton for testing
 */
export function __resetFileRepository(): void {
  (FileRepository as unknown as { instance: FileRepository | null }).instance = null;
}
