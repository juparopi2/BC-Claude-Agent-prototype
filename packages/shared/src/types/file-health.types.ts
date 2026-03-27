/**
 * File Health Types
 *
 * Types for the file health diagnostic system.
 * Used by GET /api/files/health/issues endpoint and frontend FileHealthWarning UI.
 *
 * @module @bc-agent/shared/types/file-health
 */

/**
 * Classification of file health issues.
 *
 * - `external_not_found`: External file (OneDrive/SharePoint) returned Graph API 404 — file was deleted/moved in source
 * - `retry_exhausted`: Failed with retryCount >= 3, blob exists — needs manual retry count reset
 * - `blob_missing`: Failed, local file blob not found in storage — must be re-uploaded
 * - `failed_retriable`: Failed with retryCount < 3 — can be retried
 * - `stuck_processing`: Stuck in intermediate pipeline state > 30 min — needs re-queue
 */
export type FileHealthIssueType =
  | 'external_not_found'
  | 'retry_exhausted'
  | 'blob_missing'
  | 'failed_retriable'
  | 'stuck_processing';

/**
 * A single file health issue with diagnostic metadata.
 */
export interface FileHealthIssue {
  fileId: string;
  fileName: string;
  mimeType: string;
  /** 'local' | 'onedrive' | 'sharepoint' */
  sourceType: string;
  pipelineStatus: string;
  retryCount: number;
  lastError: string | null;
  /** Always true for external files (no blob needed). False when local file blob is missing. */
  blobExists: boolean;
  parentFolderId: string | null;
  scopeId: string | null;
  issueType: FileHealthIssueType;
  /** ISO 8601 */
  updatedAt: string;
}

/**
 * Response from GET /api/files/health/issues
 */
export interface FileHealthIssuesResponse {
  issues: FileHealthIssue[];
  summary: {
    externalNotFound: number;
    retryExhausted: number;
    blobMissing: number;
    failedRetriable: number;
    stuckProcessing: number;
    total: number;
  };
}
