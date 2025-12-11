import { SearchIndex } from '@azure/search-documents';

export const INDEX_NAME = 'file-chunks-index';

/**
 * Azure AI Search Index Schema Definition.
 * Configured for HNSW vector search with 1536 dimensions (OpenAI text-embedding-3-small).
 */
export const indexSchema: SearchIndex = {
  name: INDEX_NAME,
  fields: [
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
      analyzerName: 'standard.lucence' // Good default for general text
    },
    {
      name: 'contentVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      vectorSearchDimensions: 1536,
      vectorSearchProfileName: 'hnsw-profile',
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
    }
  ],
  vectorSearch: {
    profiles: [
      {
        name: 'hnsw-profile',
        algorithmConfigurationName: 'hnsw-algorithm'
      }
    ],
    algorithms: [
      {
        name: 'hnsw-algorithm',
        kind: 'hnsw',
        parameters: {
          m: 4,               // Bi-directional links per node (lower = faster build, less precision)
          efConstruction: 400, // Size of dynamic candidate list during build
          efSearch: 500,       // Size of dynamic candidate list during search (higher = better recall)
          metric: 'cosine'
        }
      }
    ]
  }
};
