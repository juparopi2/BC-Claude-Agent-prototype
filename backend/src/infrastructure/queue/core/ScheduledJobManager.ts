/**
 * ScheduledJobManager
 *
 * Manages cron-based scheduled jobs for background processing.
 * Handles duplicate prevention on restart and graceful job setup.
 *
 * @module infrastructure/queue/core
 */

import type { Queue } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import { QueueName, JOB_NAMES, CRON_PATTERNS } from '../constants';

/**
 * Dependencies for ScheduledJobManager
 */
export interface ScheduledJobManagerDependencies {
  /** Function to get a queue by name */
  getQueue: (name: QueueName) => Queue | undefined;
  logger?: ILoggerMinimal;
}

/**
 * ScheduledJobManager - Cron job scheduling
 */
export class ScheduledJobManager {
  private readonly log: ILoggerMinimal;
  private readonly getQueue: (name: QueueName) => Queue | undefined;

  constructor(deps: ScheduledJobManagerDependencies) {
    this.getQueue = deps.getQueue;
    this.log = deps.logger ?? createChildLogger({ service: 'ScheduledJobManager' });
  }

  /**
   * Initialize all scheduled jobs
   */
  async initializeScheduledJobs(): Promise<void> {
    await this.initializeUsageAggregationJobs();
    await this.initializeMaintenanceJobs();
    await this.initializeSyncJobs();
  }

  /**
   * Initialize usage aggregation scheduled jobs
   */
  private async initializeUsageAggregationJobs(): Promise<void> {
    const queue = this.getQueue(QueueName.USAGE_AGGREGATION);
    if (!queue) {
      this.log.warn('Usage aggregation queue not available for scheduled jobs');
      return;
    }

    try {
      // Remove existing repeatable jobs (prevents duplicates on restart)
      await this.removeExistingRepeatableJobs(queue);

      // Hourly aggregation (every hour at :05)
      await queue.add(
        JOB_NAMES.USAGE_AGGREGATION.HOURLY,
        { type: JOB_NAMES.USAGE_AGGREGATION.HOURLY },
        {
          repeat: { pattern: CRON_PATTERNS.HOURLY_AT_05 },
          jobId: JOB_NAMES.USAGE_AGGREGATION.HOURLY,
        }
      );

      // Daily aggregation (every day at 00:15 UTC)
      await queue.add(
        JOB_NAMES.USAGE_AGGREGATION.DAILY,
        { type: JOB_NAMES.USAGE_AGGREGATION.DAILY },
        {
          repeat: { pattern: CRON_PATTERNS.DAILY_AT_0015 },
          jobId: JOB_NAMES.USAGE_AGGREGATION.DAILY,
        }
      );

      // Monthly invoice generation (1st of month at 00:30 UTC)
      await queue.add(
        JOB_NAMES.USAGE_AGGREGATION.MONTHLY_INVOICES,
        { type: JOB_NAMES.USAGE_AGGREGATION.MONTHLY_INVOICES },
        {
          repeat: { pattern: CRON_PATTERNS.MONTHLY_1ST_AT_0030 },
          jobId: JOB_NAMES.USAGE_AGGREGATION.MONTHLY_INVOICES,
        }
      );

      // Quota reset check (every day at 00:10 UTC)
      await queue.add(
        JOB_NAMES.USAGE_AGGREGATION.QUOTA_RESET,
        { type: JOB_NAMES.USAGE_AGGREGATION.QUOTA_RESET },
        {
          repeat: { pattern: CRON_PATTERNS.DAILY_AT_0010 },
          jobId: JOB_NAMES.USAGE_AGGREGATION.QUOTA_RESET,
        }
      );

      this.log.info('Scheduled jobs initialized for usage aggregation', {
        jobs: [
          JOB_NAMES.USAGE_AGGREGATION.HOURLY,
          JOB_NAMES.USAGE_AGGREGATION.DAILY,
          JOB_NAMES.USAGE_AGGREGATION.MONTHLY_INVOICES,
          JOB_NAMES.USAGE_AGGREGATION.QUOTA_RESET,
        ],
      });
    } catch (error) {
      this.log.error('Failed to initialize usage aggregation scheduled jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - scheduled jobs are optional
    }
  }

  /**
   * Initialize maintenance scheduled jobs (PRD-05)
   *
   * Replaces the legacy FileCleanupWorker scheduled jobs.
   * OrphanCleanupService covers cleanup of failed files, orphaned chunks,
   * and orphaned search documents. StuckFileRecoveryService handles
   * recovery of stuck pipeline files.
   */
  private async initializeMaintenanceJobs(): Promise<void> {
    const queue = this.getQueue(QueueName.FILE_MAINTENANCE);
    if (!queue) {
      this.log.warn('File maintenance queue not available for scheduled jobs');
      return;
    }

    try {
      await this.removeExistingRepeatableJobs(queue);

      // Stuck file recovery (every 15 minutes)
      await queue.add(
        JOB_NAMES.FILE_MAINTENANCE.STUCK_FILE_RECOVERY,
        { type: JOB_NAMES.FILE_MAINTENANCE.STUCK_FILE_RECOVERY },
        {
          repeat: { pattern: CRON_PATTERNS.EVERY_15_MIN },
          jobId: JOB_NAMES.FILE_MAINTENANCE.STUCK_FILE_RECOVERY,
        }
      );

      // Orphan cleanup (daily at 03:00 UTC)
      await queue.add(
        JOB_NAMES.FILE_MAINTENANCE.ORPHAN_CLEANUP,
        { type: JOB_NAMES.FILE_MAINTENANCE.ORPHAN_CLEANUP },
        {
          repeat: { pattern: CRON_PATTERNS.DAILY_AT_0300 },
          jobId: JOB_NAMES.FILE_MAINTENANCE.ORPHAN_CLEANUP,
        }
      );

      // Batch timeout (every hour)
      await queue.add(
        JOB_NAMES.FILE_MAINTENANCE.BATCH_TIMEOUT,
        { type: JOB_NAMES.FILE_MAINTENANCE.BATCH_TIMEOUT },
        {
          repeat: { pattern: CRON_PATTERNS.HOURLY },
          jobId: JOB_NAMES.FILE_MAINTENANCE.BATCH_TIMEOUT,
        }
      );

      // Sync health check (every 15 minutes) — PRD-300
      await queue.add(
        JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK,
        { type: JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK },
        {
          repeat: { pattern: CRON_PATTERNS.EVERY_15_MIN },
          jobId: JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK,
        }
      );

      // Sync reconciliation (every hour — 24x/day)
      await queue.add(
        JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION,
        { type: JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION },
        {
          repeat: { pattern: CRON_PATTERNS.HOURLY },
          jobId: JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION,
        }
      );

      this.log.info('Scheduled maintenance jobs initialized (PRD-05, PRD-300)', {
        jobs: [
          JOB_NAMES.FILE_MAINTENANCE.STUCK_FILE_RECOVERY,
          JOB_NAMES.FILE_MAINTENANCE.ORPHAN_CLEANUP,
          JOB_NAMES.FILE_MAINTENANCE.BATCH_TIMEOUT,
          JOB_NAMES.FILE_MAINTENANCE.SYNC_HEALTH_CHECK,
          JOB_NAMES.FILE_MAINTENANCE.SYNC_RECONCILIATION,
        ],
      });
    } catch (error) {
      this.log.error('Failed to initialize maintenance scheduled jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - scheduled jobs are optional
    }
  }

  /**
   * Initialize sync scheduled jobs (PRD-108)
   *
   * - Subscription renewal: every 12 hours
   * - Polling fallback: every 30 minutes
   */
  private async initializeSyncJobs(): Promise<void> {
    const queue = this.getQueue(QueueName.SUBSCRIPTION_MGMT);
    if (!queue) {
      this.log.warn('Subscription management queue not available for scheduled jobs');
      return;
    }

    try {
      await this.removeExistingRepeatableJobs(queue);

      // Subscription renewal (every 12 hours)
      await queue.add(
        JOB_NAMES.SUBSCRIPTION_MGMT.RENEW,
        { type: JOB_NAMES.SUBSCRIPTION_MGMT.RENEW },
        {
          repeat: { pattern: CRON_PATTERNS.EVERY_12_HOURS },
          jobId: JOB_NAMES.SUBSCRIPTION_MGMT.RENEW,
        }
      );

      // Polling fallback (every 30 minutes)
      await queue.add(
        JOB_NAMES.SUBSCRIPTION_MGMT.POLL,
        { type: JOB_NAMES.SUBSCRIPTION_MGMT.POLL },
        {
          repeat: { pattern: CRON_PATTERNS.EVERY_30_MIN },
          jobId: JOB_NAMES.SUBSCRIPTION_MGMT.POLL,
        }
      );

      // Immediate poll on startup — catch missed changes without waiting 30 min
      await queue.add(
        JOB_NAMES.SUBSCRIPTION_MGMT.POLL,
        { type: JOB_NAMES.SUBSCRIPTION_MGMT.POLL },
        {
          jobId: `poll-delta-startup-${Date.now()}`,
          delay: 10_000,
        }
      );
      this.log.info('Enqueued immediate startup poll-delta job');

      this.log.info('Scheduled sync jobs initialized (PRD-108)', {
        jobs: [
          JOB_NAMES.SUBSCRIPTION_MGMT.RENEW,
          JOB_NAMES.SUBSCRIPTION_MGMT.POLL,
        ],
      });
    } catch (error) {
      this.log.error('Failed to initialize sync scheduled jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - scheduled jobs are optional
    }
  }

  /**
   * Remove existing repeatable jobs from a queue
   *
   * Prevents duplicate jobs on server restart.
   */
  private async removeExistingRepeatableJobs(queue: Queue): Promise<void> {
    const existingJobs = await queue.getRepeatableJobs();
    for (const job of existingJobs) {
      await queue.removeRepeatableByKey(job.key);
    }
    if (existingJobs.length > 0) {
      this.log.debug('Removed existing repeatable jobs', {
        queue: queue.name,
        count: existingJobs.length,
      });
    }
  }
}
