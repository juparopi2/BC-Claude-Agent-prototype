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
│   ├── folderTreeStore.ts       # Folder hierarchy
│   ├── selectionStore.ts        # Multi-select state
│   ├── duplicateStore.ts        # Duplicate detection
│   ├── sortFilterStore.ts       # Sort/filter preferences
│   ├── filePreviewStore.ts      # Preview modal state
│   └── unsupportedFilesStore.ts # Skipped unsupported files
├── hooks/                   # React hooks (logic + effects)
│   ├── useFiles.ts              # Fetch and manage file list
│   ├── useFileUpload.ts         # Single/multi file upload
│   ├── useFolderUpload.ts       # Folder upload orchestration
│   ├── useFileProcessingEvents.ts # WebSocket event handling
│   ├── useFileDeleteEvents.ts   # Deletion event handling
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

Orchestrates bulk folder upload with pause/resume.

**Flow**:
1. Read folder structure (webkitdirectory API)
2. Validate limits (10,000 files max)
3. Create folders in batch (POST /api/files/folders/batch)
4. Init bulk upload (POST /api/files/bulk-upload/init)
5. Upload to Azure Blob via SAS URLs (20 concurrent)
6. Complete batch (POST /api/files/bulk-upload/complete)

**Features**:
- Pause/resume via localStorage
- Progress tracking (phase, batch, percent)
- Handles unsupported file types

```typescript
const { uploadFolder, progress, isPaused, pause, resume, cancel } = useFolderUpload();

await uploadFolder(folderStructure, targetFolderId);
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
