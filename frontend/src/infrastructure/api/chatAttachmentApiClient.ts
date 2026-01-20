/**
 * Chat Attachment API Client
 *
 * Handles ephemeral chat attachment operations.
 * Chat attachments are sent directly to Anthropic as document content blocks
 * (not processed through RAG/embeddings like Knowledge Base files).
 *
 * Uses XMLHttpRequest for upload progress tracking.
 *
 * @module infrastructure/api/chatAttachmentApiClient
 */

import type { ParsedChatAttachment, ApiErrorResponse } from '@bc-agent/shared';
import { isApiErrorResponse, ErrorCode } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

/**
 * API Response wrapper
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorResponse };

/**
 * Upload response from backend
 */
export interface UploadChatAttachmentResponse {
  attachment: ParsedChatAttachment;
}

/**
 * List attachments response from backend
 */
export interface ListChatAttachmentsResponse {
  attachments: ParsedChatAttachment[];
}

/**
 * Chat Attachment API Client Class
 *
 * Provides type-safe methods for all chat attachment REST endpoints.
 *
 * @example
 * ```typescript
 * const api = getChatAttachmentApiClient();
 *
 * // Upload with progress
 * const result = await api.uploadAttachment(
 *   sessionId,
 *   file,
 *   (progress) => console.log(`Upload: ${progress}%`)
 * );
 *
 * if (result.success) {
 *   console.log('Uploaded:', result.data.attachment.id);
 * }
 *
 * // List attachments
 * const list = await api.listAttachments(sessionId);
 * ```
 */
export class ChatAttachmentApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = env.apiUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an HTTP request (for GET, DELETE)
   */
  private async request<T>(
    method: 'GET' | 'DELETE',
    path: string
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        credentials: 'include', // Include cookies for session auth
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
      console.error('[ChatAttachmentApiClient] Request failed:', error);
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
  // Upload Endpoint
  // ============================================

  /**
   * Upload a chat attachment with progress tracking
   *
   * Uses XMLHttpRequest to support upload progress callbacks.
   * Attachments are ephemeral and will expire after TTL.
   *
   * @param sessionId - Session ID to associate the attachment with
   * @param file - File to upload
   * @param onProgress - Optional progress callback (0-100)
   * @param ttlHours - Optional TTL in hours (default: 24, max: 168)
   * @returns Uploaded attachment metadata
   *
   * @example
   * ```typescript
   * const result = await api.uploadAttachment(
   *   sessionId,
   *   pdfFile,
   *   (progress) => console.log(`Upload: ${progress}%`),
   *   24 // expires in 24 hours
   * );
   *
   * if (result.success) {
   *   console.log('Attachment ID:', result.data.attachment.id);
   * }
   * ```
   */
  async uploadAttachment(
    sessionId: string,
    file: File,
    onProgress?: (progress: number) => void,
    ttlHours?: number
  ): Promise<ApiResponse<UploadChatAttachmentResponse>> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();

      // Append file
      formData.append('file', file);

      // Append session ID (required)
      formData.append('sessionId', sessionId);

      // Append optional TTL
      if (ttlHours !== undefined) {
        formData.append('ttlHours', ttlHours.toString());
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
            resolve({ success: true, data: data as UploadChatAttachmentResponse });
          } else {
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
            message: 'Failed to upload attachment',
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
      xhr.open('POST', `${this.baseUrl}/api/chat/attachments`);
      xhr.withCredentials = true; // Include session cookies
      xhr.timeout = 120000; // 2 minute timeout
      xhr.send(formData);
    });
  }

  // ============================================
  // List Endpoint
  // ============================================

  /**
   * List non-expired attachments for a session
   *
   * @param sessionId - Session ID to list attachments for
   * @returns Array of attachment metadata
   *
   * @example
   * ```typescript
   * const result = await api.listAttachments(sessionId);
   * if (result.success) {
   *   console.log(`${result.data.attachments.length} attachments`);
   * }
   * ```
   */
  async listAttachments(
    sessionId: string
  ): Promise<ApiResponse<ListChatAttachmentsResponse>> {
    return this.request<ListChatAttachmentsResponse>(
      'GET',
      `/api/chat/attachments?sessionId=${encodeURIComponent(sessionId)}`
    );
  }

  // ============================================
  // Get Single Endpoint
  // ============================================

  /**
   * Get a single attachment by ID
   *
   * @param attachmentId - Attachment UUID
   * @returns Attachment metadata
   *
   * @example
   * ```typescript
   * const result = await api.getAttachment(attachmentId);
   * if (result.success) {
   *   console.log('Name:', result.data.attachment.name);
   * }
   * ```
   */
  async getAttachment(
    attachmentId: string
  ): Promise<ApiResponse<{ attachment: ParsedChatAttachment }>> {
    return this.request<{ attachment: ParsedChatAttachment }>(
      'GET',
      `/api/chat/attachments/${encodeURIComponent(attachmentId)}`
    );
  }

  // ============================================
  // Delete Endpoint
  // ============================================

  /**
   * Delete a chat attachment
   *
   * Performs soft delete. Blob will be cleaned up by the cleanup job.
   *
   * @param attachmentId - Attachment UUID to delete
   * @returns Success message
   *
   * @example
   * ```typescript
   * const result = await api.deleteAttachment(attachmentId);
   * if (result.success) {
   *   console.log('Attachment deleted');
   * }
   * ```
   */
  async deleteAttachment(
    attachmentId: string
  ): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>(
      'DELETE',
      `/api/chat/attachments/${encodeURIComponent(attachmentId)}`
    );
  }
}

// ============================================
// Singleton Instance
// ============================================

/**
 * Singleton API instance
 */
let chatAttachmentApiInstance: ChatAttachmentApiClient | null = null;

/**
 * Get or create the singleton Chat Attachment API instance
 *
 * @returns ChatAttachmentApiClient singleton
 */
export function getChatAttachmentApiClient(): ChatAttachmentApiClient {
  if (!chatAttachmentApiInstance) {
    chatAttachmentApiInstance = new ChatAttachmentApiClient();
  }
  return chatAttachmentApiInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetChatAttachmentApiClient(): void {
  chatAttachmentApiInstance = null;
}
