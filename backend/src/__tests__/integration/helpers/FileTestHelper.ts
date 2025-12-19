/**
 * FileTestHelper - Creates Test Files for Integration Tests
 *
 * Provides utilities for creating test files in Azure Blob Storage (real DEV)
 * and database records for integration testing.
 *
 * Features:
 * - Upload files to Azure Blob Storage
 * - Create file records in database
 * - Set extracted_text for EXTRACTED_TEXT strategy testing
 * - Automatic cleanup tracking
 *
 * @module __tests__/integration/helpers/FileTestHelper
 */

import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '@/infrastructure/database/database';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { getFileService } from '@/services/files/FileService';
import { TEST_PREFIX } from './constants';

/**
 * Test file data
 */
export interface TestFile {
  /** File ID (UUID) */
  id: string;
  /** File name */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Blob path in Azure Storage */
  blobPath: string;
  /** Extracted text (if set) */
  extractedText?: string;
}

/**
 * Options for creating a test file
 */
export interface CreateTestFileOptions {
  /** File name (default: test-file-{timestamp}.txt) */
  name?: string;
  /** File content as string or Buffer */
  content: string | Buffer;
  /** MIME type (default: text/plain) */
  mimeType?: string;
  /** Extracted text for EXTRACTED_TEXT strategy */
  extractedText?: string;
  /** Processing status (default: completed) */
  processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  /** Embedding status (default: pending) */
  embeddingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * File Test Helper
 *
 * Creates and tracks test files for integration tests.
 * Uses real Azure Blob Storage (DEV environment).
 * Call cleanup() after tests to remove all created files.
 */
export class FileTestHelper {
  private createdFiles: Array<{ userId: string; fileId: string; blobPath: string }> = [];

  /**
   * Create a test file in Azure Blob Storage and database
   *
   * @param userId - Owner user ID
   * @param options - File creation options
   * @returns Created test file details
   */
  async createTestFile(userId: string, options: CreateTestFileOptions): Promise<TestFile> {
    const fileUploadService = getFileUploadService();
    const fileService = getFileService();

    const name = options.name || `${TEST_PREFIX}file_${Date.now()}.txt`;
    const mimeType = options.mimeType || 'text/plain';
    const content = typeof options.content === 'string'
      ? Buffer.from(options.content, 'utf-8')
      : options.content;
    const sizeBytes = content.length;

    // Generate blob path (userId, fileName)
    const blobPath = fileUploadService.generateBlobPath(userId, name);

    // Upload to Azure Blob Storage (real DEV)
    await fileUploadService.uploadToBlob(content, blobPath, mimeType);

    // Create database record
    const fileId = await fileService.createFileRecord({
      userId,
      name,
      mimeType,
      sizeBytes,
      blobPath,
      parentFolderId: undefined,
    });

    // Update extracted_text and status if provided
    // Build dynamic UPDATE query to avoid NULL assignment validation issues
    if (options.extractedText || options.processingStatus || options.embeddingStatus) {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { fileId };

      if (options.extractedText) {
        setClauses.push('extracted_text = @extractedText');
        params.extractedText = options.extractedText;
      }
      if (options.processingStatus) {
        setClauses.push('processing_status = @processingStatus');
        params.processingStatus = options.processingStatus;
      }
      if (options.embeddingStatus) {
        setClauses.push('embedding_status = @embeddingStatus');
        params.embeddingStatus = options.embeddingStatus;
      }

      setClauses.push('updated_at = GETUTCDATE()');

      await executeQuery(
        `UPDATE files SET ${setClauses.join(', ')} WHERE id = @fileId`,
        params
      );
    }

    // Track for cleanup
    this.createdFiles.push({ userId, fileId, blobPath });

    return {
      id: fileId,
      name,
      mimeType,
      sizeBytes,
      blobPath,
      extractedText: options.extractedText,
    };
  }

  /**
   * Create a test image file (PNG)
   *
   * @param userId - Owner user ID
   * @param options - Optional overrides
   * @returns Created test file details
   */
  async createTestImage(userId: string, options?: {
    name?: string;
    width?: number;
    height?: number;
  }): Promise<TestFile> {
    // Create a minimal valid PNG (1x1 pixel, red)
    // This is a real PNG file that Claude Vision can process
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, // IHDR length
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, // width: 1
      0x00, 0x00, 0x00, 0x01, // height: 1
      0x08, 0x02, // bit depth: 8, color type: 2 (RGB)
      0x00, 0x00, 0x00, // compression, filter, interlace
      0x90, 0x77, 0x53, 0xDE, // CRC
      0x00, 0x00, 0x00, 0x0C, // IDAT length
      0x49, 0x44, 0x41, 0x54, // IDAT
      0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0x00, // compressed data
      0x05, 0xFE, 0x02, 0xFE, // CRC
      0xA9, 0x8F, 0x79, 0xCA, // CRC continued
      0x00, 0x00, 0x00, 0x00, // IEND length
      0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82, // CRC
    ]);

    return this.createTestFile(userId, {
      name: options?.name || `${TEST_PREFIX}image_${Date.now()}.png`,
      content: pngHeader,
      mimeType: 'image/png',
      processingStatus: 'completed',
    });
  }

  /**
   * Create a test file record in DB only (no blob upload)
   * Useful for testing missing blob scenarios
   *
   * @param userId - Owner user ID
   * @param options - File options
   * @returns Created test file details
   */
  async createTestFileRecordOnly(userId: string, options?: {
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
  }): Promise<TestFile> {
    const fileService = getFileService();

    const name = options?.name || `${TEST_PREFIX}ghost_${Date.now()}.txt`;
    const mimeType = options?.mimeType || 'text/plain';
    const sizeBytes = options?.sizeBytes || 1024;
    const blobPath = `users/${userId}/files/${name}`; // Path that doesn't exist

    const fileId = await fileService.createFileRecord({
      userId,
      name,
      mimeType,
      sizeBytes,
      blobPath,
      parentFolderId: undefined,
    });

    // Track for cleanup (no blob to delete)
    this.createdFiles.push({ userId, fileId, blobPath: '' });

    return {
      id: fileId,
      name,
      mimeType,
      sizeBytes,
      blobPath,
    };
  }

  /**
   * Get message file attachments for a message
   *
   * @param messageId - Message ID
   * @returns Array of attachment records
   */
  async getMessageAttachments(messageId: string): Promise<Array<{
    id: string;
    fileId: string;
    usageType: string;
    relevanceScore: number | null;
  }>> {
    const result = await executeQuery<{
      id: string;
      file_id: string;
      usage_type: string;
      relevance_score: number | null;
    }>(
      `SELECT id, file_id, usage_type, relevance_score
       FROM message_file_attachments
       WHERE message_id = @messageId`,
      { messageId }
    );

    return result.recordset.map(row => ({
      id: row.id,
      fileId: row.file_id,
      usageType: row.usage_type,
      relevanceScore: row.relevance_score,
    }));
  }

  /**
   * Get usage events for a user
   *
   * @param userId - User ID
   * @param operationType - Optional filter by operation type
   * @returns Array of usage events
   */
  async getUsageEvents(userId: string, operationType?: string): Promise<Array<{
    id: string;
    operationType: string;
    quantity: number;
  }>> {
    // Query only core columns that should always exist
    let query = `SELECT id, operation_type, quantity
                 FROM usage_events
                 WHERE user_id = @userId`;

    const params: Record<string, unknown> = { userId };

    if (operationType) {
      query += ` AND operation_type = @operationType`;
      params.operationType = operationType;
    }

    query += ` ORDER BY created_at DESC`;

    try {
      const result = await executeQuery<{
        id: string;
        operation_type: string;
        quantity: number;
      }>(query, params);

      return result.recordset.map(row => ({
        id: row.id,
        operationType: row.operation_type,
        quantity: row.quantity,
      }));
    } catch {
      // Table might not exist yet or has different schema
      return [];
    }
  }

  /**
   * Get count of tracked files
   */
  getTrackedCount(): number {
    return this.createdFiles.length;
  }

  /**
   * Cleanup all test files created by this helper
   *
   * Should be called in afterEach or afterAll hooks.
   */
  async cleanup(): Promise<void> {
    const fileUploadService = getFileUploadService();

    for (const { fileId, blobPath } of this.createdFiles) {
      // Delete blob from Azure Storage (if exists)
      if (blobPath) {
        try {
          await fileUploadService.deleteFromBlob(blobPath);
        } catch {
          // Ignore errors (blob may not exist)
        }
      }

      // Delete message_file_attachments for this file
      await executeQuery(
        `DELETE FROM message_file_attachments WHERE file_id = @fileId`,
        { fileId }
      );

      // Delete file record from database
      await executeQuery(
        `DELETE FROM files WHERE id = @fileId`,
        { fileId }
      );
    }

    // Reset tracking array
    this.createdFiles = [];
  }
}

/**
 * Create a file test helper
 *
 * @returns New FileTestHelper instance
 */
export function createFileTestHelper(): FileTestHelper {
  return new FileTestHelper();
}
