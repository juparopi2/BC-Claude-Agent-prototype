/**
 * Cohere Embed v4 model constants.
 * Single source of truth for model identifiers used across the search pipeline.
 *
 * @module services/search/embeddings/models
 */

/** Azure AIServices deployment name (used in API paths and vectorizer config) */
export const COHERE_DEPLOYMENT_NAME = 'embed-v-4-0';

/** Logical model name (used in DB records, usage tracking, and logging) */
export const COHERE_MODEL_NAME = 'Cohere-embed-v4';

/** Embedding dimensions produced by Cohere Embed v4 */
export const COHERE_EMBEDDING_DIMENSIONS = 1536;
