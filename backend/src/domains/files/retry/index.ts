/**
 * File Retry Domain Module
 *
 * Exports retry tracking and orchestration services for file processing.
 *
 * Usage:
 * ```typescript
 * import { getFileRetryService, getProcessingRetryManager } from '@/domains/files/retry';
 *
 * // Low-level retry tracking
 * const retryService = getFileRetryService();
 * await retryService.incrementRetryCount(userId, fileId);
 *
 * // High-level retry orchestration
 * const retryManager = getProcessingRetryManager();
 * const decision = await retryManager.shouldRetry(userId, fileId);
 * ```
 *
 * @module domains/files/retry
 */

// Types
export type { IFileRetryService } from './IFileRetryService';
export type { IProcessingRetryManager } from './IProcessingRetryManager';

// FileRetryService (low-level retry tracking)
export {
  FileRetryService,
  getFileRetryService,
  __resetFileRetryService,
} from './FileRetryService';

// ProcessingRetryManager (high-level retry orchestration)
export {
  ProcessingRetryManager,
  getProcessingRetryManager,
  __resetProcessingRetryManager,
  type ProcessingRetryManagerDependencies,
} from './ProcessingRetryManager';
