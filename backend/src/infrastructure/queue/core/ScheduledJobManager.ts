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
    await this.initializeFileCleanupJobs();
    await this.initializeMaintenanceJobs();
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
        { type: 'hourly' as const },
        {
          repeat: { pattern: CRON_PATTERNS.HOURLY_AT_05 },
          jobId: JOB_NAMES.USAGE_AGGREGATION.HOURLY,
        }
      );

      // Daily aggregation (every day at 00:15 UTC)
      await queue.add(
        JOB_NAMES.USAGE_AGGREGATION.DAILY,
        { type: 'daily' as const },
        {
          repeat: { pattern: CRON_PATTERNS.DAILY_AT_0015 },
          jobId: JOB_NAMES.USAGE_AGGREGATION.DAILY,
        }
      );

      // Monthly invoice generation (1st of month at 00:30 UTC)
      await queue.add(
        JOB_NAMES.USAGE_AGGREGATION.MONTHLY_INVOICES,
        { type: 'monthly-invoices' as const },
        {
          repeat: { pattern: CRON_PATTERNS.MONTHLY_1ST_AT_0030 },
          jobId: JOB_NAMES.USAGE_AGGREGATION.MONTHLY_INVOICES,
        }
      );

      // Quota reset check (every day at 00:10 UTC)
      await queue.add(
        JOB_NAMES.USAGE_AGGREGATION.QUOTA_RESET,
        { type: 'quota-reset' as const },
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
   * Initialize file cleanup scheduled jobs
   */
  private async initializeFileCleanupJobs(): Promise<void> {
    const queue = this.getQueue(QueueName.FILE_CLEANUP);
    if (!queue) {
      this.log.warn('File cleanup queue not available for scheduled jobs');
      return;
    }

    try {
      // Remove existing repeatable jobs
      await this.removeExistingRepeatableJobs(queue);

      // Daily full cleanup (every day at 3:00 AM UTC)
      // Cleans: old failed files (30 days) + orphaned chunks (7 days) + orphaned search docs
      await queue.add(
        JOB_NAMES.FILE_CLEANUP.DAILY,
        { type: 'daily_full' as const },
        {
          repeat: { pattern: CRON_PATTERNS.DAILY_AT_0300 },
          jobId: JOB_NAMES.FILE_CLEANUP.DAILY,
        }
      );

      this.log.info('Scheduled jobs initialized for file cleanup', {
        jobs: [JOB_NAMES.FILE_CLEANUP.DAILY],
        schedule: `${CRON_PATTERNS.DAILY_AT_0300} (3 AM UTC daily)`,
      });
    } catch (error) {
      this.log.error('Failed to initialize file cleanup scheduled jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - scheduled jobs are optional
    }
  }

  /**
   * Initialize V2 maintenance scheduled jobs (PRD-05)
   */
  private async initializeMaintenanceJobs(): Promise<void> {
    const queue = this.getQueue(QueueName.V2_MAINTENANCE);
    if (!queue) {
      this.log.warn('V2 maintenance queue not available for scheduled jobs');
      return;
    }

    try {
      await this.removeExistingRepeatableJobs(queue);

      // Stuck file recovery (every 15 minutes)
      await queue.add(
        JOB_NAMES.V2_MAINTENANCE.STUCK_FILE_RECOVERY,
        { type: 'stuck-file-recovery' },
        {
          repeat: { pattern: CRON_PATTERNS.EVERY_15_MIN },
          jobId: JOB_NAMES.V2_MAINTENANCE.STUCK_FILE_RECOVERY,
        }
      );

      // Orphan cleanup (daily at 03:00 UTC)
      await queue.add(
        JOB_NAMES.V2_MAINTENANCE.ORPHAN_CLEANUP,
        { type: 'orphan-cleanup' },
        {
          repeat: { pattern: CRON_PATTERNS.DAILY_AT_0300 },
          jobId: JOB_NAMES.V2_MAINTENANCE.ORPHAN_CLEANUP,
        }
      );

      // Batch timeout (every hour)
      await queue.add(
        JOB_NAMES.V2_MAINTENANCE.BATCH_TIMEOUT,
        { type: 'batch-timeout' },
        {
          repeat: { pattern: CRON_PATTERNS.HOURLY },
          jobId: JOB_NAMES.V2_MAINTENANCE.BATCH_TIMEOUT,
        }
      );

      this.log.info('Scheduled maintenance jobs initialized (PRD-05)', {
        jobs: [
          JOB_NAMES.V2_MAINTENANCE.STUCK_FILE_RECOVERY,
          JOB_NAMES.V2_MAINTENANCE.ORPHAN_CLEANUP,
          JOB_NAMES.V2_MAINTENANCE.BATCH_TIMEOUT,
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
