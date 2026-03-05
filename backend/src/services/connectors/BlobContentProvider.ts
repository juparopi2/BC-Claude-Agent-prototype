/**
 * BlobContentProvider
 *
 * Implements IFileContentProvider for locally uploaded files stored in Azure Blob Storage.
 * Looks up the blob path from the FileRepository and downloads via FileUploadService.
 *
 * @module services/connectors
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getFileRepository } from '@/services/files/repository/FileRepository';
import { getFileUploadService } from '@/services/files/FileUploadService';
import type { IFileContentProvider, FileContentResult } from './IFileContentProvider';

const logger = createChildLogger({ service: 'BlobContentProvider' });

export class BlobContentProvider implements IFileContentProvider {
  async getContent(fileId: string, userId: string): Promise<FileContentResult> {
    logger.info({ fileId, userId }, 'Fetching file content from blob storage');

    const file = await getFileRepository().findById(userId, fileId);

    if (!file) {
      logger.warn({ fileId, userId }, 'File not found in repository');
      throw new Error(`File not found: ${fileId}`);
    }

    if (!file.blobPath) {
      logger.warn({ fileId, userId }, 'File has no blob path (may be a folder)');
      throw new Error(`File has no blob path: ${fileId}`);
    }

    const buffer = await getFileUploadService().downloadFromBlob(file.blobPath);

    logger.info({ fileId, userId, blobPath: file.blobPath }, 'File content downloaded successfully');

    return {
      buffer,
      mimeType: file.mimeType,
    };
  }

  async isAccessible(fileId: string, userId: string): Promise<boolean> {
    try {
      const file = await getFileRepository().findById(userId, fileId);
      return file !== null && Boolean(file.blobPath);
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, name: error.name }
        : { value: String(error) };
      logger.warn({ fileId, userId, error: errorInfo }, 'Accessibility check failed');
      return false;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BlobContentProvider | undefined;

/**
 * Get the BlobContentProvider singleton.
 */
export function getBlobContentProvider(): BlobContentProvider {
  if (!instance) {
    instance = new BlobContentProvider();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetBlobContentProvider(): void {
  instance = undefined;
}
