/**
 * File API Client
 *
 * Handles all file management API operations.
 * Uses XMLHttpRequest for upload progress tracking.
 *
 * @module infrastructure/api/fileApiClient
 */

import type {
  GetFilesOptions,
  CreateFolderRequest,
  UpdateFileRequest,
  FilesListResponse,
  FileResponse,
  FolderResponse,
  UploadFilesResponse,
  ApiErrorResponse,
  CheckDuplicatesRequest,
  CheckDuplicatesResponse,
  RetryProcessingRequest,
  RetryProcessingResponse,
} from '@bc-agent/shared';
import { isApiErrorResponse, ErrorCode } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

/**
 * API Response wrapper
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorResponse };

/**
 * File API Client Class
 *
 * Provides type-safe methods for all file-related backend REST endpoints.
 *
 * Key Features:
 * - XMLHttpRequest for upload progress tracking
 * - Session-based authentication with credentials
 * - Type-safe with shared types from @bc-agent/shared
 *
 * @example
 * ```typescript
 * const fileApi = getFileApiClient();
 *
 * // List files
 * const result = await fileApi.getFiles({ folderId: null });
 * if (result.success) {
 *   console.log(result.data.files);
 * }
 *
 * // Upload with progress
 * await fileApi.uploadFiles(files, undefined, (progress) => {
 *   console.log(`Upload: ${progress}%`);
 * });
 * ```
 */
export class FileApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = env.apiUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an HTTP request (for GET, PATCH, DELETE)
   */
  private async request<T>(
    method: 'GET' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    try {
      const headers: Record<string, string> = {};
      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        credentials: 'include', // Include cookies for session auth
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle 204 No Content (successful delete with no body)
      if (response.status === 204) {
        return { success: true, data: {} as T };
      }

      const data = await response.json();

      if (!response.ok) {
        if (isApiErrorResponse(data)) {
          return { success: false, error: data };
        }
        // Create a generic error response
        return {
          success: false,
          error: {
            error: response.statusText,
            message: data.message || 'An error occurred',
            code: ErrorCode.INTERNAL_ERROR,
          },
        };
      }

      return { success: true, data: data as T };
    } catch (error) {
      console.error('[FileApiClient] Request failed:', error);
      return {
        success: false,
        error: {
          error: 'Network Error',
          message: error instanceof Error ? error.message : 'Failed to connect to server',
          code: ErrorCode.SERVICE_UNAVAILABLE,
        },
      };
    }
  }

  /**
   * Make a POST request with JSON body (for createFolder)
   */
  private async postJson<T>(
    path: string,
    body: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        if (isApiErrorResponse(data)) {
          return { success: false, error: data };
        }
        return {
          success: false,
          error: {
            error: response.statusText,
            message: data.message || 'An error occurred',
            code: ErrorCode.INTERNAL_ERROR,
          },
        };
      }

      return { success: true, data: data as T };
    } catch (error) {
      console.error('[FileApiClient] POST request failed:', error);
      return {
        success: false,
        error: {
          error: 'Network Error',
          message: error instanceof Error ? error.message : 'Failed to connect to server',
          code: ErrorCode.SERVICE_UNAVAILABLE,
        },
      };
    }
  }

  // ============================================
  // File Listing Endpoints
  // ============================================

  /**
   * Get files with optional filtering and pagination
   *
   * @param options - Query options (folderId, sortBy, favoritesFirst, limit, offset)
   * @returns File list with pagination metadata
   *
   * @example
   * ```typescript
   * // List root-level files
   * const result = await fileApi.getFiles({ folderId: null });
   *
   * // List folder contents
   * const result = await fileApi.getFiles({ folderId: 'folder-123' });
   *
   * // List with favorites first (at root: favorites from any folder + root items)
   * const result = await fileApi.getFiles({
   *   favoritesFirst: true,
   *   sortBy: 'date',
   *   limit: 20,
   * });
   * ```
   */
  async getFiles(options?: GetFilesOptions): Promise<ApiResponse<FilesListResponse>> {
    const params = new URLSearchParams();

    // Only include folderId if it's a valid string (not null/undefined)
    // Omitting folderId means "list root folder"
    if (options?.folderId !== undefined && options.folderId !== null) {
      params.set('folderId', options.folderId);
    }
    if (options?.sortBy) {
      params.set('sortBy', options.sortBy);
    }
    if (options?.favoritesFirst !== undefined) {
      params.set('favoritesFirst', options.favoritesFirst.toString());
    }
    if (options?.limit !== undefined) {
      params.set('limit', options.limit.toString());
    }
    if (options?.offset !== undefined) {
      params.set('offset', options.offset.toString());
    }

    const query = params.toString();
    const path = `/api/files${query ? `?${query}` : ''}`;
    return this.request<FilesListResponse>('GET', path);
  }

  /**
   * Get a single file by ID
   *
   * @param fileId - File UUID
   * @returns File details
   *
   * @example
   * ```typescript
   * const result = await fileApi.getFile('file-123');
   * if (result.success) {
   *   console.log(result.data.file.name);
   * }
   * ```
   */
  async getFile(fileId: string): Promise<ApiResponse<FileResponse>> {
    return this.request<FileResponse>('GET', `/api/files/${fileId}`);
  }

  // ============================================
  // File Upload Endpoint
  // ============================================

  /**
   * Upload files with progress tracking
   *
   * Uses XMLHttpRequest instead of fetch to support upload progress callbacks.
   * Supports multiple file uploads in a single request.
   *
   * @param files - Array of File objects to upload
   * @param parentFolderId - Optional parent folder ID (undefined = root level)
   * @param onProgress - Optional progress callback (0-100)
   * @returns Uploaded files with metadata
   *
   * @example
   * ```typescript
   * const files = [file1, file2];
   * const result = await fileApi.uploadFiles(
   *   files,
   *   'folder-123',
   *   (progress) => console.log(`Upload: ${progress}%`)
   * );
   *
   * if (result.success) {
   *   console.log('Uploaded:', result.data.files);
   * }
   * ```
   */
  async uploadFiles(
    files: File[],
    parentFolderId?: string,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<UploadFilesResponse>> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();

      // Append all files to form data
      files.forEach((file) => formData.append('files', file));

      // Append optional parent folder ID
      if (parentFolderId !== undefined) {
        formData.append('parentFolderId', parentFolderId);
      }

      // Upload progress tracking
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });

      // Upload complete
      xhr.addEventListener('load', () => {
        try {
          const data = JSON.parse(xhr.responseText);

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ success: true, data: data as UploadFilesResponse });
          } else {
            // Server returned an error
            if (isApiErrorResponse(data)) {
              resolve({ success: false, error: data });
            } else {
              resolve({
                success: false,
                error: {
                  error: xhr.statusText,
                  message: data.message || 'Upload failed',
                  code: ErrorCode.INTERNAL_ERROR,
                },
              });
            }
          }
        } catch (error) {
          resolve({
            success: false,
            error: {
              error: 'Parse Error',
              message: error instanceof Error ? error.message : 'Invalid response',
              code: ErrorCode.INTERNAL_ERROR,
            },
          });
        }
      });

      // Network error
      xhr.addEventListener('error', () => {
        resolve({
          success: false,
          error: {
            error: 'Network Error',
            message: 'Failed to upload files',
            code: ErrorCode.SERVICE_UNAVAILABLE,
          },
        });
      });

      // Upload timeout
      xhr.addEventListener('timeout', () => {
        resolve({
          success: false,
          error: {
            error: 'Timeout',
            message: 'Upload request timed out',
            code: ErrorCode.SERVICE_UNAVAILABLE,
          },
        });
      });

      // Upload aborted
      xhr.addEventListener('abort', () => {
        resolve({
          success: false,
          error: {
            error: 'Aborted',
            message: 'Upload was cancelled',
            code: ErrorCode.INTERNAL_ERROR,
          },
        });
      });

      // Send request
      xhr.open('POST', `${this.baseUrl}/api/files/upload`);
      xhr.withCredentials = true; // Include session cookies
      xhr.timeout = 120000; // 2 minute timeout for large files
      xhr.send(formData);
    });
  }

  // ============================================
  // Duplicate Detection Endpoint
  // ============================================

  /**
   * Check for duplicate files by content hash
   *
   * Used before upload to detect if files with identical content already exist.
   * This enables showing a conflict resolution dialog to the user.
   *
   * @param request - Files to check (with content hashes)
   * @returns Duplicate status for each file
   *
   * @example
   * ```typescript
   * const result = await fileApi.checkDuplicates({
   *   files: [
   *     { tempId: 'temp-1', contentHash: 'abc123...', fileName: 'doc.pdf' },
   *     { tempId: 'temp-2', contentHash: 'def456...', fileName: 'img.png' },
   *   ],
   * });
   *
   * if (result.success) {
   *   const duplicates = result.data.results.filter(r => r.isDuplicate);
   *   console.log(`Found ${duplicates.length} duplicate files`);
   * }
   * ```
   */
  async checkDuplicates(
    request: CheckDuplicatesRequest
  ): Promise<ApiResponse<CheckDuplicatesResponse>> {
    return this.postJson<CheckDuplicatesResponse>('/api/files/check-duplicates', request);
  }

  // ============================================
  // Folder Creation Endpoint
  // ============================================

  /**
   * Create a new folder
   *
   * @param data - Folder name and optional parent folder ID
   * @returns Created folder details
   *
   * @example
   * ```typescript
   * // Create root-level folder
   * const result = await fileApi.createFolder({ name: 'My Documents' });
   *
   * // Create nested folder
   * const result = await fileApi.createFolder({
   *   name: 'Invoices',
   *   parentFolderId: 'folder-123',
   * });
   * ```
   */
  async createFolder(data: CreateFolderRequest): Promise<ApiResponse<FolderResponse>> {
    return this.postJson<FolderResponse>('/api/files/folders', data);
  }

  // ============================================
  // File Update Endpoint
  // ============================================

  /**
   * Update a file (rename, move, favorite)
   *
   * All fields are optional (partial update).
   *
   * @param fileId - File UUID
   * @param data - Fields to update
   * @returns Updated file details
   *
   * @example
   * ```typescript
   * // Rename file
   * await fileApi.updateFile('file-123', { name: 'new-name.pdf' });
   *
   * // Move to folder
   * await fileApi.updateFile('file-123', { parentFolderId: 'folder-456' });
   *
   * // Move to root and mark as favorite
   * await fileApi.updateFile('file-123', {
   *   parentFolderId: null,
   *   isFavorite: true,
   * });
   * ```
   */
  async updateFile(
    fileId: string,
    data: UpdateFileRequest
  ): Promise<ApiResponse<FileResponse>> {
    return this.request<FileResponse>('PATCH', `/api/files/${fileId}`, data);
  }

  // ============================================
  // File Deletion Endpoint
  // ============================================

  /**
   * Delete a file or folder
   *
   * Note: Deleting a folder will also delete all its contents recursively.
   *
   * @param fileId - File or folder UUID
   * @returns Success status
   *
   * @example
   * ```typescript
   * const result = await fileApi.deleteFile('file-123');
   * if (result.success) {
   *   console.log('File deleted');
   * }
   * ```
   */
  async deleteFile(fileId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>('DELETE', `/api/files/${fileId}`);
  }

  // ============================================
  // File Download Endpoint
  // ============================================

  /**
   * Download a file as Blob
   *
   * Returns the raw file content as a Blob that can be saved to disk
   * or opened in a new tab.
   *
   * @param fileId - File UUID
   * @returns File content as Blob
   *
   * @example
   * ```typescript
   * const result = await fileApi.downloadFile('file-123');
   * if (result.success) {
   *   const blob = result.data;
   *   const url = URL.createObjectURL(blob);
   *   const a = document.createElement('a');
   *   a.href = url;
   *   a.download = 'document.pdf';
   *   a.click();
   *   URL.revokeObjectURL(url);
   * }
   * ```
   */
  async downloadFile(fileId: string): Promise<ApiResponse<Blob>> {
    const url = `${this.baseUrl}/api/files/${fileId}/download`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        // Try to parse error response
        try {
          const data = await response.json();
          if (isApiErrorResponse(data)) {
            return { success: false, error: data };
          }
          return {
            success: false,
            error: {
              error: response.statusText,
              message: data.message || 'Download failed',
              code: ErrorCode.INTERNAL_ERROR,
            },
          };
        } catch {
          return {
            success: false,
            error: {
              error: response.statusText,
              message: 'Download failed',
              code: ErrorCode.INTERNAL_ERROR,
            },
          };
        }
      }

      const blob = await response.blob();
      return { success: true, data: blob };
    } catch (error) {
      console.error('[FileApiClient] Download failed:', error);
      return {
        success: false,
        error: {
          error: 'Network Error',
          message: error instanceof Error ? error.message : 'Failed to download file',
          code: ErrorCode.SERVICE_UNAVAILABLE,
        },
      };
    }
  }

  // ============================================
  // File Retry Processing Endpoint (D25)
  // ============================================

  /**
   * Retry processing for a failed file
   *
   * Triggers re-processing of a file that has permanently failed.
   * Can retry full processing or just embedding generation.
   *
   * @param fileId - File UUID
   * @param request - Optional retry options (scope: 'full' | 'embedding_only')
   * @returns Updated file and job ID
   *
   * @example
   * ```typescript
   * // Retry full processing
   * const result = await fileApi.retryProcessing('file-123');
   *
   * // Retry embedding only
   * const result = await fileApi.retryProcessing('file-123', {
   *   scope: 'embedding_only',
   * });
   *
   * if (result.success) {
   *   console.log('Retry initiated, job ID:', result.data.jobId);
   * }
   * ```
   */
  async retryProcessing(
    fileId: string,
    request?: RetryProcessingRequest
  ): Promise<ApiResponse<RetryProcessingResponse>> {
    return this.postJson<RetryProcessingResponse>(
      `/api/files/${fileId}/retry-processing`,
      request ?? {}
    );
  }
}

// ============================================
// Singleton Instance
// ============================================

/**
 * Singleton API instance
 */
let fileApiInstance: FileApiClient | null = null;

/**
 * Get or create the singleton File API instance
 *
 * @returns FileApiClient singleton
 */
export function getFileApiClient(): FileApiClient {
  if (!fileApiInstance) {
    fileApiInstance = new FileApiClient();
  }
  return fileApiInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetFileApiClient(): void {
  fileApiInstance = null;
}
