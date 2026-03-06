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
import type { AgentEvent, CitedFile, FileMention } from '@bc-agent/shared';
import { env } from 'process';
import {
  createToolLifecycleManager,
  type ToolLifecycleManager,
} from '@/domains/agent/tools';

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
   * @default true
   */
  enableThinking?: boolean;

  /**
   * Token budget for Extended Thinking.
   * @default 10000
   */
  thinkingBudget?: number;

  /**
   * Timeout in milliseconds for the entire execution.
   * @default 600000 (10 minutes)
   */
  timeoutMs?: number;

  /**
   * File attachment IDs to include as context.
   */
  attachments?: string[];

  /**
   * Enable automatic semantic search for relevant files.
   * @default false
   */
  enableAutoSemanticSearch?: boolean;

  /**
   * Chat attachment IDs to resolve and send to Anthropic as content blocks.
   * These are ephemeral attachments (not KB files), sent directly to the model.
   */
  chatAttachments?: string[];

  /**
   * Target agent ID for explicit agent selection.
   * When provided, bypasses supervisor LLM routing and invokes the agent directly.
   */
  targetAgentId?: string;

  /**
   * File/folder IDs from @mentions to scope RAG search.
   * Folder IDs are expanded to descendant file IDs on the backend.
   */
  mentionedFileIds?: string[];

  /**
   * Enable web search capability for this message.
   * When true, the supervisor prompt is augmented with a hint to prefer research-agent.
   * @default false
   */
  enableWebSearch?: boolean;

  /**
   * Full mention metadata for persistence.
   * Stored in user message metadata JSON for reconstruction.
   */
  mentions?: FileMention[];
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
  // Tool Lifecycle Management
  // ============================================================================

  /**
   * Manages tool lifecycle for unified persistence.
   * Tracks tool requests until responses arrive, then returns complete state
   * with both input and output for a single persistence operation.
   *
   * Created per-execution to ensure multi-tenant isolation.
   */
  readonly toolLifecycleManager: ToolLifecycleManager;

  // ============================================================================
  // Citation Tracking
  // ============================================================================

  /**
   * Cited sources collected from tool results.
   * Populated by CitationExtractor when processing tool_response events.
   * Used to populate citedFiles in CompleteEvent.
   *
   * MUTABLE: Sources are added during tool response processing.
   * Accumulated throughout execution and emitted with CompleteEvent.
   */
  readonly citedSources: CitedFile[];

  /**
   * Message ID of the last assistant message.
   * Set when processing assistant_message events.
   * Used to associate citations with the message in CompleteEvent.
   *
   * MUTABLE: Updated when assistant_message is processed.
   */
  lastAssistantMessageId: string | null;

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

  /**
   * Total cache creation tokens in this execution (Anthropic prompt caching).
   * MUTABLE: Accumulated after each assistant_message.
   */
  totalCacheCreationTokens: number;

  /**
   * Total cache read tokens in this execution (Anthropic prompt caching).
   * MUTABLE: Accumulated after each assistant_message.
   */
  totalCacheReadTokens: number;

  /**
   * Web search requests count in this execution (Anthropic server tool).
   * MUTABLE: Accumulated after each assistant_message with server tool usage.
   */
  totalWebSearchRequests: number;

  /**
   * Code execution requests count in this execution (Anthropic server tool).
   * MUTABLE: Accumulated after each assistant_message with server tool usage.
   */
  totalCodeExecutionRequests: number;

  /**
   * Per-agent token breakdown for billing attribution.
   * Key: agentId, Value: accumulated token usage for that agent.
   * MUTABLE: Updated after each assistant_message.
   */
  readonly perAgentUsage: Map<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; model: string }>;

  // ============================================================================
  // Options (Immutable)
  // ============================================================================

  /**
   * Whether Extended Thinking is enabled for this execution.
   * @default true
   */
  readonly enableThinking: boolean;

  /**
   * Token budget for Extended Thinking.
   * @default 10000
   */
  readonly thinkingBudget: number;

  /**
   * Timeout in milliseconds for the entire execution.
   * @default 600000 (10 minutes)
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

    // Tool Lifecycle Management
    toolLifecycleManager: createToolLifecycleManager(),

    // Citation Tracking
    citedSources: [],
    lastAssistantMessageId: null,

    // Usage Tracking
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalWebSearchRequests: 0,
    totalCodeExecutionRequests: 0,
    perAgentUsage: new Map(),

    // Options
    enableThinking: options?.enableThinking ?? true,
    thinkingBudget: options?.thinkingBudget ?? 10000,
    timeoutMs: options?.timeoutMs ?? getDefaultExecutionTimeoutMs(),
  };
}

// ============================================================================
// Configuration Helpers
// ============================================================================

const DEFAULT_EXECUTION_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Get the default execution timeout from the environment variable or fallback.
 * Reads `AGENT_EXECUTION_TIMEOUT_MS` from the environment.
 * @returns Timeout in milliseconds (default: 600000 = 10 minutes)
 */
function getDefaultExecutionTimeoutMs(): number {
  const envValue = env.AGENT_EXECUTION_TIMEOUT_MS;
  if (envValue) {
    const parsed = Number(envValue);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_EXECUTION_TIMEOUT_MS;
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
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    serverToolUse?: {
      webSearchRequests?: number;
      codeExecutionRequests?: number;
    };
  }
): void {
  // ACCUMULATE instead of overwrite — multi-agent turns have multiple assistant_messages
  ctx.totalInputTokens += usage.inputTokens ?? 0;
  ctx.totalOutputTokens += usage.outputTokens ?? 0;
  ctx.totalCacheCreationTokens += usage.cacheCreationTokens ?? 0;
  ctx.totalCacheReadTokens += usage.cacheReadTokens ?? 0;

  // Accumulate server tool usage (Anthropic web_search, code_execution)
  if (usage.serverToolUse) {
    ctx.totalWebSearchRequests += usage.serverToolUse.webSearchRequests ?? 0;
    ctx.totalCodeExecutionRequests += usage.serverToolUse.codeExecutionRequests ?? 0;
  }
}

/**
 * Get the next event index and increment the counter.
 * @param ctx - Execution context
 * @returns The current event index (before increment)
 */
export function getNextEventIndex(ctx: ExecutionContextSync): number {
  return ctx.eventIndex++;
}
