# PRD-06: Frontend V2 Wiring - Connect Uppy to Unified Backend

**Status**: Draft
**Owner**: Frontend Team
**Created**: 2026-02-10
**Dependencies**: PRD-00 (Uppy), PRD-03 (V2 Batch API), PRD-04 (WebSocket Events)

---

## 1. Problem

After PRD-00, the frontend uses Uppy for blob uploads but still talks to the old backend endpoints with 4 separate upload paths (single file, bulk upload, folder tree, folder zip) and different orchestration logic for each. After PRDs 01-05, the backend has a unified V2 API with:

- Single batch creation endpoint (`POST /api/v2/uploads/batches`)
- Per-file confirmation (`POST /api/v2/uploads/batches/:batchId/files/:fileId/confirm`)
- Unified duplicate detection (`POST /api/v2/uploads/check-duplicates`)
- Granular pipeline status via WebSocket events
- Batch progress tracking (`GET /api/v2/uploads/batches/:batchId`)

**Current State**: The frontend Uppy implementation from PRD-00 is in place, but it's not connected to the V2 backend. The old upload orchestration logic still exists in `useFileUpload.ts` and `useFolderUpload.ts`, creating technical debt and preventing us from leveraging the new unified pipeline.

**Impact**: Users cannot benefit from three-scope duplicate detection, granular progress tracking, or crash recovery features. The system maintains two parallel upload implementations (old and new backend), increasing maintenance burden.

This phase connects these two halves: the Uppy-powered frontend to the V2 backend, creating the complete unified pipeline.

---

## 2. Deprecation Registry (Before Implementation)

These components will be **replaced** (not deleted) by the V2 implementation:

### Hooks (3 files)
- `frontend/src/domains/files/hooks/useFileUpload.ts`
  - Old single-file and bulk-upload orchestration
  - 4-step flow: init → duplicate check → upload → session
  - **Replaced by**: `useUploadV2` hook with unified 8-step flow

- `frontend/src/domains/files/hooks/useFolderUpload.ts`
  - Old folder upload with 6-step session logic
  - Separate tree/zip handling
  - **Replaced by**: Same `useUploadV2` hook (unified path for all modes)

- `frontend/src/domains/files/hooks/useUploadProgress.ts` (if exists)
  - Binary progress tracking (uploading/done)
  - **Replaced by**: Granular pipeline status in `uploadBatchStoreV2`

### Stores (4 files)
- `frontend/src/domains/files/stores/uploadSessionStore.ts`
  - Session-based upload tracking
  - **Replaced by**: `uploadBatchStoreV2` with batch-centric model

- `frontend/src/domains/files/stores/multiUploadSessionStore.ts`
  - Multi-file session orchestration
  - **Replaced by**: Same `uploadBatchStoreV2` (single store for all modes)

- `frontend/src/domains/files/stores/uploadStore.ts`
  - File-level upload state
  - **Replaced by**: `uploadBatchStoreV2` with `Map<fileId, FileUploadState>`

- `frontend/src/domains/files/stores/duplicateStore.ts`
  - Current duplicate resolution flow (limited scope)
  - **Adapted for**: V2 three-scope detection (name/content/in-pipeline/in-upload)

### API Client
- `frontend/src/lib/api/fileApiClient.ts`
  - Old upload endpoint calls (`/api/files/upload`, `/api/folders/upload`)
  - **Updated with**: V2 batch API calls (`/api/v2/uploads/batches`, etc.)

### Components (partial deprecation)
- `frontend/src/components/files/DuplicateResolutionDialog.tsx` (if exists)
  - Single-scope duplicate handling
  - **Enhanced with**: Three-scope detection UI

- `frontend/src/components/files/UploadProgress.tsx` (if exists)
  - Binary progress indicator
  - **Replaced by**: `UploadProgressPanel` with granular pipeline states

**Total**: ~8-10 files affected (3 hooks + 4 stores + API client + components)

---

## 3. Solution Pattern

### 3.1 Architecture Overview

The V2 upload flow is a **single unified path** that handles all upload modes (1 file, 50 files, nested folders) through the same 8-step process:

```
User selects files
    ↓
[Step 1] Hash computation (PRD-00 Golden Retriever)
    ↓
[Step 2] Duplicate detection (V2 three-scope)
    ↓
[Step 3] User resolution (dialog if needed)
    ↓
[Step 4] Batch creation (manifest submission)
    ↓
[Step 5] Crash recovery setup (localStorage)
    ↓
[Step 6] Uppy file addition (with SAS URLs)
    ↓
[Step 7] Blob upload + confirmation
    ↓
[Step 8] Pipeline status tracking (WebSocket)
```

**Key Principle**: The frontend treats all uploads as batches. Even a single file is a "batch of 1". This eliminates special-case logic.

---

### 3.2 Core Hook: `useUploadV2`

**Location**: `frontend/src/domains/files/hooks/useUploadV2.ts`

This is the **single entry point** for all upload operations. It orchestrates the 8-step flow using Uppy (from PRD-00) and the V2 batch API.

```typescript
import { useCallback, useEffect } from 'react';
import { useUppy } from '@uppy/react';
import { useUploadBatchStoreV2 } from '../stores/uploadBatchStoreV2';
import { useFileProcessingEvents } from './useFileProcessingEvents';
import { fileApiV2 } from '@/lib/api/fileApiClientV2';
import type { ProcessedFile, FolderStructure } from '@bc-agent/shared';

interface UseUploadV2Options {
  onBatchComplete?: (batchId: string) => void;
  onError?: (error: Error) => void;
  autoStartPipeline?: boolean; // Default true
}

interface DuplicateResolution {
  fileId: string;
  action: 'skip' | 'rename' | 'replace' | 'keep-both';
  newName?: string; // If action is 'rename'
}

export function useUploadV2(options: UseUploadV2Options = {}) {
  const uppy = useUppy();
  const batchStore = useUploadBatchStoreV2();
  const { onBatchComplete, onError, autoStartPipeline = true } = options;

  // Step 8: WebSocket event handling for pipeline status
  useFileProcessingEvents((event) => {
    if (event.type === 'file:status-changed') {
      batchStore.updateFileStatus(event.fileId, event.to);
    }
    if (event.type === 'file:processing-failed') {
      batchStore.markFileFailed(event.fileId, event.error);
    }
    if (event.type === 'batch:completed') {
      batchStore.setBatchCompleted(event.batchId);
      localStorage.removeItem('activeBatchId');
      onBatchComplete?.(event.batchId);
    }
    if (event.type === 'batch:partial-failure') {
      batchStore.setBatchPartialFailure(event.batchId, event.failedCount);
    }
  });

  // Step 7: Uppy upload success handler
  useEffect(() => {
    const handleUploadSuccess = async (file: any, response: any) => {
      try {
        const { fileId, batchId } = file.meta;

        // Confirm upload with backend
        await fileApiV2.confirmFileUpload(batchId, fileId);

        // Update local state
        batchStore.incrementConfirmed();
        batchStore.updateFileUploadProgress(fileId, 100);

        // If auto-start enabled, confirmation triggers processing
        // Otherwise, file stays in 'registered' state until manual start
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        batchStore.markFileFailed(file.meta.fileId, errorMsg);
        onError?.(error instanceof Error ? error : new Error(errorMsg));
      }
    };

    const handleUploadError = (file: any, error: Error) => {
      batchStore.markFileFailed(file.meta.fileId, error.message);
      onError?.(error);
    };

    uppy.on('upload-success', handleUploadSuccess);
    uppy.on('upload-error', handleUploadError);

    return () => {
      uppy.off('upload-success', handleUploadSuccess);
      uppy.off('upload-error', handleUploadError);
    };
  }, [uppy, batchStore, onError, autoStartPipeline]);

  // Main upload orchestration
  const startUpload = useCallback(async (
    files: ProcessedFile[],
    folders?: FolderStructure[]
  ): Promise<string> => {
    try {
      batchStore.reset();

      // Step 1: Duplicate detection (V2 three-scope)
      const duplicateCheckPayload = files.map(f => ({
        name: f.name,
        size: f.size,
        contentHash: f.contentHash,
        folderId: f.folderId || null
      }));

      const duplicateResults = await fileApiV2.checkDuplicates(duplicateCheckPayload);

      // Step 2: Show resolution dialog if duplicates found
      const needsResolution = duplicateResults.some(d =>
        d.scope !== 'none' && d.suggestedAction !== 'proceed'
      );

      let resolutions: DuplicateResolution[] = [];
      if (needsResolution) {
        // This will open the dialog and wait for user input
        resolutions = await batchStore.showDuplicateDialog(duplicateResults);

        // Step 3: Apply user resolutions
        files = applyResolutions(files, resolutions);
      }

      // Step 4: Create batch (V2 manifest submission)
      const batchPayload = {
        files: files.map(f => ({
          name: f.name,
          size: f.size,
          mimeType: f.type,
          folderId: f.folderId || null,
          contentHash: f.contentHash
        })),
        folders: folders?.map(f => ({
          tempId: f.tempId,
          name: f.name,
          parentTempId: f.parentTempId || null
        })),
        autoStartPipeline
      };

      const batch = await fileApiV2.createBatch(batchPayload);

      // Step 5: Store batch ID for crash recovery
      localStorage.setItem('activeBatchId', batch.id);
      localStorage.setItem('activeBatchTimestamp', Date.now().toString());
      batchStore.setActiveBatch(batch);

      // Step 6: Add files to Uppy with SAS URLs from batch response
      for (const fileMapping of batch.files) {
        const originalFile = files.find(f => f.name === fileMapping.name);
        if (!originalFile) {
          console.warn(`File mapping for ${fileMapping.name} not found in original files`);
          continue;
        }

        uppy.addFile({
          name: fileMapping.name,
          type: fileMapping.mimeType,
          data: originalFile.blob,
          meta: {
            fileId: fileMapping.id,
            batchId: batch.id,
            sasUrl: fileMapping.sasUrl,
            relativePath: originalFile.relativePath
          }
        });
      }

      // Step 7: Start Uppy upload
      batchStore.setUploading(true);
      await uppy.upload();

      return batch.id;
    } catch (error) {
      batchStore.setError(error instanceof Error ? error.message : 'Upload failed');
      onError?.(error instanceof Error ? error : new Error('Upload failed'));
      throw error;
    }
  }, [uppy, batchStore, onError, autoStartPipeline]);

  // Crash recovery on mount
  useEffect(() => {
    const recoverActiveBatch = async () => {
      const batchId = localStorage.getItem('activeBatchId');
      const timestamp = localStorage.getItem('activeBatchTimestamp');

      if (!batchId || !timestamp) return;

      // Only recover batches from last 24 hours
      const age = Date.now() - parseInt(timestamp, 10);
      if (age > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('activeBatchId');
        localStorage.removeItem('activeBatchTimestamp');
        return;
      }

      try {
        // Query batch progress from server
        const batch = await fileApiV2.getBatchProgress(batchId);

        // Check if batch is still active
        if (batch.status === 'completed' || batch.status === 'failed') {
          localStorage.removeItem('activeBatchId');
          localStorage.removeItem('activeBatchTimestamp');
          return;
        }

        // Restore batch state
        batchStore.setActiveBatch(batch);

        // TODO: If some files are not uploaded, re-add them to Uppy
        // This requires coordinating with Golden Retriever (PRD-00) to restore file blobs
        // For now, just show current progress

        console.info(`Recovered batch ${batchId} with ${batch.confirmed}/${batch.totalFiles} files confirmed`);
      } catch (error) {
        console.error('Failed to recover batch:', error);
        localStorage.removeItem('activeBatchId');
        localStorage.removeItem('activeBatchTimestamp');
      }
    };

    recoverActiveBatch();
  }, [batchStore]);

  return {
    startUpload,
    pause: () => {
      uppy.pauseAll();
      batchStore.setPaused(true);
    },
    resume: () => {
      uppy.resumeAll();
      batchStore.setPaused(false);
    },
    cancel: () => {
      uppy.cancelAll();
      batchStore.reset();
      localStorage.removeItem('activeBatchId');
      localStorage.removeItem('activeBatchTimestamp');
    },
    retry: async (fileId: string) => {
      // Retry a single failed file
      const file = uppy.getFile(fileId);
      if (file) {
        await uppy.retryUpload(fileId);
      }
    }
  };
}

// Helper function to apply duplicate resolutions
function applyResolutions(
  files: ProcessedFile[],
  resolutions: DuplicateResolution[]
): ProcessedFile[] {
  return files
    .map(file => {
      const resolution = resolutions.find(r => r.fileId === file.id);
      if (!resolution) return file;

      if (resolution.action === 'skip') return null;
      if (resolution.action === 'rename' && resolution.newName) {
        return { ...file, name: resolution.newName };
      }
      return file;
    })
    .filter(Boolean) as ProcessedFile[];
}
```

---

### 3.3 Zustand Store: `uploadBatchStoreV2`

**Location**: `frontend/src/domains/files/stores/uploadBatchStoreV2.ts`

This store **replaces** three old stores (`uploadSessionStore`, `multiUploadSessionStore`, `uploadStore`) with a single unified state model.

```typescript
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PipelineStatus, DuplicateCheckResult } from '@bc-agent/shared';

export interface FileUploadState {
  id: string;
  name: string;
  size: number;
  uploadProgress: number; // 0-100, from Uppy progress events
  pipelineStatus: PipelineStatus; // registered | extracting | chunking | embedding | ready | failed
  error?: string;
  retriesAttempted?: number;
}

export interface BatchInfo {
  id: string;
  createdAt: string;
  status: 'uploading' | 'processing' | 'completed' | 'partial-failure' | 'failed';
  totalFiles: number;
  folders?: Array<{ id: string; name: string; parentId: string | null }>;
}

interface UploadBatchState {
  // Active batch
  activeBatch: BatchInfo | null;

  // File tracking
  files: Map<string, FileUploadState>;

  // Aggregate counters
  totalFiles: number;
  uploaded: number;       // Blob uploaded to Azure (Uppy success)
  confirmed: number;      // Confirmed with backend (POST /confirm)
  processing: number;     // In pipeline (extracting/chunking/embedding)
  ready: number;          // Fully processed
  failed: number;

  // UI state
  isUploading: boolean;
  isPaused: boolean;
  error: string | null;

  // Duplicate resolution
  duplicateDialogOpen: boolean;
  duplicateResults: DuplicateCheckResult[] | null;
  duplicateResolveCallback: ((resolutions: any[]) => void) | null;

  // Actions
  setActiveBatch: (batch: BatchInfo) => void;
  setUploading: (isUploading: boolean) => void;
  setPaused: (isPaused: boolean) => void;
  setError: (error: string | null) => void;

  updateFileUploadProgress: (fileId: string, progress: number) => void;
  updateFileStatus: (fileId: string, status: PipelineStatus) => void;
  markFileFailed: (fileId: string, error: string) => void;

  incrementConfirmed: () => void;
  setBatchCompleted: (batchId: string) => void;
  setBatchPartialFailure: (batchId: string, failedCount: number) => void;

  showDuplicateDialog: (results: DuplicateCheckResult[]) => Promise<any[]>;
  resolveDuplicates: (resolutions: any[]) => void;
  closeDuplicateDialog: () => void;

  reset: () => void;
}

const initialState = {
  activeBatch: null,
  files: new Map(),
  totalFiles: 0,
  uploaded: 0,
  confirmed: 0,
  processing: 0,
  ready: 0,
  failed: 0,
  isUploading: false,
  isPaused: false,
  error: null,
  duplicateDialogOpen: false,
  duplicateResults: null,
  duplicateResolveCallback: null
};

export const useUploadBatchStoreV2 = create<UploadBatchState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setActiveBatch: (batch) => {
        const fileMap = new Map<string, FileUploadState>();
        batch.files?.forEach((file: any) => {
          fileMap.set(file.id, {
            id: file.id,
            name: file.name,
            size: file.size,
            uploadProgress: 0,
            pipelineStatus: 'registered'
          });
        });

        set({
          activeBatch: batch,
          files: fileMap,
          totalFiles: batch.totalFiles,
          uploaded: 0,
          confirmed: 0,
          processing: 0,
          ready: 0,
          failed: 0
        });
      },

      setUploading: (isUploading) => set({ isUploading }),
      setPaused: (isPaused) => set({ isPaused }),
      setError: (error) => set({ error }),

      updateFileUploadProgress: (fileId, progress) => {
        const files = new Map(get().files);
        const file = files.get(fileId);
        if (file) {
          files.set(fileId, { ...file, uploadProgress: progress });
          set({ files });

          // Update uploaded count when progress hits 100
          if (progress === 100 && file.uploadProgress < 100) {
            set((state) => ({ uploaded: state.uploaded + 1 }));
          }
        }
      },

      updateFileStatus: (fileId, status) => {
        const files = new Map(get().files);
        const file = files.get(fileId);
        if (file) {
          const oldStatus = file.pipelineStatus;
          files.set(fileId, { ...file, pipelineStatus: status });
          set({ files });

          // Update counters
          set((state) => {
            let { processing, ready } = state;

            // Decrement old status counter
            if (oldStatus === 'extracting' || oldStatus === 'chunking' || oldStatus === 'embedding') {
              processing--;
            } else if (oldStatus === 'ready') {
              ready--;
            }

            // Increment new status counter
            if (status === 'extracting' || status === 'chunking' || status === 'embedding') {
              processing++;
            } else if (status === 'ready') {
              ready++;
            }

            return { processing, ready };
          });
        }
      },

      markFileFailed: (fileId, error) => {
        const files = new Map(get().files);
        const file = files.get(fileId);
        if (file) {
          files.set(fileId, {
            ...file,
            pipelineStatus: 'failed',
            error,
            retriesAttempted: (file.retriesAttempted || 0) + 1
          });
          set((state) => ({ files, failed: state.failed + 1 }));
        }
      },

      incrementConfirmed: () => {
        set((state) => ({ confirmed: state.confirmed + 1 }));
      },

      setBatchCompleted: (batchId) => {
        const batch = get().activeBatch;
        if (batch && batch.id === batchId) {
          set({
            activeBatch: { ...batch, status: 'completed' },
            isUploading: false
          });
        }
      },

      setBatchPartialFailure: (batchId, failedCount) => {
        const batch = get().activeBatch;
        if (batch && batch.id === batchId) {
          set({
            activeBatch: { ...batch, status: 'partial-failure' },
            failed: failedCount
          });
        }
      },

      showDuplicateDialog: (results) => {
        return new Promise((resolve) => {
          set({
            duplicateDialogOpen: true,
            duplicateResults: results,
            duplicateResolveCallback: resolve
          });
        });
      },

      resolveDuplicates: (resolutions) => {
        const callback = get().duplicateResolveCallback;
        if (callback) {
          callback(resolutions);
          set({
            duplicateDialogOpen: false,
            duplicateResults: null,
            duplicateResolveCallback: null
          });
        }
      },

      closeDuplicateDialog: () => {
        set({
          duplicateDialogOpen: false,
          duplicateResults: null,
          duplicateResolveCallback: null
        });
      },

      reset: () => set(initialState)
    }),
    { name: 'UploadBatchStoreV2' }
  )
);
```

---

### 3.4 Duplicate Resolution Dialog

**Location**: `frontend/src/components/files/DuplicateResolutionDialogV2.tsx`

This dialog shows three-scope duplicate detection results and allows users to choose how to handle each duplicate.

```typescript
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useUploadBatchStoreV2 } from '@/domains/files/stores/uploadBatchStoreV2';
import type { DuplicateCheckResult } from '@bc-agent/shared';

type ResolutionAction = 'skip' | 'rename' | 'replace' | 'keep-both';

interface FileResolution {
  fileId: string;
  action: ResolutionAction;
  newName?: string;
}

export function DuplicateResolutionDialogV2() {
  const {
    duplicateDialogOpen,
    duplicateResults,
    resolveDuplicates,
    closeDuplicateDialog
  } = useUploadBatchStoreV2();

  const [resolutions, setResolutions] = useState<Map<string, FileResolution>>(
    new Map()
  );

  if (!duplicateResults) return null;

  const handleActionChange = (fileId: string, action: ResolutionAction) => {
    const newResolutions = new Map(resolutions);
    newResolutions.set(fileId, { fileId, action });
    setResolutions(newResolutions);
  };

  const handleRename = (fileId: string, newName: string) => {
    const newResolutions = new Map(resolutions);
    const current = newResolutions.get(fileId);
    newResolutions.set(fileId, {
      fileId,
      action: 'rename',
      newName
    });
    setResolutions(newResolutions);
  };

  const handleConfirm = () => {
    // Apply default actions for unresolved files
    const finalResolutions: FileResolution[] = [];

    duplicateResults.forEach((result) => {
      const resolution = resolutions.get(result.fileName);
      if (resolution) {
        finalResolutions.push(resolution);
      } else {
        // Default action based on scope
        let defaultAction: ResolutionAction = 'proceed';
        if (result.scope === 'in-upload' || result.scope === 'in-pipeline') {
          defaultAction = 'skip'; // Safe default
        }
        finalResolutions.push({
          fileId: result.fileName, // TODO: map to actual fileId
          action: defaultAction
        });
      }
    });

    resolveDuplicates(finalResolutions);
  };

  const getScopeBadge = (scope: string) => {
    const colors = {
      'name': 'bg-yellow-100 text-yellow-800',
      'content': 'bg-blue-100 text-blue-800',
      'in-pipeline': 'bg-orange-100 text-orange-800',
      'in-upload': 'bg-red-100 text-red-800'
    };
    return (
      <Badge className={colors[scope as keyof typeof colors] || 'bg-gray-100'}>
        {scope}
      </Badge>
    );
  };

  return (
    <Dialog open={duplicateDialogOpen} onOpenChange={closeDuplicateDialog}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Duplicate Files Detected</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            The following files have duplicates in the system. Choose how to handle each one.
          </p>

          {duplicateResults.map((result) => {
            const resolution = resolutions.get(result.fileName);

            return (
              <div
                key={result.fileName}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{result.fileName}</p>
                    <p className="text-sm text-muted-foreground">
                      {result.message}
                    </p>
                  </div>
                  {getScopeBadge(result.scope)}
                </div>

                {result.conflictingFiles && result.conflictingFiles.length > 0 && (
                  <div className="text-sm">
                    <p className="font-medium">Conflicts with:</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {result.conflictingFiles.map((conflict, idx) => (
                        <li key={idx}>
                          {conflict.name} ({conflict.folder})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <RadioGroup
                  value={resolution?.action || result.suggestedAction}
                  onValueChange={(value) =>
                    handleActionChange(result.fileName, value as ResolutionAction)
                  }
                >
                  <div className="space-y-2">
                    {/* Skip */}
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="skip" id={`${result.fileName}-skip`} />
                      <Label htmlFor={`${result.fileName}-skip`}>
                        Skip this file
                      </Label>
                    </div>

                    {/* Rename (for name conflicts) */}
                    {result.scope === 'name' && (
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="rename" id={`${result.fileName}-rename`} />
                        <Label htmlFor={`${result.fileName}-rename`}>
                          Rename to:
                        </Label>
                        <Input
                          className="flex-1"
                          placeholder="New name"
                          disabled={resolution?.action !== 'rename'}
                          value={resolution?.action === 'rename' ? resolution.newName : ''}
                          onChange={(e) =>
                            handleRename(result.fileName, e.target.value)
                          }
                        />
                      </div>
                    )}

                    {/* Replace (for name conflicts) */}
                    {result.scope === 'name' && (
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="replace" id={`${result.fileName}-replace`} />
                        <Label htmlFor={`${result.fileName}-replace`}>
                          Replace existing file
                        </Label>
                      </div>
                    )}

                    {/* Keep both (for content conflicts) */}
                    {result.scope === 'content' && (
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="keep-both" id={`${result.fileName}-keep`} />
                        <Label htmlFor={`${result.fileName}-keep`}>
                          Keep both files (different names)
                        </Label>
                      </div>
                    )}
                  </div>
                </RadioGroup>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeDuplicateDialog}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Continue Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

### 3.5 Upload Progress Panel

**Location**: `frontend/src/components/files/UploadProgressPanelV2.tsx`

This panel displays granular pipeline status, replacing the old binary "uploading/done" indicator.

```typescript
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Play,
  AlertTriangle
} from 'lucide-react';
import { useUploadBatchStoreV2 } from '@/domains/files/stores/uploadBatchStoreV2';
import { useUploadV2 } from '@/domains/files/hooks/useUploadV2';
import type { PipelineStatus } from '@bc-agent/shared';

const statusConfig: Record<
  PipelineStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  registered: {
    label: 'Registered',
    color: 'bg-gray-100 text-gray-800',
    icon: <CheckCircle2 className="w-4 h-4" />
  },
  uploaded: {
    label: 'Uploaded',
    color: 'bg-blue-100 text-blue-800',
    icon: <CheckCircle2 className="w-4 h-4" />
  },
  extracting: {
    label: 'Extracting',
    color: 'bg-purple-100 text-purple-800',
    icon: <Loader2 className="w-4 h-4 animate-spin" />
  },
  chunking: {
    label: 'Chunking',
    color: 'bg-indigo-100 text-indigo-800',
    icon: <Loader2 className="w-4 h-4 animate-spin" />
  },
  embedding: {
    label: 'Embedding',
    color: 'bg-cyan-100 text-cyan-800',
    icon: <Loader2 className="w-4 h-4 animate-spin" />
  },
  ready: {
    label: 'Ready',
    color: 'bg-green-100 text-green-800',
    icon: <CheckCircle2 className="w-4 h-4" />
  },
  failed: {
    label: 'Failed',
    color: 'bg-red-100 text-red-800',
    icon: <XCircle className="w-4 h-4" />
  }
};

export function UploadProgressPanelV2() {
  const {
    activeBatch,
    files,
    totalFiles,
    uploaded,
    confirmed,
    processing,
    ready,
    failed,
    isUploading,
    isPaused
  } = useUploadBatchStoreV2();

  const { pause, resume, retry } = useUploadV2();

  if (!activeBatch) return null;

  const fileArray = Array.from(files.values());
  const overallProgress = Math.round((ready / totalFiles) * 100);
  const uploadProgress = Math.round((uploaded / totalFiles) * 100);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Upload Progress</CardTitle>
          <div className="flex items-center gap-2">
            {isUploading && !isPaused && (
              <Button variant="outline" size="sm" onClick={pause}>
                <Pause className="w-4 h-4 mr-2" />
                Pause
              </Button>
            )}
            {isPaused && (
              <Button variant="outline" size="sm" onClick={resume}>
                <Play className="w-4 h-4 mr-2" />
                Resume
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Overall Progress */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span>Overall Progress</span>
            <span className="font-medium">
              {ready} / {totalFiles} ready
            </span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </div>

        {/* Upload Progress */}
        {isUploading && (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span>Upload Progress</span>
              <span className="font-medium">
                {uploaded} / {totalFiles} uploaded
              </span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}

        {/* Status Breakdown */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Uploaded:</span>
            <span className="font-medium">{uploaded}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Confirmed:</span>
            <span className="font-medium">{confirmed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Processing:</span>
            <span className="font-medium">{processing}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ready:</span>
            <span className="font-medium text-green-600">{ready}</span>
          </div>
          {failed > 0 && (
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">Failed:</span>
              <span className="font-medium text-red-600">{failed}</span>
            </div>
          )}
        </div>

        {/* File List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {fileArray.map((file) => {
            const config = statusConfig[file.pipelineStatus];

            return (
              <div
                key={file.id}
                className="flex items-center justify-between p-2 border rounded hover:bg-muted/50"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0">{config.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    {file.uploadProgress < 100 && isUploading && (
                      <Progress
                        value={file.uploadProgress}
                        className="h-1 mt-1"
                      />
                    )}
                    {file.error && (
                      <p className="text-xs text-red-600 mt-1">{file.error}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={config.color}>{config.label}</Badge>
                  {file.pipelineStatus === 'failed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => retry(file.id)}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Warnings */}
        {failed > 0 && (
          <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-900">
                {failed} file{failed > 1 ? 's' : ''} failed to process
              </p>
              <p className="text-yellow-700">
                Check individual file errors above. You can retry failed files.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

---

### 3.6 V2 API Client

**Location**: `frontend/src/lib/api/fileApiClientV2.ts`

New API client for V2 batch endpoints.

```typescript
import axios from 'axios';
import type {
  DuplicateCheckPayload,
  DuplicateCheckResult,
  BatchCreationPayload,
  BatchCreationResponse,
  BatchProgressResponse
} from '@bc-agent/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export const fileApiV2 = {
  /**
   * Check for duplicates (three-scope: name, content, in-queue, in-upload)
   */
  async checkDuplicates(
    payload: DuplicateCheckPayload
  ): Promise<DuplicateCheckResult[]> {
    const response = await axios.post(
      `${API_BASE}/api/v2/uploads/check-duplicates`,
      payload,
      { withCredentials: true }
    );
    return response.data;
  },

  /**
   * Create batch and get SAS URLs for uploads
   */
  async createBatch(
    payload: BatchCreationPayload
  ): Promise<BatchCreationResponse> {
    const response = await axios.post(
      `${API_BASE}/api/v2/uploads/batches`,
      payload,
      { withCredentials: true }
    );
    return response.data;
  },

  /**
   * Confirm a file has been uploaded to blob storage
   */
  async confirmFileUpload(batchId: string, fileId: string): Promise<void> {
    await axios.post(
      `${API_BASE}/api/v2/uploads/batches/${batchId}/files/${fileId}/confirm`,
      {},
      { withCredentials: true }
    );
  },

  /**
   * Get batch progress (for crash recovery)
   */
  async getBatchProgress(batchId: string): Promise<BatchProgressResponse> {
    const response = await axios.get(
      `${API_BASE}/api/v2/uploads/batches/${batchId}`,
      { withCredentials: true }
    );
    return response.data;
  }
};
```

---

### 3.7 Feature Flag Integration

**Location**: Multiple files (components, hooks)

Use environment variable to toggle between old and new paths during rollout.

#### `.env.local`
```bash
# Set to 'true' to enable V2 upload pipeline
NEXT_PUBLIC_USE_V2_UPLOAD=false
```

#### Component Integration Example
```typescript
// frontend/src/components/files/FileUploader.tsx

import { FileUploaderV1 } from './FileUploaderV1'; // Old Uppy implementation
import { FileUploaderV2 } from './FileUploaderV2'; // New V2 implementation

const USE_V2_UPLOAD = process.env.NEXT_PUBLIC_USE_V2_UPLOAD === 'true';

export function FileUploader() {
  if (USE_V2_UPLOAD) {
    return <FileUploaderV2 />;
  }
  return <FileUploaderV1 />;
}
```

---

### 3.8 Crash Recovery Flow (Detailed)

The crash recovery mechanism operates at two levels:

#### Level 1: Batch-Level Recovery (Primary)

**Trigger**: On page load (`useEffect` in `useUploadV2`)

**Process**:
1. Check `localStorage.getItem('activeBatchId')` and `'activeBatchTimestamp'`
2. If batch ID found and age < 24 hours:
   - Query `GET /api/v2/uploads/batches/:id` for current progress
   - Parse response: `{ totalFiles, confirmed, processing, ready, failed, files: [...] }`
3. Restore batch state in `uploadBatchStoreV2`:
   - Set `activeBatch`, `files` map, and counters
   - Show progress panel with current status
4. If some files are not uploaded (uploaded < totalFiles):
   - **Problem**: Need to re-add files to Uppy, but file blobs are lost
   - **Solution**: Delegate to Golden Retriever (Level 2)

**Code Location**: `useUploadV2.ts` → `useEffect(() => recoverActiveBatch())`

#### Level 2: Blob-Level Recovery (Secondary)

**Trigger**: When Level 1 detects unuploaded files

**Process** (delegated to Golden Retriever from PRD-00):
1. Query Service Worker's IndexedDB for file blobs by batch ID
2. For each recovered blob:
   - Re-add to Uppy with original metadata (fileId, sasUrl)
   - Resume upload
3. If blob not found in IndexedDB:
   - Mark file as "stale" (cannot recover)
   - Show warning: "Some files could not be recovered. Please re-upload."

**Code Location**: Golden Retriever utility (`frontend/src/lib/golden-retriever.ts`)

**Example Flow**:
```
Page crashes mid-upload (30/50 files confirmed)
↓
User refreshes page
↓
Level 1: Query backend → 30/50 confirmed, 20 still pending
↓
Level 2: Query IndexedDB → 18/20 blobs found, 2 lost
↓
Re-add 18 files to Uppy, resume upload
↓
Show warning for 2 lost files
```

---

## 4. Scope

### 4.1 In Scope

**Hooks** (1 new):
- ✅ `useUploadV2.ts` - Unified upload orchestration hook

**Stores** (1 new):
- ✅ `uploadBatchStoreV2.ts` - Single store replacing 3 old stores

**Components** (2 new):
- ✅ `DuplicateResolutionDialogV2.tsx` - Three-scope duplicate UI
- ✅ `UploadProgressPanelV2.tsx` - Granular pipeline status display

**API Client** (1 new):
- ✅ `fileApiClientV2.ts` - V2 batch endpoint calls

**Utilities**:
- ✅ Feature flag wiring (`NEXT_PUBLIC_USE_V2_UPLOAD`)
- ✅ Crash recovery logic (localStorage + batch query)
- ✅ WebSocket event handling for V2 pipeline events

**Tests**:
- ✅ Unit tests for `useUploadV2` hook
- ✅ Unit tests for `uploadBatchStoreV2` store
- ✅ Component tests for dialogs and progress panel
- ✅ E2E test: folder upload → duplicate check → upload → processing → ready

### 4.2 Out of Scope

- ❌ Deleting old hooks/stores (keep for rollback capability)
- ❌ Backend changes (PRDs 01-05 already completed)
- ❌ Uppy configuration changes (handled in PRD-00)
- ❌ File preview/thumbnail generation (separate feature)
- ❌ Advanced batch operations (pause/resume individual files, priority queues)

---

## 5. Success Criteria

### 5.1 Functional Requirements

1. **Single Code Path**: ✅ One hook (`useUploadV2`) handles 1 file, 50 files, or 5 nested folders identically
2. **Three-Scope Duplicates**: ✅ Pre-upload dialog shows name/content/in-pipeline/in-upload duplicates
3. **Granular Progress**: ✅ Progress panel shows `registered → uploaded → extracting → chunking → embedding → ready`
4. **Crash Recovery**: ✅ After page refresh mid-upload, batch progress recovered and upload resumes
5. **Feature Flag**: ✅ Toggle between V1 and V2 paths via environment variable

### 5.2 Performance Requirements

- Duplicate check completes in < 2 seconds for 50 files
- Batch creation (manifest submission) completes in < 1 second
- Progress updates appear within 500ms of backend status change
- Crash recovery detection completes in < 500ms on page load

### 5.3 Test Coverage

- **Unit Tests**: 80%+ coverage for `useUploadV2`, `uploadBatchStoreV2`
- **Component Tests**: All interactive elements tested (buttons, dialogs, progress bars)
- **E2E Test**: End-to-end folder upload with duplicate resolution and pipeline tracking

### 5.4 E2E Test Scenario

**Test Name**: `v2-upload-flow.spec.ts`

**Steps**:
1. Navigate to app, select 5 files (2 with duplicate names)
2. Verify duplicate dialog appears with 2 conflicts
3. Choose "rename" for first conflict, "skip" for second
4. Submit upload, verify batch creation API call
5. Monitor progress panel, verify status changes: `uploaded → extracting → ready`
6. Refresh page mid-upload
7. Verify crash recovery: progress panel shows resumed state
8. Wait for all files to reach `ready` status
9. Verify batch completion event received

---

## 6. Reusable Code

### From PRD-00
- ✅ Uppy setup and configuration
- ✅ Golden Retriever (Service Worker + IndexedDB for crash recovery)
- ✅ `folderReader.ts` utility for folder hierarchy parsing

### From PRD-03
- ✅ V2 batch API response types (`BatchCreationResponse`, etc.)
- ✅ Error handling patterns for batch operations

### From PRD-04
- ✅ `useFileProcessingEvents` WebSocket hook
- ✅ Pipeline status types (`PipelineStatus` enum)

### Existing Frontend Code
- ✅ `useFileSelection` hook for file picker
- ✅ shadcn/ui components (Dialog, Progress, Badge, etc.)

---

## 7. Dependencies

### PRDs (Blocking)
- ✅ PRD-00: Uppy installation and configuration MUST be complete
- ✅ PRD-03: V2 batch API endpoints MUST be deployed
- ✅ PRD-04: WebSocket events for pipeline status MUST be implemented

### Libraries
- `@uppy/core@4.5.1` - Already installed (PRD-00)
- `@uppy/react@4.1.1` - Already installed (PRD-00)
- `zustand@5.0.3` - Already in use
- `axios@1.8.0` - Already in use

### Environment
- Node.js 20+
- Next.js 16 (App Router)
- React 19

---

## 8. Closing Deliverables (Template)

Use this checklist when closing the PRD:

### 8.1 Code Deliverables

- [ ] `useUploadV2.ts` hook implemented with 8-step flow
- [ ] `uploadBatchStoreV2.ts` store implemented (replaces 3 stores)
- [ ] `DuplicateResolutionDialogV2.tsx` component implemented
- [ ] `UploadProgressPanelV2.tsx` component implemented
- [ ] `fileApiClientV2.ts` API client implemented
- [ ] Feature flag wiring in all upload components
- [ ] Crash recovery logic implemented (localStorage + batch query)
- [ ] WebSocket event handlers integrated

### 8.2 Test Deliverables

- [ ] Unit tests for `useUploadV2` (80%+ coverage)
- [ ] Unit tests for `uploadBatchStoreV2` (80%+ coverage)
- [ ] Component tests for dialogs and progress panel
- [ ] E2E test: `v2-upload-flow.spec.ts` (folder upload with duplicates)

### 8.3 Documentation Deliverables

- [ ] Update `frontend/README.md` with V2 upload flow
- [ ] Add JSDoc comments to all public hook/store functions
- [ ] Update `.env.example` with `NEXT_PUBLIC_USE_V2_UPLOAD` flag

### 8.4 Verification Checklist

- [ ] Feature flag toggle works (V1 ↔ V2)
- [ ] Single file upload works end-to-end
- [ ] 50-file bulk upload works end-to-end
- [ ] Nested folder upload (5 folders, 200 files) works
- [ ] Duplicate detection shows all 3 scopes correctly
- [ ] Crash recovery restores batch progress after page refresh
- [ ] Progress panel shows granular states (extracting, chunking, etc.)
- [ ] WebSocket events update UI in real-time (< 500ms delay)
- [ ] All E2E tests pass

### 8.5 Deployment Checklist

- [ ] Feature flag disabled by default (`NEXT_PUBLIC_USE_V2_UPLOAD=false`)
- [ ] Deploy to staging environment
- [ ] QA validation: manual test all upload modes
- [ ] Enable feature flag for 10% of users (gradual rollout)
- [ ] Monitor error rates and performance metrics
- [ ] If stable after 48 hours, roll out to 100%

---

## 9. Rollback Plan

If critical issues are discovered after deployment:

1. **Immediate**: Set `NEXT_PUBLIC_USE_V2_UPLOAD=false` (reverts to V1)
2. **Investigate**: Check logs for errors in `useUploadV2` or `uploadBatchStoreV2`
3. **Fix**: Deploy hotfix or revert frontend deployment
4. **Re-test**: Validate fix in staging before re-enabling flag

**Old Code Retention**: Do NOT delete old hooks/stores until V2 is stable in production for 30 days.

---

## 10. Future Enhancements (Out of Scope)

- **Batch Management UI**: View/cancel/retry past batches
- **Priority Queues**: Mark files as "urgent" to process first
- **Partial Resume**: Resume individual files (not just whole batch)
- **Bandwidth Throttling**: Limit upload speed for slow connections
- **Multi-Session Upload**: Upload to multiple sessions simultaneously

---

## Appendix A: Type Definitions

For reference, here are the key shared types used in this PRD:

```typescript
// From @bc-agent/shared (PRD-03)

export interface DuplicateCheckPayload {
  files: Array<{
    name: string;
    size: number;
    contentHash: string;
    folderId: string | null;
  }>;
}

export interface DuplicateCheckResult {
  fileName: string;
  scope: 'none' | 'name' | 'content' | 'in-pipeline' | 'in-upload';
  suggestedAction: 'proceed' | 'skip' | 'rename' | 'replace';
  message: string;
  conflictingFiles?: Array<{
    id: string;
    name: string;
    folder: string;
  }>;
}

export interface BatchCreationPayload {
  files: Array<{
    name: string;
    size: number;
    mimeType: string;
    folderId: string | null;
    contentHash?: string;
  }>;
  folders?: Array<{
    tempId: string;
    name: string;
    parentTempId: string | null;
  }>;
  autoStartPipeline?: boolean;
}

export interface BatchCreationResponse {
  id: string;
  createdAt: string;
  totalFiles: number;
  files: Array<{
    id: string;
    name: string;
    mimeType: string;
    sasUrl: string;
  }>;
  folders?: Array<{
    id: string;
    tempId: string;
    name: string;
  }>;
}

export interface BatchProgressResponse {
  id: string;
  status: 'uploading' | 'processing' | 'completed' | 'partial-failure' | 'failed';
  totalFiles: number;
  uploaded: number;
  confirmed: number;
  processing: number;
  ready: number;
  failed: number;
  files: Array<{
    id: string;
    name: string;
    pipelineStatus: PipelineStatus;
    error?: string;
  }>;
}

export type PipelineStatus =
  | 'registered'
  | 'uploaded'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'failed';
```

---

**End of PRD-06**
