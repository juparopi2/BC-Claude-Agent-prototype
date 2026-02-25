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
} from '@/types/file.types';
import { type PipelineStatus } from '@bc-agent/shared';
import { getFileRepository, FileRepository } from './repository/FileRepository';
import { getFileDeletionService, type IFileDeletionService, type DeletionOptions } from './operations/FileDeletionService';
import { getFileDuplicateService, type IFileDuplicateService } from './operations/FileDuplicateService';
import { getFileMetadataService, type IFileMetadataService } from './operations/FileMetadataService';

/**
 * File Service - Facade for file operations
 */
export class FileService {
  private static instance: FileService | null = null;
  private logger: Logger;
  private repository: FileRepository;
  private deletionService: IFileDeletionService;
  private duplicateService: IFileDuplicateService;
  private metadataService: IFileMetadataService;

  private constructor(deps?: {
    repository?: FileRepository;
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
    status: PipelineStatus,
    extractedText?: string
  ): Promise<void> {
    return this.metadataService.updateProcessingStatus(userId, fileId, status, extractedText);
  }

  /**
   * Save extracted text without changing pipeline_status.
   *
   * Used by FileProcessingService — workers own status transitions via CAS.
   */
  public async saveExtractedText(userId: string, fileId: string, extractedText: string): Promise<void> {
    return this.repository.saveExtractedText(userId, fileId, extractedText);
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
  // SEARCH OPERATIONS (delegate to FileRepository)
  // ========================================================================

  /**
   * Find a file by exact name across all folders (global search).
   * Used as fallback when the LLM passes a filename instead of a UUID.
   */
  public async findByNameGlobal(userId: string, fileName: string): Promise<ParsedFile | null> {
    return this.repository.findByNameGlobal(userId, fileName);
  }

  /**
   * Search files by name across all folders.
   */
  public async searchByName(
    userId: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<ParsedFile[]> {
    return this.repository.searchByName(userId, query, options);
  }

  /**
   * Get all descendant file IDs for a folder.
   */
  public async getDescendantFileIds(userId: string, folderId: string): Promise<string[]> {
    return this.repository.getDescendantFileIds(userId, folderId);
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
