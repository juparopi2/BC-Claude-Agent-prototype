/**
 * Agent Context Annotation
 *
 * LangGraph annotation for shared context accessible to all agents.
 * Merges existing context fields with new multi-agent fields from PRD-020.
 *
 * @module agents/orchestrator/state/AgentContext
 */

import { Annotation } from '@langchain/langgraph';
import type { ModelRole } from '@/infrastructure/config/models';
import type { FileContextPreparationResult } from '@domains/agent/context/types';

/**
 * Shared context accessible to all agents in the graph.
 *
 * Existing fields (preserved for backward compat):
 * - userId, sessionId, preferredModelRole, options, fileContext
 *
 * New fields (PRD-020):
 * - searchContext: Semantic search results injected by context preparation
 * - bcCompanyId: Business Central company ID for ERP scoping
 * - metadata: Extensible key-value store for future needs
 */
export interface AgentContext {
  /** User ID for tenant isolation */
  userId?: string;
  /** Session ID for conversation scoping */
  sessionId?: string;
  /** Preferred model role (default uses role-based config) */
  preferredModelRole?: ModelRole;
  /** Agent execution options */
  options?: {
    /** Array of file IDs to attach to the conversation */
    attachments?: string[];
    /** Enable automatic semantic search for relevant chunks */
    enableAutoSemanticSearch?: boolean;
    /** Enable extended thinking mode (Anthropic models only) */
    enableThinking?: boolean;
    /** Token budget for extended thinking (minimum 1024) */
    thinkingBudget?: number;
  };
  /** File context prepared for injection into prompts */
  fileContext?: FileContextPreparationResult;
  /** Semantic search results for RAG context (PRD-020) */
  searchContext?: string[];
  /** Business Central company ID for ERP scoping (PRD-020) */
  bcCompanyId?: string;
  /** Extensible metadata for cross-agent coordination (PRD-020) */
  metadata?: Record<string, unknown>;
}

/**
 * LangGraph Annotation for shared agent context.
 * Reducer: shallow merge (preserves existing fields on partial update).
 */
export const AgentContextAnnotation = Annotation<AgentContext>({
  reducer: (existing, incoming) => ({ ...existing, ...incoming }),
  default: () => ({ userId: '', sessionId: '' }),
});
