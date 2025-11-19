/**
 * Chat Message Handler
 *
 * Handles WebSocket chat:message events with:
 * - Event Sourcing for guaranteed message ordering
 * - Message Queue for async persistence
 * - ToolUseTracker for SDK ID → DB GUID mapping
 * - SessionTitleGenerator for automatic titles
 *
 * @module services/websocket/ChatMessageHandler
 */

import type { Socket, Server } from 'socket.io';
import { logger } from '@/utils/logger';
import { getDirectAgentService } from '@/services/agent/DirectAgentService';
import { getToolUseTracker } from '@/services/cache/ToolUseTracker';
import { getMessageService } from '@/services/messages/MessageService';
import { getSessionTitleGenerator } from '@/services/sessions/SessionTitleGenerator';
import { getTodoManager } from '@/services/todos/TodoManager';
import type { AgentEvent } from '@/types';
import { validateSafe, chatMessageSchema } from '@/schemas/request.schemas';

/**
 * Chat Message Input
 */
interface ChatMessageInput {
  message: string;
  sessionId: string;
  userId: string;
}

/**
 * Chat Message Handler Class
 *
 * Orchestrates chat message flow with Event Sourcing + Message Queue + ToolUseTracker.
 */
export class ChatMessageHandler {
  private toolUseTracker = getToolUseTracker();
  private messageService = getMessageService();
  private titleGenerator = getSessionTitleGenerator();

  /**
   * Handle chat:message WebSocket event
   *
   * Main entry point for processing chat messages.
   * Uses Event Sourcing + Message Queue for scalable persistence.
   *
   * @param socket - Socket.IO client socket
   * @param io - Socket.IO server instance
   * @param data - Chat message input
   */
  async handle(socket: Socket, io: Server, data: unknown): Promise<void> {
    try {
      // 1. Validate input
      const validation = this.validateInput(data);
      if (!validation.success) {
        socket.emit('agent:error', {
          error: `Invalid input: ${validation.error.errors.map(e => e.message).join(', ')}`,
        });
        return;
      }

      const { message, sessionId, userId } = validation.data;

      logger.info(`[ChatMessageHandler] [1/5] Received message from user ${userId} in session ${sessionId}`);

      // 2. Join session room (safety measure)
      socket.join(sessionId);

      // 3. Persist user message (via MessageService → EventStore + MessageQueue)
      try {
        const userMessageId = await this.messageService.saveUserMessage(
          sessionId,
          userId,
          message
        );
        logger.info(`[ChatMessageHandler] [2/5] User message queued for persistence (ID: ${userMessageId})`);
      } catch (error) {
        logger.error('[ChatMessageHandler] Failed to queue user message:', error);
        // Continue anyway - message is in frontend cache
      }

      // 4. Execute agent query with streaming
      logger.info(`[ChatMessageHandler] [3/5] Starting agent execution for session ${sessionId}`);
      const agentService = getDirectAgentService();

      await agentService.executeQueryStreaming(
        message,
        sessionId,
        async (event: AgentEvent) => {
          // Handle each agent event
          await this.handleAgentEvent(socket, io, sessionId, event);
        }
      );

      logger.info(`[ChatMessageHandler] [4/5] Agent execution completed for session ${sessionId}`);

      // 5. Generate session title if this is the first user message
      await this.generateTitleIfFirstMessage(sessionId, message, io);

      logger.info(`[ChatMessageHandler] [5/5] Chat message processing completed for session ${sessionId}`);
    } catch (error) {
      logger.error('[ChatMessageHandler] Chat message error:', error);
      socket.emit('agent:error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Validate Input
   *
   * Validates chat message input using Zod schema.
   *
   * @param data - Raw input data
   * @returns Validation result
   */
  private validateInput(
    data: unknown
  ):
    | { success: true; data: ChatMessageInput }
    | { success: false; error: { errors: Array<{ message: string }> } } {
    const result = validateSafe(chatMessageSchema, data);
    if (result.success) {
      return {
        success: true,
        data: result.data as ChatMessageInput,
      };
    }
    return {
      success: false,
      error: {
        errors: result.error.errors.map((err) => ({
          message: err.message,
        })),
      },
    };
  }

  /**
   * Handle Agent Event
   *
   * Processes each event from DirectAgentService streaming.
   * Persists events via MessageService (EventStore + MessageQueue).
   * Uses ToolUseTracker (Redis) for SDK toolUseId → DB GUID mapping.
   *
   * @param socket - Socket.IO client socket
   * @param io - Socket.IO server instance
   * @param sessionId - Session ID
   * @param event - Agent event
   */
  private async handleAgentEvent(
    socket: Socket,
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): Promise<void> {
    // Stream all events to session room
    io.to(sessionId).emit('agent:event', event);

    // Handle specific event types
    switch (event.type) {
      case 'thinking':
        await this.handleThinkingEvent(io, sessionId, event);
        break;

      case 'message_partial':
      case 'message_chunk':
        this.handleMessageChunkEvent(io, sessionId, event);
        break;

      case 'message':
        await this.handleMessageCompleteEvent(io, sessionId, event);
        break;

      case 'tool_use':
        await this.handleToolUseEvent(io, sessionId, event);
        break;

      case 'tool_result':
        await this.handleToolResultEvent(io, sessionId, event);
        break;

      case 'error':
        this.handleErrorEvent(io, sessionId, event);
        break;

      case 'complete':
      case 'session_end':
        this.handleCompleteEvent(io, sessionId, event);
        break;

      default:
        logger.warn(`[ChatMessageHandler] Unknown event type: ${event.type}`);
    }
  }

  /**
   * Handle Thinking Event
   */
  private async handleThinkingEvent(
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): Promise<void> {
    try {
      await this.messageService.saveThinkingMessage(
        sessionId,
        event.content || ''
      );
      logger.debug(`[ChatMessageHandler] Thinking message queued for session ${sessionId}`);
    } catch (error) {
      logger.error('[ChatMessageHandler] Failed to queue thinking message:', error);
    }

    io.to(sessionId).emit('agent:thinking', {
      content: event.content,
    });
  }

  /**
   * Handle Message Chunk Event (streaming text)
   */
  private handleMessageChunkEvent(
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): void {
    io.to(sessionId).emit('agent:message_chunk', {
      content: event.content,
    });
  }

  /**
   * Handle Message Complete Event (assistant message)
   */
  private async handleMessageCompleteEvent(
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): Promise<void> {
    logger.debug(`[ChatMessageHandler] Message complete event`, {
      contentPreview: event.content?.substring(0, 50) + '...',
      stopReason: event.stopReason,
      role: event.role,
    });

    // Persist assistant message
    let assistantMessageId: string | undefined;
    try {
      assistantMessageId = await this.messageService.saveAgentMessage(
        sessionId,
        event.content || '',
        event.stopReason || null
      );
      logger.debug(`[ChatMessageHandler] Assistant message queued (ID: ${assistantMessageId}, stop_reason: ${event.stopReason || 'null'})`);
    } catch (error) {
      logger.error('[ChatMessageHandler] Failed to queue assistant message:', error);
    }

    // Emit to frontend
    io.to(sessionId).emit('agent:message_complete', {
      id: assistantMessageId,
      content: event.content,
      role: event.role,
      stopReason: event.stopReason || null,
    });
  }

  /**
   * Handle Tool Use Event
   */
  private async handleToolUseEvent(
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): Promise<void> {
    logger.debug(`[ChatMessageHandler] Tool use event`, {
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      argsKeys: event.args ? Object.keys(event.args) : [],
    });

    // Persist tool use message
    let savedToolUseId: string;
    try {
      savedToolUseId = await this.messageService.saveToolUseMessage(
        sessionId,
        event.toolName || 'unknown_tool',
        event.args || {}
      );
    } catch (error) {
      logger.error('[ChatMessageHandler] Failed to queue tool use message:', error);
      // Fallback ID if persistence fails
      savedToolUseId = event.toolUseId || crypto.randomUUID();
    }

    // ✅ Map SDK toolUseId → DB GUID in Redis (with 5-minute TTL)
    if (event.toolUseId) {
      try {
        await this.toolUseTracker.mapToolUseId(
          sessionId,
          event.toolUseId,
          event.toolName || 'unknown_tool'
        );
      } catch (error) {
        logger.error('[ChatMessageHandler] Failed to map toolUseId in Redis:', error);
      }
    }

    // Intercept TodoWrite to sync todos to database
    if (event.toolName === 'TodoWrite' && event.args?.todos) {
      const todoManager = getTodoManager();
      await todoManager.syncTodosFromSDK(
        sessionId,
        event.args.todos as Array<{
          content: string;
          status: 'pending' | 'in_progress' | 'completed';
          activeForm: string;
        }>
      );
    }

    // Emit to frontend
    io.to(sessionId).emit('agent:tool_use', {
      toolName: event.toolName,
      args: event.args,
      toolUseId: savedToolUseId, // Always use DB GUID
    });
  }

  /**
   * Handle Tool Result Event
   */
  private async handleToolResultEvent(
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): Promise<void> {
    logger.debug(`[ChatMessageHandler] Tool result event`, {
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      success: event.success,
      resultPreview:
        typeof event.result === 'string'
          ? event.result.substring(0, 50) + '...'
          : typeof event.result,
    });

    // ✅ Lookup DB GUID from Redis (SDK toolUseId → DB GUID mapping)
    let dbToolUseId: string | null = null;
    if (event.toolUseId) {
      try {
        dbToolUseId = await this.toolUseTracker.getDbGuid(sessionId, event.toolUseId);
      } catch (error) {
        logger.error('[ChatMessageHandler] Failed to lookup DB GUID from Redis:', error);
      }
    }

    // Update tool use message with result
    if (dbToolUseId) {
      try {
        await this.messageService.updateToolResult(
          sessionId,
          dbToolUseId, // Use DB GUID, not SDK ID
          event.toolName || 'unknown_tool',
          event.args || {}, // Preserve original tool arguments
          event.result,
          event.success !== false,
          event.error
        );

        // ✅ Cleanup: Remove mapping from Redis after use
        if (event.toolUseId) {
          await this.toolUseTracker.cleanupMapping(sessionId, event.toolUseId);
        }
      } catch (error) {
        logger.error('[ChatMessageHandler] Failed to update tool result:', error);
      }
    } else if (event.toolUseId) {
      logger.warn(`[ChatMessageHandler] No DB GUID found for SDK toolUseId: ${event.toolUseId}`);
    }

    // Emit to frontend
    io.to(sessionId).emit('agent:tool_result', {
      toolName: event.toolName,
      result: event.result,
      success: event.success,
      toolUseId: dbToolUseId || event.toolUseId, // Prefer DB GUID
    });
  }

  /**
   * Handle Error Event
   */
  private handleErrorEvent(
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): void {
    io.to(sessionId).emit('agent:error', {
      error: event.error,
    });
  }

  /**
   * Handle Complete Event
   */
  private handleCompleteEvent(
    io: Server,
    sessionId: string,
    event: AgentEvent
  ): void {
    logger.debug(`[ChatMessageHandler] Complete event`, {
      reason: event.reason,
    });

    io.to(sessionId).emit('agent:complete', {
      reason: event.reason,
    });
  }

  /**
   * Generate Title If First Message
   *
   * Generates a session title using SessionTitleGenerator if this is the first user message.
   *
   * @param sessionId - Session ID
   * @param message - User message
   * @param io - Socket.IO server instance
   */
  private async generateTitleIfFirstMessage(
    sessionId: string,
    message: string,
    io: Server
  ): Promise<void> {
    try {
      // Check if this is the first user message (via MessageService)
      const isFirstMessage = await this.messageService.isFirstUserMessage(sessionId);

      if (isFirstMessage) {
        // Generate and update title
        const title = await this.titleGenerator.generateAndUpdateTitle(
          sessionId,
          message
        );

        // Emit to frontend
        io.to(sessionId).emit('session:title_updated', {
          sessionId,
          title,
        });

        logger.info(`[ChatMessageHandler] Session title generated: "${title}"`);
      }
    } catch (error) {
      logger.error('[ChatMessageHandler] Failed to generate session title:', error);
      // Don't fail the entire message flow if title generation fails
    }
  }
}

// Singleton instance
let chatMessageHandlerInstance: ChatMessageHandler | null = null;

/**
 * Get ChatMessageHandler Singleton Instance
 *
 * @returns The shared ChatMessageHandler instance
 */
export function getChatMessageHandler(): ChatMessageHandler {
  if (!chatMessageHandlerInstance) {
    chatMessageHandlerInstance = new ChatMessageHandler();
  }
  return chatMessageHandlerInstance;
}
