# File Event Emission

## Purpose

WebSocket event emission for the file processing lifecycle. `FileEventEmitter` is the single authoritative emitter for per-file status and progress events. It never throws — WebSocket errors are caught and logged so they never fail the calling pipeline stage.

## Dual-Room Emission

Every event is emitted to two Socket.IO rooms simultaneously:

- `user:{userId}` — global user room (file explorer, background processing visibility)
- `{sessionId}` — session-specific room (active chat context, optional)

`sessionId` is absent for jobs enqueued outside of a chat session (e.g., sync pipeline files). In that case only the `user:{userId}` room is targeted.

## Channels and Events

### `FILE_WS_CHANNELS.STATUS` (`file:status`)

| Event constant | Method | Trigger |
|---|---|---|
| `FILE_WS_EVENTS.READINESS_CHANGED` | `emitReadinessChanged()` | Any pipeline status transition (uploading → processing, processing → ready, etc.) |
| `FILE_WS_EVENTS.PERMANENTLY_FAILED` | `emitPermanentlyFailed()` | Max retries exhausted. Includes `canRetryManually: true` flag. |

### `FILE_WS_CHANNELS.PROCESSING` (`file:processing`)

| Event constant | Method | Trigger |
|---|---|---|
| `FILE_WS_EVENTS.PROCESSING_PROGRESS` | `emitProgress()` | During text extraction and chunking stages |
| `FILE_WS_EVENTS.PROCESSING_COMPLETED` | `emitCompletion()` | Processing finished successfully (all chunks indexed) |
| `FILE_WS_EVENTS.PROCESSING_FAILED` | `emitError()` | Transient failure before retry decision |

All payloads include `fileId`, `userId`, and `timestamp`.

## Callers

| Caller | Stage | Events emitted |
|---|---|---|
| `FileProcessingService` | extract | `processing_progress`, `processing_completed`, `processing_failed` |
| `FileChunkingService` | chunk | `processing_progress` |
| `FileEmbedWorker` | embed | `readiness_changed` (processing → ready) |
| `ProcessingRetryManager` | permanent failure | `permanently_failed` + `readiness_changed` (processing → failed) |

## Distinction from Sync-Level Events

File events are per-file and scoped to the processing pipeline. Sync-level aggregate events (`SYNC_WS_EVENTS.PROCESSING_PROGRESS`, `SYNC_WS_EVENTS.PROCESSING_COMPLETED`) are emitted by `SyncProgressEmitter` and `FilePipelineCompleteWorker` to track scope-wide batch progress. The two systems are independent.

## Key Files

| File | Purpose |
|---|---|
| `FileEventEmitter.ts` | Singleton implementation — all file WebSocket events |
| `IFileEventEmitter.ts` | Interface contract + payload type definitions |
| `FolderEventEmitter.ts` | Separate emitter for upload session folder events (to `user:{userId}` only) |
| `IFolderEventEmitter.ts` | Interface contract for folder events |

## Graceful Degradation

If Socket.IO is not yet initialized (e.g., during startup or tests), `isSocketServiceInitialized()` returns false and the emit is silently skipped. The calling worker or service is never interrupted.

## Related

- Queue workers: `../../infrastructure/queue/workers/CLAUDE.md` — call emitter methods during pipeline stages
- Retry domain: `../retry/CLAUDE.md` — `ProcessingRetryManager.handlePermanentFailure()` calls this emitter
- Shared constants: `@bc-agent/shared` — `FILE_WS_EVENTS`, `FILE_WS_CHANNELS`, `FOLDER_WS_EVENTS`, `FOLDER_WS_CHANNELS`
