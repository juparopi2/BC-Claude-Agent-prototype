/**
 * Event Store Service
 *
 * Implements Event Sourcing pattern with atomic sequence number generation.
 * All message-related events are stored as immutable append-only logs.
 *
 * Architecture (Multi-Tenant Safe):
 * - Events are append-only (never updated or deleted)
 * - Sequence numbers generated via Redis INCR (atomic, prevents race conditions)
 * - Events can be replayed to reconstruct state
 * - Supports horizontal scaling with distributed deployments
 * - TTL-based cleanup for inactive sessions (7 days)
 *
 * @module services/events/EventStore
 */

import { executeQuery, getDatabase, SqlParams } from '@/infrastructure/database/database';
import { getRedis } from '@/infrastructure/redis/redis';
import { randomUUID } from 'crypto';
import { logger } from '@/shared/utils/logger';

/**
 * Event Type - All possible message events
 */
export type EventType =
  | 'user_message_sent'
  | 'agent_thinking_started'
  | 'agent_thinking_completed'
  | 'agent_thinking_block'
  | 'agent_message_sent'
  | 'agent_message_chunk'
  | 'tool_use_requested'
  | 'tool_use_completed'
  | 'approval_requested'
  | 'approval_completed'
  | 'todo_created'
  | 'todo_updated'
  | 'session_started'
  | 'session_ended'
  | 'error_occurred';

/**
 * Base Event
 */
export interface BaseEvent {
  id: string;
  session_id: string;
  event_type: EventType;
  sequence_number: number;
  timestamp: Date;
  data: Record<string, unknown>;
  processed: boolean;
}

/**
 * User Message Event
 */
export interface UserMessageEvent extends Omit<BaseEvent, 'event_type' | 'data'> {
  event_type: 'user_message_sent';
  data: {
    message_id: string;
    content: string;
    user_id: string;
  };
}

/**
 * Agent Message Event
 */
export interface AgentMessageEvent extends Omit<BaseEvent, 'event_type' | 'data'> {
  event_type: 'agent_message_sent';
  data: {
    message_id: string;
    content: string;
    stop_reason?: string | null;
    model?: string;                  // NEW: Claude model name (e.g., "claude-sonnet-4-5-20250929")
    input_tokens?: number;           // NEW: Input token count
    output_tokens?: number;          // NEW: Output token count
  };
}

// NOTE: AgentMessageChunkEvent removed - sync architecture uses complete messages only

/**
 * Tool Use Event
 */
export interface ToolUseEvent extends Omit<BaseEvent, 'event_type' | 'data'> {
  event_type: 'tool_use_requested';
  data: {
    tool_use_id: string;
    tool_name: string;
    tool_args: Record<string, unknown>;
  };
}

/**
 * Tool Result Event
 */
export interface ToolResultEvent extends Omit<BaseEvent, 'event_type' | 'data'> {
  event_type: 'tool_use_completed';
  data: {
    tool_use_id: string;
    tool_name: string;
    tool_result: unknown;
    success: boolean;
    error_message?: string;
  };
}

/**
 * Discriminated Union of all events (sync architecture - no chunk events)
 */
export type MessageEvent =
  | UserMessageEvent
  | AgentMessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | BaseEvent;

/**
 * Database Row Interface for Event Queries
 */
interface EventDbRow {
  id: string;
  session_id: string;
  event_type: string;
  sequence_number: number;
  timestamp: Date;
  data: string; // JSON string
  processed: boolean;
}

/**
 * Event Store Class
 *
 * Manages append-only event log with sequence numbers
 */
export class EventStore {
  private static instance: EventStore | null = null;

  private constructor() {
    logger.info('EventStore initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): EventStore {
    if (!EventStore.instance) {
      EventStore.instance = new EventStore();
    }
    return EventStore.instance;
  }

  /**
   * Reset singleton instance (FOR TESTING ONLY)
   */
  public static reset(): void {
    EventStore.instance = null;
  }

  /**
   * Reset sequence number for a session (FOR TESTING ONLY)
   *
   * @param sessionId - Session ID
   */
  public async resetSessionSequence(sessionId: string): Promise<void> {
    const redis = getRedis();
    if (redis) {
      await redis.del(`event:sequence:${sessionId}`);
    }
  }

  /**
   * Append Event to Store
   *
   * Events are immutable and append-only with atomic sequence numbers.
   * Uses Redis INCR for sequence generation (multi-tenant safe).
   *
   * @param sessionId - Session ID
   * @param eventType - Type of event
   * @param data - Event data (JSON-serializable)
   * @returns Created event with guaranteed sequence number
   */
  public async appendEvent(
    sessionId: string,
    eventType: EventType,
    data: Record<string, unknown>
  ): Promise<BaseEvent> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      const eventId = randomUUID();
      const timestamp = new Date();

      // Get next sequence number for this session
      let sequenceNumber: number;
      try {
        sequenceNumber = await this.getNextSequenceNumber(sessionId);

        // ⭐ CRITICAL: Validate sequence number is valid
        if (sequenceNumber === undefined || sequenceNumber === null || isNaN(sequenceNumber)) {
          throw new Error(`Invalid sequence number generated: ${sequenceNumber}`);
        }

        if (sequenceNumber < 1) {
          logger.warn('Invalid sequence number generated (< 1), using 1', { sequenceNumber, sessionId });
          sequenceNumber = 1;
        }
      } catch (seqError) {
        logger.error('Failed to get sequence number, using timestamp fallback', {
          sessionId,
          error: seqError
        });

        // ⭐ Last resort: use timestamp modulo to keep it reasonable
        // This guarantees a valid number even if all other methods fail
        sequenceNumber = Date.now() % 1000000;  // Modulo to keep it under 1 million

        logger.warn('Using timestamp-based sequence number', {
          sessionId,
          sequenceNumber,
          eventType
        });
      }

      const params: SqlParams = {
        id: eventId,
        session_id: sessionId,
        event_type: eventType,
        sequence_number: sequenceNumber,
        timestamp: timestamp,
        data: JSON.stringify(data),
        processed: false,
      };

      await executeQuery(
        `
        INSERT INTO message_events (id, session_id, event_type, sequence_number, timestamp, data, processed)
        VALUES (@id, @session_id, @event_type, @sequence_number, @timestamp, @data, @processed)
        `,
        params
      );

      logger.debug('Event appended to store', {
        eventId,
        sessionId,
        eventType,
        sequenceNumber,
      });

      return {
        id: eventId,
        session_id: sessionId,
        event_type: eventType,
        sequence_number: sequenceNumber,
        timestamp,
        data,
        processed: false,
      };
    } catch (error) {
      logger.error('Failed to append event', { error, sessionId, eventType });
      throw error;
    }
  }

  /**
   * Append Event with Pre-Assigned Sequence
   *
   * Used when sequences have been pre-reserved via MessageOrderingService.
   * This guarantees ordering even when async operations complete out-of-order.
   *
   * @param sessionId - Session ID
   * @param eventType - Type of event
   * @param data - Event data
   * @param preAssignedSequence - Pre-reserved sequence number
   * @returns Created event
   */
  public async appendEventWithSequence(
    sessionId: string,
    eventType: EventType,
    data: Record<string, unknown>,
    preAssignedSequence: number
  ): Promise<BaseEvent> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      const eventId = randomUUID();
      const timestamp = new Date();

      logger.info({
        sessionId,
        eventType,
        preAssignedSequence,
      }, 'Appending event with pre-assigned sequence');

      const params: SqlParams = {
        id: eventId,
        session_id: sessionId,
        event_type: eventType,
        sequence_number: preAssignedSequence,
        timestamp: timestamp,
        data: JSON.stringify(data),
        processed: false,
      };

      await executeQuery(
        `
        INSERT INTO message_events (id, session_id, event_type, sequence_number, timestamp, data, processed)
        VALUES (@id, @session_id, @event_type, @sequence_number, @timestamp, @data, @processed)
        `,
        params
      );

      logger.debug('Event appended with pre-assigned sequence', {
        eventId,
        sessionId,
        eventType,
        preAssignedSequence,
      });

      return {
        id: eventId,
        session_id: sessionId,
        event_type: eventType,
        sequence_number: preAssignedSequence,
        timestamp,
        data,
        processed: false,
      };
    } catch (error) {
      logger.error('Failed to append event with pre-assigned sequence', {
        error,
        sessionId,
        eventType,
        preAssignedSequence,
      });
      throw error;
    }
  }

  /**
   * Get Events for Session
   *
   * Returns all events for a session, ordered by sequence number.
   *
   * @param sessionId - Session ID
   * @param fromSequence - Optional: Start from this sequence number (inclusive)
   * @param toSequence - Optional: End at this sequence number (inclusive)
   * @returns Array of events
   */
  public async getEvents(
    sessionId: string,
    fromSequence?: number,
    toSequence?: number
  ): Promise<MessageEvent[]> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      let query = `
        SELECT id, session_id, event_type, sequence_number, timestamp, data, processed
        FROM message_events
        WHERE session_id = @session_id
      `;

      const params: SqlParams = { session_id: sessionId };

      if (fromSequence !== undefined) {
        query += ' AND sequence_number >= @from_seq';
        params.from_seq = fromSequence;
      }

      if (toSequence !== undefined) {
        query += ' AND sequence_number <= @to_seq';
        params.to_seq = toSequence;
      }

      query += ' ORDER BY sequence_number ASC';

      const result = await executeQuery<EventDbRow>(query, params);

      return (result.recordset || []).map((row) => ({
        id: row.id,
        session_id: row.session_id,
        event_type: row.event_type as EventType,
        sequence_number: row.sequence_number,
        timestamp: row.timestamp,
        data: JSON.parse(row.data),
        processed: row.processed,
      }));
    } catch (error) {
      logger.error('Failed to get events', { error, sessionId });
      throw error;
    }
  }

  /**
   * Mark Event as Processed
   *
   * @param eventId - Event ID
   */
  public async markAsProcessed(eventId: string): Promise<void> {
    try {
      await executeQuery(
        `
        UPDATE message_events
        SET processed = 1
        WHERE id = @id
        `,
        { id: eventId }
      );

      logger.debug('Event marked as processed', { eventId });
    } catch (error) {
      logger.error('Failed to mark event as processed', { error, eventId });
      throw error;
    }
  }

  /**
   * Get Unprocessed Events
   *
   * Returns events that haven't been processed yet (for recovery).
   *
   * @param sessionId - Optional: Filter by session ID
   * @returns Array of unprocessed events
   */
  public async getUnprocessedEvents(sessionId?: string): Promise<MessageEvent[]> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      let query = `
        SELECT id, session_id, event_type, sequence_number, timestamp, data, processed
        FROM message_events
        WHERE processed = 0
      `;

      const params: SqlParams = {};

      if (sessionId) {
        query += ' AND session_id = @session_id';
        params.session_id = sessionId;
      }

      query += ' ORDER BY timestamp ASC';

      const result = await executeQuery<EventDbRow>(query, params);

      return (result.recordset || []).map((row) => ({
        id: row.id,
        session_id: row.session_id,
        event_type: row.event_type as EventType,
        sequence_number: row.sequence_number,
        timestamp: row.timestamp,
        data: JSON.parse(row.data),
        processed: row.processed,
      }));
    } catch (error) {
      logger.error('Failed to get unprocessed events', { error, sessionId });
      throw error;
    }
  }

  /**
   * Get Next Sequence Number for Session
   *
   * Uses Redis INCR for atomic sequence number generation (multi-tenant safe).
   * Prevents race conditions in horizontal scaling scenarios.
   *
   * @param sessionId - Session ID
   * @returns Next sequence number
   */
  private async getNextSequenceNumber(sessionId: string): Promise<number> {
    try {
      const redis = getRedis();
      if (!redis) {
        logger.warn('Redis not available, falling back to database for sequence number', { sessionId });
        return this.fallbackToDatabase(sessionId);
      }

      const key = `event:sequence:${sessionId}`;

      // Redis INCR is atomic - perfect for distributed systems
      // Redis INCR starts at 1 on first call, which is what we want (1-indexed sequences)
      const sequenceNumber = await redis.incr(key);

      // Set TTL to 7 days (auto-cleanup for inactive sessions)
      await redis.expire(key, 7 * 24 * 60 * 60);

      // Return sequence number as-is (1-indexed: first event = 1, second = 2, etc.)
      return sequenceNumber;
    } catch (error) {
      logger.error('Failed to get next sequence number from Redis', { error, sessionId });

      // Fallback to database MAX+1 (slower, but guarantees correctness)
      logger.warn('Falling back to database for sequence number', { sessionId });
      return this.fallbackToDatabase(sessionId);
    }
  }

  /**
   * Fallback to database for sequence number generation
   *
   * Used when Redis is unavailable. Slower but guarantees correctness.
   *
   * @param sessionId - Session ID
   * @returns Next sequence number from database
   *
   * @warning TECHNICAL DEBT (QA Audit 2025-12-17):
   * This fallback is NOT ATOMIC and can cause DUPLICATE sequence numbers under concurrent load.
   *
   * Race condition scenario:
   * 1. Request A: SELECT MAX(sequence_number) -> 5
   * 2. Request B: SELECT MAX(sequence_number) -> 5 (before A's INSERT)
   * 3. Request A: INSERT with sequence_number = 6
   * 4. Request B: INSERT with sequence_number = 6 <- DUPLICATE!
   *
   * This happens when:
   * - Redis is temporarily unavailable (Azure maintenance, network timeout)
   * - High concurrency during Redis recovery
   *
   * Fix options for Phase 5:
   * - Option A: Use SERIALIZABLE isolation with UPDLOCK hint
   * - Option B: Use INSERT with OUTPUT to atomically get next sequence
   * - Option C: Implement optimistic locking with retry
   *
   * @see docs/plans/phase-3/README.md for full analysis
   * @todo Implement atomic fallback in Phase 5 refactoring
   */
  private async fallbackToDatabase(sessionId: string): Promise<number> {
    try {
      const result = await executeQuery<{ next_seq: number }>(
        `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
         FROM message_events
         WHERE session_id = @session_id`,
        { session_id: sessionId }
      );

      const nextSeq = result.recordset[0]?.next_seq ?? 1;

      logger.debug('Fallback to database successful', {
        sessionId,
        nextSequenceNumber: nextSeq
      });

      return nextSeq;
    } catch (dbError) {
      logger.error('Fallback to database also failed', { dbError, sessionId });

      // ⭐ Last resort: return 1 to start fresh sequence (1-indexed)
      // Using Date.now() would create huge gaps in sequence numbers
      // Better to start from 1 and let the session rebuild
      logger.warn('All sequence generation methods failed, starting from 1', { sessionId });

      return 1;
    }
  }

  /**
   * Replay Events
   *
   * Reconstructs state by replaying all events for a session.
   * Useful for debugging or recovering state after crash.
   *
   * @param sessionId - Session ID
   * @param handler - Callback function to handle each event
   */
  public async replayEvents(
    sessionId: string,
    handler: (event: MessageEvent) => void | Promise<void>
  ): Promise<void> {
    const events = await this.getEvents(sessionId);

    logger.info('Replaying events', { sessionId, eventCount: events.length });

    for (const event of events) {
      await handler(event);
    }

    logger.info('Event replay completed', { sessionId });
  }

  /**
   * Get Event Count for Session
   *
   * @param sessionId - Session ID
   * @returns Total number of events
   */
  public async getEventCount(sessionId: string): Promise<number> {
    try {
      const result = await executeQuery<{ count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM message_events
        WHERE session_id = @session_id
        `,
        { session_id: sessionId }
      );

      return result.recordset[0]?.count ?? 0;
    } catch (error) {
      logger.error('Failed to get event count', { error, sessionId });
      return 0;
    }
  }

  /**
   * Get Last Event ID for Session
   *
   * Returns the most recent event ID for a session.
   * Useful for correlation and parentEventId tracking.
   *
   * @param sessionId - Session ID
   * @returns Event ID or null if no events exist
   */
  public async getLastEventId(sessionId: string): Promise<string | null> {
    try {
      const result = await executeQuery<{ id: string }>(
        `
        SELECT TOP 1 id
        FROM message_events
        WHERE session_id = @session_id
        ORDER BY sequence_number DESC
        `,
        { session_id: sessionId }
      );

      return result.recordset[0]?.id ?? null;
    } catch (error) {
      logger.error('Failed to get last event ID', { error, sessionId });
      return null;
    }
  }

  /**
   * Get Last Sequence Number for Session
   *
   * Returns the highest sequence number for a session.
   * Useful for debugging and validation.
   *
   * @param sessionId - Session ID
   * @returns Sequence number or -1 if no events exist
   */
  public async getLastSequenceNumber(sessionId: string): Promise<number> {
    try {
      const result = await executeQuery<{ last_seq: number }>(
        `
        SELECT MAX(sequence_number) AS last_seq
        FROM message_events
        WHERE session_id = @session_id
        `,
        { session_id: sessionId }
      );

      return result.recordset[0]?.last_seq ?? -1;
    } catch (error) {
      logger.error('Failed to get last sequence number', { error, sessionId });
      return -1;
    }
  }
}

/**
 * Get EventStore singleton instance
 */
export function getEventStore(): EventStore {
  return EventStore.getInstance();
}

/**
 * Reset EventStore singleton (FOR TESTING ONLY)
 */
export function resetEventStore(): void {
  EventStore.reset();
}

