/**
 * @module PersistenceCoordinator.test
 * Unit tests for PersistenceCoordinator.
 * Tests the coordination of EventStore + MessageQueue for persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  PersistenceCoordinator,
  getPersistenceCoordinator,
  __resetPersistenceCoordinator,
  type AgentMessageData,
  type ThinkingData,
  type ToolUseData,
  type ToolResultData,
  type ErrorData,
  type ToolExecution,
  type IPersistenceErrorAnalyzer,
} from '@/domains/agent/persistence';
import type { EventStore, BaseEvent } from '@services/events/EventStore';
import type { MessageQueue } from '@/infrastructure/queue/MessageQueue';

// Mock external services to prevent Redis connections
vi.mock('@services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue({
      id: 'mock-event-id',
      session_id: 'mock-session',
      event_type: 'user_message_sent',
      sequence_number: 1,
      timestamp: new Date(),
      data: {},
      processed: false,
    }),
  })),
  EventStore: vi.fn(),
}));

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn().mockResolvedValue('mock-job-id'),
  })),
  MessageQueue: vi.fn(),
}));

describe('PersistenceCoordinator', () => {
  // Mock dependencies
  let mockEventStore: {
    appendEvent: Mock;
  };
  let mockMessageQueue: {
    addMessagePersistence: Mock;
  };
  let mockErrorAnalyzer: IPersistenceErrorAnalyzer;

  let coordinator: PersistenceCoordinator;

  beforeEach(() => {
    // Reset singleton
    __resetPersistenceCoordinator();

    // Create mocks
    mockEventStore = {
      appendEvent: vi.fn(),
    };

    mockMessageQueue = {
      addMessagePersistence: vi.fn(),
    };

    mockErrorAnalyzer = {
      analyze: vi.fn().mockReturnValue(['UNKNOWN: Error']),
      getDetailedAnalysis: vi.fn(),
    };

    // Default mock return values
    mockEventStore.appendEvent.mockResolvedValue({
      id: 'event-123',
      session_id: 'session-1',
      event_type: 'user_message_sent',
      sequence_number: 42,
      timestamp: new Date('2025-12-22T10:00:00Z'),
      data: {},
      processed: false,
    } as BaseEvent);

    mockMessageQueue.addMessagePersistence.mockResolvedValue('job-123');

    // Create coordinator with mocks
    coordinator = new PersistenceCoordinator(
      mockEventStore as unknown as EventStore,
      mockMessageQueue as unknown as MessageQueue,
      mockErrorAnalyzer
    );
  });

  afterEach(() => {
    __resetPersistenceCoordinator();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getPersistenceCoordinator();
      const instance2 = getPersistenceCoordinator();
      expect(instance1).toBe(instance2);
    });

    it('should return new instance after reset', () => {
      const instance1 = getPersistenceCoordinator();
      __resetPersistenceCoordinator();
      const instance2 = getPersistenceCoordinator();
      expect(instance1).not.toBe(instance2);
    });

    it('should create singleton without dependency injection', () => {
      const instance = getPersistenceCoordinator();
      expect(instance).toBeInstanceOf(PersistenceCoordinator);
    });
  });

  describe('persistUserMessage()', () => {
    it('should successfully persist user message', async () => {
      const result = await coordinator.persistUserMessage('session-1', 'Hello world');

      expect(result).toEqual({
        eventId: 'event-123',
        sequenceNumber: 42,
        timestamp: '2025-12-22T10:00:00.000Z',
      });
    });

    it('should call EventStore.appendEvent with correct parameters', async () => {
      await coordinator.persistUserMessage('session-1', 'Hello world');

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'user_message_sent',
        expect.objectContaining({
          content: 'Hello world',
          persistenceState: 'persisted',
        })
      );

      // Verify messageId is UUID format
      const callArgs = mockEventStore.appendEvent.mock.calls[0];
      const data = callArgs[2];
      expect(data.message_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should call MessageQueue.addMessagePersistence with correct parameters', async () => {
      await coordinator.persistUserMessage('session-1', 'Hello world');

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          role: 'user',
          messageType: 'text',
          content: 'Hello world',
          metadata: {},
          sequenceNumber: 42,
          eventId: 'event-123',
        })
      );

      // Verify messageId is present
      const callArgs = mockMessageQueue.addMessagePersistence.mock.calls[0][0];
      expect(callArgs.messageId).toBeDefined();
    });

    it('should return correct PersistedEvent structure', async () => {
      const result = await coordinator.persistUserMessage('session-1', 'Test');

      expect(result).toHaveProperty('eventId');
      expect(result).toHaveProperty('sequenceNumber');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.eventId).toBe('string');
      expect(typeof result.sequenceNumber).toBe('number');
      expect(typeof result.timestamp).toBe('string');
    });

    it('should throw when EventStore.appendEvent fails', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(new Error('DB connection failed'));

      await expect(
        coordinator.persistUserMessage('session-1', 'Test')
      ).rejects.toThrow('DB connection failed');
    });

    it('should throw when sequenceNumber is undefined', async () => {
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-123',
        session_id: 'session-1',
        event_type: 'user_message_sent',
        sequence_number: undefined as unknown as number,
        timestamp: new Date(),
        data: {},
        processed: false,
      });

      await expect(
        coordinator.persistUserMessage('session-1', 'Test')
      ).rejects.toThrow('Event persisted without sequence_number');
    });

    it('should throw when sequenceNumber is null', async () => {
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-123',
        session_id: 'session-1',
        event_type: 'user_message_sent',
        sequence_number: null as unknown as number,
        timestamp: new Date(),
        data: {},
        processed: false,
      });

      await expect(
        coordinator.persistUserMessage('session-1', 'Test')
      ).rejects.toThrow('Event persisted without sequence_number');
    });

    it('should use error analyzer on failure', async () => {
      const testError = new Error('Test error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistUserMessage('session-1', 'Test')
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });

    it('should throw when MessageQueue fails', async () => {
      mockMessageQueue.addMessagePersistence.mockRejectedValueOnce(
        new Error('Queue is full')
      );

      await expect(
        coordinator.persistUserMessage('session-1', 'Test')
      ).rejects.toThrow('Queue is full');
    });
  });

  describe('persistAgentMessage()', () => {
    const baseAgentData: AgentMessageData = {
      messageId: 'msg-456',
      content: 'I can help with that',
      stopReason: 'end_turn',
    };

    beforeEach(() => {
      mockEventStore.appendEvent.mockResolvedValue({
        id: 'event-456',
        session_id: 'session-1',
        event_type: 'agent_message_sent',
        sequence_number: 43,
        timestamp: new Date('2025-12-22T10:01:00Z'),
        data: {},
        processed: false,
      });
    });

    it('should successfully persist agent message', async () => {
      const result = await coordinator.persistAgentMessage('session-1', baseAgentData);

      expect(result).toEqual({
        eventId: 'event-456',
        sequenceNumber: 43,
        timestamp: '2025-12-22T10:01:00.000Z',
      });
    });

    it('should call EventStore with correct parameters', async () => {
      await coordinator.persistAgentMessage('session-1', baseAgentData);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'agent_message_sent',
        expect.objectContaining({
          message_id: 'msg-456',
          content: 'I can help with that',
          stop_reason: 'end_turn',
          persistenceState: 'persisted',
        })
      );
    });

    it('should include token usage in EventStore when provided', async () => {
      const dataWithTokens: AgentMessageData = {
        ...baseAgentData,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      };

      await coordinator.persistAgentMessage('session-1', dataWithTokens);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'agent_message_sent',
        expect.objectContaining({
          input_tokens: 100,
          output_tokens: 50,
        })
      );
    });

    it('should include model in EventStore when provided', async () => {
      const dataWithModel: AgentMessageData = {
        ...baseAgentData,
        model: 'claude-sonnet-4-5-20250929',
      };

      await coordinator.persistAgentMessage('session-1', dataWithModel);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'agent_message_sent',
        expect.objectContaining({
          model: 'claude-sonnet-4-5-20250929',
        })
      );
    });

    it('should call MessageQueue with correct parameters', async () => {
      await coordinator.persistAgentMessage('session-1', baseAgentData);

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          messageId: 'msg-456',
          role: 'assistant',
          messageType: 'text',
          content: 'I can help with that',
          metadata: { stop_reason: 'end_turn' },
          sequenceNumber: 43,
          eventId: 'event-456',
          stopReason: 'end_turn',
        })
      );
    });

    it('should include token usage in MessageQueue when provided', async () => {
      const dataWithTokens: AgentMessageData = {
        ...baseAgentData,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      };

      await coordinator.persistAgentMessage('session-1', dataWithTokens);

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
        })
      );
    });

    it('should handle missing optional fields', async () => {
      const minimalData: AgentMessageData = {
        messageId: 'msg-789',
        content: 'Response',
        stopReason: 'end_turn',
      };

      await coordinator.persistAgentMessage('session-1', minimalData);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'agent_message_sent',
        expect.objectContaining({
          message_id: 'msg-789',
          content: 'Response',
          stop_reason: 'end_turn',
          model: undefined,
          input_tokens: undefined,
          output_tokens: undefined,
        })
      );
    });

    it('should throw when EventStore fails', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(new Error('EventStore error'));

      await expect(
        coordinator.persistAgentMessage('session-1', baseAgentData)
      ).rejects.toThrow('EventStore error');
    });

    it('should throw when sequenceNumber is undefined', async () => {
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-456',
        sequence_number: undefined as unknown as number,
        timestamp: new Date(),
      } as BaseEvent);

      await expect(
        coordinator.persistAgentMessage('session-1', baseAgentData)
      ).rejects.toThrow('Event persisted without sequence_number');
    });

    it('should throw when MessageQueue fails', async () => {
      mockMessageQueue.addMessagePersistence.mockRejectedValueOnce(
        new Error('MessageQueue error')
      );

      await expect(
        coordinator.persistAgentMessage('session-1', baseAgentData)
      ).rejects.toThrow('MessageQueue error');
    });

    it('should use error analyzer on failure', async () => {
      const testError = new Error('Test error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistAgentMessage('session-1', baseAgentData)
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });
  });

  describe('persistThinking()', () => {
    const thinkingData: ThinkingData = {
      messageId: 'thinking-123',
      content: 'Let me analyze this problem...',
    };

    beforeEach(() => {
      mockEventStore.appendEvent.mockResolvedValue({
        id: 'event-thinking-1',
        session_id: 'session-1',
        event_type: 'agent_thinking_block',
        sequence_number: 44,
        timestamp: new Date('2025-12-22T10:02:00Z'),
        data: {},
        processed: false,
      });
    });

    it('should successfully persist thinking content', async () => {
      const result = await coordinator.persistThinking('session-1', thinkingData);

      expect(result).toEqual({
        eventId: 'event-thinking-1',
        sequenceNumber: 44,
        timestamp: '2025-12-22T10:02:00.000Z',
      });
    });

    it('should call EventStore with correct event type', async () => {
      await coordinator.persistThinking('session-1', thinkingData);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'agent_thinking_block',
        expect.objectContaining({
          message_id: 'thinking-123',
          content: 'Let me analyze this problem...',
          persistenceState: 'persisted',
        })
      );
    });

    it('should call MessageQueue with messageType thinking', async () => {
      await coordinator.persistThinking('session-1', thinkingData);

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          messageId: 'thinking-123',
          role: 'assistant',
          messageType: 'thinking',
          content: 'Let me analyze this problem...',
          metadata: {},
          sequenceNumber: 44,
          eventId: 'event-thinking-1',
        })
      );
    });

    it('should include token usage when provided', async () => {
      const dataWithTokens: ThinkingData = {
        ...thinkingData,
        tokenUsage: {
          inputTokens: 50,
          outputTokens: 200,
        },
      };

      await coordinator.persistThinking('session-1', dataWithTokens);

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 50,
          outputTokens: 200,
        })
      );
    });

    it('should handle missing optional tokenUsage', async () => {
      await coordinator.persistThinking('session-1', thinkingData);

      const callArgs = mockMessageQueue.addMessagePersistence.mock.calls[0][0];
      expect(callArgs.inputTokens).toBeUndefined();
      expect(callArgs.outputTokens).toBeUndefined();
    });

    it('should throw when sequenceNumber is undefined', async () => {
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-thinking-1',
        sequence_number: undefined as unknown as number,
        timestamp: new Date(),
      } as BaseEvent);

      await expect(
        coordinator.persistThinking('session-1', thinkingData)
      ).rejects.toThrow('Event persisted without sequence_number');
    });

    it('should throw when EventStore fails', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(new Error('EventStore error'));

      await expect(
        coordinator.persistThinking('session-1', thinkingData)
      ).rejects.toThrow('EventStore error');
    });

    it('should use error analyzer on failure', async () => {
      const testError = new Error('Test error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistThinking('session-1', thinkingData)
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });
  });

  describe('persistToolUse()', () => {
    const toolUseData: ToolUseData = {
      toolUseId: 'tool-use-789',
      toolName: 'get_customer',
      toolInput: { customerId: '123' },
    };

    beforeEach(() => {
      mockEventStore.appendEvent.mockResolvedValue({
        id: 'event-tool-use-1',
        session_id: 'session-1',
        event_type: 'tool_use_requested',
        sequence_number: 45,
        timestamp: new Date('2025-12-22T10:03:00Z'),
        data: {},
        processed: false,
      });
    });

    it('should successfully persist tool use request', async () => {
      const result = await coordinator.persistToolUse('session-1', toolUseData);

      expect(result).toEqual({
        eventId: 'event-tool-use-1',
        sequenceNumber: 45,
        timestamp: '2025-12-22T10:03:00.000Z',
      });
    });

    it('should call EventStore with correct event type', async () => {
      await coordinator.persistToolUse('session-1', toolUseData);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'tool_use_requested',
        expect.objectContaining({
          tool_use_id: 'tool-use-789',
          tool_name: 'get_customer',
          tool_args: { customerId: '123' },
          persistenceState: 'persisted',
        })
      );
    });

    it('should call MessageQueue with correct parameters', async () => {
      await coordinator.persistToolUse('session-1', toolUseData);

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          messageId: 'tool-use-789',
          role: 'assistant',
          messageType: 'tool_use',
          content: '',
          metadata: {
            tool_name: 'get_customer',
            tool_args: { customerId: '123' },
            tool_use_id: 'tool-use-789',
            status: 'pending',
          },
          sequenceNumber: 45,
          eventId: 'event-tool-use-1',
          toolUseId: 'tool-use-789',
        })
      );
    });

    it('should include tool metadata in MessageQueue', async () => {
      await coordinator.persistToolUse('session-1', toolUseData);

      const callArgs = mockMessageQueue.addMessagePersistence.mock.calls[0][0];
      expect(callArgs.metadata?.tool_name).toBe('get_customer');
      expect(callArgs.metadata?.tool_use_id).toBe('tool-use-789');
      expect(callArgs.metadata?.status).toBe('pending');
    });

    it('should throw when sequenceNumber is undefined', async () => {
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-tool-use-1',
        sequence_number: undefined as unknown as number,
        timestamp: new Date(),
      } as BaseEvent);

      await expect(
        coordinator.persistToolUse('session-1', toolUseData)
      ).rejects.toThrow('Event persisted without sequence_number');
    });

    it('should throw when EventStore fails', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(new Error('EventStore error'));

      await expect(
        coordinator.persistToolUse('session-1', toolUseData)
      ).rejects.toThrow('EventStore error');
    });

    it('should use error analyzer on failure', async () => {
      const testError = new Error('Test error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistToolUse('session-1', toolUseData)
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });
  });

  describe('persistToolResult()', () => {
    const toolResultData: ToolResultData = {
      toolUseId: 'tool-use-789',
      toolOutput: '{"name": "John Doe", "id": "123"}',
      isError: false,
    };

    beforeEach(() => {
      mockEventStore.appendEvent.mockResolvedValue({
        id: 'event-tool-result-1',
        session_id: 'session-1',
        event_type: 'tool_use_completed',
        sequence_number: 46,
        timestamp: new Date('2025-12-22T10:04:00Z'),
        data: {},
        processed: false,
      });
    });

    it('should successfully persist tool result', async () => {
      const result = await coordinator.persistToolResult('session-1', toolResultData);

      expect(result).toEqual({
        eventId: 'event-tool-result-1',
        sequenceNumber: 46,
        timestamp: '2025-12-22T10:04:00.000Z',
      });
    });

    it('should call EventStore with correct event type', async () => {
      await coordinator.persistToolResult('session-1', toolResultData);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'tool_use_completed',
        expect.objectContaining({
          tool_use_id: 'tool-use-789',
          result: '{"name": "John Doe", "id": "123"}',
          success: true,
          persistenceState: 'persisted',
        })
      );
    });

    it('should handle error results correctly', async () => {
      const errorData: ToolResultData = {
        toolUseId: 'tool-use-789',
        toolOutput: 'Error: Connection timeout',
        isError: true,
        errorMessage: 'Connection timeout',
      };

      await coordinator.persistToolResult('session-1', errorData);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'tool_use_completed',
        expect.objectContaining({
          tool_use_id: 'tool-use-789',
          result: 'Error: Connection timeout',
          success: false,
          error: 'Connection timeout',
        })
      );
    });

    it('should call MessageQueue with correct parameters', async () => {
      await coordinator.persistToolResult('session-1', toolResultData);

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          messageId: 'tool-use-789_result',
          role: 'assistant',
          messageType: 'tool_result',
          content: '{"name": "John Doe", "id": "123"}',
          metadata: {
            tool_use_id: 'tool-use-789',
            success: true,
            error_message: undefined,
          },
          sequenceNumber: 46,
          eventId: 'event-tool-result-1',
          toolUseId: 'tool-use-789',
        })
      );
    });

    it('should include error metadata when isError is true', async () => {
      const errorData: ToolResultData = {
        toolUseId: 'tool-use-789',
        toolOutput: 'Error output',
        isError: true,
        errorMessage: 'Something went wrong',
      };

      await coordinator.persistToolResult('session-1', errorData);

      const callArgs = mockMessageQueue.addMessagePersistence.mock.calls[0][0];
      expect(callArgs.metadata?.success).toBe(false);
      expect(callArgs.metadata?.error_message).toBe('Something went wrong');
    });

    it('should throw when sequenceNumber is undefined', async () => {
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-tool-result-1',
        sequence_number: undefined as unknown as number,
        timestamp: new Date(),
      } as BaseEvent);

      await expect(
        coordinator.persistToolResult('session-1', toolResultData)
      ).rejects.toThrow('Event persisted without sequence_number');
    });

    it('should throw when EventStore fails', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(new Error('EventStore error'));

      await expect(
        coordinator.persistToolResult('session-1', toolResultData)
      ).rejects.toThrow('EventStore error');
    });

    it('should use error analyzer on failure', async () => {
      const testError = new Error('Test error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistToolResult('session-1', toolResultData)
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });
  });

  describe('persistError()', () => {
    const errorData: ErrorData = {
      error: 'Internal server error',
      code: 'ERR_INTERNAL',
      details: { context: 'agent execution' },
    };

    beforeEach(() => {
      mockEventStore.appendEvent.mockResolvedValue({
        id: 'event-error-1',
        session_id: 'session-1',
        event_type: 'error_occurred',
        sequence_number: 47,
        timestamp: new Date('2025-12-22T10:05:00Z'),
        data: {},
        processed: false,
      });
    });

    it('should successfully persist error event', async () => {
      const result = await coordinator.persistError('session-1', errorData);

      expect(result).toEqual({
        eventId: 'event-error-1',
        sequenceNumber: 47,
        timestamp: '2025-12-22T10:05:00.000Z',
      });
    });

    it('should call EventStore with correct event type', async () => {
      await coordinator.persistError('session-1', errorData);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'error_occurred',
        expect.objectContaining({
          error: 'Internal server error',
          code: 'ERR_INTERNAL',
          details: { context: 'agent execution' },
          persistenceState: 'persisted',
        })
      );
    });

    it('should NOT call MessageQueue for error events', async () => {
      await coordinator.persistError('session-1', errorData);

      expect(mockMessageQueue.addMessagePersistence).not.toHaveBeenCalled();
    });

    it('should handle error without details', async () => {
      const minimalError: ErrorData = {
        error: 'Simple error',
        code: 'ERR_SIMPLE',
      };

      await coordinator.persistError('session-1', minimalError);

      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'error_occurred',
        expect.objectContaining({
          error: 'Simple error',
          code: 'ERR_SIMPLE',
          details: undefined,
        })
      );
    });

    it('should throw when sequenceNumber is undefined', async () => {
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-error-1',
        sequence_number: undefined as unknown as number,
        timestamp: new Date(),
      } as BaseEvent);

      await expect(
        coordinator.persistError('session-1', errorData)
      ).rejects.toThrow('Event persisted without sequence_number');
    });

    it('should throw when EventStore fails', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(new Error('EventStore error'));

      await expect(
        coordinator.persistError('session-1', errorData)
      ).rejects.toThrow('EventStore error');
    });

    it('should use error analyzer on failure', async () => {
      const testError = new Error('Test error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistError('session-1', errorData)
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });
  });

  describe('persistToolEventsAsync()', () => {
    const toolExecutions: ToolExecution[] = [
      {
        toolUseId: 'tool-1',
        toolName: 'get_customer',
        toolInput: { id: '123' },
        toolOutput: '{"name": "John"}',
        success: true,
        timestamp: '2025-12-22T10:06:00Z',
      },
      {
        toolUseId: 'tool-2',
        toolName: 'update_order',
        toolInput: { orderId: '456' },
        toolOutput: 'Error: Not found',
        success: false,
        error: 'Order not found',
        timestamp: '2025-12-22T10:06:01Z',
      },
    ];

    beforeEach(() => {
      // Setup EventStore to return different sequence numbers
      let sequenceNum = 48;
      mockEventStore.appendEvent.mockImplementation(async () => ({
        id: `event-${sequenceNum}`,
        session_id: 'session-1',
        event_type: 'tool_use_requested',
        sequence_number: sequenceNum++,
        timestamp: new Date(),
        data: {},
        processed: false,
      }));
    });

    it('should not throw (fire-and-forget)', () => {
      expect(() => {
        coordinator.persistToolEventsAsync('session-1', toolExecutions);
      }).not.toThrow();
    });

    it('should return immediately (not block)', () => {
      const start = Date.now();
      coordinator.persistToolEventsAsync('session-1', toolExecutions);
      const duration = Date.now() - start;

      // Should return in less than 10ms (not waiting for async operations)
      expect(duration).toBeLessThan(10);
    });

    it('should persist both tool_use and tool_result for each execution', async () => {
      coordinator.persistToolEventsAsync('session-1', toolExecutions);

      // Wait for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have 4 total calls: 2 tool_use + 2 tool_result
      expect(mockEventStore.appendEvent).toHaveBeenCalledTimes(4);
    });

    it('should persist tool_use events with correct data', async () => {
      coordinator.persistToolEventsAsync('session-1', toolExecutions);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Check first tool_use call
      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'tool_use_requested',
        expect.objectContaining({
          tool_use_id: 'tool-1',
          tool_name: 'get_customer',
          tool_args: { id: '123' },
          timestamp: '2025-12-22T10:06:00Z',
          persistenceState: 'persisted',
        })
      );
    });

    it('should persist tool_result events with correct data', async () => {
      coordinator.persistToolEventsAsync('session-1', toolExecutions);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Check first tool_result call
      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'tool_use_completed',
        expect.objectContaining({
          tool_use_id: 'tool-1',
          result: '{"name": "John"}',
          success: true,
          timestamp: '2025-12-22T10:06:00Z',
          persistenceState: 'persisted',
        })
      );
    });

    it('should handle error executions correctly', async () => {
      coordinator.persistToolEventsAsync('session-1', toolExecutions);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Check error tool_result call
      expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
        'session-1',
        'tool_use_completed',
        expect.objectContaining({
          tool_use_id: 'tool-2',
          result: 'Error: Not found',
          success: false,
          error: 'Order not found',
        })
      );
    });

    it('should queue MessageQueue jobs for all events', async () => {
      coordinator.persistToolEventsAsync('session-1', toolExecutions);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have 4 total calls: 2 tool_use + 2 tool_result
      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledTimes(4);
    });

    it('should set status to completed in tool_use metadata', async () => {
      coordinator.persistToolEventsAsync('session-1', toolExecutions);

      await new Promise(resolve => setTimeout(resolve, 50));

      const toolUseCalls = mockMessageQueue.addMessagePersistence.mock.calls
        .filter((call) => call[0].messageType === 'tool_use');

      expect(toolUseCalls[0][0].metadata?.status).toBe('completed');
    });

    it('should handle empty executions array', async () => {
      coordinator.persistToolEventsAsync('session-1', []);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockEventStore.appendEvent).not.toHaveBeenCalled();
      expect(mockMessageQueue.addMessagePersistence).not.toHaveBeenCalled();
    });

    it('should not throw when EventStore fails (logs error internally)', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(new Error('EventStore failed'));

      expect(() => {
        coordinator.persistToolEventsAsync('session-1', toolExecutions);
      }).not.toThrow();

      // Wait to ensure error is caught internally
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should continue processing remaining executions after error', async () => {
      // Make first call fail, subsequent calls succeed
      mockEventStore.appendEvent
        .mockRejectedValueOnce(new Error('First tool failed'))
        .mockResolvedValue({
          id: 'event-49',
          session_id: 'session-1',
          event_type: 'tool_use_requested',
          sequence_number: 49,
          timestamp: new Date(),
          data: {},
          processed: false,
        });

      coordinator.persistToolEventsAsync('session-1', toolExecutions);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should attempt all executions despite first failure
      expect(mockEventStore.appendEvent.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('error handling with PersistenceErrorAnalyzer', () => {
    it('should use error analyzer for all sync persistence errors', async () => {
      const testError = new Error('DB error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistUserMessage('session-1', 'Test')
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });

    it('should categorize errors correctly', async () => {
      mockErrorAnalyzer.analyze.mockReturnValueOnce(['DB_TIMEOUT: Database timeout']);

      const testError = new Error('Query timeout');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistAgentMessage('session-1', {
          messageId: 'msg-1',
          content: 'Test',
          stopReason: 'end_turn',
        })
      ).rejects.toThrow();

      expect(mockErrorAnalyzer.analyze).toHaveBeenCalledWith(testError);
    });

    it('should re-throw errors for sync operations', async () => {
      const testError = new Error('Critical error');
      mockEventStore.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        coordinator.persistThinking('session-1', {
          messageId: 'thinking-1',
          content: 'Thinking',
        })
      ).rejects.toThrow('Critical error');
    });

    it('should NOT re-throw errors for async operations', async () => {
      mockEventStore.appendEvent.mockRejectedValue(new Error('Async error'));

      expect(() => {
        coordinator.persistToolEventsAsync('session-1', [
          {
            toolUseId: 'tool-1',
            toolName: 'test_tool',
            toolInput: {},
            toolOutput: 'output',
            success: true,
            timestamp: new Date().toISOString(),
          },
        ]);
      }).not.toThrow();
    });
  });

  describe('realistic scenario tests', () => {
    it('should complete full agent message flow', async () => {
      const agentData: AgentMessageData = {
        messageId: 'msg-full-flow',
        content: 'Complete response',
        stopReason: 'end_turn',
        model: 'claude-sonnet-4-5-20250929',
        tokenUsage: {
          inputTokens: 150,
          outputTokens: 250,
        },
      };

      const result = await coordinator.persistAgentMessage('session-1', agentData);

      // Verify both were called
      expect(mockEventStore.appendEvent).toHaveBeenCalled();
      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalled();

      // Verify sequence number was validated
      expect(result.sequenceNumber).toBe(42);

      // Verify MessageQueue received sequence number
      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sequenceNumber: 42,
          eventId: 'event-123',
        })
      );
    });

    it('should handle tool execution batch', async () => {
      const executions: ToolExecution[] = [
        {
          toolUseId: 'batch-tool-1',
          toolName: 'get_data',
          toolInput: { id: '1' },
          toolOutput: 'result 1',
          success: true,
          timestamp: new Date().toISOString(),
        },
        {
          toolUseId: 'batch-tool-2',
          toolName: 'get_data',
          toolInput: { id: '2' },
          toolOutput: 'result 2',
          success: true,
          timestamp: new Date().toISOString(),
        },
        {
          toolUseId: 'batch-tool-3',
          toolName: 'get_data',
          toolInput: { id: '3' },
          toolOutput: 'Error',
          success: false,
          error: 'Not found',
          timestamp: new Date().toISOString(),
        },
      ];

      coordinator.persistToolEventsAsync('session-1', executions);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should persist 6 events: 3 tool_use + 3 tool_result
      expect(mockEventStore.appendEvent).toHaveBeenCalledTimes(6);
      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledTimes(6);
    });

    it('should handle EventStore failure and throw immediately', async () => {
      mockEventStore.appendEvent.mockRejectedValueOnce(
        new Error('Critical DB failure')
      );

      await expect(
        coordinator.persistUserMessage('session-1', 'Test')
      ).rejects.toThrow('Critical DB failure');

      // MessageQueue should never be called when EventStore fails
      expect(mockMessageQueue.addMessagePersistence).not.toHaveBeenCalled();
    });

    it('should validate sequence before queuing to MessageQueue', async () => {
      // First call: valid sequence
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-1',
        session_id: 'session-1',
        event_type: 'user_message_sent',
        sequence_number: 100,
        timestamp: new Date(),
        data: {},
        processed: false,
      });

      await coordinator.persistUserMessage('session-1', 'Message 1');

      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({ sequenceNumber: 100 })
      );

      // Second call: invalid sequence (null)
      mockEventStore.appendEvent.mockResolvedValueOnce({
        id: 'event-2',
        sequence_number: null as unknown as number,
        timestamp: new Date(),
      } as BaseEvent);

      await expect(
        coordinator.persistUserMessage('session-1', 'Message 2')
      ).rejects.toThrow('Event persisted without sequence_number');

      // MessageQueue should only have been called once (first time)
      expect(mockMessageQueue.addMessagePersistence).toHaveBeenCalledTimes(1);
    });
  });
});
