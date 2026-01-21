/**
 * FileMetadataService
 *
 * Handles file metadata update operations:
 * - Rename (name)
 * - Move (parentFolderId)
 * - Toggle favorite
 * - Update processing status
 *
 * Delegates to FileRepository for actual database operations.
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import { UpdateFileOptions, ProcessingStatus } from '@/types/file.types';
import { getFileRepository, type IFileRepository } from '../repository/FileRepository';

/**
 * Interface for dependency injection
 */
export interface IFileMetadataService {
  update(userId: string, fileId: string, updates: UpdateFileOptions): Promise<void>;
  toggleFavorite(userId: string, fileId: string): Promise<boolean>;
  move(userId: string, fileId: string, newParentId: string | null): Promise<void>;
  updateProcessingStatus(userId: string, fileId: string, status: ProcessingStatus, extractedText?: string): Promise<void>;
}

/**
 * FileMetadataService - File metadata update operations
 */
export class FileMetadataService implements IFileMetadataService {
  private static instance: FileMetadataService | null = null;
  private logger: Logger;
  private repository: IFileRepository;

  private constructor(deps?: { repository?: IFileRepository }) {
    this.logger = createChildLogger({ service: 'FileMetadataService' });
    this.repository = deps?.repository ?? getFileRepository();
  }

  public static getInstance(): FileMetadataService {
    if (!FileMetadataService.instance) {
      FileMetadataService.instance = new FileMetadataService();
    }
    return FileMetadataService.instance;
  }

  /**
   * Update file metadata
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @param updates - Fields to update
   */
  public async update(
    userId: string,
    fileId: string,
    updates: UpdateFileOptions
  ): Promise<void> {
    this.logger.info({ userId, fileId, updates }, 'Updating file metadata');

    try {
      await this.repository.update(userId, fileId, updates);
      this.logger.info({ userId, fileId }, 'File metadata updated');
    } catch (error) {
      this.logger.error({ error, userId, fileId, updates }, 'Failed to update file metadata');
      throw error;
    }
  }

  /**
   * Toggle favorite flag
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @returns New favorite status
   */
  public async toggleFavorite(userId: string, fileId: string): Promise<boolean> {
    this.logger.info({ userId, fileId }, 'Toggling favorite');

    try {
      // Get current status
      const currentFile = await this.repository.findById(userId, fileId);
      if (!currentFile) {
        throw new Error('File not found or unauthorized');
      }

      const newStatus = !currentFile.isFavorite;

      // Update favorite status
      await this.repository.update(userId, fileId, { isFavorite: newStatus });

      this.logger.info({ userId, fileId, newStatus }, 'Favorite toggled');
      return newStatus;
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to toggle favorite');
      throw error;
    }
  }

  /**
   * Move file to different folder
   *
   * @param userId - User ID (for ownership check)
   * @param fileId - File ID
   * @param newParentId - New parent folder ID (null for root)
   */
  public async move(
    userId: string,
    fileId: string,
    newParentId: string | null
  ): Promise<void> {
    this.logger.info({ userId, fileId, newParentId }, 'Moving file');

    try {
      await this.repository.update(userId, fileId, { parentFolderId: newParentId });
      this.logger.info({ userId, fileId, newParentId }, 'File moved');
    } catch (error) {
      this.logger.error({ error, userId, fileId, newParentId }, 'Failed to move file');
      throw error;
    }
  }

  /**
   * Update file processing status
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
      await this.repository.updateProcessingStatus(userId, fileId, status, extractedText);
      this.logger.info({ userId, fileId, status }, 'Processing status updated');
    } catch (error) {
      this.logger.error({ error, userId, fileId, status }, 'Failed to update processing status');
      throw error;
    }
  }
}

/**
 * Get singleton instance of FileMetadataService
 */
export function getFileMetadataService(): FileMetadataService {
  return FileMetadataService.getInstance();
}

/**
 * Reset singleton for testing
 */
export function __resetFileMetadataService(): void {
  (FileMetadataService as unknown as { instance: FileMetadataService | null }).instance = null;
}
