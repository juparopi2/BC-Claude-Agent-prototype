# Frontend Files Domain

## Purpose

File management UI state: upload queues, folder navigation, file selection, processing status, and real-time WebSocket event handling. Uses Zustand for state management with React hooks for orchestration.

## Architecture

```
domains/files/
├── stores/                  # Zustand stores (pure state)
│   ├── fileListStore.ts         # File listing with pagination
│   ├── fileProcessingStore.ts   # Processing status tracking
│   ├── uploadStore.ts           # Upload queue (single files)
│   ├── uploadLimitStore.ts      # Limit validation state
│   ├── uploadSessionStore.ts    # Folder-based upload session state
│   ├── folderTreeStore.ts       # Folder hierarchy
│   ├── selectionStore.ts        # Multi-select state
│   ├── duplicateStore.ts        # Duplicate detection
│   ├── sortFilterStore.ts       # Sort/filter preferences
│   ├── filePreviewStore.ts      # Preview modal state
│   └── unsupportedFilesStore.ts # Skipped unsupported files
├── hooks/                   # React hooks (logic + effects)
│   ├── useFiles.ts              # Fetch and manage file list
│   ├── useFileUpload.ts         # Single/multi file upload
│   ├── useFolderUpload.ts       # Folder upload orchestration (folder-based batching)
│   ├── useFileProcessingEvents.ts # WebSocket event handling
│   ├── useFileDeleteEvents.ts   # Deletion event handling
│   ├── useFolderBatchEvents.ts  # Folder batch WebSocket events
│   ├── useFileSelection.ts      # Selection operations
│   ├── useFileActions.ts        # File operations (rename, move)
│   ├── useFileRetry.ts          # Manual retry for failed files
│   ├── useFolderNavigation.ts   # Folder navigation
│   └── useGoToFilePath.ts       # Navigate to file location
├── utils/                   # Utilities
│   ├── folderReader.ts          # Read folder via DataTransfer API
│   └── folderUploadPersistence.ts # localStorage for pause/resume
├── types/
│   └── folderUpload.types.ts    # Folder upload type definitions
└── index.ts                 # Public exports
```

## Zustand Stores

### fileListStore

File listing with pagination support.

```typescript
interface FileListState {
  files: ParsedFile[];
  totalFiles: number;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
}

// Actions
setFiles(files, total, hasMore)  // Replace file list
addFile(file)                     // Add to beginning (new upload)
updateFile(id, updates)           // Update file properties
deleteFiles(ids)                  // Remove files
appendFiles(files, hasMore)       // Pagination (load more)
```

### fileProcessingStore

Track processing status for real-time updates.

```typescript
interface ProcessingFileState {
  readinessState: FileReadinessState;
  progress?: number;
  error?: string;
  canRetryManually?: boolean;
}

// Map of fileId -> ProcessingFileState
processingFiles: Map<string, ProcessingFileState>
```

### uploadStore

Upload queue for individual files.

```typescript
interface UploadItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  progress: number;
  error?: string;
  resultFile?: ParsedFile;
}
```

## Key Hooks

### useFileProcessingEvents

Subscribes to WebSocket events and updates stores.

**Events Handled**:
- `file:readiness_changed` → Update file status
- `file:permanently_failed` → Mark as failed with retry info
- `file:processing_progress` → Update progress %
- `file:processing_completed` → Mark as ready
- `file:processing_failed` → Show transient error
- `file:uploaded` → Add new file to list (real-time)

```typescript
// Usage in component
useFileProcessingEvents({ enabled: true });
```

### useFolderUpload

Orchestrates folder-based batch upload with folder-by-folder progress.

**Flow**:
1. Read folder structure (webkitdirectory API)
2. Validate limits (10,000 files max)
3. Initialize upload session (POST /api/files/upload-session/init)
4. For each folder (sequentially):
   a. Create folder in DB (POST /api/files/upload-session/:id/folder/:tempId/create)
   b. Register files for early persistence (POST .../register-files)
   c. Get SAS URLs (POST .../get-sas-urls)
   d. Upload files in parallel (20 concurrent)
   e. Mark files uploaded (POST .../mark-uploaded)
   f. Complete folder batch (POST .../complete)
5. Session completion via WebSocket events

**Features**:
- Folder-based batching (1 folder = 1 batch)
- Early persistence (files visible in UI before blob upload)
- Real-time progress via WebSocket events
- Heartbeat to keep session alive
- Pause/cancel support

```typescript
const { uploadFolder, progress, isPaused, pause, cancel } = useFolderUpload();

await uploadFolder(folderStructure, targetFolderId);
```

### uploadSessionStore

Zustand store for tracking folder-based upload session state.

```typescript
interface UploadSessionState {
  session: UploadSession | null;
  isActive: boolean;
  progress: UploadSessionProgress | null;
}

// Actions
setSession(session)           // Set current session
updateBatch(tempId, updates)  // Update folder batch
setCurrentFolderIndex(index)  // Set current folder
clearSession()                // Clear session state
```

### useFolderBatchEvents

Hook for subscribing to folder batch WebSocket events (folder:status channel).

**Events Handled**:
- `folder:session_started` → Initialize session in store
- `folder:batch_started` → Update current folder index
- `folder:batch_progress` → Update folder batch progress
- `folder:batch_completed` → Increment completed folders
- `folder:batch_failed` → Handle folder failure
- `folder:session_completed` → Mark session complete

```typescript
useFolderBatchEvents({
  enabled: true,
  onBatchComplete: (sessionId, folderIndex, folderName) => {
    toast.success(`Folder "${folderName}" completed!`);
  },
});
```

## WebSocket Event Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    REAL-TIME UPDATE FLOW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Backend Worker                                                      │
│      │                                                               │
│      ▼                                                               │
│  FileEventEmitter.emitReadinessChanged()                            │
│      │                                                               │
│      ▼                                                               │
│  Socket.IO → file:status channel                                    │
│      │                                                               │
│      ▼                                                               │
│  SocketClient.onFileStatusEvent() → listeners                       │
│      │                                                               │
│      ▼                                                               │
│  useFileProcessingEvents.handleFileStatusEvent()                    │
│      │                                                               │
│      ├─── fileProcessingStore.setProcessingStatus()                 │
│      │                                                               │
│      └─── fileListStore.updateFile()                                │
│                    │                                                 │
│                    ▼                                                 │
│              React re-renders with new state                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Configuration Constants

From `@bc-agent/shared`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_FILE_SIZE` | 100 MB | Single file limit |
| `MAX_IMAGE_SIZE` | 30 MB | Anthropic API limit |
| `MAX_FILES_PER_BULK_UPLOAD` | 500 | Files per batch |
| `MAX_FILES_PER_FOLDER_UPLOAD` | 10,000 | Total folder limit |
| `QUEUE_CONCURRENCY` | 20 | Parallel blob uploads |

## ID Normalization

All file IDs are normalized to **UPPERCASE** for comparison:

```typescript
// In fileListStore
const normalizedId = file.id.toUpperCase();

// In addFile - merge with processing state
const processingStatus = processingStore.processingFiles.get(normalizedId);
```

This handles race conditions where WebSocket events arrive before HTTP responses.

## Inputs/Outputs

### Input: File Drop

```typescript
// Component handles drop
const handleDrop = async (e: React.DragEvent) => {
  const items = e.dataTransfer.items;
  const structure = await readFolderStructure(items);
  await uploadFolder(structure, currentFolderId);
};
```

### Output: UI Updates

Stores trigger React re-renders via Zustand subscriptions:
```typescript
const files = useFileListStore((state) => state.files);
const isUploading = useUploadStore((state) => state.isUploading);
```

## Interconexions

### Consumes

- **SocketClient** (infrastructure/socket): WebSocket connection
- **FileApiClient** (infrastructure/api): HTTP endpoints
- **@bc-agent/shared**: Types and constants

### Consumed By

- **FileExplorer** component: Main file browser UI
- **FileUploader** component: Drag-drop upload area
- **FolderUploadProgressModal**: Progress display

## Patterns to Follow

### Store Design

- Stores are **pure state** (no API calls)
- Actions are synchronous state mutations
- API calls live in hooks

### Event Handling

Always use refs for callbacks in hooks:
```typescript
const callbacksRef = useRef({ updateFile, addFile });
useEffect(() => {
  callbacksRef.current = { updateFile, addFile };
}, [updateFile, addFile]);
```

### Testing

Reset stores between tests:
```typescript
import { resetFileListStore } from '@/domains/files/stores/fileListStore';

beforeEach(() => {
  resetFileListStore();
});
```

## Known Limitations

1. **No offline support**: Upload requires active connection
2. **No retry queue**: Failed uploads must be re-dropped
3. **localStorage limit**: ~5MB for pause/resume state
4. **No streaming progress**: Progress is per-file, not bytes

## Troubleshooting

### Files Not Appearing After Upload

1. Check `useFileProcessingEvents` is mounted
2. Verify WebSocket is connected (connection store)
3. Check browser console for event logs
4. Verify file ID case (must be uppercase)

### Upload Stuck at "Completing"

1. Check `/api/files/bulk-upload/complete` response
2. Verify backend workers are running
3. Check rate limit wasn't exceeded

### Pause/Resume Not Working

1. Check localStorage for `folderUpload_*` keys
2. Verify folder structure is valid JSON
3. Clear and retry: `clearUploadState()`

## Related Documentation

- Backend domain: `backend/src/domains/files/CLAUDE.md`
- Queue infrastructure: `backend/src/infrastructure/queue/CLAUDE.md`
- WebSocket events: `@bc-agent/shared` FILE_WS_EVENTS
