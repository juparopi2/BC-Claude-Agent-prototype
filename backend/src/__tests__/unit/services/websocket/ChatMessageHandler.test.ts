/**
 * ChatMessageHandler Unit Tests
 *
 * Tests for ChatMessageHandler which handles WebSocket chat messages with AgentOrchestrator.
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

// ===== MOCK AGENT ORCHESTRATOR (vi.hoisted pattern) =====
const mockAgentOrchestratorMethods = vi.hoisted(() => ({
  executeAgentSync: vi.fn().mockResolvedValue({
    response: 'Test response',
    toolsUsed: [],
    success: true,
  }),
}));

vi.mock('@domains/agent/orchestration', () => ({
  getAgentOrchestrator: vi.fn(() => mockAgentOrchestratorMethods),
}));

// ===== MOCK PRISMA FOR SESSION OWNERSHIP (migrated from executeQuery) =====
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    sessions: {
      findUnique: vi.fn().mockResolvedValue({ user_id: 'test-user-456' }), // Default: user owns the session
    },
  },
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
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

    mockAgentOrchestratorMethods.executeAgentSync.mockResolvedValue({
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

    it('should delegate message handling to AgentOrchestrator (persistence moved to orchestrator)', async () => {
      // ⭐ REFACTORED: ChatMessageHandler no longer calls saveUserMessage directly
      // User message persistence is now handled by AgentOrchestrator → PersistenceCoordinator
      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify orchestrator is called with correct parameters (it handles persistence internally)
      expect(mockAgentOrchestratorMethods.executeAgentSync).toHaveBeenCalledWith(
        testMessage,
        testSessionId,
        expect.any(Function), // onEvent callback
        testUserId,
        expect.any(Object) // options
      );
    });

    it('should execute agent query via AgentOrchestrator', async () => {
      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ⭐ PHASE 1B: executeAgentSync receives userId as 4th parameter
      // ⭐ PHASE 1F: Optional 5th parameter is options (undefined when not provided)
      expect(mockAgentOrchestratorMethods.executeAgentSync).toHaveBeenCalledWith(
        testMessage,
        testSessionId,
        expect.any(Function), // onEvent callback
        testUserId, // userId for audit trail
        { attachments: undefined } // options object with attachments
      );

      // ⭐ PHASE 1B: Final log message changed
      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ Chat message processed successfully (executeAgentSync completed)',
        expect.objectContaining({ sessionId: testSessionId, userId: testUserId })
      );
    });

    it('should emit error event on orchestrator failure', async () => {
      // Simulate orchestrator error via onEvent callback
      const orchestratorError = new Error('Orchestrator failed');
      mockAgentOrchestratorMethods.executeAgentSync.mockRejectedValueOnce(orchestratorError);

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Error should be logged with the detailed format
      expect(mockLogger.error).toHaveBeenCalledWith(
        '❌ Chat message handler error (DETAILED)',
        expect.objectContaining({
          sessionId: testSessionId,
          error: 'Orchestrator failed',
        })
      );
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
      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
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

      // ⭐ PHASE 1B: No persistence in ChatMessageHandler - AgentOrchestrator handles all persistence
    });

    /**
     * ⭐ PHASE 1B: Tests REMOVED - thinking, message_partial, message_chunk
     *
     * ChatMessageHandler NO LONGER persists these events. AgentOrchestrator handles
     * all persistence directly via EventStore + MessageQueue.
     *
     * Additionally, message_partial and message_chunk events have been removed from
     * the sync architecture - only complete messages are emitted now.
     *
     * Removed: 2025-11-24 (thinking)
     * Removed: 2025-12-31 (message_partial, message_chunk - sync architecture)
     */

    /**
     * ⭐ PHASE 1B: Test REMOVED - "should handle message event with stopReason"
     *
     * ChatMessageHandler NO LONGER persists message events. AgentOrchestrator handles
     * all persistence directly via EventStore + MessageQueue before emitting events.
     *
     * The message event already has persistenceState = 'persisted' when it arrives at
     * ChatMessageHandler, so no additional persistence is needed.
     *
     * Removed: 2025-11-24
     */

    it('should handle tool_use event (persistence via ToolLifecycleManager)', async () => {
      // NOTE: Tool persistence is now handled by ToolLifecycleManager in AgentOrchestrator.
      // ChatMessageHandler only emits to frontend and logs - no direct persistence.
      const event: ToolUseEvent = {
        type: 'tool_use',
        toolName: 'list_all_entities',
        args: { entity: 'customer' },
        toolUseId: 'tool-456',
        timestamp: new Date(),
        eventId: 'evt-6',
        sequenceNumber: 6,
        persistenceState: 'pending',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify tool event logged (persistence handled by ToolLifecycleManager)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool use event - persistence via ToolLifecycleManager',
        expect.objectContaining({
          toolUseId: 'tool-456',
        })
      );

      // ChatMessageHandler should NOT call saveToolUseMessage (handled by AgentOrchestrator)
      expect(mockMessageServiceMethods.saveToolUseMessage).not.toHaveBeenCalled();
    });

    it('should handle tool_use event even with missing toolUseId (logs only)', async () => {
      // NOTE: Tool validation now happens in ToolLifecycleManager, not ChatMessageHandler.
      // ChatMessageHandler just logs and emits.
      const event: ToolUseEvent = {
        type: 'tool_use',
        toolName: 'list_all_entities',
        args: { entity: 'customer' },
        toolUseId: undefined, // Missing toolUseId - validation is in ToolLifecycleManager
        timestamp: new Date(),
        eventId: 'evt-7',
        sequenceNumber: 7,
        persistenceState: 'pending',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ChatMessageHandler just logs - validation is in ToolLifecycleManager
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool use event - persistence via ToolLifecycleManager',
        expect.objectContaining({ toolUseId: undefined })
      );

      // No direct persistence from ChatMessageHandler
      expect(mockMessageServiceMethods.saveToolUseMessage).not.toHaveBeenCalled();
    });

    it('should handle tool_result event (persistence via ToolLifecycleManager)', async () => {
      // NOTE: Tool persistence is now handled by ToolLifecycleManager in AgentOrchestrator.
      // ChatMessageHandler only emits to frontend and logs - no direct persistence.
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
        persistenceState: 'pending',
        durationMs: 150,
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify tool event logged (persistence handled by ToolLifecycleManager)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool result event - persistence via ToolLifecycleManager',
        expect.objectContaining({
          toolUseId: 'tool-456',
        })
      );

      // ChatMessageHandler should NOT call updateToolResult (handled by AgentOrchestrator)
      expect(mockMessageServiceMethods.updateToolResult).not.toHaveBeenCalled();
    });

    it('should handle TodoWrite tool like any other tool (persistence via ToolLifecycleManager)', async () => {
      // NOTE: TodoWrite is now handled the same as any other tool.
      // Special TodoWrite detection was removed since persistence is unified in ToolLifecycleManager.
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
        persistenceState: 'pending',
      };

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify tool logged (persistence handled by ToolLifecycleManager)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool use event - persistence via ToolLifecycleManager',
        expect.objectContaining({
          toolUseId: 'tool-789',
        })
      );

      // ChatMessageHandler should NOT call saveToolUseMessage (handled by AgentOrchestrator)
      expect(mockMessageServiceMethods.saveToolUseMessage).not.toHaveBeenCalled();
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify logger called (approval handled by AgentOrchestrator)
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify logger called (approval handled by AgentOrchestrator)
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
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
      // NOTE: Using sync architecture events (no message_chunk)
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
          type: 'tool_use',
          toolName: 'list_entities',
          args: { type: 'customer' },
          toolUseId: 'tool-1',
          timestamp: new Date(),
          eventId: 'evt-2',
          sequenceNumber: 2,
          persistenceState: 'queued',
        } as ToolUseEvent,
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          // Emit events sequentially
          for (const event of events) {
            await onEvent(event);
          }
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ⭐ REFACTORED: Now expects 3 events from orchestrator (user_message_confirmed is emitted by orchestrator)
      // NOTE: Events changed to use tool_use instead of message_chunk (sync architecture)
      expect(emittedEvents).toHaveLength(3);

      // Agent events in order (user_message_confirmed is now emitted by AgentOrchestrator, not ChatMessageHandler)
      expect(emittedEvents[0]!.type).toBe('thinking');
      expect(emittedEvents[0]!.sequenceNumber).toBe(1);

      expect(emittedEvents[1]!.type).toBe('tool_use');
      expect(emittedEvents[1]!.sequenceNumber).toBe(2);

      expect(emittedEvents[2]!.type).toBe('message');
      expect(emittedEvents[2]!.sequenceNumber).toBe(3);
    });

    it('should handle concurrent events without race conditions (logging only)', async () => {
      // NOTE: ChatMessageHandler no longer persists tool events directly.
      // Persistence is handled by ToolLifecycleManager in AgentOrchestrator.
      // This test verifies events are logged without errors during concurrent emission.
      const events: AgentEvent[] = [
        {
          type: 'tool_use',
          toolName: 'tool1',
          args: {},
          toolUseId: 'tool-1',
          timestamp: new Date(),
          eventId: 'evt-1',
          sequenceNumber: 1,
          persistenceState: 'pending',
        } as ToolUseEvent,
        {
          type: 'tool_use',
          toolName: 'tool2',
          args: {},
          toolUseId: 'tool-2',
          timestamp: new Date(),
          eventId: 'evt-2',
          sequenceNumber: 2,
          persistenceState: 'pending',
        } as ToolUseEvent,
      ];

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          // Emit events concurrently (simulate race condition)
          await Promise.all(events.map((event) => onEvent(event)));
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify both tools logged (persistence handled by ToolLifecycleManager)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool use event - persistence via ToolLifecycleManager',
        expect.objectContaining({ toolUseId: 'tool-1' })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool use event - persistence via ToolLifecycleManager',
        expect.objectContaining({ toolUseId: 'tool-2' })
      );

      // ChatMessageHandler should NOT call saveToolUseMessage (handled by AgentOrchestrator)
      expect(mockMessageServiceMethods.saveToolUseMessage).not.toHaveBeenCalled();
    });

    it('should emit tool_use before tool_result in correct order (logging only)', async () => {
      // NOTE: ChatMessageHandler no longer persists tool events directly.
      // Persistence order is maintained by ToolLifecycleManager in AgentOrchestrator.
      // This test verifies events are logged in the order they are received.
      const events: AgentEvent[] = [
        {
          type: 'tool_use',
          toolName: 'list_all_entities',
          args: { entity: 'customer' },
          toolUseId: 'tool-123',
          timestamp: new Date(),
          eventId: 'evt-1',
          sequenceNumber: 1,
          persistenceState: 'pending',
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
          persistenceState: 'pending',
        } as ToolResultEvent,
      ];

      const data: ChatMessageData = {
        message: testMessage,
        sessionId: testSessionId,
        userId: testUserId,
      };

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          for (const event of events) {
            await onEvent(event);
          }
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // Verify events logged (persistence handled by ToolLifecycleManager)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool use event - persistence via ToolLifecycleManager',
        expect.objectContaining({ toolUseId: 'tool-123' })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool result event - persistence via ToolLifecycleManager',
        expect.objectContaining({ toolUseId: 'tool-123' })
      );

      // ChatMessageHandler should NOT call save methods (handled by AgentOrchestrator)
      expect(mockMessageServiceMethods.saveToolUseMessage).not.toHaveBeenCalled();
      expect(mockMessageServiceMethods.updateToolResult).not.toHaveBeenCalled();
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
        async (_prompt: string, _sessionId: string, onEvent: (event: AgentEvent) => void) => {
          await onEvent(event);
          return { response: 'Test', toolsUsed: [], success: true };
        }
      );

      await handler.handle(data, mockSocket as Socket, mockIo as SocketIOServer);

      // ⭐ REFACTORED: mockIoTo called once per event from orchestrator (user_message_confirmed is now emitted by orchestrator)
      expect(mockIoTo).toHaveBeenCalledWith(testSessionId);
      expect(mockIoTo).toHaveBeenCalledTimes(1); // Called once for thinking event

      // Verify no global broadcast
      expect(mockIo.emit).not.toHaveBeenCalled();
    });

    /**
     * ⭐ PHASE 1B: Test REMOVED - "should handle persistence errors without breaking event emission"
     *
     * ChatMessageHandler NO LONGER handles persistence. AgentOrchestrator handles all persistence
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
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
     * With Phase 1B, ChatMessageHandler NO LONGER persists thinking events - AgentOrchestrator
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
     * AgentOrchestrator handles all persistence directly with userId audit trail.
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

      mockAgentOrchestratorMethods.executeAgentSync.mockImplementationOnce(
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
