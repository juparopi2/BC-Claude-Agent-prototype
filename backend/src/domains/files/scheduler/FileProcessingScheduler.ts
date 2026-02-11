/**
 * FileProcessingScheduler
 *
 * Implements flow control for file processing by decoupling upload from processing.
 * This scheduler periodically checks for files that need processing and enqueues
 * them in controlled batches based on current queue capacity.
 *
 * Architecture Benefits:
 * - Upload completes immediately (files stored in DB with 'pending_processing' status)
 * - Backend controls processing rate based on queue depth
 * - Queue depth is bounded (prevents Redis OOM)
 * - System degrades gracefully (slower but doesn't break)
 *
 * Configuration (via environment variables):
 * - FILE_SCHEDULER_BATCH_SIZE: Max files to enqueue at once (default: 10)
 * - FILE_SCHEDULER_CHECK_INTERVAL_MS: Check interval in ms (default: 5000)
 * - FILE_SCHEDULER_MAX_QUEUE_DEPTH: Max queue depth before pausing (default: 50)
 *
 * @module domains/files/scheduler
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import type { IFileRepository, FilePendingProcessing } from '@/services/files/repository';
import { getFileRepository } from '@/services/files/repository';
import { getMessageQueue, QueueName } from '@/infrastructure/queue';
import type { MessageQueue } from '@/infrastructure/queue';

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Maximum files to enqueue in a single batch */
  batchSize: number;
  /** Interval between scheduling checks (ms) */
  checkIntervalMs: number;
  /** Maximum queue depth before pausing scheduling */
  maxQueueDepth: number;
}

/**
 * Default scheduler configuration
 */
const DEFAULT_CONFIG: SchedulerConfig = {
  batchSize: 10,
  checkIntervalMs: 5000,
  maxQueueDepth: 50,
};

/**
 * Dependencies for FileProcessingScheduler
 */
export interface FileProcessingSchedulerDependencies {
  logger?: Logger;
  fileRepository?: IFileRepository;
  messageQueue?: MessageQueue;
  config?: Partial<SchedulerConfig>;
}

/**
 * FileProcessingScheduler
 *
 * Periodically checks for files needing processing and enqueues them
 * in controlled batches based on current queue capacity.
 */
export class FileProcessingScheduler {
  private static instance: FileProcessingScheduler | null = null;

  private readonly log: Logger;
  private readonly getFileRepo: () => IFileRepository;
  private readonly getQueue: () => MessageQueue;
  private readonly config: SchedulerConfig;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;

  private constructor(deps?: FileProcessingSchedulerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileProcessingScheduler' });

    // Use getter functions for lazy initialization
    if (deps?.fileRepository) {
      const repo = deps.fileRepository;
      this.getFileRepo = () => repo;
    } else {
      this.getFileRepo = () => getFileRepository();
    }

    if (deps?.messageQueue) {
      const queue = deps.messageQueue;
      this.getQueue = () => queue;
    } else {
      this.getQueue = () => getMessageQueue();
    }

    // Merge configuration from environment and provided config
    this.config = {
      batchSize: this.parseEnvInt('FILE_SCHEDULER_BATCH_SIZE', deps?.config?.batchSize ?? DEFAULT_CONFIG.batchSize),
      checkIntervalMs: this.parseEnvInt('FILE_SCHEDULER_CHECK_INTERVAL_MS', deps?.config?.checkIntervalMs ?? DEFAULT_CONFIG.checkIntervalMs),
      maxQueueDepth: this.parseEnvInt('FILE_SCHEDULER_MAX_QUEUE_DEPTH', deps?.config?.maxQueueDepth ?? DEFAULT_CONFIG.maxQueueDepth),
    };

    this.log.info(
      { config: this.config },
      'FileProcessingScheduler initialized'
    );
  }

  /**
   * Parse environment variable as integer with fallback
   */
  private parseEnvInt(envName: string, fallback: number): number {
    const envValue = process.env[envName];
    if (!envValue) return fallback;
    const parsed = parseInt(envValue, 10);
    return isNaN(parsed) ? fallback : parsed;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(deps?: FileProcessingSchedulerDependencies): FileProcessingScheduler {
    if (!FileProcessingScheduler.instance) {
      FileProcessingScheduler.instance = new FileProcessingScheduler(deps);
    }
    return FileProcessingScheduler.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static resetInstance(): void {
    if (FileProcessingScheduler.instance) {
      FileProcessingScheduler.instance.stop();
    }
    FileProcessingScheduler.instance = null;
  }

  /**
   * Start the scheduler
   */
  public start(): void {
    if (this.isRunning) {
      this.log.warn('FileProcessingScheduler is already running');
      return;
    }

    this.isRunning = true;
    this.intervalId = setInterval(
      () => this.processNextBatch(),
      this.config.checkIntervalMs
    );

    this.log.info(
      { checkIntervalMs: this.config.checkIntervalMs },
      'FileProcessingScheduler started'
    );

    // Run immediately on start
    this.processNextBatch();
  }

  /**
   * Stop the scheduler
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.log.info('FileProcessingScheduler stopped');
  }

  /**
   * Check if scheduler is running
   */
  public isSchedulerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current configuration
   */
  public getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /**
   * Process the next batch of files
   *
   * This method is called periodically by the scheduler interval.
   * It checks queue capacity and enqueues files accordingly.
   */
  private async processNextBatch(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      this.log.debug('Skipping batch - previous batch still processing');
      return;
    }

    this.isProcessing = true;

    try {
      // 1. Check current queue depth
      const queueDepth = await this.getQueueDepth();

      if (queueDepth >= this.config.maxQueueDepth) {
        this.log.debug(
          { queueDepth, maxQueueDepth: this.config.maxQueueDepth },
          'Queue at capacity, skipping batch'
        );
        return;
      }

      // 2. Calculate how many files we can enqueue
      const availableSlots = this.config.maxQueueDepth - queueDepth;
      const batchSize = Math.min(this.config.batchSize, availableSlots);

      if (batchSize <= 0) {
        return;
      }

      // 3. Get files pending processing
      const fileRepo = this.getFileRepo();
      const files = await fileRepo.getFilesPendingProcessing(batchSize);

      if (files.length === 0) {
        this.log.debug('No files pending processing');
        return;
      }

      this.log.info(
        {
          pendingCount: files.length,
          batchSize,
          queueDepth,
          availableSlots,
          fileIds: files.map(f => f.id),
          fileNames: files.map(f => f.name),
          mimeTypes: files.map(f => f.mimeType),
        },
        '[TRACE] processNextBatch - found pending files'
      );

      // 4. Enqueue files and update their status
      await this.enqueueFiles(files);

      this.log.info(
        { count: files.length, queueDepth, availableSlots },
        'Enqueued processing batch'
      );
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : { value: String(error) };

      this.log.error(
        { error: errorInfo },
        'Error processing scheduler batch'
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get current queue depth (waiting + active jobs)
   */
  private async getQueueDepth(): Promise<number> {
    try {
      const queue = this.getQueue();
      const stats = await queue.getQueueStats(QueueName.FILE_PROCESSING);
      return stats.waiting + stats.active;
    } catch (error) {
      this.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to get queue stats, assuming max depth'
      );
      // Return max depth to prevent enqueuing when we can't check
      return this.config.maxQueueDepth;
    }
  }

  /**
   * Enqueue files for processing
   */
  private async enqueueFiles(files: FilePendingProcessing[]): Promise<void> {
    const queue = this.getQueue();
    const fileRepo = this.getFileRepo();

    this.log.info(
      {
        fileCount: files.length,
        fileIds: files.map(f => f.id),
        fileNames: files.map(f => f.name),
        mimeTypes: files.map(f => f.mimeType),
      },
      '[TRACE] enqueueFiles - batch about to be enqueued'
    );

    for (const file of files) {
      try {
        // Enqueue the processing job
        const jobId = await queue.addFileProcessingJob({
          fileId: file.id,
          userId: file.userId,
          mimeType: file.mimeType,
          blobPath: file.blobPath,
          fileName: file.name,
        });

        // Update file status to 'pending' (standard processing status)
        // This indicates the file is now in the queue
        await fileRepo.updateProcessingStatus(file.userId, file.id, 'pending');

        this.log.debug(
          { fileId: file.id, jobId, fileName: file.name, mimeType: file.mimeType },
          '[TRACE] enqueueFiles - file enqueued successfully'
        );
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };

        this.log.error(
          { error: errorInfo, fileId: file.id, fileName: file.name },
          'Failed to enqueue file for processing'
        );
        // Continue with other files
      }
    }
  }
}

/**
 * Get FileProcessingScheduler singleton instance
 */
export function getFileProcessingScheduler(
  deps?: FileProcessingSchedulerDependencies
): FileProcessingScheduler {
  return FileProcessingScheduler.getInstance(deps);
}

/**
 * Reset FileProcessingScheduler singleton (for testing)
 */
export function __resetFileProcessingScheduler(): void {
  FileProcessingScheduler.resetInstance();
}
