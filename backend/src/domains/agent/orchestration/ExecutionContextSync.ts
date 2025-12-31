/**
 * @module domains/agent/orchestration/ExecutionContextSync
 *
 * Simplified per-execution context for synchronous (non-streaming) agent execution.
 * Holds mutable state for event emission, tool deduplication, and usage tracking.
 *
 * ## Architecture
 *
 * This context enables stateless components and multi-tenant isolation:
 * 1. New context created for each `executeAgentSync()` call
 * 2. Context passed to all stateless components
 * 3. All mutable state lives here, not in singleton instances
 *
 * @example
 * ```typescript
 * const ctx = createExecutionContextSync(sessionId, userId, onEvent, options);
 * await orchestratorGraph.invoke(inputs);
 * emitOrderedEvents(ctx, extractedContent);
 * ```
 */

import { randomUUID } from 'crypto';
import type { AgentEvent } from '@bc-agent/shared';

/**
 * Callback type for emitting events to WebSocket client.
 */
export type EventEmitCallback = (event: AgentEvent) => void;

/**
 * Options for synchronous agent execution.
 */
export interface ExecuteSyncOptions {
  /**
   * Whether Extended Thinking is enabled.
   * @default false
   */
  enableThinking?: boolean;

  /**
   * Token budget for Extended Thinking.
   * @default 10000
   */
  thinkingBudget?: number;

  /**
   * Timeout in milliseconds for the entire execution.
   * @default 300000 (5 minutes)
   */
  timeoutMs?: number;
}

/**
 * Simplified execution context for synchronous agent execution.
 *
 * ## Memory Layout (~250 bytes base)
 * - Identity fields: ~108 bytes (3 UUIDs)
 * - callback: 8 bytes (pointer)
 * - eventIndex: 8 bytes (number)
 * - seenToolIds: 48 bytes (empty Map overhead)
 * - numbers (4): 32 bytes
 * - booleans (1): 1 byte
 */
export interface ExecutionContextSync {
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
   * MUTABLE: Incremented on each emit.
   */
  eventIndex: number;

  // ============================================================================
  // Tool Deduplication
  // ============================================================================

  /**
   * Map of tool_use IDs that have been seen.
   * Key: toolUseId, Value: ISO timestamp when first seen.
   * MUTABLE: Set during tool processing to prevent duplicate emissions.
   */
  readonly seenToolIds: Map<string, string>;

  // ============================================================================
  // Usage Tracking
  // ============================================================================

  /**
   * Total input tokens consumed in this execution.
   * MUTABLE: Set after invoke completes.
   */
  totalInputTokens: number;

  /**
   * Total output tokens generated in this execution.
   * MUTABLE: Set after invoke completes.
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

  /**
   * Timeout in milliseconds for the entire execution.
   * @default 300000 (5 minutes)
   */
  readonly timeoutMs: number;
}

/**
 * Create a new ExecutionContextSync for synchronous agent execution.
 *
 * @param sessionId - Session ID for the conversation
 * @param userId - User ID for multi-tenant isolation
 * @param callback - Optional callback for event emission
 * @param options - Execution options
 * @returns A new ExecutionContextSync instance
 *
 * @example
 * ```typescript
 * const ctx = createExecutionContextSync(
 *   'session-123',
 *   'user-456',
 *   (event) => socket.emit('agent:event', event),
 *   { enableThinking: true }
 * );
 * ```
 */
export function createExecutionContextSync(
  sessionId: string,
  userId: string,
  callback?: EventEmitCallback,
  options?: ExecuteSyncOptions
): ExecutionContextSync {
  return {
    // Identity
    executionId: randomUUID(),
    sessionId,
    userId,

    // Event Emission
    callback,
    eventIndex: 0,

    // Tool Deduplication
    seenToolIds: new Map(),

    // Usage Tracking
    totalInputTokens: 0,
    totalOutputTokens: 0,

    // Options
    enableThinking: options?.enableThinking ?? false,
    thinkingBudget: options?.thinkingBudget ?? 10000,
    timeoutMs: options?.timeoutMs ?? 300000,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a tool ID has been seen in this execution.
 * @param ctx - Execution context
 * @param toolUseId - Tool use ID to check
 * @returns True if the tool ID has already been processed
 */
export function isToolSeenSync(ctx: ExecutionContextSync, toolUseId: string): boolean {
  return ctx.seenToolIds.has(toolUseId);
}

/**
 * Mark a tool ID as seen and return whether it was a duplicate.
 * @param ctx - Execution context
 * @param toolUseId - Tool use ID to mark
 * @returns Object indicating if duplicate and when first seen
 */
export function markToolSeenSync(
  ctx: ExecutionContextSync,
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
export function getTotalTokensSync(ctx: ExecutionContextSync): number {
  return ctx.totalInputTokens + ctx.totalOutputTokens;
}

/**
 * Set usage on the context.
 * @param ctx - Execution context
 * @param usage - Token usage to set
 */
export function setUsageSync(
  ctx: ExecutionContextSync,
  usage: { inputTokens?: number; outputTokens?: number }
): void {
  ctx.totalInputTokens = usage.inputTokens ?? 0;
  ctx.totalOutputTokens = usage.outputTokens ?? 0;
}

/**
 * Get the next event index and increment the counter.
 * @param ctx - Execution context
 * @returns The current event index (before increment)
 */
export function getNextEventIndex(ctx: ExecutionContextSync): number {
  return ctx.eventIndex++;
}
