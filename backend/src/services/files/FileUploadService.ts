import { BlobServiceClient, ContainerClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { env } from '@/infrastructure/config/environment';
import { createChildLogger } from '@/shared/utils/logger';
import { getUsageTrackingService } from '@services/tracking/UsageTrackingService';
import type { Logger } from 'pino';

// File type whitelist
const ALLOWED_MIME_TYPES = [
  // Documents
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // XLSX
  'text/plain',
  'text/csv',
  'text/markdown',

  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',

  // Code
  'application/json',
  'text/javascript',
  'text/html',
  'text/css',
];

// Size limits (bytes)
const MAX_FILE_SIZE_GENERAL = 100 * 1024 * 1024;  // 100 MB
const MAX_FILE_SIZE_IMAGE = 30 * 1024 * 1024;     // 30 MB (Anthropic limit)

// Upload strategy threshold
const SINGLE_PUT_THRESHOLD = 256 * 1024 * 1024;   // 256 MB
const BLOCK_SIZE = 4 * 1024 * 1024;               // 4 MB chunks

/**
 * File Upload Service
 *
 * Provides Azure Blob Storage integration for file uploads with smart upload strategies,
 * multi-tenant isolation, and comprehensive validation.
 *
 * Key Features:
 * - Smart upload: single-put < 256MB (cost-effective), block upload >= 256MB (parallel)
 * - Multi-tenant blob paths: users/{userId}/files/{timestamp}-{filename}
 * - File type whitelist (documents, images, code)
 * - Size limits: 100MB general, 30MB images (Anthropic API constraint)
 * - SAS token generation for client-side direct upload
 */
export class FileUploadService {
  private static instance: FileUploadService | null = null;
  private logger: Logger;
  private blobServiceClient: BlobServiceClient;
  private containerClient: ContainerClient;
  private containerName: string;

  private constructor(
    containerName?: string,
    connectionString?: string
  ) {
    this.logger = createChildLogger({ service: 'FileUploadService' });

    // Use injected values or environment variables
    const connString = connectionString || env.STORAGE_CONNECTION_STRING;
    const container = containerName || env.STORAGE_CONTAINER_NAME || 'user-files';

    if (!connString) {
      throw new Error('STORAGE_CONNECTION_STRING is required');
    }

    this.blobServiceClient = BlobServiceClient.fromConnectionString(connString);
    this.containerClient = this.blobServiceClient.getContainerClient(container);
    this.containerName = container;

    this.logger.info({ container }, 'FileUploadService initialized');
  }

  public static getInstance(
    containerName?: string,
    connectionString?: string
  ): FileUploadService {
    if (!FileUploadService.instance) {
      FileUploadService.instance = new FileUploadService(containerName, connectionString);
    }
    return FileUploadService.instance;
  }

  /**
   * 1. Generate multi-tenant blob path
   *
   * Path format: users/{userId}/files/{timestamp}-{sanitized-filename}
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileName - Original filename
   * @param parentPath - Optional parent path (unused, reserved for future)
   * @returns Generated blob path
   *
   * @example
   * generateBlobPath('user-123', 'invoice.pdf')
   * // => 'users/user-123/files/1733683200000-invoice.pdf'
   */
  public generateBlobPath(userId: string, fileName: string, parentPath?: string): string {
    const timestamp = Date.now();
    const sanitizedFileName = this.sanitizeFileName(fileName);

    const blobPath = `users/${userId}/files/${timestamp}-${sanitizedFileName}`;

    this.logger.debug({ userId, fileName, blobPath, parentPath }, 'Generated blob path');
    return blobPath;
  }

  /**
   * 2. Validate file type against whitelist
   *
   * @param mimeType - MIME type to validate
   * @throws Error if MIME type is not allowed
   */
  public validateFileType(mimeType: string): void {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      this.logger.warn({ mimeType }, 'File type not allowed');
      throw new Error(`File type not allowed: ${mimeType}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    this.logger.debug({ mimeType }, 'File type validated');
  }

  /**
   * 3. Validate file size against limits
   *
   * @param sizeBytes - File size in bytes
   * @param mimeType - MIME type (determines which limit to apply)
   * @throws Error if file exceeds size limit
   */
  public validateFileSize(sizeBytes: number, mimeType: string): void {
    const isImage = mimeType.startsWith('image/');
    const maxSize = isImage ? MAX_FILE_SIZE_IMAGE : MAX_FILE_SIZE_GENERAL;
    const maxSizeMB = maxSize / (1024 * 1024);

    if (sizeBytes > maxSize) {
      this.logger.warn({ sizeBytes, mimeType, maxSize }, 'File size exceeds limit');
      throw new Error(`File size exceeds ${maxSizeMB}MB limit for ${isImage ? 'images' : 'files'}`);
    }

    this.logger.debug({ sizeBytes, mimeType, maxSize }, 'File size validated');
  }

  /**
   * 4. Upload file to Azure Blob Storage with smart upload strategy
   *
   * Strategy:
   * - Single-put for files < 256 MB (one API call, cost-effective)
   * - Block upload for files >= 256 MB (4 MB chunks, parallel)
   *
   * @param buffer - File buffer to upload
   * @param blobPath - Blob path in container
   * @param contentType - MIME type for Content-Type header
   * @param userId - Optional user ID for usage tracking
   * @param fileId - Optional file ID for usage tracking
   */
  public async uploadToBlob(
    buffer: Buffer,
    blobPath: string,
    contentType: string,
    userId?: string,
    fileId?: string
  ): Promise<void> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);
    let uploadStrategy: 'single-put' | 'block-upload';

    try {
      // Single-put for small files (cost-effective, one API call)
      if (buffer.length < SINGLE_PUT_THRESHOLD) {
        await blockBlobClient.upload(buffer, buffer.length, {
          blobHTTPHeaders: { blobContentType: contentType }
        });
        uploadStrategy = 'single-put';
        this.logger.info({ blobPath, size: buffer.length, strategy: uploadStrategy }, 'File uploaded');
      } else {
        // Block upload for large files (4 MB chunks, parallel upload)
        const blockIds: string[] = [];

        for (let offset = 0; offset < buffer.length; offset += BLOCK_SIZE) {
          const blockId = Buffer.from(`block-${offset}`).toString('base64');
          const chunkSize = Math.min(BLOCK_SIZE, buffer.length - offset);
          const chunk = buffer.subarray(offset, offset + chunkSize);

          await blockBlobClient.stageBlock(blockId, chunk, chunkSize);
          blockIds.push(blockId);
        }

        await blockBlobClient.commitBlockList(blockIds, {
          blobHTTPHeaders: { blobContentType: contentType }
        });

        uploadStrategy = 'block-upload';
        this.logger.info({ blobPath, size: buffer.length, blocks: blockIds.length, strategy: uploadStrategy }, 'File uploaded');
      }

      // Track file upload usage (fire-and-forget)
      if (userId && fileId) {
        const usageTrackingService = getUsageTrackingService();

        // Extract fileName from blobPath
        const fileName = blobPath.split('/').pop() || 'unknown';

        usageTrackingService.trackFileUpload(userId, fileId, buffer.length, {
          mimeType: contentType,
          uploadStrategy,
          fileName,
          blobPath
        }).catch((err) => {
          // Fire-and-forget: log but don't fail the upload
          this.logger.warn({ err, userId, fileId, blobPath }, 'Failed to track file upload');
        });
      }
    } catch (error) {
      this.logger.error({ error, blobPath, size: buffer.length }, 'Failed to upload file to blob');
      throw error;
    }
  }

  /**
   * 5. Download file from Azure Blob Storage
   *
   * @param blobPath - Blob path in container
   * @returns File buffer
   */
  public async downloadFromBlob(blobPath: string): Promise<Buffer> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);

    try {
      const downloadResponse = await blockBlobClient.download();

      if (!downloadResponse.readableStreamBody) {
        throw new Error('Failed to download blob: no readable stream');
      }

      // Read stream into buffer
      const chunks: Buffer[] = [];
      for await (const chunk of downloadResponse.readableStreamBody) {
        chunks.push(Buffer.from(chunk));
      }

      const buffer = Buffer.concat(chunks);

      this.logger.info({ blobPath, size: buffer.length }, 'File downloaded from blob');
      return buffer;
    } catch (error) {
      this.logger.error({ error, blobPath }, 'Failed to download file from blob');
      throw error;
    }
  }

  /**
   * 6. Delete file from Azure Blob Storage
   *
   * Idempotent: ignores 404 errors (blob already deleted)
   *
   * @param blobPath - Blob path in container
   */
  public async deleteFromBlob(blobPath: string): Promise<void> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);

    try {
      const deleted = await blockBlobClient.deleteIfExists();

      if (deleted.succeeded) {
        this.logger.info({ blobPath }, 'File deleted from blob');
      } else {
        this.logger.info({ blobPath }, 'File does not exist (already deleted)');
      }
    } catch (error) {
      this.logger.error({ error, blobPath }, 'Failed to delete file from blob');
      throw error;
    }
  }

  /**
   * 7. Generate SAS token for client-side direct upload
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileName - Original filename
   * @param expiryMinutes - SAS token expiry time in minutes (default: 60)
   * @returns Full blob URL with SAS token
   */
  public async generateSasToken(userId: string, fileName: string, expiryMinutes: number = 60): Promise<string> {
    const blobPath = this.generateBlobPath(userId, fileName);
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);

    try {
      // Extract account name and key from connection string
      const connString = env.STORAGE_CONNECTION_STRING;
      if (!connString) {
        throw new Error('STORAGE_CONNECTION_STRING is required for SAS token generation');
      }

      const accountNameMatch = connString.match(/AccountName=([^;]+)/);
      const accountKeyMatch = connString.match(/AccountKey=([^;]+)/);

      if (!accountNameMatch?.[1] || !accountKeyMatch?.[1]) {
        throw new Error('Invalid connection string format');
      }

      const accountName = accountNameMatch[1];
      const accountKey = accountKeyMatch[1];

      const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

      // Generate SAS token with write permission
      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this.containerName,
          blobName: blobPath,
          permissions: BlobSASPermissions.parse('w'), // Write permission
          startsOn: new Date(),
          expiresOn: new Date(Date.now() + expiryMinutes * 60 * 1000),
        },
        sharedKeyCredential
      ).toString();

      const sasUrl = `${blockBlobClient.url}?${sasToken}`;

      this.logger.info({ userId, fileName, blobPath, expiryMinutes }, 'SAS token generated');
      return sasUrl;
    } catch (error) {
      this.logger.error({ error, userId, fileName }, 'Failed to generate SAS token');
      throw error;
    }
  }

  /**
   * 8. Check if blob exists
   *
   * @param blobPath - Blob path in container
   * @returns True if blob exists, false otherwise
   */
  public async blobExists(blobPath: string): Promise<boolean> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);

    try {
      const exists = await blockBlobClient.exists();
      this.logger.debug({ blobPath, exists }, 'Blob existence checked');
      return exists;
    } catch (error) {
      this.logger.error({ error, blobPath }, 'Failed to check blob existence');
      throw error;
    }
  }

  /**
   * Sanitize filename for Azure Blob Storage paths
   *
   * ⚠️ WARNING: This function STRIPS ALL Unicode characters (æøå, emoji, –, •, etc.)
   *
   * Use ONLY for generating blob_path for Azure Storage.
   * DO NOT use for the database 'name' field - that should preserve Unicode.
   *
   * @param fileName - Original filename with Unicode characters
   * @returns ASCII-only filename safe for Azure Blob Storage
   * @example
   * sanitizeFileName('Test – æøå.pdf') // Returns: 'Test-.pdf'
   */
  private sanitizeFileName(fileName: string): string {
    // Remove path traversal attempts
    const baseName = fileName.replace(/^.*[\\\/]/, '');

    // Replace unsafe characters with hyphens
    const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, '-');

    // Remove consecutive hyphens
    return sanitized.replace(/-+/g, '-');
  }
}

// Convenience getter
export function getFileUploadService(
  containerName?: string,
  connectionString?: string
): FileUploadService {
  return FileUploadService.getInstance(containerName, connectionString);
}

// Reset for testing
export async function __resetFileUploadService(): Promise<void> {
  (FileUploadService as any).instance = null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
