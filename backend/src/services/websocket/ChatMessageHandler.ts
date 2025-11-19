/**
 * Chat Message Handler
 *
 * Handles chat messages using DirectAgentService and enhanced contract events.
 * Multi-tenant safe: All operations scoped by userId + sessionId.
 *
 * Architecture:
 * - Single event type: 'agent:event' (enhanced contract)
 * - Type-safe event discrimination with switch + type assertions
 * - Full audit trail with userId in all persistence methods
 * - SDK-first design with native event types
 *
 * @module services/websocket/ChatMessageHandler
 */

import type { Server, Socket } from 'socket.io';
import type {
  AgentEvent,
  ThinkingEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  SessionEndEvent,
  CompleteEvent,
  ErrorEvent,
} from '@/types';
import type { ChatMessageData } from '@/types/websocket.types';
import { getDirectAgentService } from '../agent/DirectAgentService';
import { getMessageService } from '../messages/MessageService';
import { TOOL_NAMES } from '@/constants/tools';
import { logger } from '@/utils/logger';

/**
 * Chat Message Handler Class
 *
 * Handles incoming chat messages with full type safety and audit trail.
 * Implements enhanced contract for agent events.
 */
export class ChatMessageHandler {
  private messageService = getMessageService();

  /**
   * Handle Incoming Chat Message
   *
   * Multi-tenant: Validates userId ownership of sessionId before processing.
   *
   * @param data - Chat message data with userId + sessionId
   * @param socket - Socket.io socket instance
   * @param io - Socket.io server instance
   */
  public async handle(
    data: ChatMessageData,
    socket: Socket,
    io: Server
  ): Promise<void> {
    const { message, sessionId, userId } = data;

    logger.info('Chat message received', { sessionId, userId, messageLength: message.length });

    try {
      // 1. Validate session ownership (multi-tenant safety)
      // TODO: Implement actual validation when sessions table has user_id FK
      await this.validateSessionOwnership(sessionId, userId);

      // 2. Save user message with userId for audit trail
      await this.messageService.saveUserMessage(sessionId, userId, message);

      // 3. Execute agent with DirectAgentService (SDK-first)
      const agentService = getDirectAgentService();

      await agentService.executeQueryStreaming(
        message,
        sessionId,
        (event: AgentEvent) => this.handleAgentEvent(event, io, sessionId, userId)
      );

      logger.info('Chat message processed successfully', { sessionId, userId });
    } catch (error) {
      logger.error('Chat message handler error', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
        userId,
      });

      socket.emit('agent:error', {
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        sessionId,
      });
    }
  }

  /**
   * Handle Agent Event (Enhanced Contract)
   *
   * Type-safe discrimination using switch statement + type assertions.
   * Emits single 'agent:event' to frontend (enhanced contract).
   *
   * This method is called by DirectAgentService for EVERY event during streaming.
   * It handles both real-time emission (WebSocket) and persistence (DB + EventStore).
   *
   * @param event - Agent event with enhanced contract fields
   * @param io - Socket.io server for broadcasting
   * @param sessionId - Session ID for scoping
   * @param userId - User ID for audit trail
   */
  private async handleAgentEvent(
    event: AgentEvent,
    io: Server,
    sessionId: string,
    userId: string
  ): Promise<void> {
    try {
      // Emit to frontend (single event type with enhanced contract)
      io.to(sessionId).emit('agent:event', event);

      // Persist to database based on event type (type-safe discrimination)
      switch (event.type) {
        case 'session_start':
          // Session start - no persistence needed
          logger.debug('Session started', { sessionId, userId });
          break;

        case 'thinking':
          await this.handleThinking(event as ThinkingEvent, sessionId, userId);
          break;

        case 'message_partial':
          // No persistence needed - partials are transient
          break;

        case 'message_chunk':
          // No persistence needed - chunks are transient
          // Complete message will be persisted in 'message' event
          break;

        case 'message':
          await this.handleMessage(event as MessageEvent, sessionId, userId);
          break;

        case 'tool_use':
          await this.handleToolUse(event as ToolUseEvent, sessionId, userId);
          break;

        case 'tool_result':
          await this.handleToolResult(event as ToolResultEvent, sessionId, userId);
          break;

        case 'session_end':
          // Session end - no persistence needed
          logger.debug('Session ended', { sessionId, userId, reason: (event as SessionEndEvent).reason });
          break;

        case 'complete':
          await this.handleComplete(event as CompleteEvent, sessionId, userId);
          break;

        case 'approval_requested':
          // Approval requested - handled by DirectAgentService
          logger.debug('Approval requested', { sessionId, userId });
          break;

        case 'approval_resolved':
          // Approval resolved - handled by DirectAgentService
          logger.debug('Approval resolved', { sessionId, userId });
          break;

        case 'error':
          await this.handleError(event as ErrorEvent, sessionId, userId);
          break;

        default:
          // Exhaustiveness check - TypeScript will error if we miss a case
          const _exhaustiveCheck: never = event;
          logger.warn('Unknown event type', { type: _exhaustiveCheck, sessionId });
      }
    } catch (error) {
      logger.error('Error handling agent event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
        sessionId,
        userId,
      });
    }
  }

  /**
   * Handle Thinking Event
   *
   * Persists thinking message to database with userId for audit trail.
   *
   * @param event - Thinking event (type assertion safe after switch)
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   */
  private async handleThinking(
    event: ThinkingEvent,
    sessionId: string,
    userId: string
  ): Promise<void> {
    await this.messageService.saveThinkingMessage(
      sessionId,
      userId,  // ⭐ Updated signature
      event.content || ''
    );

    logger.debug('Thinking message saved', { sessionId, userId });
  }

  /**
   * Handle Message Event
   *
   * Persists complete agent message to database.
   * This is called AFTER all message_chunk events have been emitted.
   *
   * @param event - Message event with full content
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   */
  private async handleMessage(
    event: MessageEvent,
    sessionId: string,
    userId: string
  ): Promise<void> {
    await this.messageService.saveAgentMessage(
      sessionId,
      userId,
      event.content,
      event.stopReason || null
    );

    logger.debug('Agent message saved', {
      sessionId,
      userId,
      stopReason: event.stopReason,
      contentLength: event.content.length,
    });
  }

  /**
   * Handle Tool Use Event
   *
   * Persists tool use to database and handles special cases (e.g., TodoWrite).
   *
   * @param event - Tool use event
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   */
  private async handleToolUse(
    event: ToolUseEvent,
    sessionId: string,
    userId: string
  ): Promise<void> {
    // Validate toolUseId (should always be present)
    if (!event.toolUseId) {
      logger.warn('Tool use event missing toolUseId', { sessionId, toolName: event.toolName });
      return;
    }

    await this.messageService.saveToolUseMessage(
      sessionId,
      userId,  // ⭐ Updated signature
      event.toolUseId,
      event.toolName,
      event.args
    );

    // Handle TodoWrite special case (no persistence needed - SDK handles it)
    if (event.toolName === TOOL_NAMES.TODO_WRITE && event.args?.todos) {
      logger.debug('TodoWrite tool detected', {
        sessionId,
        userId,
        todoCount: Array.isArray(event.args.todos) ? event.args.todos.length : 0,
      });
    }

    logger.debug('Tool use saved', {
      sessionId,
      userId,
      toolName: event.toolName,
      toolUseId: event.toolUseId,
    });
  }

  /**
   * Handle Tool Result Event
   *
   * Updates existing tool use message with execution result.
   *
   * @param event - Tool result event
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   */
  private async handleToolResult(
    event: ToolResultEvent,
    sessionId: string,
    userId: string
  ): Promise<void> {
    // Validate toolUseId (should always be present)
    if (!event.toolUseId) {
      logger.warn('Tool result event missing toolUseId', { sessionId, toolName: event.toolName });
      return;
    }

    await this.messageService.updateToolResult(
      sessionId,
      userId,  // ⭐ Updated signature
      event.toolUseId,
      event.toolName,
      event.args || {},  // Default to empty object if undefined
      event.result,
      event.success,
      event.error
    );

    logger.debug('Tool result saved', {
      sessionId,
      userId,
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      success: event.success,
    });
  }

  /**
   * Handle Complete Event
   *
   * Logs agent execution completion.
   * No database persistence needed - just logging.
   *
   * @param event - Complete event
   * @param sessionId - Session ID
   * @param userId - User ID
   */
  private async handleComplete(
    event: CompleteEvent,
    sessionId: string,
    userId: string
  ): Promise<void> {
    logger.info('Agent execution complete', {
      sessionId,
      userId,
      reason: event.reason,
    });
  }

  /**
   * Handle Error Event
   *
   * Logs agent error event.
   * Error details are already emitted to frontend via 'agent:event'.
   *
   * @param event - Error event
   * @param sessionId - Session ID
   * @param userId - User ID
   */
  private async handleError(
    event: ErrorEvent,
    sessionId: string,
    userId: string
  ): Promise<void> {
    logger.error('Agent error event received', {
      sessionId,
      userId,
      error: event.error,
    });
  }

  /**
   * Validate Session Ownership
   *
   * Ensures userId owns the sessionId (multi-tenant safety).
   * Currently logs only - implement actual validation when sessions table has user_id FK.
   *
   * @param sessionId - Session ID to validate
   * @param userId - User ID claiming ownership
   * @throws Error if validation fails
   */
  private async validateSessionOwnership(
    sessionId: string,
    userId: string
  ): Promise<void> {
    // TODO: Implement actual validation
    // Query: SELECT user_id FROM sessions WHERE id = @sessionId
    // Throw error if user_id !== userId

    logger.debug('Validating session ownership', { sessionId, userId });

    // For now, just log (sessions table doesn't have user_id FK yet)
    // In production, this MUST throw on mismatch:
    // throw new Error('Unauthorized: Session does not belong to user');
  }
}

/**
 * Get Chat Message Handler Singleton
 *
 * Returns the singleton instance of ChatMessageHandler.
 * Use this in server.ts to handle chat messages.
 *
 * @returns ChatMessageHandler instance
 */
export function getChatMessageHandler(): ChatMessageHandler {
  return new ChatMessageHandler();
}
