/**
 * Sync Health & Recovery Types (PRD-300)
 *
 * Shared type definitions for the sync health monitoring and recovery system.
 * All types are backend-only (not exported to @bc-agent/shared).
 *
 * @module services/sync/health
 */

// ============================================================================
// Health Classification
// ============================================================================

/** Scope-level health classification */
export type SyncHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** Issue type codes — used in structured logging and API responses */
export type ScopeIssueType =
  | 'stuck_syncing'      // sync_status='syncing' for > threshold (default 10min)
  | 'error_state'        // sync_status='error'
  | 'stale_sync'         // last synced_at > 48h (scope hasn't synced recently)
  | 'high_failure_rate'; // > 50% of scope files in failed pipeline state

export type ScopeIssueSeverity = 'warning' | 'error' | 'critical';

export interface ScopeIssue {
  type: ScopeIssueType;
  severity: ScopeIssueSeverity;
  message: string;
  detectedAt: Date;
}

// ============================================================================
// Health Reports
// ============================================================================

export interface ScopeFileStats {
  total: number;
  ready: number;
  failed: number;
  processing: number;
  queued: number;
}

export interface ScopeHealthReport {
  scopeId: string;
  connectionId: string;
  userId: string;
  scopeName: string;
  syncStatus: string;
  healthStatus: SyncHealthStatus;
  issues: ScopeIssue[];
  fileStats: ScopeFileStats;
  lastSyncedAt: Date | null;
  checkedAt: Date;
}

export interface SyncHealthReport {
  timestamp: Date;
  overallStatus: SyncHealthStatus;
  summary: {
    totalScopes: number;
    healthyScopes: number;
    degradedScopes: number;
    unhealthyScopes: number;
  };
  scopes: ScopeHealthReport[];
}

// ============================================================================
// Reconciliation
// ============================================================================

export interface ReconciliationRepairs {
  missingRequeued: number;
  orphansDeleted: number;
  failedRequeued: number;
  stuckRequeued: number;
  imageRequeued: number;
  externalNotFoundCleaned: number;
  folderHierarchy: FolderHierarchyRepairs;
  errors: number;
}

export interface ReconciliationReport {
  timestamp: Date;
  userId: string;
  dbReadyFiles: number;
  searchIndexedFiles: number;
  missingFromSearch: string[];
  orphanedInSearch: string[];
  failedRetriable: string[];
  stuckFiles: string[];
  imagesMissingEmbeddings: string[];
  externalNotFound: string[];
  folderHierarchyIssues: FolderHierarchyDetection;
  repairs: ReconciliationRepairs;
  dryRun: boolean;
}

// ============================================================================
// Recovery
// ============================================================================

/** Result of a recovery operation */
export interface RecoveryResult {
  scopesReset: number;
  scopesRequeued: number;
  filesRequeued: number;
  errors: string[];
}

/** Recovery action types for the POST endpoint */
export type RecoveryAction = 'reset_stuck' | 'retry_errors' | 'retry_files' | 'full_recovery';

// ============================================================================
// On-Demand Reconciliation Errors
// ============================================================================

/** Thrown when reconciliation is already running for the same user */
export class ReconciliationInProgressError extends Error {
  constructor(userId: string) {
    super(`Reconciliation already in progress for user ${userId}`);
    this.name = 'ReconciliationInProgressError';
  }
}

/** Thrown when on-demand reconciliation is called within cooldown period */
export class ReconciliationCooldownError extends Error {
  public readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Reconciliation on cooldown, retry after ${retryAfterSeconds}s`);
    this.name = 'ReconciliationCooldownError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ============================================================================
// Folder Hierarchy Integrity (Layer 4)
// ============================================================================

/** Folder hierarchy detection results for a user */
export interface FolderHierarchyDetection {
  /** Files/folders whose parent_folder_id points to a non-existent row */
  orphanedChildren: Array<{
    id: string;
    parentFolderId: string;
    connectionScopeId: string | null;
    isFolder: boolean;
    sourceType: string | null;
  }>;
  /** Scopes whose root folder is missing from the files table */
  missingScopeRoots: Array<{
    scopeId: string;
    connectionId: string;
    scopeResourceId: string;
    scopeDisplayName: string | null;
    remoteDriveId: string | null;
    provider: string;
    microsoftDriveId: string | null;
  }>;
  /** Distinct scope IDs that need resync (union of affected scopes) */
  scopeIdsToResync: string[];
}

/** Repair counts for folder hierarchy issues */
export interface FolderHierarchyRepairs {
  scopeRootsRecreated: number;
  scopesResynced: number;
  scopesSkippedDisconnected: number;
  localFilesReparented: number;
  errors: number;
}

// ============================================================================
// Metrics
// ============================================================================

/** Metrics emitted to structured logs after each health check run */
export interface SyncHealthCheckMetrics {
  scopesChecked: number;
  stuckSyncingDetected: number;
  stuckSyncingReset: number;
  errorScopesDetected: number;
  errorScopesRetried: number;
  errorScopesSkippedExpiredConnection: number;
  errorScopesBackoffDeferred: number;
  durationMs: number;
}
