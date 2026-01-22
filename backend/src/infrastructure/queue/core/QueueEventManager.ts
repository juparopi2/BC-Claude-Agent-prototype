/**
 * QueueEventManager
 *
 * Manages BullMQ QueueEvents for monitoring job lifecycle.
 * Handles failed, completed, and stalled job events.
 *
 * @module infrastructure/queue/core
 */

import { Queue, QueueEvents, type RedisOptions } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import { QueueName } from '../constants';
import { getJobFailureEventEmitter } from '@/domains/queue/emission';
import type { JobQueueName } from '@bc-agent/shared';

/**
 * Dependencies for QueueEventManager
 */
export interface QueueEventManagerDependencies {
  /** Redis connection config */
  redisConfig: RedisOptions;
  /** Function to get prefixed queue name */
  getQueueName: (name: QueueName) => string;
  /** Function to get a queue by name */
  getQueue: (name: QueueName) => Queue | undefined;
  logger?: ILoggerMinimal;
}

/**
 * Failed job handler callback type
 */
export interface FailedJobContext {
  jobId: string;
  failedReason: string;
  queueName: QueueName;
  userId?: string;
  sessionId?: string;
  fileId?: string;
  fileName?: string;
  attemptsMade: number;
  maxAttempts: number;
}

export type FailedJobHandler = (context: FailedJobContext) => Promise<void>;

/**
 * QueueEventManager - BullMQ event monitoring
 */
export class QueueEventManager {
  private readonly queueEvents: Map<QueueName, QueueEvents> = new Map();
  private readonly log: ILoggerMinimal;
  private readonly redisConfig: RedisOptions;
  private readonly getQueueName: (name: QueueName) => string;
  private readonly getQueue: (name: QueueName) => Queue | undefined;
  private failedJobHandler?: FailedJobHandler;

  constructor(deps: QueueEventManagerDependencies) {
    this.redisConfig = deps.redisConfig;
    this.getQueueName = deps.getQueueName;
    this.getQueue = deps.getQueue;
    this.log = deps.logger ?? createChildLogger({ service: 'QueueEventManager' });
  }

  /**
   * Set custom handler for failed jobs
   */
  setFailedJobHandler(handler: FailedJobHandler): void {
    this.failedJobHandler = handler;
  }

  /**
   * Initialize event listeners for all queues
   */
  initializeEventListeners(): void {
    Object.values(QueueName).forEach((queueName) => {
      this.setupQueueEvents(queueName as QueueName);
    });

    this.log.info('Queue event listeners initialized', {
      queues: Object.values(QueueName),
    });
  }

  /**
   * Setup event listeners for a specific queue
   */
  private setupQueueEvents(queueName: QueueName): void {
    const prefixedName = this.getQueueName(queueName);
    const queueEvents = new QueueEvents(prefixedName, {
      connection: this.redisConfig,
    });

    this.queueEvents.set(queueName, queueEvents);

    queueEvents.on('completed', ({ jobId }) => {
      this.log.debug(`Job completed in ${queueName}`, { jobId });
    });

    queueEvents.on('failed', async ({ jobId, failedReason }) => {
      await this.handleFailedJob(queueName, jobId, failedReason || 'No reason provided');
    });

    queueEvents.on('stalled', ({ jobId }) => {
      this.log.warn(`Job stalled in ${queueName}`, { jobId });
    });
  }

  /**
   * Handle failed job event
   */
  private async handleFailedJob(
    queueName: QueueName,
    jobId: string,
    failedReason: string
  ): Promise<void> {
    // Try to get job data for additional context
    let context: FailedJobContext = {
      jobId,
      failedReason,
      queueName,
      attemptsMade: 0,
      maxAttempts: 1,
    };

    try {
      const queue = this.getQueue(queueName);
      if (queue) {
        const failedJob = await queue.getJob(jobId);
        if (failedJob?.data) {
          context = {
            ...context,
            userId: failedJob.data.userId,
            sessionId: failedJob.data.sessionId,
            fileId: failedJob.data.fileId,
            fileName: failedJob.data.fileName,
            attemptsMade: failedJob.attemptsMade ?? 0,
            maxAttempts: failedJob.opts?.attempts ?? 1,
          };
        }
      }
    } catch {
      // Ignore errors when fetching job data
    }

    // Log the failure
    this.log.error({
      jobId,
      failedReason,
      queueName,
      ...context,
      timestamp: new Date().toISOString(),
    }, `Job failed in ${queueName}`);

    // Emit generic job failure notification
    if (context.userId) {
      this.emitJobFailureNotification(queueName, context);
    }

    // Call custom handler if set
    if (this.failedJobHandler) {
      try {
        await this.failedJobHandler(context);
      } catch (handlerError) {
        this.log.error({
          error: handlerError instanceof Error ? handlerError.message : String(handlerError),
          jobId,
          queueName,
        }, 'Failed job handler threw an error');
      }
    }
  }

  /**
   * Emit job failure notification via WebSocket
   */
  private emitJobFailureNotification(queueName: QueueName, context: FailedJobContext): void {
    try {
      const jobFailureEmitter = getJobFailureEventEmitter();
      const jobQueueName = this.mapQueueNameToJobQueueName(queueName);

      if (jobQueueName && context.userId) {
        const payload = jobFailureEmitter.createPayload(
          context.jobId,
          jobQueueName,
          context.failedReason,
          context.attemptsMade,
          context.maxAttempts,
          {
            fileId: context.fileId,
            fileName: context.fileName,
            sessionId: context.sessionId,
          }
        );

        jobFailureEmitter.emitJobFailed(
          { userId: context.userId, sessionId: context.sessionId },
          payload
        );

        this.log.debug({
          jobId: context.jobId,
          queueName,
          userId: context.userId,
        }, 'Emitted generic job failure notification');
      }
    } catch (emitError) {
      this.log.warn({
        error: emitError instanceof Error ? emitError.message : String(emitError),
        jobId: context.jobId,
        queueName,
      }, 'Failed to emit generic job failure notification');
    }
  }

  /**
   * Map internal QueueName to shared JobQueueName type
   */
  private mapQueueNameToJobQueueName(queueName: QueueName): JobQueueName | null {
    const mapping: Partial<Record<QueueName, JobQueueName>> = {
      [QueueName.FILE_PROCESSING]: 'file-processing',
      [QueueName.FILE_CHUNKING]: 'file-chunking',
      [QueueName.EMBEDDING_GENERATION]: 'embedding-generation',
      [QueueName.MESSAGE_PERSISTENCE]: 'message-persistence',
      [QueueName.TOOL_EXECUTION]: 'tool-execution',
      [QueueName.FILE_BULK_UPLOAD]: 'file-bulk-upload',
      [QueueName.FILE_DELETION]: 'file-deletion',
    };

    return mapping[queueName] ?? null;
  }

  /**
   * Get QueueEvents for a specific queue
   */
  getQueueEvents(name: QueueName): QueueEvents | undefined {
    return this.queueEvents.get(name);
  }

  /**
   * Close all queue events
   */
  async closeAll(): Promise<Error[]> {
    const errors: Error[] = [];

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

    this.queueEvents.clear();
    return errors;
  }
}
