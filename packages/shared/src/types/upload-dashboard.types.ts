/**
 * Upload Dashboard Types (PRD-05)
 *
 * Shared types for the error recovery, cleanup, and observability dashboard.
 * Used by both backend API endpoints and (future) frontend dashboard components.
 *
 * @module @bc-agent/shared/types/upload-dashboard
 */

import type { PipelineStatus } from '../constants/pipeline-status';

// ============================================================================
// Dashboard Overview
// ============================================================================

/**
 * Queue depth information for a single queue.
 */
export interface QueueDepth {
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}

/**
 * Main dashboard overview metrics.
 */
export interface UploadDashboard {
  /** Count of files in each pipeline_status */
  statusDistribution: Record<PipelineStatus, number>;
  /** Files stuck in non-terminal states beyond threshold */
  stuckCount: number;
  /** Queue depths for V2 pipeline queues */
  queueDepths: Record<string, QueueDepth>;
  /** Aggregate metrics for the last 24 hours */
  last24h: {
    uploaded: number;
    completed: number;
    failed: number;
  };
}

// ============================================================================
// Stuck Files
// ============================================================================

/**
 * Detail for a single stuck file.
 */
export interface StuckFileDetails {
  fileId: string;
  userId: string;
  name: string;
  pipelineStatus: string;
  stuckSinceMs: number;
  pipelineRetryCount: number;
  updatedAt: string;
  createdAt: string;
}

/**
 * Response for the list-stuck-files endpoint.
 */
export interface StuckFilesResponse {
  files: StuckFileDetails[];
  total: number;
}

// ============================================================================
// Orphan Report
// ============================================================================

/**
 * Summary of orphan status from the last cleanup scan.
 */
export interface OrphanReport {
  abandonedUploads: number;
  oldFailures: number;
  lastScanAt: string | null;
}

// ============================================================================
// Retry Responses
// ============================================================================

/**
 * Response for a single-file retry.
 */
export interface RetryResponse {
  fileId: string;
  success: boolean;
  error?: string;
}

/**
 * Response for bulk retry of all stuck files.
 */
export interface BulkRetryResponse {
  retried: number;
  failed: number;
  errors: Array<{ fileId: string; error: string }>;
}

// ============================================================================
// Maintenance Job Metrics
// ============================================================================

/**
 * Metrics returned by StuckFileRecoveryService.
 */
export interface StuckFileRecoveryMetrics {
  totalStuck: number;
  reEnqueued: number;
  permanentlyFailed: number;
  byStatus: Record<string, number>;
}

/**
 * Metrics returned by OrphanCleanupService per scope.
 */
export interface OrphanCleanupMetrics {
  orphanBlobsDeleted: number;
  abandonedUploadsDeleted: number;
  oldFailuresDeleted: number;
  stuckDeletionsDeleted: number;
}

/**
 * Metrics returned by BatchTimeoutService.
 */
export interface BatchTimeoutMetrics {
  expiredBatches: number;
  deletedFiles: number;
}
