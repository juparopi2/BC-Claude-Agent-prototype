# RAG Agent Stabilization — Deployment Runbook

**Project**: RAG Agent Tool Redesign & Embedding Unification
**Created**: 2026-03-24
**Last Updated**: 2026-03-24 (infrastructure gaps fixed, GDPR region analysis added; USE_UNIFIED_INDEX feature flag removed — V2 is now the only code path)

## Purpose

Single reference for all infrastructure, configuration, migration, and deployment steps required to bring the RAG Agent Stabilization initiative from dev to production. Each PRD appends its section as implementation completes. Execute sections in order.

## Pre-Requisites (shared across all PRDs)

- Azure CLI authenticated (`az login`)
- Access to Key Vault (`kv-bcagent-dev` / `kv-myworkmate-prod`)
- Bicep CLI installed (`az bicep install`)
- Backend running locally or in Container Apps
- Node.js + npm workspace setup (`npm install` from root)

## Cohere Embed v4 — Region & GDPR Analysis

> **Discovery (2026-03-24)**: Cohere Embed v4 is deployed as a model deployment (`embed-v-4-0`, format `Cohere`, SKU `GlobalStandard`) on an existing `kind: AIServices` resource — NOT via Azure AI Foundry Portal as originally planned. No ML workspace needed.

### Model availability (`embed-v-4-0`)

| Region | Available | GDPR-compliant |
|---|---|---|
| **westeurope** | **Yes** | **Yes** |
| swedencentral | Yes | Yes |
| francecentral | Yes | Yes |
| germanywestcentral | Yes | Yes |
| norwayeast | Yes | Yes |
| switzerlandnorth | Yes | Yes |
| uksouth | Yes | Post-Brexit, evaluate |
| eastus / eastus2 | Yes | **No** |
| northeurope | No | N/A |

### Deployment strategy per environment

| Environment | AIServices Resource | Region | Rationale |
|---|---|---|---|
| **Development** | `jpi-ml9pu7mq-eastus2` (existing) | eastus2 | Already deployed. Acceptable for dev — no real user data under GDPR. |
| **Production** | **New resource required in westeurope** | westeurope | GDPR compliance: user document content is sent to the embedding endpoint for vectorization. This constitutes data processing and must remain in the EU. |

### Production GDPR constraint

The existing prod `AIServices` resource (`speech-myworkmate-prod`) is in **eastus2**. For GDPR-compliant Cohere embeddings in production:

**Option A (Recommended)**: Add a dedicated `AIServices` resource in westeurope via Bicep (`cognitive.bicep`). This keeps embedding processing in the EU while the existing speech resource stays in eastus2.

```bash
# Provisioning command (after Bicep update):
az cognitiveservices account create \
  --name cohere-myworkmate-prod \
  --resource-group rg-myworkmate-app-prod \
  --kind AIServices --sku S0 \
  --location westeurope \
  --custom-domain cohere-myworkmate-prod

az cognitiveservices account deployment create \
  --name cohere-myworkmate-prod \
  --resource-group rg-myworkmate-app-prod \
  --deployment-name embed-v-4-0 \
  --model-name embed-v-4-0 --model-version 1 --model-format Cohere \
  --sku-name GlobalStandard --sku-capacity 1
```

**Option B**: Deploy `embed-v-4-0` on the existing `speech-myworkmate-prod` in eastus2. Faster but **NOT GDPR-compliant** — user content leaves the EU during embedding.

### Dev deployment (completed 2026-03-24)

```bash
# Model deployed on existing AIServices resource
az cognitiveservices account deployment create \
  --name jpi-ml9pu7mq-eastus2 \
  --resource-group rg-BCAgentPrototype-app-dev \
  --deployment-name embed-v-4-0 \
  --model-name embed-v-4-0 --model-version 1 --model-format Cohere \
  --sku-name GlobalStandard --sku-capacity 1

# Endpoint: https://jpi-ml9pu7mq-eastus2.cognitiveservices.azure.com/
# API Key: same as existing AIServices resource key (shared across deployments)
```

## Infrastructure Gaps Found & Fixed (2026-03-24)

During QA review, we discovered that the CI/CD pipelines, bootstrap scripts, and Key Vault loader were missing Cohere secret references. Without these fixes, deployment to Azure Container Apps would fail because Cohere secrets are now required configuration — the app will not start without them.

| File | Gap | Fix |
|---|---|---|
| `.github/workflows/backend-deploy.yml` | No Cohere secret refs or env vars in either create or update paths | Added `cohere-endpoint` + `cohere-api-key` to both `secret set` blocks; added `COHERE_ENDPOINT`, `COHERE_API_KEY`, `USE_QUERY_TIME_VECTORIZATION` to both `set-env-vars` blocks |
| `.github/workflows/production-deploy.yml` | No Cohere env vars in deploy-containers | Added 3 env vars to `set-env-vars` block |
| `infrastructure/scripts/create-container-apps.sh` | Only 28 KV secret refs, missing Cohere | Added 2 Cohere KV refs (now 30 total) |
| `backend/src/infrastructure/keyvault/keyvault.ts` | `SECRET_NAMES` and `loadSecretsFromKeyVault()` missing Cohere | Added `COHERE_ENDPOINT` + `COHERE_API_KEY` entries |
| `backend/.env.example` | Missing PRD-203 tuning variables | Added `USE_QUERY_TIME_VECTORIZATION`, `HNSW_M`, `HNSW_EF_CONSTRUCTION`, `HNSW_EF_SEARCH`, `SEARCH_FETCH_MULTIPLIER` |

**Lesson**: When adding new Key Vault secrets via Bicep, always update ALL secret consumers: `keyvault-secrets.bicep`, `keyvault.ts`, `create-container-apps.sh`, `backend-deploy.yml`, `production-deploy.yml`, and `.env.example`.

---

## PRD-200: Tool Consolidation & Power Search

**Status:** ☐ Pending

### Env Vars
None (no new infrastructure).

### Resources
None.

### Migrations
None.

### Feature Flags
None.

### Deployment Commands
Standard deploy pipeline (code-only change):
```bash
# Dev: push to main
git push origin main

# Prod: merge to production branch → triggers atomic pipeline
git checkout production && git merge main && git push origin production
```

### Post-Deploy Verification
- [ ] `search_knowledge` tool schema has 8 parameters (query, searchType, fileTypeCategory, top, minRelevanceScore, dateFrom, dateTo, sortBy)
- [ ] `find_similar_images` tool responds correctly with fileId/chatAttachmentId
- [ ] Validation pipeline clamps out-of-range values (e.g., top=999 → clamped to 50)
- [ ] Error passthrough returns actionable guidance for Azure AI Search errors
- [ ] Keyword search returns BM25 results (no embeddings generated)
- [ ] Image search (`fileTypeCategory: 'images'`) uses visual similarity matching

---

## PRD-201: Cohere Embed 4 — Infrastructure & Index

**Status:** ☑ Complete (code + cleanup) — pending infrastructure deployment

### Code Changes Delivered (2026-03-24)

| Component | What was built / current state |
|---|---|
| `CohereEmbeddingService` | Cohere Embed 4 client (text, image, interleaved, batch). Redis caching, usage tracking. Azure-only (simplified — no native Cohere path). |
| `IEmbeddingService` | Provider-agnostic interface (`EmbeddingResult`, `EmbeddingInputType`) |
| `schema.ts` | `file-chunks-index-v2` schema with single `embeddingVector` (1536d). Renamed from `schema-v2.ts` during cleanup; constants renamed `INDEX_NAME_V2→INDEX_NAME`, etc. |
| `VectorSearchService` | Single V2 client. All CRUD/search methods use V2 path exclusively. |
| `SemanticSearchService` | Unified path: single `embedQuery()` call. Graceful degradation (try/catch → empty results). |
| `environment.ts` | `COHERE_ENDPOINT`, `COHERE_API_KEY` (required). `USE_UNIFIED_INDEX` removed. |
| `ImageCaptionService` | Extracted from `ImageProcessor` — Azure Vision for captions only. |
| Bicep | `keyvault-secrets.bicep` + `main.bicep`: Cohere secrets (no longer conditional). |
| Tests | 35 new unit tests. All 4091 backend tests passing. |

**Cleanup completed (2026-03-24):**
- `EmbeddingServiceFactory` deleted — code calls `CohereEmbeddingService` directly
- `schema-v2.ts` renamed to `schema.ts`; legacy `EmbeddingService` and `services/embeddings/` directory deleted
- Migration scripts deleted (`migrate-embeddings.ts`, `create-index-v2.ts`, `_shared/cohere.ts`) — migration already executed in dev
- All V1 code paths removed from `VectorSearchService`, `SemanticSearchService`, `FileEmbedWorker`, `ImageProcessor`, `FileChunkingService`

**Design decisions that affect deployment:**
- Cohere deployed via Azure CLI as model deployment on existing `AIServices` resource (no ML workspace needed)
- Dev uses eastus2 (existing resource); prod requires new `AIServices` resource in westeurope (GDPR)
- V2 is now always active — no flag needed

### 1. Deploy Cohere Embed v4 Model

Deploy `embed-v-4-0` as a model deployment on an existing `kind: AIServices` resource via Azure CLI. No AI Foundry Portal or ML workspace needed.

```bash
# ===== Development (eastus2 — existing AIServices resource) =====
az cognitiveservices account deployment create \
  --name jpi-ml9pu7mq-eastus2 \
  --resource-group rg-BCAgentPrototype-app-dev \
  --deployment-name embed-v-4-0 \
  --model-name embed-v-4-0 --model-version 1 --model-format Cohere \
  --sku-name GlobalStandard --sku-capacity 1

# ===== Production (westeurope — new dedicated resource for GDPR) =====
# Step 1: Create AIServices resource in EU
az cognitiveservices account create \
  --name cohere-myworkmate-prod \
  --resource-group rg-myworkmate-app-prod \
  --kind AIServices --sku S0 \
  --location westeurope \
  --custom-domain cohere-myworkmate-prod

# Step 2: Deploy model
az cognitiveservices account deployment create \
  --name cohere-myworkmate-prod \
  --resource-group rg-myworkmate-app-prod \
  --deployment-name embed-v-4-0 \
  --model-name embed-v-4-0 --model-version 1 --model-format Cohere \
  --sku-name GlobalStandard --sku-capacity 1
```

After deployment, the endpoint and key come from the **parent AIServices resource** (shared across all deployments on that resource):

```bash
# Get endpoint
az cognitiveservices account show --name <resource-name> --resource-group <rg> \
  --query "properties.endpoint" -o tsv

# Get API key
az cognitiveservices account keys list --name <resource-name> --resource-group <rg> \
  --query "key1" -o tsv
```

**Endpoint format**: `https://<custom-domain>.cognitiveservices.azure.com/`
**Important**: The API key is shared with other deployments on the same AIServices resource (e.g., `gpt-4o-mini-transcribe` in dev).

### 2. Environment Variables

| Variable | Value | Where | Required When |
|---|---|---|---|
| `COHERE_ENDPOINT` | Azure AI Foundry endpoint URL | Key Vault + `.env` | Always required — app fails to start without it |
| `COHERE_API_KEY` | Serverless endpoint API key | Key Vault + `.env` | Always required — app fails to start without it |

### 3. Key Vault Secrets

```bash
# ===== Development =====
az keyvault secret set --vault-name kv-bcagent-dev \
  --name COHERE-ENDPOINT --value "<endpoint-url>"
az keyvault secret set --vault-name kv-bcagent-dev \
  --name COHERE-API-KEY --value "<api-key>"

# ===== Production (set after PRD-202 validation passes) =====
az keyvault secret set --vault-name kv-myworkmate-prod \
  --name COHERE-ENDPOINT --value "<endpoint-url>"
az keyvault secret set --vault-name kv-myworkmate-prod \
  --name COHERE-API-KEY --value "<api-key>"
```

### 4. Bicep Deployment (optional — secrets can also be set manually above)

```bash
# Re-deploy keyvault-secrets module with Cohere parameters
cd infrastructure
az deployment group create \
  --resource-group rg-BCAgentPrototype-sec-dev \
  --template-file bicep/modules/keyvault-secrets.bicep \
  --parameters cohereEndpoint="<url>" cohereApiKey="<key>"
```

### 5. Create AI Search Index v2

The app creates the index automatically on startup. The `create-index-v2.ts` script was deleted during cleanup — manual pre-creation is no longer needed. Simply deploy the app and the index will be created on first startup if it does not already exist.

### 6. Post-Deploy Verification

```bash
# Test Cohere endpoint connectivity (note: /v2/embed path)
curl -X POST "<COHERE_ENDPOINT>/v2/embed" \
  -H "Authorization: Bearer <COHERE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"texts":["hello world"],"input_type":"search_query","embedding_types":["float"]}'
# Expected: 200 OK with embeddings.float containing a 1536-dimensional vector
```

- [ ] Cohere endpoint responds with 1536d vectors
- [ ] Index `file-chunks-index-v2` exists in Azure AI Search (dev)
- [ ] `search_knowledge` generates Cohere embeddings and queries the V2 index
- [ ] `find_similar_images` works with 1536d Cohere embeddings
- [ ] Keyword search works (no embeddings generated, BM25 path)

---

## PRD-202: Re-Embedding & Data Cutover

**Status**: ☑ Complete (code + cleanup) — pending production deployment
**Prerequisites**: PRD-201 fully deployed (Cohere endpoint active, Key Vault secrets set, index v2 created)

### Code Changes Delivered

> **Note**: Feature flag branching has been removed during cleanup. `CohereEmbeddingService` is now the only embedding path — all of the items below reflect the post-cleanup state where V2 is unconditional.

- `migrate-embeddings.ts` — One-time migration script (scan v1 → re-embed with Cohere → write to v2). **Deleted after dev migration completed.** Recover from git history for production use (see Post-Cleanup State section).
- `VectorSearchService.searchImages()` — Uses V2/embeddingVector (1536d) exclusively
- `FileEmbedWorker` — Uses Cohere `embedTextBatch` unconditionally
- `ImageProcessor` — Uses Cohere `embedImage` unconditionally (Azure Vision captions via `ImageCaptionService`)
- `FileChunkingService` — `captionContentVector` removed (no V1 dual-vector path)
- `findSimilarImagesTool` — Dimension safety check removed (V2 is always 1536d)

### Step 1: Verify Prerequisites

```bash
# Verify Cohere endpoint is accessible
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$COHERE_ENDPOINT/v2/embed" \
  -H "Authorization: Bearer $COHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"texts":["test"],"input_type":"search_document","embedding_types":["float"]}'
# Expected: 200

# Verify v2 index exists
az search index show --service-name <search-service> --name file-chunks-index-v2
```

### Step 2: Dry Run (Dev)

```bash
cd backend
npx tsx scripts/operations/migrate-embeddings.ts --dry-run
# Output: total text chunks, image chunks count
# Verify counts look reasonable
```

### Step 3: Migrate (Dev)

```bash
# Optional: test with single user first
npx tsx scripts/operations/migrate-embeddings.ts --user-id <TEST-USER-UUID>

# Full migration
npx tsx scripts/operations/migrate-embeddings.ts
# Monitor progress. Expected: <1 hour for dev data
# Script reports batch progress, failures, and final summary
```

### Step 4: Validate (Dev)

```bash
npx tsx scripts/operations/migrate-embeddings.ts --validate
# Criteria (from PRD-202 §4.3):
#   ≥60% file overlap in top-5 results
#   ≤15% average score drop
# Script exits 0 if passed, 1 if failed
```

### Step 5: Cutover (Dev)

```bash
# No feature flag needed — the code exclusively uses the V2 index.
# After migration completes, simply verify:
# - search_knowledge returns results from v2 index
# - find_similar_images works with 1536d Cohere embeddings
# - Keyword search still works
# - New file uploads use Cohere embeddings
```

### Step 6: Production Deployment

> **IMPORTANT**: The migration script (`migrate-embeddings.ts`) was deleted after dev migration completed. Recover it from git history before running against production (see Post-Cleanup State section).

Repeat Steps 1-5 against production environment:

1. Recover `migrate-embeddings.ts` from git history
2. Run `--dry-run` against prod AI Search
3. Run full migration (estimated 2-6 hours for large datasets)
4. Run `--validate` against prod data
5. Deploy the cleanup code to production (Container App) — the code now exclusively uses the V2 index, no config toggle needed
6. Monitor for 7 days:
   - Search latency (p95 within 20% of baseline)
   - Error rate (< 0.5%)
   - Search quality (user feedback)

### Rollback

> **IMPORTANT**: The instant config-toggle rollback is no longer available — the feature flag has been removed. Rollback now requires deploying the previous code version.

```bash
# Rollback: revert to the pre-cleanup git commit and redeploy
git revert <cleanup-commit-hash>
git push origin production
# The reverted code restores the USE_UNIFIED_INDEX flag and V1 paths.
# Old index (file-chunks-index) must still exist in AI Search for this to work.

# Retain old index for 30 days after production cutover as a rollback safety net.
```

### Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `COHERE_ENDPOINT` | Azure AI Foundry URL | Set in PRD-201. Always required. |
| `COHERE_API_KEY` | API key | Set in PRD-201. Always required. |

### Known Limitations

- External files (OneDrive/SharePoint) are skipped during migration — they require OAuth tokens not available in script context. These files will be re-embedded automatically on the next delta sync cycle after cutover.
- The migration script is idempotent (uses `mergeOrUploadDocuments`) — safe to re-run if interrupted.

---

## PRD-203: Advanced Search Optimization

**Status:** ☑ Code Complete — pending deployment

### Code Changes Delivered (2026-03-24)

| Component | What was built |
|---|---|
| Extractive Answers (F1) | Semantic Ranker returns answers + captions. Propagated through VectorSearchService → SemanticSearchService → tools.ts → CitationResult. |
| Response Format (F2) | `responseDetail` parameter on `search_knowledge`. Concise mode: 1 passage/doc, ~100 chars. |
| Query-Time Vectorization (F3) | Vectorizer in schema-v2, `kind: 'text'` queries, skip app-side embedding. Behind feature flag. |
| Performance Tuning (F5) | HNSW params + fetchTopK multiplier configurable via env vars. Defaults unchanged. |
| Benchmark Script | `scripts/operations/benchmark-search.ts` — compares latency and result quality. |

### Env Vars

| Variable | Value | Where | Required When |
|---|---|---|---|
| `USE_QUERY_TIME_VECTORIZATION` | `false` (default) | `.env` / Container App config | Optional — enable after benchmarking |
| `HNSW_M` | `4` (default) | `.env` / Container App config | Optional — build-time param, requires index recreation |
| `HNSW_EF_CONSTRUCTION` | `400` (default) | `.env` / Container App config | Optional — build-time param, requires index recreation |
| `HNSW_EF_SEARCH` | `500` (default) | `.env` / Container App config | Optional — query-time param, takes effect immediately |
| `SEARCH_FETCH_MULTIPLIER` | `3` (default) | `.env` / Container App config | Optional — controls fetchTopK in semantic search |

### Resources
- Cohere vectorizer linked to `file-chunks-index-v2` HNSW profile (conditionally added when `COHERE_ENDPOINT` is set)

### Migrations

Update the v2 index schema to include the vectorizer configuration:
```bash
# This happens automatically when the app creates/updates the index on startup.
# The create-index-v2.ts script was deleted during cleanup — the app startup path
# is the only supported mechanism. Restart the app to trigger index update.
```

### Feature Flags

| Flag | Default | Enable When |
|---|---|---|
| `USE_QUERY_TIME_VECTORIZATION` | `false` | After benchmark confirms overhead < 100ms |

F1 (extractive answers) and F2 (response format) have **no feature flags** — they are additive and backward-compatible.

### Commands

```bash
# Benchmark query-time vectorization (V2 index is always active)
cd backend
npx tsx scripts/operations/benchmark-search.ts --user-id <TEST-USER-UUID>
# Pass if avg overhead < 100ms
```

### Post-Deploy Verification

- [ ] Extractive answers returned for factual queries (e.g., "what is the return policy?")
- [ ] Highlighted captions present in citation passages
- [ ] `search_knowledge` tool schema now has 9 parameters (added `responseDetail`)
- [ ] `responseDetail: 'concise'` returns 1 short passage per document
- [ ] `responseDetail: 'detailed'` returns full passages (existing behavior)
- [ ] Keyword search returns no extractive answers (semantic ranker OFF)
- [ ] `USE_QUERY_TIME_VECTORIZATION=false` → no behavior change
- [ ] After benchmark: `USE_QUERY_TIME_VECTORIZATION=true` → search works without app-side embedding

---

## Final Deployment Checklist

Execute this checklist after PRD-203 implementation completes. Steps are ordered by dependency.

### Development Environment

1. [x] **PRD-200**: Tool consolidation code deployed and verified
2. [x] **PRD-201**: Cohere Embed 4 endpoint deployed to AI Foundry (dev)
3. [x] **PRD-201**: `COHERE_ENDPOINT` + `COHERE_API_KEY` in Key Vault (dev)
4. [x] **PRD-201**: Code deployed, `file-chunks-index-v2` created
5. [x] **PRD-202**: Re-embedding job completed (all text + images)
6. [x] **PRD-202**: Quality validation passed (top-5 overlap ≥ 80%)
7. [x] **PRD-202**: V2 index active in dev (USE_UNIFIED_INDEX flag removed — V2 is unconditional)
8. [x] **PRD-202**: `find_similar_images` verified with 1536d Cohere embeddings
9. [ ] **PRD-203**: Advanced search optimizations deployed (extractive answers, response format, query-time vectorization)
10. [ ] **PRD-203**: Extractive answers verified for factual queries
11. [ ] **PRD-203**: `responseDetail: 'concise'` verified (fewer tokens)
12. [ ] **PRD-203**: Benchmark script run: `npx tsx scripts/operations/benchmark-search.ts`
13. [ ] **PRD-203**: (Optional) `USE_QUERY_TIME_VECTORIZATION=true` after benchmark passes
14. [x] **Cleanup**: Legacy OpenAI/Vision embedding code paths removed; feature flag removed; migration scripts deleted
15. [x] **Cleanup**: Old `file-chunks-index` decommissioned (after 30-day rollback window)

### Production Environment

1. [ ] All dev environment verification passed
2. [ ] **GDPR**: New `AIServices` resource created in **westeurope** for Cohere (see Region & GDPR Analysis above)
3. [ ] Cohere Embed v4 (`embed-v-4-0`) deployed on westeurope resource
4. [ ] `COHERE_ENDPOINT` + `COHERE_API_KEY` in Key Vault (prod):
   ```bash
   # Get values from the NEW westeurope resource
   ENDPOINT=$(az cognitiveservices account show --name cohere-myworkmate-prod \
     --resource-group rg-myworkmate-app-prod --query "properties.endpoint" -o tsv)
   KEY=$(az cognitiveservices account keys list --name cohere-myworkmate-prod \
     --resource-group rg-myworkmate-app-prod --query "key1" -o tsv)

   az keyvault secret set --vault-name kv-myworkmate-prod \
     --name COHERE-ENDPOINT --value "$ENDPOINT"
   az keyvault secret set --vault-name kv-myworkmate-prod \
     --name COHERE-API-KEY --value "$KEY"
   ```
5. [ ] Bicep deployment (if updating infrastructure):
   ```bash
   bash infrastructure/scripts/deploy.sh
   ```
6. [ ] **IMPORTANT**: Recover `migrate-embeddings.ts` from git history and run against prod data **before** deploying the cleanup code (see Post-Cleanup State section)
7. [ ] PRD-202 re-embedding job run against prod data (`--dry-run` first, then full migration)
8. [ ] Quality validation passed (prod)
9. [ ] Production pipeline: push cleanup code to `production` branch — code exclusively uses V2 index, no flag needed
   ```bash
   git checkout production && git merge main && git push origin production
   ```
10. [ ] Monitor for 7 days: latency, error rates, search quality
11. [ ] Old index `file-chunks-index` decommissioned after 30-day rollback window

---

## Rollback Procedures

### PRD-201 / PRD-202 Rollback (Cohere not working or quality regression)

> The instant config-toggle rollback is no longer available — `USE_UNIFIED_INDEX` has been removed. Rollback now requires a code revert and redeployment.

```bash
# Identify the last commit before the cleanup was merged
git log --oneline | head -20

# Revert the cleanup commit (or check out the pre-cleanup tag if one exists)
git revert <cleanup-commit-hash>
git push origin production
# This restores the USE_UNIFIED_INDEX flag and V1 code paths.
# The old index (file-chunks-index) must still exist in AI Search for queries to succeed.
# Retain the old index for at least 30 days after production cutover as a safety net.
```

### PRD-203 Rollback (Advanced features causing issues)
```bash
# Advanced features are additive — disable specific features via config or code revert
# AML vectorizer: remove from index schema via createOrUpdateIndex()
# Extractive answers: disable in SemanticSearchService
# USE_QUERY_TIME_VECTORIZATION: set to false (flag still active)
```

---

## Post-Cleanup State (2026-03-24)

This section summarizes the state of the codebase after the feature flag cleanup was completed.

### What Changed

- **`USE_UNIFIED_INDEX` removed** — the feature flag no longer exists in `environment.ts`, `.env.example`, CI/CD workflows, or anywhere in the codebase. V2 (`file-chunks-index-v2`) is the only code path.
- **`COHERE_ENDPOINT` and `COHERE_API_KEY` are required** — the app will fail to start if these environment variables are not set. They must be present in Key Vault and in local `.env` for all environments.
- **Index name is `file-chunks-index-v2`** — hardcoded via `INDEX_NAME` constant in `schema.ts` (renamed from `schema-v2.ts`). Not configurable via environment variable.
- **`EmbeddingServiceFactory` deleted** — code calls `CohereEmbeddingService` directly. No factory routing layer.
- **Migration scripts deleted** — `migrate-embeddings.ts`, `create-index-v2.ts`, and `_shared/cohere.ts` were removed after the dev migration completed. The old `EmbeddingService` and `services/embeddings/` directory were also deleted.
- **`ImageCaptionService` extracted** — Azure Vision is now only used for generating text captions. Embedding is exclusively handled by Cohere.

### IMPORTANT: Production Migration

The migration script (`migrate-embeddings.ts`) **must be run against production data** before the cleanup code is deployed. Because the script has been deleted from the working tree, it must be recovered from git history:

```bash
# Recover the migration script from git history
git show HEAD~1:backend/scripts/operations/migrate-embeddings.ts \
  > backend/scripts/operations/migrate-embeddings.ts

# Or find the exact commit that deleted it:
git log --all --oneline -- backend/scripts/operations/migrate-embeddings.ts

# Then run the migration against production (with prod env vars):
cd backend
npx tsx scripts/operations/migrate-embeddings.ts --dry-run
npx tsx scripts/operations/migrate-embeddings.ts
npx tsx scripts/operations/migrate-embeddings.ts --validate
```

**Only after the production migration completes and validates** should the cleanup code be deployed to production. Deploying the cleanup code before migration leaves production with no embeddings in the V2 index, resulting in empty search results.

### Instant Rollback No Longer Available

Before cleanup, rollback was a 30-second config change (`USE_UNIFIED_INDEX=false`). After cleanup, rollback requires deploying the previous code version via `git revert`. Ensure the old V1 index (`file-chunks-index`) is retained for at least 30 days post-production-cutover to preserve the rollback option.

---

## Errata — Azure Image Embedding Endpoint (2026-03-24)

### Discovery

The Azure OpenAI-compatible API (`/openai/deployments/embed-v-4-0/embeddings`) does **NOT** support image input. When `CohereEmbeddingService` sent base64 image data URIs through this endpoint, the model treated them as literal text strings, producing semantically useless embeddings and consuming massive token quotas (1MB JPEG = 1.3MB text), causing 429 rate limits.

### Solution: Dual-Endpoint Architecture

Azure AIServices resources expose **two separate embedding APIs** on different domains:

| API | Domain | Path | Supports |
|-----|--------|------|----------|
| OpenAI-compatible (text) | `*.cognitiveservices.azure.com` | `/openai/deployments/embed-v-4-0/embeddings` | Text only |
| Foundry Models (images) | `*.services.ai.azure.com` | `/models/images/embeddings?api-version=2024-05-01-preview` | Images + image-text pairs |

Both APIs use the **same API key** and the **same underlying resource** — just different domain aliases and paths.

### Implementation

`CohereEmbeddingService` now has two API methods:
- `callCohereApi()` — text embeddings via OpenAI-compatible endpoint (unchanged)
- `callAzureImageApi()` — image embeddings via Foundry Models endpoint (new)

The image endpoint is **auto-derived** from `COHERE_ENDPOINT` by replacing `.cognitiveservices.azure.com` with `.services.ai.azure.com`. Override via optional `COHERE_IMAGE_ENDPOINT` env var if needed.

### Request format for Azure image embedding
```json
POST https://<resource>.services.ai.azure.com/models/images/embeddings?api-version=2024-05-01-preview
Headers: { "api-key": "<same-key>", "Content-Type": "application/json" }
{
  "model": "embed-v-4-0",
  "input": [{ "image": "data:image/jpeg;base64,..." }],
  "input_type": "document"
}
```

### New environment variable

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `COHERE_IMAGE_ENDPOINT` | No | Auto-derived from `COHERE_ENDPOINT` | Override Azure Foundry Models image endpoint |

### Deployment updates needed
- Key Vault: `COHERE_IMAGE_ENDPOINT` only if auto-derivation doesn't work for the prod resource
- CI/CD workflows already updated with Cohere secret refs; image endpoint auto-derives at runtime

### Additional fix: FileEmbedWorker validation

When a file has 0 text chunks, `FileEmbedWorker` now checks the file's mime type before advancing:
- Image files (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) → advance to READY (correct behavior)
- Non-image files with 0 chunks → transition to FAILED (prevents silent failures)

### Additional fix: Scripts V2 index support

All operational scripts (`verify-storage`, `purge-user-search-docs`, `purge-storage`, `verify-sync`) were updated to use the V2 index exclusively (consistent with the cleanup removing `USE_UNIFIED_INDEX`):
- `_shared/azure.ts` exports `getActiveIndexName()` which always returns `file-chunks-index-v2`
- `purge-user-search-docs.ts` supports `--v1`, `--v2`, `--all-indexes` flags (retain `--v1` flag for decommission operations during the 30-day rollback window)
- `verify-storage.ts` validates against V2 schema
