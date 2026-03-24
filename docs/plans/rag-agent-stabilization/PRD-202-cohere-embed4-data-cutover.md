# PRD-202: Cohere Embed 4 — Re-Embedding & Cutover

**Phase**: 3 — Data Migration
**Status**: Proposed
**Prerequisites**: PRD-201 (Cohere Infrastructure & Index)
**Estimated Effort**: 3-4 days
**Created**: 2026-03-24

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
- `find_similar_images` uses unified `embeddingVector` field
- `ImageEmbeddingRepository` updated to store Cohere embeddings (1536d)

---

## 4. Detailed Specifications

### 4.1 Re-Embedding Pipeline

A BullMQ-based batch job that processes all existing content:

```typescript
interface ReEmbeddingJob {
  /** Process chunks in batches of 100 */
  batchSize: 100;
  /** Cohere batch API for cost efficiency */
  useBatchApi: true;
  /** Resume from last processed chunkId on failure */
  resumable: true;
  /** Track progress in Redis */
  progressKey: 'reembedding:progress';
}
```

**Pipeline stages:**

```
1. Query all chunkIds from file-chunks-index (paginated, 1000 per page)
   │
   v
2. For each batch of 100 chunks:
   a. Fetch content from index (text content or image reference)
   b. Generate Cohere embeddings:
      - Text chunks: embedText(content, 'search_document')
      - Image chunks: embedImage(imageBase64, 'search_document')
   c. Upsert to file-chunks-index-v2 with embeddingVector
   d. Update progress counter in Redis
   │
   v
3. Verify counts match between v1 and v2 indexes
   │
   v
4. Run quality validation (section 4.3)
```

**Error handling:**
- Individual chunk failures logged but don't stop the batch
- Failed chunks collected in `reembedding:failures` Redis set
- Retry queue for failed chunks (3 attempts with exponential backoff)
- Progress dashboard via existing admin API

### 4.2 Image Re-Embedding

Images require special handling because Cohere needs the actual image data, not just the Azure Vision embedding:

```
For each image chunk:
1. Look up source file in database (fileId → blob storage URL or Graph API path)
2. Download image content (from Azure Blob or via Graph API)
3. Encode as base64
4. Call CohereEmbeddingService.embedImage(base64, 'search_document')
5. Store 1536d embedding in file-chunks-index-v2
6. Update ImageEmbeddingRepository with new 1536d embedding
```

**Optimization**: Process images in parallel (concurrency: 10) with rate limiting to stay within Cohere API limits.

### 4.3 Quality Validation

Before cutover, run a comparison test:

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
3. Generate comparison report
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

After cutover, new file ingestion must use Cohere:

```typescript
// backend/src/services/files/processing/
// Update text chunking pipeline
const embedding = await cohereService.embedText(chunkContent, 'search_document');
// Index to file-chunks-index-v2 with embeddingVector field

// Update image processing pipeline
const embedding = await cohereService.embedImage(imageBase64, 'search_document');
// Index to file-chunks-index-v2 with embeddingVector field
// Store in ImageEmbeddingRepository (1536d instead of 1024d)
```

### 4.6 find_similar_images Update

The `find_similar_images` tool currently reads 1024d embeddings from `ImageEmbeddingRepository` and searches `imageVector`. After cutover:

- `ImageEmbeddingRepository` stores 1536d Cohere embeddings
- Search targets `embeddingVector` field (not `imageVector`)
- Filter `isImage eq true` still applies (same field exists in v2)
- No tool schema changes needed — only implementation

### 4.7 Cleanup (Post-30-Day Retention)

After confirming no rollback needed:

- Delete `file-chunks-index` (v1) from Azure AI Search
- Remove `USE_UNIFIED_INDEX` feature flag (always true)
- Remove `LegacyEmbeddingService` and `EmbeddingServiceFactory`
- Remove OpenAI text-embedding-3-small deployment (if not used elsewhere)
- Remove Azure Vision embedding code
- Update `ImageEmbeddingRepository` to only handle 1536d
- Remove dual vector query logic from `VectorSearchService`

---

## 5. Complete File Inventory

### New Files (3)

| File | Purpose |
|---|---|
| `backend/src/infrastructure/queue/workers/reembedding-worker.ts` | BullMQ worker for batch re-embedding job |
| `backend/src/infrastructure/queue/jobs/reembedding-job.ts` | Job definition: batch size, progress tracking, retry logic |
| `backend/scripts/operations/run-reembedding.ts` | CLI script to trigger and monitor re-embedding pipeline |

### Modified Files (7)

| File | Change |
|---|---|
| `backend/src/services/files/processing/TextChunkProcessor.ts` | Use `EmbeddingServiceFactory` for Cohere when unified index enabled |
| `backend/src/services/files/processing/ImageProcessor.ts` | Use `CohereEmbeddingService` for image embedding when enabled |
| `backend/src/services/search/VectorSearchService.ts` | Simplified single-vector query path for v2 index |
| `backend/src/modules/agents/rag-knowledge/tools.ts` | `find_similar_images` searches `embeddingVector` when unified |
| `backend/src/services/search/ImageEmbeddingRepository.ts` | Support 1536d embeddings alongside 1024d during transition |
| `backend/src/infrastructure/queue/queues.ts` | Register re-embedding queue and worker |
| `infrastructure/bicep/modules/cognitive.bicep` | Cohere endpoint deployment for production |

---

## 6. Success Criteria

### Re-Embedding

- [ ] All text chunks re-embedded (count matches v1 index)
- [ ] All image chunks re-embedded (count matches v1 index)
- [ ] Failed chunks < 0.1% of total
- [ ] Re-embedding pipeline resumable after interruption
- [ ] Progress visible via admin API / logs

### Quality

- [ ] Quality validation passes all criteria (section 4.3)
- [ ] Text search quality ≥ current (MTEB-style evaluation on test set)
- [ ] Image search returns images (not text docs) for visual queries
- [ ] Cross-modal: text query "chart showing revenue" returns relevant images

### Cutover

- [ ] `USE_UNIFIED_INDEX=true` serves production traffic
- [ ] No increase in search error rate (< 0.5%)
- [ ] Search latency within 20% of current (p95)
- [ ] Rollback to v1 index works within 1 minute (config change)

### Cleanup (Post-30-Day)

- [ ] Old index deleted
- [ ] Feature flag removed
- [ ] Legacy embedding code removed
- [ ] `npm run verify:types` passes after cleanup
- [ ] `npm run -w backend lint` passes after cleanup

---

## 7. Out of Scope

- Query-time vectorizer optimization (PRD-203)
- Extractive answers / semantic captions (PRD-203)
- Interleaved embedding for documents with embedded images (PRD-203)
- Cost optimization (batch API pricing vs. real-time) — monitor after cutover

---

## 8. Deployment Runbook

After implementing this PRD, update the deployment section in [01-DEPLOYMENT-RUNBOOK.md](./01-DEPLOYMENT-RUNBOOK.md) with actual commands, env vars, and verification steps.
