/**
 * FileQueryBuilder
 *
 * Responsible for constructing SQL queries for file operations.
 * Handles proper NULL comparison (IS NULL vs = NULL) and parameterization.
 *
 * Key Design Decisions:
 * - Extracts SQL construction from FileService for testability
 * - Ensures IS NULL is used correctly (SQL: column = NULL is ALWAYS false)
 * - All queries are parameterized to prevent SQL injection
 *
 * Usage:
 * ```typescript
 * const builder = getFileQueryBuilder();
 * const { query, params } = builder.buildGetFilesQuery({ userId, folderId });
 * const result = await executeQuery(query, params);
 * ```
 */

import type { FileSortBy } from '@/types/file.types';

/**
 * Result of a query builder method
 */
export interface QueryResult {
  query: string;
  params: Record<string, unknown>;
}

/**
 * Options for building getFiles query
 */
export interface GetFilesQueryOptions {
  userId: string;
  folderId?: string | null;
  sortBy?: FileSortBy;
  favoritesFirst?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Options for file count query
 */
export interface GetFileCountOptions {
  favoritesFirst?: boolean;
}

/**
 * Result of building an IN clause
 */
export interface InClauseResult {
  placeholders: string;
  params: Record<string, string>;
}

/**
 * FileQueryBuilder - Constructs SQL queries for file operations
 */
export class FileQueryBuilder {
  private static instance: FileQueryBuilder | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): FileQueryBuilder {
    if (!FileQueryBuilder.instance) {
      FileQueryBuilder.instance = new FileQueryBuilder();
    }
    return FileQueryBuilder.instance;
  }

  /**
   * Build query for getting files with filtering, sorting, and pagination
   *
   * Automatically excludes files marked for deletion (deletion_status IS NOT NULL).
   *
   * @param options - Query options
   * @returns Query string and parameters
   */
  public buildGetFilesQuery(options: GetFilesQueryOptions): QueryResult {
    const {
      userId,
      folderId,
      sortBy = 'date',
      favoritesFirst = false,
      limit = 50,
      offset = 0,
    } = options;

    // Build WHERE clause - always exclude files marked for deletion
    let whereClause = 'WHERE user_id = @user_id AND deletion_status IS NULL';
    const params: Record<string, unknown> = {
      user_id: userId,
      offset,
      limit,
    };

    const isAtRoot = folderId === undefined || folderId === null;

    if (favoritesFirst) {
      // "Favorites first" mode - show all items, favorites sorted first
      if (isAtRoot) {
        // At root: return favorites from ANY folder + all root items
        whereClause += ' AND (is_favorite = 1 OR parent_folder_id IS NULL)';
      } else {
        // In folder: return all items in folder (sorting handles favorites first)
        whereClause += ' AND parent_folder_id = @parent_folder_id';
        params.parent_folder_id = folderId;
      }
    } else {
      // Standard behavior: filter by folder only
      if (isAtRoot) {
        whereClause += ' AND parent_folder_id IS NULL';
      } else {
        whereClause += ' AND parent_folder_id = @parent_folder_id';
        params.parent_folder_id = folderId;
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

    return { query, params };
  }

  /**
   * Build query for getting file count
   *
   * Automatically excludes files marked for deletion (deletion_status IS NOT NULL).
   *
   * @param userId - User ID
   * @param folderId - Folder ID (undefined/null for root)
   * @param options - Additional options
   * @returns Query string and parameters
   */
  public buildGetFileCountQuery(
    userId: string,
    folderId?: string | null,
    options?: GetFileCountOptions
  ): QueryResult {
    // Always exclude files marked for deletion
    let whereClause = 'WHERE user_id = @user_id AND deletion_status IS NULL';
    const params: Record<string, unknown> = {
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

    return { query, params };
  }

  /**
   * Build query for checking duplicate files by name
   *
   * Automatically excludes files marked for deletion (deletion_status IS NOT NULL).
   *
   * @param userId - User ID
   * @param fileName - File name to check
   * @param folderId - Folder ID (undefined/null for root)
   * @returns Query string and parameters
   */
  public buildCheckDuplicateQuery(
    userId: string,
    fileName: string,
    folderId?: string | null
  ): QueryResult {
    const isAtRoot = folderId === undefined || folderId === null;
    const params: Record<string, unknown> = {
      user_id: userId,
      name: fileName,
    };

    let query: string;

    if (isAtRoot) {
      query = `
        SELECT *
        FROM files
        WHERE user_id = @user_id
          AND name = @name
          AND parent_folder_id IS NULL
          AND is_folder = 0
          AND deletion_status IS NULL
      `;
    } else {
      query = `
        SELECT *
        FROM files
        WHERE user_id = @user_id
          AND name = @name
          AND parent_folder_id = @parent_folder_id
          AND is_folder = 0
          AND deletion_status IS NULL
      `;
      params.parent_folder_id = folderId;
    }

    return { query, params };
  }

  /**
   * Build parameterized IN clause for multiple IDs
   *
   * @param ids - Array of IDs
   * @param paramPrefix - Prefix for parameter names
   * @returns Placeholders string and params object
   */
  public buildInClause(ids: string[], paramPrefix: string): InClauseResult {
    if (ids.length === 0) {
      return { placeholders: '', params: {} };
    }

    const placeholders = ids.map((_, i) => `@${paramPrefix}${i}`).join(', ');
    const params: Record<string, string> = {};
    ids.forEach((id, i) => {
      params[`${paramPrefix}${i}`] = id;
    });

    return { placeholders, params };
  }

  /**
   * Build query for finding files by content hash
   *
   * Automatically excludes files marked for deletion (deletion_status IS NOT NULL).
   *
   * @param userId - User ID
   * @param contentHash - SHA-256 content hash
   * @returns Query string and parameters
   */
  public buildFindByContentHashQuery(userId: string, contentHash: string): QueryResult {
    const query = `
      SELECT *
      FROM files
      WHERE user_id = @user_id
        AND content_hash = @content_hash
        AND is_folder = 0
        AND deletion_status IS NULL
    `;

    const params: Record<string, unknown> = {
      user_id: userId,
      content_hash: contentHash,
    };

    return { query, params };
  }

  /**
   * Build query for getting a single file by ID with ownership check
   *
   * Automatically excludes files marked for deletion (deletion_status IS NOT NULL).
   *
   * @param userId - User ID
   * @param fileId - File ID
   * @returns Query string and parameters
   */
  public buildGetFileByIdQuery(userId: string, fileId: string): QueryResult {
    const query = `
      SELECT *
      FROM files
      WHERE id = @id AND user_id = @user_id AND deletion_status IS NULL
    `;

    const params: Record<string, unknown> = {
      id: fileId,
      user_id: userId,
    };

    return { query, params };
  }

  /**
   * Build query for verifying ownership of multiple files
   *
   * Automatically excludes files marked for deletion (deletion_status IS NOT NULL).
   *
   * @param userId - User ID
   * @param fileIds - Array of file IDs to verify
   * @returns Query string and parameters
   */
  public buildVerifyOwnershipQuery(userId: string, fileIds: string[]): QueryResult {
    const inClause = this.buildInClause(fileIds, 'id');

    const query = `
      SELECT id
      FROM files
      WHERE user_id = @user_id AND id IN (${inClause.placeholders}) AND deletion_status IS NULL
    `;

    const params: Record<string, unknown> = {
      user_id: userId,
      ...inClause.params,
    };

    return { query, params };
  }

  /**
   * Build query for marking files for deletion (soft delete Phase 1)
   *
   * @param userId - User ID
   * @param fileIds - Array of file IDs to mark for deletion
   * @returns Query string and parameters
   */
  public buildMarkForDeletionQuery(userId: string, fileIds: string[]): QueryResult {
    const inClause = this.buildInClause(fileIds, 'id');

    const query = `
      UPDATE files
      SET deletion_status = 'pending',
          deleted_at = GETUTCDATE(),
          updated_at = GETUTCDATE()
      OUTPUT INSERTED.id
      WHERE user_id = @user_id
        AND id IN (${inClause.placeholders})
        AND deletion_status IS NULL
    `;

    const params: Record<string, unknown> = {
      user_id: userId,
      ...inClause.params,
    };

    return { query, params };
  }

  /**
   * Build query for updating deletion status
   *
   * @param userId - User ID
   * @param fileIds - Array of file IDs to update
   * @param status - New deletion status ('deleting' or 'failed')
   * @returns Query string and parameters
   */
  public buildUpdateDeletionStatusQuery(
    userId: string,
    fileIds: string[],
    status: 'deleting' | 'failed'
  ): QueryResult {
    const inClause = this.buildInClause(fileIds, 'id');

    const query = `
      UPDATE files
      SET deletion_status = @status,
          updated_at = GETUTCDATE()
      WHERE user_id = @user_id
        AND id IN (${inClause.placeholders})
    `;

    const params: Record<string, unknown> = {
      user_id: userId,
      status,
      ...inClause.params,
    };

    return { query, params };
  }

  /**
   * Build query for getting files pending deletion (for cleanup job)
   *
   * @param maxAgeMinutes - Maximum age in minutes for pending deletions
   * @param limit - Maximum number of files to return
   * @returns Query string and parameters
   */
  public buildGetPendingDeletionsQuery(maxAgeMinutes: number, limit: number): QueryResult {
    const query = `
      SELECT id, user_id, blob_path, name, is_folder
      FROM files
      WHERE deletion_status IN ('pending', 'deleting')
        AND deleted_at < DATEADD(MINUTE, -@max_age, GETUTCDATE())
      ORDER BY deleted_at ASC
      OFFSET 0 ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const params: Record<string, unknown> = {
      max_age: maxAgeMinutes,
      limit,
    };

    return { query, params };
  }

  /**
   * Build query for getting file by ID including deleted files
   * Used by deletion worker to process files marked for deletion
   *
   * @param userId - User ID
   * @param fileId - File ID
   * @returns Query string and parameters
   */
  public buildGetFileByIdIncludingDeletedQuery(userId: string, fileId: string): QueryResult {
    const query = `
      SELECT *
      FROM files
      WHERE id = @id AND user_id = @user_id
    `;

    const params: Record<string, unknown> = {
      id: fileId,
      user_id: userId,
    };

    return { query, params };
  }

  /**
   * Build query for checking if a folder with the given name exists
   *
   * Checks for exact name match for folders (is_folder = 1).
   * Automatically excludes folders marked for deletion.
   *
   * @param userId - User ID
   * @param folderName - Folder name to check
   * @param parentFolderId - Parent folder ID (undefined/null for root)
   * @returns Query string and parameters
   */
  public buildCheckFolderExistsQuery(
    userId: string,
    folderName: string,
    parentFolderId?: string | null
  ): QueryResult {
    const isAtRoot = parentFolderId === undefined || parentFolderId === null;
    const params: Record<string, unknown> = {
      user_id: userId,
      name: folderName,
    };

    let query: string;

    if (isAtRoot) {
      query = `
        SELECT id, name
        FROM files
        WHERE user_id = @user_id
          AND name = @name
          AND parent_folder_id IS NULL
          AND is_folder = 1
          AND deletion_status IS NULL
      `;
    } else {
      query = `
        SELECT id, name
        FROM files
        WHERE user_id = @user_id
          AND name = @name
          AND parent_folder_id = @parent_folder_id
          AND is_folder = 1
          AND deletion_status IS NULL
      `;
      params.parent_folder_id = parentFolderId;
    }

    return { query, params };
  }

  /**
   * Build query for finding folders by name pattern
   *
   * Finds folders matching a base name or base name with suffix pattern.
   * E.g., "Documents", "Documents (1)", "Documents (2)", etc.
   *
   * @param userId - User ID
   * @param baseName - Base folder name (without suffix)
   * @param parentFolderId - Parent folder ID (undefined/null for root)
   * @returns Query string and parameters
   */
  public buildFindFoldersByNamePatternQuery(
    userId: string,
    baseName: string,
    parentFolderId?: string | null
  ): QueryResult {
    const isAtRoot = parentFolderId === undefined || parentFolderId === null;

    // Match exact name or name with suffix pattern: "name (N)"
    // Using LIKE pattern: "baseName" OR "baseName ([0-9]%)"
    const params: Record<string, unknown> = {
      user_id: userId,
      exact_name: baseName,
      pattern_name: `${baseName} ([0-9]%)`, // SQL LIKE pattern
    };

    let query: string;

    if (isAtRoot) {
      query = `
        SELECT name
        FROM files
        WHERE user_id = @user_id
          AND (name = @exact_name OR name LIKE @pattern_name)
          AND parent_folder_id IS NULL
          AND is_folder = 1
          AND deletion_status IS NULL
      `;
    } else {
      query = `
        SELECT name
        FROM files
        WHERE user_id = @user_id
          AND (name = @exact_name OR name LIKE @pattern_name)
          AND parent_folder_id = @parent_folder_id
          AND is_folder = 1
          AND deletion_status IS NULL
      `;
      params.parent_folder_id = parentFolderId;
    }

    return { query, params };
  }
}

/**
 * Get singleton instance of FileQueryBuilder
 */
export function getFileQueryBuilder(): FileQueryBuilder {
  return FileQueryBuilder.getInstance();
}

/**
 * Reset singleton for testing
 */
export function __resetFileQueryBuilder(): void {
  (FileQueryBuilder as unknown as { instance: FileQueryBuilder | null }).instance = null;
}
