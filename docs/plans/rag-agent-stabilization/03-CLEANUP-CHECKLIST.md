# Post-Cutover Cleanup Checklist

**When to execute**: 30 days after `USE_UNIFIED_INDEX=true` in production with no rollback needed.

**Purpose**: Remove the legacy dual-vector architecture, feature flag branching, and deprecated embedding services.

---

## 1. Azure Resources to Delete

| Resource | Type | Location | Notes |
|---|---|---|---|
| `file-chunks-index` (v1) | AI Search Index | Azure AI Search | Old dual-vector index. Verify v2 is serving all traffic first. |
| OpenAI `text-embedding-3-small` deployment | OpenAI Model | Azure OpenAI | Only if NOT used by other services. Check all consumers first. |
| Azure Computer Vision (embedding endpoint) | Cognitive Service | Azure Portal | Only the embedding API — keep if used for OCR or other vision features. |

---

## 2. Feature Flags to Remove

| Flag | File | Action |
|---|---|---|
| `USE_UNIFIED_INDEX` | `backend/src/infrastructure/config/environment.ts` | Remove from Zod schema. All code paths become unified-only. |
| `USE_UNIFIED_INDEX` | `backend/.env.example` | Remove the entry and documentation comment. |
| `USE_UNIFIED_INDEX` | Container App config (dev + prod) | Remove env var from Azure configuration. |

---

## 3. Code to Remove — Embedding Services

| File | What to Remove |
|---|---|
| `backend/src/services/search/embeddings/EmbeddingServiceFactory.ts` | **Delete entire file**. No more branching needed — always use CohereEmbeddingService directly. |
| `backend/src/services/search/embeddings/types.ts` | Keep — `IEmbeddingService` interface is still used by CohereEmbeddingService. |
| `backend/src/services/search/embeddings/CohereEmbeddingService.ts` | Keep — this is the active service. |
| `backend/src/services/embeddings/EmbeddingService.ts` | **Delete entire file** — legacy OpenAI text-embedding-3-small service. |
| `backend/src/services/embeddings/` | **Delete entire directory** if EmbeddingService.ts is the only file. |

---

## 4. Code to Remove — Search Services

| File | What to Remove |
|---|---|
| `backend/src/services/search/schema.ts` | **Delete entire file** — v1 index schema definition. |
| `backend/src/services/search/schema-v2.ts` | **Rename to `schema.ts`** — v2 becomes the only schema. Update all imports. |
| `backend/src/services/search/VectorSearchService.ts` | Remove: `searchClient` (v1), `getActiveSearchClient()` branching, dual-vector query logic in `semanticSearch()`, v1 path in `searchImages()`, `getV2SearchClient()` (only needed during migration). Simplify: all methods use single client + `embeddingVector` field. |
| `backend/src/services/search/semantic/SemanticSearchService.ts` | Remove: legacy dual-embedding path, `searchMode` routing, image embedding fallback. Simplify: always use `embedQuery()` from CohereEmbeddingService. |

---

## 5. Code to Remove — File Processing Pipeline

| File | What to Remove |
|---|---|
| `backend/src/infrastructure/queue/workers/FileEmbedWorker.ts` | Remove `isUnifiedIndexEnabled()` branch — always use Cohere path. Remove legacy EmbeddingService import. |
| `backend/src/services/files/processors/ImageProcessor.ts` | Remove `isUnifiedIndexEnabled()` branch — always use Cohere for embedding. Keep Azure Vision for captions (still needed for BM25). |
| `backend/src/services/files/FileChunkingService.ts` | Remove `!isUnifiedIndexEnabled()` guard around `captionContentVector`. Remove entire `captionContentVector` block — no longer needed. Remove legacy EmbeddingService import. |

---

## 6. Code to Remove — RAG Agent

| File | What to Remove |
|---|---|
| `backend/src/modules/agents/rag-knowledge/tools.ts` | Remove dimension safety check in `findSimilarImagesTool` (all embeddings will be 1536d after cleanup). |

---

## 7. Code to Remove — Migration Script

| File | Action |
|---|---|
| `backend/scripts/operations/migrate-embeddings.ts` | **Delete** — one-time migration already completed. |
| `backend/scripts/_shared/cohere.ts` | **Delete** — only used by migration script. |

---

## 8. Tests to Update

| File | Action |
|---|---|
| `backend/src/__tests__/unit/services/search/VectorSearchService.unified.test.ts` | Remove or simplify — no more v1/v2 branching to test. |
| `backend/src/__tests__/unit/services/search/VectorSearchService.searchImages-v2.test.ts` | Remove v1 path tests — only v2 exists. |
| `backend/src/__tests__/unit/services/search/embeddings/EmbeddingServiceFactory.test.ts` | **Delete** — factory removed. |
| `backend/src/__tests__/unit/services/search/semantic/SemanticSearchService.unified.test.ts` | Remove legacy path tests. |
| `backend/src/__tests__/unit/infrastructure/queue/workers/FileEmbedWorkerV2.test.ts` | Remove legacy path tests — only Cohere. |
| `backend/src/__tests__/unit/services/files/processors/ImageProcessor.test.ts` | Remove legacy path tests — only Cohere. |

---

## 9. Infrastructure (Bicep)

| File | Action |
|---|---|
| `infrastructure/bicep/modules/keyvault-secrets.bicep` | Remove conditional Cohere secrets — make them required (no longer optional). |
| `infrastructure/bicep/main.bicep` | Remove `cohereEndpoint`/`cohereApiKey` default empty strings — make required params. |
| `infrastructure/bicep/modules/cognitive.bicep` | Evaluate: remove OpenAI text-embedding-3-small deployment if no other consumers. |

---

## 10. Documentation

| File | Action |
|---|---|
| `backend/src/services/search/CLAUDE.md` | Update: remove dual-vector references, update field descriptions. |
| `backend/src/services/files/CLAUDE.md` | Update: remove Azure Vision embedding references in ImageProcessor section. |
| `docs/plans/rag-agent-stabilization/00-INDEX.md` | Update PRD-202 status to Complete. |
| `docs/plans/rag-agent-stabilization/PRD-202-cohere-embed4-data-cutover.md` | Mark cleanup criteria as done. |

---

## Execution Order

1. Verify no rollback has occurred in 30 days
2. Delete Azure resources (section 1)
3. Remove feature flags (section 2)
4. Remove code (sections 3-7 — one commit)
5. Update tests (section 8)
6. Run `npm run verify:types` + `npm run -w backend test:unit` + `npm run -w backend lint`
7. Update infrastructure (section 9)
8. Update documentation (section 10)
9. Deploy and verify
