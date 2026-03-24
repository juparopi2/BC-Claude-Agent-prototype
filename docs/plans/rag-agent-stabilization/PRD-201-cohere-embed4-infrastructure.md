# PRD-201: Cohere Embed 4 — Infrastructure & Index

**Phase**: 2 — Embedding Model
**Status**: Implemented (code complete — pending infrastructure deployment)
**Prerequisites**: PRD-200 (Tool Consolidation)
**Estimated Effort**: 2-3 days
**Created**: 2026-03-24
**Implemented**: 2026-03-24

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

> **Errata (2026-03-24)**: Azure AIServices exposes two separate embedding APIs. Text embeddings use the OpenAI-compatible endpoint (`/openai/deployments/embed-v-4-0/embeddings`). Image embeddings require the **Azure Foundry Models endpoint** (`/models/images/embeddings`) on a different domain (`*.services.ai.azure.com` instead of `*.cognitiveservices.azure.com`). The service auto-derives the image endpoint from `COHERE_ENDPOINT`. See `01-DEPLOYMENT-RUNBOOK.md` errata for full details.

```typescript
export class CohereEmbeddingService {
  /**
   * Generate embeddings for text content.
   * Uses input_type: 'search_document' for indexing, 'search_query' for queries.
   * On Azure: routes to OpenAI-compatible API (/openai/deployments/.../embeddings)
   */
  async embedText(text: string, inputType: 'search_document' | 'search_query'): Promise<number[]>;

  /**
   * Generate embeddings for an image.
   * Accepts base64-encoded image data.
   * On Azure: routes to Foundry Models API (/models/images/embeddings) — NOT OpenAI API.
   * On native Cohere: routes to /v2/embed with images parameter.
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

## 5. Complete File Inventory (Actual Implementation)

### New Files (4 source + 4 tests)

| File | Purpose |
|---|---|
| `backend/src/services/search/embeddings/types.ts` | `IEmbeddingService` interface, `EmbeddingInputType`, `EmbeddingResult` |
| `backend/src/services/search/embeddings/CohereEmbeddingService.ts` | Cohere Embed 4 client: text, image, interleaved, batch. Redis caching, usage tracking, latency logging. |
| `backend/src/services/search/embeddings/EmbeddingServiceFactory.ts` | `getUnifiedEmbeddingService()` singleton + `isUnifiedIndexEnabled()` gate. NOT class-based — function-based for simplicity. |
| `backend/src/services/search/schema-v2.ts` | `file-chunks-index-v2` schema: single `embeddingVector` (1536d), `hnsw-profile-unified`, semantic config. AML vectorizer deferred to PRD-203. |
| `backend/src/__tests__/unit/services/search/embeddings/CohereEmbeddingService.test.ts` | 15 unit tests (text, image, batch, cache, errors, rate limit) |
| `backend/src/__tests__/unit/services/search/embeddings/EmbeddingServiceFactory.test.ts` | 6 unit tests (flag routing, singleton, reset) |
| `backend/src/__tests__/unit/services/search/VectorSearchService.unified.test.ts` | 7 tests (routing, field selection, searchImages v1 constraint) |
| `backend/src/__tests__/unit/services/search/semantic/SemanticSearchService.unified.test.ts` | 7 tests (embedQuery, single vector, image filter, keyword, legacy regression) |

### Modified Files (7)

| File | Change |
|---|---|
| `backend/src/infrastructure/config/environment.ts` | Added `USE_UNIFIED_INDEX` (boolean, default false), `COHERE_ENDPOINT` (URL, optional), `COHERE_API_KEY` (optional) to Zod schema. |
| `backend/.env.example` | Added Cohere section with documentation. |
| `backend/src/services/search/VectorSearchService.ts` | Added `searchClientV2`, `getActiveSearchClient()`. All CRUD/search methods route by flag. `searchImages()` stays on v1 (1024d dimension safety). |
| `backend/src/services/search/semantic/SemanticSearchService.ts` | Added unified path: single `embedQuery()` call when flag=true. Added try/catch for graceful degradation (returns empty results on failure). |
| `infrastructure/bicep/modules/keyvault-secrets.bicep` | Added conditional `COHERE-ENDPOINT` and `COHERE-API-KEY` secrets. |
| `infrastructure/bicep/main.bicep` | Added `cohereEndpoint` and `cohereApiKey` parameters, passed to keyvault-secrets module. |
| `docs/plans/rag-agent-stabilization/01-DEPLOYMENT-RUNBOOK.md` | Created deployment runbook with PRD-201 section complete. |

### Not Modified (deviations from original spec)

| Original Spec | Actual | Reason |
|---|---|---|
| `backend/src/services/search/schema.ts` | Not modified | v1 schema kept exactly as-is. New schema in `schema-v2.ts`. |
| `backend/src/core/config.ts` | Not applicable | Config lives in `infrastructure/config/environment.ts` (correct location). |
| `infrastructure/bicep/modules/cognitive.bicep` | Not modified | Cohere deployed manually via Azure Portal (no ML workspace in Bicep yet). Secrets via `keyvault-secrets.bicep` instead. |
| AML vectorizer in schema-v2 | Deferred to PRD-203 | Requires infrastructure-specific params. Schema updated later via `createOrUpdateIndex()`. |

---

## 6. Success Criteria

### Infrastructure (pending manual deployment)

- [ ] Cohere Embed 4 deployed as serverless endpoint on Azure AI Foundry (dev environment)
- [ ] `COHERE_ENDPOINT` and `COHERE_API_KEY` in Key Vault
- [ ] Endpoint returns 1536d vectors for both text and image inputs
- [ ] Batch endpoint works for 100+ inputs per request

### Index (pending — created on first startup with flag=true)

- [ ] `file-chunks-index-v2` created in Azure AI Search (dev environment)
- [x] Single `embeddingVector` field (1536d, HNSW cosine) — defined in `schema-v2.ts`
- [ ] ~~Native AML vectorizer configured and functional~~ → Deferred to PRD-203
- [x] Semantic configuration applied — defined in `schema-v2.ts`
- [x] All filterable/sortable fields present (17 fields matching v1)

### Service (all complete — 2026-03-24)

- [x] `CohereEmbeddingService` passes unit tests for text, image, interleaved, and batch (15 tests)
- [x] `EmbeddingServiceFactory` returns correct implementation based on flag (6 tests)
- [x] `VectorSearchService` queries correct index based on flag (7 tests)
- [x] `SemanticSearchService` uses single Cohere embedding when unified (7 tests)
- [x] `USE_UNIFIED_INDEX=false` preserves all existing behavior (no regression — 4091 tests passing)
- [x] `npm run verify:types` passes (exit code 0)
- [x] `npm run -w backend lint` passes (0 errors)

### Additional (discovered during implementation)

- [x] `searchImages()` stays on v1 client to prevent 1024d/1536d dimension mismatch (until PRD-202)
- [x] `SemanticSearchService` has graceful degradation: try/catch returns empty results on embedding/search failure
- [x] Bicep templates updated: `keyvault-secrets.bicep` + `main.bicep` with conditional Cohere secrets

---

## 7. Out of Scope

- Re-embedding existing content (PRD-202)
- Production deployment of Cohere endpoint (PRD-202)
- Removing old index or OpenAI/Vision embedding code (PRD-202)
- Performance benchmarking Cohere vs. OpenAI (PRD-202 validation)
- Query-time vectorizer benchmarking (PRD-203)

---

## 8. Deployment Runbook

After implementing this PRD, update the deployment section in [01-DEPLOYMENT-RUNBOOK.md](./01-DEPLOYMENT-RUNBOOK.md) with actual commands, env vars, and verification steps.
