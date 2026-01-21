/**
 * FileDuplicateService
 *
 * Handles duplicate file detection by:
 * - Name-based duplicate check (same name in same folder)
 * - Content hash-based duplicate check (SHA-256 content hash)
 *
 * Used during upload to warn users about potential conflicts.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { executeQuery, SqlParams } from '@/infrastructure/database/database';
import type { Logger } from 'pino';
import { FileDbRecord, ParsedFile, parseFile } from '@/types/file.types';
import { getFileQueryBuilder, type FileQueryBuilder } from '../repository/FileQueryBuilder';

/**
 * Result of a name-based duplicate check
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingFile?: ParsedFile;
}

/**
 * Result of a batch name-based duplicate check
 */
export interface BatchNameDuplicateResult {
  name: string;
  isDuplicate: boolean;
  existingFile?: ParsedFile;
}

/**
 * Result of a batch hash-based duplicate check
 */
export interface BatchHashDuplicateResult {
  tempId: string;
  isDuplicate: boolean;
  existingFile?: ParsedFile;
}

/**
 * Interface for dependency injection
 */
export interface IFileDuplicateService {
  checkByName(userId: string, fileName: string, folderId?: string | null): Promise<DuplicateCheckResult>;
  checkByNameBatch(userId: string, files: Array<{ name: string; folderId?: string | null }>): Promise<BatchNameDuplicateResult[]>;
  findByContentHash(userId: string, contentHash: string): Promise<ParsedFile[]>;
  checkByHashBatch(userId: string, items: Array<{ tempId: string; contentHash: string; fileName: string }>): Promise<BatchHashDuplicateResult[]>;
}

/**
 * FileDuplicateService - Duplicate file detection
 */
export class FileDuplicateService implements IFileDuplicateService {
  private static instance: FileDuplicateService | null = null;
  private logger: Logger;
  private queryBuilder: FileQueryBuilder;

  private constructor(deps?: { queryBuilder?: FileQueryBuilder }) {
    this.logger = createChildLogger({ service: 'FileDuplicateService' });
    this.queryBuilder = deps?.queryBuilder ?? getFileQueryBuilder();
  }

  public static getInstance(): FileDuplicateService {
    if (!FileDuplicateService.instance) {
      FileDuplicateService.instance = new FileDuplicateService();
    }
    return FileDuplicateService.instance;
  }

  /**
   * Check for duplicate file by name in specified folder
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileName - Name of file to check
   * @param folderId - Folder ID (null/undefined for root)
   * @returns Duplicate check result
   */
  public async checkByName(
    userId: string,
    fileName: string,
    folderId?: string | null
  ): Promise<DuplicateCheckResult> {
    this.logger.info({ userId, fileName, folderId }, 'Checking for duplicate file by name');

    try {
      const { query, params } = this.queryBuilder.buildCheckDuplicateQuery(userId, fileName, folderId);
      const result = await executeQuery<FileDbRecord>(query, params as SqlParams);

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
   * Check multiple files for duplicates by name
   *
   * @param userId - User ID for multi-tenant isolation
   * @param files - Array of files to check
   * @returns Array of duplicate check results
   */
  public async checkByNameBatch(
    userId: string,
    files: Array<{ name: string; folderId?: string | null }>
  ): Promise<BatchNameDuplicateResult[]> {
    this.logger.info({ userId, fileCount: files.length }, 'Checking for duplicate files (batch)');

    if (files.length === 0) {
      return [];
    }

    try {
      const results: BatchNameDuplicateResult[] = [];

      for (const file of files) {
        const checkResult = await this.checkByName(userId, file.name, file.folderId);
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
   * Find files by content hash
   *
   * @param userId - User ID for multi-tenant isolation
   * @param contentHash - SHA-256 content hash
   * @returns Matching files
   */
  public async findByContentHash(userId: string, contentHash: string): Promise<ParsedFile[]> {
    this.logger.info({ userId, contentHash: contentHash.substring(0, 8) + '...' }, 'Finding files by content hash');

    try {
      const { query, params } = this.queryBuilder.buildFindByContentHashQuery(userId, contentHash);
      const result = await executeQuery<FileDbRecord>(query, params as SqlParams);

      this.logger.info({ userId, matches: result.recordset.length }, 'Content hash search completed');

      return result.recordset.map((record) => parseFile(record));
    } catch (error) {
      this.logger.error({ error, userId, contentHash }, 'Failed to find files by content hash');
      throw error;
    }
  }

  /**
   * Check multiple files for duplicates by content hash
   *
   * @param userId - User ID for multi-tenant isolation
   * @param items - Array of items to check
   * @returns Array of duplicate check results
   */
  public async checkByHashBatch(
    userId: string,
    items: Array<{ tempId: string; contentHash: string; fileName: string }>
  ): Promise<BatchHashDuplicateResult[]> {
    this.logger.info({ userId, itemCount: items.length }, 'Checking duplicates by content hash (batch)');

    try {
      const results: BatchHashDuplicateResult[] = [];

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
}

/**
 * Get singleton instance of FileDuplicateService
 */
export function getFileDuplicateService(): FileDuplicateService {
  return FileDuplicateService.getInstance();
}

/**
 * Reset singleton for testing
 */
export function __resetFileDuplicateService(): void {
  (FileDuplicateService as unknown as { instance: FileDuplicateService | null }).instance = null;
}
