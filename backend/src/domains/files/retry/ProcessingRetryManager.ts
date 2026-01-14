/**
 * ProcessingRetryManager
 *
 * Orchestrates retry decisions and execution for file processing.
 *
 * Design Principles:
 * - Single Responsibility: Only retry orchestration
 * - Dependency Injection: All dependencies injected
 * - Multi-tenant isolation: All operations require userId
 * - Exponential backoff with jitter
 *
 * @module domains/files/retry
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import {
  type RetryDecisionResult,
  type ManualRetryResult,
  type RetryScope,
  type RetryPhase,
  type ParsedFile,
  type ProcessingStatus,
  PROCESSING_STATUS,
} from '@bc-agent/shared';
import type { IProcessingRetryManager } from './IProcessingRetryManager';
import type { IFileRetryService } from './IFileRetryService';
import { getFileRetryService } from './FileRetryService';
import { getFileProcessingConfig, type FileProcessingConfig } from '../config';
import type { IFileEventEmitter } from '../emission';
import { getFileEventEmitter } from '../emission';

/**
 * Dependencies for ProcessingRetryManager (DI support)
 */
export interface ProcessingRetryManagerDependencies {
  retryService?: IFileRetryService;
  config?: FileProcessingConfig;
  logger?: Logger;
  eventEmitter?: IFileEventEmitter;
  getFile?: (userId: string, fileId: string) => Promise<ParsedFile | null>;
  updateProcessingStatus?: (userId: string, fileId: string, status: ProcessingStatus) => Promise<void>;
  cleanupForFile?: (userId: string, fileId: string) => Promise<void>;
}

/**
 * ProcessingRetryManager implementation
 */
export class ProcessingRetryManager implements IProcessingRetryManager {
  private static instance: ProcessingRetryManager | null = null;

  private readonly log: Logger;
  private readonly retryService: IFileRetryService;
  private readonly config: FileProcessingConfig;
  private readonly eventEmitter: IFileEventEmitter;
  private readonly getFileFn: (userId: string, fileId: string) => Promise<ParsedFile | null>;
  private readonly updateProcessingStatusFn: (userId: string, fileId: string, status: ProcessingStatus) => Promise<void>;
  private readonly cleanupForFileFn: (userId: string, fileId: string) => Promise<void>;

  private constructor(deps?: ProcessingRetryManagerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'ProcessingRetryManager' });
    this.retryService = deps?.retryService ?? getFileRetryService();
    this.config = deps?.config ?? getFileProcessingConfig();
    this.eventEmitter = deps?.eventEmitter ?? getFileEventEmitter();

    // Lazy-loaded dependencies to avoid circular imports
    this.getFileFn = deps?.getFile ?? this.defaultGetFile;
    this.updateProcessingStatusFn = deps?.updateProcessingStatus ?? this.defaultUpdateProcessingStatus;
    this.cleanupForFileFn = deps?.cleanupForFile ?? this.defaultCleanupForFile;

    this.log.info('ProcessingRetryManager initialized');
  }

  public static getInstance(deps?: ProcessingRetryManagerDependencies): ProcessingRetryManager {
    if (!ProcessingRetryManager.instance) {
      ProcessingRetryManager.instance = new ProcessingRetryManager(deps);
    }
    return ProcessingRetryManager.instance;
  }

  public static resetInstance(): void {
    ProcessingRetryManager.instance = null;
  }

  /**
   * Decide whether a file should be retried based on current retry count
   */
  async shouldRetry(
    userId: string,
    fileId: string,
    phase: RetryPhase
  ): Promise<RetryDecisionResult> {
    // Get current file state
    const file = await this.getFileFn(userId, fileId);

    if (!file) {
      throw new Error('File not found or unauthorized');
    }

    const maxRetries = phase === 'processing'
      ? this.config.retry.maxProcessingRetries
      : this.config.retry.maxEmbeddingRetries;

    // Increment retry count
    const newCount = phase === 'processing'
      ? await this.retryService.incrementProcessingRetryCount(userId, fileId)
      : await this.retryService.incrementEmbeddingRetryCount(userId, fileId);

    const shouldRetry = newCount <= maxRetries;
    const backoffDelayMs = shouldRetry
      ? this.calculateBackoffDelay(newCount - 1)
      : 0;

    this.log.info(
      {
        userId,
        fileId,
        phase,
        newCount,
        maxRetries,
        shouldRetry,
        backoffDelayMs,
      },
      'Retry decision made'
    );

    return {
      shouldRetry,
      newRetryCount: newCount,
      maxRetries,
      backoffDelayMs,
      reason: shouldRetry ? 'within_limit' : 'max_retries_exceeded',
    };
  }

  /**
   * Execute retry for a file (manual retry from user)
   */
  async executeManualRetry(
    userId: string,
    fileId: string,
    scope: RetryScope
  ): Promise<ManualRetryResult> {
    this.log.info({ userId, fileId, scope }, 'Executing manual retry');

    // 1. Get and validate file
    const file = await this.getFileFn(userId, fileId);

    if (!file) {
      return {
        success: false,
        file: null as unknown as ParsedFile,
        error: 'File not found or unauthorized',
      };
    }

    // 2. Validate file is in failed state
    if (file.readinessState !== 'failed') {
      return {
        success: false,
        file,
        error: `File is not in failed state (current: ${file.readinessState})`,
      };
    }

    // 3. Clear failed status and reset counters
    await this.retryService.clearFailedStatus(userId, fileId, scope);

    // 4. Update status based on scope
    if (scope === 'full') {
      // Reset processing status and re-enqueue from start
      await this.updateProcessingStatusFn(userId, fileId, 'pending');
    } else {
      // Only re-do embedding (processing was successful)
      await this.retryService.updateEmbeddingStatus(userId, fileId, 'pending');
    }

    // 5. Get updated file
    const updatedFile = await this.getFileFn(userId, fileId);

    this.log.info({ userId, fileId, scope }, 'Manual retry executed successfully');

    return {
      success: true,
      file: updatedFile!,
      // Note: jobId would be returned by the endpoint that enqueues the job
    };
  }

  /**
   * Handle permanent failure after max retries exceeded
   */
  async handlePermanentFailure(
    userId: string,
    fileId: string,
    errorMessage: string,
    sessionId?: string
  ): Promise<void> {
    this.log.info({ userId, fileId }, 'Handling permanent failure');

    // Get file for retry counts before marking as failed
    const file = await this.getFileFn(userId, fileId);

    // 1. Mark file as permanently failed
    await this.retryService.markAsPermanentlyFailed(userId, fileId);

    // 2. Store error message
    await this.retryService.setLastProcessingError(userId, fileId, errorMessage);

    // 3. Clean up partial data
    try {
      await this.cleanupForFileFn(userId, fileId);
      this.log.info({ userId, fileId }, 'Partial data cleaned up after permanent failure');
    } catch (cleanupError) {
      // Log but don't fail - cleanup is best-effort
      this.log.error(
        {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          userId,
          fileId,
        },
        'Failed to clean up partial data'
      );
    }

    // 4. Emit WebSocket events
    const ctx = { fileId, userId, sessionId };

    // Emit permanently_failed event
    this.eventEmitter.emitPermanentlyFailed(ctx, {
      error: errorMessage,
      processingRetryCount: file?.processingRetryCount ?? 0,
      embeddingRetryCount: file?.embeddingRetryCount ?? 0,
      canRetryManually: true,
    });

    // Emit readiness_changed to 'failed'
    this.eventEmitter.emitReadinessChanged(ctx, {
      previousState: PROCESSING_STATUS.PROCESSING,
      newState: PROCESSING_STATUS.FAILED,
      processingStatus: PROCESSING_STATUS.FAILED,
      embeddingStatus: file?.embeddingStatus ?? PROCESSING_STATUS.PENDING,
    });
  }

  /**
   * Calculate backoff delay using exponential backoff formula
   */
  calculateBackoffDelay(retryCount: number): number {
    const { baseDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } = this.config.retry;

    // Exponential backoff: baseDelay * multiplier^retryCount
    const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, retryCount);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * jitterFactor * Math.random();

    return Math.floor(cappedDelay + jitter);
  }

  // ===== Default Dependencies (lazy-loaded to avoid circular imports) =====

  private async defaultGetFile(userId: string, fileId: string): Promise<ParsedFile | null> {
    const { FileService } = await import('@/services/files/FileService');
    const fileService = FileService.getInstance();
    return fileService.getFile(userId, fileId);
  }

  private async defaultUpdateProcessingStatus(
    userId: string,
    fileId: string,
    status: ProcessingStatus
  ): Promise<void> {
    const { FileService } = await import('@/services/files/FileService');
    const fileService = FileService.getInstance();
    await fileService.updateProcessingStatus(userId, fileId, status);
  }

  private async defaultCleanupForFile(userId: string, fileId: string): Promise<void> {
    const { getPartialDataCleaner } = await import('../cleanup');
    const cleaner = getPartialDataCleaner();
    await cleaner.cleanupForFile(userId, fileId);
  }
}

// ===== Convenience Getters =====

/**
 * Get the singleton ProcessingRetryManager instance
 */
export function getProcessingRetryManager(
  deps?: ProcessingRetryManagerDependencies
): ProcessingRetryManager {
  return ProcessingRetryManager.getInstance(deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetProcessingRetryManager(): void {
  ProcessingRetryManager.resetInstance();
}
