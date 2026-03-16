# Frontend Files Domain

## Purpose

File management UI state: upload queues, folder navigation, file selection, processing status, and real-time WebSocket event handling. Zustand stores + React hooks.

## Architecture

```
stores/           Zustand stores (pure state, no API calls)
  fileListStore, fileProcessingStore, uploadStore, uploadLimitStore,
  uploadSessionStore, folderTreeStore, selectionStore, duplicateStore,
  sortFilterStore, filePreviewStore, unsupportedFilesStore

hooks/            React hooks (logic + effects + API calls)
  useFiles, useFileUpload, useFolderUpload, useFileProcessingEvents,
  useFileDeleteEvents, useFolderBatchEvents, useFileSelection,
  useFileActions, useFileRetry, useFolderNavigation, useGoToFilePath

utils/            folderReader.ts, folderUploadPersistence.ts
```

## Key Hooks

| Hook | Purpose |
|---|---|
| `useFiles` | Fetch and manage file list with pagination |
| `useFileUpload` | Single/multi file upload |
| `useFolderUpload` | Folder upload orchestration (see flow below) |
| `useFileProcessingEvents` | WebSocket: readiness changes, progress, failures |
| `useFileDeleteEvents` | WebSocket: deletion events |
| `useFolderBatchEvents` | WebSocket: folder batch progress |
| `useFileSelection` | Multi-select operations |
| `useFileActions` | File operations (rename, move) |
| `useFileRetry` | Manual retry for failed files |
| `useFolderNavigation` | Folder tree navigation |
| `useGoToFilePath` | Navigate to specific file location |

## useFolderUpload Flow

1. Read folder structure (webkitdirectory API)
2. Validate limits (10,000 files max)
3. Init upload session (POST /api/files/upload-session/init)
4. For each folder (**sequentially**):
   a. Create folder in DB
   b. Register files (visible in UI immediately)
   c. Get SAS URLs
   d. Upload files in parallel (**20 concurrent**)
   e. Mark uploaded
   f. Complete folder batch
5. Session completion via WebSocket events

Features: folder-based batching, early persistence, real-time progress, heartbeat, pause/cancel.

## WebSocket Events Handled

### useFileProcessingEvents
`file:readiness_changed` → update status | `file:permanently_failed` → mark failed | `file:processing_progress` → progress % | `file:processing_completed` → mark ready | `file:uploaded` → add to list

### useFolderBatchEvents
`folder:session_started/completed/failed` | `folder:batch_started/progress/completed/failed`

## Configuration Constants (`@bc-agent/shared`)

| Constant | Value |
|----------|-------|
| `MAX_FILE_SIZE` | 100 MB |
| `MAX_IMAGE_SIZE` | 30 MB |
| `MAX_FILES_PER_BULK_UPLOAD` | 500 |
| `MAX_FILES_PER_FOLDER_UPLOAD` | 10,000 |
| `QUEUE_CONCURRENCY` | 20 |

## Patterns

- **Stores are pure state** — no API calls, synchronous mutations only. API calls live in hooks.
- **Refs for callbacks**: Use `useRef` for callbacks in WebSocket event hooks to avoid stale closures.
- **Reset stores in tests**: `resetFileListStore()` in `beforeEach`.

## Known Limitations

1. No offline support — upload requires active connection
2. No retry queue — failed uploads must be re-dropped
3. localStorage ~5MB limit for pause/resume state
4. Progress is per-file, not per-byte

## Troubleshooting

- **Files not appearing**: Check `useFileProcessingEvents` mounted, WebSocket connected, file ID uppercase
- **Upload stuck**: Check backend workers running, rate limit not exceeded
- **Pause/resume broken**: Check localStorage for `folderUpload_*` keys, clear with `clearUploadState()`

## Related

- Backend domain: `backend/src/domains/files/CLAUDE.md`
- Queue: `backend/src/infrastructure/queue/CLAUDE.md`
- WebSocket types: `@bc-agent/shared` FILE_WS_EVENTS, FOLDER_WS_EVENTS
