/**
 * ToolExecutionWorker
 *
 * Processes tool execution jobs from the queue.
 *
 * Note: This worker is NOT implemented. Tool execution happens
 * synchronously in DirectAgentService.executeMCPTool(). This queue
 * exists for future async tool execution support.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { ToolExecutionJob } from '../types';

/**
 * Dependencies for ToolExecutionWorker
 */
export interface ToolExecutionWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * ToolExecutionWorker - NOT IMPLEMENTED
 */
export class ToolExecutionWorker {
  private static instance: ToolExecutionWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: ToolExecutionWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'ToolExecutionWorker' });
  }

  public static getInstance(deps?: ToolExecutionWorkerDependencies): ToolExecutionWorker {
    if (!ToolExecutionWorker.instance) {
      ToolExecutionWorker.instance = new ToolExecutionWorker(deps);
    }
    return ToolExecutionWorker.instance;
  }

  public static resetInstance(): void {
    ToolExecutionWorker.instance = null;
  }

  /**
   * Process tool execution job
   *
   * @throws Always throws - not implemented
   */
  async process(job: Job<ToolExecutionJob>): Promise<void> {
    const { sessionId, toolUseId, toolName } = job.data;

    this.log.error('Tool execution queue not implemented', {
      jobId: job.id,
      toolName,
      toolUseId,
      sessionId,
    });

    throw new Error(
      'Tool execution queue is not implemented. ' +
      'Tools are executed synchronously in DirectAgentService.executeMCPTool(). ' +
      'This worker should not be called in production.'
    );
  }
}

/**
 * Get ToolExecutionWorker singleton
 */
export function getToolExecutionWorker(deps?: ToolExecutionWorkerDependencies): ToolExecutionWorker {
  return ToolExecutionWorker.getInstance(deps);
}

/**
 * Reset ToolExecutionWorker singleton (for testing)
 */
export function __resetToolExecutionWorker(): void {
  ToolExecutionWorker.resetInstance();
}
