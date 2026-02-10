/**
 * @module domains/agent/persistence/PersistenceCoordinator
 *
 * Coordinates EventStore + MessageQueue for unified persistence.
 * Extracted from DirectAgentService persistence logic.
 *
 * Uses two-phase persistence:
 * 1. EventStore (sync, ~10ms) - Gets atomic sequence_number
 * 2. MessageQueue (async) - Queues DB write
 *
 * @example
 * ```typescript
 * const coordinator = getPersistenceCoordinator();
 * const result = await coordinator.persistAgentMessage(sessionId, data);
 * console.log(result.sequenceNumber); // Atomic ordering
 * ```
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getEventStore, type EventStore } from '@services/events/EventStore';
import { getMessageQueue, type MessageQueue, QueueName } from '@/infrastructure/queue/MessageQueue';
import { v4 as uuidv4 } from 'uuid';
import type {
  IPersistenceCoordinator,
  PersistedEvent,
  UserMessagePersistedEvent,
  AgentMessageData,
  ThinkingData,
  ToolUseData,
  ToolResultData,
  ErrorData,
  ToolExecution,
  IPersistenceErrorAnalyzer,
  PersistUserMessageOptions,
} from './types';
import { getPersistenceErrorAnalyzer } from './PersistenceErrorAnalyzer';
import { getMessageChatAttachmentService } from '@/services/files/MessageChatAttachmentService';

/**
 * Singleton instance
 */
let instance: PersistenceCoordinator | null = null;

/**
 * Coordinates EventStore + MessageQueue for unified persistence.
 * Implements two-phase persistence pattern:
 * 1. EventStore (sync) - Get atomic sequence_number
 * 2. MessageQueue (async) - Queue DB write
 */
export class PersistenceCoordinator implements IPersistenceCoordinator {
  private readonly logger = createChildLogger({ service: 'PersistenceCoordinator' });

  constructor(
    private eventStore: EventStore = getEventStore(),
    private messageQueue: MessageQueue = getMessageQueue(),
    private errorAnalyzer: IPersistenceErrorAnalyzer = getPersistenceErrorAnalyzer()
  ) {}

  /**
   * Persist a user message to the event store.
   * @param sessionId - Session ID
   * @param content - Message content
   * @param options - Optional settings including chat attachment IDs
   * @returns Persisted event with sequence number and messageId
   */
  async persistUserMessage(
    sessionId: string,
    content: string,
    options?: PersistUserMessageOptions
  ): Promise<UserMessagePersistedEvent> {
    try {
      const messageId = uuidv4();

      // 1. Persist to EventStore FIRST (gets sequence_number)
      const dbEvent = await this.eventStore.appendEvent(sessionId, 'user_message_sent', {
        message_id: messageId,
        content,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
        // Include attachment count in event data for auditing
        chat_attachment_count: options?.chatAttachmentIds?.length ?? 0,
      });

      // 2. CRITICAL: Validate sequenceNumber
      if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
        throw new Error(
          `Event persisted without sequence_number: ${dbEvent.sequence_number}`
        );
      }

      // 3. Queue to MessageQueue (async DB write)
      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId,
        role: 'user',
        messageType: 'text',
        content,
        metadata: {},
        sequenceNumber: dbEvent.sequence_number,
        eventId: dbEvent.id,
      });

      // 4. Persist chat attachments asynchronously (fire-and-forget)
      if (options?.chatAttachmentIds && options.chatAttachmentIds.length > 0) {
        this.persistMessageChatAttachmentsAsync(messageId, options.chatAttachmentIds);
      }

      // 5. Return UserMessagePersistedEvent (includes messageId for event emission)
      return {
        eventId: dbEvent.id,
        sequenceNumber: dbEvent.sequence_number,
        timestamp: dbEvent.timestamp.toISOString(),
        messageId,
      };
    } catch (error) {
      const causes = this.errorAnalyzer.analyze(error);
      this.logger.error(
        {
          error,
          sessionId,
          causes,
          phase: 'user_message_persistence',
        },
        'Failed to persist user message'
      );
      throw error;
    }
  }

  /**
   * Persist an agent message with full metadata.
   * @param sessionId - Session ID
   * @param data - Agent message data
   * @param preAllocatedSeq - Pre-allocated sequence number (uses appendEventWithSequence if provided)
   * @returns Persisted event with sequence number
   */
  async persistAgentMessage(
    sessionId: string,
    data: AgentMessageData,
    preAllocatedSeq?: number
  ): Promise<PersistedEvent> {
    try {
      const timestamp = new Date().toISOString();
      const payload = {
        message_id: data.messageId,
        content: data.content,
        stop_reason: data.stopReason,
        model: data.model,
        input_tokens: data.tokenUsage?.inputTokens,
        output_tokens: data.tokenUsage?.outputTokens,
        timestamp,
        persistenceState: 'persisted',
      };

      // 1. Persist to EventStore (use appendEventWithSequence if preAllocatedSeq provided)
      const dbEvent = preAllocatedSeq !== undefined
        ? await this.eventStore.appendEventWithSequence(sessionId, 'agent_message_sent', payload, preAllocatedSeq)
        : await this.eventStore.appendEvent(sessionId, 'agent_message_sent', payload);

      // 2. CRITICAL: Validate sequenceNumber
      if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
        throw new Error(
          `Event persisted without sequence_number: ${dbEvent.sequence_number}`
        );
      }

      // 3. Queue to MessageQueue
      const jobId = await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId: data.messageId,
        role: 'assistant',
        messageType: 'text',
        content: data.content,
        metadata: { stop_reason: data.stopReason },
        sequenceNumber: dbEvent.sequence_number,
        eventId: dbEvent.id,
        stopReason: data.stopReason,
        model: data.model,
        inputTokens: data.tokenUsage?.inputTokens,
        outputTokens: data.tokenUsage?.outputTokens,
        agentId: data.agentId,
      });

      // 4. Return PersistedEvent
      return {
        eventId: dbEvent.id,
        sequenceNumber: dbEvent.sequence_number,
        timestamp: dbEvent.timestamp.toISOString(),
        jobId,
      };
    } catch (error) {
      const causes = this.errorAnalyzer.analyze(error);
      this.logger.error(
        {
          error,
          sessionId,
          messageId: data.messageId,
          causes,
          phase: 'agent_message_persistence',
        },
        'Failed to persist agent message'
      );
      throw error;
    }
  }

  /**
   * Persist thinking content.
   * @param sessionId - Session ID
   * @param data - Thinking data
   * @param preAllocatedSeq - Pre-allocated sequence number (uses appendEventWithSequence if provided)
   * @returns Persisted event with sequence number
   */
  async persistThinking(
    sessionId: string,
    data: ThinkingData,
    preAllocatedSeq?: number
  ): Promise<PersistedEvent> {
    try {
      const timestamp = new Date().toISOString();
      const payload = {
        message_id: data.messageId,
        content: data.content,
        timestamp,
        persistenceState: 'persisted',
      };

      // 1. Persist to EventStore (use appendEventWithSequence if preAllocatedSeq provided)
      const dbEvent = preAllocatedSeq !== undefined
        ? await this.eventStore.appendEventWithSequence(sessionId, 'agent_thinking_block', payload, preAllocatedSeq)
        : await this.eventStore.appendEvent(sessionId, 'agent_thinking_block', payload);

      // 2. CRITICAL: Validate sequenceNumber
      if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
        throw new Error(
          `Event persisted without sequence_number: ${dbEvent.sequence_number}`
        );
      }

      // 3. Queue to MessageQueue
      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId: data.messageId,
        role: 'assistant',
        messageType: 'thinking',
        content: data.content,
        metadata: {},
        sequenceNumber: dbEvent.sequence_number,
        eventId: dbEvent.id,
        inputTokens: data.tokenUsage?.inputTokens,
        outputTokens: data.tokenUsage?.outputTokens,
        agentId: data.agentId,
      });

      // 4. Return PersistedEvent
      return {
        eventId: dbEvent.id,
        sequenceNumber: dbEvent.sequence_number,
        timestamp: dbEvent.timestamp.toISOString(),
      };
    } catch (error) {
      const causes = this.errorAnalyzer.analyze(error);
      this.logger.error(
        {
          error,
          sessionId,
          messageId: data.messageId,
          causes,
          phase: 'thinking_persistence',
        },
        'Failed to persist thinking content'
      );
      throw error;
    }
  }

  /**
   * Persist tool use request.
   * @param sessionId - Session ID
   * @param data - Tool use data
   * @returns Persisted event with sequence number
   */
  async persistToolUse(sessionId: string, data: ToolUseData): Promise<PersistedEvent> {
    try {
      // 1. Persist to EventStore
      const dbEvent = await this.eventStore.appendEvent(sessionId, 'tool_use_requested', {
        tool_use_id: data.toolUseId,
        tool_name: data.toolName,
        tool_args: data.toolInput,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      });

      // 2. CRITICAL: Validate sequenceNumber
      if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
        throw new Error(
          `Event persisted without sequence_number: ${dbEvent.sequence_number}`
        );
      }

      // 3. Queue to MessageQueue
      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId: data.toolUseId,
        role: 'assistant',
        messageType: 'tool_use',
        content: '',
        metadata: {
          tool_name: data.toolName,
          tool_args: data.toolInput,
          tool_use_id: data.toolUseId,
          status: 'pending',
        },
        sequenceNumber: dbEvent.sequence_number,
        eventId: dbEvent.id,
        toolUseId: data.toolUseId,
      });

      // 4. Return PersistedEvent
      return {
        eventId: dbEvent.id,
        sequenceNumber: dbEvent.sequence_number,
        timestamp: dbEvent.timestamp.toISOString(),
      };
    } catch (error) {
      const causes = this.errorAnalyzer.analyze(error);
      this.logger.error(
        {
          error,
          sessionId,
          toolUseId: data.toolUseId,
          toolName: data.toolName,
          causes,
          phase: 'tool_use_persistence',
        },
        'Failed to persist tool use'
      );
      throw error;
    }
  }

  /**
   * Persist tool result.
   * @param sessionId - Session ID
   * @param data - Tool result data
   * @returns Persisted event with sequence number
   */
  async persistToolResult(sessionId: string, data: ToolResultData): Promise<PersistedEvent> {
    try {
      // 1. Persist to EventStore
      const dbEvent = await this.eventStore.appendEvent(sessionId, 'tool_use_completed', {
        tool_use_id: data.toolUseId,
        result: data.toolOutput,
        success: !data.isError,
        error: data.errorMessage,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      });

      // 2. CRITICAL: Validate sequenceNumber
      if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
        throw new Error(
          `Event persisted without sequence_number: ${dbEvent.sequence_number}`
        );
      }

      // 3. Queue to MessageQueue
      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId: `${data.toolUseId}_result`,
        role: 'assistant',
        messageType: 'tool_result',
        content: data.toolOutput,
        metadata: {
          tool_use_id: data.toolUseId,
          success: !data.isError,
          error_message: data.errorMessage,
        },
        sequenceNumber: dbEvent.sequence_number,
        eventId: dbEvent.id,
        toolUseId: data.toolUseId,
      });

      // 4. Return PersistedEvent
      return {
        eventId: dbEvent.id,
        sequenceNumber: dbEvent.sequence_number,
        timestamp: dbEvent.timestamp.toISOString(),
      };
    } catch (error) {
      const causes = this.errorAnalyzer.analyze(error);
      this.logger.error(
        {
          error,
          sessionId,
          toolUseId: data.toolUseId,
          causes,
          phase: 'tool_result_persistence',
        },
        'Failed to persist tool result'
      );
      throw error;
    }
  }

  /**
   * Persist error event.
   * @param sessionId - Session ID
   * @param data - Error data
   * @returns Persisted event with sequence number
   */
  async persistError(sessionId: string, data: ErrorData): Promise<PersistedEvent> {
    try {
      // 1. Persist to EventStore
      const dbEvent = await this.eventStore.appendEvent(sessionId, 'error_occurred', {
        error: data.error,
        code: data.code,
        details: data.details,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      });

      // 2. CRITICAL: Validate sequenceNumber
      if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
        throw new Error(
          `Event persisted without sequence_number: ${dbEvent.sequence_number}`
        );
      }

      // 3. Return PersistedEvent (no MessageQueue for errors)
      return {
        eventId: dbEvent.id,
        sequenceNumber: dbEvent.sequence_number,
        timestamp: dbEvent.timestamp.toISOString(),
      };
    } catch (error) {
      const causes = this.errorAnalyzer.analyze(error);
      this.logger.error(
        {
          error,
          sessionId,
          causes,
          phase: 'error_persistence',
        },
        'Failed to persist error event'
      );
      throw error;
    }
  }

  /**
   * Persist tool executions asynchronously (fire-and-forget).
   * Does not block - persists in background.
   * Uses pre-allocated sequence numbers when provided for deterministic ordering.
   *
   * @param sessionId - Session ID
   * @param executions - Array of tool executions (may include preAllocatedToolUseSeq/preAllocatedToolResultSeq)
   */
  persistToolEventsAsync(sessionId: string, executions: ToolExecution[]): void {
    // Use IIFE for background processing
    (async () => {
      for (const exec of executions) {
        try {
          const toolUsePayload = {
            tool_use_id: exec.toolUseId,
            tool_name: exec.toolName,
            tool_args: exec.toolInput,
            timestamp: exec.timestamp,
            persistenceState: 'persisted',
          };

          // Persist tool_use (use appendEventWithSequence if preAllocatedToolUseSeq provided)
          const toolUseDbEvent = exec.preAllocatedToolUseSeq !== undefined
            ? await this.eventStore.appendEventWithSequence(
                sessionId,
                'tool_use_requested',
                toolUsePayload,
                exec.preAllocatedToolUseSeq
              )
            : await this.eventStore.appendEvent(sessionId, 'tool_use_requested', toolUsePayload);

          await this.messageQueue.addMessagePersistence({
            sessionId,
            messageId: exec.toolUseId,
            role: 'assistant',
            messageType: 'tool_use',
            content: '',
            metadata: {
              tool_name: exec.toolName,
              tool_args: exec.toolInput,
              tool_use_id: exec.toolUseId,
              status: 'completed',
            },
            sequenceNumber: toolUseDbEvent.sequence_number,
            eventId: toolUseDbEvent.id,
            toolUseId: exec.toolUseId,
          });

          const toolResultPayload = {
            tool_use_id: exec.toolUseId,
            result: exec.toolOutput,
            success: exec.success,
            error: exec.error,
            timestamp: exec.timestamp,
            persistenceState: 'persisted',
          };

          // Persist tool_result (use appendEventWithSequence if preAllocatedToolResultSeq provided)
          const toolResultDbEvent = exec.preAllocatedToolResultSeq !== undefined
            ? await this.eventStore.appendEventWithSequence(
                sessionId,
                'tool_use_completed',
                toolResultPayload,
                exec.preAllocatedToolResultSeq
              )
            : await this.eventStore.appendEvent(sessionId, 'tool_use_completed', toolResultPayload);

          await this.messageQueue.addMessagePersistence({
            sessionId,
            messageId: `${exec.toolUseId}_result`,
            role: 'assistant',
            messageType: 'tool_result',
            content: exec.toolOutput,
            metadata: {
              tool_name: exec.toolName,
              tool_use_id: exec.toolUseId,
              success: exec.success,
              error_message: exec.error,
            },
            sequenceNumber: toolResultDbEvent.sequence_number,
            eventId: toolResultDbEvent.id,
            toolUseId: exec.toolUseId,
          });

          this.logger.info(
            {
              toolUseId: exec.toolUseId,
              toolName: exec.toolName,
              toolUseSeqNum: toolUseDbEvent.sequence_number,
              toolResultSeqNum: toolResultDbEvent.sequence_number,
              usedPreAllocated: exec.preAllocatedToolUseSeq !== undefined,
            },
            'Tool events persisted async'
          );
        } catch (err) {
          // Log error but don't throw (fire-and-forget)
          this.logger.error(
            {
              err,
              toolUseId: exec.toolUseId,
              toolName: exec.toolName,
            },
            'Failed to persist tool events'
          );
        }
      }
    })();
  }

  /**
   * Persist citations asynchronously (fire-and-forget).
   * Does not block - persists RAG citations in background.
   *
   * @param sessionId - Session ID
   * @param messageId - Message ID to associate citations with
   * @param citations - Array of cited files from RAG tool results
   */
  persistCitationsAsync(
    sessionId: string,
    messageId: string,
    citations: Array<{
      fileName: string;
      fileId: string | null;
      sourceType: string;
      mimeType: string;
      relevanceScore: number;
      isImage: boolean;
    }>
  ): void {
    if (!citations.length) return;

    // Use IIFE for background processing
    (async () => {
      try {
        // Deduplicate by fileName (in case of multiple chunks from same file)
        const uniqueCitations = Array.from(
          new Map(citations.map(c => [c.fileName, c])).values()
        );

        // Append audit event to EventStore
        await this.eventStore.appendEvent(sessionId, 'citations_created', {
          message_id: messageId,
          citation_count: uniqueCitations.length,
          file_names: uniqueCitations.map(c => c.fileName),
          timestamp: new Date().toISOString(),
          persistenceState: 'persisted',
        });

        // Queue DB write via MessageQueue
        await this.messageQueue.addCitationPersistence({
          sessionId,
          messageId,
          citations: uniqueCitations,
        });

        this.logger.info(
          {
            sessionId,
            messageId,
            citationCount: uniqueCitations.length,
          },
          'Citations persisted async'
        );
      } catch (err) {
        // Log error but don't throw (fire-and-forget)
        this.logger.error(
          {
            err,
            sessionId,
            messageId,
            citationCount: citations.length,
          },
          'Failed to persist citations'
        );
      }
    })();
  }

  /**
   * Persist message-to-chat-attachment links asynchronously (fire-and-forget).
   * Does not block - creates junction table entries in background.
   *
   * @param messageId - Message ID to link attachments to
   * @param chatAttachmentIds - Array of chat attachment IDs to link
   */
  persistMessageChatAttachmentsAsync(messageId: string, chatAttachmentIds: string[]): void {
    if (!chatAttachmentIds.length) return;

    // Use IIFE for background processing
    (async () => {
      try {
        const attachmentService = getMessageChatAttachmentService();
        const result = await attachmentService.recordAttachments(messageId, chatAttachmentIds);

        this.logger.info(
          {
            messageId,
            attachmentCount: chatAttachmentIds.length,
            recordsCreated: result.recordsCreated,
          },
          'Chat attachments linked to message async'
        );
      } catch (err) {
        // Log error but don't throw (fire-and-forget)
        const errorInfo =
          err instanceof Error
            ? { message: err.message, stack: err.stack, name: err.name }
            : { value: String(err) };

        this.logger.error(
          {
            error: errorInfo,
            messageId,
            attachmentCount: chatAttachmentIds.length,
          },
          'Failed to link chat attachments to message'
        );
      }
    })();
  }

  /**
   * Await completion of a persistence job.
   * Uses BullMQ's waitUntilFinished for reliable job completion detection.
   * @param jobId - BullMQ job ID from persist* methods
   * @param timeoutMs - Max wait time (default 30000ms)
   */
  async awaitPersistence(jobId: string, timeoutMs: number = 30000): Promise<void> {
    const queueEvents = this.messageQueue.getQueueEvents(QueueName.MESSAGE_PERSISTENCE);
    if (!queueEvents) {
      this.logger.warn('QueueEvents not available, skipping await');
      return;
    }

    const job = await this.messageQueue.getJob(QueueName.MESSAGE_PERSISTENCE, jobId);
    if (!job) {
      this.logger.debug({ jobId }, 'Job not found, may have completed');
      return;
    }

    await job.waitUntilFinished(queueEvents, timeoutMs);
  }
}

/**
 * Get the singleton PersistenceCoordinator instance.
 * @returns The shared PersistenceCoordinator instance
 */
export function getPersistenceCoordinator(): PersistenceCoordinator {
  if (!instance) {
    instance = new PersistenceCoordinator();
  }
  return instance;
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetPersistenceCoordinator(): void {
  instance = null;
}
