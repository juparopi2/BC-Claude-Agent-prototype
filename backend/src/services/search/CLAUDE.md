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
                    (external)         (OpenAI/Vision)    (file metadata)

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

Index name: `file-chunks-index`

### Fields

| Field | Type | Key | Filterable | Searchable | Purpose |
|---|---|---|---|---|---|
| `chunkId` | Edm.String | **Yes** | Yes | No | Primary key (UPPERCASE UUID or `img_` prefix for images) |
| `fileId` | Edm.String | No | Yes | No | Parent file reference |
| `userId` | Edm.String | No | Yes | No | **Multi-tenant isolation** (always filtered) |
| `content` | Edm.String | No | No | Yes | Text chunk or image caption (`standard.lucene` analyzer) |
| `contentVector` | Collection(Edm.Single) | No | No | Yes | Text embedding (1536d, OpenAI text-embedding-3-small) |
| `imageVector` | Collection(Edm.Single) | No | No | Yes | Image embedding (1024d, Azure Computer Vision) |
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
| `hnsw-profile` | HNSW (`m=4`, `efConstruction=400`, `efSearch=500`) | 1536 | Cosine | Text chunk search |
| `hnsw-profile-image` | HNSW (`m=4`, `efConstruction=400`, `efSearch=500`) | 1024 | Cosine | Image similarity search |

### Semantic Configuration

Name: `semantic-config`. Uses Azure AI Search Semantic Ranker to rerank results by semantic meaning. Content field: `content`. Pricing: Free tier = 1000 queries/month; Standard = unlimited (paid).

## Search Modes

### 1. Vector Search (`VectorSearchService.search()`)
Pure vector similarity on `contentVector` field. Used for direct embedding-based retrieval.

### 2. Hybrid Search (`VectorSearchService.hybridSearch()`)
Combines keyword search (`text` parameter via Lucene) with vector search on `contentVector`. Both signals contribute to scoring.

### 3. Semantic Search (`VectorSearchService.semanticSearch()`)
The primary search mode (D26). Combines:
- Text embedding → `contentVector` search
- Image embedding → `imageVector` search (optional)
- Keyword search via `text` parameter
- Azure Semantic Ranker reranking (score 0–4, normalized to 0–1)

Parameters: `fetchTopK` (candidates before reranking, default 30), `finalTopK` (results after reranking, default 10).

### 4. Image Search (`VectorSearchService.searchImages()`)
Pure vector search on `imageVector` field, filtered to `isImage eq true`. Returns `ImageSearchResult[]` with extracted file names from content.

## SemanticSearchService Orchestration

`searchRelevantFiles(options)` is the main entry point used by the RAG agent:

```
1. Generate embeddings in parallel
   ├── Text embedding (1536d) via EmbeddingService
   └── Image query embedding (1024d) via EmbeddingService (optional, non-fatal)

2. Execute unified semantic search (D26)
   └── VectorSearchService.semanticSearch() with text + image embeddings

3. Filter excluded files (excludeFileIds)

4. Group results by fileId
   ├── Text files: accumulate chunks, track max score
   └── Image files: single entry with caption content

5. Enrich with file metadata (FileService.getFile())

6. Sort by relevance score, limit to maxFiles
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
- Query embedding cost is tracked separately in `EmbeddingService`

## Key Patterns

1. **Singleton + Lazy Init**: `VectorSearchService.getInstance()` with lazy client initialization via `initializeClients()`
2. **Dual-Case File ID Queries**: All deletion/counting queries check both `fileId.toUpperCase()` and `fileId.toLowerCase()` for legacy data
3. **Fire-and-Forget Usage Tracking**: `.catch()` on tracking calls — billing failures never fail searches
4. **Graceful Image Fallback**: `SemanticSearchService` catches image embedding failures and continues with text-only search

## Troubleshooting

### Files Not Appearing in Search
1. Verify `embedding_status = 'completed'` in `files` table
2. Check that `chunkId` exists in Azure AI Search index
3. Confirm `userId` matches (UPPERCASE) in both DB and index
4. Check `fileStatus` is `'active'` (not `'deleting'`)

### Orphan Documents in Search
1. Run `getUniqueFileIds(userId)` to list all indexed files
2. Cross-reference with `files` table to find orphans
3. Use `deleteChunksForFile()` to remove orphaned documents

### Image Search Not Working
1. Verify `imageVector` field exists in index (run `updateIndexSchema()`)
2. Check `isImage = true` flag on indexed image documents
3. Confirm Azure Computer Vision API is accessible
4. Check that image embedding was persisted in `ImageEmbeddingRepository`

## Cross-References

- **Indexing producers**: `services/files/CLAUDE.md` — FileChunkingService, EmbeddingGenerationWorker
- **Domain orchestration**: `domains/files/CLAUDE.md` — File lifecycle and queue pipeline
- **Queue workers**: `infrastructure/queue/workers/` — EmbeddingGenerationWorker, FileChunkingWorker
