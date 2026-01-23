/**
 * EventProcessingWorker
 *
 * Processes event jobs by marking them as processed in EventStore.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal, IEventStoreMinimal } from '../IMessageQueueDependencies';
import type { EventProcessingJob } from '../types';
import { getEventStore } from '@/services/events/EventStore';

/**
 * Dependencies for EventProcessingWorker
 */
export interface EventProcessingWorkerDependencies {
  logger?: ILoggerMinimal;
  eventStore?: IEventStoreMinimal;
}

/**
 * EventProcessingWorker
 */
export class EventProcessingWorker {
  private static instance: EventProcessingWorker | null = null;

  private readonly log: ILoggerMinimal;
  private readonly eventStoreGetter: () => IEventStoreMinimal;

  constructor(deps?: EventProcessingWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'EventProcessingWorker' });
    const eventStoreOverride = deps?.eventStore;
    this.eventStoreGetter = eventStoreOverride
      ? () => eventStoreOverride
      : () => getEventStore();
  }

  public static getInstance(deps?: EventProcessingWorkerDependencies): EventProcessingWorker {
    if (!EventProcessingWorker.instance) {
      EventProcessingWorker.instance = new EventProcessingWorker(deps);
    }
    return EventProcessingWorker.instance;
  }

  public static resetInstance(): void {
    EventProcessingWorker.instance = null;
  }

  /**
   * Process event job
   *
   * Marks the event as processed in EventStore.
   */
  async process(job: Job<EventProcessingJob>): Promise<void> {
    const { eventId, sessionId, eventType, userId, correlationId } = job.data;

    // Create job-scoped logger with user context and timestamp
    const jobLogger = this.log.child({
      userId,
      sessionId,
      eventId,
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
      correlationId,
      eventType,
    });

    jobLogger.debug('Processing event', {
      attemptsMade: job.attemptsMade,
    });

    // Mark event as processed in EventStore
    const eventStore = this.eventStoreGetter();
    await eventStore.markAsProcessed(eventId);
  }
}

/**
 * Get EventProcessingWorker singleton
 */
export function getEventProcessingWorker(deps?: EventProcessingWorkerDependencies): EventProcessingWorker {
  return EventProcessingWorker.getInstance(deps);
}

/**
 * Reset EventProcessingWorker singleton (for testing)
 */
export function __resetEventProcessingWorker(): void {
  EventProcessingWorker.resetInstance();
}
