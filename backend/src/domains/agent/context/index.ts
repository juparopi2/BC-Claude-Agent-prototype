/**
 * @module domains/agent/context
 *
 * Context domain for the agent orchestration system.
 * Handles file context preparation and semantic search.
 *
 * Implemented Classes:
 * - SemanticSearchHandler: Wraps SemanticSearchService for file search (~80 LOC)
 * - FileContextPreparer: Prepares file context for agent prompts (~100 LOC)
 * - MentionScopeResolver: Resolves @mention inputs into OData scope filters
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

// MentionScopeResolver
export {
  MentionScopeResolver,
  getMentionScopeResolver,
} from './MentionScopeResolver';
export type {
  MentionInput,
  ResolvedMention,
  ScopeResolution,
} from './MentionScopeResolver';
