/**
 * MessageEmitter Tests
 *
 * Tests centralized WebSocket event emission with separation between
 * transient (streaming) events and persisted events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MessageEmitter,
  getMessageEmitter,
  resetMessageEmitter,
  type IMessageEmitter,
} from '@/services/agent/messages/MessageEmitter';
import type {
  EmittableEvent,
  EventCallback,
  ThinkingEventData,
  MessageEventData,
  ToolUseEventData,
  ToolResultEventData,
  TurnPausedEventData,
  ContentRefusedEventData,
  ToolUsePendingData,
  TokenUsage,
  StopReason,
} from '@/services/agent/messages/types';

describe('MessageEmitter', () => {
  let emitter: IMessageEmitter;
  let capturedEvents: EmittableEvent[];
  let mockCallback: EventCallback;

  beforeEach(() => {
    emitter = new MessageEmitter();
    capturedEvents = [];
    mockCallback = vi.fn((event: EmittableEvent) => {
      capturedEvents.push(event);
    });
  });

  afterEach(() => {
    resetMessageEmitter();
  });

  describe('Event Callback Management', () => {
    it('should set event callback', () => {
      emitter.setEventCallback(mockCallback);
      emitter.emitMessageChunk('test', 0);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should clear event callback', () => {
      emitter.setEventCallback(mockCallback);
      emitter.clearEventCallback();
      emitter.emitMessageChunk('test', 0);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should not emit events when no callback is set', () => {
      // No callback set
      emitter.emitMessageChunk('test', 0);
      expect(capturedEvents).toHaveLength(0);
    });
  });

  describe('Transient Events (no sequenceNumber)', () => {
    beforeEach(() => {
      emitter.setEventCallback(mockCallback);
    });

    it('should emit message_chunk event', () => {
      emitter.emitMessageChunk('Hello', 0);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('message_chunk');
      expect(event.content).toBe('Hello'); // Uses 'content' to match MessageChunkEvent interface
      expect(event.blockIndex).toBe(0);
      expect(event.persistenceState).toBe('transient');
      expect(event.sequenceNumber).toBeUndefined();
      expect(event.eventId).toBeDefined();
      // Timestamp is now ISO 8601 string (not Date object) for Socket.IO serialization
      expect(typeof event.timestamp).toBe('string');
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    });

    it('should emit thinking_chunk event', () => {
      emitter.emitThinkingChunk('Thinking...', 1);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('thinking_chunk');
      expect(event.content).toBe('Thinking...'); // Use 'content' to match ThinkingChunkEvent interface
      expect(event.blockIndex).toBe(1);
      expect(event.persistenceState).toBe('transient');
      expect(event.sequenceNumber).toBeUndefined();
    });

    it('should emit tool_use_pending event', () => {
      const pendingData: ToolUsePendingData = {
        toolName: 'listCustomers',
        toolUseId: 'toolu_123',
        blockIndex: 2,
      };

      emitter.emitToolUsePending(pendingData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('tool_use_pending');
      expect(event.toolName).toBe('listCustomers');
      expect(event.toolUseId).toBe('toolu_123');
      expect(event.blockIndex).toBe(2);
      expect(event.persistenceState).toBe('transient');
      expect(event.sequenceNumber).toBeUndefined();
    });

    it('should emit complete event with stopReason', () => {
      const stopReason: StopReason = 'end_turn';
      const tokenUsage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
      };

      emitter.emitComplete(stopReason, tokenUsage);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('complete');
      expect(event.stopReason).toBe('end_turn');
      expect(event.tokenUsage).toEqual(tokenUsage);
      expect(event.persistenceState).toBe('transient');
      expect(event.sequenceNumber).toBeUndefined();
    });

    it('should emit complete event without tokenUsage', () => {
      emitter.emitComplete('max_tokens');

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('complete');
      expect(event.stopReason).toBe('max_tokens');
      expect(event.tokenUsage).toBeUndefined();
      expect(event.persistenceState).toBe('transient');
    });

    it('should emit error event', () => {
      emitter.emitError('Something went wrong', 'ERR_TIMEOUT');

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('error');
      expect(event.error).toBe('Something went wrong');
      expect(event.code).toBe('ERR_TIMEOUT');
      expect(event.persistenceState).toBe('transient');
      expect(event.sequenceNumber).toBeUndefined();
    });

    it('should emit error event without code', () => {
      emitter.emitError('Generic error');

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('error');
      expect(event.error).toBe('Generic error');
      expect(event.code).toBeUndefined();
      expect(event.persistenceState).toBe('transient');
    });
  });

  describe('Persisted Events (require sequenceNumber)', () => {
    beforeEach(() => {
      emitter.setEventCallback(mockCallback);
    });

    it('should emit thinking event with sequence number', () => {
      const thinkingData: ThinkingEventData = {
        content: 'I am analyzing the request...',
        sequenceNumber: 10,
        eventId: 'evt_thinking_123',
      };

      emitter.emitThinking(thinkingData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('thinking');
      expect(event.content).toBe('I am analyzing the request...');
      expect(event.sequenceNumber).toBe(10);
      expect(event.eventId).toBe('evt_thinking_123');
      expect(event.persistenceState).toBe('persisted');
      // Timestamp is now ISO 8601 string (not Date object) for Socket.IO serialization
      expect(typeof event.timestamp).toBe('string');
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    });

    it('should emit message event with all fields', () => {
      const messageData: MessageEventData = {
        content: 'Here is your answer',
        messageId: 'msg_123',
        role: 'assistant',
        stopReason: 'end_turn',
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        model: 'claude-sonnet-4-5-20250929',
        sequenceNumber: 20,
        eventId: 'evt_message_123',
        metadata: { type: 'max_tokens_warning' },
      };

      emitter.emitMessage(messageData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('message');
      expect(event.content).toBe('Here is your answer');
      expect(event.messageId).toBe('msg_123');
      expect(event.role).toBe('assistant');
      expect(event.stopReason).toBe('end_turn');
      expect(event.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(event.model).toBe('claude-sonnet-4-5-20250929');
      expect(event.sequenceNumber).toBe(20);
      expect(event.eventId).toBe('evt_message_123');
      expect(event.persistenceState).toBe('persisted');
      expect(event.metadata).toEqual({ type: 'max_tokens_warning' });
    });

    it('should emit tool_use event', () => {
      const toolUseData: ToolUseEventData = {
        toolUseId: 'toolu_456',
        toolName: 'getCustomer',
        args: { customer_id: '123' },
        blockIndex: 1,
        sequenceNumber: 30,
        eventId: 'evt_tool_use_123',
      };

      emitter.emitToolUse(toolUseData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('tool_use');
      expect(event.toolUseId).toBe('toolu_456');
      expect(event.toolName).toBe('getCustomer');
      expect(event.args).toEqual({ customer_id: '123' });
      expect(event.blockIndex).toBe(1);
      expect(event.sequenceNumber).toBe(30);
      expect(event.eventId).toBe('evt_tool_use_123');
      expect(event.persistenceState).toBe('persisted');
    });

    it('should emit tool_result event with success', () => {
      const toolResultData: ToolResultEventData = {
        toolUseId: 'toolu_456',
        toolName: 'getCustomer',
        args: { customer_id: '123' },
        result: { name: 'John Doe', id: '123' },
        success: true,
        sequenceNumber: 40,
        eventId: 'evt_tool_result_123',
        durationMs: 250,
      };

      emitter.emitToolResult(toolResultData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('tool_result');
      expect(event.toolUseId).toBe('toolu_456');
      expect(event.toolName).toBe('getCustomer');
      expect(event.result).toEqual({ name: 'John Doe', id: '123' });
      expect(event.success).toBe(true);
      expect(event.sequenceNumber).toBe(40);
      expect(event.durationMs).toBe(250);
      expect(event.persistenceState).toBe('persisted');
    });

    it('should emit tool_result event with error', () => {
      const toolResultData: ToolResultEventData = {
        toolUseId: 'toolu_789',
        toolName: 'deleteCustomer',
        args: { customer_id: '999' },
        result: null,
        success: false,
        error: 'Customer not found',
        sequenceNumber: 50,
        eventId: 'evt_tool_result_error_123',
        durationMs: 100,
      };

      emitter.emitToolResult(toolResultData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('tool_result');
      expect(event.success).toBe(false);
      expect(event.error).toBe('Customer not found');
      expect(event.sequenceNumber).toBe(50);
      expect(event.persistenceState).toBe('persisted');
    });

    it('should emit turn_paused event', () => {
      const turnPausedData: TurnPausedEventData = {
        reason: 'User approval required',
        turnCount: 3,
        sequenceNumber: 60,
        eventId: 'evt_turn_paused_123',
      };

      emitter.emitTurnPaused(turnPausedData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('turn_paused');
      expect(event.reason).toBe('User approval required');
      expect(event.turnCount).toBe(3);
      expect(event.sequenceNumber).toBe(60);
      expect(event.eventId).toBe('evt_turn_paused_123');
      expect(event.persistenceState).toBe('persisted');
    });

    it('should emit content_refused event', () => {
      const refusedData: ContentRefusedEventData = {
        reason: 'Policy violation detected',
        sequenceNumber: 70,
        eventId: 'evt_refused_123',
      };

      emitter.emitContentRefused(refusedData);

      expect(capturedEvents).toHaveLength(1);
      const event = capturedEvents[0];
      expect(event.type).toBe('content_refused');
      expect(event.reason).toBe('Policy violation detected');
      expect(event.sequenceNumber).toBe(70);
      expect(event.eventId).toBe('evt_refused_123');
      expect(event.persistenceState).toBe('persisted');
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getMessageEmitter', () => {
      const instance1 = getMessageEmitter();
      const instance2 = getMessageEmitter();
      expect(instance1).toBe(instance2);
    });

    it('should clear callback on reset', () => {
      const instance = getMessageEmitter();
      instance.setEventCallback(mockCallback);
      resetMessageEmitter();

      // Get new instance after reset
      const newInstance = getMessageEmitter();
      newInstance.emitMessageChunk('test', 0);

      // Old callback should not be called
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should return fresh instance after reset', () => {
      const instance1 = getMessageEmitter();
      resetMessageEmitter();
      const instance2 = getMessageEmitter();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Event ID and Timestamp', () => {
    beforeEach(() => {
      emitter.setEventCallback(mockCallback);
    });

    it('should generate unique eventIds for transient events', () => {
      emitter.emitMessageChunk('chunk1', 0);
      emitter.emitMessageChunk('chunk2', 0);

      expect(capturedEvents).toHaveLength(2);
      expect(capturedEvents[0]?.eventId).toBeDefined();
      expect(capturedEvents[1]?.eventId).toBeDefined();
      expect(capturedEvents[0]?.eventId).not.toBe(capturedEvents[1]?.eventId);
    });

    it('should use provided eventId for persisted events', () => {
      const thinkingData: ThinkingEventData = {
        content: 'test',
        sequenceNumber: 1,
        eventId: 'custom_event_id',
      };

      emitter.emitThinking(thinkingData);

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]?.eventId).toBe('custom_event_id');
    });

    it('should generate timestamp for all events', () => {
      const before = new Date();
      emitter.emitMessageChunk('test', 0);
      const after = new Date();

      expect(capturedEvents).toHaveLength(1);
      const timestamp = capturedEvents[0]?.timestamp;
      // Timestamp is now ISO 8601 string (not Date object) for Socket.IO serialization
      expect(typeof timestamp).toBe('string');
      const timestampDate = new Date(timestamp);
      expect(timestampDate.toISOString()).toBe(timestamp);
      expect(timestampDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestampDate.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
