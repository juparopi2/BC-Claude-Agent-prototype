/**
 * Upload API Client
 *
 * Handles batch upload API operations.
 * Unified manifest-in, SAS-URLs-out, confirm-per-file pattern.
 *
 * @module infrastructure/api/uploadApiClient
 */

import type {
  CheckDuplicatesRequest,
  CheckDuplicatesResponse,
  CheckFolderDuplicatesRequest,
  CheckFolderDuplicatesResponse,
  CreateBatchRequest,
  CreateBatchResponse,
  ConfirmFileResponse,
  BatchStatusResponse,
  CancelBatchResponse,
} from '@bc-agent/shared';
import { isApiErrorResponse, ErrorCode } from '@bc-agent/shared';
import { env } from '@/lib/config/env';
import type { ApiResponse } from './fileApiClient';

/**
 * Upload API Client
 *
 * Provides type-safe methods for the batch upload endpoints.
 * All endpoints are under /api/uploads/.
 */
export class UploadApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = env.apiUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make a POST request with JSON body
   */
  private async postJson<T>(
    path: string,
    body: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
   * Make a GET or DELETE request
   */
  private async request<T>(
    method: 'GET' | 'DELETE',
    path: string
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        credentials: 'include',
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
  // Batch Upload Endpoints
  // ============================================

  /**
   * Check for duplicate files (three-scope: storage, pipeline, upload)
   */
  async checkDuplicates(
    req: CheckDuplicatesRequest
  ): Promise<ApiResponse<CheckDuplicatesResponse>> {
    return this.postJson<CheckDuplicatesResponse>(
      '/api/uploads/check-duplicates',
      req
    );
  }

  /**
   * Check for duplicate folders at the target location
   */
  async checkFolderDuplicates(
    req: CheckFolderDuplicatesRequest
  ): Promise<ApiResponse<CheckFolderDuplicatesResponse>> {
    return this.postJson<CheckFolderDuplicatesResponse>(
      '/api/uploads/check-folder-duplicates',
      req
    );
  }

  /**
   * Create a batch with manifest (files + optional folders).
   * Returns SAS URLs and fileIds for each file.
   */
  async createBatch(
    req: CreateBatchRequest
  ): Promise<ApiResponse<CreateBatchResponse>> {
    return this.postJson<CreateBatchResponse>(
      '/api/uploads/batches',
      req
    );
  }

  /**
   * Confirm a single file's blob upload, triggering processing.
   */
  async confirmFile(
    batchId: string,
    fileId: string
  ): Promise<ApiResponse<ConfirmFileResponse>> {
    return this.postJson<ConfirmFileResponse>(
      `/api/uploads/batches/${batchId}/files/${fileId}/confirm`,
      {}
    );
  }

  /**
   * Get current status of a batch (for crash recovery).
   */
  async getBatchStatus(
    batchId: string
  ): Promise<ApiResponse<BatchStatusResponse>> {
    return this.request<BatchStatusResponse>(
      'GET',
      `/api/uploads/batches/${batchId}`
    );
  }

  /**
   * Cancel a batch and clean up associated files.
   */
  async cancelBatch(
    batchId: string
  ): Promise<ApiResponse<CancelBatchResponse>> {
    return this.postJson<CancelBatchResponse>(
      `/api/uploads/batches/${batchId}/cancel`,
      {}
    );
  }
}

// ============================================
// Singleton Instance
// ============================================

let instance: UploadApiClient | null = null;

export function getUploadApiClient(): UploadApiClient {
  if (!instance) {
    instance = new UploadApiClient();
  }
  return instance;
}

export function resetUploadApiClient(): void {
  instance = null;
}

