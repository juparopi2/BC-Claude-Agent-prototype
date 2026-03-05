/**
 * FileRepository (PRD-01)
 *
 * Prisma-based repository for the unified pipeline_status column.
 * Implements optimistic concurrency via atomic WHERE-clause guards.
 *
 * Key features:
 * - `transitionStatus()` — atomic CAS (Compare-And-Swap) on pipeline_status
 * - Multi-tenant isolation (user_id in every WHERE clause)
 * - Soft-delete aware (deletion_status IS NULL filter)
 * - Full CRUD for files and folders
 *
 * @module services/files/repository
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import {
  canTransition,
  getTransitionErrorMessage,
  PIPELINE_STATUS,
  type PipelineStatus,
  type TransitionResult,
} from '@bc-agent/shared';
import type { PrismaClient } from '@prisma/client';
import {
  type FileDbRecord,
  type ParsedFile,
  parseFile,
  type GetFilesOptions,
  type CreateFileOptions,
  type UpdateFileOptions,
} from '@/types/file.types';

const logger = createChildLogger({ service: 'FileRepository' });

// ============================================================================
// Supporting Types
// ============================================================================

export interface FileMetadata {
  blobPath: string;
  isFolder: boolean;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MarkForDeletionResult {
  markedIds: string[];
  markedCount: number;
}

export interface FilePendingProcessing {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blobPath: string;
  parentFolderId: string | null;
}

export interface IFileRepository {
  // CRUD methods
  findById(userId: string, fileId: string): Promise<ParsedFile | null>;
  findByIdIncludingDeleted(userId: string, fileId: string): Promise<ParsedFile | null>;
  findMany(options: GetFilesOptions): Promise<ParsedFile[]>;
  count(userId: string, folderId?: string | null, options?: { favoritesOnly?: boolean }): Promise<number>;
  create(options: CreateFileOptions): Promise<string>;
  createFolder(userId: string, name: string, parentId?: string): Promise<string>;
  findIdsByOwner(userId: string, fileIds: string[]): Promise<string[]>;
  update(userId: string, fileId: string, updates: UpdateFileOptions): Promise<void>;
  updateProcessingStatus(userId: string, fileId: string, status: PipelineStatus, extractedText?: string): Promise<void>;
  saveExtractedText(userId: string, fileId: string, extractedText: string): Promise<void>;
  delete(userId: string, fileId: string): Promise<void>;
  getFileMetadata(userId: string, fileId: string): Promise<FileMetadata | null>;
  getChildrenIds(userId: string, folderId: string): Promise<string[]>;
  markForDeletion(userId: string, fileIds: string[]): Promise<MarkForDeletionResult>;
  updateDeletionStatus(userId: string, fileIds: string[], status: 'deleting' | 'failed'): Promise<void>;
  isFileActiveForProcessing(userId: string, fileId: string): Promise<boolean>;
  getSourceType(userId: string, fileId: string): Promise<string>;
  checkFolderExists(userId: string, name: string, parentId?: string | null): Promise<boolean>;
  findFoldersByNamePattern(userId: string, baseName: string, parentId?: string | null): Promise<string[]>;
  findFolderIdByName(userId: string, name: string, parentId?: string | null): Promise<string | null>;
  getFilesPendingProcessing(limit: number): Promise<FilePendingProcessing[]>;
  findByName(userId: string, fileName: string, folderId: string | null): Promise<ParsedFile | null>;
  findByNameGlobal(userId: string, fileName: string): Promise<ParsedFile | null>;
  findByContentHash(userId: string, contentHash: string): Promise<ParsedFile[]>;
  searchByName(userId: string, query: string, options?: { limit?: number }): Promise<ParsedFile[]>;
  getDescendantFileIds(userId: string, folderId: string): Promise<string[]>;
  // Pipeline methods
  transitionStatus(fileId: string, userId: string, from: PipelineStatus, to: PipelineStatus): Promise<TransitionResult>;
  getPipelineStatus(fileId: string, userId: string): Promise<PipelineStatus | null>;
  findByStatus(status: PipelineStatus, options?: { limit?: number; userId?: string }): Promise<Array<{ id: string; user_id: string; name: string; pipeline_status: string; created_at: Date | null }>>;
  getStatusDistribution(): Promise<Record<PipelineStatus, number>>;
  transitionStatusWithRetry(fileId: string, userId: string, from: PipelineStatus, to: PipelineStatus, retryIncrement?: number): Promise<TransitionResult>;
  findStuckFiles(thresholdMs: number, userId?: string): Promise<Array<{ id: string; user_id: string; name: string; pipeline_status: string; pipeline_retry_count: number; updated_at: Date | null; created_at: Date | null }>>;
  findAbandonedFiles(thresholdMs: number, userId?: string): Promise<Array<{ id: string; user_id: string; name: string; blob_path: string; created_at: Date | null }>>;
  forceStatus(fileId: string, userId: string, status: PipelineStatus): Promise<{ success: boolean; error?: string }>;
}

// ============================================================================
// Repository Implementation
// ============================================================================

export class FileRepository implements IFileRepository {
  private readonly prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? defaultPrisma;
  }

  // --------------------------------------------------------------------------
  // findById
  // --------------------------------------------------------------------------

  /**
   * Find a file by ID, excluding soft-deleted files.
   *
   * @param userId - Owner UUID (UPPERCASE)
   * @param fileId - File UUID (UPPERCASE)
   * @returns ParsedFile or null if not found / soft-deleted
   */
  async findById(userId: string, fileId: string): Promise<ParsedFile | null> {
    const record = await this.prisma.files.findFirst({
      where: {
        id: fileId,
        user_id: userId,
        deletion_status: null,
      },
    });

    if (!record) return null;
    return parseFile(record as unknown as FileDbRecord);
  }

  // --------------------------------------------------------------------------
  // findByIdIncludingDeleted
  // --------------------------------------------------------------------------

  /**
   * Find a file by ID, including soft-deleted files.
   *
   * @param userId - Owner UUID (UPPERCASE)
   * @param fileId - File UUID (UPPERCASE)
   * @returns ParsedFile or null if not found
   */
  async findByIdIncludingDeleted(userId: string, fileId: string): Promise<ParsedFile | null> {
    const record = await this.prisma.files.findFirst({
      where: {
        id: fileId,
        user_id: userId,
      },
    });

    if (!record) return null;
    return parseFile(record as unknown as FileDbRecord);
  }

  // --------------------------------------------------------------------------
  // findMany
  // --------------------------------------------------------------------------

  /**
   * Find files with filtering, sorting, and pagination.
   *
   * Behavior by folderId:
   * - undefined/null: root-level only (parent_folder_id IS NULL)
   * - string: files in that specific folder
   *
   * favoritesOnly at root: returns ONLY favorited items from anywhere in the hierarchy
   * favoritesOnly in folder: returns ALL items in that folder (normal contents)
   *
   * @param options - Query options
   * @returns Array of parsed files
   */
  async findMany(options: GetFilesOptions): Promise<ParsedFile[]> {
    const {
      userId,
      folderId,
      sortBy = 'date',
      favoritesOnly = false,
      limit = 50,
      offset = 0,
    } = options;

    // Build WHERE clause
    const where: Record<string, unknown> = {
      user_id: userId,
      deletion_status: null,
    };

    if (favoritesOnly && (folderId === undefined || folderId === null)) {
      // Favorites mode at root: flat list of ALL favorites
      where['is_favorite'] = true;
    } else if (folderId === undefined || folderId === null) {
      // Normal root: only root-level items
      where['parent_folder_id'] = null;
    } else {
      // Inside a folder: all contents (regardless of favoritesOnly)
      where['parent_folder_id'] = folderId;
    }

    // Build ORDER BY clause
    const orderBy: Array<Record<string, 'asc' | 'desc'>> = [];
    orderBy.push({ is_folder: 'desc' });
    switch (sortBy) {
      case 'name':
        orderBy.push({ name: 'asc' });
        break;
      case 'size':
        orderBy.push({ size_bytes: 'desc' });
        break;
      case 'date':
      default:
        orderBy.push({ file_modified_at: 'desc' });
        orderBy.push({ created_at: 'desc' });
    }

    const records = await this.prisma.files.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
    });

    return records.map((r) => parseFile(r as unknown as FileDbRecord));
  }

  // --------------------------------------------------------------------------
  // count
  // --------------------------------------------------------------------------

  /**
   * Count files matching the given folder and favorites criteria.
   * Uses the same WHERE logic as findMany (without pagination).
   *
   * @param userId        - Owner UUID (UPPERCASE)
   * @param folderId      - Folder filter (undefined = all, null = root, string = folder)
   * @param options       - Optional favoritesOnly flag
   * @returns File count
   */
  async count(
    userId: string,
    folderId?: string | null,
    options?: { favoritesOnly?: boolean },
  ): Promise<number> {
    const favoritesOnly = options?.favoritesOnly ?? false;

    const where: Record<string, unknown> = {
      user_id: userId,
      deletion_status: null,
    };

    if (favoritesOnly && (folderId === undefined || folderId === null)) {
      // Favorites mode at root: flat list of ALL favorites
      where['is_favorite'] = true;
    } else if (folderId === undefined || folderId === null) {
      // Normal root: only root-level items
      where['parent_folder_id'] = null;
    } else {
      // Inside a folder: all contents (regardless of favoritesOnly)
      where['parent_folder_id'] = folderId;
    }

    return this.prisma.files.count({ where });
  }

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------

  /**
   * Create a new file record in the database.
   *
   * Generates a new UPPERCASE UUID for the file.
   * Sets pipeline_status to REGISTERED initially.
   *
   * @param options - File creation options
   * @returns The new file ID (UPPERCASE UUID)
   */
  async create(options: CreateFileOptions): Promise<string> {
    const fileId = randomUUID().toUpperCase();
    const now = new Date();

    await this.prisma.files.create({
      data: {
        id: fileId,
        user_id: options.userId,
        name: options.name,
        mime_type: options.mimeType,
        size_bytes: options.sizeBytes,
        blob_path: options.blobPath,
        parent_folder_id: options.parentFolderId ?? null,
        content_hash: options.contentHash ?? null,
        file_modified_at: options.fileModifiedAt ? new Date(options.fileModifiedAt) : null,
        is_folder: false,
        is_favorite: false,
        pipeline_status: PIPELINE_STATUS.REGISTERED,
        extracted_text: null,
        processing_retry_count: 0,
        embedding_retry_count: 0,
        last_processing_error: null,
        last_embedding_error: null,
        failed_at: null,
        deletion_status: null,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
    });

    logger.debug({ fileId, userId: options.userId, name: options.name }, 'File record created');
    return fileId;
  }

  // --------------------------------------------------------------------------
  // createFolder
  // --------------------------------------------------------------------------

  /**
   * Create a new folder record in the database.
   *
   * Folders are immediately READY (no processing required).
   *
   * @param userId   - Owner UUID (UPPERCASE)
   * @param name     - Folder name
   * @param parentId - Parent folder ID (undefined = root level)
   * @returns The new folder ID (UPPERCASE UUID)
   */
  async createFolder(userId: string, name: string, parentId?: string): Promise<string> {
    const folderId = randomUUID().toUpperCase();
    const now = new Date();

    await this.prisma.files.create({
      data: {
        id: folderId,
        user_id: userId,
        name,
        mime_type: 'inode/directory',
        size_bytes: 0,
        blob_path: '',
        parent_folder_id: parentId ?? null,
        content_hash: null,
        is_folder: true,
        is_favorite: false,
        pipeline_status: PIPELINE_STATUS.READY,
        extracted_text: null,
        processing_retry_count: 0,
        embedding_retry_count: 0,
        last_processing_error: null,
        last_embedding_error: null,
        failed_at: null,
        deletion_status: null,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
    });

    logger.debug({ folderId, userId, name }, 'Folder record created');
    return folderId;
  }

  // --------------------------------------------------------------------------
  // findIdsByOwner
  // --------------------------------------------------------------------------

  /**
   * Find which of the given file IDs belong to this user.
   *
   * Used for ownership verification before operations.
   *
   * @param userId  - Owner UUID (UPPERCASE)
   * @param fileIds - Array of file IDs to check
   * @returns Array of file IDs that belong to this user
   */
  async findIdsByOwner(userId: string, fileIds: string[]): Promise<string[]> {
    if (fileIds.length === 0) return [];

    const records = await this.prisma.files.findMany({
      where: {
        id: { in: fileIds },
        user_id: userId,
      },
      select: { id: true },
    });

    return records.map((r) => r.id);
  }

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------

  /**
   * Partially update a file record.
   *
   * Builds update data dynamically from provided fields.
   * Always sets updated_at to the current timestamp.
   *
   * @param userId  - Owner UUID (UPPERCASE)
   * @param fileId  - File UUID (UPPERCASE)
   * @param updates - Fields to update
   */
  async update(userId: string, fileId: string, updates: UpdateFileOptions): Promise<void> {
    const data: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (updates.name !== undefined) {
      data['name'] = updates.name;
    }
    if (updates.parentFolderId !== undefined) {
      data['parent_folder_id'] = updates.parentFolderId;
    }
    if (updates.isFavorite !== undefined) {
      data['is_favorite'] = updates.isFavorite;
    }
    if (updates.blobPath !== undefined) {
      data['blob_path'] = updates.blobPath;
    }
    if (updates.contentHash !== undefined) {
      data['content_hash'] = updates.contentHash;
    }

    await this.prisma.files.updateMany({
      where: {
        id: fileId,
        user_id: userId,
      },
      data,
    });
  }

  // --------------------------------------------------------------------------
  // saveExtractedText
  // --------------------------------------------------------------------------

  /**
   * Save extracted text to a file record without changing pipeline_status.
   *
   * Used by FileProcessingService after text extraction. The worker (not the
   * service) owns pipeline_status transitions via CAS.
   *
   * @param userId        - Owner UUID (UPPERCASE)
   * @param fileId        - File UUID (UPPERCASE)
   * @param extractedText - Extracted text content
   */
  async saveExtractedText(userId: string, fileId: string, extractedText: string): Promise<void> {
    const result = await this.prisma.files.updateMany({
      where: { id: fileId, user_id: userId, deletion_status: null },
      data: { extracted_text: extractedText, updated_at: new Date() },
    });
    if (result.count === 0) {
      logger.warn({ fileId, userId }, 'saveExtractedText: file not found or soft-deleted');
    }
  }

  // --------------------------------------------------------------------------
  // updateProcessingStatus
  // --------------------------------------------------------------------------

  /**
   * Update the pipeline_status of a file.
   *
   * Optionally also updates extracted_text when text extraction completes.
   * Only operates on active (non-deleted) files.
   *
   * @param userId        - Owner UUID (UPPERCASE)
   * @param fileId        - File UUID (UPPERCASE)
   * @param status        - New pipeline status
   * @param extractedText - Extracted text content (optional)
   */
  async updateProcessingStatus(
    userId: string,
    fileId: string,
    status: PipelineStatus,
    extractedText?: string,
  ): Promise<void> {
    const data: Record<string, unknown> = {
      pipeline_status: status,
      updated_at: new Date(),
    };

    if (extractedText !== undefined) {
      data['extracted_text'] = extractedText;
    }

    const result = await this.prisma.files.updateMany({
      where: {
        id: fileId,
        user_id: userId,
        deletion_status: null,
      },
      data,
    });

    if (result.count === 0) {
      logger.warn({ fileId, userId, status }, 'updateProcessingStatus: file not found or soft-deleted, update skipped');
    }
  }

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------

  /**
   * Hard delete a file record from the database.
   *
   * WARNING: This is a permanent deletion with no recovery.
   * For user-initiated deletions, use markForDeletion() instead.
   *
   * @param userId - Owner UUID (UPPERCASE)
   * @param fileId - File UUID (UPPERCASE)
   */
  async delete(userId: string, fileId: string): Promise<void> {
    await this.prisma.files.deleteMany({
      where: {
        id: fileId,
        user_id: userId,
      },
    });
  }

  // --------------------------------------------------------------------------
  // getFileMetadata
  // --------------------------------------------------------------------------

  /**
   * Retrieve lightweight file metadata for blob operations.
   *
   * @param userId - Owner UUID (UPPERCASE)
   * @param fileId - File UUID (UPPERCASE)
   * @returns FileMetadata or null if not found
   */
  async getFileMetadata(userId: string, fileId: string): Promise<FileMetadata | null> {
    const record = await this.prisma.files.findFirst({
      where: {
        id: fileId,
        user_id: userId,
      },
      select: {
        blob_path: true,
        is_folder: true,
        name: true,
        mime_type: true,
        size_bytes: true,
      },
    });

    if (!record) return null;

    return {
      blobPath: record.blob_path,
      isFolder: record.is_folder,
      name: record.name,
      mimeType: record.mime_type,
      sizeBytes: Number(record.size_bytes),
    };
  }

  // --------------------------------------------------------------------------
  // getChildrenIds
  // --------------------------------------------------------------------------

  /**
   * Get IDs of all direct children of a folder.
   *
   * @param userId   - Owner UUID (UPPERCASE)
   * @param folderId - Folder UUID (UPPERCASE)
   * @returns Array of child file/folder IDs
   */
  async getChildrenIds(userId: string, folderId: string): Promise<string[]> {
    const records = await this.prisma.files.findMany({
      where: {
        user_id: userId,
        parent_folder_id: folderId,
      },
      select: { id: true },
    });

    return records.map((r) => r.id);
  }

  // --------------------------------------------------------------------------
  // markForDeletion
  // --------------------------------------------------------------------------

  /**
   * Soft-delete files by setting deletion_status to 'pending'.
   *
   * Only marks files that are currently active (deletion_status IS NULL).
   * Returns the IDs that were actually marked (not-found IDs are omitted).
   *
   * @param userId  - Owner UUID (UPPERCASE)
   * @param fileIds - Array of file IDs to mark for deletion
   * @returns IDs that were marked and their count
   */
  async markForDeletion(userId: string, fileIds: string[]): Promise<MarkForDeletionResult> {
    if (fileIds.length === 0) {
      return { markedIds: [], markedCount: 0 };
    }

    // Step 1: Find which files are active and owned by this user
    const activeFiles = await this.prisma.files.findMany({
      where: {
        id: { in: fileIds },
        user_id: userId,
        deletion_status: null,
      },
      select: { id: true },
    });

    if (activeFiles.length === 0) {
      return { markedIds: [], markedCount: 0 };
    }

    const activeIds = activeFiles.map((f) => f.id);

    // Step 2: Mark them as pending deletion
    await this.prisma.files.updateMany({
      where: {
        id: { in: activeIds },
        user_id: userId,
      },
      data: {
        deletion_status: 'pending',
        deleted_at: new Date(),
        updated_at: new Date(),
      },
    });

    logger.debug({ userId, markedCount: activeIds.length }, 'Files marked for deletion');

    return {
      markedIds: activeIds,
      markedCount: activeIds.length,
    };
  }

  // --------------------------------------------------------------------------
  // updateDeletionStatus
  // --------------------------------------------------------------------------

  /**
   * Update the deletion_status for a set of files.
   *
   * Used by the deletion queue worker to transition from 'pending' to
   * 'deleting' or 'failed'.
   *
   * @param userId  - Owner UUID (UPPERCASE)
   * @param fileIds - Array of file IDs to update
   * @param status  - New deletion status
   */
  async updateDeletionStatus(
    userId: string,
    fileIds: string[],
    status: 'deleting' | 'failed',
  ): Promise<void> {
    if (fileIds.length === 0) return;

    await this.prisma.files.updateMany({
      where: {
        id: { in: fileIds },
        user_id: userId,
      },
      data: {
        deletion_status: status,
        updated_at: new Date(),
      },
    });
  }

  // --------------------------------------------------------------------------
  // isFileActiveForProcessing
  // --------------------------------------------------------------------------

  /**
   * Check if a file is active (not soft-deleted) and ready for processing.
   *
   * Used by queue workers to verify a file hasn't been deleted while
   * it was waiting in the queue.
   *
   * @param userId - Owner UUID (UPPERCASE)
   * @param fileId - File UUID (UPPERCASE)
   * @returns true if the file is active and owned by the user
   */
  async isFileActiveForProcessing(userId: string, fileId: string): Promise<boolean> {
    const record = await this.prisma.files.findFirst({
      where: {
        id: fileId,
        user_id: userId,
        deletion_status: null,
      },
      select: { id: true },
    });

    return record !== null;
  }

  // --------------------------------------------------------------------------
  // getSourceType
  // --------------------------------------------------------------------------

  /**
   * Retrieve the source_type of a file.
   *
   * Used by FileProcessingService to route to the correct IFileContentProvider.
   *
   * @param userId - Owner UUID (UPPERCASE)
   * @param fileId - File UUID (UPPERCASE)
   * @returns source_type string (e.g. 'local', 'onedrive', 'sharepoint')
   * @throws Error if the file is not found
   */
  async getSourceType(userId: string, fileId: string): Promise<string> {
    const record = await this.prisma.files.findFirst({
      where: {
        id: fileId,
        user_id: userId,
        deletion_status: null,
      },
      select: { source_type: true },
    });
    if (!record) {
      throw new Error(`File not found: ${fileId}`);
    }
    return record.source_type;
  }

  // --------------------------------------------------------------------------
  // findByName
  // --------------------------------------------------------------------------

  /**
   * Find a file by name within a specific folder (or at root).
   *
   * Used for duplicate detection during upload.
   *
   * @param userId    - Owner UUID (UPPERCASE)
   * @param fileName  - Exact file name to search for
   * @param folderId  - Folder to search in (null = root)
   * @returns ParsedFile or null if not found
   */
  async findByName(
    userId: string,
    fileName: string,
    folderId: string | null,
  ): Promise<ParsedFile | null> {
    const record = await this.prisma.files.findFirst({
      where: {
        user_id: userId,
        name: fileName,
        parent_folder_id: folderId,
        is_folder: false,
        deletion_status: null,
      },
    });

    if (!record) return null;
    return parseFile(record as unknown as FileDbRecord);
  }

  // --------------------------------------------------------------------------
  // findByNameGlobal
  // --------------------------------------------------------------------------

  /**
   * Find a file by name across all folders (global search).
   *
   * Used as fallback when the LLM passes a filename instead of a UUID.
   *
   * @param userId   - Owner UUID (UPPERCASE)
   * @param fileName - Exact file name to search for
   * @returns ParsedFile or null if not found
   */
  async findByNameGlobal(
    userId: string,
    fileName: string,
  ): Promise<ParsedFile | null> {
    const record = await this.prisma.files.findFirst({
      where: {
        user_id: userId,
        name: fileName,
        is_folder: false,
        deletion_status: null,
      },
    });

    if (!record) return null;
    return parseFile(record as unknown as FileDbRecord);
  }

  // --------------------------------------------------------------------------
  // findByContentHash
  // --------------------------------------------------------------------------

  /**
   * Find all files matching a content hash (duplicate detection).
   *
   * @param userId      - Owner UUID (UPPERCASE)
   * @param contentHash - SHA-256 hash of file content
   * @returns Array of matching ParsedFiles
   */
  async findByContentHash(userId: string, contentHash: string): Promise<ParsedFile[]> {
    const records = await this.prisma.files.findMany({
      where: {
        user_id: userId,
        content_hash: contentHash,
        is_folder: false,
        deletion_status: null,
      },
    });

    return records.map((r) => parseFile(r as unknown as FileDbRecord));
  }

  // --------------------------------------------------------------------------
  // checkFolderExists
  // --------------------------------------------------------------------------

  /**
   * Check if a folder with the given name exists at the specified location.
   *
   * @param userId   - Owner UUID (UPPERCASE)
   * @param name     - Exact folder name
   * @param parentId - Parent folder ID (null/undefined = root)
   * @returns true if a matching folder exists
   */
  async checkFolderExists(
    userId: string,
    name: string,
    parentId?: string | null,
  ): Promise<boolean> {
    const record = await this.prisma.files.findFirst({
      where: {
        user_id: userId,
        name,
        is_folder: true,
        deletion_status: null,
        parent_folder_id: parentId ?? null,
      },
      select: { id: true },
    });

    return record !== null;
  }

  // --------------------------------------------------------------------------
  // findFoldersByNamePattern
  // --------------------------------------------------------------------------

  /**
   * Find folder names matching a base name or the "baseName (N)" pattern.
   *
   * Used by the folder name resolver to determine the next available suffix
   * when creating a folder with a conflicting name.
   *
   * @param userId    - Owner UUID (UPPERCASE)
   * @param baseName  - Base folder name to search for
   * @param parentId  - Parent folder ID (null/undefined = root)
   * @returns Array of matching folder names
   */
  async findFoldersByNamePattern(
    userId: string,
    baseName: string,
    parentId?: string | null,
  ): Promise<string[]> {
    const records = await this.prisma.files.findMany({
      where: {
        user_id: userId,
        is_folder: true,
        deletion_status: null,
        parent_folder_id: parentId ?? null,
        OR: [
          { name: baseName },
          { name: { startsWith: `${baseName} (` } },
        ],
      },
      select: { name: true },
    });

    return records.map((r) => r.name);
  }

  // --------------------------------------------------------------------------
  // findFolderIdByName
  // --------------------------------------------------------------------------

  /**
   * Find the ID of a folder by its exact name at a given location.
   *
   * @param userId   - Owner UUID (UPPERCASE)
   * @param name     - Exact folder name
   * @param parentId - Parent folder ID (null/undefined = root)
   * @returns Folder ID or null if not found
   */
  async findFolderIdByName(
    userId: string,
    name: string,
    parentId?: string | null,
  ): Promise<string | null> {
    const record = await this.prisma.files.findFirst({
      where: {
        user_id: userId,
        name,
        is_folder: true,
        deletion_status: null,
        parent_folder_id: parentId ?? null,
      },
      select: { id: true },
    });

    return record?.id ?? null;
  }

  // --------------------------------------------------------------------------
  // getFilesPendingProcessing
  // --------------------------------------------------------------------------

  /**
   * Find files in 'queued' status waiting to be processed.
   *
   * Returns files ordered by creation date (oldest first) up to the
   * specified limit. Used by the processing scheduler.
   *
   * @param limit - Maximum number of files to return
   * @returns Array of files pending processing
   */
  async getFilesPendingProcessing(limit: number): Promise<FilePendingProcessing[]> {
    const records = await this.prisma.files.findMany({
      where: {
        pipeline_status: PIPELINE_STATUS.QUEUED,
        is_folder: false,
        deletion_status: null,
      },
      select: {
        id: true,
        user_id: true,
        name: true,
        mime_type: true,
        size_bytes: true,
        blob_path: true,
        parent_folder_id: true,
      },
      orderBy: { created_at: 'asc' },
      take: limit,
    });

    return records.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      blobPath: r.blob_path,
      parentFolderId: r.parent_folder_id,
    }));
  }

  // --------------------------------------------------------------------------
  // transitionStatus — atomic optimistic-concurrency update
  // --------------------------------------------------------------------------

  /**
   * Atomically transition a file's pipeline_status using optimistic concurrency.
   *
   * The UPDATE only succeeds when:
   *   - `id` matches
   *   - `user_id` matches (multi-tenant isolation)
   *   - `pipeline_status` equals the expected `from` value (no concurrent change)
   *   - `deletion_status IS NULL` (file not soft-deleted)
   *
   * @param fileId   - File UUID (UPPERCASE)
   * @param userId   - Owner UUID (UPPERCASE)
   * @param from     - Expected current status
   * @param to       - Desired target status
   * @returns TransitionResult indicating success or failure reason
   */
  async transitionStatus(
    fileId: string,
    userId: string,
    from: PipelineStatus,
    to: PipelineStatus,
  ): Promise<TransitionResult> {
    // Validate the transition is legal before hitting the DB
    if (!canTransition(from, to)) {
      logger.warn({ fileId, userId, from, to }, 'Invalid pipeline transition rejected');
      return {
        success: false,
        previousStatus: from,
        error: getTransitionErrorMessage(from, to),
      };
    }

    // Atomic CAS: UPDATE … WHERE pipeline_status = @from
    const result = await this.prisma.files.updateMany({
      where: {
        id: fileId,
        user_id: userId,
        pipeline_status: from,
        deletion_status: null,
      },
      data: {
        pipeline_status: to,
        updated_at: new Date(),
      },
    });

    if (result.count === 1) {
      logger.debug({ fileId, from, to }, 'Pipeline transition succeeded');
      return { success: true, previousStatus: from };
    }

    // CAS failed — read current status for diagnostics
    const current = await this.prisma.files.findFirst({
      where: { id: fileId, user_id: userId },
      select: { pipeline_status: true, deletion_status: true },
    });

    if (!current) {
      logger.warn({ fileId, userId }, 'Pipeline transition failed: file not found');
      return { success: false, previousStatus: from, error: 'File not found' };
    }

    if (current.deletion_status !== null) {
      logger.warn({ fileId, userId }, 'Pipeline transition failed: file is soft-deleted');
      return { success: false, previousStatus: from, error: 'File is soft-deleted' };
    }

    const actualStatus = (current.pipeline_status ?? 'unknown') as PipelineStatus;
    logger.warn(
      { fileId, expectedStatus: from, actualStatus },
      'Pipeline transition failed: concurrent modification',
    );

    return {
      success: false,
      previousStatus: actualStatus,
      error: `Concurrent modification: expected '${from}', found '${actualStatus}'`,
    };
  }

  // --------------------------------------------------------------------------
  // getPipelineStatus
  // --------------------------------------------------------------------------

  /**
   * Read the current pipeline_status for a file.
   *
   * @param fileId - File UUID (UPPERCASE)
   * @param userId - Owner UUID (UPPERCASE)
   * @returns Current PipelineStatus, or `null` if file not found or status not set
   */
  async getPipelineStatus(fileId: string, userId: string): Promise<PipelineStatus | null> {
    const file = await this.prisma.files.findFirst({
      where: { id: fileId, user_id: userId, deletion_status: null },
      select: { pipeline_status: true },
    });

    if (!file || !file.pipeline_status) {
      return null;
    }

    return file.pipeline_status as PipelineStatus;
  }

  // --------------------------------------------------------------------------
  // findByStatus
  // --------------------------------------------------------------------------

  /**
   * Find files with a given pipeline_status, ordered by created_at ASC.
   *
   * @param status  - Pipeline status to filter by
   * @param options - Optional limit and userId filter
   * @returns Array of file records with id, user_id, name, pipeline_status, created_at
   */
  async findByStatus(
    status: PipelineStatus,
    options?: { limit?: number; userId?: string },
  ): Promise<Array<{ id: string; user_id: string; name: string; pipeline_status: string; created_at: Date | null }>> {
    const where: Record<string, unknown> = {
      pipeline_status: status,
      deletion_status: null,
    };

    if (options?.userId) {
      where.user_id = options.userId;
    }

    const files = await this.prisma.files.findMany({
      where,
      select: {
        id: true,
        user_id: true,
        name: true,
        pipeline_status: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
      take: options?.limit,
    });

    return files as Array<{ id: string; user_id: string; name: string; pipeline_status: string; created_at: Date | null }>;
  }

  // --------------------------------------------------------------------------
  // getStatusDistribution
  // --------------------------------------------------------------------------

  /**
   * Get a count of files grouped by pipeline_status.
   *
   * Only includes files that have a non-null pipeline_status and are not soft-deleted.
   * Returns all 8 pipeline status keys, defaulting to 0 for missing groups.
   *
   * @returns Record mapping each PipelineStatus to its file count
   */
  async getStatusDistribution(): Promise<Record<PipelineStatus, number>> {
    const groups = await this.prisma.files.groupBy({
      by: ['pipeline_status'],
      _count: { id: true },
      where: {
        deletion_status: null,
      },
    });

    // Initialize all statuses to 0
    const distribution = Object.fromEntries(
      Object.values(PIPELINE_STATUS).map((s) => [s, 0]),
    ) as Record<PipelineStatus, number>;

    // Fill in actual counts
    // Note: Prisma's groupBy _count type is complex; cast via unknown for runtime access
    for (const group of groups) {
      const status = group.pipeline_status as PipelineStatus;
      if (status in distribution) {
        const countObj = group._count as unknown as { id: number };
        distribution[status] = countObj.id ?? 0;
      }
    }

    return distribution;
  }

  // --------------------------------------------------------------------------
  // transitionStatusWithRetry (PRD-05)
  // --------------------------------------------------------------------------

  /**
   * Atomically transition a file's pipeline_status and increment retry count.
   *
   * Same as `transitionStatus()` but also increments `pipeline_retry_count` atomically.
   * Used by the DLQ recovery service to track retry attempts while transitioning status.
   *
   * @param fileId        - File UUID (UPPERCASE)
   * @param userId        - Owner UUID (UPPERCASE)
   * @param from          - Expected current status
   * @param to            - Desired target status
   * @param retryIncrement - Amount to increment retry count by (default: 1)
   * @returns TransitionResult indicating success or failure reason
   */
  async transitionStatusWithRetry(
    fileId: string,
    userId: string,
    from: PipelineStatus,
    to: PipelineStatus,
    retryIncrement: number = 1,
  ): Promise<TransitionResult> {
    // Validate the transition is legal before hitting the DB
    if (!canTransition(from, to)) {
      logger.warn({ fileId, userId, from, to }, 'Invalid pipeline transition rejected');
      return {
        success: false,
        previousStatus: from,
        error: getTransitionErrorMessage(from, to),
      };
    }

    // Atomic CAS with retry increment
    const result = await this.prisma.files.updateMany({
      where: {
        id: fileId,
        user_id: userId,
        pipeline_status: from,
        deletion_status: null,
      },
      data: {
        pipeline_status: to,
        pipeline_retry_count: { increment: retryIncrement },
        updated_at: new Date(),
      },
    });

    if (result.count === 1) {
      logger.debug({ fileId, from, to, retryIncrement }, 'Pipeline transition with retry succeeded');
      return { success: true, previousStatus: from };
    }

    // CAS failed — read current status for diagnostics
    const current = await this.prisma.files.findFirst({
      where: { id: fileId, user_id: userId },
      select: { pipeline_status: true, deletion_status: true },
    });

    if (!current) {
      logger.warn({ fileId, userId }, 'Pipeline transition failed: file not found');
      return { success: false, previousStatus: from, error: 'File not found' };
    }

    if (current.deletion_status !== null) {
      logger.warn({ fileId, userId }, 'Pipeline transition failed: file is soft-deleted');
      return { success: false, previousStatus: from, error: 'File is soft-deleted' };
    }

    const actualStatus = (current.pipeline_status ?? 'unknown') as PipelineStatus;
    logger.warn(
      { fileId, expectedStatus: from, actualStatus },
      'Pipeline transition failed: concurrent modification',
    );

    return {
      success: false,
      previousStatus: actualStatus,
      error: `Concurrent modification: expected '${from}', found '${actualStatus}'`,
    };
  }

  // --------------------------------------------------------------------------
  // findStuckFiles (PRD-05)
  // --------------------------------------------------------------------------

  /**
   * Find files stuck in non-terminal pipeline states beyond a threshold.
   *
   * Returns files in active processing states (queued, extracting, chunking, embedding)
   * that have not been updated recently, indicating a potential stall or failure.
   *
   * Used by the DLQ recovery service to detect and recover stuck processing jobs.
   *
   * @param thresholdMs - Time threshold in milliseconds (files older than now - thresholdMs)
   * @param userId      - Optional user filter for multi-tenant isolation
   * @returns Array of stuck file records with status and retry metadata
   */
  async findStuckFiles(
    thresholdMs: number,
    userId?: string,
  ): Promise<Array<{
    id: string;
    user_id: string;
    name: string;
    pipeline_status: string;
    pipeline_retry_count: number;
    updated_at: Date | null;
    created_at: Date | null;
  }>> {
    const threshold = new Date(Date.now() - thresholdMs);

    const where: Record<string, unknown> = {
      pipeline_status: {
        in: [
          PIPELINE_STATUS.QUEUED,
          PIPELINE_STATUS.EXTRACTING,
          PIPELINE_STATUS.CHUNKING,
          PIPELINE_STATUS.EMBEDDING,
        ],
      },
      updated_at: { lt: threshold },
      deletion_status: null,
    };

    if (userId) {
      where.user_id = userId;
    }

    const files = await this.prisma.files.findMany({
      where,
      select: {
        id: true,
        user_id: true,
        name: true,
        pipeline_status: true,
        pipeline_retry_count: true,
        updated_at: true,
        created_at: true,
      },
      orderBy: { updated_at: 'asc' },
      take: 200,
    });

    return files as Array<{
      id: string;
      user_id: string;
      name: string;
      pipeline_status: string;
      pipeline_retry_count: number;
      updated_at: Date | null;
      created_at: Date | null;
    }>;
  }

  // --------------------------------------------------------------------------
  // findAbandonedFiles (PRD-05)
  // --------------------------------------------------------------------------

  /**
   * Find files stuck in 'registered' status beyond a threshold.
   *
   * Returns files that completed the upload registration phase but never
   * transitioned to 'uploaded' or subsequent processing states. This indicates
   * the client likely crashed or disconnected during the upload process.
   *
   * Used by the DLQ cleanup service to recover orphaned blob registrations.
   *
   * @param thresholdMs - Time threshold in milliseconds (files older than now - thresholdMs)
   * @param userId      - Optional user filter for multi-tenant isolation
   * @returns Array of abandoned file records with blob metadata
   */
  async findAbandonedFiles(
    thresholdMs: number,
    userId?: string,
  ): Promise<Array<{
    id: string;
    user_id: string;
    name: string;
    blob_path: string;
    created_at: Date | null;
  }>> {
    const threshold = new Date(Date.now() - thresholdMs);

    const where: Record<string, unknown> = {
      pipeline_status: PIPELINE_STATUS.REGISTERED,
      created_at: { lt: threshold },
      deletion_status: null,
    };

    if (userId) {
      where.user_id = userId;
    }

    const files = await this.prisma.files.findMany({
      where,
      select: {
        id: true,
        user_id: true,
        name: true,
        blob_path: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
      take: 500,
    });

    return files as Array<{
      id: string;
      user_id: string;
      name: string;
      blob_path: string;
      created_at: Date | null;
    }>;
  }

  // --------------------------------------------------------------------------
  // searchByName
  // --------------------------------------------------------------------------

  /**
   * Search files by name across all folders.
   * Returns files matching the query, folders first.
   */
  async searchByName(
    userId: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<ParsedFile[]> {
    const limit = options.limit ?? 10;
    const records = await this.prisma.files.findMany({
      where: {
        user_id: userId,
        deletion_status: null,
        name: { contains: query },
      },
      orderBy: [
        { is_folder: 'desc' },
        { name: 'asc' },
      ],
      take: limit,
    });
    return records.map(r => parseFile(r as unknown as FileDbRecord));
  }

  // --------------------------------------------------------------------------
  // getDescendantFileIds
  // --------------------------------------------------------------------------

  /**
   * Get all descendant non-folder file IDs for a folder.
   * Uses recursive CTE with max depth of 20.
   * Caps results at 200 files.
   */
  async getDescendantFileIds(userId: string, folderId: string): Promise<string[]> {
    const MAX_DESCENDANTS = 200;
    const result = await this.prisma.$queryRaw<Array<{ id: string }>>`
      ;WITH descendants AS (
        SELECT id, is_folder
        FROM files
        WHERE parent_folder_id = ${folderId}
          AND user_id = ${userId}
          AND deletion_status IS NULL
        UNION ALL
        SELECT f.id, f.is_folder
        FROM files f
        INNER JOIN descendants d ON f.parent_folder_id = d.id
        WHERE f.user_id = ${userId}
          AND f.deletion_status IS NULL
      )
      SELECT TOP(${MAX_DESCENDANTS}) id FROM descendants WHERE is_folder = 0
      OPTION (MAXRECURSION 20)
    `;
    return result.map(r => r.id);
  }

  // --------------------------------------------------------------------------
  // forceStatus (PRD-05)
  // --------------------------------------------------------------------------

  /**
   * Force a file to a specific pipeline_status, bypassing state machine validation.
   *
   * WARNING: This method bypasses the state machine and should only be used for
   * administrative recovery operations (e.g., resetting a stuck file to allow
   * manual re-processing). Normal application code should use `transitionStatus()`.
   *
   * Used by the DLQ service for force-resetting files that are in invalid states.
   *
   * @param fileId - File UUID (UPPERCASE)
   * @param userId - Owner UUID (UPPERCASE)
   * @param status - Target pipeline status (no validation performed)
   * @returns Success flag and optional error message
   */
  async forceStatus(
    fileId: string,
    userId: string,
    status: PipelineStatus,
  ): Promise<{ success: boolean; error?: string }> {
    logger.warn(
      { fileId, userId, status },
      'FORCE STATUS: Bypassing state machine for administrative recovery',
    );

    const result = await this.prisma.files.updateMany({
      where: {
        id: fileId,
        user_id: userId,
        deletion_status: null,
      },
      data: {
        pipeline_status: status,
        updated_at: new Date(),
      },
    });

    if (result.count === 1) {
      logger.info({ fileId, status }, 'Force status update succeeded');
      return { success: true };
    }

    logger.error({ fileId, userId }, 'Force status update failed: file not found or soft-deleted');
    return { success: false, error: 'File not found or soft-deleted' };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: FileRepository | undefined;

/**
 * Get the FileRepository singleton.
 */
export function getFileRepository(): FileRepository {
  if (!instance) {
    instance = new FileRepository();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetFileRepository(): void {
  instance = undefined;
}
