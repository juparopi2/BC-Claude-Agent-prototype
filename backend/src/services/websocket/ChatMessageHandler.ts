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
  MessageChunkEvent,
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
import { createChildLogger } from '@/utils/logger';
import { validateSessionOwnership } from '@/utils/session-ownership';
import { normalizeUUID } from '@/utils/uuid';
import type { Logger } from 'pino';

/**
 * Authenticated Socket with userId from session middleware
 */
interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

/**
 * Chat Message Handler Class
 *
 * Handles incoming chat messages with full type safety and audit trail.
 * Implements enhanced contract for agent events.
 */
export class ChatMessageHandler {
  private messageService = getMessageService();
  private logger: Logger;

  constructor() {
    this.logger = createChildLogger({ service: 'ChatMessageHandler' });
    this.logger.info('ChatMessageHandler singleton instance created');
  }

  /**
   * Handle Incoming Chat Message
   *
   * Multi-tenant: Validates that the authenticated socket user owns the session
   * before processing. This prevents cross-tenant data access.
   *
   * Security: Uses authSocket.userId (from session middleware) instead of
   * data.userId (from client payload) to prevent impersonation attacks.
   *
   * @param data - Chat message data with userId + sessionId
   * @param socket - Socket.io socket instance (must be authenticated)
   * @param io - Socket.io server instance
   */
  public async handle(
    data: ChatMessageData,
    socket: Socket,
    io: Server
  ): Promise<void> {
    const { message, sessionId, userId: clientUserId } = data;

    // Security: Get userId from authenticated socket, NOT from client payload
    const authSocket = socket as AuthenticatedSocket;
    const authenticatedUserId = authSocket.userId;

    // Critical security check: Authenticated user must match client-provided userId
    if (!authenticatedUserId) {
      this.logger.warn('Socket not authenticated - rejecting message', { sessionId });
      socket.emit('agent:error', {
        error: 'Socket not authenticated. Please reconnect.',
        sessionId,
      });
      return;
    }

    // Security: If client sends userId, it MUST match authenticated userId
    // This prevents impersonation attacks
    // Note: Uses normalizeUUID() for case-insensitive comparison (SQL Server UPPERCASE vs JavaScript lowercase)
    if (clientUserId && normalizeUUID(clientUserId) !== normalizeUUID(authenticatedUserId)) {
      this.logger.warn('User ID mismatch - possible impersonation attempt', {
        sessionId,
        clientUserId,
        authenticatedUserId,
        socketId: socket.id,
      });
      socket.emit('agent:error', {
        error: 'User authentication mismatch. Access denied.',
        sessionId,
      });
      return;
    }

    // Use authenticated userId for all operations
    const userId = authenticatedUserId;

    this.logger.info({
      sessionId,
      userId,
      messageLength: message?.length || 0,
      messagePreview: message?.substring(0, 100) || 'EMPTY',
      hasMessage: !!message,
    }, 'Chat message received');

    // Validate message is not empty
    if (!message || message.trim().length === 0) {
      this.logger.warn('Empty message received, rejecting', { sessionId, userId });
      socket.emit('agent:error', {
        error: 'Empty message not allowed',
        sessionId,
      });
      return;
    }

    try {
      // 1. Validate session ownership (multi-tenant safety)
      // This queries the database to ensure the authenticated user owns this session
      await this.validateSessionOwnershipInternal(sessionId, userId);

      // 2. Save user message with userId for audit trail
      this.logger.info('💾 Saving user message to database...', { sessionId, userId });
      const startSaveTime = Date.now();

      let messageConfirmation: { messageId: string; sequenceNumber: number; eventId: string } | null = null;

      try {
        messageConfirmation = await this.messageService.saveUserMessage(sessionId, userId, message);
        const saveDuration = Date.now() - startSaveTime;
        this.logger.info('✅ User message saved successfully', {
          sessionId,
          userId,
          saveDuration,
          messageId: messageConfirmation.messageId,
          sequenceNumber: messageConfirmation.sequenceNumber,
          eventId: messageConfirmation.eventId,
        });

        // ⭐ Emit user_message_confirmed event to frontend
        io.to(sessionId).emit('agent:event', {
          type: 'user_message_confirmed',
          sessionId,
          messageId: messageConfirmation.messageId,
          userId,
          content: message,
          sequenceNumber: messageConfirmation.sequenceNumber,
          eventId: messageConfirmation.eventId,
          timestamp: new Date().toISOString(),
          // Enhanced contract fields (required by BaseAgentEvent)
          persistenceState: 'persisted' as const,
        });

        this.logger.info('✅ User message confirmation emitted to frontend', {
          sessionId,
          messageId: messageConfirmation.messageId,
          sequenceNumber: messageConfirmation.sequenceNumber,
        });
      } catch (saveError) {
        this.logger.error('❌ Failed to save user message', { error: saveError, sessionId, userId });

        // ⭐ Emit specific error to frontend (error must be string per type definition)
        socket.emit('agent:event', {
          type: 'error',
          error: 'Failed to save your message. Please try again.',
          code: 'MESSAGE_SAVE_FAILED',
          sessionId,
        });

        // Don't proceed with agent execution if message save failed
        return;
      }

      // 3. Execute agent with DirectAgentService (SDK-first)
      this.logger.info('🤖 About to call DirectAgentService.runGraph', { sessionId, userId });

      const agentService = getDirectAgentService();
      this.logger.info('✅ DirectAgentService instance obtained', {
        hasAgentService: !!agentService,
        agentServiceType: agentService?.constructor?.name,
        hasExecuteMethod: typeof agentService?.runGraph === 'function'
      });

      // ⭐ Phase 1F: Extract and validate Extended Thinking config from request
      const thinkingConfig = data.thinking;

      // Validate thinkingBudget if provided (Anthropic requires 1024 <= budget <= 100000)
      if (thinkingConfig?.enableThinking && thinkingConfig.thinkingBudget !== undefined) {
        const MIN_THINKING_BUDGET = 1024;
        const MAX_THINKING_BUDGET = 100000;

        if (thinkingConfig.thinkingBudget < MIN_THINKING_BUDGET || thinkingConfig.thinkingBudget > MAX_THINKING_BUDGET) {
          this.logger.warn('Invalid thinkingBudget, rejecting request', {
            sessionId,
            userId,
            thinkingBudget: thinkingConfig.thinkingBudget,
            minAllowed: MIN_THINKING_BUDGET,
            maxAllowed: MAX_THINKING_BUDGET,
          });
          socket.emit('agent:error', {
            error: `Invalid thinkingBudget: must be between ${MIN_THINKING_BUDGET} and ${MAX_THINKING_BUDGET}`,
            sessionId,
          });
          return;
        }
      }

      this.logger.info('📞 Calling runGraph...', {
        sessionId,
        userId,
        messageLength: message.length,
        // Log thinking config if provided
        enableThinking: thinkingConfig?.enableThinking,
        thinkingBudget: thinkingConfig?.thinkingBudget,
      });

      // Build options object with thinking, attachments, and enableAutoSemanticSearch
      const streamingOptions = {
        ...(thinkingConfig ? {
          enableThinking: thinkingConfig.enableThinking,
          thinkingBudget: thinkingConfig.thinkingBudget,
        } : {}),
        attachments: data.attachments,
        enableAutoSemanticSearch: data.enableAutoSemanticSearch,
      };

      await agentService.runGraph(
        message,
        sessionId,
        (event: AgentEvent) => this.handleAgentEvent(event, io, sessionId, userId),
        userId, // ⭐ Pass userId for tool persistence
        // ⭐ Pass options (thinking + attachments)
        streamingOptions
      );

      this.logger.info('✅ Chat message processed successfully (runGraph completed)', { sessionId, userId });
    } catch (error) {
      // Type for Node.js system errors with additional properties
      type NodeSystemError = Error & { code?: string; errno?: number; syscall?: string };
      const systemError = error as NodeSystemError;

      this.logger.error('❌ Chat message handler error (DETAILED)', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorCode: systemError?.code,
        errorErrno: systemError?.errno,
        errorSyscall: systemError?.syscall,
        stack: error instanceof Error ? error.stack : undefined,
        sessionId,
        userId,
      });

      // ⭐ Emit error to frontend (error must be string per type definition)
      // NOTE: Removed duplicate agent:error emission - using single agent:event format
      socket.emit('agent:event', {
        type: 'error',
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
        code: systemError?.code || 'HANDLER_ERROR',
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
      // Diagnostic logging for thinking event
      if (event.type === 'thinking') {
        this.logger.debug({
          sessionId,
          eventType: event.type,
          sequenceNumber: event.sequenceNumber,
          eventId: event.eventId,
        }, 'Relaying thinking event to Socket.IO');
      }

      // Emit to frontend (single event type with enhanced contract)
      io.to(sessionId).emit('agent:event', event);

      // DEBUG: Trace all events emitted to socket
      this.logger.debug({
        eventType: event.type,
        sessionId,
        sequenceNumber: (event as { sequenceNumber?: number }).sequenceNumber,
      }, 'Socket emit');

      if (event.type === 'tool_use') {
        this.logger.debug({ event }, 'Tool use detected');
      }

      // Confirm emission for thinking event
      if (event.type === 'thinking') {
        this.logger.debug({ sessionId }, 'Thinking event emitted to Socket.IO room');
      }

      // DEBUG: Log message_chunk events to verify structure
      if (event.type === 'message_chunk') {
        this.logger.debug({ event }, 'Message chunk emitted');
      }

      // Persist to database based on event type (type-safe discrimination)
      switch (event.type) {
        case 'session_start':
          // Session start - no persistence needed
          this.logger.debug('Session started', { sessionId, userId });
          break;

        case 'thinking':
          // ⭐ FIXED: Thinking events from streams are TRANSIENT.
          // They are chunks of thought, not the final thought block.
          // DirectAgentService may persist a final "thought" block, but the stream is transient.
          if ((event as ThinkingEvent).persistenceState === 'transient') {
             this.logger.debug('🧠 Thinking event received (transient)', {
                sequenceNumber: (event as ThinkingEvent).sequenceNumber,
                eventId: (event as ThinkingEvent).eventId,
                contentPreview: (event as ThinkingEvent).content?.substring(0, 50)
             });
          } else if ((event as ThinkingEvent).persistenceState !== 'persisted') {
             // If it claims to be something else but isn't persisted, warn but don't crash
             this.logger.warn('⚠️ Thinking event has unexpected state', {
                state: (event as ThinkingEvent).persistenceState,
                sequenceNumber: (event as ThinkingEvent).sequenceNumber
             });
          }
          break;

        case 'message_partial':
          // No persistence needed - partials are transient
          break;

        case 'message_chunk':
          // ✅ Verificar que esté marcado como transient
          if ((event as MessageChunkEvent).persistenceState !== 'transient') {
            this.logger.warn('⚠️  Message chunk NOT marked as transient', {
              sequenceNumber: (event as MessageChunkEvent).sequenceNumber,
            });
          }
          this.logger.debug('📡 Message chunk received (transient, not persisted)', {
            content: (event as MessageChunkEvent).content?.substring(0, 20),
          });
          break;

        case 'message':
          // ✅ PHASE 1B: Persistence handled by DirectAgentService
          // DirectAgentService writes directly to EventStore + MessageQueue
          // No fallback needed - if persistenceState is not 'persisted', it's a critical bug
          if ((event as MessageEvent).persistenceState !== 'persisted') {
            this.logger.error('❌ CRITICAL: Complete message NOT marked as persisted by DirectAgentService', {
              messageId: (event as MessageEvent).messageId,
              sequenceNumber: (event as MessageEvent).sequenceNumber,
              errorContext: 'DirectAgentService must persist before emitting'
            });
            // We log error but don't throw to avoid crashing the socket connection for the user
          } else {
             this.logger.info('✅ Complete message confirmed persisted', {
                messageId: (event as MessageEvent).messageId,
                sequenceNumber: (event as MessageEvent).sequenceNumber,
             });
          }
          break;

        case 'tool_use':
          // ✅ SKIP persistence - event already persisted by DirectAgentService
          if ((event as ToolUseEvent).persistenceState === 'persisted') {
            this.logger.debug('✅ Tool use event already persisted by DirectAgentService', {
              toolUseId: (event as ToolUseEvent).toolUseId,
              sequenceNumber: (event as ToolUseEvent).sequenceNumber,
              eventId: (event as ToolUseEvent).eventId,
            });
          } else {
            this.logger.error('❌ Tool use event NOT persisted by DirectAgentService', {
              toolUseId: (event as ToolUseEvent).toolUseId,
            });
            // ⚠️ FALLBACK: Persistir aquí si no está
            await this.handleToolUse(event as ToolUseEvent, sessionId, userId);
          }
          break;

        case 'tool_result':
          // ✅ SKIP persistence - event already persisted by DirectAgentService
          if ((event as ToolResultEvent).persistenceState === 'persisted') {
            this.logger.debug('✅ Tool result event already persisted by DirectAgentService', {
              toolUseId: (event as ToolResultEvent).toolUseId,
              sequenceNumber: (event as ToolResultEvent).sequenceNumber,
              eventId: (event as ToolResultEvent).eventId,
            });
          } else {
            this.logger.error('❌ Tool result event NOT persisted by DirectAgentService', {
              toolUseId: (event as ToolResultEvent).toolUseId,
            });
            // ⚠️ FALLBACK: Persistir aquí si no está
            await this.handleToolResult(event as ToolResultEvent, sessionId, userId);
          }
          break;

        case 'session_end':
          // Session end - no persistence needed
          this.logger.debug('Session ended', { sessionId, userId, reason: (event as SessionEndEvent).reason });
          break;

        case 'complete':
          await this.handleComplete(event as CompleteEvent, sessionId, userId);
          break;

        case 'approval_requested':
          // Approval requested - handled by DirectAgentService
          this.logger.debug('Approval requested', { sessionId, userId });
          break;

        case 'approval_resolved':
          // Approval resolved - handled by DirectAgentService
          this.logger.debug('Approval resolved', { sessionId, userId });
          break;

        case 'error':
          await this.handleError(event as ErrorEvent, sessionId, userId);
          break;

        case 'user_message_confirmed':
          // User message confirmed - already emitted to frontend, no additional persistence needed
          this.logger.debug('User message confirmed event', { sessionId, userId });
          break;

        case 'thinking_chunk':
          // ⭐ Phase 1F: Extended Thinking chunks are transient (streamed, not persisted)
          // Just log for debugging, no persistence needed
          this.logger.debug('Thinking chunk event (transient)', {
            sessionId,
            userId,
            contentLength: (event as { content?: string }).content?.length,
          });
          break;

        case 'turn_paused':
          // ⭐ SDK 0.71: Long agentic turn was paused
          // Already persisted by DirectAgentService, just log
          this.logger.info('Turn paused event', {
            sessionId,
            userId,
            messageId: (event as { messageId?: string }).messageId,
            reason: (event as { reason?: string }).reason,
          });
          break;

        case 'content_refused':
          // ⭐ SDK 0.71: Content refused due to policy violation
          // Already persisted by DirectAgentService, just log
          this.logger.warn('Content refused event', {
            sessionId,
            userId,
            messageId: (event as { messageId?: string }).messageId,
            reason: (event as { reason?: string }).reason,
          });
          break;

        default:
          // Exhaustiveness check - TypeScript will error if we miss a case
          // const _exhaustiveCheck: never = event; // Commented out to avoid build errors if new types added
          this.logger.warn('Unknown event type', { type: event.type, sessionId });
      }
    } catch (error) {
      this.logger.error('Error handling agent event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
        sessionId,
        userId,
      });
    }
  }

  // ⭐ PHASE 1B: handleMessage() and handleThinking() REMOVED
  // These methods were fallback duplicates - DirectAgentService now handles ALL persistence
  // directly via EventStore + MessageQueue before emitting events.
  // If persistenceState !== 'persisted', it's a critical bug (not a fallback scenario).

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
      this.logger.warn('Tool use event missing toolUseId', { sessionId, toolName: event.toolName });
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
      this.logger.debug('TodoWrite tool detected', {
        sessionId,
        userId,
        todoCount: Array.isArray(event.args.todos) ? event.args.todos.length : 0,
      });
    }

    this.logger.debug('Tool use saved', {
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
      this.logger.warn('Tool result event missing toolUseId', { sessionId, toolName: event.toolName });
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

    this.logger.debug('Tool result saved', {
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
    this.logger.info('Agent execution complete', {
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
    this.logger.error('Agent error event received', {
      sessionId,
      userId,
      error: event.error,
    });
  }

  /**
   * Validate Session Ownership
   *
   * Ensures userId owns the sessionId (multi-tenant safety).
   * Queries the database to verify ownership before allowing operations.
   *
   * @param sessionId - Session ID to validate
   * @param userId - User ID claiming ownership
   * @throws Error if validation fails or user doesn't own the session
   */
  private async validateSessionOwnershipInternal(
    sessionId: string,
    userId: string
  ): Promise<void> {
    this.logger.debug('Validating session ownership', { sessionId, userId });

    const result = await validateSessionOwnership(sessionId, userId);

    if (!result.isOwner) {
      if (result.error === 'SESSION_NOT_FOUND') {
        this.logger.warn('Session not found during ownership validation', {
          sessionId,
          userId,
        });
        throw new Error(`Session ${sessionId} not found`);
      }

      if (result.error === 'NOT_OWNER') {
        this.logger.warn('Session ownership validation failed - unauthorized access attempt', {
          sessionId,
          requestingUserId: userId,
          // Don't log actual owner for security
        });
        throw new Error('Unauthorized: Session does not belong to user');
      }

      // Database error or invalid input
      this.logger.error('Session ownership validation failed', {
        sessionId,
        userId,
        error: result.error,
      });
      throw new Error('Failed to validate session ownership');
    }

    this.logger.debug('Session ownership validated successfully', { sessionId, userId });
  }
}

/**
 * Singleton instance of ChatMessageHandler
 */
let chatMessageHandlerInstance: ChatMessageHandler | null = null;

/**
 * Get Chat Message Handler Singleton
 *
 * Returns the singleton instance of ChatMessageHandler.
 * Use this in server.ts to handle chat messages.
 *
 * @returns ChatMessageHandler instance
 */
export function getChatMessageHandler(): ChatMessageHandler {
  if (!chatMessageHandlerInstance) {
    chatMessageHandlerInstance = new ChatMessageHandler();
  }
  return chatMessageHandlerInstance;
}
