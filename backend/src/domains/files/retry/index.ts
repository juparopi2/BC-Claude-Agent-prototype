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
 * await retryService.incrementProcessingRetryCount(userId, fileId);
 *
 * // High-level retry orchestration
 * const retryManager = getProcessingRetryManager();
 * const decision = await retryManager.shouldRetry(userId, fileId, 'processing');
 * ```
 *
 * @module domains/files/retry
 */

// Types
export type { IFileRetryService, ClearFailedScope } from './IFileRetryService';
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
