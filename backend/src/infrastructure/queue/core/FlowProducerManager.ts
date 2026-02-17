/**
 * FlowProducerManager (PRD-04)
 *
 * Singleton that manages BullMQ FlowProducer lifecycle.
 * Uses the same Redis connection config from RedisConnectionManager.
 *
 * FlowProducer enables declarative job dependency trees where
 * children execute before their parents (leaf nodes first).
 *
 * @module infrastructure/queue/core
 */

import { FlowProducer, type FlowJob, type FlowOpts } from 'bullmq';
import type { RedisOptions } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FlowProducerManager' });

/**
 * Dependencies for FlowProducerManager
 */
export interface FlowProducerManagerDependencies {
  /** Redis connection config (from RedisConnectionManager.getConnectionConfig()) */
  redisConfig: RedisOptions;
  /** Optional queue name prefix for test isolation */
  queueNamePrefix?: string;
  logger?: ILoggerMinimal;
}

/**
 * FlowProducerManager — manages BullMQ FlowProducer lifecycle
 */
export class FlowProducerManager {
  private flowProducer: FlowProducer;
  private readonly log: ILoggerMinimal;
  private readonly queueNamePrefix: string;

  constructor(deps: FlowProducerManagerDependencies) {
    this.log = deps.logger ?? DEFAULT_LOGGER;
    this.queueNamePrefix = deps.queueNamePrefix ?? '';

    this.flowProducer = new FlowProducer({
      connection: deps.redisConfig,
    });

    this.log.info('FlowProducerManager initialized');
  }

  /**
   * Add a flow (job dependency tree) to BullMQ.
   *
   * In the tree: deepest children execute FIRST, root parent executes LAST.
   * All jobs are added atomically — if any part fails, the entire flow is rolled back.
   *
   * @param flow - Root FlowJob describing the dependency tree
   * @param opts - Optional FlowOpts (e.g., queuesOptions for per-queue settings)
   * @returns The created flow tree with job references
   */
  async addFlow(flow: FlowJob, opts?: FlowOpts) {
    const prefixedFlow = this.queueNamePrefix
      ? this.applyPrefix(flow)
      : flow;

    const result = await this.flowProducer.add(prefixedFlow, opts);

    this.log.info(
      {
        rootJobName: flow.name,
        rootQueue: flow.queueName,
        childCount: this.countJobs(flow) - 1,
      },
      'Flow added to BullMQ',
    );

    return result;
  }

  /**
   * Recursively apply queue name prefix for test isolation.
   */
  private applyPrefix(flow: FlowJob): FlowJob {
    return {
      ...flow,
      queueName: `${this.queueNamePrefix}--${flow.queueName}`,
      children: flow.children?.map((child) => this.applyPrefix(child)),
    };
  }

  /**
   * Count total jobs in a flow tree (root + all descendants).
   */
  private countJobs(flow: FlowJob): number {
    let count = 1;
    if (flow.children) {
      for (const child of flow.children) {
        count += this.countJobs(child);
      }
    }
    return count;
  }

  /**
   * Close the FlowProducer (graceful shutdown).
   */
  async close(): Promise<void> {
    try {
      await this.flowProducer.close();
      this.log.info('FlowProducerManager closed');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log.error({ error: { message: error.message } }, 'Failed to close FlowProducerManager');
      throw error;
    }
  }
}
