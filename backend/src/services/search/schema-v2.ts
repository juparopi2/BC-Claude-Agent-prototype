import type { SearchIndex } from '@azure/search-documents';
import { env } from '@/infrastructure/config/environment';

export const INDEX_NAME_V2 = 'file-chunks-index-v2';

/**
 * Unified vector profile name constant for use in code
 */
export const UNIFIED_PROFILE_NAME = 'hnsw-profile-unified';

/**
 * Unified algorithm name constant
 */
export const UNIFIED_ALGORITHM_NAME = 'hnsw-unified';

/**
 * Semantic configuration name for reranking
 */
export const SEMANTIC_CONFIG_NAME_V2 = 'semantic-config';

/**
 * Azure AI Search Index Schema v2.
 *
 * Supersedes v1 (file-chunks-index) as part of the Cohere Embed 4 migration (PRD-201).
 *
 * Key differences from v1:
 * - Single unified vector field `embeddingVector` (1536d) replaces the separate
 *   `contentVector` (1536d) and `imageVector` (1024d) fields.
 * - Single HNSW profile `hnsw-profile-unified` with algorithm `hnsw-unified`.
 * - AML vectorizer deferred to PRD-203.
 *
 * Both text and image chunks are indexed into the same 1536d vector space using
 * Cohere Embed 4, which produces a unified multimodal embedding.
 */
export const indexSchemaV2: SearchIndex = {
  name: INDEX_NAME_V2,
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
      vectorSearchDimensions: 1536, // Cohere Embed 4 unified 1536d space (text + image)
      vectorSearchProfileName: UNIFIED_PROFILE_NAME,
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
        name: UNIFIED_PROFILE_NAME,
        algorithmConfigurationName: UNIFIED_ALGORITHM_NAME,
        // PRD-203: Link to vectorizer for query-time vectorization (when configured)
        ...(process.env.COHERE_ENDPOINT ? { vectorizerName: 'cohere-vectorizer' } : {}),
      },
    ],
    algorithms: [
      {
        name: UNIFIED_ALGORITHM_NAME,
        kind: 'hnsw',
        parameters: {
          m: env.HNSW_M,                       // Bi-directional links per node (default: 4, proposed: 6 after benchmarking)
          efConstruction: env.HNSW_EF_CONSTRUCTION, // Size of dynamic candidate list during build (default: 400)
          efSearch: env.HNSW_EF_SEARCH,         // Size of dynamic candidate list during search (default: 500, proposed: 250)
          metric: 'cosine'
        }
      },
    ],
    // PRD-203: Native query-time vectorizer via Cohere Embed 4 (Azure AI Foundry)
    // Only included when Cohere endpoint is configured.
    // Enables `kind: 'text'` vector queries (Azure generates embeddings at query time).
    ...(process.env.COHERE_ENDPOINT ? {
      vectorizers: [
        {
          vectorizerName: 'cohere-vectorizer',
          kind: 'customWebApi' as const,
          parameters: {
            uri: `${process.env.COHERE_ENDPOINT}/v2/embed`,
            httpHeaders: {},
            httpMethod: 'POST',
          },
        },
      ],
    } : {}),
  },

  // Semantic Search Configuration for Reranking
  // Enables Azure AI Search Semantic Ranker to improve relevance
  // by understanding the semantic meaning of content.
  // Free tier: 1000 queries/month; Standard tier: unlimited (paid)
  semanticSearch: {
    defaultConfigurationName: SEMANTIC_CONFIG_NAME_V2,
    configurations: [
      {
        name: SEMANTIC_CONFIG_NAME_V2,
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
