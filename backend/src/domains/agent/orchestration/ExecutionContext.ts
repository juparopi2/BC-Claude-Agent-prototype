/**
 * @module domains/agent/orchestration/ExecutionContext
 *
 * Per-execution context that holds all mutable state for agent execution.
 * This enables stateless components and guarantees multi-tenant isolation.
 *
 * ## Architecture
 *
 * The ExecutionContext pattern solves the multi-tenant race condition by:
 * 1. Creating a new context for each `executeAgent()` call
 * 2. Passing the context to all stateless components
 * 3. All mutable state lives in the context, not in singleton instances
 *
 * This enables:
 * - Guaranteed isolation between concurrent executions
 * - Low GC pressure (only ~310 bytes per context base size)
 * - Compatibility with Azure Container Apps horizontal scaling
 * - No cleanup required (context is garbage collected when execution ends)
 *
 * @example
 * ```typescript
 * // In AgentOrchestrator.executeAgent()
 * const ctx = createExecutionContext(sessionId, userId, onEvent, options);
 *
 * // Pass to stateless components
 * for await (const event of graphStreamProcessor.process(events, ctx)) {
 *   agentEventEmitter.emit(event, ctx);
 * }
 * ```
 */

import { randomUUID } from 'crypto';
import type { AgentEvent } from '@bc-agent/shared';
import type { ExecuteStreamingOptions } from './types';

/**
 * Callback type for emitting events to WebSocket client.
 */
export type EventEmitCallback = (event: AgentEvent) => void;

/**
 * Per-execution context holding all mutable state.
 *
 * ## Memory Layout (~310 bytes base)
 * - Identity fields: ~108 bytes (3 UUIDs)
 * - callback: 8 bytes (pointer)
 * - eventIndex: 8 bytes (number)
 * - thinkingChunks: 48 bytes (empty array overhead)
 * - contentChunks: 48 bytes (empty array overhead)
 * - seenToolIds: 48 bytes (empty Map overhead)
 * - numbers (4): 32 bytes
 * - booleans (2): 2 bytes
 * - lastStopReason: ~10 bytes
 *
 * ## Growth During Execution
 * - thinkingChunks: ~100KB typical (Extended Thinking content)
 * - contentChunks: ~10KB typical (response content)
 * - seenToolIds: ~200 bytes per tool call
 */
export interface ExecutionContext {
  // ============================================================================
  // Identity
  // ============================================================================

  /**
   * Unique ID for this execution instance.
   * Used for logging, tracing, and debugging.
   */
  readonly executionId: string;

  /**
   * Session ID for the chat conversation.
   * Used for persistence and room-based WebSocket emission.
   */
  readonly sessionId: string;

  /**
   * User ID for multi-tenant isolation.
   * All operations must be scoped to this user.
   */
  readonly userId: string;

  // ============================================================================
  // Event Emission
  // ============================================================================

  /**
   * Callback to emit events to the WebSocket client.
   * Can be undefined for fire-and-forget operations.
   */
  readonly callback: EventEmitCallback | undefined;

  /**
   * Auto-incrementing index for event ordering.
   * Ensures events arrive in correct order on the frontend.
   * MUTABLE: Incremented by AgentEventEmitter.emit()
   */
  eventIndex: number;

  // ============================================================================
  // Stream Accumulation
  // ============================================================================

  /**
   * Accumulated thinking chunks for Extended Thinking mode.
   * MUTABLE: Pushed by GraphStreamProcessor on reasoning_delta events.
   */
  readonly thinkingChunks: string[];

  /**
   * Flag indicating thinking phase is complete.
   * MUTABLE: Set to true when transitioning from thinking to content.
   */
  thinkingComplete: boolean;

  /**
   * Accumulated content chunks for the response.
   * MUTABLE: Pushed by GraphStreamProcessor on content_delta events.
   */
  readonly contentChunks: string[];

  /**
   * Last stop reason received from the LLM.
   * MUTABLE: Updated by GraphStreamProcessor on stream_end events.
   */
  lastStopReason: string;

  // ============================================================================
  // Tool Deduplication
  // ============================================================================

  /**
   * Map of tool_use IDs that have been seen.
   * Key: toolUseId, Value: ISO timestamp when first seen.
   * SHARED between GraphStreamProcessor and ToolExecutionProcessor.
   * MUTABLE: Set by both processors to prevent duplicate emissions.
   */
  readonly seenToolIds: Map<string, string>;

  // ============================================================================
  // Usage Tracking
  // ============================================================================

  /**
   * Total input tokens consumed in this execution.
   * MUTABLE: Accumulated from usage events.
   */
  totalInputTokens: number;

  /**
   * Total output tokens generated in this execution.
   * MUTABLE: Accumulated from usage events.
   */
  totalOutputTokens: number;

  // ============================================================================
  // Options (Immutable)
  // ============================================================================

  /**
   * Whether Extended Thinking is enabled for this execution.
   * @default false
   */
  readonly enableThinking: boolean;

  /**
   * Token budget for Extended Thinking.
   * @default 10000
   */
  readonly thinkingBudget: number;
}

/**
 * Create a new ExecutionContext for an agent execution.
 *
 * This function should be called at the start of each `executeAgent()` call.
 * The returned context is passed to all stateless components.
 *
 * @param sessionId - Session ID for the conversation
 * @param userId - User ID for multi-tenant isolation
 * @param callback - Optional callback for event emission
 * @param options - Execution options
 * @returns A new ExecutionContext instance
 *
 * @example
 * ```typescript
 * const ctx = createExecutionContext(
 *   'session-123',
 *   'user-456',
 *   (event) => socket.emit('agent:event', event),
 *   { enableThinking: true, thinkingBudget: 5000 }
 * );
 * ```
 */
export function createExecutionContext(
  sessionId: string,
  userId: string,
  callback?: EventEmitCallback,
  options?: ExecuteStreamingOptions
): ExecutionContext {
  return {
    // Identity
    executionId: randomUUID(),
    sessionId,
    userId,

    // Event Emission
    callback,
    eventIndex: 0,

    // Stream Accumulation
    thinkingChunks: [],
    thinkingComplete: false,
    contentChunks: [],
    lastStopReason: 'end_turn',

    // Tool Deduplication (single Map shared between processors)
    seenToolIds: new Map(),

    // Usage Tracking
    totalInputTokens: 0,
    totalOutputTokens: 0,

    // Options
    enableThinking: options?.enableThinking ?? false,
    thinkingBudget: options?.thinkingBudget ?? 10000,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the accumulated thinking content as a single string.
 * @param ctx - Execution context
 * @returns Concatenated thinking content
 */
export function getThinkingContent(ctx: ExecutionContext): string {
  return ctx.thinkingChunks.join('');
}

/**
 * Get the accumulated response content as a single string.
 * @param ctx - Execution context
 * @returns Concatenated response content
 */
export function getResponseContent(ctx: ExecutionContext): string {
  return ctx.contentChunks.join('');
}

/**
 * Check if a tool ID has been seen in this execution.
 * @param ctx - Execution context
 * @param toolUseId - Tool use ID to check
 * @returns True if the tool ID has already been processed
 */
export function isToolSeen(ctx: ExecutionContext, toolUseId: string): boolean {
  return ctx.seenToolIds.has(toolUseId);
}

/**
 * Mark a tool ID as seen and return whether it was a duplicate.
 * @param ctx - Execution context
 * @param toolUseId - Tool use ID to mark
 * @returns Object indicating if duplicate and when first seen
 */
export function markToolSeen(
  ctx: ExecutionContext,
  toolUseId: string
): { isDuplicate: boolean; firstSeenAt: string } {
  const existing = ctx.seenToolIds.get(toolUseId);
  if (existing) {
    return { isDuplicate: true, firstSeenAt: existing };
  }

  const timestamp = new Date().toISOString();
  ctx.seenToolIds.set(toolUseId, timestamp);
  return { isDuplicate: false, firstSeenAt: timestamp };
}

/**
 * Get the total tokens consumed in this execution.
 * @param ctx - Execution context
 * @returns Total input + output tokens
 */
export function getTotalTokens(ctx: ExecutionContext): number {
  return ctx.totalInputTokens + ctx.totalOutputTokens;
}

/**
 * Add usage to the context.
 * @param ctx - Execution context
 * @param usage - Token usage to add
 */
export function addUsage(
  ctx: ExecutionContext,
  usage: { inputTokens?: number; outputTokens?: number }
): void {
  ctx.totalInputTokens += usage.inputTokens ?? 0;
  ctx.totalOutputTokens += usage.outputTokens ?? 0;
}
