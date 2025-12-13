import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { ModelConfig } from '../../../core/langchain/ModelFactory';
import type { FileContextResult } from '@/types/agent.types';

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
    modelPreferences?: ModelConfig;
    options?: {
      /** Enable Claude's extended thinking mode */
      enableThinking?: boolean;
      /** Token budget for extended thinking (min 1024) */
      thinkingBudget?: number;
      /** Array of file IDs to attach to the conversation */
      attachments?: string[];
      /** Enable automatic semantic search for relevant chunks */
      enableAutoSemanticSearch?: boolean;
    };
    /** File context prepared for injection into prompts */
    fileContext?: FileContextResult;
  }>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
