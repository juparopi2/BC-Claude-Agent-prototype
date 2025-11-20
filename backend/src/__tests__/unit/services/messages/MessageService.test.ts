/**
 * MessageService Unit Tests
 *
 * Tests for MessageService which provides high-level API for message persistence
 * using Event Sourcing pattern (EventStore + MessageQueue).
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: EventStore.test.ts (40/40 tests passing)
 *
 * Coverage Target: 80%+ (MessageService.ts is 508 lines)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageService, getMessageService } from '@/services/messages/MessageService';
import type { MessageDbRecord, ParsedMessage } from '@/types/message.types';

// ===== MOCK EVENT STORE (vi.hoisted pattern) =====
const mockEventStoreMethods = vi.hoisted(() => ({
  appendEvent: vi.fn().mockResolvedValue(undefined),
  replayEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => mockEventStoreMethods),
}));

// ===== MOCK MESSAGE QUEUE (vi.hoisted pattern) =====
const mockMessageQueueMethods = vi.hoisted(() => ({
  addMessagePersistence: vi.fn().mockResolvedValue({ id: 'job-123' }),
}));

vi.mock('@/services/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => mockMessageQueueMethods),
}));

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/config/database', () => ({
  executeQuery: mockExecuteQuery,
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
}));

// ===== MOCK crypto.randomUUID (vi.hoisted pattern) =====
let mockUuidCounter = 0;
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => `mock-uuid-${++mockUuidCounter}`),
}));

describe('MessageService', () => {
  let messageService: MessageService;

  const testSessionId = 'test-session-123';
  const testUserId = 'test-user-456';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUuidCounter = 0; // Reset UUID counter

    // Re-setup mock implementations after clearAllMocks
    mockEventStoreMethods.appendEvent.mockResolvedValue(undefined);
    mockEventStoreMethods.replayEvents.mockResolvedValue(undefined);

    mockMessageQueueMethods.addMessagePersistence.mockResolvedValue({ id: 'job-123' });

    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Reset singleton instance
    (MessageService as any).instance = null;
    messageService = getMessageService();
  });

  // ========== SUITE 1: SAVE USER MESSAGE (5 TESTS) ==========
  describe('saveUserMessage()', () => {
    it('should generate UUID messageId', async () => {
      const messageId = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        'Hello, world!'
      );

      // Verify UUID format (mock-uuid-N)
      expect(messageId).toMatch(/^mock-uuid-\d+$/);
    });

    it('should append event to EventStore', async () => {
      const testContent = 'Hello, world!';
      const messageId = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        testContent
      );

      expect(mockEventStoreMethods.appendEvent).toHaveBeenCalledWith(
        testSessionId,
        'user_message_sent',
        expect.objectContaining({
          message_id: messageId,
          content: testContent,
          user_id: testUserId,
        })
      );
    });

    it('should queue message for persistence', async () => {
      const testContent = 'Hello, world!';
      const messageId = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        testContent
      );

      expect(mockMessageQueueMethods.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: messageId,
          role: 'user',
          messageType: 'text',
          content: testContent,
          metadata: expect.objectContaining({ user_id: testUserId }),
        })
      );
    });

    it('should log debug message', async () => {
      const messageId = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        'Hello, world!'
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'User message saved',
        expect.objectContaining({ sessionId: testSessionId, messageId, userId: testUserId })
      );
    });

    it('should throw error on EventStore failure', async () => {
      const testError = new Error('EventStore error');
      mockEventStoreMethods.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        messageService.saveUserMessage(testSessionId, testUserId, 'Hello, world!')
      ).rejects.toThrow('EventStore error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to save user message',
        expect.objectContaining({
          error: testError,
          sessionId: testSessionId,
          userId: testUserId,
        })
      );
    });
  });

  // ========== SUITE 2: SAVE AGENT MESSAGE (5 TESTS) ==========
  describe('saveAgentMessage()', () => {
    it('should save message with stopReason', async () => {
      const testContent = 'Agent response';
      const stopReason = 'end_turn';

      const messageId = await messageService.saveAgentMessage(
        testSessionId,
        testUserId,
        testContent,
        stopReason
      );

      expect(mockEventStoreMethods.appendEvent).toHaveBeenCalledWith(
        testSessionId,
        'agent_message_sent',
        expect.objectContaining({
          message_id: messageId,
          content: testContent,
          stop_reason: stopReason,
          user_id: testUserId,
        })
      );
    });

    it('should save message with null stopReason', async () => {
      const testContent = 'Agent response';

      const messageId = await messageService.saveAgentMessage(
        testSessionId,
        testUserId,
        testContent,
        null
      );

      expect(mockEventStoreMethods.appendEvent).toHaveBeenCalledWith(
        testSessionId,
        'agent_message_sent',
        expect.objectContaining({
          message_id: messageId,
          content: testContent,
          stop_reason: null,
          user_id: testUserId,
        })
      );
    });

    it('should include userId in metadata', async () => {
      const messageId = await messageService.saveAgentMessage(
        testSessionId,
        testUserId,
        'Agent response',
        'end_turn'
      );

      expect(mockMessageQueueMethods.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: testSessionId,
          messageId,
          role: 'assistant',
          messageType: 'text',
          metadata: expect.objectContaining({
            stop_reason: 'end_turn',
            user_id: testUserId, // ⭐ Audit trail
          }),
        })
      );
    });

    it('should log debug with userId', async () => {
      const messageId = await messageService.saveAgentMessage(
        testSessionId,
        testUserId,
        'Agent response',
        'end_turn'
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Agent message saved',
        expect.objectContaining({ sessionId: testSessionId, userId: testUserId, messageId })
      );
    });

    it('should throw error on queue failure', async () => {
      const testError = new Error('Queue error');
      mockMessageQueueMethods.addMessagePersistence.mockRejectedValueOnce(testError);

      await expect(
        messageService.saveAgentMessage(testSessionId, testUserId, 'Agent response')
      ).rejects.toThrow('Queue error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to save agent message',
        expect.objectContaining({ error: testError, sessionId: testSessionId, userId: testUserId })
      );
    });
  });

  // ========== SUITE 3: SAVE THINKING MESSAGE (3 TESTS) ==========
  describe('saveThinkingMessage()', () => {
    it('should save thinking with timestamp', async () => {
      const testContent = 'Analyzing the request...';

      await messageService.saveThinkingMessage(testSessionId, testUserId, testContent);

      expect(mockEventStoreMethods.appendEvent).toHaveBeenCalledWith(
        testSessionId,
        'agent_thinking_started',
        expect.objectContaining({
          message_id: expect.stringMatching(/^mock-uuid-\d+$/),
          content: testContent,
          started_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), // ISO 8601 format
          user_id: testUserId,
        })
      );
    });

    it('should store content in metadata (not content field)', async () => {
      const testContent = 'Analyzing the request...';

      await messageService.saveThinkingMessage(testSessionId, testUserId, testContent);

      expect(mockMessageQueueMethods.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          messageType: 'thinking',
          content: '', // ⭐ Empty content field
          metadata: expect.objectContaining({
            content: testContent, // ⭐ Content in metadata
            started_at: expect.any(String),
            user_id: testUserId,
          }),
        })
      );
    });

    it('should include userId in audit trail', async () => {
      await messageService.saveThinkingMessage(testSessionId, testUserId, 'Thinking...');

      // Verify userId in EventStore
      expect(mockEventStoreMethods.appendEvent).toHaveBeenCalledWith(
        testSessionId,
        'agent_thinking_started',
        expect.objectContaining({ user_id: testUserId })
      );

      // Verify userId in MessageQueue
      expect(mockMessageQueueMethods.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ user_id: testUserId }),
        })
      );
    });
  });

  // ========== SUITE 4: TOOL USE MESSAGES (6 TESTS) ==========
  describe('saveToolUseMessage() & updateToolResult()', () => {
    it('should use toolUseId as messageId', async () => {
      const toolUseId = 'tool-123';
      const toolName = 'list_all_entities';
      const toolArgs = { entity: 'customer' };

      const messageId = await messageService.saveToolUseMessage(
        testSessionId,
        testUserId,
        toolUseId,
        toolName,
        toolArgs
      );

      // Verify toolUseId used as messageId
      expect(messageId).toBe(toolUseId);
    });

    it('should save tool use with pending status', async () => {
      const toolUseId = 'tool-123';
      const toolName = 'list_all_entities';
      const toolArgs = { entity: 'customer' };

      await messageService.saveToolUseMessage(
        testSessionId,
        testUserId,
        toolUseId,
        toolName,
        toolArgs
      );

      expect(mockMessageQueueMethods.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: toolUseId,
          role: 'assistant',
          messageType: 'tool_use',
          content: '',
          metadata: expect.objectContaining({
            tool_name: toolName,
            tool_args: toolArgs,
            tool_use_id: toolUseId,
            status: 'pending', // ⭐ Initial status
            user_id: testUserId,
          }),
        })
      );
    });

    it('should update tool result with success status', async () => {
      const toolUseId = 'tool-123';
      const toolName = 'list_all_entities';
      const toolArgs = { entity: 'customer' };
      const toolResult = { entities: [{ id: 1, name: 'Acme Corp' }] };

      await messageService.updateToolResult(
        testSessionId,
        testUserId,
        toolUseId,
        toolName,
        toolArgs,
        toolResult,
        true // success
      );

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE messages'),
        expect.objectContaining({
          id: toolUseId,
          session_id: testSessionId,
          metadata: expect.stringMatching(/"status":"success"/),
        })
      );

      // Verify metadata contains all required fields
      const metadataArg = vi.mocked(mockExecuteQuery).mock.calls[0]![1]! as {
        metadata: string;
      };
      const metadata = JSON.parse(metadataArg.metadata);
      expect(metadata).toMatchObject({
        tool_name: toolName,
        tool_args: toolArgs,
        tool_result: toolResult,
        tool_use_id: toolUseId,
        status: 'success',
        success: true,
        error_message: null,
        user_id: testUserId,
      });
    });

    it('should update tool result with error status', async () => {
      const toolUseId = 'tool-456';
      const toolName = 'unknown_tool';
      const toolArgs = {};
      const errorMsg = 'Tool not found';

      await messageService.updateToolResult(
        testSessionId,
        testUserId,
        toolUseId,
        toolName,
        toolArgs,
        null, // no result
        false, // failed
        errorMsg
      );

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE messages'),
        expect.objectContaining({
          id: toolUseId,
          session_id: testSessionId,
          metadata: expect.stringMatching(/"status":"error"/),
        })
      );

      // Verify error message in metadata
      const metadataArg = vi.mocked(mockExecuteQuery).mock.calls[0]![1]! as {
        metadata: string;
      };
      const metadata = JSON.parse(metadataArg.metadata);
      expect(metadata).toMatchObject({
        status: 'error',
        success: false,
        error_message: errorMsg,
      });
    });

    it('should append event on tool completion', async () => {
      const toolUseId = 'tool-789';
      const toolName = 'list_all_entities';
      const toolArgs = { entity: 'customer' };
      const toolResult = { entities: [] };

      await messageService.updateToolResult(
        testSessionId,
        testUserId,
        toolUseId,
        toolName,
        toolArgs,
        toolResult,
        true
      );

      expect(mockEventStoreMethods.appendEvent).toHaveBeenCalledWith(
        testSessionId,
        'tool_use_completed',
        expect.objectContaining({
          tool_use_id: toolUseId,
          tool_name: toolName,
          tool_result: toolResult,
          success: true,
          error_message: undefined,
          user_id: testUserId,
        })
      );
    });

    it('should preserve tool args when updating result', async () => {
      const toolUseId = 'tool-999';
      const toolName = 'list_all_entities';
      const toolArgs = { entity: 'customer', filter: 'active' };
      const toolResult = { entities: [] };

      await messageService.updateToolResult(
        testSessionId,
        testUserId,
        toolUseId,
        toolName,
        toolArgs,
        toolResult,
        true
      );

      // Verify tool args preserved in UPDATE
      const metadataArg = vi.mocked(mockExecuteQuery).mock.calls[0]![1]! as {
        metadata: string;
      };
      const metadata = JSON.parse(metadataArg.metadata);

      expect(metadata.tool_args).toEqual({
        entity: 'customer',
        filter: 'active',
      });
    });
  });

  // ========== SUITE 5: QUERY METHODS (5 TESTS) ==========
  describe('Query Methods', () => {
    it('should get messages by session with pagination', async () => {
      const mockMessages: MessageDbRecord[] = [
        {
          id: 'msg-1',
          session_id: testSessionId,
          role: 'user',
          message_type: 'text',
          content: 'Hello',
          metadata: '{}',
          created_at: new Date('2025-01-01T10:00:00Z'),
          sequence_number: 1,
          event_id: 'evt-1',
        },
        {
          id: 'msg-2',
          session_id: testSessionId,
          role: 'assistant',
          message_type: 'text',
          content: 'Hi there!',
          metadata: '{}',
          created_at: new Date('2025-01-01T10:00:05Z'),
          sequence_number: 2,
          event_id: 'evt-2',
        },
      ];

      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockMessages });

      const messages = await messageService.getMessagesBySession(testSessionId, 10, 0);

      expect(messages).toHaveLength(2);
      expect(messages[0]!.id).toBe('msg-1');
      expect(messages[1]!.id).toBe('msg-2');

      // Verify SQL query with pagination
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY'),
        expect.objectContaining({
          session_id: testSessionId,
          offset: 0,
          limit: 10,
        })
      );
    });

    it('should get message by ID', async () => {
      const mockMessage: MessageDbRecord = {
        id: 'msg-123',
        session_id: testSessionId,
        role: 'user',
        message_type: 'text',
        content: 'Hello',
        metadata: '{}',
        created_at: new Date(),
        sequence_number: 1,
        event_id: 'evt-1',
      };

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockMessage] });

      const message = await messageService.getMessageById('msg-123');

      expect(message).toBeDefined();
      expect(message?.id).toBe('msg-123');
      expect(message?.content).toBe('Hello');

      // Verify SQL query
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id'),
        { id: 'msg-123' }
      );
    });

    it('should return null when message not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const message = await messageService.getMessageById('nonexistent');

      expect(message).toBeNull();
    });

    it('should get message count for session', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 42 }] });

      const count = await messageService.getMessageCount(testSessionId);

      expect(count).toBe(42);

      // Verify SQL query
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        { session_id: testSessionId }
      );
    });

    it('should check if first user message', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 1 }] });

      const isFirst = await messageService.isFirstUserMessage(testSessionId);

      expect(isFirst).toBe(true);

      // Verify SQL query filters by role='user'
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE.*role = 'user'/),
        { session_id: testSessionId }
      );

      // Test with multiple user messages
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 3 }] });
      const isNotFirst = await messageService.isFirstUserMessage(testSessionId);
      expect(isNotFirst).toBe(false);
    });
  });

  // ========== SUITE 6: DELETE MESSAGES (3 TESTS) ==========
  describe('deleteMessagesBySession()', () => {
    it('should delete all messages for session', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [5] });

      const count = await messageService.deleteMessagesBySession(testSessionId);

      expect(count).toBe(5);

      // Verify SQL DELETE query
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM messages'),
        { session_id: testSessionId }
      );
    });

    it('should log delete count', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [3] });

      await messageService.deleteMessagesBySession(testSessionId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Messages deleted for session',
        expect.objectContaining({
          sessionId: testSessionId,
          deletedCount: 3,
        })
      );
    });

    it('should return 0 when no messages deleted', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      const count = await messageService.deleteMessagesBySession(testSessionId);

      expect(count).toBe(0);
    });
  });

  // ========== SUITE 7: REPLAY MESSAGES (2 TESTS) ==========
  describe('replayMessages()', () => {
    it('should replay events from EventStore', async () => {
      const mockEvents = [
        { event_type: 'user_message_sent', sequence_number: 0, event_data: {} },
        { event_type: 'agent_message_sent', sequence_number: 1, event_data: {} },
        { event_type: 'tool_use_requested', sequence_number: 2, event_data: {} },
      ];

      // Mock replayEvents to call handler for each event
      mockEventStoreMethods.replayEvents.mockImplementationOnce(
        async (
          sessionId: string,
          handler: (event: { event_type: string; sequence_number: number }) => Promise<void>
        ) => {
          for (const event of mockEvents) {
            await handler(event);
          }
        }
      );

      await messageService.replayMessages(testSessionId);

      // Verify replayEvents called with correct sessionId
      expect(mockEventStoreMethods.replayEvents).toHaveBeenCalledWith(
        testSessionId,
        expect.any(Function)
      );

      // Verify completion logged
      expect(mockLogger.info).toHaveBeenCalledWith('Message replay completed', {
        sessionId: testSessionId,
      });
    });

    it('should log each event during replay', async () => {
      const mockEvent = { event_type: 'user_message_sent', sequence_number: 0, event_data: {} };

      mockEventStoreMethods.replayEvents.mockImplementationOnce(
        async (
          sessionId: string,
          handler: (event: { event_type: string; sequence_number: number }) => Promise<void>
        ) => {
          await handler(mockEvent);
        }
      );

      await messageService.replayMessages(testSessionId);

      // Verify each event logged during replay
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Replaying event',
        expect.objectContaining({
          eventType: 'user_message_sent',
          sequenceNumber: 0,
        })
      );
    });
  });
});
