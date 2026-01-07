/**
 * Citation Domain
 *
 * Barrel export for citation extraction functionality.
 *
 * @module domains/agent/citations
 */

// Main service
export {
  CitationExtractor,
  getCitationExtractor,
  __resetCitationExtractor,
} from './CitationExtractor';

// Types
export type {
  ICitationExtractor,
  CitationExtractionResult,
  CitationProducingTool,
} from './types';

export { CITATION_PRODUCING_TOOLS } from './types';
