/**
 * UsageAggregationWorker
 *
 * Routes usage aggregation jobs to appropriate service methods.
 * Supports hourly/daily/monthly aggregation, invoices, and quota resets.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { UsageAggregationJob } from '../types';

/**
 * Dependencies for UsageAggregationWorker
 */
export interface UsageAggregationWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * UsageAggregationWorker
 */
export class UsageAggregationWorker {
  private static instance: UsageAggregationWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: UsageAggregationWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'UsageAggregationWorker' });
  }

  public static getInstance(deps?: UsageAggregationWorkerDependencies): UsageAggregationWorker {
    if (!UsageAggregationWorker.instance) {
      UsageAggregationWorker.instance = new UsageAggregationWorker(deps);
    }
    return UsageAggregationWorker.instance;
  }

  public static resetInstance(): void {
    UsageAggregationWorker.instance = null;
  }

  /**
   * Process usage aggregation job
   */
  async process(job: Job<UsageAggregationJob>): Promise<void> {
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
      const { getUsageAggregationService } = await import('@/domains/billing/tracking/UsageAggregationService');
      const { getBillingService } = await import('@/domains/billing');

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
      throw error; // Will trigger retry
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
}

/**
 * Get UsageAggregationWorker singleton
 */
export function getUsageAggregationWorker(deps?: UsageAggregationWorkerDependencies): UsageAggregationWorker {
  return UsageAggregationWorker.getInstance(deps);
}

/**
 * Reset UsageAggregationWorker singleton (for testing)
 */
export function __resetUsageAggregationWorker(): void {
  UsageAggregationWorker.resetInstance();
}
