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
    const { type, userId, periodStart, correlationId } = job.data;

    // Create job-scoped logger with user context and timestamp
    const jobLogger = this.log.child({
      userId: userId || 'all-users',
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
      correlationId,
      aggregationType: type,
      periodStart,
    });

    jobLogger.info('Processing usage aggregation job', {
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
          jobLogger.info('Hourly aggregation completed', { usersProcessed: count });
          break;
        }
        case 'daily': {
          const dayStart = periodStart ? new Date(periodStart) : this.getYesterdayStart();
          const count = await aggregationService.aggregateDaily(dayStart, userId);
          jobLogger.info('Daily aggregation completed', { usersProcessed: count });
          break;
        }
        case 'monthly': {
          const monthStart = periodStart ? new Date(periodStart) : this.getLastMonthStart();
          const count = await aggregationService.aggregateMonthly(monthStart, userId);
          jobLogger.info('Monthly aggregation completed', { usersProcessed: count });
          break;
        }
        case 'monthly-invoices': {
          const invoiceMonth = periodStart ? new Date(periodStart) : this.getLastMonthStart();
          const count = await billingService.generateAllMonthlyInvoices(invoiceMonth);
          jobLogger.info('Monthly invoices generated', { invoicesCreated: count });
          break;
        }
        case 'quota-reset': {
          const count = await aggregationService.resetExpiredQuotas();
          jobLogger.info('Expired quotas reset', { usersReset: count });
          break;
        }
        default:
          jobLogger.error('Unknown aggregation job type');
          throw new Error(`Unknown aggregation job type: ${type}`);
      }
    } catch (error) {
      jobLogger.error('Usage aggregation job failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
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
