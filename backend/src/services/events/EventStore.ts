/**
 * Event Store Service
 *
 * Implements Event Sourcing pattern for message persistence.
 * All message-related events are stored as immutable append-only logs.
 *
 * Pattern:
 * - Events are append-only (never updated or deleted)
 * - Each event has a sequence number for ordering
 * - Events can be replayed to reconstruct state
 * - Supports real-time streaming and historical replay
 *
 * @module services/events/EventStore
 */

import { executeQuery, getDatabase, SqlParams } from '@/config/database';
import { randomUUID } from 'crypto';
import { logger } from '@/utils/logger';

/**
 * Event Type - All possible message events
 */
export type EventType =
  | 'user_message_sent'
  | 'agent_thinking_started'
  | 'agent_thinking_completed'
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
  };
}

/**
 * Agent Message Chunk Event
 */
export interface AgentMessageChunkEvent extends Omit<BaseEvent, 'event_type' | 'data'> {
  event_type: 'agent_message_chunk';
  data: {
    chunk: string;
    is_final: boolean;
  };
}

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
 * Discriminated Union of all events
 */
export type MessageEvent =
  | UserMessageEvent
  | AgentMessageEvent
  | AgentMessageChunkEvent
  | ToolUseEvent
  | ToolResultEvent
  | BaseEvent;

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
   * Append Event to Store
   *
   * Events are immutable and append-only.
   * Sequence number is auto-generated based on session.
   *
   * @param sessionId - Session ID
   * @param eventType - Type of event
   * @param data - Event data (JSON-serializable)
   * @returns Created event
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
      const sequenceNumber = await this.getNextSequenceNumber(sessionId);

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

      const result = await executeQuery(query, params);

      return result.recordset.map((row) => ({
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

      const result = await executeQuery(query, params);

      return result.recordset.map((row) => ({
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
   * Auto-increments sequence number for ordering.
   *
   * @param sessionId - Session ID
   * @returns Next sequence number
   */
  private async getNextSequenceNumber(sessionId: string): Promise<number> {
    try {
      const result = await executeQuery(
        `
        SELECT COALESCE(MAX(sequence_number), -1) + 1 AS next_seq
        FROM message_events
        WHERE session_id = @session_id
        `,
        { session_id: sessionId }
      );

      return result.recordset[0]?.next_seq ?? 0;
    } catch (error) {
      logger.error('Failed to get next sequence number', { error, sessionId });
      // Default to 0 if error (first event in session)
      return 0;
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
      const result = await executeQuery(
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
}

/**
 * Get EventStore singleton instance
 */
export function getEventStore(): EventStore {
  return EventStore.getInstance();
}
