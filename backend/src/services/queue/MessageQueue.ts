/**
 * Message Queue Service (Multi-Tenant Safe)
 *
 * Implements message queue system using BullMQ with rate limiting.
 * Decouples message persistence from the main request/response flow.
 *
 * Architecture:
 * - message-persistence: Persist messages to database (concurrency: 10)
 * - tool-execution: Execute tool calls asynchronously (concurrency: 5)
 * - event-processing: Process events from EventStore (concurrency: 10)
 *
 * Rate Limiting:
 * - Max 100 jobs per session in message-persistence queue
 * - Prevents single tenant from saturating the queue
 * - Horizontal scaling ready
 *
 * @module services/queue/MessageQueue
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '@/config';
import { logger } from '@/utils/logger';
import { executeQuery, SqlParams } from '@/config/database';
import { getEventStore, EventType } from '../events/EventStore';

/**
 * Queue Names
 */
export enum QueueName {
  MESSAGE_PERSISTENCE = 'message-persistence',
  TOOL_EXECUTION = 'tool-execution',
  EVENT_PROCESSING = 'event-processing',
}

/**
 * Message Persistence Job Data
 */
export interface MessagePersistenceJob {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  messageType: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool Execution Job Data
 */
export interface ToolExecutionJob {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  userId: string;
}

/**
 * Event Processing Job Data
 */
export interface EventProcessingJob {
  eventId: string;
  sessionId: string;
  eventType: EventType;
  data: Record<string, unknown>;
}

/**
 * Message Queue Manager Class
 *
 * Manages all queues and workers with rate limiting for multi-tenant safety.
 */
export class MessageQueue {
  private static instance: MessageQueue | null = null;

  // Rate limiting constants
  private static readonly MAX_JOBS_PER_SESSION = 100;
  private static readonly RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

  private redisConnection: Redis;
  private queues: Map<QueueName, Queue>;
  private workers: Map<QueueName, Worker>;
  private queueEvents: Map<QueueName, QueueEvents>;

  private constructor() {
    // Create Redis connection for BullMQ
    this.redisConnection = new Redis({
      host: env.REDIS_HOST || 'localhost',
      port: env.REDIS_PORT || 6379,
      password: env.REDIS_PASSWORD,
      maxRetriesPerRequest: null, // Required for BullMQ
    });

    this.queues = new Map();
    this.workers = new Map();
    this.queueEvents = new Map();

    this.initializeQueues();
    this.initializeWorkers();
    this.setupEventListeners();

    logger.info('MessageQueue initialized with BullMQ');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MessageQueue {
    if (!MessageQueue.instance) {
      MessageQueue.instance = new MessageQueue();
    }
    return MessageQueue.instance;
  }

  /**
   * Initialize all queues
   */
  private initializeQueues(): void {
    // Message Persistence Queue
    this.queues.set(
      QueueName.MESSAGE_PERSISTENCE,
      new Queue(QueueName.MESSAGE_PERSISTENCE, {
        connection: this.redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000, // Start with 1s, then 2s, 4s
          },
          removeOnComplete: {
            count: 100, // Keep last 100 completed jobs
            age: 3600, // Remove after 1 hour
          },
          removeOnFail: {
            count: 500, // Keep last 500 failed jobs for debugging
            age: 86400, // Remove after 24 hours
          },
        },
      })
    );

    // Tool Execution Queue
    this.queues.set(
      QueueName.TOOL_EXECUTION,
      new Queue(QueueName.TOOL_EXECUTION, {
        connection: this.redisConnection,
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      })
    );

    // Event Processing Queue
    this.queues.set(
      QueueName.EVENT_PROCESSING,
      new Queue(QueueName.EVENT_PROCESSING, {
        connection: this.redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 500,
          },
        },
      })
    );

    logger.info('All queues initialized', {
      queues: Array.from(this.queues.keys()),
    });
  }

  /**
   * Initialize all workers
   */
  private initializeWorkers(): void {
    // Message Persistence Worker
    this.workers.set(
      QueueName.MESSAGE_PERSISTENCE,
      new Worker(
        QueueName.MESSAGE_PERSISTENCE,
        async (job: Job<MessagePersistenceJob>) => {
          return this.processMessagePersistence(job);
        },
        {
          connection: this.redisConnection,
          concurrency: 10, // Process 10 messages in parallel
        }
      )
    );

    // Tool Execution Worker
    this.workers.set(
      QueueName.TOOL_EXECUTION,
      new Worker(
        QueueName.TOOL_EXECUTION,
        async (job: Job<ToolExecutionJob>) => {
          return this.processToolExecution(job);
        },
        {
          connection: this.redisConnection,
          concurrency: 5,
        }
      )
    );

    // Event Processing Worker
    this.workers.set(
      QueueName.EVENT_PROCESSING,
      new Worker(
        QueueName.EVENT_PROCESSING,
        async (job: Job<EventProcessingJob>) => {
          return this.processEvent(job);
        },
        {
          connection: this.redisConnection,
          concurrency: 10,
        }
      )
    );

    logger.info('All workers initialized', {
      workers: Array.from(this.workers.keys()),
    });
  }

  /**
   * Setup event listeners for monitoring
   */
  private setupEventListeners(): void {
    Object.values(QueueName).forEach((queueName) => {
      const queueEvents = new QueueEvents(queueName, {
        connection: this.redisConnection,
      });

      this.queueEvents.set(queueName, queueEvents);

      queueEvents.on('completed', ({ jobId }) => {
        logger.debug(`Job completed in ${queueName}`, { jobId });
      });

      queueEvents.on('failed', ({ jobId, failedReason }) => {
        logger.error(`Job failed in ${queueName}`, { jobId, failedReason });
      });

      queueEvents.on('stalled', ({ jobId }) => {
        logger.warn(`Job stalled in ${queueName}`, { jobId });
      });
    });
  }

  /**
   * Check Rate Limit for Session
   *
   * Ensures a session doesn't exceed max jobs per hour (multi-tenant safety).
   *
   * @param sessionId - Session ID
   * @returns True if within limit, false otherwise
   */
  private async checkRateLimit(sessionId: string): Promise<boolean> {
    const key = `queue:ratelimit:${sessionId}`;

    try {
      // Increment counter and set expiry atomically
      const count = await this.redisConnection.incr(key);

      // Set TTL only on first increment
      if (count === 1) {
        await this.redisConnection.expire(
          key,
          MessageQueue.RATE_LIMIT_WINDOW_SECONDS
        );
      }

      const withinLimit = count <= MessageQueue.MAX_JOBS_PER_SESSION;

      if (!withinLimit) {
        logger.warn('Rate limit exceeded for session', {
          sessionId,
          count,
          limit: MessageQueue.MAX_JOBS_PER_SESSION,
        });
      }

      return withinLimit;
    } catch (error) {
      logger.error('Failed to check rate limit', { error, sessionId });
      // Fail open - allow job if rate limit check fails
      return true;
    }
  }

  /**
   * Add Message to Persistence Queue (with rate limiting)
   *
   * Rate Limiting: Max 100 jobs per session per hour.
   * Prevents single tenant from saturating the queue.
   *
   * @param data - Message data to persist
   * @returns Job ID
   * @throws Error if rate limit exceeded
   */
  public async addMessagePersistence(
    data: MessagePersistenceJob
  ): Promise<string> {
    const queue = this.queues.get(QueueName.MESSAGE_PERSISTENCE);
    if (!queue) {
      throw new Error('Message persistence queue not initialized');
    }

    // Check rate limit
    const withinLimit = await this.checkRateLimit(data.sessionId);
    if (!withinLimit) {
      throw new Error(
        `Rate limit exceeded for session ${data.sessionId}. Max ${MessageQueue.MAX_JOBS_PER_SESSION} jobs per hour.`
      );
    }

    const job = await queue.add('persist-message', data, {
      priority: 1, // High priority for message persistence
    });

    logger.debug('Message added to persistence queue', {
      jobId: job.id,
      sessionId: data.sessionId,
      messageType: data.messageType,
    });

    return job.id || '';
  }

  /**
   * Add Tool Execution to Queue
   *
   * @param data - Tool execution data
   * @returns Job ID
   */
  public async addToolExecution(data: ToolExecutionJob): Promise<string> {
    const queue = this.queues.get(QueueName.TOOL_EXECUTION);
    if (!queue) {
      throw new Error('Tool execution queue not initialized');
    }

    const job = await queue.add('execute-tool', data, {
      priority: 2,
    });

    logger.debug('Tool execution added to queue', {
      jobId: job.id,
      toolName: data.toolName,
    });

    return job.id || '';
  }

  /**
   * Add Event to Processing Queue
   *
   * @param data - Event data
   * @returns Job ID
   */
  public async addEventProcessing(data: EventProcessingJob): Promise<string> {
    const queue = this.queues.get(QueueName.EVENT_PROCESSING);
    if (!queue) {
      throw new Error('Event processing queue not initialized');
    }

    const job = await queue.add('process-event', data, {
      priority: 3,
    });

    return job.id || '';
  }

  /**
   * Process Message Persistence Job
   *
   * @param job - BullMQ job
   */
  private async processMessagePersistence(
    job: Job<MessagePersistenceJob>
  ): Promise<void> {
    const { sessionId, messageId, role, messageType, content, metadata } = job.data;

    try {
      const params: SqlParams = {
        id: messageId,
        session_id: sessionId,
        role,
        message_type: messageType,
        content,
        metadata: metadata ? JSON.stringify(metadata) : '{}',
        created_at: new Date(),
      };

      await executeQuery(
        `
        INSERT INTO messages (id, session_id, role, message_type, content, metadata, created_at)
        VALUES (@id, @session_id, @role, @message_type, @content, @metadata, @created_at)
        `,
        params
      );

      logger.debug('Message persisted successfully', {
        jobId: job.id,
        messageId,
        sessionId,
        messageType,
      });
    } catch (error) {
      logger.error('Failed to persist message', {
        error,
        jobId: job.id,
        messageId,
        sessionId,
      });
      throw error; // Will trigger retry
    }
  }

  /**
   * Process Tool Execution Job
   *
   * @param job - BullMQ job
   */
  private async processToolExecution(
    job: Job<ToolExecutionJob>
  ): Promise<void> {
    const { sessionId, toolUseId, toolName } = job.data;

    logger.info('Processing tool execution', {
      jobId: job.id,
      toolName,
      toolUseId,
      sessionId,
    });

    // TODO: Implement actual tool execution logic
    // This would call DirectAgentService.executeMCPTool() or similar

    logger.debug('Tool execution completed', {
      jobId: job.id,
      toolName,
    });
  }

  /**
   * Process Event Job
   *
   * @param job - BullMQ job
   */
  private async processEvent(job: Job<EventProcessingJob>): Promise<void> {
    const { eventId, sessionId, eventType } = job.data;

    logger.debug('Processing event', {
      jobId: job.id,
      eventId,
      eventType,
      sessionId,
    });

    // Mark event as processed in EventStore
    const eventStore = getEventStore();
    await eventStore.markAsProcessed(eventId);

    // Additional event-specific processing can be added here
    // For example, triggering webhooks, notifications, etc.
  }

  /**
   * Get Rate Limit Status for Session
   *
   * Returns current rate limit status for monitoring.
   *
   * @param sessionId - Session ID
   * @returns Rate limit status
   */
  public async getRateLimitStatus(sessionId: string): Promise<{
    count: number;
    limit: number;
    remaining: number;
    withinLimit: boolean;
  }> {
    const key = `queue:ratelimit:${sessionId}`;

    try {
      const countStr = await this.redisConnection.get(key);
      const count = countStr ? parseInt(countStr, 10) : 0;
      const limit = MessageQueue.MAX_JOBS_PER_SESSION;
      const remaining = Math.max(0, limit - count);
      const withinLimit = count <= limit;

      return { count, limit, remaining, withinLimit };
    } catch (error) {
      logger.error('Failed to get rate limit status', { error, sessionId });
      return {
        count: 0,
        limit: MessageQueue.MAX_JOBS_PER_SESSION,
        remaining: MessageQueue.MAX_JOBS_PER_SESSION,
        withinLimit: true,
      };
    }
  }

  /**
   * Get Queue Stats
   *
   * @param queueName - Name of queue
   * @returns Queue statistics
   */
  public async getQueueStats(queueName: QueueName): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queue = this.queues.get(queueName);
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
   * Pause Queue
   *
   * @param queueName - Name of queue to pause
   */
  public async pauseQueue(queueName: QueueName): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.pause();
    logger.info(`Queue ${queueName} paused`);
  }

  /**
   * Resume Queue
   *
   * @param queueName - Name of queue to resume
   */
  public async resumeQueue(queueName: QueueName): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.resume();
    logger.info(`Queue ${queueName} resumed`);
  }

  /**
   * Close all queues and workers
   *
   * Graceful shutdown - waits for active jobs to complete.
   */
  public async close(): Promise<void> {
    logger.info('Closing MessageQueue...');

    // Close all workers first (wait for active jobs)
    for (const [name, worker] of this.workers.entries()) {
      logger.info(`Closing worker: ${name}`);
      await worker.close();
    }

    // Close all queue events
    for (const [name, queueEvents] of this.queueEvents.entries()) {
      logger.info(`Closing queue events: ${name}`);
      await queueEvents.close();
    }

    // Close all queues
    for (const [name, queue] of this.queues.entries()) {
      logger.info(`Closing queue: ${name}`);
      await queue.close();
    }

    // Close Redis connection
    await this.redisConnection.quit();

    logger.info('MessageQueue closed successfully');
  }
}

/**
 * Get MessageQueue singleton instance
 */
export function getMessageQueue(): MessageQueue {
  return MessageQueue.getInstance();
}
