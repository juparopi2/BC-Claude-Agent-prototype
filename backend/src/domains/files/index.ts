/**
 * Files Domain Module
 *
 * Domain logic for file management, processing, and status computation.
 *
 * Submodules:
 * - config: Centralized configuration
 * - status: Readiness state computation (ReadinessStateComputer)
 * - retry: Retry tracking and orchestration (FileRetryService, ProcessingRetryManager)
 * - cleanup: Partial data cleanup (PartialDataCleaner)
 * - emission: WebSocket event emission (FileEventEmitter)
 *
 * @module domains/files
 */

// Configuration
export * from './config';

// Status computation
export * from './status';

// Retry tracking
export * from './retry';

// Cleanup
export * from './cleanup';

// Event emission
export * from './emission';

// Upload session (folder-based batch processing)
export * from './upload-session';

// Processing scheduler (backpressure control)
export * from './scheduler';
