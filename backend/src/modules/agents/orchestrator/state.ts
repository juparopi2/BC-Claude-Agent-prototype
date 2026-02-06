import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { AgentIdentityAnnotation } from './state/AgentIdentity';
import { AgentContextAnnotation } from './state/AgentContext';

// Re-export state sub-modules for external consumers
export { DEFAULT_AGENT_IDENTITY } from './state/AgentIdentity';
export type { AgentContext } from './state/AgentContext';

/**
 * Tool execution record for tracking tool calls made by agents.
 * Used to emit tool_result events after graph execution.
 */
export interface ToolExecution {
  /** Unique ID from the tool call (matches tool_use event) */
  toolUseId: string;
  /** Name of the tool that was executed */
  toolName: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** Result of the tool execution */
  result: string;
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Error message if success is false */
  error?: string;
}

/**
 * Extended Agent State Schema (PRD-020)
 *
 * Extends the original AgentStateAnnotation with:
 * - currentAgentIdentity: Tracks which agent generated the response (for UI)
 * - context: Merged existing + new fields (searchContext, bcCompanyId, metadata)
 *
 * All existing fields are preserved for backward compatibility.
 */
export const ExtendedAgentStateAnnotation = Annotation.Root({
  /**
   * The conversation history.
   * Uses LangGraph's built-in message reducer.
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * Agent identity for UI display (PRD-020).
   * Tracks which agent generated the current response.
   * Reducer: replace entirely (each agent sets its own identity).
   */
  currentAgentIdentity: AgentIdentityAnnotation,

  /**
   * Shared context accessible to all agents.
   * Merged existing fields (userId, sessionId, options, fileContext)
   * with new PRD-020 fields (searchContext, bcCompanyId, metadata).
   * Reducer: shallow merge.
   */
  context: AgentContextAnnotation,

  /**
   * The ID of the currently active agent node.
   * Used for routing and UI feedback.
   * Preserved for backward compatibility with graph.ts conditional edges.
   */
  activeAgent: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "orchestrator",
    default: () => "orchestrator",
  }),

  /**
   * Tool executions tracked by agents during their ReAct loops.
   * Used to emit tool_result events after graph execution completes.
   * Reducer concatenates arrays from multiple agent invocations.
   */
  toolExecutions: Annotation<ToolExecution[]>({
    reducer: (existing, incoming) => [...(existing || []), ...(incoming || [])],
    default: () => [],
  }),

  /**
   * Model used by the active agent.
   * Set by each agent when it executes for billing and traceability.
   * Reducer keeps the last set value (each agent overwrites).
   */
  usedModel: Annotation<string | null>({
    reducer: (_, y) => y ?? null,
    default: () => null,
  }),
});

/**
 * Backward compatibility alias.
 * All 15+ files that import AgentStateAnnotation continue to work unchanged.
 */
export const AgentStateAnnotation = ExtendedAgentStateAnnotation;

/** Full agent state type (extended) */
export type AgentState = typeof ExtendedAgentStateAnnotation.State;

/** Alias for AgentState (explicit naming for PRD-020 consumers) */
export type ExtendedAgentState = AgentState;
