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
 * Graceful Shutdown:
 * - Follows BullMQ official pattern (docs.bullmq.io/guide/workers/graceful-shutdown)
 * - Workers close first (drain active jobs), then queues, then Redis
 * - Production: Called from server.ts gracefulShutdown()
 * - Tests: Must close injected Redis connections explicitly
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
  USAGE_AGGREGATION = 'usage-aggregation',
  FILE_PROCESSING = 'file-processing',
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
 * Usage Aggregation Job Data
 *
 * Used by background workers for:
 * - Hourly/daily/monthly aggregation
 * - Monthly invoice generation
 * - Quota reset processing
 */
export interface UsageAggregationJob {
  type: 'hourly' | 'daily' | 'monthly' | 'monthly-invoices' | 'quota-reset';
  userId?: string;  // Optional: process specific user, or all users if omitted
  periodStart?: string;  // ISO 8601 date string
  force?: boolean;  // Force re-aggregation even if already exists
}

/**
 * File Processing Job Data
 *
 * Used by background workers for document text extraction:
 * - PDF (Azure Document Intelligence with OCR)
 * - DOCX (mammoth.js)
 * - XLSX (xlsx library)
 * - Plain text (txt, csv, md)
 */
export interface FileProcessingJob {
  /** File ID from database */
  fileId: string;
  /** User ID for multi-tenant isolation */
  userId: string;
  /** Session ID for WebSocket events (optional) */
  sessionId?: string;
  /** MIME type to determine processor */
  mimeType: string;
  /** Azure Blob path for downloading */
  blobPath: string;
  /** Original filename for logging */
  fileName: string;
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

      this.redisConnection.once('ready', async () => {
        clearTimeout(timeout);
        this.isReady = true;
        this.log.info('✅ BullMQ Redis connection ready');

        // Initialize queues/workers AFTER Redis is ready
        this.initializeQueues();
        this.initializeWorkers();
        this.setupEventListeners();
        await this.initializeScheduledJobs();
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

    // Usage Aggregation Queue (low concurrency - batch processing)
    this.queues.set(
      QueueName.USAGE_AGGREGATION,
      new Queue(QueueName.USAGE_AGGREGATION, {
        connection: this.getRedisConnectionConfig(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,  // Start with 5s for aggregation jobs
          },
          removeOnComplete: {
            count: 50,
            age: 3600,  // 1 hour
          },
          removeOnFail: {
            count: 100,
            age: 86400,  // 24 hours
          },
        },
      })
    );

    // File Processing Queue (limited concurrency for Azure DI API)
    this.queues.set(
      QueueName.FILE_PROCESSING,
      new Queue(QueueName.FILE_PROCESSING, {
        connection: this.getRedisConnectionConfig(),
        defaultJobOptions: {
          attempts: 2,  // External API calls - limited retries
          backoff: {
            type: 'exponential',
            delay: 5000,  // Start with 5s for external API retries
          },
          removeOnComplete: {
            count: 100,
            age: 3600,  // 1 hour
          },
          removeOnFail: {
            count: 200,
            age: 86400,  // 24 hours
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

    // Usage Aggregation Worker (concurrency: 1 - sequential batch processing)
    this.workers.set(
      QueueName.USAGE_AGGREGATION,
      new Worker(
        QueueName.USAGE_AGGREGATION,
        async (job: Job<UsageAggregationJob>) => {
          return this.processUsageAggregation(job);
        },
        {
          connection: this.getRedisConnectionConfig(),
          concurrency: 1,  // Process one aggregation job at a time
        }
      )
    );

    // File Processing Worker (concurrency: 3 - limited for Azure DI API)
    this.workers.set(
      QueueName.FILE_PROCESSING,
      new Worker(
        QueueName.FILE_PROCESSING,
        async (job: Job<FileProcessingJob>) => {
          return this.processFileProcessingJob(job);
        },
        {
          connection: this.getRedisConnectionConfig(),
          concurrency: 3,  // Limited concurrency for external API calls
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
   * Initialize Scheduled Jobs for Usage Aggregation
   *
   * Sets up recurring jobs for:
   * - Hourly aggregation: Every hour at :05
   * - Daily aggregation: Every day at 00:15 UTC
   * - Monthly invoices: 1st of month at 00:30 UTC
   * - Quota reset: Every day at 00:10 UTC
   */
  private async initializeScheduledJobs(): Promise<void> {
    const queue = this.queues.get(QueueName.USAGE_AGGREGATION);
    if (!queue) {
      this.log.warn('Usage aggregation queue not available for scheduled jobs');
      return;
    }

    try {
      // Remove any existing repeatable jobs first (prevents duplicates on restart)
      const existingJobs = await queue.getRepeatableJobs();
      for (const job of existingJobs) {
        await queue.removeRepeatableByKey(job.key);
      }

      // Hourly aggregation (every hour at :05)
      await queue.add(
        'scheduled-hourly-aggregation',
        { type: 'hourly' as const },
        {
          repeat: { pattern: '5 * * * *' },
          jobId: 'scheduled-hourly-aggregation',
        }
      );

      // Daily aggregation (every day at 00:15 UTC)
      await queue.add(
        'scheduled-daily-aggregation',
        { type: 'daily' as const },
        {
          repeat: { pattern: '15 0 * * *' },
          jobId: 'scheduled-daily-aggregation',
        }
      );

      // Monthly invoice generation (1st of month at 00:30 UTC)
      await queue.add(
        'scheduled-monthly-invoices',
        { type: 'monthly-invoices' as const },
        {
          repeat: { pattern: '30 0 1 * *' },
          jobId: 'scheduled-monthly-invoices',
        }
      );

      // Quota reset check (every day at 00:10 UTC)
      await queue.add(
        'scheduled-quota-reset',
        { type: 'quota-reset' as const },
        {
          repeat: { pattern: '10 0 * * *' },
          jobId: 'scheduled-quota-reset',
        }
      );

      this.log.info('Scheduled jobs initialized for usage aggregation', {
        jobs: ['hourly-aggregation', 'daily-aggregation', 'monthly-invoices', 'quota-reset'],
      });
    } catch (error) {
      this.log.error('Failed to initialize scheduled jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - scheduled jobs are optional, queue can still work for manual jobs
    }
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
   * Add Usage Aggregation Job to Queue
   *
   * @param data - Aggregation job data
   * @returns Job ID
   */
  public async addUsageAggregationJob(
    data: UsageAggregationJob
  ): Promise<string> {
    await this.waitForReady();

    const queue = this.queues.get(QueueName.USAGE_AGGREGATION);
    if (!queue) {
      throw new Error('Usage aggregation queue not initialized');
    }

    const job = await queue.add(`aggregation-${data.type}`, data, {
      priority: 5,  // Lower priority than message persistence
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
   *
   * Enqueues a file for background text extraction. Rate limited per user
   * to prevent queue saturation in multi-tenant environment.
   *
   * @param data - File processing job data
   * @returns Job ID
   * @throws Error if rate limit exceeded
   */
  public async addFileProcessingJob(
    data: FileProcessingJob
  ): Promise<string> {
    // Wait for Redis connection to be ready
    await this.waitForReady();

    const queue = this.queues.get(QueueName.FILE_PROCESSING);
    if (!queue) {
      throw new Error('File processing queue not initialized');
    }

    // Check rate limit (per user, not per session)
    const withinLimit = await this.checkRateLimit(`file:${data.userId}`);
    if (!withinLimit) {
      throw new Error(
        `Rate limit exceeded for user ${data.userId}. Max ${MessageQueue.MAX_JOBS_PER_SESSION} file processing jobs per hour.`
      );
    }

    const job = await queue.add('process-file', data, {
      priority: 3,  // Lower priority than message persistence, higher than aggregation
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

    this.log.error('Tool execution queue not implemented', {
      jobId: job.id,
      toolName,
      toolUseId,
      sessionId,
    });

    // Feature not implemented - tool execution happens synchronously in DirectAgentService
    // This queue worker exists for future async tool execution support
    throw new Error(
      'Tool execution queue is not implemented. ' +
      'Tools are executed synchronously in DirectAgentService.executeMCPTool(). ' +
      'This worker should not be called in production.'
    );
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
   * Process Usage Aggregation Job
   *
   * Routes aggregation jobs to the appropriate service methods.
   * Supports hourly/daily/monthly aggregation, invoice generation, and quota resets.
   *
   * @param job - BullMQ job containing aggregation type and parameters
   */
  private async processUsageAggregation(
    job: Job<UsageAggregationJob>
  ): Promise<void> {
    const { type, userId, periodStart } = job.data;

    this.log.info('Processing usage aggregation job', {
      jobId: job.id,
      type,
      userId: userId || 'all-users',
      periodStart,
      attemptNumber: job.attemptsMade,
    });

    try {
      // Dynamic import to avoid circular dependencies
      const { getUsageAggregationService } = await import('../tracking/UsageAggregationService');
      const { getBillingService } = await import('../billing');

      const aggregationService = getUsageAggregationService();
      const billingService = getBillingService();

      switch (type) {
        case 'hourly': {
          const hourStart = periodStart ? new Date(periodStart) : this.getLastHourStart();
          const count = await aggregationService.aggregateHourly(hourStart, userId);
          this.log.info('Hourly aggregation completed', { jobId: job.id, usersProcessed: count });
          break;
        }
        case 'daily': {
          const dayStart = periodStart ? new Date(periodStart) : this.getYesterdayStart();
          const count = await aggregationService.aggregateDaily(dayStart, userId);
          this.log.info('Daily aggregation completed', { jobId: job.id, usersProcessed: count });
          break;
        }
        case 'monthly': {
          const monthStart = periodStart ? new Date(periodStart) : this.getLastMonthStart();
          const count = await aggregationService.aggregateMonthly(monthStart, userId);
          this.log.info('Monthly aggregation completed', { jobId: job.id, usersProcessed: count });
          break;
        }
        case 'monthly-invoices': {
          const invoiceMonth = periodStart ? new Date(periodStart) : this.getLastMonthStart();
          const count = await billingService.generateAllMonthlyInvoices(invoiceMonth);
          this.log.info('Monthly invoices generated', { jobId: job.id, invoicesCreated: count });
          break;
        }
        case 'quota-reset': {
          const count = await aggregationService.resetExpiredQuotas();
          this.log.info('Expired quotas reset', { jobId: job.id, usersReset: count });
          break;
        }
        default:
          this.log.error('Unknown aggregation job type', { jobId: job.id, type });
          throw new Error(`Unknown aggregation job type: ${type}`);
      }
    } catch (error) {
      this.log.error('Usage aggregation job failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        type,
        userId,
        attemptNumber: job.attemptsMade,
      });
      throw error;  // Will trigger retry
    }
  }

  /**
   * Get the start of the last completed hour
   */
  private getLastHourStart(): Date {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() - 1);
    return now;
  }

  /**
   * Get the start of yesterday (UTC)
   */
  private getYesterdayStart(): Date {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    now.setUTCDate(now.getUTCDate() - 1);
    return now;
  }

  /**
   * Get the start of last month (UTC)
   */
  private getLastMonthStart(): Date {
    const now = new Date();
    now.setUTCDate(1);
    now.setUTCHours(0, 0, 0, 0);
    now.setUTCMonth(now.getUTCMonth() - 1);
    return now;
  }

  /**
   * Process File Processing Job
   *
   * Extracts text from uploaded documents using appropriate processors:
   * - PDF: Azure Document Intelligence with OCR
   * - DOCX: mammoth.js for Word documents
   * - XLSX: xlsx library for Excel files
   * - Plain text: Direct UTF-8 reading
   *
   * @param job - BullMQ job containing file processing data
   */
  private async processFileProcessingJob(
    job: Job<FileProcessingJob>
  ): Promise<void> {
    const { fileId, userId, sessionId: _sessionId, mimeType, fileName } = job.data;

    this.log.info('Processing file', {
      jobId: job.id,
      fileId,
      userId,
      mimeType,
      fileName,
      attemptNumber: job.attemptsMade,
    });

    try {
      // Dynamic import to avoid circular dependencies
      const { getFileProcessingService } = await import('../files/FileProcessingService');
      const fileProcessingService = getFileProcessingService();

      await fileProcessingService.processFile(job.data);

      this.log.info('File processing completed', {
        jobId: job.id,
        fileId,
        userId,
      });
    } catch (error) {
      this.log.error('File processing job failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        fileId,
        userId,
        mimeType,
        attemptNumber: job.attemptsMade,
      });
      throw error;  // Will trigger retry
    }
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
   * Close all queues and workers with proper BullMQ shutdown pattern
   *
   * BullMQ Best Practice Pattern:
   * 1. Close workers FIRST (stops accepting jobs, drains active jobs)
   * 2. Close queue events
   * 3. Close queues
   * 4. Close main Redis connection (only if owned)
   *
   * Key Principles:
   * - worker.close() marks worker as closing AND waits for active jobs to complete
   * - No artificial timeouts needed - worker.close() handles the wait
   * - Close workers sequentially to avoid connection race conditions
   * - Only close connections we created (check ownsRedisConnection flag)
   *
   * @see https://docs.bullmq.io/guide/workers/graceful-shutdown
   */
  public async close(): Promise<void> {
    this.log.info('Initiating MessageQueue graceful shutdown...');
    const errors: Error[] = [];

    // ===== PHASE 1: CLOSE WORKERS (Most Important - Do This First) =====
    this.log.debug('Phase 1: Closing workers...');
    for (const [name, worker] of this.workers.entries()) {
      try {
        this.log.debug(`Closing worker: ${name}`);
        // BullMQ Best Practice: worker.close() does TWO things:
        // 1. Marks worker as closing (no new jobs accepted)
        // 2. Waits for ALL active jobs to complete or fail
        // No timeout by default - jobs must finalize properly
        await worker.close();
        this.log.debug(`Worker closed successfully: ${name}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error(`Failed to close worker: ${name}`, { error: error.message });
        errors.push(error);
      }
    }

    // Small delay for BullMQ internal Redis connection cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    // ===== PHASE 2: CLOSE QUEUE EVENTS =====
    this.log.debug('Phase 2: Closing queue events...');
    for (const [name, events] of this.queueEvents.entries()) {
      try {
        this.log.debug(`Closing queue events: ${name}`);
        await events.close();
        this.log.debug(`Queue events closed: ${name}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error(`Failed to close queue events: ${name}`, { error: error.message });
        errors.push(error);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    // ===== PHASE 3: CLOSE QUEUES =====
    this.log.debug('Phase 3: Closing queues...');
    for (const [name, queue] of this.queues.entries()) {
      try {
        this.log.debug(`Closing queue: ${name}`);
        await queue.close();
        this.log.debug(`Queue closed: ${name}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error(`Failed to close queue: ${name}`, { error: error.message });
        errors.push(error);
      }
    }

    // ===== CLEAR REFERENCES =====
    this.workers.clear();
    this.queueEvents.clear();
    this.queues.clear();

    // ===== PHASE 4: CLOSE MAIN REDIS CONNECTION (Only if we own it) =====
    if (this.ownsRedisConnection) {
      try {
        this.log.debug('Phase 4: Closing main Redis connection (owned by MessageQueue)');
        await this.redisConnection.quit();
        this.log.debug('Main Redis connection closed');
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error('Failed to close main Redis connection', { error: error.message });
        errors.push(error);
      }
    } else {
      this.log.debug('Phase 4: Skipping main Redis close (injected connection - caller owns it)');
    }

    // ===== FINALIZATION =====
    this.isReady = false;

    if (errors.length > 0) {
      this.log.warn(`MessageQueue closed with ${errors.length} error(s)`, {
        errors: errors.map(e => e.message)
      });
      // Don't throw - allow graceful degradation
    } else {
      this.log.info('MessageQueue closed successfully');
    }
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
