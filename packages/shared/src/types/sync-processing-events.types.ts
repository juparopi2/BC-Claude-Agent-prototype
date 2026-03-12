/**
 * Sync Processing Event Types (PRD-117)
 *
 * Payload types for the two-phase processing progress events.
 * These events track the file extraction/embedding pipeline
 * after initial sync discovery completes.
 *
 * @module @bc-agent/shared/types
 */

export interface ProcessingProgressPayload {
  connectionId: string;
  scopeId: string;
  total: number;
  completed: number;
  failed: number;
  percentage: number;
}

export interface ProcessingCompletedPayload {
  connectionId: string;
  scopeId: string;
  totalProcessed: number;
  totalReady: number;
  totalFailed: number;
}
