# Domains

Domain modules contain the business logic for each feature area, following a Screaming Architecture pattern.

## Structure

```
domains/
├── chat/              # Chat domain - messages, streaming, events
│   ├── hooks/         # React hooks for chat features
│   ├── stores/        # Zustand stores for state management
│   ├── services/      # Event processing and business logic
│   └── utils/         # Shared utilities (sorting, etc.)
├── files/             # Files domain - uploads, browsing, management
│   ├── hooks/         # React hooks for file operations
│   └── stores/        # Zustand stores for file state
└── README.md          # This file
```

## Domain Guidelines

### 1. Self-Contained
Each domain should be self-contained with its own:
- **Stores**: Zustand stores for state management
- **Hooks**: React hooks that encapsulate store access
- **Services**: Pure business logic functions
- **Utils**: Helper functions specific to the domain

### 2. Barrel Exports
Each domain has an `index.ts` barrel file that exports only the public API:
```typescript
// Good: Import from domain barrel
import { useMessages, useStreaming } from '@/src/domains/chat';

// Avoid: Direct imports from internal modules
import { getMessageStore } from '@/src/domains/chat/stores/messageStore';
```

### 3. Store Patterns
Stores follow the singleton pattern with hooks:
```typescript
// Create store with subscribeWithSelector for granular selects
const createMyStore = () => create<MyStore>()(
  subscribeWithSelector((set, get) => ({
    // state
    // actions
  }))
);

// Singleton getter
let store: ReturnType<typeof createMyStore> | null = null;
export function getMyStore() {
  if (!store) store = createMyStore();
  return store;
}

// Hook for components
export function useMyStore<T>(selector: (state: MyStore) => T): T {
  return getMyStore()(selector);
}

// Reset for testing
export function resetMyStore(): void {
  if (store) store.getState().reset();
  store = null;
}
```

### 4. Hook Patterns
Hooks should use individual selectors to avoid re-renders:
```typescript
// Individual selectors prevent infinite loops
const selectIsLoading = (state: MyState) => state.isLoading;
const selectData = (state: MyState) => state.data;

export function useMyFeature() {
  const isLoading = useMyStore(selectIsLoading);
  const data = useMyStore(selectData);

  // Memoize computed values
  const sortedData = useMemo(() => [...data].sort(), [data]);

  // Stable callbacks
  const doAction = useCallback(() => {
    getMyStore().getState().someAction();
  }, []);

  return { isLoading, data: sortedData, doAction };
}
```

## Chat Domain (`chat/`)

### Stores
- **messageStore**: Persisted and optimistic messages
- **streamingStore**: Real-time streaming accumulation
- **approvalStore**: Pending human approvals
- **eventCorrelationStore**: Event tracking for debugging (Gap #3)

### Hooks
- **useMessages**: Access sorted messages with optimistic updates
- **useStreaming**: Access streaming content and status
- **useSendMessage**: Send messages via WebSocket
- **useFileAttachments**: Manage file attachments for messages
- **usePagination**: Load older messages with cursor-based pagination

### Services
- **streamProcessor**: Routes agent events to appropriate stores

### Utils
- **messageSort**: Centralized message sorting logic (Gap #8)

## Files Domain (`files/`)

### Stores
- **fileListStore**: File/folder listing
- **filePreviewStore**: File preview modal state
- **uploadStore**: Upload progress and state
- **folderTreeStore**: Folder hierarchy
- **selectionStore**: Selected files for batch operations
- **sortFilterStore**: Sort and filter preferences

### Hooks
- **useFiles**: File listing with sorting/filtering
- **useFileUpload**: Upload with progress tracking
- **useFolderNavigation**: Navigate folder tree
- **useFileSelection**: Multi-select functionality
- **useFileActions**: Create, rename, delete operations

## Testing

Each domain has corresponding tests in `__tests__/domains/`:
```
__tests__/domains/
├── chat/
│   ├── stores/
│   │   ├── messageStore.test.ts
│   │   ├── streamingStore.test.ts
│   │   ├── approvalStore.test.ts
│   │   └── eventCorrelationStore.test.ts
│   ├── services/
│   │   └── streamProcessor.test.ts
│   ├── hooks/
│   │   └── usePagination.test.ts
│   └── utils/
│       └── messageSort.test.ts
└── files/
    └── stores/
        ├── filePreviewStore.test.ts
        └── sortFilterStore.test.ts
```

## Types

Domain types come from `@bc-agent/shared`:
```typescript
import type { Message, AgentEvent, PersistenceState } from '@bc-agent/shared';
```

Local types are defined only for domain-specific needs not covered by shared types.
