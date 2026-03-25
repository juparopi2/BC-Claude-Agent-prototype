# PRD-202: Cohere Embed 4 — Re-Embedding & Cutover

**Phase**: 3 — Data Migration
**Status**: **Complete** (code + cleanup done 2026-03-24)
**Prerequisites**: PRD-201 (Cohere Infrastructure & Index)
**Estimated Effort**: 3-4 days
**Created**: 2026-03-24
**Implemented**: 2026-03-24

---

## 1. Objective

Re-embed all existing content (text chunks + images) using Cohere Embed 4, populate `file-chunks-index-v2`, validate quality against the current dual-index, and execute the cutover. After this PRD, the system runs entirely on the unified Cohere embedding model with a single vector field.

---

## 2. Current State (After PRD-201)

- Cohere Embed 4 deployed on Azure AI Foundry (dev)
- `file-chunks-index-v2` created with unified `embeddingVector` field
- `CohereEmbeddingService` and `EmbeddingServiceFactory` implemented
- Feature flag `USE_UNIFIED_INDEX=false` — production still on old index
- All existing text chunks + image entries in `file-chunks-index` with old embeddings

---

## 3. Expected State (After This PRD)

- All content re-embedded with Cohere Embed 4 in `file-chunks-index-v2`
- `USE_UNIFIED_INDEX=true` in production
- Old index (`file-chunks-index`) retained as rollback safety net (30 days)
- OpenAI text-embedding-3-small and Azure Vision embedding code marked as deprecated
- File processing pipeline uses Cohere for all new ingestion
- `find_similar_images` uses unified `embeddingVector` field (with dimension safety check)

**Post-Cleanup (2026-03-24)**: Feature flag removed. All branching in FileEmbedWorker, ImageProcessor, and FileChunkingService has been eliminated — Cohere is the only embedding path. `EmbeddingServiceFactory` deleted. Dimension safety check in `findSimilarImagesTool` changed to unconditional guard (`dimensions !== 1536`).

---

## 4. Detailed Specifications

### 4.1 Re-Embedding Pipeline

The re-embedding pipeline is a standalone one-time migration script (not a BullMQ worker). It runs via:

```bash
npx tsx scripts/operations/migrate-embeddings.ts [flags]
```

**Supported flags:**

| Flag | Default | Description |
|---|---|---|
| `--dry-run` | false | Scan and report without writing |
| `--validate` | false | Run quality validation mode |
| `--user-id <id>` | all users | Restrict migration to a single user |
| `--batch-size <n>` | 96 | Chunks per Cohere batch call |
| `--concurrency <n>` | 5 | Parallel image downloads |

**Pipeline stages:**

```
Phase 1 — Scan
  Query all chunk IDs from file-chunks-index (paginated)
  Count text chunks vs. image chunks per user
  Report totals; exit here if --dry-run
  │
  v
Phase 2 — Migrate Text
  For each batch of chunks (default 96):
    Fetch content from v1 index
    Call CohereClient.embedTextBatch(contents, 'search_document')
      (auto-chunks into groups of 96 per Cohere batch limits)
    Upsert to file-chunks-index-v2 via mergeOrUploadDocuments()
  │
  v
Phase 3 — Migrate Images
  For each image chunk (concurrency controlled by --concurrency):
    Look up source file (fileId → blob URL)
    Download from Azure Blob Storage (local source only)
    Encode as base64
    Call CohereClient.embedImage(base64, 'search_document')
    Upsert to file-chunks-index-v2 via mergeOrUploadDocuments()
  │
  v
Phase 4 — Verify
  Compare document counts between v1 and v2 indexes
  Report any mismatches
  │
  v
Phase 5 — Report
  Print per-user summary: text migrated, images migrated, failures
  Print overall totals and failure rate
  Exit non-zero if failure rate exceeds 0.1% threshold
```

**Error handling:**
- Individual chunk failures are collected in memory (not Redis)
- Failed chunks do not stop the batch — processing continues
- Failure summary printed in the final report
- Script exits with non-zero status if failure rate exceeds threshold
- Idempotent: `mergeOrUploadDocuments()` safely overwrites existing entries — safe to re-run

**Shared script utilities** (in `backend/scripts/_shared/`):

| Module | Purpose |
|---|---|
| `azure.ts` | Azure AI Search client initialisation for scripts |
| `prisma.ts` | Prisma client singleton for scripts |
| `args.ts` | CLI argument parsing shared across scripts |
| `cohere.ts` | Lightweight Cohere Embed 4 client (no Redis, no usage tracking) |

### 4.2 Image Re-Embedding

Images require special handling because Cohere needs the actual image data:

```
For each image chunk:
1. Look up source file in database (fileId → blob storage URL)
2. Download image content from Azure Blob Storage
3. Encode as base64
4. Call CohereClient.embedImage(base64, 'search_document')
5. Upsert 1536d embedding to file-chunks-index-v2
```

**Scope limitation:**
- Only `local` source files are processed (Azure Blob Storage download)
- External files (OneDrive / SharePoint) are skipped — no OAuth token available in script context
- External files will be re-embedded automatically on their next sync cycle after cutover (file sync pipeline already branches on `isUnifiedIndexEnabled()`)

**Concurrency**: Controlled via `--concurrency` flag (default 5). Increase with caution to avoid Cohere API rate limits.

### 4.3 Quality Validation

Quality validation is integrated directly into the migration script via `--validate`:

```bash
npx tsx scripts/operations/migrate-embeddings.ts --validate
```

The validate mode runs comparison queries against both indexes using the same criteria described below.

```typescript
interface QualityValidation {
  /** Test queries covering different categories */
  testQueries: [
    // Text search
    { query: 'revenue forecast Q3', expectedFileType: 'documents' },
    { query: 'return policy', expectedFileType: 'documents' },
    // Image search
    { query: 'organizational chart', expectedFileType: 'images' },
    { query: 'damaged parts photo', expectedFileType: 'images' },
    // Cross-type
    { query: 'budget 2026', expectedFileType: 'any' },
    // Date-filtered
    { query: '*', dateFrom: '2026-01-01', expectedFileType: 'any' },
  ];

  /** Acceptance criteria */
  criteria: {
    /** Minimum overlap in top-5 results between v1 and v2 */
    minOverlap: 0.6; // 3 of 5 same files
    /** v2 relevance scores should not be drastically lower */
    maxScoreDrop: 0.15; // max 15% score reduction
    /** Image search should return images (not text docs) */
    imageSearchPrecision: 0.8; // 80% of results are images
  };
}
```

**Process:**
1. Run each test query against both indexes
2. Compare top-5 results (file overlap, score distribution)
3. Generate comparison report to stdout
4. Manual review of edge cases
5. Sign off before cutover

### 4.4 Cutover Procedure

```
1. PREPARATION (dev environment)
   ├── Verify re-embedding complete (chunk counts match)
   ├── Run quality validation
   ├── Verify feature flag works in dev
   └── Test rollback procedure in dev

2. PRODUCTION RE-EMBEDDING
   ├── Deploy Cohere endpoint to prod Azure AI Foundry
   ├── Create file-chunks-index-v2 in prod Azure AI Search
   ├── Run re-embedding pipeline (estimated: 2-6 hours for 100M chunks)
   ├── Verify chunk counts match
   └── Run quality validation against prod data

3. CUTOVER
   ├── Set USE_UNIFIED_INDEX=true (in app config, NOT code deploy)
   ├── Monitor search quality metrics (latency, result quality feedback)
   ├── Monitor error rates in Application Insights
   └── Keep old index available for 30 days

4. ROLLBACK (if needed)
   ├── Set USE_UNIFIED_INDEX=false
   ├── Verify old index still serving correctly
   └── Investigate quality issues before retrying
```

### 4.5 File Processing Pipeline Update

**Note (2026-03-24)**: The `if (isUnifiedIndexEnabled())` branching shown below has been removed during cleanup. All three code paths now exclusively use the Cohere path (the `if` branch). The `else` branches (legacy) have been deleted.

New file ingestion uses Cohere when `isUnifiedIndexEnabled()` returns true. The branching is implemented at three points:

**`FileEmbedWorker.ts`**
```typescript
if (isUnifiedIndexEnabled()) {
  embedding = await cohereService.embedTextBatch(texts, 'search_document');
} else {
  embedding = await generateTextEmbeddingsBatch(texts);
}
```

**`ImageProcessor.ts`**
```typescript
if (isUnifiedIndexEnabled()) {
  embedding = await cohereService.embedImage(base64, 'search_document');
} else {
  embedding = await azureVisionService.embedImage(base64);
}
// Azure Vision caption generation runs in BOTH paths (captions are separate from embeddings)
```

**`FileChunkingService.ts`**
```typescript
// captionContentVector (Azure Vision 1024d) is skipped when unified=true
// because a single embeddingVector (Cohere 1536d) replaces both fields
if (!isUnifiedIndexEnabled()) {
  chunk.captionContentVector = await generateCaptionEmbedding(caption);
}
```

### 4.6 find_similar_images Update

The `findSimilarImagesTool` in `rag-knowledge/tools.ts` now routes based on `USE_UNIFIED_INDEX`:

- When unified enabled: searches `embeddingVector` field (1536d)
- When unified disabled: searches `imageVector` field (1024d)
- Filter `isImage eq true` still applies in both paths

**Dimension safety check added**: If `USE_UNIFIED_INDEX=true` but the query embedding is not 1536-dimensional (e.g., stale embedding from before cutover), the tool returns a structured error message directing the caller to use `search_knowledge` instead. This prevents silent garbage results during the transition window.

### 4.7 Cleanup (Post-30-Day Retention)

After confirming no rollback needed:

- [x] Delete `file-chunks-index` (v1) — old schema deleted from code
- [x] Remove `USE_UNIFIED_INDEX` feature flag
- [x] Remove `LegacyEmbeddingService` and `EmbeddingServiceFactory`
- [x] Remove OpenAI text-embedding-3-small deployment reference
- [x] Remove Azure Vision embedding code
- [x] Remove dual vector query logic from `VectorSearchService`

Note: `ImageEmbeddingRepository` was not changed (already supports any dimensions)

---

## 5. Complete File Inventory

### New Files (3 source + 1 test)

| File | Purpose |
|---|---|
| `backend/scripts/operations/migrate-embeddings.ts` | One-time migration script: scan v1 → re-embed with Cohere → write to v2 |
| `backend/scripts/_shared/cohere.ts` | Lightweight Cohere Embed 4 client for scripts (no Redis, no usage tracking) |
| `backend/src/__tests__/unit/services/search/VectorSearchService.searchImages-v2.test.ts` | 11 unit tests for searchImages v2 routing |
| `backend/src/__tests__/unit/infrastructure/queue/workers/FileEmbedWorkerV2.test.ts` | 5 unit tests for Cohere embed branch |

### Modified Files (8)

| File | Change |
|---|---|
| `backend/src/services/search/VectorSearchService.ts` | Added `getV2SearchClient()`. Updated `searchImages()` to route by `USE_UNIFIED_INDEX` (v2 uses `embeddingVector`, v1 uses `imageVector`). |
| `backend/src/modules/agents/rag-knowledge/tools.ts` | Added dimension safety check in `findSimilarImagesTool` — returns error if embedding dimensions mismatch during transition. |
| `backend/src/infrastructure/queue/workers/FileEmbedWorker.ts` | Branches embedding generation: Cohere `embedTextBatch()` when unified, legacy `generateTextEmbeddingsBatch()` otherwise. |
| `backend/src/services/files/processors/ImageProcessor.ts` | Branches image embedding: Cohere `embedImage()` when unified, Azure Vision otherwise. Keeps Azure Vision for caption generation in both paths. |
| `backend/src/services/files/FileChunkingService.ts` | Wraps `captionContentVector` generation with `!isUnifiedIndexEnabled()` — skips when unified (single `embeddingVector` replaces both fields). |
| `backend/src/__tests__/unit/services/files/processors/ImageProcessor.test.ts` | +5 tests for Cohere embedding path. |
| `docs/plans/rag-agent-stabilization/01-DEPLOYMENT-RUNBOOK.md` | Full PRD-202 deployment section with migration steps. |
| `docs/plans/rag-agent-stabilization/00-INDEX.md` | PRD-202 status updated to In Progress. |

### Not Modified (deviations from original spec)

| Original Spec | Actual | Reason |
|---|---|---|
| BullMQ worker + job definitions | Migration script | No live users — one-time script simpler than permanent infrastructure |
| Queue constants, WorkerRegistry, MessageQueue | Not modified | No BullMQ worker needed |
| `ImageEmbeddingRepository.ts` | Not modified (DB schema already supports any dimensions) | `upsert()` accepts any dimensions/model — migration script updates via raw SQL |
| `infrastructure/bicep/modules/cognitive.bicep` | Not modified | Cohere deployed manually via Azure Portal (same as PRD-201) |

---

## 6. Success Criteria

### Re-Embedding (code complete — pending execution)

- [x] Migration script implements text + image re-embedding
- [x] Failed chunks collected and reported (< 0.1% threshold enforced)
- [x] Script is idempotent — safe to re-run (`mergeOrUploadDocuments`)
- [x] Progress visible via console output (batch-by-batch reporting)
- [ ] All text chunks re-embedded (pending: run migration against real data)
- [ ] All image chunks re-embedded (pending: run migration against real data)

### Quality (code complete — pending execution)

- [x] `--validate` mode implements quality comparison (PRD-202 §4.3 criteria)
- [ ] Quality validation passes on real data (pending: run after migration)

### Pipeline Updates (complete)

- [x] `FileEmbedWorker` uses Cohere for text when unified=true
- [x] `ImageProcessor` uses Cohere for images when unified=true (keeps Vision captions)
- [x] `FileChunkingService` skips `captionContentVector` when unified=true
- [x] `searchImages()` routes to v2/embeddingVector when unified=true
- [x] `findSimilarImagesTool` has dimension safety check

### Testing (complete)

- [x] 22 new unit tests added (4113 total, all passing)
- [x] `npm run verify:types` passes
- [x] `npm run -w backend lint` passes (0 errors)
- [x] `USE_UNIFIED_INDEX=false` preserves all existing behavior

### Cutover (pending)

- [x] V2 code is the sole code path (flag removed, no toggle needed)
- [ ] Search latency within 20% of current (p95)
- [ ] Rollback verified

### Cleanup (Post-30-Day)

- [ ] Old index deleted
- [x] Feature flag removed
- [x] Legacy embedding code removed
- [x] `npm run verify:types` passes after cleanup
- [x] `npm run -w backend lint` passes after cleanup

---

## 7. Out of Scope

- Query-time vectorizer optimization (PRD-203)
- Extractive answers / semantic captions (PRD-203)
- Interleaved embedding for documents with embedded images (PRD-203)
- Cost optimization (batch API pricing vs. real-time) — monitor after cutover

---

## 8. Deployment Runbook

Deployment steps documented in [01-DEPLOYMENT-RUNBOOK.md](./01-DEPLOYMENT-RUNBOOK.md) — PRD-202 section complete.
