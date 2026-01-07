# PRD: Visual Representation - Structured Citations System

> **Version**: 1.0
> **Date**: 2026-01-06
> **Status**: Approved
> **Author**: Claude Code

---

## 1. Executive Summary

This PRD defines the implementation of a **structured citations system** that enables the RAG Agent to return rich, typed file references that the frontend can render as interactive UI elements (inline badges + carousel).

### Key Deliverables

1. **Structured Output Schema**: Zod schema for RAG tool using `withStructuredOutput()`
2. **Source Abstraction**: Scalable type system for multi-source support (Blob, SharePoint, Email, etc.)
3. **Citation Extraction**: Backend pipeline to extract citations from tool results
4. **SourceCarousel Component**: New UI component for visual file references
5. **Database Extension**: Source metadata columns + `message_citations` table for analytics

---

## 2. Problem Statement

### Current State

- RAG tool returns **plain text string**, losing structured metadata (fileId, mimeType, relevanceScore)
- Frontend cannot create clickable links because `fileId` is not available
- No source abstraction exists - system is tightly coupled to Azure Blob Storage
- Citations only work if LLM mentions `[filename.ext]` in response text

### Desired State

- RAG tool returns **structured JSON** with full file metadata
- Frontend receives `CitedFile[]` with source routing information
- New `SourceCarousel` component displays file thumbnails below messages
- System is prepared for future sources (SharePoint, OneDrive, Email, Web)

---

## 3. Technical Architecture

### 3.1 Source Type System

**Location**: `packages/shared/src/types/source.types.ts` (NEW FILE)

```typescript
/**
 * Source types for file/document origins.
 * Determines how frontend requests content.
 */
export type SourceType =
  | 'blob_storage'  // Azure Blob (current)
  | 'sharepoint'    // Microsoft SharePoint (future)
  | 'onedrive'      // Microsoft OneDrive (future)
  | 'email'         // Email attachments (future)
  | 'web';          // Web URLs (future)

/**
 * Fetch strategy determines how frontend retrieves content.
 */
export type FetchStrategy =
  | 'internal_api'  // Use /api/files/:id/content
  | 'oauth_proxy'   // Use /api/external/:source/:id
  | 'external';     // Direct external URL

/**
 * Unified source reference for all source types.
 */
export interface SourceReference {
  fileId: string | null;
  fileName: string;
  sourceType: SourceType;
  mimeType: string;
  fetchStrategy: FetchStrategy;
  relevanceScore: number;
  isImage: boolean;
  excerpts: SourceExcerpt[];
}

export interface SourceExcerpt {
  content: string;
  score: number;
  chunkIndex?: number;
}
```

### 3.2 Structured Output Schema (RAG Tool)

**Location**: `backend/src/modules/agents/rag-knowledge/schemas/searchResult.schema.ts` (NEW FILE)

```typescript
import { z } from 'zod';

export const SourceExcerptSchema = z.object({
  content: z.string().describe('Text content from the source'),
  score: z.number().min(0).max(1).describe('Relevance score'),
  chunkIndex: z.number().optional().describe('Position in document'),
});

export const SearchSourceSchema = z.object({
  fileId: z.string().describe('Unique file identifier'),
  fileName: z.string().describe('Display name'),
  sourceType: z.enum(['blob_storage', 'sharepoint', 'onedrive', 'email', 'web']),
  mimeType: z.string().describe('MIME type'),
  relevanceScore: z.number().min(0).max(1),
  isImage: z.boolean(),
  excerpts: z.array(SourceExcerptSchema),
});

export const StructuredSearchResultSchema = z.object({
  sources: z.array(SearchSourceSchema),
  searchMetadata: z.object({
    query: z.string(),
    totalChunksSearched: z.number(),
    threshold: z.number(),
  }),
});

export type StructuredSearchResult = z.infer<typeof StructuredSearchResultSchema>;
export type SearchSource = z.infer<typeof SearchSourceSchema>;
```

### 3.3 Extended CitedFile Interface

**Location**: `packages/shared/src/types/agent.types.ts` (MODIFY)

```typescript
import type { SourceType, FetchStrategy } from './source.types';

export interface CitedFile {
  fileName: string;
  fileId: string | null;
  sourceType: SourceType;        // NEW
  mimeType: string;              // NEW
  relevanceScore: number;        // NEW
  isImage: boolean;              // NEW
  fetchStrategy: FetchStrategy;  // NEW
}
```

### 3.4 ExecutionContextSync Extension

**Location**: `backend/src/domains/agent/orchestration/ExecutionContextSync.ts` (MODIFY)

```typescript
export interface ExecutionContextSync {
  // ... existing fields ...

  /**
   * Cited sources collected from tool results.
   * Populated during tool_response processing.
   */
  readonly citedSources: CitedFile[];  // NEW
}
```

### 3.5 Deleted File Handling (Tombstone Pattern)

To handle file deletions without breaking historical chat references, we implement a **Snapshot + Tombstone** strategy:

1.  **Snapshot Metadata**: Vital visualization data (`mimeType`, `isImage`) is copied to the `message_citations` table at the moment of creation.
2.  **Referential Integrity**: `file_id` is set to `ON DELETE SET NULL`.
3.  **Derived Status**:
    *   `file_id !== NULL`: File is **Available**.
    *   `file_id === NULL`: File is **Deleted**.
4.  **UI Behavior**:
    *   **Available**: Render normal interactive component.
    *   **Deleted**: Render "Tombstone" state (grayed out, non-clickable, "File Unavailable" label) using the snapshotted `mimeType` to show the correct icon.

---

## 4. Data Flow

### 4.1 Real-Time Flow (During Streaming)

```
┌──────────────────────────────────────────────────────────────────┐
│                   REAL-TIME DATA FLOW                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. RAG Tool executes search_knowledge_base                      │
│     └─> Returns StructuredSearchResult (JSON)                    │
│                                                                  │
│  2. LangGraph stores result in AgentState.toolExecutions[]       │
│     └─> toolExecutions[i].result = JSON string                   │
│                                                                  │
│  3. BatchResultNormalizer creates NormalizedToolResponseEvent    │
│     └─> event.result = JSON string with sources[]                │
│                                                                  │
│  4. AgentOrchestrator.processNormalizedEvent()                   │
│     └─> CitationExtractor.extract(event.result)                  │
│     └─> ctx.citedSources.push(...extractedSources)               │
│                                                                  │
│  5. CompleteEvent emitted with citedFiles + messageId            │
│     └─> citedFiles: ctx.citedSources                             │
│     └─> messageId: ctx.lastAssistantMessageId                    │
│                                                                  │
│  5.1 PERSIST: PersistenceCoordinator.persistCitationsAsync()     │
│     └─> Deduplicate by fileName                                  │
│     └─> EventStore.appendEvent('citations_created')              │
│     └─> MessageQueue.addCitationPersistence()                    │
│     └─> INSERT INTO message_citations (fire-and-forget)          │
│                                                                  │
│  6. Frontend processAgentEventSync                               │
│     └─> citationStore.setCitedFiles(citedFiles, messageId)       │
│                                                                  │
│  7. SourceCarousel renders thumbnails                            │
│     └─> For each citedFile: render preview based on sourceType   │
│                                                                  │
│  8. User clicks file                                             │
│     └─> Based on fetchStrategy: internal_api | oauth | external  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Retrieval Flow (Page Refresh)

```
┌──────────────────────────────────────────────────────────────────┐
│                   RETRIEVAL DATA FLOW                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User refreshes page / navigates to session                   │
│                                                                  │
│  2. ChatPage useEffect triggers loadSession()                    │
│     └─> Clear messageStore, agentStateStore, citationStore       │
│                                                                  │
│  3. API call: GET /api/chat/sessions/:sessionId/messages         │
│                                                                  │
│  4. Sessions Route handler                                       │
│     └─> Query messages from database                             │
│     └─> CitationService.getCitationsForMessages(assistantIds)    │
│     └─> Attach citations to message objects                      │
│     └─> Return { messages: [..., { citedFiles: [...] }] }        │
│                                                                  │
│  5. Frontend receives response                                   │
│     └─> messageStore.setMessages(messages)                       │
│     └─> citationStore.hydrateFromMessages(messages)              │
│                                                                  │
│  6. SourceCarousel renders from hydrated citation state          │
│     └─> getMessageCitations(messageId) returns citations         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Module Structure (Screaming Architecture)

### 5.1 New Files

```
packages/shared/src/types/
  source.types.ts                    # Source type system

backend/src/
  modules/agents/rag-knowledge/
    schemas/
      searchResult.schema.ts         # Zod schema for structured output
      searchResult.schema.test.ts    # Unit tests
      index.ts

  domains/agent/
    citations/                       # NEW DOMAIN
      CitationExtractor.ts           # Extracts citations from tool results
      CitationExtractor.test.ts      # Unit tests
      types.ts                       # Domain types
      index.ts

frontend/src/
  presentation/chat/
    SourceCarousel.tsx               # NEW: File thumbnails carousel
    SourceCarousel.test.tsx          # Unit tests
```

### 5.2 Modified Files

| File | Change | Reason |
|------|--------|--------|
| `packages/shared/src/types/agent.types.ts` | Extend CitedFile | Add sourceType, mimeType, etc. |
| `packages/shared/src/types/index.ts` | Export new types | Barrel export |
| `backend/src/modules/agents/rag-knowledge/tools.ts` | Return structured JSON | Main change |
| `backend/src/services/search/semantic/types.ts` | Add sourceType | Pass through from search |
| `backend/src/domains/agent/orchestration/ExecutionContextSync.ts` | Add citedSources | Accumulate citations |
| `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` | Extract citations | Use CitationExtractor |
| `frontend/src/domains/chat/stores/citationStore.ts` | Extended types | Support CitationInfo |
| `frontend/src/domains/chat/services/processAgentEventSync.ts` | Process citedFiles | Update store |
| `frontend/src/presentation/chat/CitationLink.tsx` | Source-aware | Different icons per source |
| `frontend/src/presentation/chat/MessageBubble.tsx` | Render SourceCarousel | Below message content |

---

## 6. Database Schema

### 6.1 Files Table Extension

```sql
-- Migration: Add source abstraction columns
ALTER TABLE files ADD COLUMN source_type VARCHAR(50) NOT NULL DEFAULT 'blob_storage';
ALTER TABLE files ADD COLUMN external_id VARCHAR(512) NULL;
ALTER TABLE files ADD COLUMN external_metadata NVARCHAR(MAX) NULL;
ALTER TABLE files ADD COLUMN last_synced_at DATETIME2 NULL;

CREATE INDEX IX_files_source_type ON files(user_id, source_type);
```

### 6.2 Message Citations Table (Analytics)

```sql
-- New table for citation analytics
-- NOTE: message_id is NVARCHAR(255) to support Anthropic message IDs (msg_01...)
CREATE TABLE message_citations (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  message_id NVARCHAR(255) NOT NULL,  -- Supports Anthropic IDs (not UUID)
  file_id UNIQUEIDENTIFIER NULL REFERENCES files(id) ON DELETE SET NULL,
  file_name NVARCHAR(512) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  mime_type VARCHAR(100) NOT NULL, -- SNAPSHOT for deleted files
  relevance_score DECIMAL(5,4) NOT NULL,
  is_image BIT NOT NULL DEFAULT 0, -- SNAPSHOT for deleted files
  excerpt_count INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

  INDEX IX_message_citations_message (message_id),
  INDEX IX_message_citations_file (file_id),
  INDEX IX_message_citations_created (created_at)
);
```

### 6.3 Applied Migrations

| Migration | Description |
|-----------|-------------|
| `008-add-citations-event-type.sql` | Added `citations_created` to `CK_message_events_valid_type` CHECK constraint |
| `009-fix-citation-message-id-type.sql` | Changed `message_citations.message_id` from `uniqueidentifier` to `nvarchar(255)` |

---

## 7. Test Strategy (TDD)

### 7.1 Unit Tests

| Component | Test File | Coverage |
|-----------|-----------|----------|
| CitationExtractor | `CitationExtractor.test.ts` | Extract from JSON, handle errors, empty results |
| searchResult.schema | `searchResult.schema.test.ts` | Zod validation, edge cases |
| SourceCarousel | `SourceCarousel.test.tsx` | Render images, PDFs, click handlers |
| citationStore | `citationStore.test.ts` | setCitationFiles, getCitationInfo |

### 7.2 Integration Tests

| Flow | Test File | Coverage |
|------|-----------|----------|
| RAG Tool -> CitedFiles | `rag-citations.integration.test.ts` | End-to-end citation flow |
| WebSocket -> Frontend | `citation-events.integration.test.ts` | Event propagation |

### 7.3 E2E Tests

| Scenario | Test File | Coverage |
|----------|-----------|----------|
| Search files and click citation | `citations.e2e.spec.ts` | Full user flow |
| SourceCarousel interaction | `carousel.e2e.spec.ts` | Visual verification |

---

## 8. Implementation Phases

### Phase 1: Foundation (Non-breaking)

**Files:**
- `packages/shared/src/types/source.types.ts` (NEW)
- `backend/src/modules/agents/rag-knowledge/schemas/searchResult.schema.ts` (NEW)
- `backend/src/infrastructure/database/migrations/20260106_add_source_columns.sql` (NEW)

**Tasks:**
1. Create `source.types.ts` in shared package
2. Create `searchResult.schema.ts` with Zod schema
3. Add database migration (additive, no breaking changes)
4. Write unit tests for schema validation

### Phase 2: Backend Integration

**Files:**
- `backend/src/domains/agent/citations/CitationExtractor.ts` (NEW)
- `backend/src/modules/agents/rag-knowledge/tools.ts` (MODIFY)
- `backend/src/domains/agent/orchestration/ExecutionContextSync.ts` (MODIFY)
- `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` (MODIFY)

**Tasks:**
1. Create CitationExtractor domain
2. Modify RAG tool to return structured JSON
3. Extend ExecutionContextSync with citedSources
4. Modify AgentOrchestrator to extract citations
5. Update CompleteEvent emission

### Phase 3: Frontend Integration

**Files:**
- `packages/shared/src/types/agent.types.ts` (MODIFY)
- `frontend/src/domains/chat/stores/citationStore.ts` (MODIFY)
- `frontend/src/domains/chat/services/processAgentEventSync.ts` (MODIFY)
- `frontend/src/presentation/chat/CitationLink.tsx` (MODIFY)
- `frontend/src/presentation/chat/SourceCarousel.tsx` (NEW)
- `frontend/src/presentation/chat/MessageBubble.tsx` (MODIFY)

**Tasks:**
1. Extend CitedFile type in shared package
2. Update CitationStore with extended types
3. Modify processAgentEventSync
4. Update CitationLink for source-awareness
5. Create SourceCarousel component

### Phase 4: Testing & Cleanup

**Tasks:**
1. Write all unit tests
2. Write integration tests
3. Write E2E tests
4. Remove deprecated code
5. Update documentation

---

## 9. Breaking Changes

### 9.1 Backend Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| RAG tool returns JSON instead of string | RAG agent ReAct loop must handle JSON | Update message construction |
| CitedFile requires sourceType | All consumers must handle new field | Default 'blob_storage' |

### 9.2 Frontend Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| citationStore.citationFileMap value type changes | Components using getCitationFile | Use getCitationInfo |

### 9.3 No Database Breaking Changes

All migrations are additive with defaults.

---

## 10. Success Criteria

1. **Functional**: RAG tool returns structured JSON with fileId, sourceType, mimeType
2. **Visual**: SourceCarousel displays thumbnails for cited files
3. **Clickable**: Users can click carousel items to preview files
4. **Extensible**: Adding SharePoint support requires only new adapter (no core changes)
5. **Tested**: >80% coverage on new code
6. **Documented**: Types are self-documenting with JSDoc

---

## 11. Critical Files Reference

### Must Read Before Implementation

1. `backend/src/modules/agents/rag-knowledge/tools.ts` - Current RAG tool
2. `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` - Citation extraction point
3. `backend/src/domains/agent/orchestration/ExecutionContextSync.ts` - Context extension
4. `packages/shared/src/types/agent.types.ts` - CitedFile interface
5. `frontend/src/domains/chat/stores/citationStore.ts` - Frontend state
6. `frontend/src/presentation/chat/CitationLink.tsx` - Current citation rendering
7. `frontend/src/presentation/chat/MessageBubble.tsx` - Carousel integration point

### Reference Files

- `backend/src/modules/agents/orchestrator/router.ts` - Example of withStructuredOutput usage
- `backend/src/infrastructure/config/models.ts` - Model configuration
- `backend/src/services/search/semantic/types.ts` - SemanticSearchResult type

---

## 12. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| LLM doesn't follow structured schema | Low | High | Use withStructuredOutput (guaranteed) |
| Performance impact from JSON parsing | Low | Medium | JSON.parse is fast, add caching if needed |
| Frontend bundle size increase | Low | Low | SourceCarousel is lazy-loaded |

---

*Document created: 2026-01-06*
