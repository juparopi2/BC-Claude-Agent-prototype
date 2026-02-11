 Investigation: Upload Processing Pipeline - Files Lost Between Upload and Indexing                                                     
  
 Context

 After uploading 25 files via folder drag-and-drop, only 17 were picked up by the FileProcessingScheduler. Those 17 were processed      
 perfectly (correct mimeType, isImage, fileStatus in Azure AI Search). The other 8 files were NEVER enqueued, NEVER processed — yet SQL 
  reports all 25 as completed. These 8 correlate exactly with NULL fields in Azure AI Search (mimeType, isImage, fileStatus all NULL)   
 and 7 missing contentVector (images).

 This is NOT residual data — the backend started clean. This is a structural/systemic bug in the upload pipeline.

 User-reported symptoms:
 1. Files marked as "completed" in DB but not searchable in AI Search
 2. WebSocket modal shows upload complete, but files stuck in "processing" state
 3. Some files perpetually stuck — never transition to "ready"

 ---
 1. Complete Architecture Map

 1.1 Four Upload Modes

 The system has 4 distinct upload paths. Only the folder session path uses the scheduler — the other 3 enqueue jobs directly:

 MODE 1: Single File Upload (≤1 file)
   Frontend: useFileUpload → POST /api/files/upload (multipart)
   Backend:  upload.routes.ts → FileUploadService.upload() → FileRepository.create()
             → MessageQueue.addFileProcessingJob() ← DIRECT ENQUEUE
   Key file: backend/src/routes/files/upload.routes.ts:127-137

 MODE 2: Multi-file Upload (2-20 files)
   Same as Mode 1 but with duplicate detection first
   Frontend: useFileUpload → POST /api/files/check-duplicates → POST /api/files/upload
   Key file: backend/src/routes/files/upload.routes.ts

 MODE 3: Bulk Upload (>20 files, same folder)
   Frontend: useFileUpload → POST /api/files/bulk-upload/init (SAS URLs)
             → PUT blob directly → POST /api/files/bulk-upload/complete
   Backend:  bulk.routes.ts → BulkUploadProcessor → MessageQueue.addFileProcessingJob() ← DIRECT ENQUEUE
   Key files: backend/src/routes/files/bulk.routes.ts
              backend/src/domains/files/bulk-upload/BulkUploadProcessor.ts

 MODE 4: Folder Session Upload (drag-and-drop folders) ← THE PROBLEMATIC PATH
   Frontend: useFolderUpload → 6-step HTTP sequence
   Backend:  upload-session.routes.ts → UploadSessionManager
             → markFileUploaded() → sets 'pending_processing'
             → FileProcessingScheduler (poll every 5s) → addFileProcessingJob() ← INDIRECT via SCHEDULER
   Key files: backend/src/routes/files/upload-session.routes.ts
              backend/src/domains/files/upload-session/UploadSessionManager.ts
              backend/src/domains/files/scheduler/FileProcessingScheduler.ts

 Critical observation: Modes 1-3 are reliable because they enqueue jobs directly in the same request. Mode 4 depends on a polling       
 scheduler with a 5-second interval, creating a temporal gap where files can be lost.

 1.2 Folder Session Upload — 6-Step HTTP Sequence

 Step 1: POST /upload-session/init
   → Creates UploadSession in Redis (TTL-based)
   → FolderNameResolver checks for duplicate folder names
   → Returns sessionId + folder batches

 Step 2: POST /upload-session/:id/folders/:tempId/create
   → Creates folder record in SQL database
   → Resolves parent folder ID

 Step 3: POST /upload-session/:id/folders/:tempId/register-files
   → Creates file records in DB with status='pending', readiness='uploading'
   → Files visible in UI immediately (early persistence)
   → Generates placeholder blob paths
   → mimeType IS SET HERE (from frontend metadata)

 Step 4: POST /upload-session/:id/folders/:tempId/sas-urls
   → Generates SAS URLs for direct-to-blob upload (3hr expiry)

 Step 5: POST /upload-session/:id/folders/:tempId/mark-uploaded (per file)
   → Updates file with real blobPath + contentHash     ← DB call #1
   → Sets processing_status='pending_processing'        ← DB call #2 (NOT TRANSACTIONAL!)
   → Scheduler will eventually pick up the file

 Step 6: POST /upload-session/:id/folders/:tempId/complete
   → Marks batch as 'processing'
   → Does NOT modify file statuses
   → Checks for next pending folder

 1.3 Processing Pipeline (3 Sequential BullMQ Queues)

 FileProcessingScheduler (polls every 5s, batch=10, maxQueueDepth=50)
     │ query: WHERE processing_status='pending_processing' AND is_folder=0 AND deletion_status IS NULL
     │ after enqueue: changes status to 'pending' (confusing but by design)
     ▼
 ┌─────────────────────┐     ┌──────────────────┐     ┌────────────────────────┐
 │ FILE_PROCESSING (8)  │────►│ FILE_CHUNKING (5) │────►│ EMBEDDING_GENERATION (5)│
 │                      │     │                   │     │                         │
 │ Download blob        │     │ Split into chunks │     │ OpenAI text-embedding   │
 │ Extract text/image   │     │ (512 tok, 50 ovlp)│     │ Azure CV image embed   │
 │ PDF/DOCX/XLSX/Text/  │     │ Insert chunks DB  │     │ Index in AI Search     │
 │ Image (OCR+caption)  │     │ Enqueue next stage │     │ Emit readiness_changed │
 │                      │     │                   │     │                         │
 │ Lock: 300,000ms      │     │ Lock: 300,000ms   │     │ Lock: 300,000ms        │
 │ Retries: 2           │     │                   │     │ Retries: 3             │
 └─────────────────────┘     └──────────────────┘     └────────────────────────┘

 1.4 Status Lifecycle (Confusing State Machine)

 File creation (register-files):     processing_status = 'pending'
 After blob upload (mark-uploaded):  processing_status = 'pending_processing'  ← SCHEDULER PICKS UP HERE
 After scheduler enqueue:            processing_status = 'pending'             ← BACK TO 'pending'!
 Worker starts processing:           processing_status = 'processing'
 Worker completes:                   processing_status = 'completed'

 Problem: The reuse of 'pending' for two different states (initial creation AND post-enqueue) makes debugging impossible from DB alone. 

 ---
 2. All Systems Involved (End-to-End Inventory)

 2.1 Backend Services
 Service: UploadSessionRoutes
 File: routes/files/upload-session.routes.ts
 Role in Pipeline: HTTP entry point for folder uploads
 ────────────────────────────────────────
 Service: UploadSessionManager
 File: domains/files/upload-session/UploadSessionManager.ts
 Role in Pipeline: Session lifecycle + markFileUploaded
 ────────────────────────────────────────
 Service: UploadSessionStore
 File: domains/files/upload-session/UploadSessionStore.ts
 Role in Pipeline: Redis session storage (TTL-based)
 ────────────────────────────────────────
 Service: FolderNameResolver
 File: domains/files/upload-session/FolderNameResolver.ts
 Role in Pipeline: Duplicate folder name resolution
 ────────────────────────────────────────
 Service: FileProcessingScheduler
 File: domains/files/scheduler/FileProcessingScheduler.ts
 Role in Pipeline: Backpressure-controlled job scheduling
 ────────────────────────────────────────
 Service: FileRepository
 File: services/files/repository/FileRepository.ts
 Role in Pipeline: DB CRUD for files table
 ────────────────────────────────────────
 Service: FileQueryBuilder
 File: services/files/repository/FileQueryBuilder.ts
 Role in Pipeline: SQL query builder (contains getFilesPendingProcessing)
 ────────────────────────────────────────
 Service: MessageQueue
 File: infrastructure/queue/MessageQueue.ts
 Role in Pipeline: BullMQ job enqueue facade
 ────────────────────────────────────────
 Service: FileProcessingWorker
 File: infrastructure/queue/workers/FileProcessingWorker.ts
 Role in Pipeline: Text extraction worker
 ────────────────────────────────────────
 Service: FileProcessingService
 File: services/files/FileProcessingService.ts
 Role in Pipeline: Text extraction orchestrator
 ────────────────────────────────────────
 Service: FileChunkingWorker
 File: infrastructure/queue/workers/FileChunkingWorker.ts
 Role in Pipeline: Chunking worker
 ────────────────────────────────────────
 Service: FileChunkingService
 File: services/files/FileChunkingService.ts
 Role in Pipeline: Chunk + index + enqueue embedding
 ────────────────────────────────────────
 Service: EmbeddingGenerationWorker
 File: infrastructure/queue/workers/EmbeddingGenerationWorker.ts
 Role in Pipeline: Embedding generation worker
 ────────────────────────────────────────
 Service: VectorSearchService
 File: services/search/VectorSearchService.ts
 Role in Pipeline: Azure AI Search indexing
 ────────────────────────────────────────
 Service: FileEventEmitter
 File: domains/files/emission/FileEventEmitter.ts
 Role in Pipeline: WebSocket events for file status
 ────────────────────────────────────────
 Service: FolderEventEmitter
 File: domains/files/emission/FolderEventEmitter.ts
 Role in Pipeline: WebSocket events for folder batches
 ────────────────────────────────────────
 Service: ReadinessStateComputer
 File: domains/files/status/ReadinessStateComputer.ts
 Role in Pipeline: Pure function: (processingStatus, embeddingStatus) → readinessState
 ────────────────────────────────────────
 Service: RateLimiter
 File: infrastructure/queue/core/RateLimiter.ts
 Role in Pipeline: Redis-based rate limiting (1000 jobs/hour)
 ────────────────────────────────────────
 Service: FileUploadService
 File: services/files/FileUploadService.ts
 Role in Pipeline: Azure Blob Storage operations
 ────────────────────────────────────────
 Service: ImageProcessor
 File: services/files/processors/ImageProcessor.ts
 Role in Pipeline: Azure Computer Vision (embed + caption)
 ────────────────────────────────────────
 Service: PdfProcessor
 File: services/files/processors/PdfProcessor.ts
 Role in Pipeline: Azure Document Intelligence (OCR)
 2.2 Frontend Hooks & Stores
 ┌─────────────────────────┬─────────────────────────────────────────────────────────────┬────────────────────────────────────────────┐ 
 │       Hook/Store        │                            File                             │                    Role                    │ 
 ├─────────────────────────┼─────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤ 
 │ useFolderUpload         │ frontend/src/domains/files/hooks/useFolderUpload.ts         │ Orchestrates 6-step upload sequence        │ 
 ├─────────────────────────┼─────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤ 
 │ useFileProcessingEvents │ frontend/src/domains/files/hooks/useFileProcessingEvents.ts │ WebSocket event handler for file status    │ 
 ├─────────────────────────┼─────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤ 
 │ useFolderBatchEvents    │ frontend/src/domains/files/hooks/useFolderBatchEvents.ts    │ WebSocket event handler for folder batches │ 
 ├─────────────────────────┼─────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤ 
 │ uploadSessionStore      │ frontend/src/domains/files/stores/uploadSessionStore.ts     │ Zustand store for session state            │ 
 ├─────────────────────────┼─────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤ 
 │ fileProcessingStore     │ frontend/src/domains/files/stores/fileProcessingStore.ts    │ Processing status tracking                 │ 
 ├─────────────────────────┼─────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤ 
 │ fileListStore           │ frontend/src/domains/files/stores/fileListStore.ts          │ File listing with pagination               │ 
 └─────────────────────────┴─────────────────────────────────────────────────────────────┴────────────────────────────────────────────┘ 
 2.3 External Systems
 ┌───────────────────────┬────────────────────────────────────────────────────┬────────────────────────────────────────┐
 │        System         │                      Purpose                       │             Failure Impact             │
 ├───────────────────────┼────────────────────────────────────────────────────┼────────────────────────────────────────┤
 │ Azure SQL             │ File records, chunks, metadata                     │ Files stuck if DB unreachable          │
 ├───────────────────────┼────────────────────────────────────────────────────┼────────────────────────────────────────┤
 │ Redis                 │ Upload sessions (TTL), BullMQ queues, rate limiter │ Sessions lost on Redis restart         │
 ├───────────────────────┼────────────────────────────────────────────────────┼────────────────────────────────────────┤
 │ Azure Blob Storage    │ File content storage                               │ Processing fails (no blob to download) │
 ├───────────────────────┼────────────────────────────────────────────────────┼────────────────────────────────────────┤
 │ Azure AI Search       │ Vector index (search + RAG)                        │ Files "completed" but not searchable   │
 ├───────────────────────┼────────────────────────────────────────────────────┼────────────────────────────────────────┤
 │ OpenAI API            │ Text embeddings (1536d)                            │ Embedding generation fails             │
 ├───────────────────────┼────────────────────────────────────────────────────┼────────────────────────────────────────┤
 │ Azure Computer Vision │ Image embeddings (1024d) + captions                │ Image search unavailable               │
 └───────────────────────┴────────────────────────────────────────────────────┴────────────────────────────────────────┘
 ---
 3. Root Cause Analysis

 3.1 Evidence from Trace Logs (25-file test)
 ┌───────────────────────────────────────────┬─────────────────────┬──────────┬────────┐
 │                   Stage                   │        Count        │ Expected │  Gap   │
 ├───────────────────────────────────────────┼─────────────────────┼──────────┼────────┤
 │ upload-session init                       │ 1 session, 25 files │ 25       │ -      │
 ├───────────────────────────────────────────┼─────────────────────┼──────────┼────────┤
 │ markFileUploaded (set pending_processing) │ 25                  │ 25       │ 0      │
 ├───────────────────────────────────────────┼─────────────────────┼──────────┼────────┤
 │ mark-uploaded route response              │ 25                  │ 25       │ 0      │
 ├───────────────────────────────────────────┼─────────────────────┼──────────┼────────┤
 │ processNextBatch (scheduler polls)        │ 14 cycles           │ -        │ -      │
 ├───────────────────────────────────────────┼─────────────────────┼──────────┼────────┤
 │ enqueueFiles (unique files)               │ 17                  │ 25       │ 8 LOST │
 ├───────────────────────────────────────────┼─────────────────────┼──────────┼────────┤
 │ processFileChunks (pipeline entry)        │ 17                  │ 25       │ 8      │
 ├───────────────────────────────────────────┼─────────────────────┼──────────┼────────┤
 │ indexChunksBatch + indexImageEmbedding    │ 73 + 48             │ -        │ -      │
 └───────────────────────────────────────────┴─────────────────────┴──────────┴────────┘
 Conclusion: All 25 files successfully enter pending_processing status. The scheduler runs 14 polling cycles but only ever finds 17     
 files. 8 files are NEVER visible to the scheduler query.

 3.2 The 8 Lost Files
 ┌──────────┬─────────────────────────────┬───────┐
 │ File ID  │            Name             │ Type  │
 ├──────────┼─────────────────────────────┼───────┤
 │ E75CDA05 │ 20251027_075620.jpg         │ Image │
 ├──────────┼─────────────────────────────┼───────┤
 │ D9AD1934 │ 20251027_075635.jpg         │ Image │
 ├──────────┼─────────────────────────────┼───────┤
 │ 5240A8EC │ 20251027_075806.jpg         │ Image │
 ├──────────┼─────────────────────────────┼───────┤
 │ CAA054D1 │ 20251027_075706.jpg         │ Image │
 ├──────────┼─────────────────────────────┼───────┤
 │ 4BBAB693 │ 20251027_075603.jpg         │ Image │
 ├──────────┼─────────────────────────────┼───────┤
 │ 86824D96 │ 20251027_075724.jpg         │ Image │
 ├──────────┼─────────────────────────────┼───────┤
 │ 0489A1F7 │ Ordrebekr-ftelse-T19143.pdf │ PDF   │
 ├──────────┼─────────────────────────────┼───────┤
 │ 6B13EF77 │ 20251027_075834.jpg         │ Image │
 └──────────┴─────────────────────────────┴───────┘
 All 8 have ZERO processing logs beyond the upload trace. Yet SQL shows them as completed for both processing_status and
 embedding_status.

 3.3 Hypotheses (Ordered by Likelihood)

 HYPOTHESIS A: Non-Atomic markFileUploaded (HIGH probability)

 Location: UploadSessionManager.ts lines 521-537

 // DB Call #1 — updates blob path and content hash
 await fileRepo.update(session.userId, fileId, { contentHash, blobPath });

 // DB Call #2 — sets processing_status to 'pending_processing'
 await fileRepo.updateProcessingStatus(session.userId, fileId, 'pending_processing');

 These are two separate SQL UPDATE statements with NO transaction. If call #1 succeeds but call #2 fails (network timeout, connection   
 pool exhausted, transient SQL error), the file has a valid blob path but never transitions to pending_processing. The scheduler query  
 (WHERE processing_status = 'pending_processing') will never find it.

 Why SQL shows "completed": If the system was restarted or there's a recovery mechanism we haven't traced yet, it may have set
 completed status. OR — the BullMQ worker for these files was already created from a previous partial run and completed processing, but 
  without the correct pipeline metadata (explaining NULL fields in AI Search).

 Evidence for: 8 of 25 files lost is consistent with a transient failure under load (concurrent HTTP requests from the frontend).       

 HYPOTHESIS B: Scheduler Race Condition — Files Change Status Before Query (MEDIUM probability)

 Location: FileProcessingScheduler.ts lines 201-339

 The scheduler's flow:
 1. Query DB: SELECT ... WHERE processing_status = 'pending_processing' (returns N files)
 2. For each file: enqueue job → update status to 'pending'
 3. Next cycle (5s later): Query again

 Race condition: If markFileUploaded() sets a file to pending_processing DURING the scheduler's enqueueFiles() loop, that file won't be 
  in the current batch (already queried) AND might be changed to pending by the time the scheduler queries again (if the scheduler      
 processes it in a subsequent micro-batch within the same cycle).

 Wait — this is actually NOT the issue because enqueueFiles only changes status for files it successfully enqueued. New files arriving  
 during the loop would be caught in the NEXT cycle.

 However, there's a subtler variant: if the scheduler batch size is 10 and there are 25 files all arriving as pending_processing within 
  a short window, the scheduler processes batches of 10 → 10 → 5. If backpressure kicks in (queueDepth >= maxQueueDepth(50)), the       
 scheduler SKIPS the cycle entirely:

 if (queueDepth >= this.config.maxQueueDepth) {
   this.log.debug({ queueDepth, maxQueueDepth }, 'Queue at capacity, skipping batch');
   return;  // ENTIRE BATCH SKIPPED
 }

 Evidence for: The scheduler ran 14 cycles for only 17 files (expected ~3 cycles for 25 files in batches of 10). The extra cycles       
 suggest some were skipped due to backpressure or had 0 results.

 HYPOTHESIS C: Silent updateProcessingStatus Failure (MEDIUM probability)

 Location: FileRepository.ts lines 392-443

 if (result.rowsAffected[0] === 0) {
   this.logger.info(
     { userId, fileId, status },
     'Processing status update skipped - file not found or deleted'
   );
   return;  // SILENT SUCCESS — caller doesn't know update failed
 }

 If the file record doesn't exist yet (timing issue between register-files and mark-uploaded), or if there's a WHERE clause mismatch    
 (e.g., deletion_status IS NULL failing), the update silently returns. The calling code in markFileUploaded continues as if successful. 

 Evidence for: The fact that exactly 8 files fail consistently suggests a pattern, not random transient errors.

 HYPOTHESIS D: SQL Shows "Completed" But Pipeline Never Ran (HIGH probability — consequence, not cause)

 The verify-storage script shows all 25 files as processing_status = 'completed' and embedding_status = 'completed'. But the trace logs 
  prove 8 files never entered the pipeline. This means something set these fields to 'completed' without running the actual pipeline.   

 Possible explanations:
 1. A previous run (before clean start) left stale job completions in BullMQ that replayed
 2. The FileProcessingWorker has a code path that marks completion without full processing
 3. The ReadinessStateComputer or a status reconciliation script set these fields
 4. BullMQ's "at least once" semantics replayed completed jobs from a previous session

 This is critical to investigate: if files are being marked completed without actually being processed, it's a data integrity issue.    

 HYPOTHESIS E: Rate Limiter Silently Rejecting Jobs (LOW probability)

 Location: infrastructure/queue/core/RateLimiter.ts

 From the queue CLAUDE.md:
 Critical Behavior: Jobs exceeding rate limit are silently rejected (not re-enqueued).

 The limit is 1000 jobs/hour/session. With only 25 files, this is extremely unlikely to trigger. But worth verifying.

 HYPOTHESIS F: BullMQ Stalled Job Recovery (LOW probability)

 From BullMQ docs:
 The queue aims for an "at least once" working strategy. A job could be processed more than once if a worker fails to keep a lock for   
 the given job during processing.

 Lock duration is 300,000ms (5 min). If text extraction for a large file takes >5 min, the job becomes stalled, gets restarted, and may 
  be double-processed. This doesn't explain LOST files, but could explain duplicated processing.

 ---
 4. Industry Best Practices (from BullMQ docs + patterns)

 4.1 Current Anti-Patterns
 Anti-Pattern: Polling scheduler
 Current Implementation: Poll DB every 5s for pending_processing
 Best Practice: Event-driven: enqueue directly when file is marked uploaded
 ────────────────────────────────────────
 Anti-Pattern: Non-atomic status transitions
 Current Implementation: Two separate UPDATE statements
 Best Practice: Single transaction or stored procedure
 ────────────────────────────────────────
 Anti-Pattern: Silent failures
 Current Implementation: updateProcessingStatus swallows 0-row updates
 Best Practice: Throw error or return result indicating success/failure
 ────────────────────────────────────────
 Anti-Pattern: Status reuse
 Current Implementation: 'pending' means both "initial" and "post-enqueue"
 Best Practice: Use distinct statuses: 'registered', 'pending_processing', 'enqueued', 'processing'
 ────────────────────────────────────────
 Anti-Pattern: No dead letter queue
 Current Implementation: Failed jobs stay in BullMQ failed state
 Best Practice: DLQ with monitoring and alerting
 ────────────────────────────────────────
 Anti-Pattern: No stuck file recovery
 Current Implementation: Only daily cleanup at 03:00 UTC for >30 day FAILED files
 Best Practice: Periodic scan for stuck files (>N minutes in non-terminal state)
 ────────────────────────────────────────
 Anti-Pattern: Fire-and-forget side effects
 Current Implementation: Embedding job enqueue uses .catch() (errors swallowed)
 Best Practice: Track completion of critical side effects
 4.2 BullMQ Recommended Patterns

 1. Direct enqueue over polling: Modes 1-3 already do this correctly. Mode 4 should too.
 2. Job deduplication: BullMQ supports jobId for idempotent adds — use fileId as jobId to prevent duplicates.
 3. Parent-child jobs: BullMQ Flow API supports parent jobs that wait for children — could replace the manual 3-queue chain.
 4. Stalled job monitoring: Always listen for stalled events and log/alert.
 5. Backoff with jitter: Already implemented for retries (good).