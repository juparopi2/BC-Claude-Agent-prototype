/**
 * FileDuplicateService
 *
 * Provides duplicate detection operations for files.
 * Delegates to FileRepository for DB queries.
 *
 * This service was split from FileService during the PRD-07 refactor
 * to follow the facade + specialized services pattern.
 *
 * @module services/files/operations/FileDuplicateService
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import type { ParsedFile } from '@/types/file.types';
import { getFileRepository, FileRepository } from '../repository/FileRepository';

/**
 * Interface for dependency injection
 */
export interface IFileDuplicateService {
  checkByName(
    userId: string,
    fileName: string,
    folderId?: string | null,
  ): Promise<{ isDuplicate: boolean; existingFile?: ParsedFile }>;

  checkByNameBatch(
    userId: string,
    files: Array<{ name: string; folderId?: string | null }>,
  ): Promise<Array<{ name: string; isDuplicate: boolean; existingFile?: ParsedFile }>>;

  findByContentHash(userId: string, contentHash: string): Promise<ParsedFile[]>;

  checkByHashBatch(
    userId: string,
    items: Array<{ tempId: string; contentHash: string; fileName: string }>,
  ): Promise<Array<{ tempId: string; isDuplicate: boolean; existingFile?: ParsedFile }>>;
}

/**
 * FileDuplicateService implementation
 */
export class FileDuplicateService implements IFileDuplicateService {
  private static instance: FileDuplicateService | null = null;
  private readonly logger: Logger;
  private readonly repository: FileRepository;

  private constructor(deps?: { repository?: FileRepository }) {
    this.logger = createChildLogger({ service: 'FileDuplicateService' });
    this.repository = deps?.repository ?? getFileRepository();
    this.logger.info('FileDuplicateService initialized');
  }

  public static getInstance(deps?: { repository?: FileRepository }): FileDuplicateService {
    if (!FileDuplicateService.instance) {
      FileDuplicateService.instance = new FileDuplicateService(deps);
    }
    return FileDuplicateService.instance;
  }

  public static resetInstance(): void {
    FileDuplicateService.instance = null;
  }

  /**
   * Check if a file with the given name already exists in the specified folder.
   */
  async checkByName(
    userId: string,
    fileName: string,
    folderId?: string | null,
  ): Promise<{ isDuplicate: boolean; existingFile?: ParsedFile }> {
    const existing = await this.repository.findByName(userId, fileName, folderId ?? null);
    if (!existing) {
      return { isDuplicate: false };
    }
    return { isDuplicate: true, existingFile: existing };
  }

  /**
   * Check multiple files for duplicates by name in a single batch.
   */
  async checkByNameBatch(
    userId: string,
    files: Array<{ name: string; folderId?: string | null }>,
  ): Promise<Array<{ name: string; isDuplicate: boolean; existingFile?: ParsedFile }>> {
    const results: Array<{ name: string; isDuplicate: boolean; existingFile?: ParsedFile }> = [];

    for (const file of files) {
      const result = await this.checkByName(userId, file.name, file.folderId);
      results.push({ name: file.name, ...result });
    }

    return results;
  }

  /**
   * Find all files matching the given content hash for this user.
   */
  async findByContentHash(userId: string, contentHash: string): Promise<ParsedFile[]> {
    return this.repository.findByContentHash(userId, contentHash);
  }

  /**
   * Check multiple files for hash-based duplicates in a batch.
   */
  async checkByHashBatch(
    userId: string,
    items: Array<{ tempId: string; contentHash: string; fileName: string }>,
  ): Promise<Array<{ tempId: string; isDuplicate: boolean; existingFile?: ParsedFile }>> {
    const results: Array<{ tempId: string; isDuplicate: boolean; existingFile?: ParsedFile }> = [];

    for (const item of items) {
      const matches = await this.findByContentHash(userId, item.contentHash);
      if (matches.length > 0) {
        results.push({ tempId: item.tempId, isDuplicate: true, existingFile: matches[0] });
      } else {
        results.push({ tempId: item.tempId, isDuplicate: false });
      }
    }

    return results;
  }
}

/**
 * Get the singleton FileDuplicateService instance.
 */
export function getFileDuplicateService(deps?: {
  repository?: FileRepository;
}): FileDuplicateService {
  return FileDuplicateService.getInstance(deps);
}

/**
 * Reset the singleton (for testing).
 */
export function __resetFileDuplicateService(): void {
  FileDuplicateService.resetInstance();
}
