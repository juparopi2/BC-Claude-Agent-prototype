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
  BulkDeleteAcceptedResponse,
  DeletionReason,
  BulkUploadInitRequest,
  BulkUploadInitResponse,
  BulkUploadCompleteRequest,
  BulkUploadAcceptedResponse,
  CreateFolderBatchRequest,
  CreateFolderBatchResponse,
  RenewSasRequest,
  RenewSasResponse,
  // Upload session types
  InitUploadSessionRequest,
  InitUploadSessionResponse,
  GetUploadSessionResponse,
  CreateFolderInSessionResponse,
  RegisterFilesResponse,
  GetSasUrlsResponse,
  MarkFileUploadedRequest,
  MarkFileUploadedResponse,
  CompleteFolderBatchResponse,
  FileRegistrationMetadata,
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
   * @param sessionId - Optional session ID for WebSocket event targeting
   * @param onProgress - Optional progress callback (0-100)
   * @returns Uploaded files with metadata
   *
   * @example
   * ```typescript
   * const files = [file1, file2];
   * const result = await fileApi.uploadFiles(
   *   files,
   *   'folder-123',
   *   'session-uuid',
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
    sessionId?: string,
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

      // Append sessionId for WebSocket event targeting (D25)
      if (sessionId) {
        formData.append('sessionId', sessionId);
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

  /**
   * Create multiple folders in batch (for folder upload)
   *
   * Creates folders in topological order (parents before children).
   * Used when drag and dropping a folder structure.
   *
   * @param data - Batch folder creation request
   * @returns Created folders with tempId -> folderId mapping
   *
   * @example
   * ```typescript
   * const result = await fileApi.createFolderBatch({
   *   folders: [
   *     { tempId: 'temp-1', name: 'Root', parentTempId: null },
   *     { tempId: 'temp-2', name: 'Child', parentTempId: 'temp-1' },
   *   ],
   *   targetFolderId: 'folder-123',
   * });
   * ```
   */
  async createFolderBatch(data: CreateFolderBatchRequest): Promise<ApiResponse<CreateFolderBatchResponse>> {
    return this.postJson<CreateFolderBatchResponse>('/api/files/folders/batch', data);
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

  /**
   * Delete multiple files asynchronously (bulk delete)
   *
   * Enqueues deletion jobs for processing via BullMQ queue.
   * Returns immediately with 202 Accepted and tracking information.
   * Deletion status is emitted via WebSocket (FILE_WS_EVENTS.DELETED).
   *
   * @param request - File IDs to delete and optional deletion reason
   * @returns Accepted response with batchId and job IDs
   *
   * @example
   * ```typescript
   * const result = await fileApi.deleteFilesBatch({
   *   fileIds: ['file-1', 'file-2', 'file-3'],
   *   deletionReason: 'user_request',
   * });
   *
   * if (result.success) {
   *   console.log('Batch ID:', result.data.batchId);
   *   console.log('Jobs enqueued:', result.data.jobsEnqueued);
   * }
   * ```
   */
  async deleteFilesBatch(request: {
    fileIds: string[];
    deletionReason?: DeletionReason;
  }): Promise<ApiResponse<BulkDeleteAcceptedResponse>> {
    return this.request<BulkDeleteAcceptedResponse>('DELETE', '/api/files', request);
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

  // ============================================
  // Bulk Upload Endpoints (SAS URL-Based)
  // ============================================

  /**
   * Initialize bulk upload batch
   *
   * Requests SAS URLs for direct-to-blob uploads.
   * Returns 202 Accepted with batchId and SAS URLs for each file.
   *
   * @param request - Files metadata and optional parent folder ID
   * @returns Batch ID and SAS URLs for each file
   *
   * @example
   * ```typescript
   * const result = await fileApi.initBulkUpload({
   *   files: [
   *     { tempId: 'temp-1', fileName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1024000 },
   *     { tempId: 'temp-2', fileName: 'img.png', mimeType: 'image/png', sizeBytes: 500000 },
   *   ],
   *   parentFolderId: 'folder-123',
   *   sessionId: 'session-456',
   * });
   *
   * if (result.success) {
   *   console.log('Batch ID:', result.data.batchId);
   *   // Upload files directly to Azure Blob using sasUrl
   *   for (const file of result.data.files) {
   *     await fileApi.uploadToBlob(fileBlob, file.sasUrl);
   *   }
   * }
   * ```
   */
  async initBulkUpload(
    request: BulkUploadInitRequest
  ): Promise<ApiResponse<BulkUploadInitResponse>> {
    return this.postJson<BulkUploadInitResponse>('/api/files/bulk-upload/init', request);
  }

  /**
   * Complete bulk upload batch
   *
   * Confirms successful uploads and enqueues processing jobs.
   * Returns 202 Accepted with job tracking information.
   *
   * @param request - Batch ID and upload results
   * @returns Job tracking information
   *
   * @example
   * ```typescript
   * const result = await fileApi.completeBulkUpload({
   *   batchId: 'BATCH-123',
   *   uploads: [
   *     { tempId: 'temp-1', success: true, contentHash: 'abc123...' },
   *     { tempId: 'temp-2', success: false, error: 'Network error' },
   *   ],
   *   parentFolderId: 'folder-456',
   * });
   *
   * if (result.success) {
   *   console.log('Jobs enqueued:', result.data.jobsEnqueued);
   * }
   * ```
   */
  async completeBulkUpload(
    request: BulkUploadCompleteRequest
  ): Promise<ApiResponse<BulkUploadAcceptedResponse>> {
    return this.postJson<BulkUploadAcceptedResponse>('/api/files/bulk-upload/complete', request);
  }

  /**
   * Renew expired SAS URLs for pending file uploads
   *
   * Used when resuming an interrupted upload after SAS URLs have expired.
   *
   * @param request - Batch ID and tempIds needing new SAS URLs
   * @returns Renewed SAS URLs for the requested files
   *
   * @example
   * ```typescript
   * const result = await fileApi.renewSas({
   *   batchId: 'batch-123',
   *   tempIds: ['temp-1', 'temp-2'],
   * });
   *
   * if (result.success) {
   *   console.log('Renewed SAS URLs:', result.data.files.length);
   * }
   * ```
   */
  async renewSas(request: RenewSasRequest): Promise<ApiResponse<RenewSasResponse>> {
    return this.postJson<RenewSasResponse>('/api/files/bulk-upload/renew-sas', request);
  }

  /**
   * Upload file directly to Azure Blob Storage using SAS URL
   *
   * Uses XMLHttpRequest for progress tracking.
   * This bypasses the backend - file goes directly to Azure.
   *
   * @param file - File to upload
   * @param sasUrl - Pre-signed SAS URL from initBulkUpload
   * @param onProgress - Optional progress callback (0-100)
   * @returns Upload result
   *
   * @example
   * ```typescript
   * const result = await fileApi.uploadToBlob(
   *   file,
   *   sasUrl,
   *   (progress) => console.log(`Upload: ${progress}%`)
   * );
   *
   * if (result.success) {
   *   console.log('File uploaded to blob');
   * } else {
   *   console.error('Upload failed:', result.error);
   * }
   * ```
   */
  async uploadToBlob(
    file: File,
    sasUrl: string,
    onProgress?: (progress: number) => void
  ): Promise<{ success: true } | { success: false; error: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();

      // Upload progress tracking
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });

      // Upload complete
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: `Upload failed with status ${xhr.status}: ${xhr.statusText}`,
          });
        }
      });

      // Network error
      xhr.addEventListener('error', () => {
        resolve({
          success: false,
          error: 'Network error during upload',
        });
      });

      // Upload timeout
      xhr.addEventListener('timeout', () => {
        resolve({
          success: false,
          error: 'Upload request timed out',
        });
      });

      // Upload aborted
      xhr.addEventListener('abort', () => {
        resolve({
          success: false,
          error: 'Upload was cancelled',
        });
      });

      // Send request to Azure Blob Storage
      xhr.open('PUT', sasUrl);
      xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.timeout = 300000; // 5 minute timeout for large files
      xhr.send(file);
    });
  }

  // ============================================
  // Upload Session Endpoints (Folder-Based Batch Upload)
  // ============================================

  /**
   * Initialize a folder-based upload session
   *
   * Creates a new upload session with folder batches for tracking progress.
   * Each folder becomes a batch that's processed sequentially.
   *
   * @param request - Folders with their files to upload
   * @returns Session ID and folder batches
   *
   * @example
   * ```typescript
   * const result = await fileApi.initUploadSession({
   *   folders: [
   *     {
   *       tempId: 'folder-1',
   *       name: 'Documents',
   *       parentTempId: null,
   *       files: [
   *         { tempId: 'file-1', fileName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }
   *       ]
   *     }
   *   ],
   *   targetFolderId: 'FOLDER-123',
   * });
   *
   * if (result.success) {
   *   console.log('Session ID:', result.data.sessionId);
   * }
   * ```
   */
  async initUploadSession(
    request: InitUploadSessionRequest
  ): Promise<ApiResponse<InitUploadSessionResponse>> {
    return this.postJson<InitUploadSessionResponse>('/api/files/upload-session/init', request);
  }

  /**
   * Get upload session status
   *
   * @param sessionId - Session ID
   * @returns Session state and computed progress
   */
  async getUploadSession(sessionId: string): Promise<ApiResponse<GetUploadSessionResponse>> {
    return this.request<GetUploadSessionResponse>('GET', `/api/files/upload-session/${sessionId}`);
  }

  /**
   * Create a folder within an upload session
   *
   * Creates the folder in the database and updates batch status to 'registering'.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder temp ID
   * @returns Created folder ID and updated batch
   */
  async createSessionFolder(
    sessionId: string,
    tempId: string
  ): Promise<ApiResponse<CreateFolderInSessionResponse>> {
    return this.postJson<CreateFolderInSessionResponse>(
      `/api/files/upload-session/${sessionId}/folder/${tempId}/create`,
      {}
    );
  }

  /**
   * Register files for early persistence
   *
   * Creates file records in the database with 'uploading' state.
   * Files will appear in the UI immediately.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder temp ID
   * @param files - File metadata to register
   * @returns Registered files with database IDs
   */
  async registerSessionFiles(
    sessionId: string,
    tempId: string,
    files: FileRegistrationMetadata[]
  ): Promise<ApiResponse<RegisterFilesResponse>> {
    return this.postJson<RegisterFilesResponse>(
      `/api/files/upload-session/${sessionId}/folder/${tempId}/register-files`,
      { files }
    );
  }

  /**
   * Get SAS URLs for registered files
   *
   * @param sessionId - Session ID
   * @param tempId - Folder temp ID
   * @param fileIds - File IDs to get URLs for
   * @returns SAS URLs for each file
   */
  async getSessionSasUrls(
    sessionId: string,
    tempId: string,
    fileIds: string[]
  ): Promise<ApiResponse<GetSasUrlsResponse>> {
    return this.postJson<GetSasUrlsResponse>(
      `/api/files/upload-session/${sessionId}/folder/${tempId}/get-sas-urls`,
      { fileIds }
    );
  }

  /**
   * Mark a file as uploaded
   *
   * Updates the file record with blob path and enqueues processing.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder temp ID
   * @param request - File ID and content hash
   * @returns Success status and updated batch
   */
  async markSessionFileUploaded(
    sessionId: string,
    tempId: string,
    request: MarkFileUploadedRequest
  ): Promise<ApiResponse<MarkFileUploadedResponse>> {
    return this.postJson<MarkFileUploadedResponse>(
      `/api/files/upload-session/${sessionId}/folder/${tempId}/mark-uploaded`,
      request
    );
  }

  /**
   * Complete a folder batch
   *
   * Marks the folder batch as 'processing' and advances to next folder.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder temp ID
   * @returns Updated batch and session
   */
  async completeSessionFolder(
    sessionId: string,
    tempId: string
  ): Promise<ApiResponse<CompleteFolderBatchResponse>> {
    return this.postJson<CompleteFolderBatchResponse>(
      `/api/files/upload-session/${sessionId}/folder/${tempId}/complete`,
      {}
    );
  }

  /**
   * Send heartbeat to keep session alive
   *
   * @param sessionId - Session ID
   * @returns Success status
   */
  async heartbeatUploadSession(sessionId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.postJson<{ success: boolean }>(
      `/api/files/upload-session/${sessionId}/heartbeat`,
      {}
    );
  }

  /**
   * Cancel and delete an upload session
   *
   * Use this for stale session recovery when a previous upload failed mid-way.
   * Partial files in the database will be cleaned by FileCleanupWorker.
   *
   * @param sessionId - Session ID to cancel
   * @returns Success status and whether a session was cancelled
   *
   * @example
   * ```typescript
   * const result = await fileApi.cancelUploadSession('SESSION-123');
   *
   * if (result.success && result.data.cancelled) {
   *   console.log('Previous session cancelled, can start new upload');
   * }
   * ```
   */
  async cancelUploadSession(
    sessionId: string
  ): Promise<ApiResponse<{ success: boolean; cancelled: boolean }>> {
    return this.request<{ success: boolean; cancelled: boolean }>(
      'DELETE',
      `/api/files/upload-session/${sessionId}`
    );
  }

  /**
   * Cancel the user's current active upload session (if any)
   *
   * Useful for auto-recovery when initializing a new upload fails
   * due to an existing active session.
   *
   * @returns Success status and whether a session was cancelled
   *
   * @example
   * ```typescript
   * // Auto-recover from CONFLICT error
   * const initResult = await fileApi.initUploadSession(request);
   * if (!initResult.success && initResult.error.code === 'CONFLICT') {
   *   const cancelResult = await fileApi.cancelActiveUploadSession();
   *   if (cancelResult.success && cancelResult.data.cancelled) {
   *     // Retry init
   *     const retryResult = await fileApi.initUploadSession(request);
   *   }
   * }
   * ```
   */
  async cancelActiveUploadSession(): Promise<ApiResponse<{ success: boolean; cancelled: boolean }>> {
    return this.postJson<{ success: boolean; cancelled: boolean }>(
      '/api/files/upload-session/cancel-active',
      {}
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
