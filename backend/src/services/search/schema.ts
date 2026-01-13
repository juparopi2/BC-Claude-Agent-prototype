import { SearchIndex } from '@azure/search-documents';

export const INDEX_NAME = 'file-chunks-index';

/**
 * Text profile name constant for use in code
 */
export const TEXT_PROFILE_NAME = 'hnsw-profile';

/**
 * Image profile name constant for use in code
 */
export const IMAGE_PROFILE_NAME = 'hnsw-profile-image';

/**
 * Algorithm name constants
 */
export const TEXT_ALGORITHM_NAME = 'hnsw-algorithm';
export const IMAGE_ALGORITHM_NAME = 'hnsw-algorithm-image';

/**
 * D26: Semantic configuration name for reranking
 */
export const SEMANTIC_CONFIG_NAME = 'semantic-config';

/**
 * Azure AI Search Index Schema Definition.
 *
 * Supports two vector search modes:
 * - Text embeddings: 1536 dimensions (OpenAI text-embedding-3-small)
 * - Image embeddings: 1024 dimensions (Azure Computer Vision VectorizeImage)
 *
 * Both use HNSW algorithm with cosine similarity for semantic search.
 */
export const indexSchema: SearchIndex = {
  name: INDEX_NAME,
  fields: [
    // ===== Existing Fields =====
    {
      name: 'chunkId',
      type: 'Edm.String',
      key: true,
      searchable: false,
      filterable: true,
      sortable: false,
      facetable: false
    },
    {
      name: 'fileId',
      type: 'Edm.String',
      searchable: false,
      filterable: true,
      sortable: false,
      facetable: true
    },
    {
      name: 'userId',
      type: 'Edm.String',
      searchable: false,
      filterable: true, // Critical for multi-tenant isolation
      sortable: false,
      facetable: false
    },
    {
      name: 'content',
      type: 'Edm.String',
      searchable: true,
      filterable: false,
      sortable: false,
      facetable: false,
      analyzerName: 'standard.lucene' // Good default for general text
    },
    {
      name: 'contentVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 1536,
      vectorSearchProfileName: TEXT_PROFILE_NAME,
    },
    {
      name: 'chunkIndex',
      type: 'Edm.Int32',
      searchable: false,
      filterable: true,
      sortable: true,
      facetable: false
    },
    {
      name: 'tokenCount',
      type: 'Edm.Int32',
      searchable: false,
      filterable: true,
      sortable: true,
      facetable: false
    },
    {
      name: 'embeddingModel', // Added for cost tracking
      type: 'Edm.String',
      searchable: false,
      filterable: true,
      sortable: false,
      facetable: true
    },
    {
      name: 'createdAt',
      type: 'Edm.DateTimeOffset',
      searchable: false,
      filterable: true,
      sortable: true,
      facetable: false
    },

    // ===== NEW: Image Search Fields =====
    {
      name: 'imageVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 1024, // Azure Computer Vision VectorizeImage dimensions
      vectorSearchProfileName: IMAGE_PROFILE_NAME,
    },
    {
      name: 'isImage',
      type: 'Edm.Boolean',
      searchable: false,
      filterable: true, // Filter for image-only searches
      sortable: false,
      facetable: true
    },
  ],

  vectorSearch: {
    profiles: [
      {
        name: TEXT_PROFILE_NAME,
        algorithmConfigurationName: TEXT_ALGORITHM_NAME
      },
      {
        name: IMAGE_PROFILE_NAME,
        algorithmConfigurationName: IMAGE_ALGORITHM_NAME
      },
    ],
    algorithms: [
      {
        name: TEXT_ALGORITHM_NAME,
        kind: 'hnsw',
        parameters: {
          m: 4,               // Bi-directional links per node (lower = faster build, less precision)
          efConstruction: 400, // Size of dynamic candidate list during build
          efSearch: 500,       // Size of dynamic candidate list during search (higher = better recall)
          metric: 'cosine'
        }
      },
      {
        name: IMAGE_ALGORITHM_NAME,
        kind: 'hnsw',
        parameters: {
          m: 4,
          efConstruction: 400,
          efSearch: 500,
          metric: 'cosine'
        }
      },
    ]
  },

  // D26: Semantic Search Configuration for Reranking
  // Enables Azure AI Search Semantic Ranker to improve relevance
  // by understanding the semantic meaning of content.
  // Free tier: 1000 queries/month; Standard tier: unlimited (paid)
  semanticSearch: {
    defaultConfigurationName: SEMANTIC_CONFIG_NAME,
    configurations: [
      {
        name: SEMANTIC_CONFIG_NAME,
        prioritizedFields: {
          // Content field is primary for semantic understanding
          // For images, this now contains AI-generated captions (D26)
          contentFields: [
            { name: 'content' }
          ],
          // No title field in current schema, but could add fileName in future
        },
      },
    ],
  },
};
