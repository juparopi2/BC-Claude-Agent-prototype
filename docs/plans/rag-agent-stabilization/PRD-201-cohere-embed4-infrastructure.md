# PRD-201: Cohere Embed 4 — Infrastructure & Index

**Phase**: 2 — Embedding Model
**Status**: Proposed
**Prerequisites**: PRD-200 (Tool Consolidation)
**Estimated Effort**: 2-3 days
**Created**: 2026-03-24

---

## 1. Objective

Deploy Cohere Embed 4 as a serverless endpoint on Azure AI Foundry, create a new Azure AI Search index with a single unified vector field (1536d), and refactor the embedding service to use Cohere for all embedding generation. This phase sets up the infrastructure; actual data migration happens in PRD-202.

### Why Cohere Embed 4

| Current Stack | Cohere Embed 4 |
|---|---|
| text-embedding-3-small (1536d) for text | Single model for text + images |
| Azure Vision (1024d) for images | Same 1536d vector space |
| Two vector fields, two HNSW profiles | One vector field, one HNSW profile |
| searchMode routing (text vs. image) | No routing needed — same field |
| $0.02/1M tok (text) + Azure Vision pricing | $0.12/1M tok (all modalities) |

---

## 2. Current State (After PRD-200)

- **Embedding models**: text-embedding-3-small (OpenAI, 1536d) + Azure Computer Vision (1024d)
- **Index fields**: `contentVector` (1536d) + `imageVector` (1024d)
- **HNSW profiles**: `hnsw-profile` (text) + `hnsw-profile-image` (image)
- **Embedding service**: `EmbeddingService` generates text embeddings via OpenAI; `ImageEmbeddingService` generates image embeddings via Azure Vision
- **VectorSearchService**: Builds dual vector queries with per-mode weights
- **Tools**: `search_knowledge` (power tool) + `find_similar_images` (image reference)

---

## 3. Expected State (After This PRD)

- **Embedding model**: Cohere Embed 4 (serverless endpoint on Azure AI Foundry)
- **New index**: `file-chunks-index-v2` with single `embeddingVector` field (1536d)
- **HNSW profile**: Single `hnsw-profile-unified`
- **Embedding service**: Unified `CohereEmbeddingService` for text and images
- **Vectorizer**: Native AML vectorizer on the new index for query-time vectorization
- **Old index**: `file-chunks-index` untouched and still serving production
- **Feature flag**: `USE_UNIFIED_INDEX` controls which index is queried

---

## 4. Detailed Specifications

### 4.1 Azure AI Foundry Deployment

Deploy Cohere Embed 4 as a serverless model from the Azure AI Foundry model catalog:

```
Model: Cohere-embed-v4
Registry: azureml://registries/azureml-cohere/models/Cohere-embed-v4
Deployment type: Serverless (pay-per-token)
Region: Same as existing resources
```

**Configuration**:
- Input types: `search_document` (for indexing), `search_query` (for query-time)
- Embedding types: `float` (default)
- Truncate: `END` (truncate input if exceeds context window)
- Dimensions: `1536` (match current text field)

**Environment variables** (added to Key Vault):
- `COHERE_ENDPOINT`: Azure AI Foundry endpoint URL
- `COHERE_API_KEY`: API key for the serverless deployment

### 4.2 New Index Schema: `file-chunks-index-v2`

```typescript
const indexSchema = {
  name: 'file-chunks-index-v2',
  fields: [
    // Key & identity (unchanged)
    { name: 'chunkId', type: 'Edm.String', key: true, filterable: true },
    { name: 'fileId', type: 'Edm.String', filterable: true, searchable: false },
    { name: 'userId', type: 'Edm.String', filterable: true, searchable: false },

    // Content
    { name: 'content', type: 'Edm.String', searchable: true, analyzer: 'standard.lucene' },
    { name: 'fileName', type: 'Edm.String', searchable: true, filterable: true },

    // Metadata
    { name: 'mimeType', type: 'Edm.String', filterable: true },
    { name: 'isImage', type: 'Edm.Boolean', filterable: true },
    { name: 'fileStatus', type: 'Edm.String', filterable: true },
    { name: 'fileModifiedAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
    { name: 'parentFolderId', type: 'Edm.String', filterable: true },
    { name: 'chunkIndex', type: 'Edm.Int32', sortable: true },

    // UNIFIED vector field (replaces contentVector + imageVector)
    {
      name: 'embeddingVector',
      type: 'Collection(Edm.Single)',
      searchable: true,
      dimensions: 1536,
      vectorSearchProfile: 'hnsw-profile-unified',
    },
  ],

  vectorSearch: {
    algorithms: [
      {
        name: 'hnsw-unified',
        kind: 'hnsw',
        hnswParameters: {
          m: 4,
          efConstruction: 400,
          efSearch: 500,
          metric: 'cosine',
        },
      },
    ],
    profiles: [
      {
        name: 'hnsw-profile-unified',
        algorithm: 'hnsw-unified',
        vectorizer: 'cohere-vectorizer',
      },
    ],
    vectorizers: [
      {
        name: 'cohere-vectorizer',
        kind: 'aml',
        amlParameters: {
          uri: '${COHERE_ENDPOINT}',
          modelName: 'Cohere-embed-v4',
          resourceId: '${AML_RESOURCE_ID}',
          region: '${AZURE_REGION}',
        },
      },
    ],
  },

  semantic: {
    configurations: [
      {
        name: 'semantic-config',
        prioritizedFields: {
          contentFields: [{ fieldName: 'content' }],
          titleFields: [{ fieldName: 'fileName' }],
        },
      },
    ],
  },
};
```

**Key differences from `file-chunks-index`:**

| Aspect | v1 (current) | v2 (new) |
|---|---|---|
| Vector fields | `contentVector` (1536d) + `imageVector` (1024d) | `embeddingVector` (1536d) |
| HNSW profiles | 2 (text + image) | 1 (unified) |
| Vectorizer | None (pre-computed only) | Native AML (Cohere Embed 4) |
| Text + image in same space | No | Yes |

### 4.3 Embedding Service Refactor

#### New: `CohereEmbeddingService`

```typescript
export class CohereEmbeddingService {
  /**
   * Generate embeddings for text content.
   * Uses input_type: 'search_document' for indexing, 'search_query' for queries.
   */
  async embedText(text: string, inputType: 'search_document' | 'search_query'): Promise<number[]>;

  /**
   * Generate embeddings for an image.
   * Accepts base64-encoded image data.
   * Uses Cohere's interleaved input format.
   */
  async embedImage(imageBase64: string, inputType: 'search_document' | 'search_query'): Promise<number[]>;

  /**
   * Generate embeddings for mixed content (text + image).
   * Ideal for documents with embedded charts/diagrams.
   */
  async embedInterleaved(
    content: Array<{ type: 'text'; text: string } | { type: 'image'; base64: string }>,
    inputType: 'search_document' | 'search_query',
  ): Promise<number[]>;

  /**
   * Batch embedding for multiple inputs.
   * Uses Cohere's batch API for cost efficiency.
   */
  async embedBatch(
    inputs: Array<{ text?: string; imageBase64?: string }>,
    inputType: 'search_document' | 'search_query',
  ): Promise<number[][]>;
}
```

#### Update: `EmbeddingServiceFactory`

Factory pattern to switch between old (OpenAI + Vision) and new (Cohere) based on feature flag:

```typescript
export class EmbeddingServiceFactory {
  static create(): IEmbeddingService {
    if (config.USE_UNIFIED_INDEX) {
      return new CohereEmbeddingService();
    }
    return new LegacyEmbeddingService(); // existing OpenAI + Vision
  }
}
```

### 4.4 VectorSearchService Updates

When `USE_UNIFIED_INDEX` is enabled:

```typescript
// Before (dual vector queries)
vectorQueries: [
  { vector: textEmbedding, fields: 'contentVector', weight: 1.0 },
  { vector: imageEmbedding, fields: 'imageVector', weight: 0.5 },
]

// After (single vector query)
vectorQueries: [
  { vector: cohereEmbedding, fields: 'embeddingVector', weight: 1.0 },
]
```

With the native vectorizer, query-time vectorization becomes possible:

```typescript
// Alternative: let Azure AI Search vectorize the query
vectorQueries: [
  { kind: 'text', text: queryText, fields: 'embeddingVector', weight: 1.0 },
]
```

### 4.5 Feature Flag

```typescript
// backend/src/core/config.ts
USE_UNIFIED_INDEX: z.boolean().default(false).describe(
  'When true, queries use file-chunks-index-v2 (Cohere Embed 4, unified vector field). ' +
  'When false, queries use file-chunks-index (OpenAI + Vision, dual vector fields).'
),
```

**Deployment strategy**: Set `USE_UNIFIED_INDEX=false` in both dev and prod initially. Enable in dev first for testing. Enable in prod after PRD-202 completes re-embedding.

---

## 5. Complete File Inventory

### New Files (4)

| File | Purpose |
|---|---|
| `backend/src/services/search/embeddings/CohereEmbeddingService.ts` | Cohere Embed 4 client: text, image, interleaved, and batch embedding |
| `backend/src/services/search/embeddings/EmbeddingServiceFactory.ts` | Factory: returns Cohere or Legacy based on feature flag |
| `backend/src/services/search/embeddings/types.ts` | `IEmbeddingService` interface shared by Cohere and Legacy implementations |
| `backend/src/services/search/schema-v2.ts` | New index schema definition (unified vector field, AML vectorizer) |

### Modified Files (5)

| File | Change |
|---|---|
| `backend/src/services/search/VectorSearchService.ts` | Add index routing (v1 vs v2). Simplify vector queries when unified index. Support native vectorizer queries. |
| `backend/src/services/search/semantic/SemanticSearchService.ts` | Use `EmbeddingServiceFactory`. Single embedding call instead of dual. Remove image embedding fallback logic. |
| `backend/src/services/search/schema.ts` | Extract shared field definitions. Keep v1 schema as-is. |
| `backend/src/core/config.ts` | Add `USE_UNIFIED_INDEX` and `COHERE_ENDPOINT` / `COHERE_API_KEY` env vars. |
| `infrastructure/bicep/modules/cognitive.bicep` | Add Cohere Embed 4 serverless deployment to AI Foundry. |

---

## 6. Success Criteria

### Infrastructure

- [ ] Cohere Embed 4 deployed as serverless endpoint on Azure AI Foundry (dev environment)
- [ ] `COHERE_ENDPOINT` and `COHERE_API_KEY` in Key Vault
- [ ] Endpoint returns 1536d vectors for both text and image inputs
- [ ] Batch endpoint works for 100+ inputs per request

### Index

- [ ] `file-chunks-index-v2` created in Azure AI Search (dev environment)
- [ ] Single `embeddingVector` field (1536d, HNSW cosine)
- [ ] Native AML vectorizer configured and functional
- [ ] Semantic configuration applied
- [ ] All filterable/sortable fields present

### Service

- [ ] `CohereEmbeddingService` passes unit tests for text, image, interleaved, and batch
- [ ] `EmbeddingServiceFactory` returns correct implementation based on flag
- [ ] `VectorSearchService` queries correct index based on flag
- [ ] `USE_UNIFIED_INDEX=false` preserves all existing behavior (no regression)
- [ ] `npm run verify:types` passes
- [ ] `npm run -w backend lint` passes

---

## 7. Out of Scope

- Re-embedding existing content (PRD-202)
- Production deployment of Cohere endpoint (PRD-202)
- Removing old index or OpenAI/Vision embedding code (PRD-202)
- Performance benchmarking Cohere vs. OpenAI (PRD-202 validation)
- Query-time vectorizer benchmarking (PRD-203)
