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
import { executeQuery } from '@/infrastructure/database/database';
import type { ILoggerMinimal, ExecuteQueryFn } from '../IMessageQueueDependencies';
import type { CitationPersistenceJob } from '../types';

/**
 * Dependencies for CitationPersistenceWorker
 */
export interface CitationPersistenceWorkerDependencies {
  logger?: ILoggerMinimal;
  executeQuery?: ExecuteQueryFn;
}

/**
 * CitationPersistenceWorker
 */
export class CitationPersistenceWorker {
  private static instance: CitationPersistenceWorker | null = null;

  private readonly log: ILoggerMinimal;
  private readonly executeQueryFn: ExecuteQueryFn;

  constructor(deps?: CitationPersistenceWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'CitationPersistenceWorker' });
    this.executeQueryFn = deps?.executeQuery ?? executeQuery;
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
      // Insert each citation into message_citations table
      for (const cite of citations) {
        await this.executeQueryFn(
          `
          INSERT INTO message_citations
          (message_id, file_id, file_name, source_type, mime_type, relevance_score, is_image)
          VALUES (@messageId, @fileId, @fileName, @sourceType, @mimeType, @relevanceScore, @isImage)
          `,
          {
            messageId,
            fileId: cite.fileId,
            fileName: cite.fileName,
            sourceType: cite.sourceType,
            mimeType: cite.mimeType,
            relevanceScore: cite.relevanceScore,
            isImage: cite.isImage ? 1 : 0,
          }
        );
      }

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
