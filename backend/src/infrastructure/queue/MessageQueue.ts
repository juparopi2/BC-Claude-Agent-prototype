/**
 * Message Queue Service (Multi-Tenant Safe) - Facade
 *
 * Implements message queue system using BullMQ with rate limiting.
 * This facade coordinates extracted components for modularity.
 *
 * Architecture:
 * - Core components: RedisConnectionManager, QueueManager, WorkerRegistry, etc.
 * - Workers: Extracted to individual files in ./workers/
 * - Constants: Centralized in ./constants/
 * - Types: Centralized in ./types/
 *
 * Backward Compatibility:
 * - All public methods remain unchanged
 * - All types re-exported for consumers
 *
 * @module infrastructure/queue/MessageQueue
 */

import { Job, QueueEvents } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type {
  IMessageQueueDependencies,
  ILoggerMinimal,
  ExecuteQueryFn,
  IEmbeddingServiceMinimal,
  IVectorSearchServiceMinimal,
} from './IMessageQueueDependencies';
import type { FileDeletionJobData, BulkUploadJobData } from '@bc-agent/shared';

// Re-export from constants for backward compatibility
export { QueueName } from './constants';
import { QueueName, JOB_PRIORITY, RATE_LIMIT, SHUTDOWN_DELAYS } from './constants';

// Re-export types for backward compatibility
export type {
  MessagePersistenceJob,
  ToolExecutionJob,
  EventProcessingJob,
  UsageAggregationJob,
  FileProcessingJob,
  EmbeddingGenerationJob,
  FileChunkingJob,
  CitationPersistenceJob,
  FileCleanupJob,
} from './types';
import type {
  MessagePersistenceJob,
  ToolExecutionJob,
  EventProcessingJob,
  UsageAggregationJob,
  FileProcessingJob,
  EmbeddingGenerationJob,
  FileChunkingJob,
  CitationPersistenceJob,
  FileCleanupJob,
} from './types';

// Core components
import { RedisConnectionManager } from './core/RedisConnectionManager';
import { QueueManager } from './core/QueueManager';
import { WorkerRegistry } from './core/WorkerRegistry';
import { QueueEventManager } from './core/QueueEventManager';
import { ScheduledJobManager } from './core/ScheduledJobManager';
import { RateLimiter } from './core/RateLimiter';

// Workers
import { getMessagePersistenceWorker } from './workers/MessagePersistenceWorker';
import { getToolExecutionWorker } from './workers/ToolExecutionWorker';
import { getEventProcessingWorker } from './workers/EventProcessingWorker';
import { getUsageAggregationWorker } from './workers/UsageAggregationWorker';
import { getFileProcessingWorker } from './workers/FileProcessingWorker';
import { getFileChunkingWorker } from './workers/FileChunkingWorker';
import { getEmbeddingGenerationWorker } from './workers/EmbeddingGenerationWorker';
import { getCitationPersistenceWorker } from './workers/CitationPersistenceWorker';
import { getFileCleanupWorker } from './workers/FileCleanupWorker';
import { getFileDeletionWorker } from './workers/FileDeletionWorker';
import { getFileBulkUploadWorker } from './workers/FileBulkUploadWorker';

/**
 * Message Queue Manager Class
 *
 * Facade that coordinates extracted components for backward compatibility.
 */
export class MessageQueue {
  private static instance: MessageQueue | null = null;

  // Core components
  private redisManager: RedisConnectionManager;
  private queueManager: QueueManager;
  private workerRegistry: WorkerRegistry;
  private eventManager: QueueEventManager;
  private scheduledJobManager: ScheduledJobManager;
  private rateLimiter: RateLimiter;

  // Dependencies
  private log: ILoggerMinimal;
  private executeQueryFn: ExecuteQueryFn | null = null;
  private executeQueryOverride?: ExecuteQueryFn;
  private embeddingServiceOverride?: IEmbeddingServiceMinimal;
  private vectorSearchServiceOverride?: IVectorSearchServiceMinimal;

  // State
  private isReady: boolean = false;
  private readyPromise: Promise<void>;

  /**
   * Private constructor with optional dependency injection
   */
  private constructor(dependencies?: IMessageQueueDependencies) {
    this.log = dependencies?.logger ?? createChildLogger({ service: 'MessageQueue' });

    // Store service overrides for workers
    this.embeddingServiceOverride = dependencies?.embeddingService;
    this.vectorSearchServiceOverride = dependencies?.vectorSearchService;

    // Initialize RedisConnectionManager
    this.redisManager = new RedisConnectionManager({
      redis: dependencies?.redis,
      logger: this.log,
    });

    // Get Redis connection config for other components
    const redisConfig = this.redisManager.getConnectionConfig();
    const queueNamePrefix = dependencies?.queueNamePrefix || '';

    // Initialize QueueManager
    this.queueManager = new QueueManager({
      redisConfig,
      logger: this.log,
      queueNamePrefix,
    });

    // Initialize WorkerRegistry
    this.workerRegistry = new WorkerRegistry({
      redisConfig,
      getQueueName: (name) => this.queueManager.getQueueName(name),
      logger: this.log,
    });

    // Initialize QueueEventManager
    this.eventManager = new QueueEventManager({
      redisConfig,
      getQueueName: (name) => this.queueManager.getQueueName(name),
      getQueue: (name) => this.queueManager.getQueue(name),
      logger: this.log,
    });

    // Initialize ScheduledJobManager
    this.scheduledJobManager = new ScheduledJobManager({
      getQueue: (name) => this.queueManager.getQueue(name),
      logger: this.log,
    });

    // Initialize RateLimiter
    this.rateLimiter = new RateLimiter({
      redis: this.redisManager.getConnection(),
      logger: this.log,
    });

    // Store executeQuery override for later initialization
    this.executeQueryOverride = dependencies?.executeQuery;

    // Create ready promise
    this.readyPromise = this.initialize(dependencies);
  }

  /**
   * Initialize all components after Redis is ready
   */
  private async initialize(dependencies?: IMessageQueueDependencies): Promise<void> {
    // Wait for Redis connection
    await this.redisManager.waitForReady();

    // Resolve executeQuery function (use override or dynamic import)
    if (this.executeQueryOverride) {
      this.executeQueryFn = this.executeQueryOverride;
    } else {
      // Dynamic import to avoid circular dependency
      const { executeQuery } = await import('@/infrastructure/database/database');
      this.executeQueryFn = executeQuery;
    }

    // Initialize queues
    this.queueManager.initializeQueues();

    // Initialize workers with extracted worker classes
    this.initializeWorkers(dependencies);

    // Initialize event listeners
    this.eventManager.initializeEventListeners();

    // Set up custom failed job handler for file processing
    this.eventManager.setFailedJobHandler(async (context) => {
      await this.handleFailedFileJob(context);
    });

    // Initialize scheduled jobs
    await this.scheduledJobManager.initializeScheduledJobs();

    this.isReady = true;
    this.log.info('MessageQueue initialized with BullMQ', {
      queues: Array.from(this.queueManager.getAllQueues().keys()),
      workers: Array.from(this.workerRegistry.getAllWorkers().keys()),
    });
  }

  /**
   * Initialize all workers using extracted worker classes
   */
  private initializeWorkers(dependencies?: IMessageQueueDependencies): void {
    // executeQueryFn should be resolved by this point in initialize()
    if (!this.executeQueryFn) {
      throw new Error('executeQueryFn not initialized');
    }

    const workerDeps = {
      logger: this.log,
      executeQuery: this.executeQueryFn,
      eventStore: dependencies?.eventStore,
      embeddingService: this.embeddingServiceOverride,
      vectorSearchService: this.vectorSearchServiceOverride,
    };

    // Message Persistence Worker
    const messagePersistenceWorker = getMessagePersistenceWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.MESSAGE_PERSISTENCE,
      async (job: Job<MessagePersistenceJob>) => messagePersistenceWorker.process(job)
    );

    // Tool Execution Worker
    const toolExecutionWorker = getToolExecutionWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.TOOL_EXECUTION,
      async (job: Job<ToolExecutionJob>) => toolExecutionWorker.process(job)
    );

    // Event Processing Worker
    const eventProcessingWorker = getEventProcessingWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.EVENT_PROCESSING,
      async (job: Job<EventProcessingJob>) => eventProcessingWorker.process(job)
    );

    // Usage Aggregation Worker
    const usageAggregationWorker = getUsageAggregationWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.USAGE_AGGREGATION,
      async (job: Job<UsageAggregationJob>) => usageAggregationWorker.process(job)
    );

    // File Processing Worker
    const fileProcessingWorker = getFileProcessingWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.FILE_PROCESSING,
      async (job: Job<FileProcessingJob>) => {
        this.log.info({
          jobId: job.id,
          fileId: job.data?.fileId,
          attemptsMade: job.attemptsMade,
        }, '[WORKER-ENTRY] File processing worker callback started');
        return fileProcessingWorker.process(job);
      }
    );

    // File Chunking Worker
    const fileChunkingWorker = getFileChunkingWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.FILE_CHUNKING,
      async (job: Job<FileChunkingJob>) => fileChunkingWorker.process(job)
    );

    // Embedding Generation Worker
    const embeddingGenerationWorker = getEmbeddingGenerationWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.EMBEDDING_GENERATION,
      async (job: Job<EmbeddingGenerationJob>) => embeddingGenerationWorker.process(job)
    );

    // Citation Persistence Worker
    const citationPersistenceWorker = getCitationPersistenceWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.CITATION_PERSISTENCE,
      async (job: Job<CitationPersistenceJob>) => citationPersistenceWorker.process(job)
    );

    // File Cleanup Worker
    const fileCleanupWorker = getFileCleanupWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.FILE_CLEANUP,
      async (job: Job<FileCleanupJob>) => fileCleanupWorker.process(job)
    );

    // File Deletion Worker
    const fileDeletionWorker = getFileDeletionWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.FILE_DELETION,
      async (job: Job<FileDeletionJobData>) => fileDeletionWorker.process(job)
    );

    // File Bulk Upload Worker
    const fileBulkUploadWorker = getFileBulkUploadWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.FILE_BULK_UPLOAD,
      async (job: Job<BulkUploadJobData>) => fileBulkUploadWorker.process(job)
    );

    this.log.info('All workers initialized', {
      workers: Array.from(this.workerRegistry.getAllWorkers().keys()),
    });
  }

  /**
   * Handle failed file processing jobs (for ProcessingRetryManager)
   */
  private async handleFailedFileJob(context: {
    queueName: QueueName;
    userId?: string;
    fileId?: string;
    sessionId?: string;
    failedReason: string;
  }): Promise<void> {
    const { queueName, userId, fileId, sessionId, failedReason } = context;

    const isFileQueue = queueName === QueueName.FILE_PROCESSING ||
                        queueName === QueueName.FILE_CHUNKING ||
                        queueName === QueueName.EMBEDDING_GENERATION;

    if (isFileQueue && fileId && userId) {
      try {
        const { getProcessingRetryManager } = await import('@/domains/files/retry');
        const retryManager = getProcessingRetryManager();
        await retryManager.handlePermanentFailure(userId, fileId, failedReason, sessionId);
        this.log.info({
          fileId,
          queueName,
        }, 'Updated file readiness state via ProcessingRetryManager');
      } catch (emitError) {
        this.log.error({
          error: emitError instanceof Error ? emitError.message : String(emitError),
          fileId,
        }, 'Failed to update file readiness state');
      }
    }
  }

  /**
   * Get singleton instance with optional dependency injection
   */
  public static getInstance(dependencies?: IMessageQueueDependencies): MessageQueue {
    if (!MessageQueue.instance) {
      MessageQueue.instance = new MessageQueue(dependencies);
    }
    return MessageQueue.instance;
  }

  /**
   * Reset singleton instance for testing
   */
  public static async __resetInstance(): Promise<void> {
    if (MessageQueue.instance) {
      await MessageQueue.instance.close();
    }
    MessageQueue.instance = null;
  }

  /**
   * Check if singleton instance exists
   */
  public static hasInstance(): boolean {
    return MessageQueue.instance !== null;
  }

  /**
   * Wait for MessageQueue to be ready
   */
  public async waitForReady(): Promise<void> {
    if (this.isReady) {
      return;
    }
    this.log.debug('Waiting for MessageQueue to be ready...');
    await this.readyPromise;
    this.log.debug('MessageQueue is ready');
  }

  /**
   * Check if MessageQueue is ready
   */
  public getReadyStatus(): boolean {
    return this.isReady;
  }

  // ==================== PUBLIC API (unchanged) ====================

  /**
   * Add Message to Persistence Queue (with rate limiting)
   */
  public async addMessagePersistence(data: MessagePersistenceJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.MESSAGE_PERSISTENCE);
    if (!queue) {
      throw new Error('Message persistence queue not initialized');
    }

    // Check rate limit
    const withinLimit = await this.rateLimiter.checkLimit(data.sessionId);
    if (!withinLimit) {
      throw new Error(
        `Rate limit exceeded for session ${data.sessionId}. Max ${RATE_LIMIT.MAX_JOBS_PER_SESSION} jobs per hour.`
      );
    }

    const job = await queue.add('persist-message', data, {
      priority: JOB_PRIORITY.MESSAGE_PERSISTENCE,
    });

    this.log.info('Message job enqueued to BullMQ', {
      jobId: job.id,
      sessionId: data.sessionId,
      messageId: data.messageId,
      messageType: data.messageType,
      role: data.role,
      contentLength: data.content?.length || 0,
      hasMetadata: !!data.metadata,
    });

    return job.id || '';
  }

  /**
   * Add Tool Execution to Queue
   */
  public async addToolExecution(data: ToolExecutionJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.TOOL_EXECUTION);
    if (!queue) {
      throw new Error('Tool execution queue not initialized');
    }

    const job = await queue.add('execute-tool', data, {
      priority: JOB_PRIORITY.TOOL_EXECUTION,
    });

    this.log.debug('Tool execution added to queue', {
      jobId: job.id,
      toolName: data.toolName,
    });

    return job.id || '';
  }

  /**
   * Add Event to Processing Queue
   */
  public async addEventProcessing(data: EventProcessingJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.EVENT_PROCESSING);
    if (!queue) {
      throw new Error('Event processing queue not initialized');
    }

    const job = await queue.add('process-event', data, {
      priority: 3,
    });

    return job.id || '';
  }

  /**
   * Add Embedding Generation Job
   */
  async addEmbeddingGenerationJob(data: EmbeddingGenerationJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.EMBEDDING_GENERATION);
    if (!queue) {
      throw new Error('Embedding generation queue not initialized');
    }

    const job = await queue.add('generate-embeddings', data, {
      priority: JOB_PRIORITY.EMBEDDING_GENERATION,
    });

    return job.id || '';
  }

  /**
   * Add Usage Aggregation Job to Queue
   */
  public async addUsageAggregationJob(data: UsageAggregationJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.USAGE_AGGREGATION);
    if (!queue) {
      throw new Error('Usage aggregation queue not initialized');
    }

    const job = await queue.add(`aggregation-${data.type}`, data, {
      priority: JOB_PRIORITY.USAGE_AGGREGATION,
    });

    this.log.info('Usage aggregation job added to queue', {
      jobId: job.id,
      type: data.type,
      userId: data.userId || 'all-users',
      periodStart: data.periodStart,
    });

    return job.id || '';
  }

  /**
   * Add File Processing Job to Queue
   */
  public async addFileProcessingJob(data: FileProcessingJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.FILE_PROCESSING);
    if (!queue) {
      throw new Error('File processing queue not initialized');
    }

    const withinLimit = await this.rateLimiter.checkLimit(`file:${data.userId}`);
    if (!withinLimit) {
      throw new Error(
        `Rate limit exceeded for user ${data.userId}. Max ${RATE_LIMIT.MAX_JOBS_PER_SESSION} file processing jobs per hour.`
      );
    }

    const job = await queue.add('process-file', data, {
      priority: JOB_PRIORITY.FILE_PROCESSING,
    });

    this.log.info('File processing job added to queue', {
      jobId: job.id,
      fileId: data.fileId,
      userId: data.userId,
      mimeType: data.mimeType,
      fileName: data.fileName,
    });

    return job.id || '';
  }

  /**
   * Add File Chunking Job
   */
  public async addFileChunkingJob(data: FileChunkingJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.FILE_CHUNKING);
    if (!queue) {
      throw new Error('File chunking queue not initialized');
    }

    const withinLimit = await this.rateLimiter.checkLimit(`chunking:${data.userId}`);
    if (!withinLimit) {
      throw new Error(
        `Rate limit exceeded for user ${data.userId}. Max ${RATE_LIMIT.MAX_JOBS_PER_SESSION} chunking jobs per hour.`
      );
    }

    const job = await queue.add('chunk-file', data, {
      priority: JOB_PRIORITY.FILE_CHUNKING,
    });

    this.log.info('File chunking job added to queue', {
      jobId: job.id,
      fileId: data.fileId,
      userId: data.userId,
      mimeType: data.mimeType,
    });

    return job.id || '';
  }

  /**
   * Add Citation Persistence Job
   */
  public async addCitationPersistence(data: CitationPersistenceJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.CITATION_PERSISTENCE);
    if (!queue) {
      throw new Error('Citation persistence queue not initialized');
    }

    const job = await queue.add('persist-citations', data, {
      priority: JOB_PRIORITY.CITATION_PERSISTENCE,
    });

    this.log.info('Citation persistence job added to queue', {
      jobId: job.id,
      messageId: data.messageId,
      sessionId: data.sessionId,
      citationCount: data.citations.length,
    });

    return job.id || '';
  }

  /**
   * Add File Cleanup Job
   */
  public async addFileCleanupJob(data: FileCleanupJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.FILE_CLEANUP);
    if (!queue) {
      throw new Error('File cleanup queue not initialized');
    }

    const job = await queue.add(`cleanup-${data.type}`, data, {
      priority: JOB_PRIORITY.FILE_CLEANUP,
    });

    this.log.info('File cleanup job added to queue', {
      jobId: job.id,
      type: data.type,
      userId: data.userId || 'all-users',
    });

    return job.id || '';
  }

  /**
   * Add File Deletion Job
   */
  public async addFileDeletionJob(data: FileDeletionJobData): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.FILE_DELETION);
    if (!queue) {
      throw new Error('File deletion queue not initialized');
    }

    const job = await queue.add('delete-file', data, {
      priority: JOB_PRIORITY.FILE_DELETION,
    });

    this.log.info('File deletion job added to queue', {
      jobId: job.id,
      fileId: data.fileId,
      userId: data.userId,
      batchId: data.batchId,
      deletionReason: data.deletionReason,
    });

    return job.id || '';
  }

  /**
   * Add File Bulk Upload Job
   */
  public async addFileBulkUploadJob(data: BulkUploadJobData): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.FILE_BULK_UPLOAD);
    if (!queue) {
      throw new Error('File bulk upload queue not initialized');
    }

    const job = await queue.add('upload-file', data, {
      priority: JOB_PRIORITY.FILE_BULK_UPLOAD,
    });

    this.log.info('File bulk upload job added to queue', {
      jobId: job.id,
      tempId: data.tempId,
      userId: data.userId,
      batchId: data.batchId,
      fileName: data.fileName,
    });

    return job.id || '';
  }

  /**
   * Get Rate Limit Status for Session
   */
  public async getRateLimitStatus(sessionId: string): Promise<{
    count: number;
    limit: number;
    remaining: number;
    withinLimit: boolean;
  }> {
    return this.rateLimiter.getStatus(sessionId);
  }

  /**
   * Get Queue Stats
   */
  public async getQueueStats(queueName: QueueName): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get QueueEvents instance for a queue
   */
  public getQueueEvents(queueName: QueueName): QueueEvents | undefined {
    return this.eventManager.getQueueEvents(queueName);
  }

  /**
   * Get a job by ID
   */
  public async getJob(queueName: QueueName, jobId: string): Promise<Job | null> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) return null;
    const job = await queue.getJob(jobId);
    return job ?? null;
  }

  /**
   * Pause Queue
   */
  public async pauseQueue(queueName: QueueName): Promise<void> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.pause();
    this.log.info(`Queue ${queueName} paused`);
  }

  /**
   * Resume Queue
   */
  public async resumeQueue(queueName: QueueName): Promise<void> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.resume();
    this.log.info(`Queue ${queueName} resumed`);
  }

  /**
   * Close all queues and workers with proper BullMQ shutdown pattern
   */
  public async close(): Promise<void> {
    this.log.info('Initiating MessageQueue graceful shutdown...');
    const errors: Error[] = [];

    // Phase 1: Close workers
    this.log.debug('Phase 1: Closing workers...');
    const workerErrors = await this.workerRegistry.closeAll();
    errors.push(...workerErrors);

    await new Promise(resolve => setTimeout(resolve, SHUTDOWN_DELAYS.PHASE_DELAY));

    // Phase 2: Close queue events
    this.log.debug('Phase 2: Closing queue events...');
    const eventErrors = await this.eventManager.closeAll();
    errors.push(...eventErrors);

    await new Promise(resolve => setTimeout(resolve, SHUTDOWN_DELAYS.PHASE_DELAY));

    // Phase 3: Close queues
    this.log.debug('Phase 3: Closing queues...');
    const queueErrors = await this.queueManager.closeAll();
    errors.push(...queueErrors);

    // Phase 4: Close Redis (only if owned)
    try {
      await this.redisManager.close();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push(error);
    }

    this.isReady = false;

    if (errors.length > 0) {
      this.log.warn(`MessageQueue closed with ${errors.length} error(s)`, {
        errors: errors.map(e => e.message),
      });
    } else {
      this.log.info('MessageQueue closed successfully');
    }
  }
}

/**
 * Get MessageQueue singleton instance
 */
export function getMessageQueue(dependencies?: IMessageQueueDependencies): MessageQueue {
  return MessageQueue.getInstance(dependencies);
}

/**
 * Check if MessageQueue singleton exists
 */
export function hasMessageQueueInstance(): boolean {
  return MessageQueue.hasInstance();
}

/**
 * Reset MessageQueue singleton for testing
 */
export async function __resetMessageQueue(): Promise<void> {
  await MessageQueue.__resetInstance();
}
