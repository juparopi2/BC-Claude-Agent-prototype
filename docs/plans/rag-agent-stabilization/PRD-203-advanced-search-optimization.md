# PRD-203: Advanced Search Capabilities & Optimization

**Phase**: 4 — Optimization
**Status**: **Implemented** (code) — F1-F3 shipped, F4-F5 deferred
**Prerequisites**: PRD-202 (Cohere Data Cutover)
**Estimated Effort**: 2-3 days
**Created**: 2026-03-24
**Last Updated**: 2026-03-24

---

## 1. Objective

Leverage the unified Cohere Embed 4 index and the power search tool design from PRD-200 to unlock advanced Azure AI Search features that improve result quality and reduce token usage. These are optimizations that build on the stable foundation of phases 1-3.

---

## 2. Current State (After PRD-202)

- Unified Cohere Embed 4 index live in production
- Power search tool with LLM-controlled parameters
- Semantic ranker enabled for hybrid/semantic queries
- Native AML vectorizer configured but not yet used for query-time vectorization
- All search results return full content passages (no extractive summaries)

---

## 3. Deliverables

### 3.1 Extractive Answers & Captions

Azure AI Search Semantic Ranker can return **extractive answers** (direct answers to questions) and **captions** (highlighted snippets) without additional cost when semantic ranking is already enabled.

**How it works:**
```typescript
// Add to semantic search requests
answers: 'extractive|count-3',
captions: 'extractive|highlight-true',
```

**Impact on CitationResult:**
- Add `extractiveAnswer` field to response (when available)
- Add `highlightedCaption` to `CitationPassage` (when available)
- Agent can use extractive answers to respond directly without reading full passages
- Reduces token usage for straightforward factual questions

**Implementation:**
```typescript
// CitationResult extension
interface CitationResult {
  // ... existing fields
  extractiveAnswers?: Array<{
    text: string;
    score: number;
    sourceFileId: string;
  }>;
}

// CitationPassage extension
interface CitationPassage {
  // ... existing fields
  highlightedCaption?: string; // With <em> tags for highlights
}
```

### 3.2 Response Format Control

Add a `responseDetail` parameter to `search_knowledge` that controls how much data is returned:

```typescript
responseDetail: z.enum(['concise', 'detailed']).optional().describe(
  'Controls response verbosity. Default: "detailed". ' +
  '"concise": returns file names, scores, and extractive answers only (fewer tokens). ' +
  '"detailed": returns full passages, excerpts, and metadata (current behavior). ' +
  'Use "concise" for initial exploration, "detailed" when analyzing specific results.'
),
```

**Token reduction**: Concise mode reduces response size by ~65% (Anthropic engineering data), allowing the agent to search more broadly without hitting context limits.

**Implementation:**
- `concise`: Return only `fileName`, `documentRelevance`, `extractiveAnswers`, `highlightedCaption` per result. Omit full `passages[].excerpt`.
- `detailed`: Current behavior (full passages).

### 3.3 Query-Time Vectorization

Use the native AML vectorizer (configured in PRD-201) instead of pre-computing embeddings in application code:

```typescript
// Before: application generates embedding, sends vector
vectorQueries: [
  { kind: 'vector', vector: await cohere.embedText(query, 'search_query'), fields: 'embeddingVector' },
]

// After: Azure AI Search generates embedding via native vectorizer
vectorQueries: [
  { kind: 'text', text: query, fields: 'embeddingVector' },
]
```

**Benefits:**
- Removes embedding generation from application hot path
- Azure AI Search caches vectorizer results
- Simplifies SemanticSearchService (no more parallel embedding generation)
- Native integration = lower latency than external API call + search call sequentially

**Prerequisite:** Benchmark query-time vectorization latency vs. pre-computed. Only enable if overhead < 100ms.

### 3.4 Interleaved Embeddings for Rich Documents

Cohere Embed 4 supports interleaved text+image input. For documents with embedded charts, diagrams, or screenshots, generate a single embedding that captures both textual and visual content:

```typescript
// During indexing: PDF page with chart
const embedding = await cohere.embedInterleaved([
  { type: 'text', text: 'Q3 Revenue Analysis showing 15% growth...' },
  { type: 'image', base64: chartImageBase64 },
], 'search_document');
```

**Impact:** A text query like "revenue growth chart" would match this chunk better because the embedding captures both the textual description AND the visual chart content.

**Scope:** Only for documents where images are extracted during processing (PDFs with embedded images). Not a retroactive re-embedding — applies to newly processed/re-processed files.

### 3.5 Performance Tuning

Post-unification optimizations:

| Parameter | Current | Proposed | Rationale |
|---|---|---|---|
| HNSW `efSearch` | 500 | 250 | Single vector field needs fewer candidates. Benchmark first. |
| HNSW `m` | 4 | 6 | Slightly higher connectivity for unified space. Benchmark first. |
| `fetchTopK` multiplier | `maxFiles * maxChunksPerFile * 3` | `maxFiles * maxChunksPerFile * 2` | Unified field = less duplicate effort. |
| Semantic ranker `k` | 50 (implicit) | 50 (explicit) | Keep at 50 per Microsoft recommendation. |

All changes require A/B benchmarking before deployment.

---

## 4. Implementation Priority

| Feature | Effort | Impact | Priority | Status |
|---|---|---|---|---|
| Extractive answers & captions | Low (config change) | High (direct answers, fewer tokens) | **P1** | **Implemented** |
| Response format control | Medium (tool + service change) | Medium (token savings) | **P2** | **Implemented** |
| Query-time vectorization | Low (conditional flag) | Medium (simplification) | **P2** | **Implemented** (flag OFF) |
| Interleaved embeddings | Medium (pipeline change) | Low (niche use case) | **P3** | Deferred |
| Performance tuning | Medium (benchmarking) | Low-Medium (latency) | **P3** | Deferred |

---

## 5. Complete File Inventory

### Modified Files (9)

| File | Change |
|---|---|
| `packages/shared/src/schemas/citation-result.schemas.ts` | Add `ExtractiveAnswerSchema`, `highlightedCaption` to passages, `extractiveAnswers` to result |
| `packages/shared/src/schemas/index.ts` | Export `ExtractiveAnswerSchema` and `ExtractiveAnswer` type |
| `packages/shared/src/types/index.ts` | Export `ExtractiveAnswer` type |
| `backend/src/services/search/types.ts` | Add `captionText`/`captionHighlights` to `SemanticSearchResult`, `ExtractiveSearchAnswer`, `SemanticSearchFullResult` |
| `backend/src/services/search/VectorSearchService.ts` | Request extractive answers/captions, capture results, support `kind: 'text'` queries, return `SemanticSearchFullResult` |
| `backend/src/services/search/semantic/types.ts` | Add `highlightedCaption` to `SemanticChunk`, `ResolvedExtractiveAnswer`, `extractiveAnswers` to response |
| `backend/src/services/search/semantic/SemanticSearchService.ts` | Propagate extractive features, resolve chunkId→fileId, skip embedding for query-time vectorization |
| `backend/src/modules/agents/rag-knowledge/tools.ts` | Add `responseDetail` parameter, concise mode, map extractive answers to CitationResult |
| `backend/src/modules/agents/rag-knowledge/validation.ts` | Add `responseDetail` to input/output types and defaults |
| `backend/src/services/search/schema-v2.ts` | Add conditional Cohere vectorizer to vector search config |
| `backend/src/infrastructure/config/environment.ts` | Add `USE_QUERY_TIME_VECTORIZATION` feature flag |

### New Files (3)

| File | Purpose |
|---|---|
| `backend/scripts/operations/benchmark-search.ts` | Benchmark search quality and latency: app-side vs query-time vectorization |
| `backend/src/__tests__/unit/services/search/VectorSearchService.extractive.test.ts` | Tests for extractive answers and captions |
| `backend/src/__tests__/unit/services/search/VectorSearchService.queryTimeVectorization.test.ts` | Tests for query-time vectorization flag |

---

## 6. Success Criteria

- [ ] Extractive answers returned for factual queries ("what is the return policy?")
- [ ] Highlighted captions available in citation passages
- [ ] `responseDetail: 'concise'` reduces response token count by > 50%
- [ ] Query-time vectorization latency < 100ms overhead (or feature disabled)
- [ ] No regression in search quality (quality validation suite from PRD-202)
- [ ] `npm run verify:types` passes
- [ ] `npm run -w backend lint` passes

---

## 7. Out of Scope

- Faceted search (not useful in RAG agent context — agent doesn't show filter UI)
- Skip/offset pagination (top-K is sufficient for RAG)
- Custom scoring profiles (pre-configured is sufficient)
- Multi-index federation (single unified index is the goal)
- Agentic Retrieval (Azure preview, no SLA — revisit when GA)

---

## 8. Deployment Runbook

After implementing this PRD, update the deployment section in [01-DEPLOYMENT-RUNBOOK.md](./01-DEPLOYMENT-RUNBOOK.md) with actual commands, env vars, and verification steps.
