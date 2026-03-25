import type { SearchIndex } from '@azure/search-documents';
import { env } from '@/infrastructure/config/environment';
import { COHERE_DEPLOYMENT_NAME, COHERE_EMBEDDING_DIMENSIONS } from './embeddings/models';

export const INDEX_NAME = 'file-chunks-index-v2';

/**
 * Vector profile name constant for use in code
 */
export const VECTOR_PROFILE_NAME = 'hnsw-profile-unified';

/**
 * Algorithm name constant
 */
export const VECTOR_ALGORITHM_NAME = 'hnsw-unified';

/**
 * Semantic configuration name for reranking
 */
export const SEMANTIC_CONFIG_NAME = 'semantic-config';

/**
 * Azure AI Search Index Schema Definition.
 *
 * Uses a single unified vector field `embeddingVector` (1536d) for both text and image content,
 * powered by Cohere Embed 4 which produces a unified multimodal embedding.
 *
 * Both text and image chunks share the same 1536d vector space, enabling cross-modal search.
 */
export const indexSchema: SearchIndex = {
  name: INDEX_NAME,
  fields: [
    // ===== Identity / Key =====
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
    // ===== Content =====
    {
      name: 'content',
      type: 'Edm.String',
      searchable: true,
      filterable: false,
      sortable: false,
      facetable: false,
      analyzerName: 'standard.lucene'
    },
    // ===== Unified Vector Field =====
    {
      name: 'embeddingVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      stored: true,
      hidden: false, // Retrievable in getDocument/search results (for verification scripts)
      vectorSearchDimensions: COHERE_EMBEDDING_DIMENSIONS,
      vectorSearchProfileName: VECTOR_PROFILE_NAME,
    },
    // ===== Chunk Metadata =====
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
      name: 'embeddingModel',
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
    // ===== Image Metadata =====
    {
      name: 'isImage',
      type: 'Edm.Boolean',
      searchable: false,
      filterable: true, // Filter for image-only searches
      sortable: false,
      facetable: true
    },
    {
      name: 'mimeType',
      type: 'Edm.String',
      searchable: false,
      filterable: true,  // For file type filtering (RAG filtered search)
      sortable: false,
      facetable: true,   // For analytics
    },
    // ===== Soft Delete Support =====
    {
      name: 'fileStatus',
      type: 'Edm.String',
      searchable: false,
      filterable: true, // Critical for excluding deleted files from searches
      sortable: false,
      facetable: true,
      // Values: 'active' (default), 'deleting'
    },
    // ===== File Metadata =====
    {
      name: 'fileModifiedAt',
      type: 'Edm.DateTimeOffset',
      searchable: false,
      filterable: true,
      sortable: true,
      facetable: false,
    },
    {
      name: 'fileName',
      type: 'Edm.String',
      searchable: true,
      filterable: true,
      sortable: false,
      facetable: false,
      analyzerName: 'standard.lucene',
    },
    {
      name: 'sizeBytes',
      type: 'Edm.Int32',
      searchable: false,
      filterable: true,
      sortable: true,
      facetable: false,
    },
    // ===== Source Metadata =====
    {
      name: 'siteId',
      type: 'Edm.String',
      searchable: false,
      filterable: true,  // For filtering by SharePoint site
      sortable: false,
      facetable: true,   // For analytics / scope navigation
    },
    {
      name: 'sourceType',
      type: 'Edm.String',
      searchable: false,
      filterable: true,  // For filtering by source (local, onedrive, sharepoint)
      sortable: false,
      facetable: true,   // For analytics / source breakdown
    },
    {
      name: 'parentFolderId',
      type: 'Edm.String',
      searchable: false,
      filterable: true,  // For scoping search to a specific folder
      sortable: false,
      facetable: false,
    },
  ],

  vectorSearch: {
    profiles: [
      {
        name: VECTOR_PROFILE_NAME,
        algorithmConfigurationName: VECTOR_ALGORITHM_NAME,
        vectorizerName: 'cohere-vectorizer',
      },
    ],
    algorithms: [
      {
        name: VECTOR_ALGORITHM_NAME,
        kind: 'hnsw',
        parameters: {
          m: env.HNSW_M,                       // Bi-directional links per node (default: 4, proposed: 6 after benchmarking)
          efConstruction: env.HNSW_EF_CONSTRUCTION, // Size of dynamic candidate list during build (default: 400)
          efSearch: env.HNSW_EF_SEARCH,         // Size of dynamic candidate list during search (default: 500, proposed: 250)
          metric: 'cosine'
        }
      },
    ],
    // Query-time vectorizer: Azure AI Search generates embeddings via Cohere Embed v4
    // at query time. Enables `kind: 'text'` vector queries (no app-side embedding needed).
    vectorizers: [
      {
        vectorizerName: 'cohere-vectorizer',
        kind: 'azureOpenAI' as const,
        parameters: {
          resourceUrl: env.COHERE_ENDPOINT,
          deploymentId: COHERE_DEPLOYMENT_NAME,
          modelName: COHERE_DEPLOYMENT_NAME,
          apiKey: env.COHERE_API_KEY,
        },
      },
    ],
  },

  // Semantic Search Configuration for Reranking
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
          // For images, this contains AI-generated captions
          contentFields: [
            { name: 'content' }
          ],
        },
      },
    ],
  },
};
