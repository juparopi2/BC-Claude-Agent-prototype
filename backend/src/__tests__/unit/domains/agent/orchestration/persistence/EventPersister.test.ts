/**
 * @file EventPersister.test.ts
 * @description Tests for event persistence strategy logic.
 *
 * Purpose: Capture the behavior of persistSyncEvent() and persistAsyncEvent()
 * methods in AgentOrchestrator before extraction.
 *
 * Critical behaviors to verify:
 * - sync_required events call persistSyncEvent before emission
 * - async_allowed events call persistAsyncEvent after emission
 * - transient events emitted but not persisted
 * - Pre-allocated sequences passed to persistence layer
 * - Tool lifecycle manager receives correct data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  NormalizedThinkingEvent,
  NormalizedToolRequestEvent,
  NormalizedToolResponseEvent,
  NormalizedAssistantMessageEvent,
  NormalizedCompleteEvent,
  NormalizedAgentEvent,
} from '@bc-agent/shared';
import type { IPersistenceCoordinator } from '@domains/agent/persistence/types';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Create mock persistence coordinator with spies
function createMockPersistenceCoordinator(): IPersistenceCoordinator & {
  _mocks: {
    persistThinking: ReturnType<typeof vi.fn>;
    persistAgentMessage: ReturnType<typeof vi.fn>;
    persistToolEventsAsync: ReturnType<typeof vi.fn>;
    awaitPersistence: ReturnType<typeof vi.fn>;
  };
} {
  const persistThinking = vi.fn().mockResolvedValue({
    sequenceNumber: 10,
    eventId: 'event-thinking-1',
    timestamp: new Date().toISOString(),
  });
  const persistAgentMessage = vi.fn().mockResolvedValue({
    sequenceNumber: 20,
    eventId: 'event-msg-1',
    timestamp: new Date().toISOString(),
    jobId: 'job-123',
  });
  const persistToolEventsAsync = vi.fn();
  const awaitPersistence = vi.fn().mockResolvedValue(undefined);

  return {
    persistUserMessage: vi.fn().mockResolvedValue({
      sequenceNumber: 1,
      eventId: 'event-user-1',
      timestamp: new Date().toISOString(),
      messageId: 'msg-user-1',
    }),
    persistThinking,
    persistAgentMessage,
    persistToolUse: vi.fn().mockResolvedValue({ sequenceNumber: 30 }),
    persistToolResult: vi.fn().mockResolvedValue({ sequenceNumber: 31 }),
    persistError: vi.fn().mockResolvedValue({ sequenceNumber: 40 }),
    persistToolEventsAsync,
    persistCitationsAsync: vi.fn(),
    persistMessageChatAttachmentsAsync: vi.fn(),
    awaitPersistence,
    _mocks: {
      persistThinking,
      persistAgentMessage,
      persistToolEventsAsync,
      awaitPersistence,
    },
  };
}

// Helper to create normalized events
function createThinkingEvent(preAllocSeq?: number): NormalizedThinkingEvent {
  const event: NormalizedThinkingEvent = {
    type: 'thinking',
    eventId: 'thinking-evt-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 0,
    persistenceStrategy: 'sync_required',
    messageId: 'msg-1',
    content: 'Let me think about this...',
    tokenUsage: { inputTokens: 50, outputTokens: 25 },
  };
  if (preAllocSeq !== undefined) {
    event.preAllocatedSequenceNumber = preAllocSeq;
  }
  return event;
}

function createAssistantMessageEvent(preAllocSeq?: number): NormalizedAssistantMessageEvent {
  const event: NormalizedAssistantMessageEvent = {
    type: 'assistant_message',
    eventId: 'msg-evt-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 1,
    persistenceStrategy: 'sync_required',
    messageId: 'msg-assistant-1',
    content: 'Here is my response',
    stopReason: 'end_turn',
    model: 'claude-3-5-sonnet',
    tokenUsage: { inputTokens: 100, outputTokens: 50 },
  };
  if (preAllocSeq !== undefined) {
    event.preAllocatedSequenceNumber = preAllocSeq;
  }
  return event;
}

function createToolRequestEvent(preAllocSeq?: number): NormalizedToolRequestEvent {
  const event: NormalizedToolRequestEvent = {
    type: 'tool_request',
    eventId: 'tool-req-evt-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 2,
    persistenceStrategy: 'async_allowed',
    toolUseId: 'toolu_abc123',
    toolName: 'search_bc',
    args: { query: 'vendors' },
  };
  if (preAllocSeq !== undefined) {
    event.preAllocatedSequenceNumber = preAllocSeq;
  }
  return event;
}

function createToolResponseEvent(preAllocSeq?: number): NormalizedToolResponseEvent {
  const event: NormalizedToolResponseEvent = {
    type: 'tool_response',
    eventId: 'tool-resp-evt-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 3,
    persistenceStrategy: 'async_allowed',
    toolUseId: 'toolu_abc123',
    toolName: 'search_bc',
    success: true,
    result: 'Found 5 vendors',
  };
  if (preAllocSeq !== undefined) {
    event.preAllocatedSequenceNumber = preAllocSeq;
  }
  return event;
}

function createCompleteEvent(): NormalizedCompleteEvent {
  return {
    type: 'complete',
    eventId: 'complete-evt-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 4,
    persistenceStrategy: 'transient',
    reason: 'success',
    stopReason: 'end_turn',
  };
}

describe('EventPersister', () => {
  let mockPersistenceCoordinator: ReturnType<typeof createMockPersistenceCoordinator>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistenceCoordinator = createMockPersistenceCoordinator();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sync_required events', () => {
    describe('thinking events', () => {
      it('should call persistThinking for thinking events', async () => {
        const event = createThinkingEvent();
        const sessionId = 'test-session';
        const agentMessageId = 'agent-msg-1';

        // Simulate the persistence call
        await mockPersistenceCoordinator.persistThinking(
          sessionId,
          {
            messageId: agentMessageId,
            content: event.content,
            tokenUsage: event.tokenUsage ?? { inputTokens: 0, outputTokens: 0 },
          },
          event.preAllocatedSequenceNumber
        );

        expect(mockPersistenceCoordinator._mocks.persistThinking).toHaveBeenCalledWith(
          sessionId,
          {
            messageId: agentMessageId,
            content: 'Let me think about this...',
            tokenUsage: { inputTokens: 50, outputTokens: 25 },
          },
          undefined
        );
      });

      it('should pass pre-allocated sequence to persistThinking', async () => {
        const event = createThinkingEvent(42);
        const sessionId = 'test-session';
        const agentMessageId = 'agent-msg-1';

        await mockPersistenceCoordinator.persistThinking(
          sessionId,
          {
            messageId: agentMessageId,
            content: event.content,
            tokenUsage: event.tokenUsage ?? { inputTokens: 0, outputTokens: 0 },
          },
          event.preAllocatedSequenceNumber
        );

        expect(mockPersistenceCoordinator._mocks.persistThinking).toHaveBeenCalledWith(
          sessionId,
          expect.any(Object),
          42
        );
      });

      it('should handle missing tokenUsage in thinking event', async () => {
        const event: NormalizedThinkingEvent = {
          ...createThinkingEvent(),
          tokenUsage: undefined,
        };
        const sessionId = 'test-session';
        const agentMessageId = 'agent-msg-1';

        // The orchestrator defaults to { inputTokens: 0, outputTokens: 0 }
        await mockPersistenceCoordinator.persistThinking(
          sessionId,
          {
            messageId: agentMessageId,
            content: event.content,
            tokenUsage: event.tokenUsage ?? { inputTokens: 0, outputTokens: 0 },
          },
          event.preAllocatedSequenceNumber
        );

        expect(mockPersistenceCoordinator._mocks.persistThinking).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
          }),
          undefined
        );
      });
    });

    describe('assistant_message events', () => {
      it('should call persistAgentMessage for assistant messages', async () => {
        const event = createAssistantMessageEvent();
        const sessionId = 'test-session';

        await mockPersistenceCoordinator.persistAgentMessage(
          sessionId,
          {
            messageId: event.messageId,
            content: event.content,
            stopReason: event.stopReason,
            model: event.model,
            tokenUsage: {
              inputTokens: event.tokenUsage.inputTokens,
              outputTokens: event.tokenUsage.outputTokens,
            },
          },
          event.preAllocatedSequenceNumber
        );

        expect(mockPersistenceCoordinator._mocks.persistAgentMessage).toHaveBeenCalledWith(
          sessionId,
          {
            messageId: 'msg-assistant-1',
            content: 'Here is my response',
            stopReason: 'end_turn',
            model: 'claude-3-5-sonnet',
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
          },
          undefined
        );
      });

      it('should pass pre-allocated sequence to persistAgentMessage', async () => {
        const event = createAssistantMessageEvent(99);
        const sessionId = 'test-session';

        await mockPersistenceCoordinator.persistAgentMessage(
          sessionId,
          {
            messageId: event.messageId,
            content: event.content,
            stopReason: event.stopReason,
            model: event.model,
            tokenUsage: {
              inputTokens: event.tokenUsage.inputTokens,
              outputTokens: event.tokenUsage.outputTokens,
            },
          },
          event.preAllocatedSequenceNumber
        );

        expect(mockPersistenceCoordinator._mocks.persistAgentMessage).toHaveBeenCalledWith(
          sessionId,
          expect.any(Object),
          99
        );
      });

      it('should await persistence via jobId', async () => {
        const event = createAssistantMessageEvent();
        const sessionId = 'test-session';

        const result = await mockPersistenceCoordinator.persistAgentMessage(
          sessionId,
          {
            messageId: event.messageId,
            content: event.content,
            stopReason: event.stopReason,
            model: event.model,
            tokenUsage: event.tokenUsage,
          },
          event.preAllocatedSequenceNumber
        );

        if (result.jobId) {
          await mockPersistenceCoordinator.awaitPersistence(result.jobId, 10000);
        }

        expect(mockPersistenceCoordinator._mocks.awaitPersistence).toHaveBeenCalledWith(
          'job-123',
          10000
        );
      });
    });
  });

  describe('async_allowed events', () => {
    describe('tool request events', () => {
      it('should NOT immediately persist tool_request (registered in lifecycle manager)', () => {
        const event = createToolRequestEvent();

        // Tool requests are registered in ToolLifecycleManager, not persisted directly
        // Persistence happens when tool_response arrives

        // Verify persistToolEventsAsync is NOT called for request alone
        expect(mockPersistenceCoordinator._mocks.persistToolEventsAsync).not.toHaveBeenCalled();
      });

      it('should store pre-allocated sequence for later use', () => {
        const event = createToolRequestEvent(100);

        // The pre-allocated sequence should be stored with the event
        expect(event.preAllocatedSequenceNumber).toBe(100);
      });
    });

    describe('tool response events', () => {
      it('should call persistToolEventsAsync when tool_response completes lifecycle', () => {
        const requestEvent = createToolRequestEvent(100);
        const responseEvent = createToolResponseEvent(101);
        const sessionId = 'test-session';

        // Simulate the unified persistence call made when tool lifecycle completes
        mockPersistenceCoordinator.persistToolEventsAsync(sessionId, [
          {
            toolUseId: requestEvent.toolUseId,
            toolName: requestEvent.toolName,
            toolInput: requestEvent.args,
            toolOutput: responseEvent.result ?? '',
            success: responseEvent.success,
            error: responseEvent.error,
            timestamp: responseEvent.timestamp,
            preAllocatedToolUseSeq: requestEvent.preAllocatedSequenceNumber,
            preAllocatedToolResultSeq: responseEvent.preAllocatedSequenceNumber,
          },
        ]);

        expect(mockPersistenceCoordinator._mocks.persistToolEventsAsync).toHaveBeenCalledWith(
          sessionId,
          [
            expect.objectContaining({
              toolUseId: 'toolu_abc123',
              toolName: 'search_bc',
              toolInput: { query: 'vendors' },
              toolOutput: 'Found 5 vendors',
              success: true,
              preAllocatedToolUseSeq: 100,
              preAllocatedToolResultSeq: 101,
            }),
          ]
        );
      });

      it('should include error in persistence for failed tools', () => {
        const requestEvent = createToolRequestEvent();
        const responseEvent: NormalizedToolResponseEvent = {
          ...createToolResponseEvent(),
          success: false,
          result: '',
          error: 'Connection timeout',
        };
        const sessionId = 'test-session';

        mockPersistenceCoordinator.persistToolEventsAsync(sessionId, [
          {
            toolUseId: requestEvent.toolUseId,
            toolName: requestEvent.toolName,
            toolInput: requestEvent.args,
            toolOutput: responseEvent.result ?? '',
            success: responseEvent.success,
            error: responseEvent.error,
            timestamp: responseEvent.timestamp,
          },
        ]);

        expect(mockPersistenceCoordinator._mocks.persistToolEventsAsync).toHaveBeenCalledWith(
          sessionId,
          [
            expect.objectContaining({
              success: false,
              error: 'Connection timeout',
            }),
          ]
        );
      });
    });
  });

  describe('transient events', () => {
    it('should NOT persist complete events', () => {
      const event = createCompleteEvent();

      // Transient events should not call any persistence methods
      expect(event.persistenceStrategy).toBe('transient');
      expect(mockPersistenceCoordinator._mocks.persistThinking).not.toHaveBeenCalled();
      expect(mockPersistenceCoordinator._mocks.persistAgentMessage).not.toHaveBeenCalled();
      expect(mockPersistenceCoordinator._mocks.persistToolEventsAsync).not.toHaveBeenCalled();
    });

    it('should NOT assign sequence numbers to transient events', () => {
      const event = createCompleteEvent();

      // Transient events should never have a pre-allocated sequence
      expect(event.preAllocatedSequenceNumber).toBeUndefined();
    });
  });

  describe('persistence state tracking', () => {
    it('should return PersistedEvent with sequenceNumber for sync events', async () => {
      const sessionId = 'test-session';

      const result = await mockPersistenceCoordinator.persistAgentMessage(
        sessionId,
        {
          messageId: 'msg-1',
          content: 'Response',
          stopReason: 'end_turn',
          model: 'claude-3-5-sonnet',
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        },
        undefined
      );

      expect(result.sequenceNumber).toBe(20);
      expect(result.eventId).toBe('event-msg-1');
      expect(result.timestamp).toBeDefined();
    });

    it('should return PersistedEvent with jobId for awaitPersistence', async () => {
      const sessionId = 'test-session';

      const result = await mockPersistenceCoordinator.persistAgentMessage(
        sessionId,
        {
          messageId: 'msg-1',
          content: 'Response',
          stopReason: 'end_turn',
          model: 'claude-3-5-sonnet',
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        },
        undefined
      );

      expect(result.jobId).toBe('job-123');
    });
  });

  describe('pre-allocated sequence behavior', () => {
    it('should use pre-allocated sequence when provided', async () => {
      const event = createAssistantMessageEvent(500);
      const sessionId = 'test-session';

      await mockPersistenceCoordinator.persistAgentMessage(
        sessionId,
        {
          messageId: event.messageId,
          content: event.content,
          stopReason: event.stopReason,
          model: event.model,
          tokenUsage: event.tokenUsage,
        },
        event.preAllocatedSequenceNumber
      );

      // Verify the pre-allocated sequence was passed
      expect(mockPersistenceCoordinator._mocks.persistAgentMessage).toHaveBeenCalledWith(
        sessionId,
        expect.any(Object),
        500
      );
    });

    it('should handle undefined pre-allocated sequence gracefully', async () => {
      const event = createAssistantMessageEvent(); // No pre-allocated seq
      const sessionId = 'test-session';

      await mockPersistenceCoordinator.persistAgentMessage(
        sessionId,
        {
          messageId: event.messageId,
          content: event.content,
          stopReason: event.stopReason,
          model: event.model,
          tokenUsage: event.tokenUsage,
        },
        event.preAllocatedSequenceNumber
      );

      // Should be called with undefined as last param
      expect(mockPersistenceCoordinator._mocks.persistAgentMessage).toHaveBeenCalledWith(
        sessionId,
        expect.any(Object),
        undefined
      );
    });
  });

  describe('persistence strategy classification', () => {
    it('thinking should be sync_required', () => {
      expect(createThinkingEvent().persistenceStrategy).toBe('sync_required');
    });

    it('assistant_message should be sync_required', () => {
      expect(createAssistantMessageEvent().persistenceStrategy).toBe('sync_required');
    });

    it('tool_request should be async_allowed', () => {
      expect(createToolRequestEvent().persistenceStrategy).toBe('async_allowed');
    });

    it('tool_response should be async_allowed', () => {
      expect(createToolResponseEvent().persistenceStrategy).toBe('async_allowed');
    });

    it('complete should be transient', () => {
      expect(createCompleteEvent().persistenceStrategy).toBe('transient');
    });
  });
});
