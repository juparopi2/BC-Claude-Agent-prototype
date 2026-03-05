/**
 * ProcessingFlowFactory (PRD-04)
 *
 * Builds per-file BullMQ Flow trees with correct nesting order.
 *
 * BullMQ Flow execution order: deepest children first, parents last.
 * Our nesting (inner = executes first):
 *
 *   pipeline-complete (parent — runs LAST)
 *     └── embed (child of complete — runs 3rd)
 *           └── chunk (child of embed — runs 2nd)
 *                 └── extract (deepest child — runs FIRST)
 *
 * Guarantees: extract → chunk → embed → pipeline-complete
 *
 * @module infrastructure/queue/flow
 */

import type { FlowJob } from 'bullmq';
import { QueueName, DEFAULT_BACKOFF } from '../constants';

/**
 * Parameters for creating a per-file processing flow.
 */
export interface FileFlowParams {
  fileId: string;
  batchId: string;
  userId: string;
  mimeType: string;
  blobPath?: string;
  fileName: string;
}

/**
 * ProcessingFlowFactory — builds per-file Flow trees
 */
export class ProcessingFlowFactory {
  /**
   * Create a BullMQ Flow tree for processing a single file.
   *
   * Execution order (guaranteed by BullMQ Flow nesting):
   * 1. extract  (deepest child — runs FIRST)
   * 2. chunk    (child of embed)
   * 3. embed    (child of pipeline-complete)
   * 4. pipeline-complete (root parent — runs LAST)
   *
   * Each job uses `jobId` = `${stage}--${fileId}` for idempotent adds
   * (BullMQ deduplicates by jobId within a queue).
   *
   * NOTE: BullMQ forbids `:` in custom jobIds (reserved for Redis key
   * namespacing). We use `--` as the separator instead.
   */
  static createFileFlow(params: FileFlowParams): FlowJob {
    const { fileId, batchId, userId, mimeType, fileName } = params;
    const blobPath = params.blobPath ?? '';

    return {
      name: `pipeline-complete--${fileId}`,
      queueName: QueueName.FILE_PIPELINE_COMPLETE,
      data: { fileId, batchId, userId },
      opts: {
        jobId: `pipeline-complete--${fileId}`,
        attempts: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.attempts,
        backoff: {
          type: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.type,
          delay: DEFAULT_BACKOFF.FILE_PIPELINE_COMPLETE.delay,
        },
      },
      children: [
        {
          name: `embed--${fileId}`,
          queueName: QueueName.FILE_EMBED,
          data: { fileId, batchId, userId },
          opts: {
            jobId: `embed--${fileId}`,
            attempts: DEFAULT_BACKOFF.FILE_EMBED.attempts,
            backoff: {
              type: DEFAULT_BACKOFF.FILE_EMBED.type,
              delay: DEFAULT_BACKOFF.FILE_EMBED.delay,
            },
          },
          children: [
            {
              name: `chunk--${fileId}`,
              queueName: QueueName.FILE_CHUNK,
              data: { fileId, batchId, userId, mimeType },
              opts: {
                jobId: `chunk--${fileId}`,
                attempts: DEFAULT_BACKOFF.FILE_CHUNK.attempts,
                backoff: {
                  type: DEFAULT_BACKOFF.FILE_CHUNK.type,
                  delay: DEFAULT_BACKOFF.FILE_CHUNK.delay,
                },
              },
              children: [
                {
                  name: `extract--${fileId}`,
                  queueName: QueueName.FILE_EXTRACT,
                  data: {
                    fileId,
                    batchId,
                    userId,
                    mimeType,
                    blobPath,
                    fileName,
                  },
                  opts: {
                    jobId: `extract--${fileId}`,
                    attempts: DEFAULT_BACKOFF.FILE_EXTRACT.attempts,
                    backoff: {
                      type: DEFAULT_BACKOFF.FILE_EXTRACT.type,
                      delay: DEFAULT_BACKOFF.FILE_EXTRACT.delay,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
  }
}
