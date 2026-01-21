/**
 * FileService - Facade
 *
 * Provides CRUD operations for files and folders with multi-tenant isolation.
 * This is a facade that delegates to specialized services:
 * - FileRepository: CRUD operations
 * - FileDeletionService: GDPR-compliant cascade deletion
 * - FileDuplicateService: Duplicate detection
 * - FileMetadataService: Metadata updates
 *
 * This service maintains backward compatibility with the original API.
 * All operations are scoped to userId to prevent cross-user access.
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import {
  ParsedFile,
  GetFilesOptions,
  CreateFileOptions,
  UpdateFileOptions,
  ProcessingStatus,
} from '@/types/file.types';
import { getFileRepository, type IFileRepository } from './repository/FileRepository';
import { getFileDeletionService, type IFileDeletionService, type DeletionOptions } from './operations/FileDeletionService';
import { getFileDuplicateService, type IFileDuplicateService } from './operations/FileDuplicateService';
import { getFileMetadataService, type IFileMetadataService } from './operations/FileMetadataService';
import { getFileRetryService } from '@/domains/files/retry';

/**
 * File Service - Facade for file operations
 */
export class FileService {
  private static instance: FileService | null = null;
  private logger: Logger;
  private repository: IFileRepository;
  private deletionService: IFileDeletionService;
  private duplicateService: IFileDuplicateService;
  private metadataService: IFileMetadataService;

  private constructor(deps?: {
    repository?: IFileRepository;
    deletionService?: IFileDeletionService;
    duplicateService?: IFileDuplicateService;
    metadataService?: IFileMetadataService;
  }) {
    this.logger = createChildLogger({ service: 'FileService' });
    this.repository = deps?.repository ?? getFileRepository();
    this.deletionService = deps?.deletionService ?? getFileDeletionService();
    this.duplicateService = deps?.duplicateService ?? getFileDuplicateService();
    this.metadataService = deps?.metadataService ?? getFileMetadataService();
    this.logger.info('FileService initialized (facade)');
  }

  public static getInstance(): FileService {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  // ========================================================================
  // READ OPERATIONS (delegate to FileRepository)
  // ========================================================================

  /**
   * Get files with filtering, sorting, pagination
   */
  public async getFiles(options: GetFilesOptions): Promise<ParsedFile[]> {
    return this.repository.findMany(options);
  }

  /**
   * Get single file with ownership validation
   */
  public async getFile(userId: string, fileId: string): Promise<ParsedFile | null> {
    return this.repository.findById(userId, fileId);
  }

  /**
   * Verify ownership of multiple files
   */
  public async verifyOwnership(userId: string, fileIds: string[]): Promise<string[]> {
    return this.repository.findIdsByOwner(userId, fileIds);
  }

  /**
   * Get file count in folder
   */
  public async getFileCount(
    userId: string,
    folderId?: string | null,
    options?: { favoritesFirst?: boolean }
  ): Promise<number> {
    return this.repository.count(userId, folderId, options);
  }

  // ========================================================================
  // CREATE OPERATIONS (delegate to FileRepository)
  // ========================================================================

  /**
   * Create folder
   */
  public async createFolder(
    userId: string,
    name: string,
    parentId?: string
  ): Promise<string> {
    return this.repository.createFolder(userId, name, parentId);
  }

  /**
   * Create file record
   */
  public async createFileRecord(options: CreateFileOptions): Promise<string> {
    return this.repository.create(options);
  }

  // ========================================================================
  // UPDATE OPERATIONS (delegate to FileMetadataService)
  // ========================================================================

  /**
   * Update file metadata
   */
  public async updateFile(
    userId: string,
    fileId: string,
    updates: UpdateFileOptions
  ): Promise<void> {
    return this.metadataService.update(userId, fileId, updates);
  }

  /**
   * Toggle favorite flag
   */
  public async toggleFavorite(userId: string, fileId: string): Promise<boolean> {
    return this.metadataService.toggleFavorite(userId, fileId);
  }

  /**
   * Move file to different folder
   */
  public async moveFile(
    userId: string,
    fileId: string,
    newParentId: string | null
  ): Promise<void> {
    return this.metadataService.move(userId, fileId, newParentId);
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
    return this.metadataService.updateProcessingStatus(userId, fileId, status, extractedText);
  }

  // ========================================================================
  // DELETE OPERATIONS (delegate to FileDeletionService)
  // ========================================================================

  /**
   * Delete file/folder with GDPR-compliant cascade
   */
  public async deleteFile(
    userId: string,
    fileId: string,
    options?: DeletionOptions
  ): Promise<string[]> {
    return this.deletionService.delete(userId, fileId, options);
  }

  // ========================================================================
  // DUPLICATE DETECTION (delegate to FileDuplicateService)
  // ========================================================================

  /**
   * Check for duplicate file by name
   */
  public async checkDuplicate(
    userId: string,
    fileName: string,
    folderId?: string | null
  ): Promise<{ isDuplicate: boolean; existingFile?: ParsedFile }> {
    return this.duplicateService.checkByName(userId, fileName, folderId);
  }

  /**
   * Check multiple files for duplicates by name
   */
  public async checkDuplicatesBatch(
    userId: string,
    files: Array<{ name: string; folderId?: string | null }>
  ): Promise<Array<{ name: string; isDuplicate: boolean; existingFile?: ParsedFile }>> {
    return this.duplicateService.checkByNameBatch(userId, files);
  }

  /**
   * Find files by content hash
   */
  public async findByContentHash(
    userId: string,
    contentHash: string
  ): Promise<ParsedFile[]> {
    return this.duplicateService.findByContentHash(userId, contentHash);
  }

  /**
   * Check duplicates by content hash
   */
  public async checkDuplicatesByHash(
    userId: string,
    items: Array<{ tempId: string; contentHash: string; fileName: string }>
  ): Promise<Array<{ tempId: string; isDuplicate: boolean; existingFile?: ParsedFile }>> {
    return this.duplicateService.checkByHashBatch(userId, items);
  }

  // ========================================================================
  // RETRY TRACKING (delegate to FileRetryService)
  // These methods are deprecated but kept for backward compatibility.
  // Prefer using getFileRetryService() directly in new code.
  // ========================================================================

  /**
   * @deprecated Prefer using getFileRetryService().incrementProcessingRetryCount() directly
   */
  public async incrementProcessingRetryCount(
    userId: string,
    fileId: string
  ): Promise<number> {
    return getFileRetryService().incrementProcessingRetryCount(userId, fileId);
  }

  /**
   * @deprecated Prefer using getFileRetryService().incrementEmbeddingRetryCount() directly
   */
  public async incrementEmbeddingRetryCount(
    userId: string,
    fileId: string
  ): Promise<number> {
    return getFileRetryService().incrementEmbeddingRetryCount(userId, fileId);
  }

  /**
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
   * @deprecated Prefer using getFileRetryService().markAsPermanentlyFailed() directly
   */
  public async markAsPermanentlyFailed(
    userId: string,
    fileId: string
  ): Promise<void> {
    return getFileRetryService().markAsPermanentlyFailed(userId, fileId);
  }

  /**
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

/**
 * Get singleton instance of FileService
 */
export function getFileService(): FileService {
  return FileService.getInstance();
}

/**
 * Reset singleton for testing
 */
export async function __resetFileService(): Promise<void> {
  (FileService as unknown as { instance: FileService | null }).instance = null;
}
