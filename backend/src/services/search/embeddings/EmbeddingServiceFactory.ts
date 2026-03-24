/**
 * Embedding Service Factory (PRD-201)
 *
 * Returns the appropriate embedding service based on the USE_UNIFIED_INDEX feature flag.
 * When enabled: returns CohereEmbeddingService (unified 1536d text+image)
 * When disabled: returns undefined (callers use legacy EmbeddingService directly)
 *
 * NOT a classic factory wrapping legacy behind IEmbeddingService — the legacy
 * EmbeddingService has a different API shape (TextEmbedding vs EmbeddingResult).
 * Callers branch on isUnifiedIndexEnabled() and call the appropriate service.
 *
 * @module services/search/embeddings/EmbeddingServiceFactory
 */

import { env } from '@/infrastructure/config/environment';
import { CohereEmbeddingService } from './CohereEmbeddingService';
import type { IEmbeddingService } from './types';

let cohereInstance: CohereEmbeddingService | undefined;

/**
 * Get the unified embedding service (Cohere Embed 4).
 *
 * Returns CohereEmbeddingService when USE_UNIFIED_INDEX=true.
 * Returns undefined when USE_UNIFIED_INDEX=false (use legacy EmbeddingService).
 *
 * Singleton: creates one CohereEmbeddingService instance per process.
 */
export function getUnifiedEmbeddingService(): IEmbeddingService | undefined {
  if (!env.USE_UNIFIED_INDEX) return undefined;

  if (!cohereInstance) {
    cohereInstance = new CohereEmbeddingService();
  }
  return cohereInstance;
}

/**
 * Check if the unified index (Cohere Embed 4) is enabled.
 *
 * Use this for conditional logic in services that need to branch
 * between legacy (dual-vector) and unified (single-vector) paths.
 */
export function isUnifiedIndexEnabled(): boolean {
  return env.USE_UNIFIED_INDEX === true;
}

/**
 * Reset factory state (for testing only).
 * @internal
 */
export function _resetForTesting(): void {
  cohereInstance = undefined;
}
