export { getSyncRecoveryService, SyncRecoveryService } from './SyncRecoveryService';
export {
  getSyncHealthCheckService,
  SyncHealthCheckService,
  __resetSyncHealthCheckService,
} from './SyncHealthCheckService';
export {
  getSyncReconciliationService,
  SyncReconciliationService,
  __resetSyncReconciliationService,
} from './SyncReconciliationService';
export type {
  RecoveryResult,
  RecoveryAction,
  SyncHealthStatus,
  ScopeIssueType,
  ScopeIssueSeverity,
  ScopeIssue,
  ScopeFileStats,
  ScopeHealthReport,
  SyncHealthReport,
  ReconciliationRepairs,
  ReconciliationReport,
  SyncHealthCheckMetrics,
  FolderHierarchyDetection,
  FolderHierarchyRepairs,
} from './types';
export {
  ReconciliationInProgressError,
  ReconciliationCooldownError,
} from './types';

// ── Detectors (PRD-304) ───────────────────────────────────────────────────────
export {
  SearchIndexComparator,
  MissingFromSearchDetector,
  OrphanedInSearchDetector,
  FailedRetriableDetector,
  StuckPipelineDetector,
  ExternalNotFoundDetector,
  ImageEmbeddingDetector,
  FolderHierarchyDetector,
  DisconnectedFilesDetector,
} from './detectors';
export type {
  DetectedFileRow,
  DetectionResult,
  DriftDetector,
  DriftRepairer,
  SearchIndexComparisonResult,
} from './detectors';

// ── Repairers (PRD-304) ───────────────────────────────────────────────────────
export {
  FileRequeueRepairer,
  OrphanCleanupRepairer,
  ExternalFileCleanupRepairer,
  FolderHierarchyRepairer,
} from './repairers';
