/**
 * @module domains/agent/context
 *
 * Context domain for the agent orchestration system.
 * Handles file context preparation and semantic search.
 *
 * Implemented Classes:
 * - SemanticSearchHandler: Wraps SemanticSearchService for file search (~80 LOC)
 * - FileContextPreparer: Prepares file context for agent prompts (~100 LOC)
 */

// Types
export * from './types';

// SemanticSearchHandler
export {
  SemanticSearchHandler,
  createSemanticSearchHandler,
} from './SemanticSearchHandler';

// FileContextPreparer
export {
  FileContextPreparer,
  createFileContextPreparer,
} from './FileContextPreparer';
