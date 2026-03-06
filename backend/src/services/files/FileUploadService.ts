import { BlobServiceClient, ContainerClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { env } from '@/infrastructure/config/environment';
import { createChildLogger } from '@/shared/utils/logger';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';
import { FileTypeNotAllowedError } from '@/services/files/batch/errors';
import { ALLOWED_MIME_TYPES } from '@bc-agent/shared';
import type { Logger } from 'pino';

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

    // Diagnostic: Log container resolution for debugging
    this.logger.info({
      resolvedContainer: container,
      envContainerName: env.STORAGE_CONTAINER_NAME,
      injectedContainerName: containerName || null,
      fallbackUsed: !containerName && !env.STORAGE_CONTAINER_NAME,
      storageAccountUrl: this.blobServiceClient.url,
      containerUrl: this.containerClient.url,
      hasConnectionString: !!connString,
    }, 'FileUploadService initialized with container');
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
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
      this.logger.warn({ mimeType }, 'File type not allowed');
      throw new FileTypeNotAllowedError(mimeType, ALLOWED_MIME_TYPES.join(', '));
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
  // TODO: Track blob egress costs ($0.087/GB) — requires propagating userId through call chain
  public async downloadFromBlob(blobPath: string): Promise<Buffer> {
    this.logger.info({
      containerName: this.containerName,
      blobPath,
      blobUrl: this.containerClient.getBlockBlobClient(blobPath).url,
    }, 'Attempting blob download');

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
      this.logger.error({
        error: error instanceof Error ? { message: error.message, name: error.name } : error,
        blobPath,
        containerName: this.containerName,
      }, 'Failed to download file from blob');
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
   * 8. Generate SAS URL info for bulk upload
   *
   * Returns all information needed for direct-to-blob upload:
   * - sasUrl: Full URL with SAS token for PUT request
   * - blobPath: Path to store in batch metadata for later confirmation
   * - expiresAt: ISO 8601 timestamp when SAS URL expires
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileName - Original filename
   * @param mimeType - MIME type for validation
   * @param sizeBytes - File size for validation
   * @param expiryMinutes - SAS token expiry time in minutes (default: 60)
   * @returns Object with sasUrl, blobPath, and expiresAt
   */
  public async generateSasUrlForBulkUpload(
    userId: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    expiryMinutes: number = 60
  ): Promise<{ sasUrl: string; blobPath: string; expiresAt: string }> {
    // Validate file type and size
    this.validateFileType(mimeType);
    this.validateFileSize(sizeBytes, mimeType);

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

      const expiresOn = new Date(Date.now() + expiryMinutes * 60 * 1000);

      // Generate SAS token with create and write permissions for PUT
      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this.containerName,
          blobName: blobPath,
          permissions: BlobSASPermissions.parse('cw'), // Create and write
          startsOn: new Date(),
          expiresOn,
        },
        sharedKeyCredential
      ).toString();

      const sasUrl = `${blockBlobClient.url}?${sasToken}`;

      this.logger.debug({ userId, fileName, blobPath, expiryMinutes }, 'SAS URL generated for bulk upload');

      return {
        sasUrl,
        blobPath,
        expiresAt: expiresOn.toISOString(),
      };
    } catch (error) {
      this.logger.error({ error, userId, fileName }, 'Failed to generate SAS URL for bulk upload');
      throw error;
    }
  }

  /**
   * 9. Check if blob exists
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
   * 10. List all blob paths under a prefix
   *
   * @param prefix - Blob path prefix to filter by (e.g., 'users/USER-123/files/')
   * @returns Array of blob path strings
   */
  public async listBlobs(prefix: string): Promise<string[]> {
    try {
      const blobPaths: string[] = [];

      // Iterate through all blobs matching the prefix
      for await (const blob of this.containerClient.listBlobsFlat({ prefix })) {
        blobPaths.push(blob.name);
      }

      this.logger.debug({ prefix, count: blobPaths.length }, 'Listed blobs under prefix');
      return blobPaths;
    } catch (error) {
      this.logger.error({ error, prefix }, 'Failed to list blobs');
      throw error;
    }
  }

  /**
   * 11. Get blob properties (size and last modified date)
   *
   * @param blobPath - Blob path in container
   * @returns Object with size and lastModified, or null if blob does not exist
   */
  public async getBlobProperties(blobPath: string): Promise<{ size: number; lastModified: Date } | null> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);

    try {
      const properties = await blockBlobClient.getProperties();

      const result = {
        size: properties.contentLength ?? 0,
        lastModified: properties.lastModified ?? new Date(),
      };

      this.logger.debug({ blobPath, size: result.size, lastModified: result.lastModified }, 'Retrieved blob properties');
      return result;
    } catch (error: unknown) {
      // Return null if blob doesn't exist (404 / BlobNotFound)
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404) {
          this.logger.debug({ blobPath }, 'Blob does not exist');
          return null;
        }
      }

      // Check error name for BlobNotFound
      if (error instanceof Error && error.name === 'BlobNotFound') {
        this.logger.debug({ blobPath }, 'Blob does not exist');
        return null;
      }

      // Rethrow all other errors
      this.logger.error({ error, blobPath }, 'Failed to get blob properties');
      throw error;
    }
  }

  /**
   * 9. Generate a read-only SAS URL for a blob.
   *
   * Used to create short-lived HTTPS URLs that the Anthropic API can fetch
   * directly, replacing inline base64 data in graph state to avoid checkpoint
   * size bloat.
   *
   * @param blobPath - Full blob path (e.g. 'users/{userId}/files/{timestamp}-{file}')
   * @param expiryMinutes - SAS token expiry time in minutes (default: 60)
   * @returns Full blob URL with read-only SAS token
   */
  public generateReadSasUrl(blobPath: string, expiryMinutes: number = 60): string {
    const { accountName, accountKey } = this.parseStorageCredentials();
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: new Date(),
        expiresOn: new Date(Date.now() + expiryMinutes * 60 * 1000),
      },
      sharedKeyCredential,
    ).toString();

    const sasUrl = `${blockBlobClient.url}?${sasToken}`;

    this.logger.debug({ blobPath, expiryMinutes }, 'Read SAS URL generated');
    return sasUrl;
  }

  /**
   * 10. Generate SAS URLs for multiple files in bulk (outside transaction)
   *
   * Generates all SAS URLs in parallel with controlled concurrency.
   * Designed to run BEFORE a database transaction to avoid transaction timeout.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param files - Array of file metadata to generate SAS URLs for
   * @param expiryMinutes - SAS token expiry time in minutes (default: 60)
   * @returns Map keyed by tempId with sasUrl and blobPath
   */
  public async generateBulkSasUrls(
    userId: string,
    files: Array<{ tempId: string; fileName: string; mimeType: string; sizeBytes: number }>,
    expiryMinutes: number = 60,
  ): Promise<Map<string, { sasUrl: string; blobPath: string }>> {
    // 1. Validate ALL files first (fail-fast before any SAS generation)
    for (const file of files) {
      this.validateFileType(file.mimeType);
      this.validateFileSize(file.sizeBytes, file.mimeType);
    }

    // 2. Parse credentials ONCE
    const { accountName, accountKey } = this.parseStorageCredentials();
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const expiresOn = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // 3. Generate all SAS URLs in parallel (batches of 50)
    const CONCURRENCY = 50;
    const results = new Map<string, { sasUrl: string; blobPath: string }>();

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const chunk = files.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map((file) =>
          this.generateSingleSasUrl(userId, file, sharedKeyCredential, expiresOn),
        ),
      );
      for (const result of chunkResults) {
        results.set(result.tempId, { sasUrl: result.sasUrl, blobPath: result.blobPath });
      }
    }

    this.logger.info(
      { userId, fileCount: files.length, expiryMinutes },
      'Bulk SAS URLs generated',
    );

    return results;
  }

  /**
   * Parse storage credentials from connection string.
   * Extracts account name and key for SAS token generation.
   */
  private parseStorageCredentials(): { accountName: string; accountKey: string } {
    const connString = env.STORAGE_CONNECTION_STRING;
    if (!connString) {
      throw new Error('STORAGE_CONNECTION_STRING is required for SAS token generation');
    }

    const accountNameMatch = connString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connString.match(/AccountKey=([^;]+)/);

    if (!accountNameMatch?.[1] || !accountKeyMatch?.[1]) {
      throw new Error('Invalid connection string format');
    }

    return {
      accountName: accountNameMatch[1],
      accountKey: accountKeyMatch[1],
    };
  }

  /**
   * Generate a single SAS URL using pre-parsed credentials.
   */
  private generateSingleSasUrl(
    userId: string,
    file: { tempId: string; fileName: string },
    sharedKeyCredential: StorageSharedKeyCredential,
    expiresOn: Date,
  ): { tempId: string; sasUrl: string; blobPath: string } {
    const blobPath = this.generateBlobPath(userId, file.fileName);
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('cw'),
        startsOn: new Date(),
        expiresOn,
      },
      sharedKeyCredential,
    ).toString();

    const sasUrl = `${blockBlobClient.url}?${sasToken}`;

    return { tempId: file.tempId, sasUrl, blobPath };
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
