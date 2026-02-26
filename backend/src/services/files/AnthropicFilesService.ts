/**
 * Anthropic Files API Service
 *
 * Manages file uploads to Anthropic's Files API for efficient file referencing.
 * Files uploaded here can be referenced by file_id in messages instead of
 * base64-encoding the content every time.
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/files
 * @module services/files/AnthropicFilesService
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/infrastructure/config/environment';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'AnthropicFilesService' });

// Beta header required for the Files API
const FILES_API_BETA = 'files-api-2025-04-14' as const;

export class AnthropicFilesService {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Upload a file to Anthropic's Files API.
   *
   * @param buffer - File content as Buffer
   * @param filename - Original filename
   * @param mimeType - MIME type of the file
   * @returns Anthropic file ID (e.g., "file_abc123")
   */
  async uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    try {
      const file = await this.client.beta.files.upload(
        {
          file: new File([buffer], filename, { type: mimeType }),
          betas: [FILES_API_BETA],
        },
      );

      logger.info(
        { fileId: file.id, filename, mimeType, sizeBytes: buffer.length },
        'File uploaded to Anthropic Files API'
      );

      return file.id;
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
      logger.error(
        { error: errorInfo, filename, mimeType },
        'Failed to upload file to Anthropic Files API'
      );
      throw error;
    }
  }

  /**
   * Retrieve metadata for a sandbox-generated file from Anthropic's Files API.
   *
   * @param fileId - Anthropic file ID (e.g., "file_abc123")
   * @returns File metadata including filename, MIME type, size, and downloadable status
   */
  async getFileMetadata(fileId: string): Promise<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadable: boolean;
  }> {
    try {
      const file = await this.client.beta.files.retrieveMetadata(fileId, {
        betas: [FILES_API_BETA],
      });

      return {
        id: file.id,
        filename: file.filename,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        downloadable: file.downloadable,
      };
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
      logger.error(
        { error: errorInfo, fileId },
        'Failed to retrieve file metadata from Anthropic Files API'
      );
      throw error;
    }
  }

  /**
   * Download a sandbox-generated file from Anthropic's Files API.
   *
   * @param fileId - Anthropic file ID (e.g., "file_abc123")
   * @returns File content as Buffer
   */
  async downloadSandboxFile(fileId: string): Promise<Buffer> {
    try {
      const response = await this.client.beta.files.download(fileId, {
        betas: [FILES_API_BETA],
      });

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
      logger.error(
        { error: errorInfo, fileId },
        'Failed to download file from Anthropic Files API'
      );
      throw error;
    }
  }

  /**
   * Delete a file from Anthropic's Files API.
   *
   * @param fileId - Anthropic file ID to delete
   */
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.client.beta.files.delete(fileId, {
        betas: [FILES_API_BETA],
      });
      logger.info({ fileId }, 'File deleted from Anthropic Files API');
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
      logger.warn(
        { error: errorInfo, fileId },
        'Failed to delete file from Anthropic Files API (non-critical)'
      );
      // Don't throw — deletion failure is non-critical
    }
  }
}

// Singleton
let instance: AnthropicFilesService | null = null;

export function getAnthropicFilesService(): AnthropicFilesService {
  if (!instance) {
    instance = new AnthropicFilesService();
  }
  return instance;
}

/**
 * Reset singleton instance for testing
 */
export function __resetAnthropicFilesService(): void {
  instance = null;
}
