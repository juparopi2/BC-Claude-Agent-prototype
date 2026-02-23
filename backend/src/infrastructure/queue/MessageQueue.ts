/**
 * Message Queue Service (Multi-Tenant Safe) - Facade
 *
 * Implements message queue system using BullMQ.
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
import type { FileDeletionJobData } from '@bc-agent/shared';

// Re-export from constants for backward compatibility
export { QueueName } from './constants';
import { QueueName, JOB_PRIORITY, SHUTDOWN_DELAYS } from './constants';

// Re-export types for backward compatibility
export type {
  MessagePersistenceJob,
  ToolExecutionJob,
  EventProcessingJob,
  UsageAggregationJob,
  CitationPersistenceJob,
} from './types';
import type {
  MessagePersistenceJob,
  ToolExecutionJob,
  EventProcessingJob,
  UsageAggregationJob,
  CitationPersistenceJob,
} from './types';

// Core components
import { RedisConnectionManager } from './core/RedisConnectionManager';
import { QueueManager } from './core/QueueManager';
import { WorkerRegistry } from './core/WorkerRegistry';
import { QueueEventManager } from './core/QueueEventManager';
import { ScheduledJobManager } from './core/ScheduledJobManager';

// Workers
import { getMessagePersistenceWorker } from './workers/MessagePersistenceWorker';
import { getToolExecutionWorker } from './workers/ToolExecutionWorker';
import { getEventProcessingWorker } from './workers/EventProcessingWorker';
import { getUsageAggregationWorker } from './workers/UsageAggregationWorker';
import { getCitationPersistenceWorker } from './workers/CitationPersistenceWorker';
import { getFileDeletionWorker } from './workers/FileDeletionWorker';
import { getFileExtractWorker } from './workers/FileExtractWorker';
import { getFileChunkWorker } from './workers/FileChunkWorker';
import { getFileEmbedWorker } from './workers/FileEmbedWorker';
import { getFilePipelineCompleteWorker } from './workers/FilePipelineCompleteWorker';
import { getMaintenanceWorker, type MaintenanceJobData } from './workers/MaintenanceWorker';
import type { ExtractJobData, ChunkJobData, EmbedJobData, PipelineCompleteJobData } from './workers';
import { FlowProducerManager } from './core/FlowProducerManager';
import { ProcessingFlowFactory, type FileFlowParams } from './flow';

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
  private flowProducerManager: FlowProducerManager | null = null;

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

    // Initialize FlowProducerManager (PRD-04)
    this.flowProducerManager = new FlowProducerManager({
      redisConfig: this.redisManager.getConnectionConfig(),
      queueNamePrefix: dependencies?.queueNamePrefix || '',
      logger: this.log,
    });

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

    // Citation Persistence Worker
    const citationPersistenceWorker = getCitationPersistenceWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.CITATION_PERSISTENCE,
      async (job: Job<CitationPersistenceJob>) => citationPersistenceWorker.process(job)
    );

    // File Deletion Worker
    const fileDeletionWorker = getFileDeletionWorker(workerDeps);
    this.workerRegistry.registerWorker(
      QueueName.FILE_DELETION,
      async (job: Job<FileDeletionJobData>) => fileDeletionWorker.process(job)
    );

    // File Pipeline Workers (PRD-04)
    const fileExtractWorker = getFileExtractWorker({ logger: this.log });
    this.workerRegistry.registerWorker(
      QueueName.FILE_EXTRACT,
      async (job: Job<ExtractJobData>) => fileExtractWorker.process(job)
    );

    const fileChunkWorker = getFileChunkWorker({ logger: this.log });
    this.workerRegistry.registerWorker(
      QueueName.FILE_CHUNK,
      async (job: Job<ChunkJobData>) => fileChunkWorker.process(job)
    );

    const fileEmbedWorker = getFileEmbedWorker({ logger: this.log });
    this.workerRegistry.registerWorker(
      QueueName.FILE_EMBED,
      async (job: Job<EmbedJobData>) => fileEmbedWorker.process(job)
    );

    const filePipelineCompleteWorker = getFilePipelineCompleteWorker({ logger: this.log });
    this.workerRegistry.registerWorker(
      QueueName.FILE_PIPELINE_COMPLETE,
      async (job: Job<PipelineCompleteJobData>) => filePipelineCompleteWorker.process(job)
    );

    // Maintenance Worker (PRD-05)
    const maintenanceWorker = getMaintenanceWorker({ logger: this.log });
    this.workerRegistry.registerWorker(
      QueueName.FILE_MAINTENANCE,
      async (job: Job<MaintenanceJobData>) => maintenanceWorker.process(job)
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

    const isFileQueue = queueName === QueueName.FILE_EXTRACT ||
                        queueName === QueueName.FILE_CHUNK ||
                        queueName === QueueName.FILE_EMBED;

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
   * Add Message to Persistence Queue
   */
  public async addMessagePersistence(data: MessagePersistenceJob): Promise<string> {
    await this.waitForReady();

    const queue = this.queueManager.getQueue(QueueName.MESSAGE_PERSISTENCE);
    if (!queue) {
      throw new Error('Message persistence queue not initialized');
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
   * Add File Processing Flow (PRD-04)
   *
   * Creates a BullMQ Flow tree that guarantees sequential execution:
   * extract → chunk → embed → pipeline-complete
   *
   * @param params - File flow parameters (fileId, batchId, userId, mimeType, blobPath, fileName)
   */
  public async addFileProcessingFlow(params: FileFlowParams): Promise<void> {
    await this.waitForReady();

    if (!this.flowProducerManager) {
      throw new Error('FlowProducerManager not initialized');
    }

    const flow = ProcessingFlowFactory.createFileFlow(params);
    await this.flowProducerManager.addFlow(flow);

    this.log.info('File processing flow added', {
      fileId: params.fileId,
      batchId: params.batchId,
      userId: params.userId,
      mimeType: params.mimeType,
      fileName: params.fileName,
    });
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

    // Phase 2.5: Close FlowProducerManager
    if (this.flowProducerManager) {
      try {
        await this.flowProducerManager.close();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
      }
    }

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
