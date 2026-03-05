/**
 * IFileContentProvider
 *
 * Abstraction for downloading file content regardless of storage backend.
 * Implementations: BlobContentProvider (local uploads), future OneDrive/SharePoint providers.
 *
 * @module services/connectors
 */

export interface FileContentResult {
  buffer: Buffer;
  mimeType?: string;
}

export interface IFileContentProvider {
  /**
   * Download file content by file ID.
   */
  getContent(fileId: string, userId: string): Promise<FileContentResult>;

  /**
   * Check if a file is accessible via this provider.
   */
  isAccessible(fileId: string, userId: string): Promise<boolean>;

  /**
   * Get a download URL (optional, not all providers support this).
   */
  getDownloadUrl?(fileId: string, userId: string): Promise<string>;
}
