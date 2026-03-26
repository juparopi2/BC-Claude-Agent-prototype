/**
 * FileHealthService
 *
 * Queries problematic files (failed, stuck) for a given user and enriches
 * them with Azure Blob Storage existence checks. Used by the
 * GET /api/files/health/issues endpoint to surface actionable issues in the
 * FileHealthWarning UI component.
 *
 * Issue classification:
 * - `blob_missing`:      Failed local file whose blob no longer exists in storage — must re-upload
 * - `retry_exhausted`:   Failed with retryCount >= MAX_RETRY_COUNT, blob exists — needs manual reset
 * - `failed_retriable`:  Failed with retryCount < MAX_RETRY_COUNT — safe to retry automatically
 * - `stuck_processing`:  Stuck in an intermediate pipeline state for > STUCK_THRESHOLD_MS
 *
 * @module services/files/FileHealthService
 */

import { prisma } from '@/infrastructure/database/prisma';
import { createChildLogger } from '@/shared/utils/logger';
import { getFileUploadService } from './FileUploadService';
import type {
  FileHealthIssue,
  FileHealthIssueType,
  FileHealthIssuesResponse,
} from '@bc-agent/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files stuck in an intermediate state for longer than this are flagged. */
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/** Files that have failed this many times are considered retry-exhausted. */
const MAX_RETRY_COUNT = 3;

// ---------------------------------------------------------------------------
// Internal DB shape (Prisma select result)
// ---------------------------------------------------------------------------

type DbFile = {
  id: string;
  name: string;
  mime_type: string;
  source_type: string;
  pipeline_status: string;
  pipeline_retry_count: number | null;
  last_processing_error: string | null;
  blob_path: string | null;
  parent_folder_id: string | null;
  connection_scope_id: string | null;
  updated_at: Date | null;
};

/** Shared Prisma select clause used for both queries. */
const FILE_SELECT = {
  id: true,
  name: true,
  mime_type: true,
  source_type: true,
  pipeline_status: true,
  pipeline_retry_count: true,
  last_processing_error: true,
  blob_path: true,
  parent_folder_id: true,
  connection_scope_id: true,
  updated_at: true,
} as const;

// ---------------------------------------------------------------------------
// Classification helper
// ---------------------------------------------------------------------------

function classifyIssue(file: DbFile, blobExistsForFile: boolean): FileHealthIssueType {
  if (file.pipeline_status === 'failed') {
    if (!blobExistsForFile && file.blob_path != null) return 'blob_missing';
    if ((file.pipeline_retry_count ?? 0) >= MAX_RETRY_COUNT) return 'retry_exhausted';
    return 'failed_retriable';
  }
  return 'stuck_processing';
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class FileHealthService {
  private logger = createChildLogger({ service: 'FileHealthService' });

  /**
   * Returns all health issues (failed + stuck files) for the given user,
   * enriched with blob existence metadata.
   *
   * Multi-tenant: all DB queries are scoped to `userId`.
   * Soft-delete aware: filters `deleted_at = null AND deletion_status = null`.
   */
  async getHealthIssues(userId: string): Promise<FileHealthIssuesResponse> {
    this.logger.info({ userId }, 'Fetching file health issues');

    // ------------------------------------------------------------------
    // 1. Query failed files
    // ------------------------------------------------------------------
    const failedFiles = await prisma.files.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        deletion_status: null,
        pipeline_status: 'failed',
      },
      select: FILE_SELECT,
    });

    // ------------------------------------------------------------------
    // 2. Query stuck files (intermediate state > STUCK_THRESHOLD_MS)
    // ------------------------------------------------------------------
    const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuckFiles = await prisma.files.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        deletion_status: null,
        pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
        updated_at: { lt: stuckThreshold },
      },
      select: FILE_SELECT,
    });

    this.logger.debug(
      { userId, failedCount: failedFiles.length, stuckCount: stuckFiles.length },
      'File health queries complete',
    );

    // ------------------------------------------------------------------
    // 3. Batch-check blob existence for local files (blob_path != null)
    // ------------------------------------------------------------------
    const allFiles: DbFile[] = [...failedFiles, ...stuckFiles];
    const localFilesWithBlob = allFiles.filter((f) => f.blob_path != null);

    const blobCheckResults = new Map<string, boolean>();

    if (localFilesWithBlob.length > 0) {
      const fileUploadService = getFileUploadService();

      const checks = await Promise.allSettled(
        localFilesWithBlob.map(async (f) => {
          const exists = await fileUploadService.blobExists(f.blob_path!);
          return { fileId: f.id, exists };
        }),
      );

      for (const result of checks) {
        if (result.status === 'fulfilled') {
          blobCheckResults.set(result.value.fileId, result.value.exists);
        } else {
          // If the check itself fails, assume the blob exists to avoid
          // surfacing a false "blob_missing" classification to the user.
          this.logger.warn(
            { reason: result.reason instanceof Error ? result.reason.message : String(result.reason) },
            'Blob existence check failed — defaulting to exists=true',
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // 4. Map DB rows → FileHealthIssue[]
    // ------------------------------------------------------------------
    const issues: FileHealthIssue[] = allFiles.map((file) => {
      // External files (OneDrive / SharePoint) have no local blob.
      const isExternal = file.blob_path == null;
      const blobExistsForFile = isExternal
        ? true // external files never need a local blob
        : (blobCheckResults.get(file.id) ?? true); // default to true on check failure

      const issueType = classifyIssue(file, blobExistsForFile);

      return {
        fileId: file.id.toUpperCase(),
        fileName: file.name,
        mimeType: file.mime_type,
        sourceType: file.source_type,
        pipelineStatus: file.pipeline_status,
        retryCount: file.pipeline_retry_count ?? 0,
        lastError: file.last_processing_error,
        blobExists: blobExistsForFile,
        parentFolderId: file.parent_folder_id ? file.parent_folder_id.toUpperCase() : null,
        scopeId: file.connection_scope_id ? file.connection_scope_id.toUpperCase() : null,
        issueType,
        updatedAt: file.updated_at ? file.updated_at.toISOString() : new Date(0).toISOString(),
      };
    });

    // ------------------------------------------------------------------
    // 5. Build summary counts
    // ------------------------------------------------------------------
    const summary = {
      retryExhausted: issues.filter((i) => i.issueType === 'retry_exhausted').length,
      blobMissing: issues.filter((i) => i.issueType === 'blob_missing').length,
      failedRetriable: issues.filter((i) => i.issueType === 'failed_retriable').length,
      stuckProcessing: issues.filter((i) => i.issueType === 'stuck_processing').length,
      total: issues.length,
    };

    this.logger.info({ userId, summary }, 'File health issues resolved');

    return { issues, summary };
  }
}

// ---------------------------------------------------------------------------
// Singleton management
// ---------------------------------------------------------------------------

let instance: FileHealthService | null = null;

export function getFileHealthService(): FileHealthService {
  if (!instance) {
    instance = new FileHealthService();
  }
  return instance;
}

export function __resetFileHealthService(): void {
  instance = null;
}
