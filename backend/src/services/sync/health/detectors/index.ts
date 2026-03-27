/**
 * Drift Detectors — barrel export (PRD-304)
 *
 * All drift detectors and shared types for the modular reconciliation
 * architecture. Import from this barrel to avoid deep path coupling.
 */

// ── Interfaces & shared types ─────────────────────────────────────────────────
export type {
  DetectedFileRow,
  DetectionResult,
  DriftDetector,
  DriftRepairer,
} from './types';

// ── Shared helper ─────────────────────────────────────────────────────────────
export { SearchIndexComparator } from './SearchIndexComparator';
export type { SearchIndexComparisonResult } from './SearchIndexComparator';

// ── Detectors ─────────────────────────────────────────────────────────────────
export { MissingFromSearchDetector } from './MissingFromSearchDetector';
export { OrphanedInSearchDetector } from './OrphanedInSearchDetector';
export { FailedRetriableDetector } from './FailedRetriableDetector';
export { StuckPipelineDetector } from './StuckPipelineDetector';
export { ExternalNotFoundDetector } from './ExternalNotFoundDetector';
export { ImageEmbeddingDetector } from './ImageEmbeddingDetector';
export { FolderHierarchyDetector } from './FolderHierarchyDetector';
export { DisconnectedFilesDetector } from './DisconnectedFilesDetector';
