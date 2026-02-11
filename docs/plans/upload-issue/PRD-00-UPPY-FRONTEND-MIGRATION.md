# PRD-00: Uppy Frontend Migration (Quick Win)

**Status**: Draft
**Priority**: High (Foundation for unified pipeline)
**Complexity**: Medium
**Estimated Effort**: 3-5 days

---

## 1. Problem

### 1.1 Current State

The current upload engine uses manual `XMLHttpRequest` loops with custom concurrency logic distributed across `useFileUpload.ts` and `useFolderUpload.ts`. This approach creates several critical issues:

**For large uploads (10,000 files × ~5MB = 50GB)**:
- **No queue management with backpressure**: All files attempt to upload simultaneously, creating thousands of concurrent HTTP connections
- **No automatic retry with backoff**: Individual file failures require manual intervention
- **No pause/resume capability**: Users cannot pause a large batch and resume later
- **No crash recovery**: Page refresh during upload loses all progress and requires complete restart

**System fragmentation**:
- **4 separate upload paths** with different behaviors:
  1. Single file upload (`useFileUpload.ts`)
  2. Multi-file upload (2-19 files, `useFileUpload.ts`)
  3. Bulk upload (≥20 files, `useFileUpload.ts`)
  4. Folder session upload (`useFolderUpload.ts`)
- **Data loss in production**: A 25-file test demonstrated that 8 files (32%) were permanently lost between upload and processing
- **Manual progress tracking**: Custom state management in `uploadStore.ts` is error-prone and doesn't handle edge cases

### 1.2 Impact

- **Poor user experience**: No feedback during large uploads, no ability to pause or recover from failures
- **Data integrity risk**: Silent file loss without error indication
- **Maintenance burden**: Custom upload logic scattered across multiple files
- **Scalability limitation**: Cannot handle enterprise-scale batch uploads (10,000+ files)

### 1.3 Scope Clarification

While this PRD addresses **only the client-side blob upload mechanism**, it establishes the foundation for the unified pipeline. Backend issues (file loss during processing) will be addressed in subsequent PRDs (PRD-01 through PRD-04).

---

## 2. Deprecation Registry (Before Implementation)

The following components will be replaced or deprecated:

### 2.1 File Upload Hook (`frontend/src/domains/files/hooks/useFileUpload.ts`)
- **Deprecated**: `XMLHttpRequest` blob upload logic with manual concurrency
- **Replaced by**: Uppy `@uppy/aws-s3` plugin with built-in queue management
- **Lines affected**: ~150-200 lines of manual upload orchestration

### 2.2 Folder Upload Hook (`frontend/src/domains/files/hooks/useFolderUpload.ts`)
- **Deprecated**: `XMLHttpRequest` parallel upload loop (20 concurrent limit)
- **Replaced by**: Uppy queue with configurable concurrency
- **Lines affected**: ~100-150 lines of manual parallel upload logic

### 2.3 Upload Store Progress Tracking (`frontend/src/domains/files/stores/uploadStore.ts`)
- **Deprecated**: Manual progress tracking per file (`uploadProgress: Record<string, number>`)
- **Replaced by**: `useUppyState` reactive progress tracking
- **Keep**: Session/batch orchestration state (not related to blob upload)

### 2.4 File API Client Upload Function (`frontend/src/lib/api/fileApiClient.ts`)
- **Deprecated**: Custom `uploadToBlob()` function with `XMLHttpRequest`
- **Replaced by**: Uppy AwsS3 `getUploadParameters()` callback
- **Lines affected**: ~50-80 lines

### 2.5 Custom Concurrency Management
- **Deprecated**: Manual promise pool with `Promise.all()` batching
- **Replaced by**: Uppy's built-in concurrency control

---

## 3. Solution Pattern

### 3.1 Architecture Overview

Replace manual upload logic with **Uppy in headless mode**, keeping existing UI and backend unchanged.

```
┌─────────────────────────────────────────────────────────────┐
│ Existing shadcn/ui Components (FileUploader, FileList)     │
│ - User file selection, drag-and-drop                       │
│ - Custom progress bars and status indicators               │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ Uppy Core (Headless)                                        │
│ - @uppy/core: Queue management, event system               │
│ - @uppy/react: useUppyState, useUppyEvent, useDropzone     │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ Uppy Plugins                                                │
│ - @uppy/aws-s3: Azure SAS URL upload (adapted)             │
│ - @uppy/golden-retriever: Service Worker crash recovery    │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ Existing Backend (Unchanged)                                │
│ - POST /upload-session/init                                │
│ - POST /upload-session/:id/files/register                  │
│ - POST /upload-session/:id/files/mark-uploaded             │
│ - POST /upload-session/:id/complete                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Core Components

#### 3.2.1 Install Uppy Packages

```bash
npm install --workspace=bc-agent-frontend \
  @uppy/core \
  @uppy/aws-s3 \
  @uppy/golden-retriever \
  @uppy/react
```

#### 3.2.2 Uppy Instance Configuration

Create a reusable Uppy instance factory:

```typescript
// frontend/src/lib/uppy/createUploadInstance.ts
import Uppy from '@uppy/core';
import AwsS3 from '@uppy/aws-s3';
import GoldenRetriever from '@uppy/golden-retriever';

export function createUploadInstance(options: {
  sessionId: string;
  onFileUploaded: (file: UppyFile, response: unknown) => void;
  onError: (error: Error) => void;
  concurrency?: number;
}) {
  const uppy = new Uppy({
    id: `upload-${options.sessionId}`,
    autoProceed: false, // Manual control via .upload()
    restrictions: {
      maxFileSize: 100 * 1024 * 1024, // 100MB per file
      allowedFileTypes: null, // No restrictions (business logic)
    },
  });

  // Azure SAS URL upload (adapted for Azure Blob Storage)
  uppy.use(AwsS3, {
    limit: options.concurrency ?? 20, // Concurrent uploads
    getUploadParameters: async (file) => {
      // Fetch SAS URL from backend
      const sasUrl = await fetchSasUrlForFile(file.id, options.sessionId);

      return {
        method: 'PUT',
        url: sasUrl,
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': file.type || 'application/octet-stream',
        },
      };
    },
  });

  // Crash recovery (Service Worker + IndexedDB)
  uppy.use(GoldenRetriever, {
    serviceWorker: true, // Required for page refresh recovery
    indexedDB: {
      maxFileSize: 5 * 1024 * 1024, // Only store <5MB files in IndexedDB
    },
  });

  // Event handlers
  uppy.on('upload-success', (file, response) => {
    options.onFileUploaded(file, response);
  });

  uppy.on('upload-error', (file, error) => {
    options.onError(new Error(`Upload failed for ${file.name}: ${error.message}`));
  });

  return uppy;
}
```

#### 3.2.3 React Hook Integration

Replace `useFileUpload` and `useFolderUpload` with Uppy-powered hooks:

```typescript
// frontend/src/domains/files/hooks/useUppyUpload.ts
import { useEffect, useState } from 'react';
import { useUppyState, useUppyEvent } from '@uppy/react';
import { createUploadInstance } from '@/lib/uppy/createUploadInstance';

export function useUppyUpload(sessionId: string) {
  const [uppy] = useState(() => createUploadInstance({
    sessionId,
    onFileUploaded: async (file, response) => {
      // Call existing backend endpoint
      await markFileUploaded(sessionId, file.id);
    },
    onError: (error) => {
      console.error('Upload error:', error);
      // Handle error (existing error store)
    },
  }));

  // Reactive progress tracking
  const totalProgress = useUppyState(uppy, (state) => state.totalProgress);
  const files = useUppyState(uppy, (state) => state.files);

  // Cleanup on unmount
  useEffect(() => {
    return () => uppy.close();
  }, [uppy]);

  return {
    uppy,
    totalProgress,
    files,
    startUpload: () => uppy.upload(),
    pauseUpload: () => uppy.pauseAll(),
    resumeUpload: () => uppy.resumeAll(),
    cancelUpload: () => uppy.cancelAll(),
  };
}
```

#### 3.2.4 Service Worker Setup

For Golden Retriever crash recovery:

```typescript
// frontend/public/sw.js
importScripts('https://cdn.jsdelivr.net/npm/@uppy/golden-retriever@3/dist/sw.min.js');

// Service Worker handles file restoration after page refresh
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
```

Register in `frontend/src/app/layout.tsx`:

```typescript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

### 3.3 Key Features

#### 3.3.1 Queue Management with Backpressure
- **Built-in concurrency control**: `limit: N` (default 20)
- **Automatic throttling**: Prevents 10,000 simultaneous HTTP connections
- **Memory-efficient**: Files queued in memory, uploaded sequentially in batches

#### 3.3.2 Automatic Retry with Backoff
- **Per-file retry logic**: Transient failures (network errors, timeouts) automatically retry
- **Exponential backoff**: Prevents thundering herd on server recovery
- **Configurable retry limit**: Default 3 attempts per file

#### 3.3.3 Pause/Resume Capability
```typescript
// User clicks pause button
uppy.pauseAll();

// User clicks resume button
uppy.resumeAll();
```

#### 3.3.4 Crash Recovery Strategy

**Two-tier recovery mechanism**:

1. **Server-side state (Primary)**: PRD-03 ensures all files are persisted in DB when manifest is submitted. After page refresh:
   ```typescript
   // Query server for current batch progress
   const batchState = await getBatchProgress(batchId);

   // Resume uploading only unconfirmed files
   const pendingFiles = batchState.files.filter(f => !f.uploadedAt);
   pendingFiles.forEach(f => uppy.addFile(f));
   uppy.upload();
   ```

2. **Golden Retriever (Secondary UX enhancement)**:
   - Persists file **references** in Service Worker (survives page refresh)
   - Stores small files (<5MiB) in IndexedDB for instant restoration
   - **Critical limitation**: Cannot store 10,000 × 5MB = 50GB in IndexedDB
   - **Use case**: Accidental page refresh during small/medium batch upload (≤100 files)

#### 3.3.5 Progress Tracking
```typescript
// Reactive progress state (0-100)
const totalProgress = useUppyState(uppy, (state) => state.totalProgress);

// Per-file progress
const fileProgress = useUppyState(uppy, (state) =>
  Object.values(state.files).map(f => ({
    id: f.id,
    name: f.name,
    progress: f.progress.percentage,
  }))
);
```

### 3.4 Headless Mode Benefits

Uppy's headless mode means:
- **No forced UI**: We keep existing shadcn/ui components (FileUploader, FileList, progress bars)
- **React hooks only**: `useUppyState`, `useUppyEvent`, `useDropzone` provide state without UI
- **Full design control**: Existing design system unchanged
- **Incremental adoption**: Can migrate one upload path at a time

### 3.5 AwsS3 Plugin Adapted for Azure

Despite the name, `@uppy/aws-s3` works with **any** pre-signed URL, including Azure SAS URLs:

```typescript
getUploadParameters: async (file) => {
  // Fetch Azure SAS URL from backend
  const sasUrl = await fetch(`/api/upload-session/${sessionId}/sas?fileId=${file.id}`)
    .then(r => r.json())
    .then(data => data.sasUrl);

  // Return Azure-compatible upload parameters
  return {
    method: 'PUT', // Azure uses PUT for BlockBlob
    url: sasUrl,   // Full SAS URL with query parameters
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': file.type || 'application/octet-stream',
    },
  };
}
```

**Why this works**:
- Uppy's AwsS3 plugin performs a simple HTTP PUT with the returned URL
- Azure Blob Storage accepts the same PUT request format as AWS S3
- SAS URL query parameters (signature, expiry) work identically to AWS pre-signed URLs

---

## 4. Scope

### 4.1 In Scope

#### 4.1.1 Frontend Changes
- Install Uppy packages (`@uppy/core`, `@uppy/aws-s3`, `@uppy/golden-retriever`, `@uppy/react`)
- Create Uppy instance factory (`createUploadInstance.ts`)
- Replace blob upload logic in `useFileUpload.ts` (single/multi/bulk modes)
- Replace blob upload logic in `useFolderUpload.ts` (folder session mode)
- Service Worker setup for Golden Retriever
- Adapt progress tracking to use `useUppyState`
- Wire Uppy events to existing post-upload callbacks (`markFileUploaded`, `completeBulkUpload`)

#### 4.1.2 Configuration
- Concurrency limit configurable (default 20)
- Retry logic configurable (default 3 attempts)
- IndexedDB size limit for Golden Retriever (default 5MB per file)

#### 4.1.3 Testing
- Frontend unit tests for Uppy hooks
- Manual test of all 3 upload modes:
  1. Single file upload
  2. Bulk upload (≥20 files)
  3. Folder drag-and-drop

### 4.2 Out of Scope

#### 4.2.1 Backend Changes
- **No backend endpoint modifications**: All existing endpoints remain unchanged
- **No database schema changes**: File/session tables unchanged
- **No processing pipeline changes**: Backend file loss issues addressed in PRD-01 through PRD-04

#### 4.2.2 UI/UX Changes
- **No design system changes**: Existing shadcn/ui components unchanged
- **No new UI components**: Keep existing FileUploader, FileList, progress bars
- **Optional**: Pause/resume button (can be added post-migration)

#### 4.2.3 Advanced Features
- **Chunked uploads**: Not required (Azure Blob Storage handles large files)
- **Multi-part uploads**: Not required for 100MB file size limit
- **Upload encryption**: Handled by HTTPS transport layer

---

## 5. Success Criteria

### 5.1 Functional Requirements

#### 5.1.1 All Upload Modes Work
- ✅ Single file upload (1 file)
- ✅ Multi-file upload (2-19 files)
- ✅ Bulk upload (≥20 files)
- ✅ Folder drag-and-drop upload (hierarchical structure preserved)

#### 5.1.2 Queue Management
- ✅ Concurrent uploads limited by Uppy (configurable, default 20)
- ✅ No browser memory exhaustion with 10,000 files queued
- ✅ Upload progress visible per file and overall batch

#### 5.1.3 Retry Logic
- ✅ Automatic retry on transient failures (network error, timeout)
- ✅ Exponential backoff between retry attempts
- ✅ Maximum 3 retry attempts per file (configurable)
- ✅ Failed files clearly indicated with error message

#### 5.1.4 Pause/Resume
- ✅ User can pause entire batch mid-upload
- ✅ User can resume paused batch
- ✅ Paused state persists across page refresh (via server-side batch state)

#### 5.1.5 Crash Recovery
- ✅ After accidental page refresh during upload:
  - Server-side batch state allows resume from last confirmed file
  - Small batches (<100 files, <5MB each) restored via Golden Retriever
- ✅ Large batches (10,000 files) resume from server-side state without IndexedDB

### 5.2 Non-Functional Requirements

#### 5.2.1 Performance
- ✅ Upload throughput ≥ 20 files/second for small files (<1MB)
- ✅ Memory usage ≤ 500MB for 10,000 files queued
- ✅ No UI thread blocking during upload

#### 5.2.2 Compatibility
- ✅ Works in Chrome, Firefox, Safari, Edge (latest 2 versions)
- ✅ Service Worker support (graceful degradation if unavailable)

#### 5.2.3 Maintainability
- ✅ Reduced code complexity: Replace ~300 lines of custom upload logic with ~50 lines of Uppy config
- ✅ Type-safe with TypeScript
- ✅ Unit test coverage ≥80%

### 5.3 Migration Requirements

#### 5.3.1 Backend Unchanged
- ✅ No backend endpoint changes required
- ✅ No database migrations required
- ✅ Existing API contracts preserved

#### 5.3.2 Incremental Rollout
- ✅ Feature flag to toggle between old/new upload engine (optional)
- ✅ Rollback plan: Revert Uppy integration, restore previous hooks

---

## 6. Reusable Code

### 6.1 Keep Unchanged (Backend)
- `POST /upload-session/init`: Initialize upload session
- `POST /upload-session/:id/files/register`: Register files in batch
- `POST /upload-session/:id/files/:fileId/sas-url`: Get SAS URL for blob upload
- `POST /upload-session/:id/files/mark-uploaded`: Confirm file uploaded
- `POST /upload-session/:id/complete`: Complete session and trigger processing

### 6.2 Keep Unchanged (Frontend Utilities)
- `folderReader.ts`: Read folder structure from drag-and-drop (unchanged)
- `fileApiClient.ts`: API client for upload endpoints (only `uploadToBlob()` replaced)

### 6.3 Keep Unchanged (Zustand Stores)
- `uploadStore.ts`: Session/batch orchestration state (progress tracking replaced by Uppy)
- `fileSelectionStore.ts`: Selected files before upload (unchanged)
- `fileListStore.ts`: Uploaded files list (unchanged)

### 6.4 Adapt (Event Wiring)
- Wire Uppy's `upload-success` event to existing `markFileUploaded()` callback
- Wire Uppy's `complete` event to existing `completeBulkUpload()` callback
- Wire Uppy's `upload-error` event to existing error notification system

---

## 7. Dependencies

### 7.1 External Dependencies

#### 7.1.1 NPM Packages
```json
{
  "@uppy/core": "^3.9.0",
  "@uppy/aws-s3": "^3.6.0",
  "@uppy/golden-retriever": "^3.2.0",
  "@uppy/react": "^3.2.0"
}
```

#### 7.1.2 Browser Requirements
- **Service Worker API**: Required for Golden Retriever crash recovery
  - Supported: Chrome 40+, Firefox 44+, Safari 11.1+, Edge 17+
  - Graceful degradation: Fallback to server-side batch state if unavailable
- **IndexedDB**: Required for storing small files (<5MB) during crash recovery
  - Supported: All modern browsers
  - Graceful degradation: Files not stored locally, server-side state used

### 7.2 Internal Dependencies

#### 7.2.1 Existing Backend (No Changes Required)
- Upload session endpoints (already implemented)
- SAS URL generation (already implemented)
- File registration (already implemented)
- Post-upload callbacks (already implemented)

#### 7.2.2 Existing Frontend Stores
- `uploadStore.ts`: Orchestration state (session, batch, file list)
- `fileSelectionStore.ts`: File selection before upload
- `fileListStore.ts`: Uploaded files list

### 7.3 No Blocking Dependencies
This PRD is **standalone** and does not depend on other PRDs. It can be implemented immediately.

---

## 8. Closing Deliverables (Template)

> **Note**: This section will be filled after implementation is complete.

### 8.1 Code Changes

#### 8.1.1 New Files Created
- [ ] `frontend/src/lib/uppy/createUploadInstance.ts`: Uppy instance factory
- [ ] `frontend/src/domains/files/hooks/useUppyUpload.ts`: Uppy React hook
- [ ] `frontend/public/sw.js`: Service Worker for Golden Retriever
- [ ] `frontend/src/lib/uppy/types.ts`: TypeScript types for Uppy integration

#### 8.1.2 Modified Files
- [ ] `frontend/src/domains/files/hooks/useFileUpload.ts`: Replace XMLHttpRequest with Uppy
- [ ] `frontend/src/domains/files/hooks/useFolderUpload.ts`: Replace XMLHttpRequest with Uppy
- [ ] `frontend/src/domains/files/stores/uploadStore.ts`: Remove manual progress tracking
- [ ] `frontend/src/lib/api/fileApiClient.ts`: Remove `uploadToBlob()` function
- [ ] `frontend/src/app/layout.tsx`: Register Service Worker
- [ ] `frontend/package.json`: Add Uppy dependencies

#### 8.1.3 Deleted Code
- [ ] ~XXX lines of custom XMLHttpRequest upload logic
- [ ] ~XXX lines of manual concurrency management
- [ ] ~XXX lines of manual progress tracking

### 8.2 Testing

#### 8.2.1 Unit Tests
- [ ] `useUppyUpload.test.ts`: Hook behavior (start, pause, resume, cancel)
- [ ] `createUploadInstance.test.ts`: Uppy configuration and event wiring
- [ ] Test coverage: ≥80% for new code

#### 8.2.2 Integration Tests
- [ ] Single file upload (1 file, 10MB)
- [ ] Multi-file upload (10 files, 50MB total)
- [ ] Bulk upload (100 files, 500MB total)
- [ ] Folder drag-and-drop (50 files in nested folders)
- [ ] Pause/resume during bulk upload
- [ ] Page refresh during upload (crash recovery)

#### 8.2.3 Manual Testing Checklist
- [ ] Upload 1 file (success)
- [ ] Upload 25 files (success, no data loss)
- [ ] Upload 100 files (success, concurrent limit respected)
- [ ] Upload 1000 files (success, memory usage acceptable)
- [ ] Pause upload, wait 10s, resume (success)
- [ ] Refresh page during upload, resume from batch state (success)
- [ ] Simulate network error during upload, automatic retry (success)
- [ ] Cancel upload mid-batch, all pending files cancelled (success)

### 8.3 Documentation

#### 8.3.1 Code Documentation
- [ ] JSDoc comments for `createUploadInstance()` function
- [ ] JSDoc comments for `useUppyUpload()` hook
- [ ] Inline comments for complex Uppy configuration

#### 8.3.2 Architecture Documentation
- [ ] Update `docs/frontend/upload-architecture.md` with Uppy integration
- [ ] Update CLAUDE.md with Uppy usage guidelines

### 8.4 Deployment

#### 8.4.1 Pre-Deployment Checklist
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing completed
- [ ] Code review approved
- [ ] Service Worker deployed and tested

#### 8.4.2 Rollback Plan
- [ ] Feature flag implemented (optional): `ENABLE_UPPY_UPLOAD`
- [ ] Rollback procedure documented: Revert PR, disable feature flag

### 8.5 Metrics

#### 8.5.1 Before Migration (Baseline)
- [ ] Average upload time for 100 files: XXXs
- [ ] Memory usage during 100-file upload: XXX MB
- [ ] Data loss rate in 25-file test: 32% (8 files lost)
- [ ] Lines of code (upload logic): ~300 lines

#### 8.5.2 After Migration (Target)
- [ ] Average upload time for 100 files: ≤XXXs (no regression)
- [ ] Memory usage during 100-file upload: ≤500 MB
- [ ] Data loss rate in 25-file test: 0% (no files lost on upload)
- [ ] Lines of code (upload logic): ~50 lines (83% reduction)

### 8.6 Known Issues / Future Work
- [ ] IndexedDB storage limited to 5MB per file (by design)
- [ ] Large batches (10,000 files) require server-side batch state for crash recovery
- [ ] Chunked upload (for >100MB files) deferred to future PRD
- [ ] Multi-part upload (for >5GB files) deferred to future PRD

---

## 9. References

### 9.1 Uppy Documentation
- [Uppy Core API](https://uppy.io/docs/uppy/)
- [AwsS3 Plugin (works with Azure SAS)](https://uppy.io/docs/aws-s3/)
- [Golden Retriever Plugin](https://uppy.io/docs/golden-retriever/)
- [React Integration](https://uppy.io/docs/react/)

### 9.2 Related PRDs
- **PRD-01**: Backend file registration atomicity (addresses backend data loss)
- **PRD-02**: Processing pipeline deduplication (addresses duplicate processing)
- **PRD-03**: Unified upload session model (consolidates 4 upload paths)
- **PRD-04**: End-to-end testing and rollout (integration testing)

### 9.3 Architecture Documents
- `docs/frontend/upload-architecture.md`: Current upload flow
- `docs/backend/upload-session.md`: Backend session lifecycle
- `CLAUDE.md`: System overview and conventions

---

**Document Version**: 1.0
**Last Updated**: 2026-02-10
**Author**: Claude Code (Implementation Coder Agent)
**Reviewers**: [To be assigned]
