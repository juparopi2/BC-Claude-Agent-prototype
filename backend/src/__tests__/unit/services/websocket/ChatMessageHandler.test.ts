/**
 * ChatMessageHandler Unit Tests
 *
 * Tests for ChatMessageHandler which handles WebSocket chat messages with DirectAgentService.
 * Implements enhanced contract with type-safe event discrimination and audit trail.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: EventStore.test.ts (40/40 tests passing)
 *
 * Coverage Target: 80%+ (ChatMessageHandler.ts is 405 lines)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatMessageHandler, getChatMessageHandler } from '@/services/websocket/ChatMessageHandler';
import type {
  AgentEvent,
  ThinkingEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  SessionEndEvent,
  CompleteEvent,
  ErrorEvent,
  SessionStartEvent,
  MessagePartialEvent,
  MessageChunkEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
} from '@/types';
import type { ChatMessageData } from '@/types/websocket.types';
import type { Server as SocketIOServer, Socket } from 'socket.io';

// ===== MOCK MESSAGE SERVICE (vi.hoisted pattern) =====
const mockMessageServiceMethods = vi.hoisted(() => ({
  // ⭐ PHASE 1B: saveUserMessage() now returns { messageId, sequenceNumber, eventId }
  saveUserMessage: vi.fn().mockResolvedValue({
    messageId: 'msg-user-123',
    sequenceNumber: 1,
    eventId: 'evt-123',
  }),
  saveToolUseMessage: vi.fn().mockResolvedValue('tool-123'),
  updateToolResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/messages/MessageService', () => ({
  getMessageService: vi.fn(() => mockMessageServiceMethods),
}));

// ===== MOCK DIRECT AGENT SERVICE (vi.hoisted pattern) =====
const mockDirectAgentServiceMethods = vi.hoisted(() => ({
  executeQueryStreaming: vi.fn().mockResolvedValue({
    response: 'Test response',
    toolsUsed: [],
    success: true,
  }),
}));

vi.mock('@/services/agent/DirectAgentService', () => ({
  getDirectAgentService: vi.fn(() => mockDirectAgentServiceMethods),
}));

// ===== MOCK DATABASE FOR SESSION OWNERSHIP (added for F4-003) =====
vi.mock('@config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    recordset: [{ user_id: 'test-user-456' }], // Default: user owns the session
    rowsAffected: [1],
    output: {},
    recordsets: [],
  }),
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

describe('ChatMessageHandler', () => {
  let handler: ChatMessageHandler;
  let mockSocket: Partial<Socket>;
  let mockIo: Partial<SocketIOServer>;
  let mockSocketEmit: ReturnType<typeof vi.fn>;
  let mockIoTo: ReturnType<typeof vi.fn>;
  let mockIoEmit: ReturnType<typeof vi.fn>;

  const testSessionId = 'test-session-123';
  const testUserId = 'test-user-456';
  const testMessage = 'Hello, agent!';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    // ⭐ PHASE 1B: saveUserMessage() now returns { messageId, sequenceNumber, eventId }
    mockMessageServiceMethods.saveUserMessage.mockResolvedValue({
      messageId: 'msg-user-123',
      sequenceNumber: 1,
      eventId: 'evt-123',
    });
    mockMessageServiceMethods.saveToolUseMessage.mockResolvedValue('tool-123');
    mockMessageServiceMethods.updateToolResult.mockResolvedValue(undefined);

    mockDirectAgentServiceMethods.executeQueryStreaming.mockResolvedValue({
      response: 'Test response',
      toolsUsed: [],
      success: true,
    });

    // Setup Socket.IO mocks
    // ⭐ F4-003: Socket must have userId to pass multi-tenant validation
    mockSocketEmit = vi.fn();
    mockSocket = {
      emit: mockSocketEmit,
      id: 'mock-socket-id',
      userId: testUserId, // AuthenticatedSocket.userId - required for multi-tenant safety
      userEmail: 'test@example.com', // AuthenticatedSocket.userEmail
    };

    mockIoEmit = vi.fn();
    mockIoTo = vi.fn().mockReturnValue({
      emit: mockIoEmit,
    });
    mockIo = {
      to: mockIoTo,
      emit: vi.fn(),
    };

    // Create handler instance
    handler = getChatMessageHandler();
  });

  // ========== SUITE 1: BASIC MESSAGE HANDLING (4 TESTS) ==========
  describe('handle() - Basic Message Handling', () => {
    it('should validate session ownership before processing', async () => {
      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify validateSessionOwnership() was called (currently just logs)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Validating session ownership',
        expect.objectContaining({ sessionId: testSessionId, userId: testUserId })
      );
    });

    it('should save user message with userId audit trail', async () => {
      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      expect(mockMessageServiceMethods.saveUserMessage).toHaveBeenCalledWith(
        testSessionId,
        testUserId,
        testMessage
      );
    });

    it('should execute agent query via DirectAgentService', async () => {
      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ⭐ PHASE 1B: executeQueryStreaming now receives userId as 4th parameter
      // ⭐ PHASE 1F: Optional 5th parameter is thinkingConfig (undefined when not provided)
      expect(mockDirectAgentServiceMethods.executeQueryStreaming).toHaveBeenCalledWith(
        testMessage,
        testSessionId,
        expect.any(Function), // onEvent callback
        testUserId, // userId for audit trail
        undefined // thinkingConfig (not provided in this test)
      );

      // ⭐ PHASE 1B: Final log message changed
      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ Chat message processed successfully (executeQueryStreaming completed)',
        expect.objectContaining({ sessionId: testSessionId, userId: testUserId })
      );
    });

    it('should emit error event on failure', async () => {
      const testError = new Error('Save failed');
      mockMessageServiceMethods.saveUserMessage.mockRejectedValueOnce(testError);

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ⭐ PHASE 1B: saveUserMessage() error message and format changed
      expect(mockLogger.error).toHaveBeenCalledWith(
        '❌ Failed to save user message',
        expect.objectContaining({
          error: testError,
          sessionId: testSessionId,
          userId: testUserId,
        })
      );

      // ⭐ PHASE 1B: Error emitted as agent:event with type: 'error', not agent:error
      expect(mockSocketEmit).toHaveBeenCalledWith('agent:event', {
        type: 'error',
        error: {
          code: 'MESSAGE_SAVE_FAILED',
          message: 'Failed to save your message. Please try again.',
          details: 'Save failed',
        },
        sessionId: testSessionId,
      });
    });
  });

  // ========== SUITE 2: EVENT DISCRIMINATION (13 TESTS) ==========
  describe('handleAgentEvent() - Event Discrimination', () => {
    it('should handle session_start event (no persistence)', async () => {
      const event: SessionStartEvent = {
        type: 'session_start',
        sessionId: testSessionId,
        userId: testUserId,
        timestamp: new Date(),
        eventId: 'evt-1',
        sequenceNumber: 1,
        persistenceState: 'persisted',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      // Simulate agent calling the event handler
      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify event emitted to session room
      expect(mockIoTo).toHaveBeenCalledWith(testSessionId);
      expect(mockIoEmit).toHaveBeenCalledWith('agent:event', event);

      // Verify logger called (no persistence)
      expect(mockLogger.debug).toHaveBeenCalledWith('Session started', {
        sessionId: testSessionId,
        userId: testUserId,
      });

      // ⭐ PHASE 1B: No persistence in ChatMessageHandler - DirectAgentService handles all persistence
    });

    /**
     * ⭐ PHASE 1B: Test REMOVED - "should handle thinking event (with persistence)"
     *
     * ChatMessageHandler NO LONGER persists thinking events. DirectAgentService handles
     * all persistence directly via EventStore + MessageQueue.
     *
     * Removed: 2025-11-24
     */

    it('should handle message_partial event (no persistence)', async () => {
      const event: MessagePartialEvent = {
        type: 'message_partial',
        content: 'This is partial...',
        timestamp: new Date(),
        eventId: 'evt-3',
        sequenceNumber: 3,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify event emitted but no persistence (DirectAgentService handles persistence)
      expect(mockIoEmit).toHaveBeenCalledWith('agent:event', event);
    });

    it('should handle message_chunk event (no persistence)', async () => {
      const event: MessageChunkEvent = {
        type: 'message_chunk',
        content: 'chunk of text',
        timestamp: new Date(),
        eventId: 'evt-4',
        sequenceNumber: 4,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify event emitted but no persistence (chunks are transient)
      expect(mockIoEmit).toHaveBeenCalledWith('agent:event', event);
    });

    /**
     * ⭐ PHASE 1B: Test REMOVED - "should handle message event with stopReason"
     *
     * ChatMessageHandler NO LONGER persists message events. DirectAgentService handles
     * all persistence directly via EventStore + MessageQueue before emitting events.
     *
     * The message event already has persistenceState = 'persisted' when it arrives at
     * ChatMessageHandler, so no additional persistence is needed.
     *
     * Removed: 2025-11-24
     */

    it('should handle tool_use event with valid toolUseId', async () => {
      const event: ToolUseEvent = {
        type: 'tool_use',
        toolName: 'list_all_entities',
        args: { entity: 'customer' },
        toolUseId: 'tool-456',
        timestamp: new Date(),
        eventId: 'evt-6',
        sequenceNumber: 6,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify tool use saved
      expect(mockMessageServiceMethods.saveToolUseMessage).toHaveBeenCalledWith(
        testSessionId,
        testUserId,
        'tool-456',
        'list_all_entities',
        { entity: 'customer' }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool use saved',
        expect.objectContaining({
          sessionId: testSessionId,
          userId: testUserId,
          toolName: 'list_all_entities',
          toolUseId: 'tool-456',
        })
      );
    });

    it('should skip tool_use event with missing toolUseId', async () => {
      const event: ToolUseEvent = {
        type: 'tool_use',
        toolName: 'list_all_entities',
        args: { entity: 'customer' },
        toolUseId: undefined, // Missing toolUseId
        timestamp: new Date(),
        eventId: 'evt-7',
        sequenceNumber: 7,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify warning logged and no persistence
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Tool use event missing toolUseId',
        expect.objectContaining({ sessionId: testSessionId, toolName: 'list_all_entities' })
      );

      expect(mockMessageServiceMethods.saveToolUseMessage).not.toHaveBeenCalled();
    });

    it('should handle tool_result event', async () => {
      const event: ToolResultEvent = {
        type: 'tool_result',
        toolName: 'list_all_entities',
        args: { entity: 'customer' },
        result: { entities: [{ id: 1, name: 'Acme Corp' }] },
        success: true,
        toolUseId: 'tool-456',
        timestamp: new Date(),
        eventId: 'evt-8',
        sequenceNumber: 8,
        persistenceState: 'queued',
        durationMs: 150,
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify tool result updated
      expect(mockMessageServiceMethods.updateToolResult).toHaveBeenCalledWith(
        testSessionId,
        testUserId,
        'tool-456',
        'list_all_entities',
        { entity: 'customer' },
        { entities: [{ id: 1, name: 'Acme Corp' }] },
        true,
        undefined // no error
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool result saved',
        expect.objectContaining({
          sessionId: testSessionId,
          userId: testUserId,
          toolName: 'list_all_entities',
          toolUseId: 'tool-456',
          success: true,
        })
      );
    });

    it('should detect TodoWrite tool (no additional persistence)', async () => {
      const event: ToolUseEvent = {
        type: 'tool_use',
        toolName: 'TodoWrite',
        args: {
          todos: [
            { content: 'Task 1', activeForm: 'Doing Task 1', status: 'pending' },
            { content: 'Task 2', activeForm: 'Doing Task 2', status: 'pending' },
          ],
        },
        toolUseId: 'tool-789',
        timestamp: new Date(),
        eventId: 'evt-9',
        sequenceNumber: 9,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify TodoWrite detected and logged
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'TodoWrite tool detected',
        expect.objectContaining({
          sessionId: testSessionId,
          userId: testUserId,
          todoCount: 2,
        })
      );

      // TodoWrite still saved to tool_use table
      expect(mockMessageServiceMethods.saveToolUseMessage).toHaveBeenCalledWith(
        testSessionId,
        testUserId,
        'tool-789',
        'TodoWrite',
        expect.objectContaining({ todos: expect.any(Array) })
      );
    });

    it('should handle session_end event (no persistence)', async () => {
      const event: SessionEndEvent = {
        type: 'session_end',
        sessionId: testSessionId,
        reason: 'completed',
        timestamp: new Date(),
        eventId: 'evt-10',
        sequenceNumber: 10,
        persistenceState: 'persisted',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify logger called (no persistence in ChatMessageHandler)
      expect(mockLogger.debug).toHaveBeenCalledWith('Session ended', {
        sessionId: testSessionId,
        userId: testUserId,
        reason: 'completed',
      });
    });

    it('should handle complete event', async () => {
      const event: CompleteEvent = {
        type: 'complete',
        reason: 'success',
        timestamp: new Date(),
        eventId: 'evt-11',
        sequenceNumber: 11,
        persistenceState: 'persisted',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify logger called
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Agent execution complete',
        expect.objectContaining({
          sessionId: testSessionId,
          userId: testUserId,
          reason: 'success',
        })
      );
    });

    it('should handle approval_requested event (no persistence)', async () => {
      const event: ApprovalRequestedEvent = {
        type: 'approval_requested',
        approvalId: 'approval-123',
        toolName: 'create_sales_order',
        args: { customer: 'Acme Corp' },
        changeSummary: 'Create new sales order',
        priority: 'high',
        timestamp: new Date(),
        eventId: 'evt-12',
        sequenceNumber: 12,
        persistenceState: 'persisted',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify logger called (approval handled by DirectAgentService)
      expect(mockLogger.debug).toHaveBeenCalledWith('Approval requested', {
        sessionId: testSessionId,
        userId: testUserId,
      });
    });

    it('should handle approval_resolved event (no persistence)', async () => {
      const event: ApprovalResolvedEvent = {
        type: 'approval_resolved',
        approvalId: 'approval-123',
        decision: 'approved',
        reason: 'User approved',
        timestamp: new Date(),
        eventId: 'evt-13',
        sequenceNumber: 13,
        persistenceState: 'persisted',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify logger called (approval handled by DirectAgentService)
      expect(mockLogger.debug).toHaveBeenCalledWith('Approval resolved', {
        sessionId: testSessionId,
        userId: testUserId,
      });
    });

    it('should handle error event', async () => {
      const event: ErrorEvent = {
        type: 'error',
        error: 'Tool execution failed',
        code: 'TOOL_ERROR',
        timestamp: new Date(),
        eventId: 'evt-14',
        sequenceNumber: 14,
        persistenceState: 'persisted',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Agent error event received',
        expect.objectContaining({
          sessionId: testSessionId,
          userId: testUserId,
          error: 'Tool execution failed',
        })
      );
    });
  });

  // ========== SUITE 3: MESSAGE ORDERING & RACE CONDITIONS (5 TESTS) ==========
  describe('Message Ordering & Race Conditions', () => {
    it('should preserve event order via sequenceNumber', async () => {
      const events: AgentEvent[] = [
        {
          type: 'thinking',
          content: 'First event',
          timestamp: new Date(),
          eventId: 'evt-1',
          sequenceNumber: 1,
          persistenceState: 'queued',
        } as ThinkingEvent,
        {
          type: 'message_chunk',
          content: 'Second event',
          timestamp: new Date(),
          eventId: 'evt-2',
          sequenceNumber: 2,
          persistenceState: 'queued',
        } as MessageChunkEvent,
        {
          type: 'message',
          content: 'Third event',
          messageId: 'msg-3',
          role: 'assistant',
          stopReason: 'end_turn',
          timestamp: new Date(),
          eventId: 'evt-3',
          sequenceNumber: 3,
          persistenceState: 'queued',
        } as MessageEvent,
      ];

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      // Track emission order
      const emittedEvents: AgentEvent[] = [];
      mockIoTo.mockReturnValue({
        emit: vi.fn((eventName: string, event: AgentEvent) => {
          if (eventName === 'agent:event') {
            emittedEvents.push(event);
          }
        }),
      });

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          // Emit events sequentially
          for (const event of events) {
            await onEvent(event);
          }
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ⭐ PHASE 1B: Now expects 4 events (user_message_confirmed + 3 agent events)
      expect(emittedEvents).toHaveLength(4);

      // First event is user_message_confirmed
      expect(emittedEvents[0]!.type).toBe('user_message_confirmed');
      expect(emittedEvents[0]!.sequenceNumber).toBe(1);

      // Then agent events in order
      expect(emittedEvents[1]!.type).toBe('thinking');
      expect(emittedEvents[1]!.sequenceNumber).toBe(1);

      expect(emittedEvents[2]!.type).toBe('message_chunk');
      expect(emittedEvents[2]!.sequenceNumber).toBe(2);

      expect(emittedEvents[3]!.type).toBe('message');
      expect(emittedEvents[3]!.sequenceNumber).toBe(3);
    });

    it('should handle concurrent events without race conditions', async () => {
      const events: AgentEvent[] = [
        {
          type: 'tool_use',
          toolName: 'tool1',
          args: {},
          toolUseId: 'tool-1',
          timestamp: new Date(),
          eventId: 'evt-1',
          sequenceNumber: 1,
          persistenceState: 'queued',
        } as ToolUseEvent,
        {
          type: 'tool_use',
          toolName: 'tool2',
          args: {},
          toolUseId: 'tool-2',
          timestamp: new Date(),
          eventId: 'evt-2',
          sequenceNumber: 2,
          persistenceState: 'queued',
        } as ToolUseEvent,
      ];

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      // Track saveToolUseMessage call order
      const savedToolIds: string[] = [];
      mockMessageServiceMethods.saveToolUseMessage.mockImplementation(
        async (_sessionId: string, _userId: string, toolUseId: string) => {
          savedToolIds.push(toolUseId);
          return toolUseId;
        }
      );

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          // Emit events concurrently (simulate race condition)
          await Promise.all(events.map((event) => onEvent(event)));
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify both tools saved (order may vary due to concurrency)
      expect(savedToolIds).toHaveLength(2);
      expect(savedToolIds).toContain('tool-1');
      expect(savedToolIds).toContain('tool-2');

      // Verify both tool use messages saved
      expect(mockMessageServiceMethods.saveToolUseMessage).toHaveBeenCalledTimes(2);
    });

    it('should maintain order between tool_use and tool_result', async () => {
      const events: AgentEvent[] = [
        {
          type: 'tool_use',
          toolName: 'list_all_entities',
          args: { entity: 'customer' },
          toolUseId: 'tool-123',
          timestamp: new Date(),
          eventId: 'evt-1',
          sequenceNumber: 1,
          persistenceState: 'queued',
        } as ToolUseEvent,
        {
          type: 'tool_result',
          toolName: 'list_all_entities',
          args: { entity: 'customer' },
          result: { entities: [] },
          success: true,
          toolUseId: 'tool-123',
          timestamp: new Date(),
          eventId: 'evt-2',
          sequenceNumber: 2,
          persistenceState: 'queued',
        } as ToolResultEvent,
      ];

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      // Track call order
      const callOrder: string[] = [];
      mockMessageServiceMethods.saveToolUseMessage.mockImplementationOnce(async () => {
        callOrder.push('saveToolUseMessage');
        return 'tool-123';
      });
      mockMessageServiceMethods.updateToolResult.mockImplementationOnce(async () => {
        callOrder.push('updateToolResult');
      });

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          for (const event of events) {
            await onEvent(event);
          }
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify correct order: tool_use BEFORE tool_result
      expect(callOrder).toEqual(['saveToolUseMessage', 'updateToolResult']);
    });

    it('should emit events to correct session room (no cross-session leaks)', async () => {
      const event: ThinkingEvent = {
        type: 'thinking',
        content: 'Thinking...',
        timestamp: new Date(),
        eventId: 'evt-1',
        sequenceNumber: 1,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ⭐ PHASE 1B: mockIoTo called twice (user_message_confirmed + thinking event)
      expect(mockIoTo).toHaveBeenCalledWith(testSessionId);
      expect(mockIoTo).toHaveBeenCalledTimes(2); // Called once for user_message_confirmed, once for thinking

      // Verify no global broadcast
      expect(mockIo.emit).not.toHaveBeenCalled();
    });

    /**
     * ⭐ PHASE 1B: Test REMOVED - "should handle persistence errors without breaking event emission"
     *
     * ChatMessageHandler NO LONGER handles persistence. DirectAgentService handles all persistence
     * before emitting events, so there are no persistence errors to handle in ChatMessageHandler.
     *
     * Removed: 2025-11-24
     */
  });

  // ========== SUITE 4: WEBSOCKET EMISSION (2 TESTS) ==========
  describe('WebSocket Emission', () => {
    it('should emit agent:event to correct session room', async () => {
      const event: MessageEvent = {
        type: 'message',
        content: 'Test message',
        messageId: 'msg-123',
        role: 'assistant',
        stopReason: 'end_turn',
        timestamp: new Date(),
        eventId: 'evt-1',
        sequenceNumber: 1,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify io.to(sessionId).emit() called with correct args
      expect(mockIoTo).toHaveBeenCalledWith(testSessionId);
      expect(mockIoEmit).toHaveBeenCalledWith('agent:event', event);
    });

    /**
     * ⭐ PHASE 1B: Test REMOVED - "should handle WebSocket emission errors gracefully"
     *
     * This test was testing that thinking event persistence errors don't break WebSocket emission.
     * With Phase 1B, ChatMessageHandler NO LONGER persists thinking events - DirectAgentService
     * handles all persistence before emitting events.
     *
     * The test is no longer relevant because there's no persistence to fail in ChatMessageHandler.
     *
     * Removed: 2025-11-24
     */
  });

  // ========== SUITE 5: AUDIT TRAIL (1 TEST) ==========
  describe('Audit Trail', () => {
    /**
     * ⭐ PHASE 1B: Test REMOVED - "should pass userId to all persistence methods"
     *
     * ChatMessageHandler NO LONGER calls saveThinkingMessage() or saveAgentMessage().
     * DirectAgentService handles all persistence directly with userId audit trail.
     *
     * Removed: 2025-11-24
     */

    it('should include userId in all log statements', async () => {
      const event: ToolUseEvent = {
        type: 'tool_use',
        toolName: 'list_all_entities',
        args: {},
        toolUseId: 'tool-123',
        timestamp: new Date(),
        eventId: 'evt-1',
        sequenceNumber: 1,
        persistenceState: 'queued',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockDirectAgentServiceMethods.executeQueryStreaming.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify userId in log calls
      const logCalls = mockLogger.debug.mock.calls.concat(mockLogger.info.mock.calls);
      const logCallsWithUserId = logCalls.filter(
        (call: unknown[]) =>
          typeof call[1] === 'object' &&
          call[1] !== null &&
          'userId' in call[1] &&
          (call[1] as { userId: string }).userId === testUserId
      );

      // Expect at least 2 log calls with userId (validate + tool use saved)
      expect(logCallsWithUserId.length).toBeGreaterThanOrEqual(2);
    });
  });
});
