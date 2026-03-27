# Search Services (Azure AI Search Integration)

## Purpose

Infrastructure services for **Azure AI Search** — handles vector indexing, hybrid search, semantic reranking, image search, and soft-delete synchronization. This directory is the system's interface to the external search index and is consumed by both the RAG agent (semantic search) and the file processing pipeline (indexing).

## Relationship to Other Directories

```
                    ┌─────────────────────────┐
                    │  modules/agents/rag-     │
                    │  knowledge               │
                    │  (RAG Agent)             │
                    └───────────┬──────────────┘
                                │ searchRelevantFiles()
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  services/search/                                                │
│  ┌──────────────────────┐     ┌────────────────────────────┐    │
│  │ SemanticSearchService│────►│ VectorSearchService        │    │
│  │ (orchestration)      │     │ (index CRUD + queries)     │    │
│  └──────────────────────┘     └─────────────┬──────────────┘    │
│                                             │                    │
│  schema.ts ─── Index schema definition      │                    │
│  types.ts ──── Shared type definitions      │                    │
└─────────────────────────────────────────────┼────────────────────┘
                                              │
                              ┌────────────────┼──────────────────┐
                              ▼                ▼                  ▼
                    Azure AI Search    EmbeddingService    FileService
                    (external)         (Cohere Embed v4)  (file metadata)

Upstream producers (write to index):
  services/files/FileChunkingService ──► indexChunksBatch()
  services/files/FileChunkingService ──► indexImageEmbedding()
  infrastructure/queue/EmbeddingGenerationWorker ──► indexChunksBatch()

Upstream consumers (soft delete sync):
  services/files/operations/SoftDeleteService ──► markFileAsDeleting()
  domains/files/deletion/FileDeletionProcessor ──► deleteChunksForFile()
```

## Directory Structure

| File / Directory | Purpose |
|---|---|
| `schema.ts` | Azure AI Search index schema definition (fields, vector profiles, semantic config) |
| `types.ts` | TypeScript interfaces: `SearchQuery`, `HybridSearchQuery`, `SemanticSearchQuery`, `SearchResult`, `ImageIndexParams`, etc. |
| `VectorSearchService.ts` | Singleton service for all Azure AI Search operations: CRUD, search, soft-delete sync |
| `semantic/SemanticSearchService.ts` | High-level orchestrator: generates embeddings → unified search → filter → group → enrich → sort |
| `semantic/types.ts` | Semantic search types: `SemanticSearchOptions`, `SemanticSearchResult`, `SemanticSearchResponse`, constants |
| `semantic/index.ts` | Barrel exports |

## Index Schema (`schema.ts`)

Index name: `file-chunks-index-v2` (constant: `INDEX_NAME`)

### Fields

| Field | Type | Key | Filterable | Searchable | Purpose |
|---|---|---|---|---|---|
| `chunkId` | Edm.String | **Yes** | Yes | No | Primary key (UPPERCASE UUID or `img_` prefix for images) |
| `fileId` | Edm.String | No | Yes | No | Parent file reference |
| `userId` | Edm.String | No | Yes | No | **Multi-tenant isolation** (always filtered) |
| `content` | Edm.String | No | No | Yes | Text chunk or `[Image: filename]` marker (`standard.lucene` analyzer) |
| `imageCaption` | Edm.String | No | No | No | AI-generated caption (non-searchable, stored for LLM context) |
| `embeddingVector` | Collection(Edm.Single) | No | No | Yes | Unified embedding (1536d, Cohere Embed v4) — used for all content (text and images) |
| `chunkIndex` | Edm.Int32 | No | Yes | No | Position within file |
| `tokenCount` | Edm.Int32 | No | Yes | No | Token count for billing |
| `embeddingModel` | Edm.String | No | Yes | No | Model used (cost tracking) |
| `createdAt` | Edm.DateTimeOffset | No | Yes | No | Creation timestamp |
| `isImage` | Edm.Boolean | No | Yes | No | Image flag for filtered queries |
| `mimeType` | Edm.String | No | Yes | No | File MIME type for RAG filtered search |
| `fileStatus` | Edm.String | No | Yes | No | `'active'` or `'deleting'` (soft-delete support) |

### Vector Profiles

| Profile | Algorithm | Dimensions | Metric | Use Case |
|---|---|---|---|---|
| `VECTOR_PROFILE_NAME` | HNSW (configurable via env) | 1536 | Cosine | All content (text + images in unified vector space) |

A single `embeddingVector` field (1536d, Cohere Embed v4) covers both text and image retrieval. Text queries retrieve relevant documents and images in the same search call.

### Semantic Configuration

Name: `semantic-config`. Uses Azure AI Search Semantic Ranker to rerank results by semantic meaning. Content field: `content`. Pricing: Free tier = 1000 queries/month; Standard = unlimited (paid).

**Image mode**: Semantic Ranker is **disabled** for image-type searches (`useSemanticRanker: !isImageMode` in `SemanticSearchService`). The `content` field for images only contains `[Image: filename]` — text-based reranking is not useful. The 1536d Cohere Embed v4 vector handles all visual semantic retrieval.

**PRD-203 Extractive Features** (always requested when semantic ranker is ON):
- **Extractive Answers**: Direct answers to questions, extracted from document content. Returns up to 3 answers with confidence scores. Available at top-level `SemanticSearchFullResult.extractiveAnswers`.
- **Extractive Captions**: Highlighted snippets per result with `<em>` tags. Available per-result as `captionText`/`captionHighlights`.
- **Response Format Control**: `responseDetail: 'concise'` returns 1 passage/doc with short excerpts (~65% token reduction).

### Query-Time Vectorization

Azure AI Search generates embeddings at query time via the native Cohere vectorizer configured in `schema.ts`. The application sends `kind: 'text'` vector queries with the raw query string — no app-side embedding generation needed for search queries. The vectorizer is configured as `aml` kind (Azure Machine Learning / Foundry model catalog) pointing to the Cohere Embed v4 deployment.

**API Version Requirement**: The `aml` vectorizer kind is a **preview feature**. Query-time vectorization against `aml` vectorizers requires a preview API version (`2025-08-01-preview`). The stable `2025-09-01` API rejects these queries with: *"Vectorization of queries against fields using the 'aml' vectorizer kind is not supported in the current api version."* `VectorSearchService` overrides the SDK default via `serviceVersion: '2025-08-01-preview'`.

Note: `CohereEmbeddingService` is still used for **indexing** (generating embeddings for new file chunks and images). Only search query embedding is handled by Azure AI Search natively.

### Configurable HNSW Parameters (PRD-203 F5)

HNSW algorithm parameters and the search fetch multiplier are configurable via environment variables:

| Env Var | Default | Type | Description |
|---|---|---|---|
| `HNSW_M` | 4 | Build-time | Bi-directional links per node. Requires index recreation to take effect. |
| `HNSW_EF_CONSTRUCTION` | 400 | Build-time | Candidate list size during index build. Requires index recreation. |
| `HNSW_EF_SEARCH` | 500 | Query-time | Candidate list size during search. Takes effect immediately. |
| `SEARCH_FETCH_MULTIPLIER` | 3 | App-side | `fetchTopK = maxFiles * maxChunksPerFile * multiplier`. Lower = fewer candidates, faster. |

**Tuning guidance:** Run `npx tsx scripts/operations/benchmark-search.ts` before changing values. Proposed targets after benchmarking: `HNSW_EF_SEARCH=250`, `HNSW_M=6`, `SEARCH_FETCH_MULTIPLIER=2`.

## Search Modes

### 1. Vector Search (`VectorSearchService.search()`)
Pure vector similarity on `embeddingVector` field. Used for direct embedding-based retrieval.

### 2. Hybrid Search (`VectorSearchService.hybridSearch()`)
Combines keyword search (`text` parameter via Lucene) with vector search on `embeddingVector`. Both signals contribute to scoring.

### 3. Semantic Search (`VectorSearchService.semanticSearch()`)
The primary search mode (D26). Combines:
- `embeddingVector` search (1536d Cohere Embed v4) — embedding generated by Azure AI Search at query time via the native vectorizer (no app-side call)
- Keyword search via `text` parameter
- Azure Semantic Ranker reranking (score 0–4, normalized to 0–1)

Parameters: `fetchTopK` (candidates before reranking, default 30), `finalTopK` (results after reranking, default 10).

### 4. Image Search (`VectorSearchService.searchImages()`)
Pure vector search on `embeddingVector` field, filtered to `isImage eq true`. Returns `ImageSearchResult[]` using the indexed `fileName` field.

### 5. Image Mode via `search_knowledge` (`SemanticSearchService`)
When the RAG agent searches with `fileTypeCategory: "images"`, the service sets `useSemanticRanker: false` and uses `searchText: '*'` (skip BM25). This produces **pure vector search** — the Cohere Embed v4 vector handles all visual semantic retrieval without text-based signal contamination.

## Image Embedding Architecture

Image embeddings use **Cohere Embed v4** in the same 1536d unified vector space as text. This means a single text query can retrieve both documents and images simultaneously.

### Dual-Endpoint on Azure AIServices

Azure exposes two separate APIs on the same resource:

| API | Domain | Path | Used For |
|-----|--------|------|----------|
| OpenAI-compatible | `*.cognitiveservices.azure.com` | `/openai/deployments/embed-v-4-0/embeddings` | Text embeddings |
| Foundry Models | `*.services.ai.azure.com` | `/models/images/embeddings?api-version=2024-05-01-preview` | Image embeddings |

`CohereEmbeddingService` auto-derives the image endpoint by replacing the domain. Override via `COHERE_IMAGE_ENDPOINT` env var.

### Pipeline Flow (Image Files)

```
ImageProcessor.extractText()
  ├── cohereService.embedImage(base64) → callAzureImageApi() → 1536d visual embedding
  └── captionService.generateCaption() → caption text (stored separately, not in searchable content)
      ↓
FileChunkingService.indexImageEmbedding()
  └── VectorSearchService.indexImageEmbedding()
      ├── embeddingVector: 1536d (Cohere) — handles all visual retrieval
      ├── content: "[Image: filename]" — minimal marker only (NOT caption)
      ├── imageCaption: caption text — non-searchable, passed to LLM for context
      └── embeddingModel: 'Cohere-embed-v4'
```

**Design rationale**: AI-generated captions (e.g., "a chart with blue bars") are too generic for keyword matching and can contaminate BM25/Semantic Ranker scores. The 1536d Cohere Embed v4 vector captures visual semantics directly from pixels — far more accurate. The caption is preserved in `imageCaption` for LLM context only.

### Key Constraint
The OpenAI-compatible embedding endpoint does **NOT** accept image input. Sending base64 data URIs as text produces garbage embeddings. `transformRequestForAzure()` now throws an error if images are passed through the text endpoint as a safety net.

## SemanticSearchService Orchestration

`searchRelevantFiles(options)` is the main entry point used by the RAG agent:

```
1. Execute unified semantic search (D26)
   └── VectorSearchService.semanticSearch() with kind: 'text' query
       (Azure AI Search generates the embedding at query time via native vectorizer)
       (images are retrieved in the same search — same vector space)

2. Filter excluded files (excludeFileIds)

3. Group results by fileId
   ├── Text files: accumulate chunks, track max score
   └── Image files: single entry with imageCaption for LLM context

4. Enrich with file metadata (FileService.getFile())

5. Sort by relevance score, limit to maxFiles
```

### Default Configuration

| Parameter | Default | Description |
|---|---|---|
| `SEMANTIC_THRESHOLD` | 0.55 | Minimum score to include result |
| `DEFAULT_MAX_FILES` | 10 | Maximum files returned |
| `DEFAULT_MAX_CHUNKS_PER_FILE` | 5 | Maximum chunks per text file |

## Multi-Tenant Security

Every search query **always** includes a `userId` filter. This is enforced at the `VectorSearchService` level — there is no way to bypass it.

```
userId eq '{NORMALIZED_USER_ID}' and (fileStatus ne 'deleting' or fileStatus eq null)
```

- `normalizeUserId()` converts to UPPERCASE before every query (project convention)
- Soft-deleted files are excluded via `fileStatus` filter
- Image search adds `isImage eq true`

## Soft Delete Integration

The 3-phase soft delete flow uses `VectorSearchService` at phases 2 and 3:

| Phase | Method | What Happens |
|---|---|---|
| Phase 1 (DB) | — | `SoftDeleteService` marks files in SQL with `deletion_status='pending'` |
| Phase 2 (Search) | `markFileAsDeleting(fileId, userId)` | Updates `fileStatus` to `'deleting'` via `mergeDocuments()` — files excluded from RAG |
| Phase 3 (Worker) | `deleteChunksForFile(fileId, userId)` | Physically deletes all documents for file from index |

`markFileAsDeleting()` processes in batches of 1000 (Azure Search limit) and queries both uppercase and lowercase `fileId` for legacy data compatibility.

## Orphan Detection (D22/D23)

| Method | Purpose |
|---|---|
| `getUniqueFileIds(userId)` | Returns all unique fileIds in AI Search for a user (for orphan detection) |
| `countDocumentsForFile(fileId, userId)` | Counts documents for verification after deletion (should return 0) |

## Usage Tracking

All search methods call `trackSearchUsage()` (fire-and-forget) to record usage for billing:
- Tracks search type (`'vector'`, `'hybrid'`, `'semantic'`), result count, and `topK`
- Query embedding cost is tracked separately in `CohereEmbeddingService`

## Key Patterns

1. **Singleton + Lazy Init**: `VectorSearchService.getInstance()` with lazy client initialization via `initializeClients()`
2. **Dual-Case File ID Queries**: All deletion/counting queries check both `fileId.toUpperCase()` and `fileId.toLowerCase()` for legacy data compatibility
3. **Fire-and-Forget Usage Tracking**: `.catch()` on tracking calls — billing failures never fail searches
4. **Graceful Image Fallback**: `SemanticSearchService` catches image embedding failures and continues with text-only search

## Troubleshooting

### Files Not Appearing in Search
1. Verify `embedding_status = 'completed'` in `files` table
2. Check that `chunkId` exists in Azure AI Search index (`file-chunks-index-v2`)
3. Confirm `userId` matches (UPPERCASE) in both DB and index
4. Check `fileStatus` is `'active'` (not `'deleting'`)

### Orphan Documents in Search
1. Run `getUniqueFileIds(userId)` to list all indexed files
2. Cross-reference with `files` table to find orphans
3. Use `deleteChunksForFile()` to remove orphaned documents

### Image Search Not Working
1. Verify `embeddingVector` field exists in index (run `updateIndexSchema()`)
2. Check `isImage = true` flag on indexed image documents
3. Confirm Cohere Embed v4 API (`COHERE_ENDPOINT`) is accessible
4. Check that image embedding was persisted in `ImageEmbeddingRepository`
5. Verify the Azure image embedding endpoint is reachable (auto-derived from `COHERE_ENDPOINT`, or override via `COHERE_IMAGE_ENDPOINT`)

## Cross-References

- **Indexing producers**: `services/files/CLAUDE.md` — FileChunkingService, EmbeddingGenerationWorker
- **Domain orchestration**: `domains/files/CLAUDE.md` — File lifecycle and queue pipeline
- **Queue workers**: `infrastructure/queue/workers/` — EmbeddingGenerationWorker, FileChunkingWorker
