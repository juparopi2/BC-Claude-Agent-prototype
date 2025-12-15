/**
 * MessageEmitter
 *
 * Centralized service for all WebSocket event emission.
 * Separates transient (streaming) events from persisted events.
 *
 * Transient events: No sequence number, high frequency (chunks)
 * Persisted events: Require sequence number from EventStore
 *
 * @module services/agent/messages/MessageEmitter
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/utils/logger';
import type { CitedFile } from '@bc-agent/shared';
import type {
  EventCallback,
  EmittableEvent,
  StopReason,
  TokenUsage,
  ThinkingEventData,
  MessageEventData,
  ToolUseEventData,
  ToolResultEventData,
  TurnPausedEventData,
  ContentRefusedEventData,
  ToolUsePendingData,
} from './types';

const logger = createChildLogger({ service: 'MessageEmitter' });

/**
 * Interface for MessageEmitter
 */
export interface IMessageEmitter {
  /** Set the callback function for emitting events */
  setEventCallback(callback: EventCallback): void;

  /** Clear the event callback */
  clearEventCallback(): void;

  // ============================================================================
  // Transient Events (high frequency, no persistence)
  // ============================================================================

  /** Emit a message chunk during streaming */
  emitMessageChunk(chunk: string, blockIndex: number, sessionId?: string): void;

  /** Emit a thinking chunk during streaming */
  emitThinkingChunk(chunk: string, blockIndex: number, sessionId?: string): void;

  /** Emit tool use pending state (early signal before persistence) */
  emitToolUsePending(data: ToolUsePendingData): void;

  /** Emit completion event */
  emitComplete(stopReason: StopReason, tokenUsage?: TokenUsage, sessionId?: string, citedFiles?: CitedFile[]): void;

  /** Emit error event */
  emitError(error: string, code?: string, sessionId?: string): void;

  // ============================================================================
  // Persisted Events (require sequence number from EventStore)
  // ============================================================================

  /** Emit thinking block (persisted) */
  emitThinking(data: ThinkingEventData): void;

  /** Emit message (persisted) */
  emitMessage(data: MessageEventData): void;

  /** Emit tool use (persisted) */
  emitToolUse(data: ToolUseEventData): void;

  /** Emit tool result (persisted) */
  emitToolResult(data: ToolResultEventData): void;

  /** Emit turn paused (persisted) */
  emitTurnPaused(data: TurnPausedEventData): void;

  /** Emit content refused (persisted) */
  emitContentRefused(data: ContentRefusedEventData): void;
}

/**
 * MessageEmitter implementation
 *
 * Singleton service that centralizes all WebSocket event emission.
 * Uses dependency injection for the event callback to decouple from
 * ChatMessageHandler.
 */
export class MessageEmitter implements IMessageEmitter {
  private eventCallback: EventCallback | null = null;

  /**
   * Set the callback function for emitting events
   * @param callback - Function to call with each event
   */
  setEventCallback(callback: EventCallback): void {
    this.eventCallback = callback;
    logger.debug('Event callback set');
  }

  /**
   * Clear the event callback
   */
  clearEventCallback(): void {
    this.eventCallback = null;
    logger.debug('Event callback cleared');
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Emit an event through the callback
   * @param event - The event to emit
   */
  private emit(event: EmittableEvent): void {
    if (!this.eventCallback) {
      logger.warn({ eventType: event.type }, 'No event callback set, event dropped');
      return;
    }
    this.eventCallback(event);
  }

  /**
   * Create a transient event (no sequence number)
   */
  private createTransientEvent(
    type: string,
    data: Record<string, unknown>
  ): EmittableEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      eventId: randomUUID(),
      persistenceState: 'transient',
      ...data,
    };
  }

  // ============================================================================
  // Transient Events
  // ============================================================================

  /**
   * Emit a message chunk during streaming
   */
  emitMessageChunk(chunk: string, blockIndex: number, sessionId?: string): void {
    const event = this.createTransientEvent('message_chunk', {
      content: chunk, // Use 'content' to match MessageChunkEvent interface
      blockIndex,
      sessionId,
    });
    logger.trace({ blockIndex, chunkLength: chunk.length }, 'Emitting message chunk');
    this.emit(event);
  }

  /**
   * Emit a thinking chunk during streaming
   */
  emitThinkingChunk(chunk: string, blockIndex: number, sessionId?: string): void {
    const event = this.createTransientEvent('thinking_chunk', {
      content: chunk,
      blockIndex,
      sessionId,
    });
    logger.trace({ blockIndex, chunkLength: chunk.length }, 'Emitting thinking chunk');
    this.emit(event);
  }

  /**
   * Emit tool use pending state (early signal before persistence)
   */
  emitToolUsePending(data: ToolUsePendingData): void {
    const event = this.createTransientEvent('tool_use_pending', {
      toolName: data.toolName,
      toolUseId: data.toolUseId,
      blockIndex: data.blockIndex,
    });
    logger.debug(
      { toolName: data.toolName, toolUseId: data.toolUseId },
      'Emitting tool use pending'
    );
    this.emit(event);
  }

  /**
   * Emit completion event
   */
  emitComplete(stopReason: StopReason, tokenUsage?: TokenUsage, sessionId?: string, citedFiles?: CitedFile[]): void {
    // Map Anthropic stop_reason to CompleteEvent reason format
    let reason: 'success' | 'error' | 'max_turns' | 'user_cancelled' = 'success';

    if (stopReason === 'end_turn') {
      reason = 'success';
    } else if (stopReason === 'max_tokens') {
      reason = 'max_turns';
    } else if (stopReason === 'stop_sequence') {
      reason = 'user_cancelled';
    } else {
      // For tool_use, pause_turn, refusal - treat as success (streaming will continue)
      reason = 'success';
    }

    const event = this.createTransientEvent('complete', {
      reason, // Use 'reason' to match CompleteEvent interface
      stopReason, // Keep stopReason for backward compatibility
      tokenUsage,
      sessionId,
      citedFiles: citedFiles && citedFiles.length > 0 ? citedFiles : undefined,
    });
    logger.debug({ reason, stopReason, citedFilesCount: citedFiles?.length ?? 0 }, 'Emitting complete');
    this.emit(event);
  }

  /**
   * Emit error event
   */
  emitError(error: string, code?: string, sessionId?: string): void {
    const event = this.createTransientEvent('error', {
      error,
      code,
      sessionId,
    });
    logger.error({ error, code }, 'Emitting error');
    this.emit(event);
  }

  // ============================================================================
  // Persisted Events
  // ============================================================================

  /**
   * Emit thinking block (persisted)
   */
  emitThinking(data: ThinkingEventData): void {
    const event: EmittableEvent = {
      type: 'thinking',
      timestamp: new Date().toISOString(),
      eventId: data.eventId,
      persistenceState: 'persisted',
      sequenceNumber: data.sequenceNumber,
      content: data.content,
      sessionId: data.sessionId,
    };
    logger.debug(
      { sequenceNumber: data.sequenceNumber, contentLength: data.content.length },
      'Emitting thinking'
    );
    this.emit(event);
  }

  /**
   * Emit message (persisted)
   */
  emitMessage(data: MessageEventData): void {
    const event: EmittableEvent = {
      type: 'message',
      timestamp: new Date().toISOString(),
      eventId: data.eventId,
      persistenceState: 'persisted',
      sequenceNumber: data.sequenceNumber,
      content: data.content,
      messageId: data.messageId,
      role: data.role,
      stopReason: data.stopReason,
      tokenUsage: data.tokenUsage,
      model: data.model,
      metadata: data.metadata,
      sessionId: data.sessionId,
    };
    logger.debug(
      {
        sequenceNumber: data.sequenceNumber,
        role: data.role,
        messageId: data.messageId,
        contentLength: data.content.length,
      },
      'Emitting message'
    );
    this.emit(event);
  }

  /**
   * Emit tool use (persisted)
   */
  emitToolUse(data: ToolUseEventData): void {
    const event: EmittableEvent = {
      type: 'tool_use',
      timestamp: new Date().toISOString(),
      eventId: data.eventId,
      persistenceState: 'persisted',
      sequenceNumber: data.sequenceNumber,
      toolUseId: data.toolUseId,
      toolName: data.toolName,
      args: data.args,
      blockIndex: data.blockIndex,
      sessionId: data.sessionId,
    };
    logger.debug(
      {
        sequenceNumber: data.sequenceNumber,
        toolName: data.toolName,
        toolUseId: data.toolUseId,
      },
      'Emitting tool use'
    );
    this.emit(event);
  }

  /**
   * Emit tool result (persisted)
   */
  emitToolResult(data: ToolResultEventData): void {
    const event: EmittableEvent = {
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      eventId: data.eventId,
      persistenceState: 'persisted',
      sequenceNumber: data.sequenceNumber,
      toolUseId: data.toolUseId,
      toolName: data.toolName,
      args: data.args,
      result: data.result,
      success: data.success,
      error: data.error,
      durationMs: data.durationMs,
      sessionId: data.sessionId,
    };
    logger.debug(
      {
        sequenceNumber: data.sequenceNumber,
        toolName: data.toolName,
        toolUseId: data.toolUseId,
        success: data.success,
        durationMs: data.durationMs,
      },
      'Emitting tool result'
    );
    this.emit(event);
  }

  /**
   * Emit turn paused (persisted)
   */
  emitTurnPaused(data: TurnPausedEventData): void {
    const event: EmittableEvent = {
      type: 'turn_paused',
      timestamp: new Date().toISOString(),
      eventId: data.eventId,
      persistenceState: 'persisted',
      sequenceNumber: data.sequenceNumber,
      reason: data.reason,
      turnCount: data.turnCount,
      sessionId: data.sessionId,
    };
    logger.debug(
      { sequenceNumber: data.sequenceNumber, reason: data.reason, turnCount: data.turnCount },
      'Emitting turn paused'
    );
    this.emit(event);
  }

  /**
   * Emit content refused (persisted)
   */
  emitContentRefused(data: ContentRefusedEventData): void {
    const event: EmittableEvent = {
      type: 'content_refused',
      timestamp: new Date().toISOString(),
      eventId: data.eventId,
      persistenceState: 'persisted',
      sequenceNumber: data.sequenceNumber,
      reason: data.reason,
      sessionId: data.sessionId,
    };
    logger.debug(
      { sequenceNumber: data.sequenceNumber, reason: data.reason },
      'Emitting content refused'
    );
    this.emit(event);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let messageEmitterInstance: MessageEmitter | null = null;

/**
 * Get the MessageEmitter singleton instance
 */
export function getMessageEmitter(): MessageEmitter {
  if (!messageEmitterInstance) {
    messageEmitterInstance = new MessageEmitter();
    logger.info('MessageEmitter singleton created');
  }
  return messageEmitterInstance;
}

/**
 * Reset the MessageEmitter singleton (for testing)
 */
export function resetMessageEmitter(): void {
  if (messageEmitterInstance) {
    messageEmitterInstance.clearEventCallback();
  }
  messageEmitterInstance = null;
  logger.debug('MessageEmitter singleton reset');
}
