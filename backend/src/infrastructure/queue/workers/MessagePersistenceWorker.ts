/**
 * MessagePersistenceWorker
 *
 * Persists messages to the database using MERGE (upsert) for idempotency.
 * Core worker for the two-phase persistence pattern.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import type { PrismaClient } from '@prisma/client';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { MessagePersistenceJob } from '../types';

/**
 * Dependencies for MessagePersistenceWorker
 */
export interface MessagePersistenceWorkerDependencies {
  logger?: ILoggerMinimal;
  prisma?: PrismaClient;
}

/**
 * MessagePersistenceWorker
 */
export class MessagePersistenceWorker {
  private static instance: MessagePersistenceWorker | null = null;

  private readonly log: ILoggerMinimal;
  private readonly prisma: PrismaClient;

  constructor(deps?: MessagePersistenceWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'MessagePersistenceWorker' });
    this.prisma = deps?.prisma ?? defaultPrisma;
  }

  public static getInstance(deps?: MessagePersistenceWorkerDependencies): MessagePersistenceWorker {
    if (!MessagePersistenceWorker.instance) {
      MessagePersistenceWorker.instance = new MessagePersistenceWorker(deps);
    }
    return MessagePersistenceWorker.instance;
  }

  public static resetInstance(): void {
    MessagePersistenceWorker.instance = null;
  }

  /**
   * Process message persistence job
   */
  async process(job: Job<MessagePersistenceJob>): Promise<void> {
    const {
      sessionId, messageId, role, messageType, content, metadata,
      sequenceNumber, eventId, toolUseId, stopReason,
      model, inputTokens, outputTokens, userId, correlationId, agentId,
    } = job.data;

    // Create job-scoped logger with user context and timestamp
    // Uses this.log.child() to inherit service name and work correctly with LOG_SERVICES filtering
    const jobLogger = this.log.child({
      userId,
      sessionId,
      messageId,
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
      correlationId,
      role,
      messageType,
    });

    // Validation: Check for undefined messageId
    if (!messageId || messageId === 'undefined' || messageId.trim() === '') {
      jobLogger.error('Invalid messageId', {
        jobId: job.id,
        messageId,
        sessionId,
        role,
        messageType,
        metadata,
      });
      throw new Error(`Invalid messageId: ${messageId}. Cannot persist message.`);
    }

    jobLogger.info('Worker picked up message persistence job', {
      jobId: job.id,
      messageId,
      sessionId,
      role,
      messageType,
      contentLength: content?.length || 0,
      hasSequenceNumber: !!sequenceNumber,
      sequenceNumber,
      hasEventId: !!eventId,
      hasToolUseId: !!toolUseId,
      toolUseId,
      model,
      inputTokens,
      outputTokens,
      attemptNumber: job.attemptsMade,
    });

    try {
      // Resolve toolUseId from job data or metadata for backwards compat
      const finalToolUseId: string | null = toolUseId || (typeof metadata?.tool_use_id === 'string' ? metadata.tool_use_id : null);

      // Calculate total tokens if input and output are provided
      const totalTokens = (inputTokens !== undefined && outputTokens !== undefined)
        ? inputTokens + outputTokens
        : null;

      // Use Prisma upsert to prevent PK violations on retries
      await this.prisma.messages.upsert({
        where: { id: messageId },
        create: {
          id: messageId,
          session_id: sessionId,
          role,
          message_type: messageType,
          content,
          metadata: metadata ? JSON.stringify(metadata) : '{}',
          sequence_number: sequenceNumber ?? null,
          event_id: eventId ?? null,
          token_count: totalTokens,
          stop_reason: stopReason ?? null,
          tool_use_id: finalToolUseId,
          created_at: new Date(),
          model: model ?? null,
          input_tokens: inputTokens ?? null,
          output_tokens: outputTokens ?? null,
          agent_id: agentId ?? null,
        },
        update: {}, // No-op on conflict - idempotent insert
      });

      jobLogger.info('Message persisted to database successfully', {
        jobId: job.id,
        messageId,
        sessionId,
        messageType,
        role,
        contentLength: content?.length || 0,
        hasSequenceNumber: !!sequenceNumber,
        sequenceNumber,
        hasEventId: !!eventId,
        eventId,
      });
    } catch (error) {
      jobLogger.error('Failed to persist message to database', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        messageId,
        sessionId,
        messageType,
        sequenceNumber,
        eventId,
        attemptNumber: job.attemptsMade,
      });
      throw error; // Will trigger retry
    }
  }
}

/**
 * Get MessagePersistenceWorker singleton
 */
export function getMessagePersistenceWorker(deps?: MessagePersistenceWorkerDependencies): MessagePersistenceWorker {
  return MessagePersistenceWorker.getInstance(deps);
}

/**
 * Reset MessagePersistenceWorker singleton (for testing)
 */
export function __resetMessagePersistenceWorker(): void {
  MessagePersistenceWorker.resetInstance();
}
