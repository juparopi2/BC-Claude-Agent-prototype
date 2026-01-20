/**
 * JobFailureEventEmitter
 *
 * Centralized WebSocket event emitter for job failure notifications.
 * Used to notify users when BullMQ background jobs fail permanently.
 *
 * Design Principles:
 * - Single Responsibility: Only emits job failure events
 * - Graceful Degradation: Logs warning if Socket.IO unavailable
 * - No Failures: WebSocket errors never fail the calling operation
 * - Rate Limiting: Deduplicates rapid failures for same job
 *
 * Phase 3, Task 3.3
 *
 * @module domains/queue/emission
 */

import { createChildLogger } from '@/shared/utils/logger';
import {
  getSocketIO,
  isSocketServiceInitialized,
} from '@/services/websocket/SocketService';
import { JOB_WS_CHANNELS } from '@bc-agent/shared';
import type { Logger } from 'pino';
import type { Server as SocketServer } from 'socket.io';
import type {
  JobQueueName,
  JobFailureContext,
  JobFailedPayload,
} from '@bc-agent/shared';

/**
 * Dependencies for JobFailureEventEmitter (DI support for testing)
 */
export interface JobFailureEventEmitterDependencies {
  logger?: Logger;
  isSocketReady?: () => boolean;
  getIO?: () => SocketServer;
}

/**
 * Recent failure tracking for deduplication
 */
interface RecentFailure {
  timestamp: number;
  count: number;
}

/** Deduplication window in milliseconds (5 seconds) */
const DEDUP_WINDOW_MS = 5000;

/** Maximum duplicate notifications to suppress before warning */
const MAX_SUPPRESSED_BEFORE_WARNING = 10;

/**
 * JobFailureEventEmitter implementation
 */
export class JobFailureEventEmitter {
  private static instance: JobFailureEventEmitter | null = null;

  private readonly log: Logger;
  private readonly isSocketReady: () => boolean;
  private readonly getIO: () => SocketServer;

  /**
   * Recent failures for deduplication (keyed by jobId)
   * Auto-cleaned periodically
   */
  private recentFailures = new Map<string, RecentFailure>();

  private constructor(deps?: JobFailureEventEmitterDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'JobFailureEventEmitter' });
    this.isSocketReady = deps?.isSocketReady ?? isSocketServiceInitialized;
    this.getIO = deps?.getIO ?? getSocketIO;

    // Cleanup stale entries every minute
    setInterval(() => this.cleanupRecentFailures(), 60000);

    this.log.info('JobFailureEventEmitter initialized');
  }

  public static getInstance(deps?: JobFailureEventEmitterDependencies): JobFailureEventEmitter {
    if (!JobFailureEventEmitter.instance) {
      JobFailureEventEmitter.instance = new JobFailureEventEmitter(deps);
    }
    return JobFailureEventEmitter.instance;
  }

  public static resetInstance(): void {
    JobFailureEventEmitter.instance = null;
  }

  /**
   * Emit a job failure event to the user
   *
   * Emits to both userId room (for global notifications) and
   * sessionId room (if available, for chat-specific context).
   *
   * @param ctx - Context containing userId and optional sessionId
   * @param payload - Job failure payload
   */
  emitJobFailed(ctx: JobFailureContext, payload: JobFailedPayload): void {
    const { userId, sessionId } = ctx;
    const { jobId, queueName, error } = payload;

    // Check for duplicate notification (rapid failures)
    if (this.isDuplicateFailure(jobId)) {
      this.log.debug(
        { jobId, queueName },
        'Suppressing duplicate job failure notification'
      );
      return;
    }

    // Mark this failure as emitted
    this.recordFailure(jobId);

    // Skip if Socket.IO not initialized
    if (!this.isSocketReady()) {
      this.log.warn(
        { jobId, queueName, userId },
        'Skipping job failure event: Socket.IO not initialized'
      );
      return;
    }

    // Warn if no room target at all
    if (!userId) {
      this.log.warn(
        { jobId, queueName },
        'Skipping job failure event: no userId - frontend will not receive notification'
      );
      return;
    }

    try {
      const io = this.getIO();
      const channel = JOB_WS_CHANNELS.FAILURE;

      // Emit to userId room (for notifications)
      const userRoom = `user:${userId}`;
      this.log.debug(
        { userRoom, channel, jobId, queueName },
        'Emitting job failure to user room'
      );
      io.to(userRoom).emit(channel, payload);

      // Also emit to sessionId room if available (for chat context)
      if (sessionId) {
        this.log.debug(
          { sessionId, channel, jobId, queueName },
          'Emitting job failure to session room'
        );
        io.to(sessionId).emit(channel, payload);
      }

      this.log.info(
        {
          jobId,
          queueName,
          userId,
          sessionId: sessionId ?? null,
          error: error.substring(0, 100), // Truncate for logs
        },
        'Emitted job failure notification'
      );
    } catch (emitError) {
      // Log but never throw - WebSocket errors should not fail jobs
      this.log.error(
        {
          error: emitError instanceof Error ? emitError.message : String(emitError),
          jobId,
          queueName,
          userId,
        },
        'Failed to emit job failure WebSocket event'
      );
    }
  }

  /**
   * Create a JobFailedPayload from job data
   *
   * Helper to construct the payload in a consistent format.
   */
  createPayload(
    jobId: string,
    queueName: JobQueueName,
    error: string,
    attemptsMade: number,
    maxAttempts: number,
    context?: JobFailedPayload['context']
  ): JobFailedPayload {
    return {
      jobId,
      queueName,
      error,
      attemptsMade,
      maxAttempts,
      failedAt: new Date().toISOString(),
      context,
    };
  }

  // ===== Private Helpers =====

  /**
   * Check if this job has recently had a failure notification
   */
  private isDuplicateFailure(jobId: string): boolean {
    const recent = this.recentFailures.get(jobId);
    if (!recent) return false;

    const elapsed = Date.now() - recent.timestamp;
    if (elapsed < DEDUP_WINDOW_MS) {
      recent.count++;

      // Log warning if many duplicates are being suppressed
      if (recent.count === MAX_SUPPRESSED_BEFORE_WARNING) {
        this.log.warn(
          { jobId, suppressedCount: recent.count },
          'Many duplicate job failure notifications suppressed'
        );
      }

      return true;
    }

    // Expired, not a duplicate
    this.recentFailures.delete(jobId);
    return false;
  }

  /**
   * Record a failure emission for deduplication
   */
  private recordFailure(jobId: string): void {
    this.recentFailures.set(jobId, {
      timestamp: Date.now(),
      count: 1,
    });
  }

  /**
   * Clean up stale entries from recent failures map
   */
  private cleanupRecentFailures(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [jobId, failure] of this.recentFailures.entries()) {
      if (now - failure.timestamp > DEDUP_WINDOW_MS * 2) {
        this.recentFailures.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.log.debug({ cleaned }, 'Cleaned up stale failure tracking entries');
    }
  }
}

// ===== Convenience Getters =====

/**
 * Get the singleton JobFailureEventEmitter instance
 */
export function getJobFailureEventEmitter(
  deps?: JobFailureEventEmitterDependencies
): JobFailureEventEmitter {
  return JobFailureEventEmitter.getInstance(deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetJobFailureEventEmitter(): void {
  JobFailureEventEmitter.resetInstance();
}
