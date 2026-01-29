/**
 * ReadinessStateComputer
 *
 * Computes unified readiness state from processing and embedding statuses.
 * This is a pure domain logic component with no external dependencies.
 *
 * Design Principles:
 * - Pure function (no side effects)
 * - No external dependencies
 * - Single Responsibility: only computes state
 *
 * State Priority:
 * 1. FAILED (highest): Any failure means the file is in failed state
 * 2. PROCESSING: Any non-completed status means still processing
 * 3. READY (lowest): Both statuses must be completed
 *
 * @module domains/files/status
 */

import type {
  ProcessingStatus,
  EmbeddingStatus,
  FileReadinessState,
} from '@bc-agent/shared';

/**
 * Computes unified readiness state from processing and embedding statuses.
 *
 * @example
 * ```typescript
 * const computer = new ReadinessStateComputer();
 *
 * // File still processing
 * computer.compute('pending_processing', 'pending'); // => 'processing' (waiting for scheduler)
 * computer.compute('pending', 'pending');     // => 'processing'
 * computer.compute('processing', 'pending');  // => 'processing'
 * computer.compute('completed', 'pending');   // => 'processing'
 * computer.compute('completed', 'processing'); // => 'processing'
 *
 * // File ready
 * computer.compute('completed', 'completed'); // => 'ready'
 *
 * // File failed
 * computer.compute('failed', 'pending');      // => 'failed'
 * computer.compute('completed', 'failed');    // => 'failed'
 * ```
 */
export class ReadinessStateComputer {
  /**
   * Compute unified readiness state from processing and embedding statuses.
   *
   * State transitions:
   * - 'uploading': Not used in DB (frontend-only during upload)
   * - 'processing': Any status is pending/processing/queued
   * - 'failed': Either status is failed
   * - 'ready': Both statuses are completed
   *
   * @param processingStatus - Current processing status
   * @param embeddingStatus - Current embedding status
   * @returns Unified readiness state for frontend display
   */
  compute(
    processingStatus: ProcessingStatus,
    embeddingStatus: EmbeddingStatus
  ): FileReadinessState {
    // Failed takes precedence (highest priority)
    if (processingStatus === 'failed' || embeddingStatus === 'failed') {
      return 'failed';
    }

    // Processing if processing not completed
    if (processingStatus !== 'completed') {
      return 'processing';
    }

    // Processing if embedding not completed
    if (embeddingStatus !== 'completed') {
      return 'processing';
    }

    // Both completed => ready
    return 'ready';
  }
}

// Singleton instance for convenience
let instance: ReadinessStateComputer | null = null;

/**
 * Get singleton instance of ReadinessStateComputer.
 * For testability, prefer constructor injection in services.
 */
export function getReadinessStateComputer(): ReadinessStateComputer {
  if (!instance) {
    instance = new ReadinessStateComputer();
  }
  return instance;
}

/**
 * Reset singleton for testing purposes.
 * @internal
 */
export function __resetReadinessStateComputer(): void {
  instance = null;
}
