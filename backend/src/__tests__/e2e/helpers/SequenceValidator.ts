/**
 * SequenceValidator - Validates Event Ordering in E2E Tests
 *
 * Provides utilities for validating that events are received in the
 * correct order, with proper sequence numbers, and without gaps.
 *
 * @module __tests__/e2e/helpers/SequenceValidator
 */

import type { AgentEvent } from '@/types/websocket.types';
import type { E2EReceivedEvent } from './E2ETestClient';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Message from database for consistency check
 */
export interface DatabaseMessage {
  id: string;
  sequenceNumber: number | null;
  role: string;
  messageType: string;
  content?: string;
}

/**
 * Database event from message_events table
 */
export interface DatabaseEvent {
  id: string;
  event_type: string;
  sequence_number: number;
  data?: Record<string, unknown>;
  timestamp?: Date;
}

/**
 * SequenceValidator - Validates event ordering
 */
export class SequenceValidator {
  /**
   * Validate that events have monotonically increasing sequence numbers
   */
  static validateSequenceOrder(events: (AgentEvent | E2EReceivedEvent)[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Extract events with sequence numbers
    const eventsWithSequence = events
      .map(e => {
        // Handle both E2EReceivedEvent (with data property) and direct AgentEvent
        const event = 'data' in e && e.data != null ? e.data : ('type' in e ? e : null);
        if (!event || typeof event !== 'object' || !('type' in event)) {
          return null; // Skip non-AgentEvent events
        }
        const agentEvent = event as AgentEvent & { sequenceNumber?: number };
        return {
          type: agentEvent.type,
          sequenceNumber: agentEvent.sequenceNumber,
          timestamp: 'timestamp' in e ? e.timestamp : new Date(),
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null && e.sequenceNumber !== undefined);

    if (eventsWithSequence.length === 0) {
      warnings.push('No events with sequence numbers found');
      return { valid: true, errors, warnings };
    }

    // Check monotonically increasing
    let lastSequence = -1;
    for (const event of eventsWithSequence) {
      if (event.sequenceNumber !== undefined && event.sequenceNumber <= lastSequence) {
        errors.push(
          `Sequence out of order: ${event.type} has sequence ${event.sequenceNumber} ` +
          `but previous was ${lastSequence}`
        );
      }
      lastSequence = event.sequenceNumber ?? lastSequence;
    }

    // Check for gaps
    const sequences = eventsWithSequence
      .map(e => e.sequenceNumber!)
      .sort((a, b) => a - b);

    for (let i = 1; i < sequences.length; i++) {
      const prev = sequences[i - 1];
      const curr = sequences[i];
      if (prev !== undefined && curr !== undefined && curr - prev > 1) {
        warnings.push(
          `Gap in sequence numbers: ${prev} -> ${curr} (missing ${curr - prev - 1} events)`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate that events follow the expected streaming order
   *
   * Expected order for a typical message:
   * 1. user_message_confirmed
   * 2. thinking (optional)
   * 3. thinking_chunk* (multiple, optional)
   * 4. message_chunk* (multiple)
   * 5. tool_use (optional)
   * 6. tool_result (optional)
   * 7. message
   * 8. complete
   */
  static validateStreamingOrder(events: AgentEvent[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Define valid transitions
    const validTransitions: Record<string, string[]> = {
      'start': ['user_message_confirmed', 'thinking', 'message_chunk', 'message', 'error'],
      'user_message_confirmed': ['thinking', 'message_chunk', 'message', 'error'],
      'thinking': ['thinking_chunk', 'message_chunk', 'message', 'tool_use', 'error', 'complete'],
      'thinking_chunk': ['thinking_chunk', 'message_chunk', 'message', 'tool_use', 'error'],
      'message_chunk': ['message_chunk', 'message', 'tool_use', 'error', 'thinking'],
      'message': ['tool_use', 'complete', 'error', 'message_chunk', 'thinking', 'message'],
      'tool_use': ['tool_result', 'approval_requested', 'error'],
      'tool_result': ['message_chunk', 'message', 'tool_use', 'complete', 'error', 'thinking'],
      'approval_requested': ['approval_resolved', 'error'],
      'approval_resolved': ['tool_result', 'error'],
      'complete': [],
      'error': ['complete'],
    };

    let lastType = 'start';
    for (const event of events) {
      const currentType = event.type;
      const validNext = validTransitions[lastType];

      if (!validNext) {
        errors.push(`Unknown event type: ${lastType}`);
        continue;
      }

      if (!validNext.includes(currentType)) {
        warnings.push(
          `Unexpected transition: ${lastType} -> ${currentType}. ` +
          `Expected one of: ${validNext.join(', ')}`
        );
      }

      lastType = currentType;
    }

    // Check that we ended properly
    if (lastType !== 'complete' && lastType !== 'error') {
      warnings.push(`Stream did not end with 'complete' or 'error'. Last event: ${lastType}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate database consistency with received events
   */
  static validateDatabaseConsistency(
    events: AgentEvent[],
    dbMessages: DatabaseMessage[]
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Get persisted events (those with sequence numbers)
    const persistedEvents = events.filter(e => {
      const event = e as AgentEvent & { sequenceNumber?: number; persistenceState?: string };
      return event.sequenceNumber !== undefined || event.persistenceState === 'persisted';
    });

    // Check each persisted event has a corresponding DB record
    for (const event of persistedEvents) {
      const eventWithSeq = event as AgentEvent & { sequenceNumber?: number };
      if (eventWithSeq.sequenceNumber === undefined) continue;

      const dbMatch = dbMessages.find(m => m.sequenceNumber === eventWithSeq.sequenceNumber);
      if (!dbMatch) {
        errors.push(
          `Event with sequence ${eventWithSeq.sequenceNumber} (${event.type}) ` +
          `not found in database`
        );
      }
    }

    // Check for orphaned DB messages
    const eventSequences = new Set(
      persistedEvents
        .map(e => (e as AgentEvent & { sequenceNumber?: number }).sequenceNumber)
        .filter(s => s !== undefined)
    );

    for (const dbMsg of dbMessages) {
      if (dbMsg.sequenceNumber !== null && !eventSequences.has(dbMsg.sequenceNumber)) {
        warnings.push(
          `Database message with sequence ${dbMsg.sequenceNumber} ` +
          `not matched to any event`
        );
      }
    }

    // Verify message counts roughly match
    const eventCount = persistedEvents.length;
    const dbCount = dbMessages.length;
    if (Math.abs(eventCount - dbCount) > 2) {
      warnings.push(
        `Significant count mismatch: ${eventCount} events vs ${dbCount} DB messages`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate tool_use and tool_result correlation
   */
  static validateToolCorrelation(events: AgentEvent[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Collect tool_use events
    const toolUses = new Map<string, AgentEvent>();
    const toolResults = new Map<string, AgentEvent>();

    for (const event of events) {
      const eventWithToolId = event as AgentEvent & { toolUseId?: string };

      if (event.type === 'tool_use' && eventWithToolId.toolUseId) {
        toolUses.set(eventWithToolId.toolUseId, event);
      }

      if (event.type === 'tool_result' && eventWithToolId.toolUseId) {
        toolResults.set(eventWithToolId.toolUseId, event);
      }
    }

    // Check each tool_use has a tool_result
    for (const [toolUseId, _toolUse] of toolUses) {
      if (!toolResults.has(toolUseId)) {
        errors.push(`tool_use ${toolUseId} has no corresponding tool_result`);
      }
    }

    // Check each tool_result has a tool_use
    for (const [toolUseId, _toolResult] of toolResults) {
      if (!toolUses.has(toolUseId)) {
        warnings.push(`tool_result ${toolUseId} has no corresponding tool_use`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Compare WebSocket events with database events for source of truth verification
   * @param wsEvents - Events received via WebSocket
   * @param dbEvents - Events queried from message_events table
   * @returns Comparison result with matched, ws-only, and db-only events
   */
  static compareWebSocketWithDatabase(
    wsEvents: AgentEvent[],
    dbEvents: DatabaseEvent[]
  ): {
    matched: number;
    wsOnly: AgentEvent[];
    dbOnly: DatabaseEvent[];
    sequenceMismatches: Array<{ eventId: string; wsSequence?: number; dbSequence: number }>;
  } {
    // Only consider WS events that have sequence numbers (persisted events)
    const persistedWsEvents = wsEvents.filter(e => {
      const event = e as AgentEvent & { sequenceNumber?: number; eventId?: string };
      return event.sequenceNumber !== undefined && event.eventId !== undefined;
    });

    // Create maps for efficient lookup
    const wsEventMap = new Map<string, AgentEvent & { sequenceNumber: number; eventId: string }>();
    for (const event of persistedWsEvents) {
      const e = event as AgentEvent & { sequenceNumber: number; eventId: string };
      wsEventMap.set(e.eventId, e);
    }

    const dbEventMap = new Map<string, DatabaseEvent>();
    for (const dbEvent of dbEvents) {
      dbEventMap.set(dbEvent.id, dbEvent);
    }

    // Find matches and mismatches
    let matched = 0;
    const sequenceMismatches: Array<{ eventId: string; wsSequence?: number; dbSequence: number }> = [];

    for (const [eventId, wsEvent] of wsEventMap) {
      const dbEvent = dbEventMap.get(eventId);
      if (dbEvent) {
        matched++;
        // Check if sequence numbers match
        if (wsEvent.sequenceNumber !== dbEvent.sequence_number) {
          sequenceMismatches.push({
            eventId,
            wsSequence: wsEvent.sequenceNumber,
            dbSequence: dbEvent.sequence_number,
          });
        }
      }
    }

    // Find WS-only events (in WS but not in DB)
    const wsOnly = persistedWsEvents.filter(e => {
      const event = e as AgentEvent & { eventId?: string };
      return event.eventId && !dbEventMap.has(event.eventId);
    });

    // Find DB-only events (in DB but not in WS)
    const dbOnly = dbEvents.filter(dbEvent => !wsEventMap.has(dbEvent.id));

    return {
      matched,
      wsOnly,
      dbOnly,
      sequenceMismatches,
    };
  }

  /**
   * Validate that events have correct persistenceState based on their type
   *
   * Transient events (no sequenceNumber): message_chunk, thinking_chunk, complete, error, session_start, session_end
   * Persisted events (with sequenceNumber): user_message_confirmed, thinking, message, tool_use, tool_result,
   *                                         approval_requested, approval_resolved, turn_paused, content_refused
   */
  static validatePersistenceStates(events: AgentEvent[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const TRANSIENT_TYPES = [
      'message_chunk',
      'thinking_chunk',
      'complete',
      'error',
      'session_start',
      'session_end',
    ];

    const PERSISTED_TYPES = [
      'user_message_confirmed',
      'thinking',
      'message',
      'tool_use',
      'tool_result',
      'approval_requested',
      'approval_resolved',
      'turn_paused',
      'content_refused',
    ];

    for (const event of events) {
      const eventWithState = event as AgentEvent & {
        persistenceState?: string;
        sequenceNumber?: number
      };

      const eventType = event.type;
      const persistenceState = eventWithState.persistenceState;
      const sequenceNumber = eventWithState.sequenceNumber;

      // Check transient events
      if (TRANSIENT_TYPES.includes(eventType)) {
        if (persistenceState !== 'transient') {
          errors.push(
            `Event type '${eventType}' should have persistenceState='transient' ` +
            `but has '${persistenceState}'`
          );
        }
        if (sequenceNumber !== undefined) {
          errors.push(
            `Event type '${eventType}' is transient and should not have sequenceNumber, ` +
            `but has sequenceNumber=${sequenceNumber}`
          );
        }
      }

      // Check persisted events
      if (PERSISTED_TYPES.includes(eventType)) {
        if (persistenceState !== 'persisted') {
          errors.push(
            `Event type '${eventType}' should have persistenceState='persisted' ` +
            `but has '${persistenceState}'`
          );
        }
        if (sequenceNumber === undefined) {
          errors.push(
            `Event type '${eventType}' is persisted and should have sequenceNumber, ` +
            `but sequenceNumber is undefined`
          );
        }
      }

      // Warn about unknown event types
      if (!TRANSIENT_TYPES.includes(eventType) && !PERSISTED_TYPES.includes(eventType)) {
        warnings.push(
          `Unknown event type '${eventType}' - cannot validate persistence state`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get a summary of event types in order
   */
  static getEventSummary(events: AgentEvent[]): string[] {
    return events.map(e => {
      const event = e as AgentEvent & { sequenceNumber?: number };
      const seq = event.sequenceNumber !== undefined ? `[${event.sequenceNumber}]` : '';
      return `${e.type}${seq}`;
    });
  }

  /**
   * Assert all validations pass (throws on failure)
   */
  static assertValid(
    events: AgentEvent[],
    options?: {
      checkSequence?: boolean;
      checkStreamingOrder?: boolean;
      checkToolCorrelation?: boolean;
      dbMessages?: DatabaseMessage[];
    }
  ): void {
    const allErrors: string[] = [];

    if (options?.checkSequence !== false) {
      const result = this.validateSequenceOrder(events);
      allErrors.push(...result.errors);
    }

    if (options?.checkStreamingOrder) {
      const result = this.validateStreamingOrder(events);
      allErrors.push(...result.errors);
    }

    if (options?.checkToolCorrelation) {
      const result = this.validateToolCorrelation(events);
      allErrors.push(...result.errors);
    }

    if (options?.dbMessages) {
      const result = this.validateDatabaseConsistency(events, options.dbMessages);
      allErrors.push(...result.errors);
    }

    if (allErrors.length > 0) {
      throw new Error(`Event validation failed:\n${allErrors.join('\n')}`);
    }
  }
}
