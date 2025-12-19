/**
 * Message Ordering Service
 *
 * SOURCE OF TRUTH for message ordering in the system.
 * Provides atomic sequence number reservation for batch operations.
 *
 * Key capability: reserveSequenceBatch()
 * - Pre-assigns sequences BEFORE async operations
 * - Guarantees ordering even when async operations complete out-of-order
 * - Uses Redis INCRBY for atomic batch reservation
 *
 * This service solves the tool execution ordering bug where:
 * - Tool A takes 2 seconds, Tool B takes 100ms
 * - Without pre-assignment: B completes first → gets lower sequence
 * - With pre-assignment: A gets seq=N, B gets seq=N+1 (preserves intent)
 */

import { getRedis } from '@/infrastructure/redis/redis';
import { executeQuery } from '@/infrastructure/database/database';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import type {
  ReservedSequenceBatch,
  OrderingValidation,
  OrderingIssue,
} from './types';

/**
 * Event data for createOrderedEvent
 */
export interface OrderedEventData {
  eventType: string;
  data: Record<string, unknown>;
}

/**
 * Result of createOrderedEvent
 */
export interface OrderedEventResult {
  id: string;
  sessionId: string;
  eventType: string;
  sequenceNumber: number;
  timestamp: Date;
  data: Record<string, unknown>;
}

export class MessageOrderingService {
  private static instance: MessageOrderingService | null = null;
  private logger: Logger;

  private constructor() {
    this.logger = createChildLogger({ service: 'MessageOrderingService' });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MessageOrderingService {
    if (!MessageOrderingService.instance) {
      MessageOrderingService.instance = new MessageOrderingService();
    }
    return MessageOrderingService.instance;
  }

  /**
   * Reserve a batch of sequence numbers atomically
   *
   * This is the KEY FIX for tool ordering:
   * - Call BEFORE executing tools
   * - Returns array of reserved sequences in order
   * - Use these sequences when persisting results (regardless of completion order)
   *
   * @param sessionId - Session ID
   * @param count - Number of sequences to reserve
   * @returns ReservedSequenceBatch with array of sequences
   *
   * @example
   * // Before executing 3 tools:
   * const batch = await orderingService.reserveSequenceBatch(sessionId, 3);
   * // batch.sequences = [5, 6, 7]
   *
   * // Tool 2 completes first, but use its pre-assigned sequence:
   * await persistToolResult(tool2Result, batch.sequences[1]); // Uses 6, not 5
   */
  public async reserveSequenceBatch(
    sessionId: string,
    count: number
  ): Promise<ReservedSequenceBatch> {
    if (count <= 0) {
      throw new Error('Count must be positive');
    }

    this.logger.info({
      sessionId,
      count,
    }, 'Reserving sequence batch');

    try {
      const redis = getRedis();

      if (!redis) {
        this.logger.warn({ sessionId }, 'Redis not available, falling back to database');
        return this.reserveSequenceBatchFromDatabase(sessionId, count);
      }

      const key = `event:sequence:${sessionId}`;

      // Atomic batch reservation using INCRBY
      // If current value is 5 and we INCRBY 3, we get 8
      // Our reserved sequences are: 5, 6, 7 (values before the increment)
      const endValue = await redis.incrby(key, count);

      // Set TTL to 7 days (matches EventStore pattern)
      await redis.expire(key, 7 * 24 * 60 * 60);

      // Calculate start sequence (0-indexed)
      // endValue is the new counter value after increment
      // startSequence is (endValue - count) which gives us the first reserved sequence (0-indexed)
      const startSequence = Number(endValue) - count;

      // Generate array of reserved sequences
      const sequences: number[] = [];
      for (let i = 0; i < count; i++) {
        sequences.push(startSequence + i);
      }

      const result: ReservedSequenceBatch = {
        sessionId,
        startSequence,
        sequences,
        reservedAt: new Date(),
      };

      this.logger.info({
        sessionId,
        count,
        startSequence,
        sequences,
      }, 'Sequence batch reserved successfully');

      return result;

    } catch (error) {
      this.logger.error({
        sessionId,
        count,
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to reserve sequence batch from Redis');

      // Fallback to database
      return this.reserveSequenceBatchFromDatabase(sessionId, count);
    }
  }

  /**
   * Fallback: Reserve sequences using database
   * Less efficient but guarantees correctness when Redis is unavailable
   */
  private async reserveSequenceBatchFromDatabase(
    sessionId: string,
    count: number
  ): Promise<ReservedSequenceBatch> {
    this.logger.warn({
      sessionId,
      count,
    }, 'Using database fallback for sequence reservation');

    try {
      // Get current max sequence
      const result = await executeQuery<{ max_seq: number | null }>(
        `SELECT MAX(sequence_number) AS max_seq
         FROM message_events
         WHERE session_id = @session_id`,
        { session_id: sessionId }
      );

      const currentMax = result.recordset[0]?.max_seq ?? -1;
      const startSequence = currentMax + 1;

      const sequences: number[] = [];
      for (let i = 0; i < count; i++) {
        sequences.push(startSequence + i);
      }

      // Also try to sync Redis if it becomes available
      this.trySyncRedisSequence(sessionId, startSequence + count).catch(() => {
        // Ignore sync failures
      });

      return {
        sessionId,
        startSequence,
        sequences,
        reservedAt: new Date(),
      };

    } catch (error) {
      this.logger.error({
        sessionId,
        count,
        error: error instanceof Error ? error.message : String(error),
      }, 'Database fallback also failed');

      // Last resort: start from 0
      const sequences: number[] = [];
      for (let i = 0; i < count; i++) {
        sequences.push(i);
      }

      return {
        sessionId,
        startSequence: 0,
        sequences,
        reservedAt: new Date(),
      };
    }
  }

  /**
   * Try to sync Redis sequence counter with database
   */
  private async trySyncRedisSequence(sessionId: string, targetValue: number): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const key = `event:sequence:${sessionId}`;
    await redis.set(key, targetValue.toString());
    await redis.expire(key, 7 * 24 * 60 * 60);
  }

  /**
   * Get next single sequence number
   * Use this for non-batch operations (single events)
   *
   * @param sessionId - Session ID
   * @returns Next sequence number
   */
  public async getNextSequence(sessionId: string): Promise<number> {
    const batch = await this.reserveSequenceBatch(sessionId, 1);
    return batch.sequences[0]!;
  }

  /**
   * Create an event with a specific pre-assigned sequence number
   *
   * Use this when you've pre-reserved sequences via reserveSequenceBatch()
   * and need to persist events in the correct order regardless of when they complete.
   *
   * NOTE: This creates the event record but does NOT insert to database.
   * The caller is responsible for persistence (via EventStore or MessageQueue).
   *
   * @param sessionId - Session ID
   * @param eventData - Event type and data
   * @param preAssignedSequence - Optional pre-assigned sequence (if not provided, generates new one)
   * @returns OrderedEventResult ready for persistence
   */
  public async createOrderedEvent(
    sessionId: string,
    eventData: OrderedEventData,
    preAssignedSequence?: number
  ): Promise<OrderedEventResult> {
    const sequenceNumber = preAssignedSequence ?? await this.getNextSequence(sessionId);

    const result: OrderedEventResult = {
      id: randomUUID(),
      sessionId,
      eventType: eventData.eventType,
      sequenceNumber,
      timestamp: new Date(),
      data: eventData.data,
    };

    this.logger.debug({
      sessionId,
      eventType: eventData.eventType,
      sequenceNumber,
      preAssigned: preAssignedSequence !== undefined,
    }, 'Created ordered event');

    return result;
  }

  /**
   * Validate ordering for a session
   *
   * Checks for:
   * - Sequence gaps
   * - Duplicate sequences
   * - Out-of-order timestamps (warning only)
   *
   * @param sessionId - Session ID
   * @returns OrderingValidation result
   */
  public async validateOrdering(sessionId: string): Promise<OrderingValidation> {
    this.logger.info({ sessionId }, 'Validating ordering for session');

    const issues: OrderingIssue[] = [];

    try {
      // Get all events ordered by sequence
      const result = await executeQuery<{
        id: string;
        sequence_number: number;
        timestamp: Date;
        event_type: string;
      }>(
        `SELECT id, sequence_number, timestamp, event_type
         FROM message_events
         WHERE session_id = @session_id
         ORDER BY sequence_number ASC`,
        { session_id: sessionId }
      );

      const events = result.recordset;

      if (events.length === 0) {
        return {
          valid: true,
          sessionId,
          totalEvents: 0,
          issues: [],
        };
      }

      // Check for gaps and duplicates
      const seenSequences = new Set<number>();
      let previousSequence = -1;
      let previousTimestamp: Date | null = null;

      for (const event of events) {
        const seq = event.sequence_number;

        // Check for duplicates
        if (seenSequences.has(seq)) {
          issues.push({
            type: 'sequence_duplicate',
            message: `Duplicate sequence number: ${seq}`,
            sequenceNumbers: [seq],
            eventIds: [event.id],
          });
        }
        seenSequences.add(seq);

        // Check for gaps (only if not first event)
        if (previousSequence >= 0 && seq !== previousSequence + 1) {
          const gap = seq - previousSequence;
          if (gap > 1) {
            issues.push({
              type: 'sequence_gap',
              message: `Gap in sequence: ${previousSequence} -> ${seq} (missing ${gap - 1} events)`,
              sequenceNumbers: [previousSequence, seq],
            });
          }
        }

        // Check for out-of-order timestamps (warning, not error)
        if (previousTimestamp && event.timestamp < previousTimestamp) {
          issues.push({
            type: 'wrong_order',
            message: `Timestamp out of order at sequence ${seq}`,
            sequenceNumbers: [seq],
            eventIds: [event.id],
          });
        }

        previousSequence = seq;
        previousTimestamp = event.timestamp;
      }

      const valid = issues.filter(i => i.type !== 'wrong_order').length === 0;

      this.logger.info({
        sessionId,
        valid,
        totalEvents: events.length,
        issueCount: issues.length,
      }, 'Ordering validation completed');

      return {
        valid,
        sessionId,
        totalEvents: events.length,
        issues,
      };

    } catch (error) {
      this.logger.error({
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to validate ordering');

      return {
        valid: false,
        sessionId,
        totalEvents: 0,
        issues: [{
          type: 'sequence_gap',
          message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }

  /**
   * Get current sequence counter for a session
   * Useful for debugging
   */
  public async getCurrentSequence(sessionId: string): Promise<number> {
    try {
      const redis = getRedis();

      if (redis) {
        const key = `event:sequence:${sessionId}`;
        const value = await redis.get(key);
        return value ? parseInt(value, 10) : 0;
      }

      // Fallback to database
      const result = await executeQuery<{ max_seq: number | null }>(
        `SELECT MAX(sequence_number) AS max_seq
         FROM message_events
         WHERE session_id = @session_id`,
        { session_id: sessionId }
      );

      return (result.recordset[0]?.max_seq ?? -1) + 1;

    } catch (error) {
      this.logger.error({ sessionId, error }, 'Failed to get current sequence');
      return 0;
    }
  }

  /**
   * Reset singleton instance (for testing)
   * @internal
   */
  public static __resetInstance(): void {
    MessageOrderingService.instance = null;
  }
}

/**
 * Get singleton instance of MessageOrderingService
 */
export function getMessageOrderingService(): MessageOrderingService {
  return MessageOrderingService.getInstance();
}
