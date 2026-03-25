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
  errors: number;
}

export interface ReconciliationReport {
  timestamp: Date;
  userId: string;
  dbReadyFiles: number;
  searchIndexedFiles: number;
  missingFromSearch: string[];
  orphanedInSearch: string[];
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
