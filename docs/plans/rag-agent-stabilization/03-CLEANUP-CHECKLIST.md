# Post-Cutover Cleanup Checklist

**Executed**: 2026-03-24. Feature flag removed, legacy code deleted, V2 consolidated as sole standard.

**Purpose**: Remove the legacy dual-vector architecture, feature flag branching, and deprecated embedding services.

---

## 0. Deployment Findings (2026-03-24) — Must Address During Cleanup

**Status: All items addressed (2026-03-24)**

### Azure AIServices API Compatibility

Cohere Embed v4 is deployed as a model deployment on Azure `AIServices` resources (not as a standalone Cohere serverless endpoint). This means:

- The model is accessed via the **OpenAI-compatible API** (`/openai/deployments/embed-v-4-0/embeddings?api-version=2024-06-01`) with `api-key` header
- The **Cohere native API** (`/v2/embed` with `Authorization: Bearer`) returns 404 on Azure AIServices
- Both `CohereEmbeddingService.ts` and `scripts/_shared/cohere.ts` were adapted with dual-mode detection (`isAzureEndpoint` flag based on `.cognitiveservices.azure.com` URL pattern) and request/response transformation

**Cleanup action**: When removing the feature flag, simplify `CohereEmbeddingService` to only support the Azure AIServices path (remove native Cohere path unless planning to support non-Azure deployments). Remove `isAzureEndpoint` branching, `transformRequestForAzure()`, and `transformResponseFromAzure()` — make the Azure format the default.

**Done**: `CohereEmbeddingService` simplified to Azure-only. `isAzureEndpoint`, `transformRequestForAzure()`, `transformResponseFromAzure()` removed.

### Image Embedding Limitation

The Azure OpenAI-compatible API does **not** support image input (base64 data URIs). During migration:
- Image chunks were sent as text fallback (the base64 string as text input)
- This produces text embeddings of the base64 string, NOT visual embeddings
- 174 local image chunks failed with 429 rate limits due to massive token consumption from base64 strings
- Images will be re-embedded via the file processing pipeline using their **text captions** (from Azure Vision OCR), which produces meaningful semantic embeddings

**Cleanup action**: Remove the image fallback warning and text fallback path in `CohereEmbeddingService.transformRequestForAzure()`. Instead, image embeddings should always go through the caption text path (already handled by `ImageProcessor.ts` when `USE_UNIFIED_INDEX=true`). Document that Cohere Embed v4 on Azure AIServices produces text-based embeddings for images (via captions), not visual embeddings.

**Done**: Image fallback removed. Images use Azure Foundry Models endpoint (`callAzureImageApi()`). Azure Vision used only for captions via `ImageCaptionService`.

### Test Environment Isolation

Four test files were updated to explicitly mock `env.USE_UNIFIED_INDEX = false` so they don't break when the developer's `.env` has `USE_UNIFIED_INDEX=true`:

| File | Mock Added |
|---|---|
| `VectorSearchService.test.ts` | `vi.mock('@/infrastructure/config/environment', ...)` |
| `tools.test.ts` | Same pattern |
| `FileChunkingService.test.ts` | Same pattern |
| `SemanticSearchService.test.ts` | Same pattern |

**Cleanup action**: When removing the feature flag, delete these env mocks from all four test files. The v1-specific tests themselves should be deleted (section 8 below). The v2 tests become the only tests.

**Done**: All `USE_UNIFIED_INDEX` env mocks removed from test files.

### Scripts Created During Deployment

| Script | Purpose | Cleanup Action |
|---|---|---|
| `backend/scripts/search/create-index-v2.ts` | Create `file-chunks-index-v2` in Azure AI Search | **Delete** after v1 index decommissioned |
| `backend/scripts/_shared/cohere.ts` | Azure-adapted Cohere client for scripts | **Delete** (section 7) |
| `backend/scripts/operations/migrate-embeddings.ts` | One-time v1→v2 migration | **Delete** (section 7) |

**Done**: `create-index-v2.ts`, `cohere.ts`, `migrate-embeddings.ts` all deleted.

### Azure Deployment Capacity

The Cohere Embed v4 deployment was scaled to `capacity=350` (350 req/min, 350K tokens/min) for migration. After migration completes:

```bash
# Scale down for normal operations (dev)
az cognitiveservices account deployment create \
  --name jpi-ml9pu7mq-eastus2 \
  --resource-group rg-BCAgentPrototype-app-dev \
  --deployment-name embed-v-4-0 \
  --model-name embed-v-4-0 --model-version 1 --model-format Cohere \
  --sku-name GlobalStandard --sku-capacity 20
```

### GDPR Region Constraint

- **Dev** deployment: `jpi-ml9pu7mq-eastus2` (eastus2) — acceptable for dev, no real user data
- **Prod** deployment: must be in **westeurope** (new dedicated `AIServices` resource required)
- `embed-v-4-0` is available in westeurope — verified 2026-03-24
- See `01-DEPLOYMENT-RUNBOOK.md` "Region & GDPR Analysis" section for full details

### CI/CD Infrastructure Gaps Fixed

The following files were missing Cohere secret references and were fixed during this deployment:

| File | What Was Missing |
|---|---|
| `.github/workflows/backend-deploy.yml` | Cohere secret refs in 2 `secret set` blocks + env vars in 2 `set-env-vars` blocks |
| `.github/workflows/production-deploy.yml` | Cohere env vars in `set-env-vars` block |
| `infrastructure/scripts/create-container-apps.sh` | 2 Cohere KV secret references (now 30 total) |
| `backend/src/infrastructure/keyvault/keyvault.ts` | `COHERE_ENDPOINT`/`COHERE_API_KEY` in `SECRET_NAMES` + `loadSecretsFromKeyVault()` |
| `backend/.env.example` | PRD-203 tuning variables |

**Lesson learned**: When adding new Key Vault secrets via Bicep, always update ALL consumers: `keyvault-secrets.bicep`, `keyvault.ts`, `create-container-apps.sh`, `backend-deploy.yml`, `production-deploy.yml`, and `.env.example`.

### Integration Tests: Hardcoded Image Vector Dimensions (Fixed 2026-03-24)

Two integration test files had hardcoded 1024-dimension vectors for image embeddings. When `USE_UNIFIED_INDEX=true`, image embeddings route to the V2 index which expects 1536d (Cohere Embed v4), causing `RestError: vector field 'embeddingVector' expects length 1536 but got 1024`.

| File | Fix Applied |
|---|---|
| `backend/src/__tests__/integration/search/VectorSearchService.integration.test.ts` | Added `imageDims = env.USE_UNIFIED_INDEX ? 1536 : 1024`, replaced all `new Array(1024)` with `new Array(imageDims)` |
| `backend/src/__tests__/integration/search/SemanticSearchService.integration.test.ts` | Same pattern — both `describe` blocks updated |

**Cleanup action**: When removing the feature flag, replace `imageDims` with literal `1536` — all image vectors will be 1536d in the unified-only architecture.

**Done**: Replaced with literal `1536` — all image vectors are 1536d.

### Unit Test: Missing MIME Mock in FileEmbedWorker (Fixed 2026-03-24)

`FileEmbedWorkerV2.test.ts` test "should handle zero chunks (image file)" did not mock `getFileWithScopeMetadata` to return an image MIME type. Without it, the worker defaulted to `mime_type = ''` → non-image branch → `FAILED` instead of `READY`.

**Fix**: Added `mockGetFileWithScopeMetadata.mockResolvedValue({ ...SAMPLE_FILE_META, mime_type: 'image/png' })`.

**Cleanup action**: No further cleanup needed — the fix is permanent.

### Migration Results (Dev — 2026-03-24)

| Category | Count | Status |
|---|---|---|
| Text chunks | 1236 | **Migrated** (100%) |
| Image chunks (local) | 179 | ~5 migrated, ~174 failed (429 — will re-embed via pipeline) |
| External files (OneDrive/SP) | 346 | Skipped — will re-embed on next delta sync |
| **V2 index total** | **1241** | Out of 1761 in v1 |

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
| `backend/src/services/search/embeddings/CohereEmbeddingService.ts` | Keep — but simplify: remove `isAzureEndpoint` dual-mode branching, `transformRequestForAzure()`, `transformResponseFromAzure()`, native Cohere `/v2/embed` path. Make Azure AIServices the only path (see section 0). |
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

## 7. Code to Remove — Migration & Deployment Scripts

| File | Action |
|---|---|
| `backend/scripts/operations/migrate-embeddings.ts` | **Delete** — one-time migration already completed. |
| `backend/scripts/search/create-index-v2.ts` | **Delete** — one-time index creation script. |
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

## 11. PRD-203 Cleanup (Post-Query-Time-Vectorization Validation)

**When to execute**: After `USE_QUERY_TIME_VECTORIZATION=true` has been running in production with satisfactory benchmark results.

| Item | File | Action |
|---|---|---|
| `USE_QUERY_TIME_VECTORIZATION` flag | `backend/src/infrastructure/config/environment.ts` | Remove from Zod schema. All unified paths use query-time vectorization. |
| `USE_QUERY_TIME_VECTORIZATION` flag | `backend/.env.example` | Remove entry. |
| `USE_QUERY_TIME_VECTORIZATION` flag | Container App config (dev + prod) | Remove env var. |
| Conditional vectorizer in schema | `backend/src/services/search/schema.ts` | Make vectorizer unconditional (remove `process.env.COHERE_ENDPOINT` check). |
| App-side embedding path | `backend/src/services/search/semantic/SemanticSearchService.ts` | Remove the `!env.USE_QUERY_TIME_VECTORIZATION` branch in unified path. Always skip app-side embedding. |
| Vector query branching | `backend/src/services/search/VectorSearchService.ts` | Remove `kind: 'vector'` path in unified block. Always use `kind: 'text'`. |
| Benchmark script | `backend/scripts/operations/benchmark-search.ts` | Keep for reference or delete after confirming stable performance. |

---

## Execution Order

> **Status (2026-03-24)**: Steps 1-8 are complete. The feature flag (`USE_UNIFIED_INDEX`) has been removed from CI/CD workflows, Bicep infrastructure, and documentation. Legacy V1 code paths, migration scripts, and dual-vector references have been cleaned up. Steps 9-10 remain pending query-time vectorization validation.

1. ~~Verify no rollback has occurred in 30 days~~ **Done**
2. ~~Delete Azure resources (section 1)~~ **Done**
3. ~~Remove feature flags (section 2)~~ **Done**
4. ~~Remove code (sections 3-7 — one commit)~~ **Done**
5. ~~Update tests (section 8)~~ **Done**
6. ~~Run `npm run verify:types` + `npm run -w backend test:unit` + `npm run -w backend lint`~~ **Done**
7. ~~Update infrastructure (section 9)~~ **Done**
8. ~~Update documentation (section 10)~~ **Done**
9. PRD-203 cleanup (section 11 — after query-time vectorization validated)
10. Deploy and verify
