/**
 * MaintenanceWorker (PRD-05, PRD-300)
 *
 * Processes the FILE_MAINTENANCE queue. Routes jobs to the appropriate
 * maintenance service based on job name:
 *
 * - orphan-cleanup         → OrphanCleanupService
 * - batch-timeout          → BatchTimeoutService
 * - sync-health-check      → SyncHealthCheckService  (PRD-300)
 * - sync-reconciliation    → SyncReconciliationService (PRD-300)
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { JOB_NAMES } from '../constants';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';

export interface MaintenanceJobData {
  type: string;
}

export interface MaintenanceWorkerDeps {
  logger?: ILoggerMinimal;
}

export class MaintenanceWorker {
  private readonly log: ILoggerMinimal;

  constructor(deps?: MaintenanceWorkerDeps) {
    this.log = deps?.logger ?? createChildLogger({ service: 'MaintenanceWorker' });
  }

  async process(job: Job<MaintenanceJobData>): Promise<void> {
    const jobLog = this.log.child?.({ jobId: job.id, jobName: job.name }) ?? this.log;
    jobLog.info({ type: job.data?.type }, 'Processing maintenance job');

    const jobName = job.name;

    switch (jobName) {
      case JOB_NAMES.FILE_MAINTENANCE.ORPHAN_CLEANUP: {
        const { getOrphanCleanupService } = await import(
          '@/domains/files/cleanup/OrphanCleanupService'
        );
        const service = getOrphanCleanupService();
        const metrics = await service.run();
        jobLog.info({ metrics }, 'Orphan cleanup completed');
        break;
      }

      case JOB_NAMES.FILE_MAINTENANCE.BATCH_TIMEOUT: {
        const { getBatchTimeoutService } = await import(
          '@/domains/files/cleanup/BatchTimeoutService'
        );
        const service = getBatchTimeoutService();
        const metrics = await service.run();
        jobLog.info({ metrics }, 'Batch timeout processing completed');
        break;
      }

      case JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK: {
        const { getSyncHealthCheckService } = await import(
          '@/services/sync/health/SyncHealthCheckService'
        );
        const service = getSyncHealthCheckService();
        const metrics = await service.run();
        jobLog.info({ metrics }, 'Sync health check completed');
        break;
      }

      case JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION: {
        const { getSyncReconciliationService } = await import(
          '@/services/sync/health/SyncReconciliationService'
        );
        const service = getSyncReconciliationService();
        const reports = await service.run();
        jobLog.info({ reportCount: reports.length }, 'Sync reconciliation completed');
        break;
      }

      default:
        jobLog.warn({ jobName }, 'Unknown maintenance job type');
    }
  }
}

// Singleton
let instance: MaintenanceWorker | undefined;

export function getMaintenanceWorker(deps?: MaintenanceWorkerDeps): MaintenanceWorker {
  if (!instance) {
    instance = new MaintenanceWorker(deps);
  }
  return instance;
}

export function __resetMaintenanceWorker(): void {
  instance = undefined;
}
