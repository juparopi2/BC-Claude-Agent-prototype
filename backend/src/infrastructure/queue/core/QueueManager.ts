/**
 * QueueManager
 *
 * Manages BullMQ queue creation and configuration.
 * Handles queue naming, prefixing, and default job options.
 *
 * @module infrastructure/queue/core
 */

import { Queue, type JobsOptions, type RedisOptions } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import {
  QueueName,
  DEFAULT_BACKOFF,
  JOB_RETENTION,
} from '../constants';
import {
  FILE_DELETION_CONFIG,
  FILE_BULK_UPLOAD_CONFIG,
} from '@bc-agent/shared';

/**
 * Dependencies for QueueManager
 */
export interface QueueManagerDependencies {
  /** Redis connection config (from RedisConnectionManager) */
  redisConfig: RedisOptions;
  logger?: ILoggerMinimal;
  /** Queue name prefix for test isolation */
  queueNamePrefix?: string;
}

/**
 * QueueManager - BullMQ queue creation and management
 */
export class QueueManager {
  private readonly queues: Map<QueueName, Queue> = new Map();
  private readonly log: ILoggerMinimal;
  private readonly redisConfig: RedisOptions;
  private readonly queueNamePrefix: string;

  constructor(deps: QueueManagerDependencies) {
    this.redisConfig = deps.redisConfig;
    this.log = deps.logger ?? createChildLogger({ service: 'QueueManager' });
    this.queueNamePrefix = deps.queueNamePrefix || '';
  }

  /**
   * Get prefixed queue name for test isolation
   *
   * In production, returns base name unchanged.
   * In tests with prefix, returns "prefix--baseName".
   */
  getQueueName(baseName: QueueName): string {
    // BullMQ doesn't allow ':' in queue names (reserved for Redis key namespacing)
    return this.queueNamePrefix
      ? `${this.queueNamePrefix}--${baseName}`
      : baseName;
  }

  /**
   * Initialize all queues
   */
  initializeQueues(): void {
    // Message Persistence Queue
    this.createQueue(QueueName.MESSAGE_PERSISTENCE, {
      attempts: DEFAULT_BACKOFF.MESSAGE_PERSISTENCE.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.MESSAGE_PERSISTENCE.type,
        delay: DEFAULT_BACKOFF.MESSAGE_PERSISTENCE.delay,
      },
      removeOnComplete: JOB_RETENTION.MESSAGE_PERSISTENCE.completed,
      removeOnFail: JOB_RETENTION.MESSAGE_PERSISTENCE.failed,
    });

    // Tool Execution Queue
    this.createQueue(QueueName.TOOL_EXECUTION, {
      attempts: DEFAULT_BACKOFF.TOOL_EXECUTION.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.TOOL_EXECUTION.type,
        delay: DEFAULT_BACKOFF.TOOL_EXECUTION.delay,
      },
    });

    // Event Processing Queue
    this.createQueue(QueueName.EVENT_PROCESSING, {
      attempts: DEFAULT_BACKOFF.EVENT_PROCESSING.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.EVENT_PROCESSING.type,
        delay: DEFAULT_BACKOFF.EVENT_PROCESSING.delay,
      },
    });

    // Usage Aggregation Queue
    this.createQueue(QueueName.USAGE_AGGREGATION, {
      attempts: DEFAULT_BACKOFF.USAGE_AGGREGATION.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.USAGE_AGGREGATION.type,
        delay: DEFAULT_BACKOFF.USAGE_AGGREGATION.delay,
      },
      removeOnComplete: JOB_RETENTION.USAGE_AGGREGATION.completed,
      removeOnFail: JOB_RETENTION.USAGE_AGGREGATION.failed,
    });

    // File Processing Queue
    this.createQueue(QueueName.FILE_PROCESSING, {
      attempts: DEFAULT_BACKOFF.FILE_PROCESSING.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.FILE_PROCESSING.type,
        delay: DEFAULT_BACKOFF.FILE_PROCESSING.delay,
      },
      removeOnComplete: JOB_RETENTION.DEFAULT.completed,
      removeOnFail: JOB_RETENTION.DEFAULT.failed,
    });

    // File Chunking Queue
    this.createQueue(QueueName.FILE_CHUNKING, {
      attempts: DEFAULT_BACKOFF.FILE_CHUNKING.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.FILE_CHUNKING.type,
        delay: DEFAULT_BACKOFF.FILE_CHUNKING.delay,
      },
      removeOnComplete: JOB_RETENTION.DEFAULT.completed,
      removeOnFail: JOB_RETENTION.DEFAULT.failed,
    });

    // Embedding Generation Queue
    this.createQueue(QueueName.EMBEDDING_GENERATION, {
      attempts: DEFAULT_BACKOFF.EMBEDDING_GENERATION.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.EMBEDDING_GENERATION.type,
        delay: DEFAULT_BACKOFF.EMBEDDING_GENERATION.delay,
      },
      removeOnComplete: JOB_RETENTION.DEFAULT.completed,
      removeOnFail: JOB_RETENTION.DEFAULT.failed,
    });

    // Citation Persistence Queue
    this.createQueue(QueueName.CITATION_PERSISTENCE, {
      attempts: DEFAULT_BACKOFF.CITATION_PERSISTENCE.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.CITATION_PERSISTENCE.type,
        delay: DEFAULT_BACKOFF.CITATION_PERSISTENCE.delay,
      },
      removeOnComplete: JOB_RETENTION.DEFAULT.completed,
      removeOnFail: JOB_RETENTION.DEFAULT.failed,
    });

    // File Cleanup Queue
    this.createQueue(QueueName.FILE_CLEANUP, {
      attempts: DEFAULT_BACKOFF.FILE_CLEANUP.attempts,
      backoff: {
        type: DEFAULT_BACKOFF.FILE_CLEANUP.type,
        delay: DEFAULT_BACKOFF.FILE_CLEANUP.delay,
      },
      removeOnComplete: JOB_RETENTION.FILE_CLEANUP.completed,
      removeOnFail: JOB_RETENTION.FILE_CLEANUP.failed,
    });

    // File Deletion Queue
    this.createQueue(QueueName.FILE_DELETION, {
      attempts: FILE_DELETION_CONFIG.MAX_RETRY_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: FILE_DELETION_CONFIG.RETRY_DELAY_MS,
      },
      removeOnComplete: JOB_RETENTION.DEFAULT.completed,
      removeOnFail: JOB_RETENTION.DEFAULT.failed,
    });

    // File Bulk Upload Queue
    this.createQueue(QueueName.FILE_BULK_UPLOAD, {
      attempts: FILE_BULK_UPLOAD_CONFIG.MAX_RETRY_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: FILE_BULK_UPLOAD_CONFIG.RETRY_DELAY_MS,
      },
      removeOnComplete: JOB_RETENTION.DEFAULT.completed,
      removeOnFail: JOB_RETENTION.DEFAULT.failed,
    });

    this.log.info('All queues initialized', {
      queues: Array.from(this.queues.keys()),
    });
  }

  /**
   * Create a queue with given options
   */
  private createQueue(name: QueueName, defaultJobOptions: JobsOptions): void {
    const queue = new Queue(this.getQueueName(name), {
      connection: this.redisConfig,
      defaultJobOptions,
    });
    this.queues.set(name, queue);
  }

  /**
   * Get a queue by name
   */
  getQueue(name: QueueName): Queue | undefined {
    return this.queues.get(name);
  }

  /**
   * Get all queues
   */
  getAllQueues(): Map<QueueName, Queue> {
    return this.queues;
  }

  /**
   * Close all queues
   */
  async closeAll(): Promise<Error[]> {
    const errors: Error[] = [];

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

    this.queues.clear();
    return errors;
  }
}
