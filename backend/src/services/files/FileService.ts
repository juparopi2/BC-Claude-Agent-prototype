import { createChildLogger } from '@/utils/logger';
import { executeQuery, SqlParams } from '@/config/database';
import type { Logger } from 'pino';
import { randomUUID } from 'crypto';
import {
  FileDbRecord,
  ParsedFile,
  parseFile,
  GetFilesOptions,
  CreateFileOptions,
  UpdateFileOptions,
} from '@/types/file.types';

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
    const { userId, folderId, sortBy = 'date', favorites, limit = 50, offset = 0 } = options;

    this.logger.info({ userId, folderId, sortBy, favorites, limit, offset }, 'Getting files');

    try {
      // Build WHERE clause
      let whereClause = 'WHERE user_id = @user_id';

      // Handle NULL parent_folder_id correctly with IS NULL operator
      // SQL: column = NULL always returns FALSE, must use IS NULL
      if (folderId === undefined || folderId === null) {
        whereClause += ' AND parent_folder_id IS NULL';
      } else {
        whereClause += ' AND parent_folder_id = @parent_folder_id';
      }

      if (favorites) {
        whereClause += ' AND is_favorite = 1';
      }

      // Build ORDER BY clause
      let orderByClause = 'ORDER BY ';
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

      // Only add parent_folder_id parameter if not NULL
      if (folderId !== undefined && folderId !== null) {
        params.parent_folder_id = folderId;
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
    const folderId = randomUUID();

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
    const fileId = randomUUID();
    const { userId, name, mimeType, sizeBytes, blobPath, parentFolderId } = options;

    this.logger.info({ userId, name, sizeBytes, fileId }, 'Creating file record');

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
   * 8. Delete file/folder (returns blob_path for cleanup)
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @returns Blob path for cleanup (or null if folder)
   */
  public async deleteFile(userId: string, fileId: string): Promise<string | null> {
    this.logger.info({ userId, fileId }, 'Deleting file');

    try {
      // First, get file to retrieve blob_path
      const query = `
        SELECT blob_path, is_folder
        FROM files
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery<{ blob_path: string; is_folder: boolean }>(query, params);

      if (result.recordset.length === 0) {
        throw new Error('File not found or unauthorized');
      }

      const record = result.recordset[0];
      if (!record) {
        throw new Error('File not found or unauthorized');
      }

      const { blob_path, is_folder } = record;

      // Delete from database
      const deleteQuery = `
        DELETE FROM files
        WHERE id = @id AND user_id = @user_id
      `;

      await executeQuery(deleteQuery, params);

      this.logger.info({ userId, fileId, isFolder: is_folder }, 'File deleted from DB');

      // Return blob_path for cleanup (null for folders)
      return is_folder ? null : blob_path;
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to delete file');
      throw error;
    }
  }

  /**
   * 9. Get file count in folder (for UI badges)
   *
   * @param userId - User ID
   * @param folderId - Folder ID (undefined for root)
   * @returns File count
   */
  public async getFileCount(userId: string, folderId?: string): Promise<number> {
    this.logger.info({ userId, folderId }, 'Getting file count');

    try {
      let whereClause = 'WHERE user_id = @user_id';
      const params: SqlParams = {
        user_id: userId,
      };

      // Handle NULL parent_folder_id correctly with IS NULL operator
      // SQL: column = NULL always returns FALSE, must use IS NULL
      if (folderId !== undefined) {
        if (folderId === null) {
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
}

// Convenience getter
export function getFileService(): FileService {
  return FileService.getInstance();
}

// Reset for testing
export async function __resetFileService(): Promise<void> {
  (FileService as any).instance = null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
