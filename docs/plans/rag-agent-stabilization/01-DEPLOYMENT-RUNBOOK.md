# RAG Agent Stabilization — Deployment Runbook

**Project**: RAG Agent Tool Redesign & Embedding Unification
**Created**: 2026-03-24
**Last Updated**: 2026-03-24 (infrastructure gaps fixed, GDPR region analysis added)

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

During QA review, we discovered that the CI/CD pipelines, bootstrap scripts, and Key Vault loader were missing Cohere secret references. Without these fixes, deployment to Azure Container Apps would fail when `USE_UNIFIED_INDEX=true`.

| File | Gap | Fix |
|---|---|---|
| `.github/workflows/backend-deploy.yml` | No Cohere secret refs or env vars in either create or update paths | Added `cohere-endpoint` + `cohere-api-key` to both `secret set` blocks; added `COHERE_ENDPOINT`, `COHERE_API_KEY`, `USE_UNIFIED_INDEX`, `USE_QUERY_TIME_VECTORIZATION` to both `set-env-vars` blocks |
| `.github/workflows/production-deploy.yml` | No Cohere env vars in deploy-containers | Added 4 env vars to `set-env-vars` block |
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

**Status:** ☑ Code Complete — pending infrastructure deployment

### Code Changes Delivered (2026-03-24)

| Component | What was built |
|---|---|
| `CohereEmbeddingService` | Cohere Embed 4 client (text, image, interleaved, batch). Redis caching, usage tracking. |
| `EmbeddingServiceFactory` | Feature flag routing: `isUnifiedIndexEnabled()` + `getUnifiedEmbeddingService()` |
| `IEmbeddingService` | Provider-agnostic interface (`EmbeddingResult`, `EmbeddingInputType`) |
| `schema-v2.ts` | `file-chunks-index-v2` schema with single `embeddingVector` (1536d) |
| `VectorSearchService` | Dual-client routing (`getActiveSearchClient()`). All CRUD/search methods branch by flag. |
| `SemanticSearchService` | Unified path: single `embedQuery()` call. Graceful degradation (try/catch → empty results). |
| `environment.ts` | `USE_UNIFIED_INDEX`, `COHERE_ENDPOINT`, `COHERE_API_KEY` |
| Bicep | `keyvault-secrets.bicep` + `main.bicep`: conditional Cohere secrets |
| Tests | 35 new unit tests. All 4091 backend tests passing. |

**Design decisions that affect deployment:**
- `searchImages()` (find_similar_images) stays on v1 index until PRD-202 re-embeds images (1024d → 1536d dimension mismatch)
- AML vectorizer deferred to PRD-203 (not in schema-v2 yet)
- Cohere deployed via Azure CLI as model deployment on existing `AIServices` resource (no ML workspace needed)
- Dev uses eastus2 (existing resource); prod requires new `AIServices` resource in westeurope (GDPR)
- `USE_UNIFIED_INDEX=false` by default — zero impact on production until toggled

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
| `COHERE_ENDPOINT` | Azure AI Foundry endpoint URL | Key Vault + `.env` | `USE_UNIFIED_INDEX=true` |
| `COHERE_API_KEY` | Serverless endpoint API key | Key Vault + `.env` | `USE_UNIFIED_INDEX=true` |
| `USE_UNIFIED_INDEX` | `false` (default) | `.env` / Container App config | Always present, default false |

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

The app creates the index automatically on startup when `USE_UNIFIED_INDEX=true`. Alternatively:

```bash
# Manual index creation (if needed before app startup)
cd backend && npx tsx scripts/search/create-index-v2.ts
```

### 6. Feature Flag

```bash
# Dev: enable for testing (after Cohere endpoint is deployed)
USE_UNIFIED_INDEX=true

# Prod: keep FALSE until PRD-202 completes re-embedding
USE_UNIFIED_INDEX=false
```

### 7. Post-Deploy Verification

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
- [ ] `USE_UNIFIED_INDEX=false` → all existing behavior preserved (no regression)
- [ ] `USE_UNIFIED_INDEX=true` → `search_knowledge` generates Cohere embeddings and queries v2 index
- [ ] `find_similar_images` still works (uses v1 index with 1024d embeddings)
- [ ] Keyword search works without Cohere (no embeddings generated)

---

## PRD-202: Re-Embedding & Data Cutover

**Status**: Ready for deployment
**Prerequisites**: PRD-201 fully deployed (Cohere endpoint active, Key Vault secrets set, index v2 created)

### Code Changes Delivered

- `migrate-embeddings.ts` — One-time migration script (scan v1 → re-embed with Cohere → write to v2)
- `VectorSearchService.searchImages()` — Routes to v2/embeddingVector when unified=true
- `VectorSearchService.getV2SearchClient()` — Direct v2 client access for scripts
- `FileEmbedWorker` — Uses Cohere embedTextBatch when unified=true
- `ImageProcessor` — Uses Cohere embedImage when unified=true (keeps Azure Vision captions)
- `FileChunkingService` — Skips captionContentVector when unified=true
- `findSimilarImagesTool` — Dimension safety check during transition

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
# Set feature flag
# In .env or Azure Container App config:
USE_UNIFIED_INDEX=true

# Restart backend
# Then verify manually:
# - search_knowledge returns results from v2 index
# - find_similar_images works with 1536d embeddings
# - Keyword search still works
# - New file uploads use Cohere embeddings
```

### Step 6: Production Deployment

Repeat Steps 1-5 against production environment:

1. Deploy PRD-202 code to production (Container App)
2. Run `--dry-run` against prod AI Search
3. Run full migration (estimated 2-6 hours for large datasets)
4. Run `--validate` against prod data
5. Set `USE_UNIFIED_INDEX=true` in prod Container App config (no code deploy needed)
6. Monitor for 7 days:
   - Search latency (p95 within 20% of baseline)
   - Error rate (< 0.5%)
   - Search quality (user feedback)

### Rollback

```bash
# Instant rollback — config change only, no code deploy
USE_UNIFIED_INDEX=false
# Restart containers
# Old index (file-chunks-index) still active and serving

# Retain old index for 30 days
# After 30 days with no rollback needed:
#   - Delete file-chunks-index (v1) from AI Search
#   - Remove USE_UNIFIED_INDEX flag (always true)
#   - Remove legacy embedding code (OpenAI + Azure Vision)
```

### Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `USE_UNIFIED_INDEX` | `false` → `true` | Feature flag for cutover |
| `COHERE_ENDPOINT` | Azure AI Foundry URL | Set in PRD-201 |
| `COHERE_API_KEY` | API key | Set in PRD-201 |

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
# This happens automatically when the app creates/updates the index
# Or manually:
cd backend && npx tsx scripts/search/create-index-v2.ts
```

### Feature Flags

| Flag | Default | Enable When |
|---|---|---|
| `USE_QUERY_TIME_VECTORIZATION` | `false` | After benchmark confirms overhead < 100ms |

F1 (extractive answers) and F2 (response format) have **no feature flags** — they are additive and backward-compatible.

### Commands

```bash
# Benchmark query-time vectorization (requires USE_UNIFIED_INDEX=true)
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

1. [ ] **PRD-200**: Tool consolidation code deployed and verified
2. [ ] **PRD-201**: Cohere Embed 4 endpoint deployed to AI Foundry (dev)
3. [ ] **PRD-201**: `COHERE_ENDPOINT` + `COHERE_API_KEY` in Key Vault (dev)
4. [ ] **PRD-201**: Code deployed, `file-chunks-index-v2` created
5. [ ] **PRD-202**: Re-embedding job completed (all text + images)
6. [ ] **PRD-202**: Quality validation passed (top-5 overlap ≥ 80%)
7. [ ] **PRD-202**: `USE_UNIFIED_INDEX=true` enabled (dev)
8. [ ] **PRD-202**: `find_similar_images` verified with 1536d Cohere embeddings
9. [ ] **PRD-203**: Advanced search optimizations deployed (extractive answers, response format, query-time vectorization)
10. [ ] **PRD-203**: Extractive answers verified for factual queries
11. [ ] **PRD-203**: `responseDetail: 'concise'` verified (fewer tokens)
12. [ ] **PRD-203**: Benchmark script run: `npx tsx scripts/operations/benchmark-search.ts`
13. [ ] **PRD-203**: (Optional) `USE_QUERY_TIME_VECTORIZATION=true` after benchmark passes
14. [ ] **Cleanup**: Old OpenAI/Vision embedding code paths removed
15. [ ] **Cleanup**: Old `file-chunks-index` decommissioned (after 30-day rollback window)

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
6. [ ] Production pipeline: push to `production` branch
   ```bash
   git checkout production && git merge main && git push origin production
   ```
7. [ ] PRD-202 re-embedding job run against prod data
8. [ ] Quality validation passed (prod)
9. [ ] `USE_UNIFIED_INDEX=true` enabled (prod Container App config)
10. [ ] Monitor for 7 days: latency, error rates, search quality
11. [ ] Old index `file-chunks-index` decommissioned after 30-day rollback window

---

## Rollback Procedures

### PRD-201 Rollback (Cohere not working)
```bash
# Set feature flag back to false — instantly reverts to legacy dual-vector path
USE_UNIFIED_INDEX=false
# Restart app or redeploy
```

### PRD-202 Rollback (Quality regression after cutover)
```bash
# Revert feature flag — queries go back to old index immediately
USE_UNIFIED_INDEX=false
# Old index is preserved for 30 days, no data loss
```

### PRD-203 Rollback (Advanced features causing issues)
```bash
# Advanced features are additive — disable specific features via config or code revert
# AML vectorizer: remove from index schema via createOrUpdateIndex()
# Extractive answers: disable in SemanticSearchService
```
