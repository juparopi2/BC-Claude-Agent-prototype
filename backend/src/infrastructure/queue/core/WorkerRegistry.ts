/**
 * WorkerRegistry
 *
 * Manages BullMQ worker registration and lifecycle.
 * Workers are created with configured concurrency and process jobs.
 *
 * @module infrastructure/queue/core
 */

import { Worker, type Processor, type RedisOptions } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import { QueueName, DEFAULT_CONCURRENCY, LOCK_CONFIG, type ExtendedLockConfig } from '../constants';
import { env } from '@/infrastructure/config';
import { FILE_DELETION_CONFIG, FILE_BULK_UPLOAD_CONFIG } from '@bc-agent/shared';

/**
 * Dependencies for WorkerRegistry
 */
export interface WorkerRegistryDependencies {
  /** Redis connection config */
  redisConfig: RedisOptions;
  /** Function to get prefixed queue name */
  getQueueName: (name: QueueName) => string;
  logger?: ILoggerMinimal;
}

/**
 * Worker configuration
 */
export interface WorkerConfig {
  name: QueueName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: Processor<any, any, string>;
  concurrency?: number;
}

/**
 * WorkerRegistry - BullMQ worker management
 */
export class WorkerRegistry {
  private readonly workers: Map<QueueName, Worker> = new Map();
  private readonly log: ILoggerMinimal;
  private readonly redisConfig: RedisOptions;
  private readonly getQueueName: (name: QueueName) => string;

  constructor(deps: WorkerRegistryDependencies) {
    this.redisConfig = deps.redisConfig;
    this.getQueueName = deps.getQueueName;
    this.log = deps.logger ?? createChildLogger({ service: 'WorkerRegistry' });
  }

  /**
   * Register a worker for a queue
   *
   * Configures lock duration and stalled count per queue type to prevent
   * false stall detection for long-running operations (e.g., OCR, large PDFs).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerWorker(name: QueueName, processor: Processor<any, any, string>, concurrency?: number): void {
    const resolvedConcurrency = this.resolveConcurrency(name, concurrency);
    const lockConfig = this.getLockConfig(name);

    const worker = new Worker(
      this.getQueueName(name),
      processor,
      {
        connection: this.redisConfig,
        concurrency: resolvedConcurrency,
        lockDuration: lockConfig.lockDuration,
        maxStalledCount: lockConfig.maxStalledCount,
        // Pass explicit lockRenewTime and stalledInterval if configured
        ...(lockConfig.lockRenewTime && { lockRenewTime: lockConfig.lockRenewTime }),
        ...(lockConfig.stalledInterval && { stalledInterval: lockConfig.stalledInterval }),
      }
    );

    this.workers.set(name, worker);
    this.log.info(`Worker registered: ${name}`, {
      concurrency: resolvedConcurrency,
      lockDuration: lockConfig.lockDuration,
      maxStalledCount: lockConfig.maxStalledCount,
      lockRenewTime: lockConfig.lockRenewTime ?? 'default',
      stalledInterval: lockConfig.stalledInterval ?? 'default',
    });
  }

  /**
   * Get lock configuration for a queue
   *
   * Returns lock duration, max stalled count, and optional lockRenewTime/stalledInterval
   * based on queue type. File operations get longer locks due to variable processing times.
   */
  private getLockConfig(name: QueueName): ExtendedLockConfig {
    return LOCK_CONFIG[name];
  }

  /**
   * Resolve concurrency for a queue (env var > explicit > default)
   */
  private resolveConcurrency(name: QueueName, explicit?: number): number {
    // Check environment variable first
    const envConcurrency = this.getEnvConcurrency(name);
    if (envConcurrency !== undefined) {
      return envConcurrency;
    }

    // Use explicit value if provided
    if (explicit !== undefined) {
      return explicit;
    }

    // Fall back to defaults
    return this.getDefaultConcurrency(name);
  }

  /**
   * Get concurrency from environment variable
   */
  private getEnvConcurrency(name: QueueName): number | undefined {
    const envMap: Partial<Record<QueueName, number | undefined>> = {
      [QueueName.MESSAGE_PERSISTENCE]: env.QUEUE_MESSAGE_CONCURRENCY,
      [QueueName.TOOL_EXECUTION]: env.QUEUE_TOOL_CONCURRENCY,
      [QueueName.EVENT_PROCESSING]: env.QUEUE_EVENT_CONCURRENCY,
      [QueueName.USAGE_AGGREGATION]: env.QUEUE_USAGE_CONCURRENCY,
      [QueueName.FILE_PROCESSING]: env.QUEUE_FILE_PROCESSING_CONCURRENCY,
      [QueueName.FILE_CHUNKING]: env.QUEUE_FILE_CHUNKING_CONCURRENCY,
      [QueueName.EMBEDDING_GENERATION]: env.QUEUE_EMBEDDING_CONCURRENCY,
      [QueueName.CITATION_PERSISTENCE]: env.QUEUE_CITATION_CONCURRENCY,
      [QueueName.FILE_BULK_UPLOAD]: env.QUEUE_FILE_BULK_UPLOAD_CONCURRENCY,
    };
    return envMap[name];
  }

  /**
   * Get default concurrency for a queue
   */
  private getDefaultConcurrency(name: QueueName): number {
    switch (name) {
      case QueueName.MESSAGE_PERSISTENCE:
        return DEFAULT_CONCURRENCY.MESSAGE_PERSISTENCE;
      case QueueName.TOOL_EXECUTION:
        return DEFAULT_CONCURRENCY.TOOL_EXECUTION;
      case QueueName.EVENT_PROCESSING:
        return DEFAULT_CONCURRENCY.EVENT_PROCESSING;
      case QueueName.USAGE_AGGREGATION:
        return DEFAULT_CONCURRENCY.USAGE_AGGREGATION;
      case QueueName.FILE_PROCESSING:
        return DEFAULT_CONCURRENCY.FILE_PROCESSING;
      case QueueName.FILE_CHUNKING:
        return DEFAULT_CONCURRENCY.FILE_CHUNKING;
      case QueueName.EMBEDDING_GENERATION:
        return DEFAULT_CONCURRENCY.EMBEDDING_GENERATION;
      case QueueName.CITATION_PERSISTENCE:
        return DEFAULT_CONCURRENCY.CITATION_PERSISTENCE;
      case QueueName.FILE_CLEANUP:
        return DEFAULT_CONCURRENCY.FILE_CLEANUP;
      case QueueName.FILE_DELETION:
        return FILE_DELETION_CONFIG.QUEUE_CONCURRENCY;
      case QueueName.FILE_BULK_UPLOAD:
        return FILE_BULK_UPLOAD_CONFIG.QUEUE_CONCURRENCY;
      default:
        return 1;
    }
  }

  /**
   * Get a worker by queue name
   */
  getWorker(name: QueueName): Worker | undefined {
    return this.workers.get(name);
  }

  /**
   * Get all workers
   */
  getAllWorkers(): Map<QueueName, Worker> {
    return this.workers;
  }

  /**
   * Close all workers (graceful shutdown)
   *
   * BullMQ Best Practice: worker.close() does TWO things:
   * 1. Marks worker as closing (no new jobs accepted)
   * 2. Waits for ALL active jobs to complete or fail
   */
  async closeAll(): Promise<Error[]> {
    const errors: Error[] = [];

    for (const [name, worker] of this.workers.entries()) {
      try {
        this.log.debug(`Closing worker: ${name}`);
        await worker.close();
        this.log.debug(`Worker closed: ${name}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error(`Failed to close worker: ${name}`, { error: error.message });
        errors.push(error);
      }
    }

    this.workers.clear();
    return errors;
  }
}
