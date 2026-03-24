# RAG Agent Stabilization — Deployment Runbook

**Project**: RAG Agent Tool Redesign & Embedding Unification
**Created**: 2026-03-24
**Last Updated**: 2026-03-24 (PRD-201 code complete)

## Purpose

Single reference for all infrastructure, configuration, migration, and deployment steps required to bring the RAG Agent Stabilization initiative from dev to production. Each PRD appends its section as implementation completes. Execute sections in order.

## Pre-Requisites (shared across all PRDs)

- Azure CLI authenticated (`az login`)
- Access to Key Vault (`kv-bcagent-dev` / `kv-myworkmate-prod`)
- Bicep CLI installed (`az bicep install`)
- Backend running locally or in Container Apps
- Node.js + npm workspace setup (`npm install` from root)

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
- Cohere endpoint deployed manually via Azure Portal (no ML workspace in Bicep)
- `USE_UNIFIED_INDEX=false` by default — zero impact on production until toggled

### 1. Azure AI Foundry — Deploy Cohere Embed 4 (Manual)

Deploy via Azure Portal (no Bicep IaC for ML workspace yet):

```
Portal: Azure AI Foundry → Model Catalog → "Cohere-embed-v4" → Deploy as Serverless
Region: Same as existing resources (eastus recommended — matches OpenAI deployment)
Deployment type: Serverless (pay-per-token)
```

After deployment, note:
- **Endpoint URL**: `https://<name>.<region>.models.ai.azure.com`
- **API Key**: Shown in deployment details

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

## PRD-202: Cohere Embed 4 — Re-Embedding & Cutover

**Status:** ☐ Pending
<!-- This section is filled in when PRD-202 implementation starts -->

### Env Vars
| Variable | Change | Notes |
|---|---|---|
| `USE_UNIFIED_INDEX` | `false` → `true` | Cutover toggle |
<!-- Additional vars TBD -->

### Resources
- Re-embedding BullMQ job queue and worker
- Redis progress tracking keys (`reembedding:progress`, `reembedding:failures`)
<!-- Additional resources TBD -->

### Migrations
- `ImageEmbeddingRepository` schema: update dimension from 1024 to 1536
- Re-embed all text chunks with Cohere Embed 4 (`search_document` input type)
- Re-embed all images with Cohere Embed 4 (base64 → `embeddingVector`)
<!-- Additional migrations TBD -->

### Feature Flags
- `USE_UNIFIED_INDEX=true` — production cutover (after quality validation)

### Commands
<!-- TBD: re-embedding script, quality validation, cutover toggle, rollback procedure -->

### Post-Deploy Verification
- [ ] All text chunks re-embedded in `file-chunks-index-v2`
- [ ] All images re-embedded in `file-chunks-index-v2`
- [ ] Quality validation: top-5 result overlap ≥ 80% with current index
- [ ] `USE_UNIFIED_INDEX=true` enabled in production
- [ ] `find_similar_images` works with new 1536d Cohere embeddings
- [ ] 30-day rollback window: old index (`file-chunks-index`) preserved

---

## PRD-203: Advanced Search Optimization

**Status:** ☐ Pending
<!-- This section is filled in when PRD-203 implementation starts -->

### Env Vars
<!-- TBD -->

### Resources
- AML vectorizer on `file-chunks-index-v2` (Cohere query-time vectorization)
<!-- Additional resources TBD -->

### Migrations
- Update index schema with AML vectorizer via `createOrUpdateIndex()`
<!-- Additional migrations TBD -->

### Feature Flags
<!-- TBD -->

### Commands
<!-- TBD: schema update script, vectorizer configuration -->

### Post-Deploy Verification
- [ ] Extractive answers enabled for semantic queries
- [ ] Query-time vectorization working (native AML vectorizer)
- [ ] Response format control (`concise` vs `full`)
- [ ] HNSW parameter tuning applied
<!-- Additional verification TBD -->

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
9. [ ] **PRD-203**: Advanced search optimizations deployed
10. [ ] **PRD-203**: AML vectorizer configured on `file-chunks-index-v2`
11. [ ] **PRD-203**: Extractive answers and query-time vectorization verified
12. [ ] **Cleanup**: Old OpenAI/Vision embedding code paths removed
13. [ ] **Cleanup**: Old `file-chunks-index` decommissioned (after 30-day rollback window)

### Production Environment

1. [ ] All dev environment verification passed
2. [ ] Cohere Embed 4 endpoint deployed to AI Foundry (prod region)
3. [ ] `COHERE_ENDPOINT` + `COHERE_API_KEY` in Key Vault (prod):
   ```bash
   az keyvault secret set --vault-name kv-myworkmate-prod \
     --name COHERE-ENDPOINT --value "<prod-endpoint>"
   az keyvault secret set --vault-name kv-myworkmate-prod \
     --name COHERE-API-KEY --value "<prod-key>"
   ```
4. [ ] Bicep deployment (if updating infrastructure):
   ```bash
   bash infrastructure/scripts/deploy.sh
   ```
5. [ ] Production pipeline: push to `production` branch
   ```bash
   git checkout production && git merge main && git push origin production
   ```
6. [ ] PRD-202 re-embedding job run against prod data
7. [ ] Quality validation passed (prod)
8. [ ] `USE_UNIFIED_INDEX=true` enabled (prod Container App config)
9. [ ] Monitor for 7 days: latency, error rates, search quality
10. [ ] Old index `file-chunks-index` decommissioned after 30-day rollback window

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
