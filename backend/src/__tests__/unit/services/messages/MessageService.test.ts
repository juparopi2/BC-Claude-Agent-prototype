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

    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

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
  });

  // ========== PHASE 1B: saveAgentMessage() and saveThinkingMessage() REMOVED ==========
  /**
   * ⭐ PHASE 1B: saveAgentMessage() and saveThinkingMessage() tests REMOVED
   *
   * These methods were deprecated and removed in Phase 1B.
   *
   * **Why removed?**
   * - DirectAgentService now handles persistence directly via EventStore + MessageQueue
   * - Eliminates redundant layer and ensures Anthropic message IDs flow correctly
   * - ChatMessageHandler no longer calls these methods (fallback logic removed)
   *
   * **Migration path:**
   * - Agent messages: Use DirectAgentService (writes to EventStore + MessageQueue)
   * - User messages: Use saveUserMessage() (tested below)
   * - Tool results: Use updateToolResult() (tested below)
   *
   * **Removed tests**: 8 tests (5 for saveAgentMessage, 3 for saveThinkingMessage)
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

      // ⭐ PHASE 1B: updateToolResult uses tool_use_id in WHERE clause
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tool_use_id = @tool_use_id'),
        expect.objectContaining({
          tool_use_id: toolUseId,
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

      // ⭐ PHASE 1B: updateToolResult uses tool_use_id in WHERE clause
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tool_use_id = @tool_use_id'),
        expect.objectContaining({
          tool_use_id: toolUseId,
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

    /**
     * ⭐ PHASE 1B: updateToolResult() NO LONGER appends event
     *
     * The appendEvent() call was removed because DirectAgentService already persists
     * the tool_result event. Calling appendEvent() here would create duplicate sequence numbers.
     *
     * Test removed: "should append event on tool completion"
     * Removed: 2025-11-24
     */

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

  // ========== SUITE 7: REPLAY MESSAGES (2 TESTS - SKIPPED) ==========
  /**
   * SKIPPED: replayMessages() deliberadamente NO implementado.
   *
   * ══════════════════════════════════════════════════════════════════════════════
   * CONTEXTO TÉCNICO
   * ══════════════════════════════════════════════════════════════════════════════
   *
   * La arquitectura actual usa un flujo de 2 pasos para persistencia de mensajes:
   *
   *   1. EventStore.appendEvent() → Log inmutable de eventos con sequence_number
   *      atómico (Redis INCR). Operación síncrona (~10ms).
   *
   *   2. MessageQueue.addMessagePersistence() → Materializa mensajes en tabla SQL
   *      `messages`. Operación async via BullMQ para eliminar 600ms de latencia.
   *
   * replayMessages() sería para reconstruir la tabla `messages` desde `message_events`.
   * Esto NO es necesario en operación normal porque:
   *
   *   - getMessagesBySession() lee directamente de tabla `messages`
   *   - El streaming WebSocket funciona con eventos en tiempo real
   *   - El frontend carga historial de sesiones desde tabla `messages`
   *   - La consistencia eventual (EventStore → MessageQueue → SQL) es suficiente
   *
   * Ver implementación en MessageService.ts:582-593 que lanza:
   *   "Message replay is not implemented. Messages are materialized via
   *    MessageQueue.processMessagePersistence()..."
   *
   * ══════════════════════════════════════════════════════════════════════════════
   * IMPLICACIONES DE NEGOCIO
   * ══════════════════════════════════════════════════════════════════════════════
   *
   * ✅ NO AFECTA (operación normal):
   *   - Chat en tiempo real: Usuario envía mensaje → respuesta Claude funciona
   *   - Persistencia de mensajes: EventStore + MessageQueue guardan correctamente
   *   - WebSocket streaming: Eventos se transmiten al frontend sin problemas
   *   - Historial de sesiones: Frontend carga historial desde tabla `messages`
   *   - Multi-tenant: Aislamiento userId + sessionId funciona correctamente
   *   - Rate limiting: 100 jobs/session/hour funciona vía Redis counters
   *   - Token tracking: inputTokens/outputTokens se persisten correctamente
   *
   * ⚠️  SÍ AFECTARÍA (escenarios edge):
   *   - DISASTER RECOVERY: Si tabla `messages` se corrompe/pierde, no hay
   *     mecanismo automático para reconstruirla desde `message_events`
   *   - DEBUGGING AVANZADO: No se puede reproducir secuencia exacta de eventos
   *     para diagnosticar problemas de consistencia
   *   - MIGRACIÓN DE ESQUEMA: Si cambia estructura de `messages`, no hay
   *     replay para repoblar con nuevo formato
   *   - AUDITORÍA: No hay forma de verificar que `messages` coincide con
   *     `message_events` (aunque ambas tablas existen)
   *
   * ══════════════════════════════════════════════════════════════════════════════
   * DECISIÓN
   * ══════════════════════════════════════════════════════════════════════════════
   *
   * Feature de baja prioridad. El 99.9% de casos de uso funcionan sin replay.
   * Se mantiene el stub para futura implementación si surge necesidad real.
   *
   * Fecha: 2025-11-27
   * Referencia: TASK-004 diagnostic plan (delightful-hatching-shore.md)
   */
  describe.skip('replayMessages()', () => {
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
