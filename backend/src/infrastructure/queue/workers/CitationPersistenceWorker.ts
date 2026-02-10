/**
 * CitationPersistenceWorker
 *
 * Persists RAG citations to the message_citations table.
 * Fire-and-forget pattern: citations are persisted asynchronously.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { CitationPersistenceJob } from '../types';

/**
 * Dependencies for CitationPersistenceWorker
 */
export interface CitationPersistenceWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * CitationPersistenceWorker
 */
export class CitationPersistenceWorker {
  private static instance: CitationPersistenceWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: CitationPersistenceWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'CitationPersistenceWorker' });
  }

  public static getInstance(deps?: CitationPersistenceWorkerDependencies): CitationPersistenceWorker {
    if (!CitationPersistenceWorker.instance) {
      CitationPersistenceWorker.instance = new CitationPersistenceWorker(deps);
    }
    return CitationPersistenceWorker.instance;
  }

  public static resetInstance(): void {
    CitationPersistenceWorker.instance = null;
  }

  /**
   * Process citation persistence job
   */
  async process(job: Job<CitationPersistenceJob>): Promise<void> {
    const { messageId, sessionId, citations, userId, correlationId } = job.data;

    // Create job-scoped logger with user context and timestamp
    const jobLogger = this.log.child({
      userId,
      sessionId,
      messageId,
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
      correlationId,
      citationCount: citations.length,
    });

    jobLogger.info('Processing citation persistence job', {
      attemptNumber: job.attemptsMade,
    });

    try {
      await prisma.message_citations.createMany({
        data: citations.map((cite) => ({
          message_id: messageId,
          file_id: cite.fileId,
          file_name: cite.fileName,
          source_type: cite.sourceType,
          mime_type: cite.mimeType,
          relevance_score: cite.relevanceScore,
          is_image: cite.isImage,
          excerpt_count: 0,
        })),
      });

      jobLogger.info('Citation persistence completed');
    } catch (error) {
      jobLogger.error('Citation persistence job failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        attemptNumber: job.attemptsMade,
      });
      throw error; // Will trigger retry
    }
  }
}

/**
 * Get CitationPersistenceWorker singleton
 */
export function getCitationPersistenceWorker(deps?: CitationPersistenceWorkerDependencies): CitationPersistenceWorker {
  return CitationPersistenceWorker.getInstance(deps);
}

/**
 * Reset CitationPersistenceWorker singleton (for testing)
 */
export function __resetCitationPersistenceWorker(): void {
  CitationPersistenceWorker.resetInstance();
}
