/**
 * FakeAgentOrchestrator for Testing
 *
 * Mock implementation of IAgentOrchestrator for integration and E2E tests.
 * Allows configuring fake responses and events without calling Anthropic API.
 *
 * @module domains/agent/orchestration/FakeAgentOrchestrator
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AgentEvent,
  AgentExecutionResult,
  MessageEvent,
  CompleteEvent,
  ThinkingCompleteEvent,
  ToolUseEvent,
  ToolResultEvent,
  ErrorEvent,
  UserMessageConfirmedEvent,
  StopReason,
} from '@bc-agent/shared';
import type { IAgentOrchestrator, ExecuteStreamingOptions } from './types';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { getEventStore } from '@/services/events/EventStore';

/**
 * Configuration for a fake response scenario
 */
export interface FakeScenario {
  /** Text content to stream in chunks */
  textBlocks?: string[];
  /** Thinking content (for extended thinking tests) */
  thinkingContent?: string;
  /** Tool calls to simulate */
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    success?: boolean;
  }>;
  /** Error to throw */
  error?: Error | string;
  /** Delay between events in ms */
  delayMs?: number;
  /** Stop reason for the scenario (defaults to 'end_turn') */
  stopReason?: StopReason;
  /** Enable persistence to database (default: true for E2E tests) */
  enablePersistence?: boolean;
}

/**
 * Default scenario for simple text response
 */
const DEFAULT_SCENARIO: FakeScenario = {
  textBlocks: ['This is a fake response from FakeAgentOrchestrator.'],
  stopReason: 'end_turn',
  enablePersistence: true, // ⭐ Enable persistence by default for E2E tests
};

/**
 * FakeAgentOrchestrator for testing
 *
 * Usage:
 * ```typescript
 * const fake = new FakeAgentOrchestrator();
 *
 * // Configure a simple text response
 * fake.setResponse({ textBlocks: ['Hello, world!'] });
 *
 * // Configure with thinking
 * fake.setResponse({
 *   thinkingContent: 'Let me think...',
 *   textBlocks: ['Here is my answer.'],
 * });
 *
 * // Configure with tool calls
 * fake.setResponse({
 *   toolCalls: [{
 *     toolName: 'list_all_entities',
 *     args: {},
 *     result: [{ id: '1', name: 'Test' }],
 *   }],
 *   textBlocks: ['I found one entity.'],
 * });
 *
 * // Configure an error
 * fake.setResponse({ error: new Error('API Error') });
 * ```
 */
export class FakeAgentOrchestrator implements IAgentOrchestrator {
  private scenario: FakeScenario = DEFAULT_SCENARIO;
  private callCount = 0;
  private lastCallArgs: {
    prompt: string;
    sessionId: string;
    userId?: string;
    options?: ExecuteStreamingOptions;
  } | null = null;

  /**
   * Set the fake response scenario
   */
  setResponse(scenario: FakeScenario): void {
    this.scenario = { ...DEFAULT_SCENARIO, ...scenario };
  }

  /**
   * Reset to default scenario
   */
  reset(): void {
    this.scenario = DEFAULT_SCENARIO;
    this.callCount = 0;
    this.lastCallArgs = null;
  }

  /**
   * Get number of times executeAgentSync was called
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Get the arguments from the last call
   */
  getLastCallArgs(): typeof this.lastCallArgs {
    return this.lastCallArgs;
  }

  /**
   * Execute the fake agent synchronously (matches IAgentOrchestrator interface)
   */
  async executeAgentSync(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult> {
    this.callCount++;
    this.lastCallArgs = { prompt, sessionId, userId, options };

    const emit = onEvent ?? (() => {});
    const delay = this.scenario.delayMs ?? 0;
    let eventIndex = 0;
    let sequenceNumber = 1; // Start at 1, not 0 (tests expect > 0)

    const createBaseEvent = () => ({
      timestamp: new Date().toISOString(),
      eventId: uuidv4(),
      persistenceState: 'transient' as const,
      eventIndex: eventIndex++,
      sequenceNumber: sequenceNumber++, // Add real sequence numbers
    });

    // Helper for delays
    const wait = async () => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    };

    // =========================================================================
    // EMIT SESSION_START (Signals new turn to frontend)
    // Must be emitted BEFORE user_message_confirmed to match AgentOrchestrator
    // =========================================================================
    emit({
      ...createBaseEvent(),
      type: 'session_start',
      sessionId,
      userId: userId ?? 'fake-user',
      persistenceState: 'transient',
    } as AgentEvent);
    await wait();

    // Emit user_message_confirmed (after session_start)
    const userMessageEvent: UserMessageConfirmedEvent = {
      ...createBaseEvent(),
      type: 'user_message_confirmed',
      messageId: uuidv4(),
      content: prompt,
      userId: userId ?? 'fake-user',
      persistenceState: 'persisted',
    };
    emit(userMessageEvent);
    await wait();

    // Check for error scenario (AFTER user_message_confirmed)
    if (this.scenario.error) {
      const errorEvent: ErrorEvent = {
        ...createBaseEvent(),
        type: 'error',
        error: this.scenario.error instanceof Error
          ? this.scenario.error.message
          : this.scenario.error,
        code: 'FAKE_ERROR',
      };
      emit(errorEvent);

      // Also emit complete event for error scenarios
      const completeEvent: CompleteEvent = {
        ...createBaseEvent(),
        type: 'complete',
        reason: 'error',
      };
      emit(completeEvent);

      return {
        sessionId,
        response: '',
        toolsUsed: [],
        success: false,
        error: errorEvent.error,
      };
    }

    // Emit thinking_complete if configured (NO chunks - sync architecture)
    if (this.scenario.thinkingContent) {
      const thinkingComplete: ThinkingCompleteEvent = {
        ...createBaseEvent(),
        type: 'thinking_complete',
        content: this.scenario.thinkingContent,
      };
      emit(thinkingComplete);
      await wait();
    }

    // Emit tool calls if configured
    const toolsUsed: string[] = [];
    if (this.scenario.toolCalls) {
      for (const tool of this.scenario.toolCalls) {
        const toolUseId = uuidv4();

        const toolUseEvent: ToolUseEvent = {
          ...createBaseEvent(),
          type: 'tool_use',
          toolName: tool.toolName,
          args: tool.args,
          toolUseId,
        };
        emit(toolUseEvent);
        await wait();

        const toolResultEvent: ToolResultEvent = {
          ...createBaseEvent(),
          type: 'tool_result',
          toolName: tool.toolName,
          args: tool.args,
          result: tool.result,
          success: tool.success ?? true,
          toolUseId,
        };
        emit(toolResultEvent);
        await wait();

        toolsUsed.push(tool.toolName);
      }
    }

    // Build full content (NO chunks - sync architecture)
    const messageId = `msg_fake_${uuidv4().slice(0, 8)}`;
    const fullContent = (this.scenario.textBlocks ?? []).join(' ');

    // ⭐ Persist assistant message if persistence is enabled
    const enablePersistence = this.scenario.enablePersistence ?? true;
    let persistedEventId: string | undefined;
    let persistedSequenceNumber: number | undefined;

    if (enablePersistence && fullContent) {
      try {
        // Append to EventStore
        const eventStore = getEventStore();
        const event = await eventStore.appendEvent(sessionId, 'agent_message', {
          message_id: messageId,
          content: fullContent,
          role: 'assistant',
          stop_reason: this.scenario.stopReason ?? 'end_turn',
        });
        persistedEventId = event.id;
        persistedSequenceNumber = event.sequence_number;

        // Queue for DB persistence
        const messageQueue = getMessageQueue();
        await messageQueue.addMessagePersistence({
          sessionId,
          messageId,
          role: 'assistant',
          messageType: 'text',
          content: fullContent,
          metadata: { fake_orchestrator: true },
          sequenceNumber: event.sequence_number,
          eventId: event.id,
          stopReason: this.scenario.stopReason ?? 'end_turn',
        });
      } catch (error) {
        // Log but don't fail - persistence is optional for fake
        console.warn('[FakeAgentOrchestrator] Persistence failed:', error);
      }
    }

    // Emit final message
    const baseEvent = createBaseEvent();
    const messageEvent: MessageEvent = {
      ...baseEvent,
      type: 'message',
      content: fullContent,
      messageId,
      role: 'assistant',
      stopReason: this.scenario.stopReason ?? 'end_turn',
      tokenUsage: {
        inputTokens: prompt.length,
        outputTokens: fullContent.length,
      },
      // ⭐ Set persistenceState based on whether we persisted
      persistenceState: enablePersistence ? 'persisted' : 'transient',
      eventId: persistedEventId ?? baseEvent.eventId,
      sequenceNumber: persistedSequenceNumber ?? baseEvent.sequenceNumber,
    };
    emit(messageEvent);
    await wait();

    // Map Anthropic stopReason to normalized CompleteEvent.reason
    // Anthropic: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'
    // Normalized: 'success' | 'error' | 'max_turns' | 'user_cancelled'
    const stopReasonToNormalized: Record<string, CompleteEvent['reason']> = {
      'end_turn': 'success',
      'max_tokens': 'max_turns',
      'tool_use': 'success',
      'stop_sequence': 'success',
    };
    const originalStopReason = this.scenario.stopReason ?? 'end_turn';
    const normalizedReason = stopReasonToNormalized[originalStopReason] ?? 'success';

    // Emit complete event with both original stopReason and normalized reason
    // This matches the real AgentOrchestrator behavior (AgentOrchestrator.ts lines 291-304)
    const completeEvent: CompleteEvent = {
      ...createBaseEvent(),
      type: 'complete',
      stopReason: originalStopReason, // Original provider-specific reason
      reason: normalizedReason,        // Normalized canonical reason
    };
    emit(completeEvent);

    return {
      sessionId,
      response: fullContent,
      messageId,
      toolsUsed,
      success: true,
      tokenUsage: {
        inputTokens: prompt.length,
        outputTokens: fullContent.length,
        totalTokens: prompt.length + fullContent.length,
      },
    };
  }
}

/**
 * Singleton instance for tests
 */
let fakeOrchestratorInstance: FakeAgentOrchestrator | null = null;

/**
 * Get the singleton FakeAgentOrchestrator instance
 */
export function getFakeAgentOrchestrator(): FakeAgentOrchestrator {
  if (!fakeOrchestratorInstance) {
    fakeOrchestratorInstance = new FakeAgentOrchestrator();
  }
  return fakeOrchestratorInstance;
}

/**
 * Reset the singleton (for test isolation)
 */
export function __resetFakeAgentOrchestrator(): void {
  if (fakeOrchestratorInstance) {
    fakeOrchestratorInstance.reset();
  }
  fakeOrchestratorInstance = null;
}
