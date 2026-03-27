/**
 * Drift Detector/Repairer Interfaces (PRD-304)
 *
 * Base interfaces for the modular reconciliation architecture.
 * Each detector identifies a specific drift condition.
 * Each repairer performs a specific recovery action.
 */

/** Minimal file row returned by detector queries */
export interface DetectedFileRow {
  id: string;
  name: string;
  mime_type: string;
  connection_scope_id: string | null;
}

/** File row returned by StuckDeletionDetector — extends base with connection context */
export interface StuckDeletionFileRow extends DetectedFileRow {
  connection_id: string | null;
  source_type: string | null;
}

/** Result of a drift detection operation */
export interface DetectionResult<T = string> {
  /** Detected items (file IDs or full rows depending on detector) */
  readonly items: T[];
  /** Count of detected items */
  readonly count: number;
}

/** Base interface for all drift detectors */
export interface DriftDetector<T = string> {
  /** Unique name for this detector (used in reports and logs) */
  readonly name: string;
  /** Detect drift for a specific user */
  detect(userId: string): Promise<DetectionResult<T>>;
}

/** Base interface for all drift repairers */
export interface DriftRepairer<TInput, TResult> {
  /** Unique name for this repairer */
  readonly name: string;
  /** Repair detected drift items */
  repair(userId: string, input: TInput): Promise<TResult>;
}

