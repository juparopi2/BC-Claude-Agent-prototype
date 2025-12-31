/**
 * AgentEvent Factory
 *
 * Factory methods for creating all 16 AgentEvent types with proper defaults.
 * Simulates backend event sourcing with auto-incrementing sequence numbers.
 *
 * @module __tests__/fixtures/AgentEventFactory
 */

import type {
  AgentEvent,
  AgentEventType,
  PersistenceState,
  SessionStartEvent,
  ThinkingEvent,
  ThinkingCompleteEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  ErrorEvent,
  SessionEndEvent,
  CompleteEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  UserMessageConfirmedEvent,
  TurnPausedEvent,
  ContentRefusedEvent,
} from '@bc-agent/shared';

/**
 * Sequence counter for simulating Redis INCR
 */
let sequenceCounter = 1;

/**
 * UUID generator for event IDs
 */
function generateEventId(): string {
  return `evt-${crypto.randomUUID()}`;
}

/**
 * UUID generator for message IDs (Anthropic format)
 */
function generateMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`;
}

/**
 * UUID generator for tool use IDs
 */
function generateToolUseId(): string {
  return `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * UUID generator for approval IDs
 */
function generateApprovalId(): string {
  return `approval-${crypto.randomUUID()}`;
}

/**
 * AgentEvent Factory Class
 *
 * Provides static factory methods for all 16 event types.
 * Each event includes proper default values for Event Sourcing fields.
 *
 * @example
 * ```typescript
 * // Create a single message event
 * const message = AgentEventFactory.message({ content: 'Hello!' });
 *
 * // Create a sequence of events
 * const events = AgentEventFactory.sequence(['session_start', 'message_chunk', 'message', 'complete']);
 *
 * // Use presets for common flows
 * const chatFlow = AgentEventFactory.Presets.chatFlow();
 * ```
 */
export class AgentEventFactory {
  /**
   * Reset sequence counter (call in beforeEach)
   */
  static resetSequence(start = 1): void {
    sequenceCounter = start;
  }

  /**
   * Get current sequence number without incrementing
   */
  static currentSequence(): number {
    return sequenceCounter;
  }

  /**
   * Create base event fields
   */
  private static baseEvent(
    overrides?: Partial<{ sequenceNumber: number; persistenceState: PersistenceState }>
  ) {
    return {
      eventId: generateEventId(),
      sequenceNumber: overrides?.sequenceNumber ?? sequenceCounter++,
      persistenceState: overrides?.persistenceState ?? ('persisted' as PersistenceState),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create base event fields for transient events (no sequence number)
   */
  private static transientBaseEvent() {
    return {
      eventId: generateEventId(),
      persistenceState: 'transient' as PersistenceState,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================
  // Session Lifecycle Events
  // ============================================

  /**
   * Create session_start event
   */
  static sessionStart(overrides?: Partial<SessionStartEvent>): SessionStartEvent {
    return {
      type: 'session_start',
      sessionId: overrides?.sessionId ?? 'test-session-123',
      userId: overrides?.userId ?? 'test-user-456',
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  /**
   * Create session_end event
   */
  static sessionEnd(overrides?: Partial<SessionEndEvent>): SessionEndEvent {
    return {
      type: 'session_end',
      sessionId: overrides?.sessionId ?? 'test-session-123',
      reason: overrides?.reason ?? 'completed',
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  /**
   * Create complete event (terminal)
   */
  static complete(overrides?: Partial<CompleteEvent>): CompleteEvent {
    return {
      type: 'complete',
      reason: overrides?.reason ?? 'success',
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  // ============================================
  // Thinking Events (Extended Thinking)
  // ============================================

  /**
   * Create thinking event (complete thinking block)
   */
  static thinking(overrides?: Partial<ThinkingEvent>): ThinkingEvent {
    return {
      type: 'thinking',
      content: overrides?.content ?? 'Analyzing the request...',
      tokenCount: overrides?.tokenCount ?? 150,
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  // NOTE: thinkingChunk, messagePartial, messageChunk removed - sync architecture uses complete events only

  // ============================================
  // Message Events (sync architecture - complete messages only)
  // ============================================

  /**
   * Create message event (complete message)
   */
  static message(overrides?: Partial<MessageEvent>): MessageEvent {
    return {
      type: 'message',
      messageId: overrides?.messageId ?? generateMessageId(),
      role: overrides?.role ?? 'assistant',
      content: overrides?.content ?? 'Here is the complete response.',
      stopReason: overrides?.stopReason ?? 'end_turn',
      tokenUsage: overrides?.tokenUsage ?? { inputTokens: 50, outputTokens: 100 },
      model: overrides?.model ?? 'claude-sonnet-4-5-20250929',
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  // ============================================
  // Tool Events
  // ============================================

  /**
   * Create tool_use event
   */
  static toolUse(overrides?: Partial<ToolUseEvent>): ToolUseEvent {
    return {
      type: 'tool_use',
      toolName: overrides?.toolName ?? 'list_customers',
      args: overrides?.args ?? { filter: 'active' },
      toolUseId: overrides?.toolUseId ?? generateToolUseId(),
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  /**
   * Create tool_result event
   */
  static toolResult(overrides?: Partial<ToolResultEvent>): ToolResultEvent {
    return {
      type: 'tool_result',
      toolName: overrides?.toolName ?? 'list_customers',
      args: overrides?.args ?? { filter: 'active' },
      result: overrides?.result ?? { customers: [{ id: '1', name: 'Acme Corp' }] },
      success: overrides?.success ?? true,
      error: overrides?.error,
      toolUseId: overrides?.toolUseId ?? generateToolUseId(),
      durationMs: overrides?.durationMs ?? 150,
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  // ============================================
  // Approval Events (Human-in-the-Loop)
  // ============================================

  /**
   * Create approval_requested event
   */
  static approvalRequested(overrides?: Partial<ApprovalRequestedEvent>): ApprovalRequestedEvent {
    return {
      type: 'approval_requested',
      approvalId: overrides?.approvalId ?? generateApprovalId(),
      toolName: overrides?.toolName ?? 'customer_create',
      args: overrides?.args ?? { name: 'New Customer', email: 'new@example.com' },
      changeSummary: overrides?.changeSummary ?? 'Create new customer: New Customer',
      priority: overrides?.priority ?? 'high',
      expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  /**
   * Create approval_resolved event
   */
  static approvalResolved(overrides?: Partial<ApprovalResolvedEvent>): ApprovalResolvedEvent {
    return {
      type: 'approval_resolved',
      approvalId: overrides?.approvalId ?? generateApprovalId(),
      decision: overrides?.decision ?? 'approved',
      reason: overrides?.reason,
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  // ============================================
  // Special Events
  // ============================================

  /**
   * Create user_message_confirmed event
   */
  static userMessageConfirmed(overrides?: Partial<UserMessageConfirmedEvent>): UserMessageConfirmedEvent {
    const seq = overrides?.sequenceNumber ?? sequenceCounter++;
    return {
      type: 'user_message_confirmed',
      messageId: overrides?.messageId ?? `msg-${crypto.randomUUID()}`,
      userId: overrides?.userId ?? 'test-user-456',
      content: overrides?.content ?? 'User message content',
      sequenceNumber: seq,
      eventId: overrides?.eventId ?? generateEventId(),
      persistenceState: 'persisted',
      timestamp: overrides?.timestamp ?? new Date().toISOString(),
      ...overrides,
    };
  }

  /**
   * Create turn_paused event (SDK 0.71+)
   */
  static turnPaused(overrides?: Partial<TurnPausedEvent>): TurnPausedEvent {
    return {
      type: 'turn_paused',
      messageId: overrides?.messageId ?? generateMessageId(),
      content: overrides?.content ?? 'Partial content before pause...',
      reason: overrides?.reason ?? 'Long operation paused',
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  /**
   * Create content_refused event (SDK 0.71+)
   */
  static contentRefused(overrides?: Partial<ContentRefusedEvent>): ContentRefusedEvent {
    return {
      type: 'content_refused',
      messageId: overrides?.messageId ?? generateMessageId(),
      reason: overrides?.reason ?? 'Content policy violation',
      content: overrides?.content ?? '',
      ...this.baseEvent(overrides),
      ...overrides,
    };
  }

  /**
   * Create error event (transient)
   * NOTE: Transient events MUST NOT have sequenceNumber - we strip it from overrides
   */
  static error(overrides?: Partial<ErrorEvent>): ErrorEvent {
    // Remove sequenceNumber from overrides if present (transient events shouldn't have one)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sequenceNumber: _ignored, ...safeOverrides } = overrides ?? {};
    return {
      type: 'error',
      error: safeOverrides?.error ?? 'An error occurred',
      code: safeOverrides?.code ?? 'INTERNAL_ERROR',
      ...this.transientBaseEvent(),
      ...safeOverrides,
    };
  }

  // ============================================
  // Sequence Generators
  // ============================================

  /**
   * Create a sequence of events from type names
   */
  static sequence(types: AgentEventType[], startSeq = 1): AgentEvent[] {
    this.resetSequence(startSeq);
    return types.map((type) => {
      switch (type) {
        case 'session_start':
          return this.sessionStart();
        case 'thinking':
          return this.thinking();
        case 'thinking_chunk':
          return this.thinkingChunk();
        case 'message_partial':
          return this.messagePartial();
        case 'message':
          return this.message();
        case 'message_chunk':
          return this.messageChunk();
        case 'tool_use':
          return this.toolUse();
        case 'tool_result':
          return this.toolResult();
        case 'error':
          return this.error();
        case 'session_end':
          return this.sessionEnd();
        case 'complete':
          return this.complete();
        case 'approval_requested':
          return this.approvalRequested();
        case 'approval_resolved':
          return this.approvalResolved();
        case 'user_message_confirmed':
          return this.userMessageConfirmed();
        case 'turn_paused':
          return this.turnPaused();
        case 'content_refused':
          return this.contentRefused();
        case 'thinking_complete':
          // thinking_complete is handled elsewhere or is a transient event
          return this.thinking();
        default:
          throw new Error(`Unknown event type: ${type}`);
      }
    });
  }

  // ============================================
  // Common Flow Presets
  // ============================================

  static Presets = {
    /**
     * Basic chat flow: session_start -> chunks -> message -> complete
     */
    chatFlow: (): AgentEvent[] => {
      AgentEventFactory.resetSequence();
      return [
        AgentEventFactory.sessionStart(),
        AgentEventFactory.messageChunk({ content: 'Hello, ' }),
        AgentEventFactory.messageChunk({ content: 'how can ' }),
        AgentEventFactory.messageChunk({ content: 'I help?' }),
        AgentEventFactory.message({ content: 'Hello, how can I help?' }),
        AgentEventFactory.complete(),
      ];
    },

    /**
     * Tool execution flow: tool_use -> tool_result
     */
    toolFlow: (): AgentEvent[] => {
      const toolUseId = generateToolUseId();
      AgentEventFactory.resetSequence();
      return [
        AgentEventFactory.toolUse({ toolUseId }),
        AgentEventFactory.toolResult({ toolUseId }),
      ];
    },

    /**
     * Approval flow: tool_use -> approval_requested -> approval_resolved -> tool_result
     */
    approvalFlow: (approved = true): AgentEvent[] => {
      const approvalId = generateApprovalId();
      const toolUseId = generateToolUseId();
      AgentEventFactory.resetSequence();
      return [
        AgentEventFactory.toolUse({ toolUseId }),
        AgentEventFactory.approvalRequested({ approvalId, toolName: 'customer_create' }),
        AgentEventFactory.approvalResolved({
          approvalId,
          decision: approved ? 'approved' : 'rejected',
        }),
        ...(approved ? [AgentEventFactory.toolResult({ toolUseId })] : []),
      ];
    },

    /**
     * Thinking flow (Extended Thinking): thinking_chunks -> thinking -> message
     * NOTE: Low priority per user decision - only happy path
     */
    thinkingFlow: (): AgentEvent[] => {
      AgentEventFactory.resetSequence();
      return [
        AgentEventFactory.thinkingChunk({ content: 'First thought...' }),
        AgentEventFactory.thinkingChunk({ content: 'Second thought...' }),
        AgentEventFactory.thinking({ content: 'First thought...Second thought...' }),
        AgentEventFactory.message({ content: 'Here is my response.' }),
      ];
    },

    /**
     * Error flow: session_start -> error
     */
    errorFlow: (): AgentEvent[] => {
      AgentEventFactory.resetSequence();
      return [AgentEventFactory.sessionStart(), AgentEventFactory.error()];
    },

    /**
     * User message confirmation flow (sync architecture - no chunks)
     */
    userMessageFlow: (): AgentEvent[] => {
      AgentEventFactory.resetSequence();
      return [
        AgentEventFactory.sessionStart(),
        AgentEventFactory.userMessageConfirmed({ content: 'Hello agent!' }),
        AgentEventFactory.message({ content: 'Response...' }),
        AgentEventFactory.complete(),
      ];
    },
  };
}

/**
 * Type guard helpers for event type narrowing in tests
 */
export const isMessageEvent = (event: AgentEvent): event is MessageEvent =>
  event.type === 'message';

// NOTE: isMessageChunkEvent removed - sync architecture uses complete messages only

export const isToolUseEvent = (event: AgentEvent): event is ToolUseEvent =>
  event.type === 'tool_use';

export const isToolResultEvent = (event: AgentEvent): event is ToolResultEvent =>
  event.type === 'tool_result';

export const isApprovalRequestedEvent = (event: AgentEvent): event is ApprovalRequestedEvent =>
  event.type === 'approval_requested';

export const isCompleteEvent = (event: AgentEvent): event is CompleteEvent =>
  event.type === 'complete';

export const isErrorEvent = (event: AgentEvent): event is ErrorEvent =>
  event.type === 'error';
