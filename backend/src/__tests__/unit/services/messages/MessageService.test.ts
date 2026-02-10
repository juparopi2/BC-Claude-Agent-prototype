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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageService, getMessageService } from '../../../../services/messages/MessageService';
import { getEventStore } from '../../../../services/events/EventStore';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { createChildLogger } from '@/shared/utils/logger';
import { MessageDbRecord } from '../../../../types/message.types';
import { randomUUID } from 'crypto';

// ===== MOCK EVENT STORE (vi.hoisted pattern) =====
const mockEventStoreMethods = vi.hoisted(() => ({
  appendEvent: vi.fn().mockResolvedValue({ id: 'evt-123', sequence_number: 1 }),
  replayEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => mockEventStoreMethods),
}));

// ===== MOCK MESSAGE QUEUE (vi.hoisted pattern) =====
const mockMessageQueueMethods = vi.hoisted(() => ({
  addMessagePersistence: vi.fn().mockResolvedValue({ id: 'job-123' }),
}));

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => mockMessageQueueMethods),
}));

// ===== MOCK PRISMA CLIENT (vi.hoisted pattern) =====
const mockPrismaMessages = vi.hoisted(() => ({
  upsert: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  findMany: vi.fn().mockResolvedValue([]),
  findUnique: vi.fn().mockResolvedValue(null),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  count: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    messages: mockPrismaMessages,
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
    mockEventStoreMethods.appendEvent.mockResolvedValue({ id: 'evt-123', sequence_number: 1 });
    mockEventStoreMethods.replayEvents.mockResolvedValue(undefined);

    mockMessageQueueMethods.addMessagePersistence.mockResolvedValue({ id: 'job-123' });

    mockPrismaMessages.upsert.mockResolvedValue({});
    mockPrismaMessages.updateMany.mockResolvedValue({ count: 1 });
    mockPrismaMessages.findMany.mockResolvedValue([]);
    mockPrismaMessages.findUnique.mockResolvedValue(null);
    mockPrismaMessages.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaMessages.count.mockResolvedValue(0);

    // Reset singleton instance
    (MessageService as any).instance = null;
    messageService = getMessageService();
  });

  // ========== SUITE 1: SAVE USER MESSAGE (5 TESTS) ==========
  describe('saveUserMessage()', () => {
    it('should generate UUID messageId and return event data', async () => {
      const result = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        'Hello, world!'
      );

      // Verify result structure
      expect(result).toHaveProperty('messageId');
      expect(result).toHaveProperty('sequenceNumber');
      expect(result).toHaveProperty('eventId');

      // Verify UUID format (mock-uuid-N)
      expect(result.messageId).toMatch(/^mock-uuid-\d+$/);
      expect(result.sequenceNumber).toBe(1);
      expect(result.eventId).toBe('evt-123');
    });

    it('should append event to EventStore', async () => {
      const testContent = 'Hello, world!';
      const result = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        testContent
      );

      expect(mockEventStoreMethods.appendEvent).toHaveBeenCalledWith(
        testSessionId,
        'user_message_sent',
        expect.objectContaining({
          message_id: result.messageId,
          content: testContent,
          user_id: testUserId,
        })
      );
    });

    it('should queue message for persistence', async () => {
      const testContent = 'Hello, world!';
      const result = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        testContent
      );

      expect(mockMessageQueueMethods.addMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: result.messageId,
          role: 'user',
          messageType: 'text',
          content: testContent,
          metadata: expect.objectContaining({ user_id: testUserId }),
          sequenceNumber: 1,
          eventId: 'evt-123',
        })
      );
    });

    it('should log success message', async () => {
      const result = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        'Hello, world!'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ User message saved',
        expect.objectContaining({ sessionId: testSessionId, messageId: result.messageId, userId: testUserId })
      );
    });

    it('should throw error on EventStore failure', async () => {
      const testError = new Error('EventStore error');
      mockEventStoreMethods.appendEvent.mockRejectedValueOnce(testError);

      await expect(
        messageService.saveUserMessage(testSessionId, testUserId, 'Hello, world!')
      ).rejects.toThrow('EventStore error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '❌ Failed to save user message',
        expect.objectContaining({
          error: testError,
          sessionId: testSessionId,
          userId: testUserId,
        })
      );
    });

    it('should fallback to Prisma upsert when queue fails', async () => {
      mockMessageQueueMethods.addMessagePersistence.mockRejectedValueOnce(
        new Error('Queue unavailable')
      );

      const result = await messageService.saveUserMessage(
        testSessionId,
        testUserId,
        'Hello via fallback'
      );

      // Verify Prisma upsert was called as fallback
      expect(mockPrismaMessages.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: result.messageId },
          create: expect.objectContaining({
            id: result.messageId,
            session_id: testSessionId,
            role: 'user',
            message_type: 'text',
            content: 'Hello via fallback',
            sequence_number: 1,
            event_id: 'evt-123',
          }),
          update: {},
        })
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '⚠️  Message persisted via fallback (direct DB write)',
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: result.messageId,
        })
      );
    });
  });

  // ========== PHASE 1B: saveAgentMessage() and saveThinkingMessage() REMOVED ==========
  /**
   * ⭐ PHASE 1B: saveAgentMessage() and saveThinkingMessage() tests REMOVED
   *
   * These methods were deprecated and removed in Phase 1B.
   *
   * **Removed**: 2025-11-24
   */

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

    it('should update tool result with success status via Prisma updateMany', async () => {
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

      expect(mockPrismaMessages.updateMany).toHaveBeenCalledWith({
        where: {
          tool_use_id: toolUseId,
          session_id: testSessionId,
        },
        data: {
          metadata: expect.any(String),
        },
      });

      // Verify metadata contents
      const callArgs = mockPrismaMessages.updateMany.mock.calls[0]![0] as {
        data: { metadata: string };
      };
      const metadata = JSON.parse(callArgs.data.metadata);
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

      expect(mockPrismaMessages.updateMany).toHaveBeenCalledWith({
        where: {
          tool_use_id: toolUseId,
          session_id: testSessionId,
        },
        data: {
          metadata: expect.any(String),
        },
      });

      // Verify error metadata
      const callArgs = mockPrismaMessages.updateMany.mock.calls[0]![0] as {
        data: { metadata: string };
      };
      const metadata = JSON.parse(callArgs.data.metadata);
      expect(metadata).toMatchObject({
        status: 'error',
        success: false,
        error_message: errorMsg,
      });
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

      const callArgs = mockPrismaMessages.updateMany.mock.calls[0]![0] as {
        data: { metadata: string };
      };
      const metadata = JSON.parse(callArgs.data.metadata);

      expect(metadata.tool_args).toEqual({
        entity: 'customer',
        filter: 'active',
      });
    });
  });

  // ========== SUITE 5: QUERY METHODS (5 TESTS) ==========
  describe('Query Methods', () => {
    it('should get messages by session with pagination', async () => {
      const mockRows = [
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
          token_count: null,
          stop_reason: null,
          tool_use_id: null,
          model: null,
          input_tokens: null,
          output_tokens: null,
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
          token_count: null,
          stop_reason: null,
          tool_use_id: null,
          model: null,
          input_tokens: null,
          output_tokens: null,
        },
      ];

      mockPrismaMessages.findMany.mockResolvedValueOnce(mockRows);

      const messages = await messageService.getMessagesBySession(testSessionId, 10, 0);

      expect(messages).toHaveLength(2);
      expect(messages[0]!.id).toBe('msg-1');
      expect(messages[1]!.id).toBe('msg-2');

      expect(mockPrismaMessages.findMany).toHaveBeenCalledWith({
        where: { session_id: testSessionId },
        orderBy: [
          { sequence_number: 'asc' },
          { created_at: 'asc' },
        ],
        skip: 0,
        take: 10,
      });
    });

    it('should get message by ID', async () => {
      const mockRow = {
        id: 'msg-123',
        session_id: testSessionId,
        role: 'user',
        message_type: 'text',
        content: 'Hello',
        metadata: '{}',
        created_at: new Date(),
        sequence_number: 1,
        event_id: 'evt-1',
        token_count: null,
        stop_reason: null,
        tool_use_id: null,
        model: null,
        input_tokens: null,
        output_tokens: null,
      };

      mockPrismaMessages.findUnique.mockResolvedValueOnce(mockRow);

      const message = await messageService.getMessageById('msg-123');

      expect(message).toBeDefined();
      expect(message?.id).toBe('msg-123');
      expect(message?.content).toBe('Hello');

      expect(mockPrismaMessages.findUnique).toHaveBeenCalledWith({
        where: { id: 'msg-123' },
      });
    });

    it('should return null when message not found', async () => {
      mockPrismaMessages.findUnique.mockResolvedValueOnce(null);

      const message = await messageService.getMessageById('nonexistent');

      expect(message).toBeNull();
    });

    it('should get message count for session', async () => {
      mockPrismaMessages.count.mockResolvedValueOnce(42);

      const count = await messageService.getMessageCount(testSessionId);

      expect(count).toBe(42);

      expect(mockPrismaMessages.count).toHaveBeenCalledWith({
        where: { session_id: testSessionId },
      });
    });

    it('should check if first user message', async () => {
      mockPrismaMessages.count.mockResolvedValueOnce(1);

      const isFirst = await messageService.isFirstUserMessage(testSessionId);

      expect(isFirst).toBe(true);

      expect(mockPrismaMessages.count).toHaveBeenCalledWith({
        where: { session_id: testSessionId, role: 'user' },
      });

      // Test with multiple user messages
      mockPrismaMessages.count.mockResolvedValueOnce(3);
      const isNotFirst = await messageService.isFirstUserMessage(testSessionId);
      expect(isNotFirst).toBe(false);
    });
  });

  // ========== SUITE 6: DELETE MESSAGES (3 TESTS) ==========
  describe('deleteMessagesBySession()', () => {
    it('should delete all messages for session', async () => {
      mockPrismaMessages.deleteMany.mockResolvedValueOnce({ count: 5 });

      const count = await messageService.deleteMessagesBySession(testSessionId);

      expect(count).toBe(5);

      expect(mockPrismaMessages.deleteMany).toHaveBeenCalledWith({
        where: { session_id: testSessionId },
      });
    });

    it('should log delete count', async () => {
      mockPrismaMessages.deleteMany.mockResolvedValueOnce({ count: 3 });

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
      mockPrismaMessages.deleteMany.mockResolvedValueOnce({ count: 0 });

      const count = await messageService.deleteMessagesBySession(testSessionId);

      expect(count).toBe(0);
    });
  });

  // ========== SUITE 7: REPLAY MESSAGES ==========
  describe('replayMessages()', () => {
    it('should throw "Not implemented" error', async () => {
      await expect(messageService.replayMessages('session-123')).rejects.toThrow(
        'Message replay is not implemented'
      );
    });
  });

});
