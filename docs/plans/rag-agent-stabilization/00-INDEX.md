# RAG Agent Stabilization — Master Plan

**Project**: RAG Agent Tool Redesign & Embedding Unification
**Status**: Proposed
**Created**: 2026-03-24
**Last Updated**: 2026-03-24

---

## 1. Business Context

The RAG Agent is MyWorkMate's knowledge retrieval specialist. It searches user files using Azure AI Search with dual vector fields (text-embedding-3-small 1536d + Azure Vision 1024d). The current tool design has three problems:

1. **Ambiguity**: 3 tools with overlapping scopes. The LLM frequently picks the wrong one (e.g., `search_knowledge` vs `visual_image_search` for "find photos of red cars").
2. **Rigidity**: Hardcoded thresholds, result limits, and search modes prevent the LLM from adapting search strategy to query intent.
3. **Dual-index complexity**: Two separate vector fields with different dimensions, models, and weights add architectural overhead with no user-facing benefit.

This initiative addresses all three through tool consolidation, power tool design, and embedding unification via Cohere Embed 4.

### Guiding Principles (from Anthropic & Microsoft Research)

| # | Principle | Source | Application |
|---|---|---|---|
| P1 | **Fewer, more powerful tools** | Anthropic — "Writing Tools for Agents" | Consolidate 3 tools → 2. Eliminate ambiguity by basing tool selection on **input nature** (text vs. image reference). |
| P2 | **Rich descriptions with examples** | Anthropic — "Advanced Tool Use" (72% → 90% accuracy with `input_examples`) | 3-4 sentence descriptions + 3-5 realistic input examples per tool. |
| P3 | **LLM controls search strategy** | Microsoft — Azure AI Search REST API, Anthropic — power tool pattern | Expose `searchType`, `top`, `minRelevanceScore`, `sortBy` as parameters. |
| P4 | **Smart defaults, strict validation** | Anthropic — "errors as steering mechanisms" | Conditional defaults (images → top:10, docs → top:5). Clamp out-of-range values. Override invalid queries. |
| P5 | **Error passthrough with guidance** | Anthropic — `is_error: true` pattern | Return Azure AI Search errors to agent with actionable fix suggestions. |
| P6 | **Security at the boundary** | MyWorkMate multi-tenant invariant | `userId` + `scopeFilter` always injected server-side. Never exposed as parameters. |
| P7 | **Unified vector space** | Cohere Embed 4 (GA, Azure-native) | Single 1536d field for text + images. Eliminates searchMode routing. |

---

## 2. Investigation Summary

### What was evaluated

| Option | Verdict | Reason |
|---|---|---|
| Azure Agentic Retrieval | **Descartado** | Preview sin SLA. Solo OpenAI models. Agrega latencia sin resolver ambiguedad de tools. |
| Modelo multimodal unificado (Azure Vision) | **Descartado** | 1024d, 70 palabras max. Insuficiente para RAG textual. |
| Gemini Embedding 2 (Google) | **Descartado para ahora** | MTEB #1 (68.32) pero Preview, sin vectorizer nativo en Azure AI Search, us-central1 only. Monitorear para futuro. |
| Voyage Multimodal 3.5 | **Descartado** | Sin vectorizer nativo multimodal en Azure. MongoDB-owned (vendor lock-in risk). |
| **Cohere Embed 4** | **Aprobado** | GA, vectorizer nativo Azure AI Search (AML/Foundry), 1536d (misma dimensión actual), 128K context, MTEB 65.2 > text-embedding-3-small 62.3. |
| **Tool redesign (power tool)** | **Aprobado** | Alinear con best practices Anthropic/Microsoft. LLM controla parámetros de búsqueda. |

### Cohere Embed 4 — Key Specs

| Property | Value |
|---|---|
| Dimensions | 1,536 (default), Matryoshka: 256-1,536 |
| Modalities | Text + Image + Interleaved (text+image en mismo request) |
| Same vector space | **Sí** — text query retrieves both docs AND images |
| Max tokens | ~128,000 |
| MTEB English | ~65.20 (vs. text-embedding-3-small: 62.26) |
| Azure integration | **Native**: AML skill (indexing) + Foundry vectorizer (query-time) |
| Status | **GA** |
| Pricing | $0.12/1M tokens |

---

## 3. Architectural Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Tool count | **2 tools** (search_knowledge + find_similar_images) | Input-nature criterion: text query → search_knowledge, image reference → find_similar_images. Zero ambiguity. |
| D2 | Tool design pattern | **Power tool** with LLM-controlled parameters | Expose searchType, top, minRelevanceScore, sortBy, fileTypeCategory, dateFrom/dateTo. Smart defaults + validation. |
| D3 | Embedding model | **Cohere Embed 4** via Azure AI Foundry | GA, native Azure vectorizer, 1536d matches current text field dimension, unified text+image vector space. |
| D4 | Vector field strategy | **Single unified field** (post-migration) | Replace contentVector (1536d) + imageVector (1024d) with one embeddingVector (1536d). |
| D5 | Error handling | **Passthrough with guidance** | AI Search errors returned to agent with actionable fix suggestions via `is_error: true`. |
| D6 | Validation pattern | **Clamp + override + reject** | Clamp out-of-range numerics, override invalid query/mode combos, reject unparseable dates. |
| D7 | Migration strategy | **Parallel indexes** with cutover | New index populated alongside old. Switch via config flag. Rollback = revert flag. |

---

## 4. PRD Index

| PRD | Title | Phase | Status | Est. Effort |
|---|---|---|---|---|
| [PRD-200](./PRD-200-tool-consolidation-power-search.md) | Tool Consolidation & Power Search Design | 1 — Tool Redesign | Proposed | 3-4 days |
| [PRD-201](./PRD-201-cohere-embed4-infrastructure.md) | Cohere Embed 4 — Infrastructure & Index | 2 — Embedding Model | Proposed | 2-3 days |
| [PRD-202](./PRD-202-cohere-embed4-data-cutover.md) | Cohere Embed 4 — Re-Embedding & Cutover | 3 — Data Migration | Proposed | 3-4 days |
| [PRD-203](./PRD-203-advanced-search-optimization.md) | Advanced Search Capabilities | 4 — Optimization | Proposed | 2-3 days |

### Dependency Chain

```
PRD-200 (Tool Consolidation & Power Search)
   │
   │  ← Can ship independently. Immediate value.
   │    Uses existing dual-vector architecture.
   │
   v
PRD-201 (Cohere Embed 4 — Infrastructure)
   │
   │  ← Deploys model, creates new index, updates embedding service.
   │    Old index continues serving production.
   │
   v
PRD-202 (Cohere Embed 4 — Data Cutover)
   │
   │  ← Re-embeds all content. Parallel indexes.
   │    Cutover via config flag. Removes Azure Vision dependency.
   │
   v
PRD-203 (Advanced Search)
   │
   │  ← Extractive answers, facets, response format control.
   │    Requires unified index to be live.
   v
   DONE
```

### Key Constraint

**PRD-200 is self-contained.** It delivers immediate value (better tool design, error passthrough, LLM-controlled parameters) without any infrastructure changes. PRD-201+ are independent initiatives that build on top.

---

## 5. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Cohere Embed 4 quality < text-embedding-3-small for business docs | High | A/B test with 100-doc sample before full migration. Keep old index until validated. |
| Re-embedding 100M+ chunks takes too long | Medium | BullMQ batch jobs with parallelism. Incremental progress. Resumable. |
| LLM sends invalid parameters to power tool | Low | Validation layer clamps/overrides. Errors returned with guidance. |
| Azure AI Foundry vectorizer adds latency at query time | Medium | Benchmark query-time vectorization vs. pre-computed. Fall back to pre-computed if >100ms overhead. |
| Cohere pricing ($0.12/1M) vs. OpenAI ($0.02/1M) | Medium | Offset by eliminating Azure Vision cost. Single model vs. two. Calculate total cost before committing. |
