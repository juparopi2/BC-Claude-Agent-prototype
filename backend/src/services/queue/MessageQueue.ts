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

import { Queue, Worker, Job, QueueEvents, type RedisOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '@/config';
import { logger } from '@/utils/logger';
import { executeQuery, SqlParams } from '@/config/database';
import { getEventStore, EventType } from '../events/EventStore';
import type {
  IMessageQueueDependencies,
  IEventStoreMinimal,
  ILoggerMinimal,
  ExecuteQueryFn,
} from './IMessageQueueDependencies';

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
 *
 * @description Contains all data needed to persist a message to the database.
 * Phase 1A adds token tracking fields (model, inputTokens, outputTokens).
 * Phase 1B uses Anthropic message IDs as primary key.
 */
export interface MessagePersistenceJob {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  messageType: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
  // ⭐ NEW: Sequence number and event ID from EventStore
  sequenceNumber?: number;
  eventId?: string;
  // ⭐ FIX: Tool use ID for correlating tool_use and tool_result (stored in messages.tool_use_id column)
  toolUseId?: string | null;
  // ⭐ FIX: Stop reason from Anthropic SDK (for identifying intermediate vs final messages)
  stopReason?: string | null;
  // ⭐ PHASE 1A: Token tracking fields from Anthropic SDK
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  // Note: thinkingTokens removed per Option A (2025-11-24)
  // SDK doesn't provide thinking_tokens separately (included in output_tokens)
  // Real-time estimation still available via WebSocket tokenUsage
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
  private ownsRedisConnection: boolean = false;  // Track if we created the connection
  private queues: Map<QueueName, Queue>;
  private workers: Map<QueueName, Worker>;
  private queueEvents: Map<QueueName, QueueEvents>;
  // Connection state tracking (used in waitForReady() method)
  private isReady: boolean = false;
  private readyPromise: Promise<void>;

  // Injected dependencies (DI support for testing)
  private executeQueryFn: ExecuteQueryFn;
  private eventStoreGetter: () => IEventStoreMinimal;
  private log: ILoggerMinimal;

  /**
   * Private constructor with optional dependency injection
   *
   * @param dependencies - Optional dependencies for testing
   */
  private constructor(dependencies?: IMessageQueueDependencies) {
    // Store injected dependencies (with defaults from module imports)
    this.executeQueryFn = dependencies?.executeQuery ?? executeQuery;
    this.eventStoreGetter = dependencies?.eventStore
      ? () => dependencies.eventStore!
      : () => getEventStore();
    this.log = dependencies?.logger ?? logger;

    // Create Redis connection for BullMQ (use injected or create default)
    if (dependencies?.redis) {
      this.redisConnection = dependencies.redis;
      this.ownsRedisConnection = false;  // Injected - don't close it
    } else {
      this.redisConnection = new Redis({
        host: env.REDIS_HOST || 'localhost',
        port: env.REDIS_PORT || 6379,
        password: env.REDIS_PASSWORD,
        maxRetriesPerRequest: null, // Required for BullMQ
        lazyConnect: false, // Connect immediately
        enableReadyCheck: true,
        // ⭐ TLS Configuration for Azure Redis Cache (port 6380 requires SSL)
        tls: env.REDIS_PORT === 6380 ? {
          rejectUnauthorized: true,
        } : undefined,
        // ⭐ Reconnection Strategy - Handle transient failures
        reconnectOnError: (err) => {
          const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
          if (targetErrors.some((targetError) => err.message.includes(targetError))) {
            this.log.warn('Redis reconnecting due to error', { error: err.message });
            return true; // Reconnect
          }
          return false;
        },
        // ⭐ Retry Strategy - Exponential backoff
        retryStrategy: (times) => {
          if (times > 10) {
            this.log.error('Redis max retry attempts reached (10)', { attempts: times });
            return null; // Stop retrying after 10 attempts
          }
          const delay = Math.min(times * 100, 3200); // 100ms, 200ms, 400ms, ..., max 3200ms
          this.log.info('Redis retry attempt', { attempt: times, delayMs: delay });
          return delay;
        },
      });
      this.ownsRedisConnection = true;  // We created it - we close it
    }

    this.queues = new Map();
    this.workers = new Map();
    this.queueEvents = new Map();

    // ⭐ DIAGNOSTIC: Add connection event listeners for IORedis
    this.redisConnection.on('connect', () => {
      this.log.info('🔌 BullMQ IORedis: connect event fired');
    });

    this.redisConnection.on('ready', () => {
      this.log.info('✅ BullMQ IORedis: ready event fired (connection fully established)');
    });

    this.redisConnection.on('error', (err) => {
      this.log.error('❌ BullMQ IORedis: error event', {
        error: err.message,
        stack: err.stack,
        code: (err as NodeJS.ErrnoException).code
      });
    });

    this.redisConnection.on('close', () => {
      this.log.warn('🔴 BullMQ IORedis: close event (connection closed)');
    });

    this.redisConnection.on('reconnecting', (timeToReconnect: number) => {
      this.log.warn('🔄 BullMQ IORedis: reconnecting...', { timeToReconnect });
    });

    this.redisConnection.on('end', () => {
      this.log.warn('🛑 BullMQ IORedis: end event (no more reconnections)');
    });

    // Create promise that resolves when Redis is ready
    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout for BullMQ (10s)'));
      }, 10000);

      this.redisConnection.once('ready', () => {
        clearTimeout(timeout);
        this.isReady = true;
        this.log.info('✅ BullMQ Redis connection ready');

        // Initialize queues/workers AFTER Redis is ready
        this.initializeQueues();
        this.initializeWorkers();
        this.setupEventListeners();
        this.log.info('MessageQueue initialized with BullMQ', {
          queues: Array.from(this.queues.keys()),
          workers: Array.from(this.workers.keys()),
        });

        resolve();
      });

      this.redisConnection.once('error', (error) => {
        this.log.error('❌ BullMQ Redis connection error during initialization', {
          error: error.message,
          stack: error.stack
        });
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Get singleton instance with optional dependency injection
   *
   * @param dependencies - Optional dependencies (only used when creating new instance)
   */
  public static getInstance(dependencies?: IMessageQueueDependencies): MessageQueue {
    if (!MessageQueue.instance) {
      MessageQueue.instance = new MessageQueue(dependencies);
    }
    return MessageQueue.instance;
  }

  /**
   * Reset singleton instance for testing
   *
   * @internal Only for integration tests - DO NOT use in production
   */
  public static async __resetInstance(): Promise<void> {
    if (MessageQueue.instance) {
      await MessageQueue.instance.close();
    }
    MessageQueue.instance = null;
  }

  /**
   * Wait for MessageQueue to be ready
   *
   * MUST be called before using any queue methods to ensure Redis connection is established.
   * This method is idempotent and safe to call multiple times.
   *
   * @throws Error if Redis connection fails or times out
   */
  public async waitForReady(): Promise<void> {
    // Check if already ready (uses this.isReady)
    if (this.isReady) {
      return; // Already ready
    }

    this.log.debug('Waiting for MessageQueue to be ready...');
    // Wait for Redis connection (uses this.readyPromise)
    await this.readyPromise;
    this.log.debug('MessageQueue is ready');
  }

  /**
   * Check if MessageQueue is ready (for testing/debugging)
   */
  public getReadyStatus(): boolean {
    return this.isReady;
  }

  /**
   * Get Redis connection configuration for BullMQ components.
   *
   * BullMQ will create independent connections from this config,
   * avoiding shared connection reference issues during cleanup.
   *
   * Extracts configuration from the existing connection to ensure
   * test and production environments use consistent settings.
   *
   * @returns Redis connection configuration object
   */
  private getRedisConnectionConfig(): RedisOptions {
    // Extract configuration from existing IORedis connection
    const options = this.redisConnection.options;

    return {
      host: options.host || 'localhost',
      port: options.port || 6379,
      password: options.password,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: true,
      // Copy TLS settings from existing connection
      tls: options.tls ? {
        rejectUnauthorized: typeof options.tls === 'object' ? options.tls.rejectUnauthorized : true,
      } : undefined,
      // Reconnection strategy (same as main connection)
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        if (targetErrors.some((targetError) => err.message.includes(targetError))) {
          this.log.warn('Redis reconnecting due to error', { error: err.message });
          return true;
        }
        return false;
      },
      // Retry strategy with exponential backoff
      retryStrategy: (times) => {
        if (times > 10) {
          this.log.error('Redis max retry attempts reached (10)', { attempts: times });
          return null;
        }
        const delay = Math.min(times * 100, 3200);
        this.log.info('Redis retry attempt', { attempt: times, delayMs: delay });
        return delay;
      },
    };
  }

  /**
   * Initialize all queues
   */
  private initializeQueues(): void {
    // Message Persistence Queue
    this.queues.set(
      QueueName.MESSAGE_PERSISTENCE,
      new Queue(QueueName.MESSAGE_PERSISTENCE, {
        connection: this.getRedisConnectionConfig(),
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
        connection: this.getRedisConnectionConfig(),
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
        connection: this.getRedisConnectionConfig(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 500,
          },
        },
      })
    );

    this.log.info('All queues initialized', {
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
          connection: this.getRedisConnectionConfig(),
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
          connection: this.getRedisConnectionConfig(),
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
          connection: this.getRedisConnectionConfig(),
          concurrency: 10,
        }
      )
    );

    this.log.info('All workers initialized', {
      workers: Array.from(this.workers.keys()),
    });
  }

  /**
   * Setup event listeners for monitoring
   */
  private setupEventListeners(): void {
    Object.values(QueueName).forEach((queueName) => {
      const queueEvents = new QueueEvents(queueName, {
        connection: this.getRedisConnectionConfig(),
      });

      this.queueEvents.set(queueName, queueEvents);

      queueEvents.on('completed', ({ jobId }) => {
        this.log.debug(`Job completed in ${queueName}`, { jobId });
      });

      queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.log.error(`Job failed in ${queueName}`, { jobId, failedReason });
      });

      queueEvents.on('stalled', ({ jobId }) => {
        this.log.warn(`Job stalled in ${queueName}`, { jobId });
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
        this.log.warn('Rate limit exceeded for session', {
          sessionId,
          count,
          limit: MessageQueue.MAX_JOBS_PER_SESSION,
        });
      }

      return withinLimit;
    } catch (error) {
      this.log.error('Failed to check rate limit', { error, sessionId });
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
    // ⭐ CRITICAL: Wait for Redis connection to be ready
    await this.waitForReady();

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

    // ⭐ DIAGNOSTIC: Enhanced logging
    this.log.info('✅ Message job enqueued to BullMQ', {
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
   *
   * @param data - Tool execution data
   * @returns Job ID
   */
  public async addToolExecution(data: ToolExecutionJob): Promise<string> {
    // ⭐ CRITICAL: Wait for Redis connection to be ready
    await this.waitForReady();

    const queue = this.queues.get(QueueName.TOOL_EXECUTION);
    if (!queue) {
      throw new Error('Tool execution queue not initialized');
    }

    const job = await queue.add('execute-tool', data, {
      priority: 2,
    });

    this.log.debug('Tool execution added to queue', {
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
    // ⭐ CRITICAL: Wait for Redis connection to be ready
    await this.waitForReady();

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
    const {
      sessionId, messageId, role, messageType, content, metadata,
      sequenceNumber, eventId, toolUseId, stopReason,
      // ⭐ PHASE 1A: Token tracking fields
      model, inputTokens, outputTokens,
      // Note: thinkingTokens removed per Option A (2025-11-24)
    } = job.data;

    // ⭐ VALIDATION: Check for undefined messageId
    if (!messageId || messageId === 'undefined' || messageId.trim() === '') {
      this.log.error('❌ processMessagePersistence: Invalid messageId', {
        jobId: job.id,
        messageId,
        sessionId,
        role,
        messageType,
        metadata,
      });
      throw new Error(`Invalid messageId: ${messageId}. Cannot persist message.`);
    }

    // ⭐ DIAGNOSTIC: Log worker pickup with token info
    this.log.info('🔨 Worker picked up message persistence job', {
      jobId: job.id,
      messageId,
      sessionId,
      role,
      messageType,
      contentLength: content?.length || 0,
      hasSequenceNumber: !!sequenceNumber,
      sequenceNumber,
      hasEventId: !!eventId,
      hasToolUseId: !!toolUseId,
      toolUseId,
      // ⭐ PHASE 1A: Log token data
      model,
      inputTokens,
      outputTokens,
      // Note: thinkingTokens removed from DB per Option A (2025-11-24)
      attemptNumber: job.attemptsMade,
    });

    try {
      // ⭐ FIX: Use toolUseId from job data directly (fallback to metadata for backwards compat)
      const finalToolUseId: string | null = toolUseId || (typeof metadata?.tool_use_id === 'string' ? metadata.tool_use_id : null);

      // ⭐ PHASE 1A: Calculate total tokens if input and output are provided
      const totalTokens = (inputTokens !== undefined && outputTokens !== undefined)
        ? inputTokens + outputTokens
        : null;

      const params: SqlParams = {
        id: messageId,
        session_id: sessionId,
        role,
        message_type: messageType,
        content,
        metadata: metadata ? JSON.stringify(metadata) : '{}',
        // ⭐ CRITICAL: Include sequence_number and event_id
        sequence_number: sequenceNumber ?? null,
        event_id: eventId ?? null,
        // ⭐ PHASE 1A: Token tracking - use total_tokens for legacy column, add new columns
        token_count: totalTokens,
        stop_reason: stopReason ?? null,
        tool_use_id: finalToolUseId as string | null,
        created_at: new Date(),
        // ⭐ PHASE 1A: New token tracking columns
        model: model ?? null,
        input_tokens: inputTokens ?? null,
        output_tokens: outputTokens ?? null,
        // Note: thinking_tokens removed per Option A (2025-11-24)
        // SDK doesn't provide thinking_tokens separately (included in output_tokens)
      };

      // ⭐ UPDATED 2025-11-24: Removed thinking_tokens column per Option A
      await this.executeQueryFn(
        `
        INSERT INTO messages (id, session_id, role, message_type, content, metadata, sequence_number, event_id, token_count, stop_reason, tool_use_id, created_at, model, input_tokens, output_tokens)
        VALUES (@id, @session_id, @role, @message_type, @content, @metadata, @sequence_number, @event_id, @token_count, @stop_reason, @tool_use_id, @created_at, @model, @input_tokens, @output_tokens)
        `,
        params
      );

      // ⭐ DIAGNOSTIC: Enhanced success logging
      this.log.info('✅ Message persisted to database successfully', {
        jobId: job.id,
        messageId,
        sessionId,
        messageType,
        role,
        contentLength: content?.length || 0,
        hasSequenceNumber: !!sequenceNumber,
        sequenceNumber,
        hasEventId: !!eventId,
        eventId,
      });
    } catch (error) {
      this.log.error('❌ Failed to persist message to database', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        messageId,
        sessionId,
        messageType,
        sequenceNumber,
        eventId,
        attemptNumber: job.attemptsMade,
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

    this.log.info('Processing tool execution', {
      jobId: job.id,
      toolName,
      toolUseId,
      sessionId,
    });

    // TODO: Implement actual tool execution logic
    // This would call DirectAgentService.executeMCPTool() or similar

    this.log.debug('Tool execution completed', {
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

    this.log.debug('Processing event', {
      jobId: job.id,
      eventId,
      eventType,
      sessionId,
    });

    // Mark event as processed in EventStore (use injected dependency)
    const eventStore = this.eventStoreGetter();
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
      this.log.error('Failed to get rate limit status', { error, sessionId });
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
    this.log.info(`Queue ${queueName} paused`);
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
    this.log.info(`Queue ${queueName} resumed`);
  }

  /**
   * Close all queues and workers
   *
   * Graceful shutdown with sequential close pattern to avoid IORedis race conditions.
   * Closes components in phases to ensure each connection completes before the next begins.
   *
   * @see US-004 Phase 2: Sequential Close Pattern eliminates "Connection is closed" errors
   */
  public async close(): Promise<void> {
    this.log.info('Initiating MessageQueue shutdown with sequential close...');

    // ===== PHASE 1: CLOSE WORKERS SEQUENTIALLY (One at a time) =====
    this.log.debug('Phase 1: Closing workers sequentially');
    for (const [name, worker] of this.workers.entries()) {
      try {
        this.log.debug('Closing worker...', { worker: name });
        await worker.close(); // ✅ SEQUENTIAL - wait for each to finish
        this.log.debug('Worker closed', { worker: name });
        // Delay between each worker to allow connection cleanup
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        this.log.warn('Error closing worker', { err, worker: name });
      }
    }
    this.log.debug('All workers closed, waiting for connection cleanup (500ms)');
    await new Promise(resolve => setTimeout(resolve, 500));

    // ===== PHASE 2: CLOSE QUEUE EVENTS (After workers are stable) =====
    this.log.debug('Phase 2: Closing queue events');
    for (const [name, events] of this.queueEvents.entries()) {
      try {
        this.log.debug('Closing queue events...', { queue: name });
        await events.close(); // ✅ SEQUENTIAL
        this.log.debug('Queue events closed', { queue: name });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        this.log.warn('Error closing queue events', { err, queue: name });
      }
    }
    this.log.debug('All queue events closed, waiting for connection cleanup (500ms)');
    await new Promise(resolve => setTimeout(resolve, 500));

    // ===== PHASE 3: CLOSE QUEUES (After events) =====
    this.log.debug('Phase 3: Closing queues');
    for (const [name, queue] of this.queues.entries()) {
      try {
        this.log.debug('Closing queue...', { queue: name });
        await queue.close(); // ✅ SEQUENTIAL
        this.log.debug('Queue closed', { queue: name });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        this.log.warn('Error closing queue', { err, queue: name });
      }
    }

    // ===== CLEAR REFERENCES (After all components closed) =====
    this.log.debug('Clearing component references');
    this.workers.clear();
    this.queueEvents.clear();
    this.queues.clear();

    // ===== PHASE 4: WAIT FOR FINAL SOCKET CLEANUP =====
    this.log.debug('Phase 4: Waiting for final IORedis socket cleanup (1000ms)');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ===== PHASE 5: CLOSE MAIN REDIS CONNECTION (Last, only if we own it) =====
    if (this.ownsRedisConnection) {
      try {
        this.log.debug('Phase 5: Closing main Redis connection');
        await this.redisConnection.quit();
        this.log.debug('Main Redis connection closed');
      } catch (err) {
        this.log.warn('Error closing main Redis connection', { err });
      }
    } else {
      this.log.debug('Phase 5: Skipping main Redis close (injected connection)');
    }

    // ===== FINALIZATION =====
    this.isReady = false;
    this.log.info('✅ MessageQueue closed successfully (sequential pattern)');
  }
}

/**
 * Get MessageQueue singleton instance
 *
 * @param dependencies - Optional dependencies for DI (only used on first call)
 */
export function getMessageQueue(dependencies?: IMessageQueueDependencies): MessageQueue {
  return MessageQueue.getInstance(dependencies);
}

/**
 * Reset MessageQueue singleton for testing
 *
 * Closes the current instance (if any) and clears the singleton.
 * Allows tests to create fresh instances with different dependencies.
 *
 * @internal Only for integration tests - DO NOT use in production
 */
export async function __resetMessageQueue(): Promise<void> {
  await MessageQueue.__resetInstance();
}
