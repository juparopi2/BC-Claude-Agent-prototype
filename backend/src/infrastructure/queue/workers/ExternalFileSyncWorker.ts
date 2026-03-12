/**
 * ExternalFileSyncWorker (PRD-108)
 *
 * Processes delta sync jobs triggered by webhooks, polling, or manual actions.
 * Delegates actual sync logic to DeltaSyncService.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { ExternalFileSyncJob } from '../types/jobs.types';

export class ExternalFileSyncWorker {
  private readonly log: ILoggerMinimal;

  constructor(deps?: { logger?: ILoggerMinimal }) {
    this.log = deps?.logger ?? createChildLogger({ service: 'ExternalFileSyncWorker' });
  }

  async process(job: Job<ExternalFileSyncJob>): Promise<void> {
    const { scopeId, connectionId, userId, triggerType } = job.data;

    this.log.info(
      { jobId: job.id, scopeId, connectionId, triggerType },
      triggerType === 'initial' ? 'Processing initial sync job' : 'Processing delta sync job'
    );

    try {
      if (triggerType === 'initial') {
        // PRD-116: Route initial sync to InitialSyncService
        const { getInitialSyncService } = await import('@/services/sync/InitialSyncService');
        await getInitialSyncService().syncScopeAsync(connectionId, scopeId, userId);
      } else {
        // Existing delta sync path
        const { getDeltaSyncService } = await import('@/services/sync/DeltaSyncService');
        const result = await getDeltaSyncService().syncDelta(connectionId, scopeId, userId, triggerType);

        this.log.info(
          {
            jobId: job.id,
            scopeId,
            connectionId,
            triggerType,
            ...result,
          },
          'Delta sync completed'
        );
      }
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };

      // Token expired — no point retrying; GraphTokenManager already marked connection as expired
      if (error instanceof Error && error.name === 'ConnectionTokenExpiredError') {
        this.log.warn(
          { jobId: job.id, scopeId, connectionId },
          'Token expired — skipping retry'
        );
        throw new UnrecoverableError(error.message);
      }

      this.log.error(
        { error: errorInfo, jobId: job.id, scopeId, connectionId, triggerType },
        'Delta sync job failed'
      );

      throw error; // Let BullMQ handle retry
    }
  }
}

// Singleton
let instance: ExternalFileSyncWorker | undefined;

export function getExternalFileSyncWorker(deps?: { logger?: ILoggerMinimal }): ExternalFileSyncWorker {
  if (!instance) {
    instance = new ExternalFileSyncWorker(deps);
  }
  return instance;
}

export function __resetExternalFileSyncWorker(): void {
  instance = undefined;
}
