# PRD-200: Tool Consolidation & Power Search Design

**Phase**: 1 — Tool Redesign
**Status**: Proposed
**Prerequisites**: None (self-contained)
**Estimated Effort**: 3-4 days
**Created**: 2026-03-24

---

## 1. Objective

Redesign the RAG agent's tools following Anthropic and Microsoft best practices for LLM tool design. Consolidate 3 tools into 2 by eliminating ambiguity, and transform `search_knowledge` into a **power tool** that exposes Azure AI Search capabilities directly to the LLM — letting the agent control search strategy, result count, relevance thresholds, and ordering.

The design principle is: **the tool should be a thin, validated proxy to Azure AI Search**, not an abstraction that hides search capabilities. The LLM is better at deciding HOW to search than hardcoded logic.

### Deliverables

1. Merge `visual_image_search` into `search_knowledge` (3 tools → 2)
2. Expose LLM-controllable parameters: `searchType`, `top`, `minRelevanceScore`, `sortBy`
3. Validation layer: conditional defaults, clamping, format checking, override logic
4. Error passthrough: Azure AI Search errors returned to agent with actionable guidance
5. Input examples (`input_examples` pattern) for both tools
6. Updated system prompt (shorter, decision-rule based)
7. Updated `find_similar_images` description

---

## 2. Current State

### Tools (3)

| Tool | Parameters | Hardcoded Values |
|---|---|---|
| `search_knowledge` | query, fileTypeCategory, dateFrom, dateTo | maxFiles: 5, threshold: 0.47, searchMode: 'text' |
| `visual_image_search` | query, dateFrom, dateTo | maxFiles: 10, threshold: 0.47, searchMode: 'image' |
| `find_similar_images` | fileId, chatAttachmentId, maxResults, dateFrom, dateTo | maxResults default: 5 |

### Problems

1. **Ambiguity**: "busca fotos de carros rojos" → LLM can't decide between `search_knowledge(fileTypeCategory: 'images')` and `visual_image_search`. System prompt rules are subjective.
2. **Rigidity**: maxFiles hardcoded at 5/10. Threshold hardcoded at 0.47. No way for LLM to request more results for broad queries or fewer for specific lookups.
3. **No error feedback**: Azure AI Search errors are caught and logged but not returned to the agent. The agent sees empty results with no guidance on how to adjust.
4. **No search strategy control**: searchMode (text vs. image) is the only axis of control. No keyword-only search, no way to disable semantic ranking for exact-term queries.

---

## 3. Expected State

### Tools (2)

| Tool | Input Nature | Key Change |
|---|---|---|
| `search_knowledge` | **Text query** → search index | Power tool with 8 parameters. Absorbs visual_image_search. LLM controls search strategy. |
| `find_similar_images` | **Image reference** → vector similarity | Enhanced description. Unchanged schema. |

### Decision Rule (Zero Ambiguity)

```
User has a reference image (fileId, attachment) → find_similar_images
Everything else                                → search_knowledge
```

This is based on **input nature**, not inferred intent. No subjective judgment required.

---

## 4. Detailed Specifications

### 4.1 Tool Schema: `search_knowledge` (Power Search)

```typescript
const searchKnowledgeSchema = z.object({
  query: z.string().describe(
    'Search query text. Use specific terms for keyword search, natural language for semantic/hybrid. ' +
    'Use "*" for filter-only searches (e.g., all images, all files from a date range). ' +
    'For images, describe visual content (e.g., "red truck in parking lot", "organizational chart"). ' +
    'For documents, describe the information needed (e.g., "Q3 revenue forecast", "return policy").'
  ),
  searchType: z.enum(['hybrid', 'semantic', 'keyword']).optional().describe(
    'Search strategy to use. ' +
    '"hybrid" (DEFAULT): keyword matching + vector similarity + semantic reranking. Best for most queries. ' +
    '"semantic": vector similarity with semantic reranking. Best for natural language questions and conceptual searches. ' +
    '"keyword": BM25 text matching only. Best for exact terms, product codes, identifiers, or filenames. ' +
    'When fileTypeCategory is "images", hybrid and semantic use visual similarity matching automatically.'
  ),
  fileTypeCategory: z.enum(['images', 'documents', 'spreadsheets', 'code', 'presentations']).optional()
    .describe(
      'Filter results to a specific file type category. ' +
      'When set to "images", search prioritizes visual similarity matching (image embeddings). ' +
      'Omit to search across all file types.'
    ),
  top: z.number().int().min(1).max(50).optional().describe(
    'Maximum number of files to return (1-50). ' +
    'Default: 5 for documents/spreadsheets/code, 10 for images, 10 for cross-type searches. ' +
    'Use higher values (15-30) for broad research queries or when exploring a topic. ' +
    'Use lower values (3-5) for specific, targeted lookups.'
  ),
  minRelevanceScore: z.number().min(0).max(1).optional().describe(
    'Minimum relevance score threshold (0.0 to 1.0). Default: 0.47. ' +
    'Increase to 0.6-0.8 when high precision is needed (user wants only the most relevant results). ' +
    'Decrease to 0.2-0.3 for broad exploratory searches when recall matters more than precision. ' +
    'Set to 0.0 to return all results regardless of relevance (use with date/type filters).'
  ),
  dateFrom: z.string().optional().describe(
    'ISO date (YYYY-MM-DD). Only return files modified from this date onward. ' +
    'Example: "2026-01-01" for files from January 2026 onward.'
  ),
  dateTo: z.string().optional().describe(
    'ISO date (YYYY-MM-DD). Only return files modified up to this date. ' +
    'Example: "2026-03-31" for files up to end of March 2026.'
  ),
  sortBy: z.enum(['relevance', 'newest', 'oldest']).optional().describe(
    'Result ordering. Default: "relevance" (highest score first). ' +
    '"newest": most recently modified first. "oldest": least recently modified first. ' +
    'Use "newest"/"oldest" when the user wants to browse by date rather than by relevance.'
  ),
});
```

### 4.2 Tool Description: `search_knowledge`

```typescript
const description =
  'Search the user\'s knowledge base using Azure AI Search. Supports keyword search, ' +
  'semantic (AI-powered) search, and hybrid search (keyword + vector + semantic reranking). ' +
  'Returns matching files with relevance scores, citations, and excerpts.\n\n' +
  'SEARCH TYPES:\n' +
  '- "hybrid" (default): Best general-purpose search. Combines exact term matching with ' +
  'conceptual understanding. Use for most queries.\n' +
  '- "semantic": Pure conceptual search with AI reranking. Use when the user asks a question ' +
  'in natural language and exact terms may not appear in documents.\n' +
  '- "keyword": Exact BM25 text matching. Use for product codes, identifiers, filenames, ' +
  'or when the user wants literal string matches.\n\n' +
  'FILTERING:\n' +
  '- Use fileTypeCategory to narrow by file type (documents, images, spreadsheets, code, presentations)\n' +
  '- Use dateFrom/dateTo for date range filtering\n' +
  '- Combine both for targeted searches (e.g., "all spreadsheets from January")\n' +
  '- Use query "*" with filters for pure browsing (no semantic matching)\n\n' +
  'TUNING:\n' +
  '- Adjust "top" based on query breadth (3-5 for specific, 15-30 for exploratory)\n' +
  '- Adjust "minRelevanceScore" based on precision needs (0.6+ for precise, 0.2-0.3 for broad)\n' +
  '- Use "sortBy" for chronological browsing vs relevance ranking';
```

### 4.3 Input Examples: `search_knowledge`

```typescript
const inputExamples = [
  // Standard hybrid search
  {
    query: 'Q3 revenue forecast',
    searchType: 'hybrid',
    fileTypeCategory: 'documents',
    top: 5,
  },
  // Image search by visual description
  {
    query: 'red truck in parking lot',
    fileTypeCategory: 'images',
    top: 10,
  },
  // Keyword search for exact codes
  {
    query: 'INV-2026-0042',
    searchType: 'keyword',
    top: 3,
  },
  // Date-filtered browsing (no semantic matching)
  {
    query: '*',
    fileTypeCategory: 'spreadsheets',
    dateFrom: '2026-01-01',
    dateTo: '2026-03-31',
    sortBy: 'newest',
  },
  // Broad exploratory search with low threshold
  {
    query: 'marketing strategy competitive analysis',
    searchType: 'semantic',
    top: 20,
    minRelevanceScore: 0.3,
  },
];
```

### 4.4 Tool Description: `find_similar_images` (Enhanced)

```typescript
const description =
  'Find images visually similar to a SPECIFIC reference image that the user has pointed to. ' +
  'Use ONLY when the user references an existing image and wants to find similar ones.\n\n' +
  'WHEN TO USE:\n' +
  '- User says "find images similar to @photo.jpg" → use fileId from <mention id="..."> attribute\n' +
  '- User says "find images like the one I attached" → use chatAttachmentId from the attachment\n\n' +
  'WHEN NOT TO USE:\n' +
  '- User describes what they want in text (e.g., "find photos of cats") → use search_knowledge with fileTypeCategory "images" instead\n' +
  '- User asks a question about documents → use search_knowledge\n\n' +
  'Requires either fileId (from @mention or previous search results) OR chatAttachmentId (from chat attachment). ' +
  'Returns images ranked by visual similarity percentage.';
```

### 4.5 Validation Layer

The validation layer sits between the LLM's tool call and the search service. It applies **clamp, override, and reject** patterns:

#### 4.5.1 Parameter Clamping (out-of-range → closest valid value)

```typescript
function clampParameters(params: RawToolInput): ValidatedInput {
  return {
    ...params,
    top: params.top !== undefined
      ? Math.max(1, Math.min(50, Math.round(params.top)))
      : undefined,
    minRelevanceScore: params.minRelevanceScore !== undefined
      ? Math.max(0, Math.min(1, params.minRelevanceScore))
      : undefined,
  };
}
```

#### 4.5.2 Conditional Defaults (context-aware)

```typescript
function applyDefaults(params: ValidatedInput): ResolvedInput {
  const isImageSearch = params.fileTypeCategory === 'images';

  return {
    searchType: params.searchType ?? 'hybrid',
    top: params.top ?? (isImageSearch ? 10 : 5),
    minRelevanceScore: params.minRelevanceScore ?? SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER,
    sortBy: params.sortBy ?? 'relevance',
    ...params,
  };
}
```

#### 4.5.3 Override Logic (prevent known bad states)

```typescript
function applyOverrides(params: ResolvedInput): FinalInput {
  const overrides: Partial<FinalInput> = {};

  // Query "*" + semantic/hybrid → downgrade to keyword (semantic ranker fails on wildcard)
  if (params.query === '*' && params.searchType !== 'keyword') {
    overrides.searchType = 'keyword';
  }

  // Empty/whitespace query → treat as wildcard browse
  if (!params.query?.trim()) {
    overrides.query = '*';
    overrides.searchType = 'keyword';
  }

  // sortBy !== 'relevance' + semantic → semantic ranker score becomes meaningless
  // Keep semantic for quality but warn in results that ordering overrides relevance
  if (params.sortBy !== 'relevance' && params.searchType === 'semantic') {
    overrides.searchType = 'hybrid'; // hybrid allows orderby to work alongside relevance
  }

  return { ...params, ...overrides };
}
```

#### 4.5.4 Date Validation (reject with guidance)

```typescript
function validateDates(params: FinalInput): FinalInput | ToolError {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

  for (const field of ['dateFrom', 'dateTo'] as const) {
    const value = params[field];
    if (value && !isoDateRegex.test(value)) {
      return {
        is_error: true,
        message: `Invalid ${field} format: "${value}". Expected ISO date format YYYY-MM-DD (e.g., "2026-01-15"). ` +
          `Please retry with a valid date.`,
      };
    }
    if (value && isNaN(Date.parse(value))) {
      return {
        is_error: true,
        message: `Invalid date value for ${field}: "${value}". The date is not a real calendar date. ` +
          `Please retry with a valid date like "2026-03-24".`,
      };
    }
  }

  // dateFrom > dateTo → swap silently (common LLM mistake)
  if (params.dateFrom && params.dateTo && params.dateFrom > params.dateTo) {
    return {
      ...params,
      dateFrom: params.dateTo,
      dateTo: params.dateFrom,
    };
  }

  return params;
}
```

### 4.6 Search Mode Resolution

The validation layer resolves the LLM's `searchType` + `fileTypeCategory` into concrete Azure AI Search parameters:

```typescript
interface SearchResolution {
  queryType: 'simple' | 'semantic';       // Azure AI Search queryType
  useVectorSearch: boolean;               // Whether to include vector queries
  vectorWeights: {                         // Weights for RRF scoring
    contentVector: number;
    imageVector: number;
  };
  useSemanticRanker: boolean;             // Whether to enable semantic reranking
  searchText: string;                      // What goes in the 'search' field
  orderBy: string | undefined;            // Azure AI Search orderby
}

function resolveSearchMode(params: FinalInput): SearchResolution {
  const isImageSearch = params.fileTypeCategory === 'images';

  switch (params.searchType) {
    case 'keyword':
      return {
        queryType: 'simple',
        useVectorSearch: false,
        vectorWeights: { contentVector: 0, imageVector: 0 },
        useSemanticRanker: false,
        searchText: params.query,
        orderBy: resolveOrderBy(params.sortBy),
      };

    case 'semantic':
      return {
        queryType: 'semantic',
        useVectorSearch: true,
        vectorWeights: isImageSearch
          ? { contentVector: 0.5, imageVector: 3.0 }  // IMAGE_MODE weights
          : { contentVector: 1.0, imageVector: 0.5 },  // TEXT_MODE weights
        useSemanticRanker: true,
        searchText: params.query === '*' ? '' : params.query,
        orderBy: resolveOrderBy(params.sortBy),
      };

    case 'hybrid':
    default:
      return {
        queryType: 'semantic',
        useVectorSearch: true,
        vectorWeights: isImageSearch
          ? { contentVector: 0.5, imageVector: 3.0 }
          : { contentVector: 1.0, imageVector: 0.5 },
        useSemanticRanker: true,
        searchText: params.query,
        orderBy: resolveOrderBy(params.sortBy),
      };
  }
}

function resolveOrderBy(sortBy?: string): string | undefined {
  switch (sortBy) {
    case 'newest': return 'fileModifiedAt desc';
    case 'oldest': return 'fileModifiedAt asc';
    default: return undefined; // relevance (default Azure AI Search ordering)
  }
}
```

### 4.7 Error Passthrough

Azure AI Search errors are caught, classified, and returned to the agent with actionable guidance:

```typescript
async function executeSearchWithErrorPassthrough(
  params: FinalInput,
  resolution: SearchResolution,
): Promise<CitationResult | ToolError> {
  try {
    const results = await vectorSearchService.semanticSearch(/* ... */);
    return formatCitationResult(results, params);
  } catch (error) {
    return classifyAndReturnError(error, params);
  }
}

function classifyAndReturnError(error: unknown, params: FinalInput): ToolError {
  // Azure AI Search error codes
  if (isAzureSearchError(error)) {
    const code = error.code;

    if (code === 'InvalidFilter' || code === 'InvalidFilterExpression') {
      return {
        is_error: true,
        message: `Azure AI Search filter error: ${error.message}. ` +
          `This usually means the filter syntax is invalid. ` +
          `Try removing or simplifying the filter parameters.`,
      };
    }

    if (code === 'InvalidRequestParameter') {
      return {
        is_error: true,
        message: `Invalid search parameter: ${error.message}. ` +
          `Try simplifying your query or reducing the 'top' value.`,
      };
    }

    if (code === 'ServiceUnavailable' || code === 'RequestTimeout') {
      return {
        is_error: true,
        message: `Azure AI Search is temporarily unavailable. ` +
          `Try again with a simpler query or reduce 'top' to 5.`,
      };
    }
  }

  // Embedding generation failure
  if (isEmbeddingError(error)) {
    return {
      is_error: true,
      message: `Failed to generate search embeddings for the query. ` +
        `Try using searchType "keyword" which does not require embeddings, ` +
        `or simplify your query text.`,
    };
  }

  // Fallback
  return {
    is_error: true,
    message: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      `Try a different query or searchType.`,
  };
}
```

### 4.8 No Results Guidance

When search returns zero results, the response includes actionable suggestions instead of just an empty array:

```typescript
function formatNoResultsGuidance(params: FinalInput): string {
  const suggestions: string[] = [];

  if (params.minRelevanceScore && params.minRelevanceScore > 0.5) {
    suggestions.push('Lower minRelevanceScore to 0.3 for broader recall');
  }
  if (params.fileTypeCategory) {
    suggestions.push(`Remove fileTypeCategory filter to search across all file types`);
  }
  if (params.dateFrom || params.dateTo) {
    suggestions.push('Remove or widen the date range');
  }
  if (params.searchType === 'keyword') {
    suggestions.push('Try searchType "hybrid" or "semantic" for conceptual matching');
  }
  if (params.top && params.top < 10) {
    suggestions.push('Increase "top" to 10-20 for more candidates');
  }

  suggestions.push('Try different or broader search terms');
  suggestions.push('Ask the user if they have uploaded the relevant documents');

  return `No results found for query "${params.query}". Suggestions:\n` +
    suggestions.map(s => `- ${s}`).join('\n');
}
```

### 4.9 System Prompt

```
You are the Knowledge Base specialist within MyWorkMate.

TOOLS (2 tools):

1. search_knowledge — Search the knowledge base by text query.
   - Supports 3 search strategies: hybrid (default, best general), semantic (conceptual), keyword (exact terms)
   - Filter by file type (images, documents, spreadsheets, code, presentations) and/or date range
   - Control result count (top), relevance threshold (minRelevanceScore), and ordering (sortBy)
   - For images: set fileTypeCategory to "images" and describe visual content
   - For date browsing: use query "*" with dateFrom/dateTo and sortBy "newest" or "oldest"

2. find_similar_images — Find images similar to a SPECIFIC reference image.
   - Use ONLY when the user points to an existing image (@mention or chat attachment)
   - Requires fileId (from mention's id attribute) or chatAttachmentId

DECISION RULE:
- User has a reference image → find_similar_images
- Everything else → search_knowledge

EXECUTION RULES:
1. MUST call a tool for EVERY message. NEVER answer from training data.
2. Match searchType to intent: keyword for codes/IDs, semantic for questions, hybrid for general search.
3. Adjust top and minRelevanceScore based on query breadth.
4. If no results, retry with broader parameters before saying "not found".
5. Always cite source files (fileName + relevant excerpts).
6. Can call tools multiple times to refine or expand results.

PARAMETER TIPS:
- @MENTIONED FILES: Extract UUID from <mention id="..."> attribute, NEVER the filename
- @MENTIONED FOLDERS: Scope filter applied automatically — no special parameters needed
- DATE SEARCHES: Use query "*" with dateFrom/dateTo and sortBy "newest"
- EXACT TERMS: Use searchType "keyword" for product codes, invoice numbers, filenames
- BROAD RESEARCH: Use top 15-30 with minRelevanceScore 0.3
```

### 4.10 Validation Pipeline (Complete Flow)

```
LLM tool_call
    │
    v
┌─────────────────────────────────────┐
│ 1. Zod Schema Validation            │ ← Structural: types, enums, required fields
│    (reject malformed input)         │
└────────────┬────────────────────────┘
             │
             v
┌─────────────────────────────────────┐
│ 2. Clamp Parameters                 │ ← top: 1-50, minRelevanceScore: 0-1
│    (coerce out-of-range to bounds)  │
└────────────┬────────────────────────┘
             │
             v
┌─────────────────────────────────────┐
│ 3. Apply Conditional Defaults       │ ← images→top:10, docs→top:5
│    (context-aware defaults)         │    searchType→'hybrid' if unset
└────────────┬────────────────────────┘
             │
             v
┌─────────────────────────────────────┐
│ 4. Apply Overrides                  │ ← query='*'→force keyword
│    (prevent known bad states)       │    empty query→wildcard
│                                     │    sortBy≠relevance + semantic→hybrid
└────────────┬────────────────────────┘
             │
             v
┌─────────────────────────────────────┐
│ 5. Validate Dates                   │ ← ISO format check
│    (reject with guidance if bad)    │    dateFrom>dateTo→swap
└────────────┬────────────────────────┘
             │
             v
┌─────────────────────────────────────┐
│ 6. Inject Security Filters          │ ← userId, scopeFilter (from context)
│    (ALWAYS, non-negotiable)         │    fileStatus eq 'active'
└────────────┬────────────────────────┘
             │
             v
┌─────────────────────────────────────┐
│ 7. Resolve Search Mode              │ ← searchType + fileTypeCategory
│    → Azure AI Search parameters     │    → queryType, vectorWeights,
│                                     │      useSemanticRanker, orderBy
└────────────┬────────────────────────┘
             │
             v
┌─────────────────────────────────────┐
│ 8. Execute + Error Passthrough      │ ← Azure AI Search call
│    (classify errors, return         │    Embedding generation
│     with actionable guidance)       │    Result formatting
└─────────────────────────────────────┘
```

---

## 5. Complete File Inventory

### Modified Files (7)

| File | Change |
|---|---|
| `backend/src/modules/agents/rag-knowledge/tools.ts` | Rewrite `searchKnowledgeTool` with new schema, validation pipeline, error passthrough. Remove `visualImageSearchTool`. Update `findSimilarImagesTool` description. |
| `backend/src/modules/agents/core/definitions/rag-agent.definition.ts` | Replace system prompt with section 4.9 content. |
| `backend/src/modules/agents/core/registry/registerAgents.ts` | Remove `visualImageSearchTool` from static tools array. |
| `backend/src/services/search/semantic/SemanticSearchService.ts` | Accept `sortBy` parameter. Pass `orderBy` to VectorSearchService. Accept `searchType` to skip vector queries for keyword mode. |
| `backend/src/services/search/VectorSearchService.ts` | Accept `orderBy` parameter. Accept `skipVectorSearch` flag. Accept `skipSemanticRanker` flag. Return raw Azure errors instead of catching silently. |
| `backend/src/services/search/semantic/types.ts` | Add `sortBy`, `searchType` to `SemanticSearchOptions`. Export validation constants. |
| `packages/shared/src/constants/file-type-categories.ts` | Add `presentations` category (PowerPoint). |

### New Files (2)

| File | Purpose |
|---|---|
| `backend/src/modules/agents/rag-knowledge/validation.ts` | Validation pipeline: clamp, defaults, overrides, date validation, search mode resolution. |
| `backend/src/modules/agents/rag-knowledge/error-handler.ts` | Error classification and guided passthrough for Azure AI Search and embedding errors. |

---

## 6. Success Criteria

### Backend

- [ ] Only 2 tools registered for RAG agent (search_knowledge + find_similar_images)
- [ ] `search_knowledge` schema accepts all 8 parameters (query, searchType, fileTypeCategory, top, minRelevanceScore, dateFrom, dateTo, sortBy)
- [ ] Validation pipeline clamps `top` to 1-50 and `minRelevanceScore` to 0-1
- [ ] Query `"*"` forces keyword mode (no semantic ranker)
- [ ] Empty query replaced with `"*"` + keyword mode
- [ ] Invalid date format returns error with guidance (not empty results)
- [ ] dateFrom > dateTo auto-swaps
- [ ] fileTypeCategory `"images"` sets image vector weight to 3.0
- [ ] searchType `"keyword"` skips vector search and semantic ranker entirely
- [ ] sortBy `"newest"`/`"oldest"` applies Azure AI Search `orderBy` on `fileModifiedAt`
- [ ] Azure AI Search errors returned to agent with `is_error: true` and actionable message
- [ ] Embedding generation failures return error with suggestion to try keyword search
- [ ] Zero results return guidance with parameter adjustment suggestions
- [ ] All existing unit tests pass (backward compatible defaults)
- [ ] `npm run verify:types` passes
- [ ] `npm run -w backend lint` passes

### Unit Tests (New)

- [ ] Validation pipeline: clamp, defaults, overrides for every code path
- [ ] Date validation: valid ISO, invalid format, invalid date, dateFrom > dateTo
- [ ] Search mode resolution: all searchType × fileTypeCategory combinations
- [ ] Error classification: Azure Search errors, embedding errors, unknown errors
- [ ] No results guidance: generates suggestions based on active parameters
- [ ] Input examples: each example produces valid tool execution (integration-level)

### Agent Behavior (Manual Validation)

| Scenario | Expected Tool Call |
|---|---|
| "busca documentos de ventas Q4" | `search_knowledge(query: "ventas Q4", fileTypeCategory: "documents")` |
| "busca fotos de carros rojos" | `search_knowledge(query: "red cars", fileTypeCategory: "images")` |
| "busca todos los archivos de enero" | `search_knowledge(query: "*", dateFrom: "2026-01-01", dateTo: "2026-01-31", sortBy: "newest")` |
| "busca la factura INV-2026-0042" | `search_knowledge(query: "INV-2026-0042", searchType: "keyword")` |
| "busca imágenes parecidas a @foto.jpg" | `find_similar_images(fileId: "UUID")` |
| "necesito investigar todo sobre marketing" | `search_knowledge(query: "marketing strategy", top: 20, minRelevanceScore: 0.3)` |
| "muestra mis hojas de cálculo más recientes" | `search_knowledge(query: "*", fileTypeCategory: "spreadsheets", sortBy: "newest")` |

---

## 7. Out of Scope

- Cohere Embed 4 migration (PRD-201/202)
- Extractive answers / semantic captions (PRD-203)
- OData filter as a raw parameter (too complex for LLM to construct reliably without schema knowledge)
- Faceted search (PRD-203)
- Pagination (skip/offset — not useful in RAG context where top-K is sufficient)
- Changes to `CitationResult` schema (output format stays the same)
- Frontend changes (tools are backend-only; the UI renders CitationResult as-is)

---

## 8. Deployment Runbook

After implementing this PRD, update the deployment section in [01-DEPLOYMENT-RUNBOOK.md](./01-DEPLOYMENT-RUNBOOK.md) with actual commands, env vars, and verification steps.
