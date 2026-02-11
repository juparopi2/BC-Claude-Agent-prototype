# File Services (Infrastructure Layer)

## Purpose

Infrastructure services for file operations — blob storage, text extraction, chunking, embedding orchestration, database CRUD, GDPR-compliant deletion, context retrieval for RAG, and citation parsing. This directory contains the **how** (implementation) while `domains/files/` contains the **what** (business rules).

## Relationship to Other Directories

```
          HTTP Routes                    Queue Workers
     (routes/files/)              (infrastructure/queue/workers/)
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  domains/files/  (business logic)                                   │
│  UploadSessionManager, FileProcessingScheduler, RetryManager, etc.  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ delegates to
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  services/files/  (THIS DIRECTORY)                                  │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ FileUploadService│  │FileProcessingServ│  │FileChunkingService│  │
│  │ (blob storage)   │  │(text extraction) │  │(chunk + enqueue)  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘  │
│           │                     │                      │             │
│  ┌────────┴─────────┐  ┌───────┴──────────┐  ┌────────┴──────────┐ │
│  │ Azure Blob       │  │ processors/      │  │ services/search/  │ │
│  │ Storage           │  │ PDF,DOCX,XLSX,   │  │ VectorSearchSvc   │ │
│  │ (external)       │  │ Text,Image       │  │ (indexing)        │ │
│  └──────────────────┘  └──────────────────┘  └───────────────────┘ │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │ repository/       │  │ operations/      │  │ context/          │ │
│  │ FileRepository    │  │ SoftDelete,      │  │ RAG context       │ │
│  │ FileQueryBuilder  │  │ Metadata,        │  │ retrieval         │ │
│  │ (DB CRUD)        │  │ Duplicate,Delete │  │                   │ │
│  └──────────────────┘  └──────────────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

| File / Directory | Purpose |
|---|---|
| **Core Services** | |
| `FileService.ts` | Facade for file CRUD operations (get, list, update status, move, rename) |
| `FileUploadService.ts` | Azure Blob Storage operations: SAS URL generation, blob download, container management |
| `FileProcessingService.ts` | Text extraction orchestrator: download blob → select processor → extract → update DB → enqueue chunking |
| `FileChunkingService.ts` | Chunking orchestrator: read extracted text → chunk → insert to DB → enqueue embedding job |
| `DeletionAuditService.ts` | GDPR audit trail for file deletions |
| `MessageFileAttachmentService.ts` | Attaches file context to chat messages |
| `MessageChatAttachmentService.ts` | Attaches chat-related file references |
| **processors/** | |
| `PdfProcessor.ts` | PDF text extraction via Azure Document Intelligence (with OCR) |
| `DocxProcessor.ts` | DOCX text extraction via mammoth.js |
| `ExcelProcessor.ts` | XLSX extraction via xlsx library (markdown table formatting) |
| `TextProcessor.ts` | Plain text/CSV/JSON/HTML/CSS/JS extraction (UTF-8 decoding) |
| `ImageProcessor.ts` | Image analysis via Azure Computer Vision (embedding + caption generation) |
| `types.ts` | `DocumentProcessor` interface, `ExtractionResult` type |
| **repository/** | |
| `FileRepository.ts` | Database CRUD for files table (Prisma + raw SQL). Implements `IFileRepository` |
| `FileQueryBuilder.ts` | Query builder with soft-delete filtering, pagination, and multi-tenant isolation |
| **operations/** | |
| `SoftDeleteService.ts` | 3-phase soft-delete orchestrator (DB mark → AI Search update → queue physical deletion) |
| `FileDeletionService.ts` | Physical deletion (blob + search index + DB hard delete) |
| `FileDuplicateService.ts` | File duplication with new blob copy |
| `FileMetadataService.ts` | File metadata operations (size, type, dates) |
| **context/** | |
| `ContextRetrievalService.ts` | Retrieves file content for RAG agent context injection |
| `ContextStrategyFactory.ts` | Selects context strategy based on file type and size |
| `PromptBuilder.ts` | Builds system prompts with file context for agents |
| `types.ts` / `retrieval.types.ts` | Context retrieval type definitions |
| **citations/** | |
| `CitationParser.ts` | Parses agent responses to extract file citations |
| `types.ts` | Citation type definitions |
| **utils/** | |
| `ImageCompressor.ts` | Image compression/resizing before upload |

## Text Extraction Pipeline

`FileProcessingService.processFile(job)` is called by `FileProcessingWorker`:

```
1. Check file is still active (not deleted during queue wait)
2. Update status → 'processing', emit 0% progress
3. Download blob from Azure Storage (emit 20%)
4. Select processor by MIME type from registry (emit 30%)
5. Extract text via processor (emit 70%)
6. Track extraction usage for billing (fire-and-forget)
7. Persist image embedding if present (fire-and-forget)
8. Update DB with extracted text + 'completed' status (emit 90%)
9. Enqueue chunking job (fire-and-forget)
10. Emit completion event (100%)
```

On error: status → `'failed'`, emit error event, rethrow (triggers BullMQ retry).

### Processor Registry

| Processor | Technology | MIME Types | Returns |
|---|---|---|---|
| `PdfProcessor` | Azure Document Intelligence (OCR) | `application/pdf` | Text + page count + OCR flag |
| `DocxProcessor` | mammoth.js | `.docx` | Text (HTML → plain text) |
| `ExcelProcessor` | xlsx library | `.xlsx` | Markdown tables per sheet + sheet count |
| `TextProcessor` | UTF-8 decode | `text/plain`, `text/csv`, `text/markdown`, `text/javascript`, `text/html`, `text/css`, `application/json` | Raw text |
| `ImageProcessor` | Azure Computer Vision | `image/jpeg`, `image/png`, `image/gif`, `image/webp` | Caption text + 1024d image embedding + caption confidence |

All processors implement the `DocumentProcessor` interface:
```typescript
interface DocumentProcessor {
  extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult>;
}
```

## Chunking Strategy

`FileChunkingService.processFileChunks(job)` is called by `FileChunkingWorker`:

| Parameter | Value |
|---|---|
| `maxTokens` | 512 tokens per chunk |
| `overlapTokens` | 50 tokens overlap for context continuity |
| Strategy selection | `ChunkingStrategyFactory.createForFileType(mimeType)` |

**Image files** bypass text chunking entirely — instead, the service retrieves the pre-persisted image embedding from `ImageEmbeddingRepository` and indexes it directly into Azure AI Search via `VectorSearchService.indexImageEmbedding()`.

### Embedding Job Optimization

The embedding job payload contains **only chunk IDs** (not text content). This reduces Redis memory by ~80% for large file batches. The `EmbeddingGenerationWorker` reads chunk text from the database when processing.

```typescript
// Job payload (optimized)
{ fileId, userId, chunkIds: ['ID1', 'ID2', ...], mimeType }
```

## Soft Delete — 3-Phase Workflow

`SoftDeleteService.markForDeletion(userId, fileIds, options)`:

### Phase 1 — Synchronous (~50ms)
- Mark files in DB with `deletion_status = 'pending'`
- Files immediately hidden from all queries (`FileQueryBuilder` filters them)
- Returns `200 OK` immediately

### Phase 2 — Async (fire-and-forget)
- `VectorSearchService.markFileAsDeleting()` → updates `fileStatus` to `'deleting'` in AI Search
- Files excluded from RAG searches
- Enqueue physical deletion jobs to `FILE_DELETION` queue

### Phase 3 — Queue Worker (FileDeletionWorker)
- Update `deletion_status` to `'deleting'`
- Delete documents from AI Search index
- Delete blob from Azure Storage
- Hard delete record from database
- Emit WebSocket `file:deleted` event

**Design goal**: Eliminate race condition where files reappear after page refresh.

## Multi-Tenant Blob Paths

All blob paths follow the pattern: `users/{USERID}/files/{filename}`

The `FileUploadService` enforces this structure. SAS URLs are scoped to the user's directory.

## Key Patterns

1. **Processor Registry**: `FileProcessingService` maps MIME types to processor instances at construction time. Adding a new file type = adding a new processor + registering its MIME types.

2. **Facade Pattern**: `FileService` is a thin facade over `FileRepository` + status update logic. Complex operations (upload, delete, duplicate) live in dedicated services.

3. **Two-Phase Soft Delete**: `SoftDeleteService` returns immediately after DB mark. Physical cleanup is fully async. This keeps the delete API responsive.

4. **Optimized Job Payloads**: Chunking and embedding jobs carry only IDs, not content. Workers read from DB. This prevents Redis OOM during bulk uploads.

5. **Fire-and-Forget Side Effects**: Usage tracking, image embedding persistence, and chunking job enqueuing are all fire-and-forget (`.catch()` logged). Main pipeline never fails due to side effect errors.

6. **Singleton + DI**: All services use `getInstance()` with optional dependency injection for testing.

## Cross-References

- **Business logic / orchestration**: `domains/files/CLAUDE.md` — Upload sessions, scheduler, retry, cleanup
- **Search indexing**: `services/search/CLAUDE.md` — VectorSearchService, SemanticSearchService
- **Queue workers**: `infrastructure/queue/workers/` — FileProcessingWorker, FileChunkingWorker, EmbeddingGenerationWorker, FileDeletionWorker
- **Shared types**: `@bc-agent/shared` — FILE_WS_EVENTS, PROCESSING_STATUS, EMBEDDING_STATUS, file type constants
