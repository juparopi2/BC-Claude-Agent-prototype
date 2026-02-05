import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import type { ModelRole } from '@/infrastructure/config/models';
import type { FileContextPreparationResult } from '@domains/agent/context/types';

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
 * Shared State Schema for the Agent Graph
 *
 * Using LangGraph's Annotation system to define the reducer logic.
 * 'messages' uses the built-in reducer to append new messages.
 */
export const AgentStateAnnotation = Annotation.Root({
  /**
   * The conversation history.
   * Uses simple concatenation reducer.
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * The ID of the currently active agent node.
   * Used for routing and UI feedback.
   */
  activeAgent: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "orchestrator",
    default: () => "orchestrator",
  }),

  /**
   * Context variables accessible to all agents.
   */
  context: Annotation<{
    userId?: string;
    sessionId?: string;
    /** Preferred model role (default uses role-based config) */
    preferredModelRole?: ModelRole;
    options?: {
      /** Array of file IDs to attach to the conversation */
      attachments?: string[];
      /** Enable automatic semantic search for relevant chunks */
      enableAutoSemanticSearch?: boolean;
    };
    /** File context prepared for injection into prompts */
    fileContext?: FileContextPreparationResult;
  }>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
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

export type AgentState = typeof AgentStateAnnotation.State;
