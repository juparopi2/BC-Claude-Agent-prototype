# PRD-03: Unified Upload Batch Orchestrator

**Status**: Draft
**Author**: System Architecture
**Date**: 2026-02-10
**Dependencies**: PRD-01 (File State Machine), PRD-02 (Duplicate Detection)

---

## 1. Problem Statement

### Current State Analysis

The system currently has **4 different upload entry points** with divergent orchestration logic:

#### Path 1: Single File Upload (`upload.routes.ts`, 209 lines)
- Flow: Multipart upload → direct DB insert → direct job enqueue
- Issues: No batch tracking, duplicate check inconsistent, error handling incomplete

#### Path 2: Multi-File Upload (same route as Path 1)
- Flow: Same as single file + duplicate check loop
- Issues: No atomicity across files, partial failures leave inconsistent state

#### Path 3: Bulk Upload (`bulk.routes.ts`, 456 lines)
- Flow: SAS URL init → blob upload → complete callback → `BulkUploadProcessor`
- Storage: In-memory `BulkUploadBatchStore`
- Issues: **Data lost on server restart**, no recovery mechanism

#### Path 4: Folder Session (`upload-session.routes.ts`, 990 lines)
- Flow: 6-step HTTP sequence → Redis `UploadSessionStore` → polling `FileProcessingScheduler`
- Issues: **Files lost between steps** (8 of 25 files disappeared in testing), non-atomic, complex state management

### Critical Problems

1. **Data Loss**:
   - In-memory stores lost on restart
   - 6-step process loses files between steps
   - No transactional guarantees

2. **Inconsistent Behavior**:
   - Different error handling per path
   - Different persistence timing
   - Different enqueue mechanisms (direct vs polling)

3. **Complexity**:
   - 1,655 lines of code across 3 route files
   - 4 different mental models for developers
   - Impossible to maintain consistency

4. **No Recovery**:
   - Cannot resume interrupted uploads
   - No way to query batch progress
   - Lost files are permanently gone

---

## 2. Deprecation Registry (Before Implementation)

The following components will be marked `@deprecated` with `PRD-03` reference and replaced:

### Routes (1,655 lines total)
- `backend/src/routes/files/upload-session.routes.ts` (990 lines)
  - Replaced by: `POST /api/v2/uploads/batches`
- `backend/src/routes/files/upload.routes.ts` (209 lines)
  - Replaced by: V2 batch with single file
- `backend/src/routes/files/bulk.routes.ts` (456 lines)
  - Replaced by: V2 batch endpoints

### Domain Services
- `backend/src/domains/files/upload-session/UploadSessionManager.ts`
  - Replaced by: `UploadBatchOrchestrator.ts`
- `backend/src/domains/files/upload-session/UploadSessionStore.ts` (Redis)
  - Replaced by: `upload_batches` SQL table (Prisma)
- `backend/src/services/files/BulkUploadProcessor.ts`
  - Replaced by: V2 orchestrator logic
- `backend/src/services/files/BulkUploadBatchStore.ts` (in-memory)
  - Replaced by: SQL-persisted `upload_batches`

### Utilities (Reused, then deprecated)
- `backend/src/shared/utils/FolderNameResolver.ts`
  - Marked `@deprecated(PRD-03)` when V2 absorbs folder resolution
  - Logic reused in orchestrator during migration

### Scheduler (Replaced by Direct Enqueue)
- `backend/src/domains/files/scheduler/FileProcessingScheduler.ts` (polling mechanism)
  - Replaced by: Direct job enqueue in confirm step

---

## 3. Solution Pattern

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Upload Batch Lifecycle                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Phase A                  Phase B                 Phase C       │
│  ┌──────────────┐        ┌──────────┐           ┌──────────┐  │
│  │   Manifest   │───────▶│  Blob    │──────────▶│ Confirm  │  │
│  │  Submission  │        │  Upload  │           │   Per    │  │
│  │              │        │ (Client) │           │   File   │  │
│  │ (Atomic TX)  │        │          │           │ (Atomic) │  │
│  └──────────────┘        └──────────┘           └──────────┘  │
│        │                      │                       │        │
│        ▼                      │                       ▼        │
│  ┌──────────────┐            │                 ┌──────────┐  │
│  │upload_batches│            │                 │files     │  │
│  │folders       │            │                 │ pipeline │  │
│  │files (SAS)   │            │                 │ status   │  │
│  └──────────────┘            │                 │ updates  │  │
│                               │                 └──────────┘  │
│                               ▼                       │        │
│                         Azure Blob                    ▼        │
│                         Storage                  Enqueue Job   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Three-Phase Atomic Design

#### Phase A: Manifest Submission (Single Prisma Transaction)

**Input**: Complete manifest with all files + folder structure
**Atomicity**: ALL-OR-NOTHING — any failure rolls back entire batch
**Output**: Batch metadata with SAS URLs and file IDs

```typescript
// Client sends complete manifest
POST /api/v2/uploads/batches
{
  files: [
    { tempId: 'f1', name: 'doc.pdf', size: 1024, mimeType: 'application/pdf', parentTempId: 'folder1' },
    { tempId: 'f2', name: 'img.png', size: 2048, mimeType: 'image/png', parentTempId: null }
  ],
  folders: [
    { tempId: 'folder1', name: 'Documents', parentTempId: null },
    { tempId: 'folder2', name: 'Subfolder', parentTempId: 'folder1' }
  ]
}

// Server atomically creates (within single transaction):
// 1. upload_batch record (status = 'active')
// 2. All folder records (topological order)
// 3. All file records (pipeline_status = 'registered', with SAS URLs)

// Response includes mapping
{
  batchId: 'BATCH-UUID',
  files: [
    { tempId: 'f1', fileId: 'FILE-UUID-1', sasUrl: 'https://...' },
    { tempId: 'f2', fileId: 'FILE-UUID-2', sasUrl: 'https://...' }
  ],
  folders: [
    { tempId: 'folder1', folderId: 'FOLDER-UUID-1' },
    { tempId: 'folder2', folderId: 'FOLDER-UUID-2' }
  ],
  expiresAt: '2026-02-10T12:00:00Z'
}
```

**Transaction Guarantees**:
- If duplicate detection (PRD-02) rejects any file → entire batch rolled back
- If folder creation fails → entire batch rolled back
- If any file record creation fails → entire batch rolled back
- **No partial state possible**

#### Phase B: Blob Upload (Client-Side, Existing Pattern)

Client uploads blobs directly to Azure Storage using SAS URLs from Phase A.

- Uses Uppy from PRD-00 (concurrency, retry, progress)
- Server not involved (just Azure Storage)
- Unchanged from current implementation

#### Phase C: Per-File Confirmation (Atomic Per File)

Client confirms each file after successful blob upload.

```typescript
POST /api/v2/uploads/batches/:batchId/files/:fileId/confirm

// Server atomically (per file):
// 1. Verifies blob exists in Azure Storage
// 2. Transitions pipeline_status: registered → uploaded → queued (PRD-01)
// 3. Enqueues processing job directly (no scheduler)
// 4. Updates batch progress counter (confirmed++, processed++ or failed++)

// Response
{
  fileId: 'FILE-UUID',
  pipelineStatus: 'queued',
  batchProgress: {
    total: 25,
    confirmed: 15,
    processed: 10,
    failed: 0
  }
}
```

**Independence**: One file's confirmation failure does NOT affect other files.

---

## 4. Data Model

### Prisma Schema Addition

```prisma
model upload_batches {
  id            String   @id @default(uuid()) @db.NVarChar(50)
  user_id       String   @db.NVarChar(50)
  status        String   @db.NVarChar(20)  // active, completed, expired, cancelled
  total_files   Int
  confirmed     Int      @default(0)
  processed     Int      @default(0)
  failed        Int      @default(0)
  created_at    DateTime @default(now()) @db.DateTime
  updated_at    DateTime @updatedAt @db.DateTime
  expires_at    DateTime @db.DateTime
  metadata      String?  @db.NVarChar(Max)  // JSON string (batch name, client info, etc.)

  // Relations
  users         users    @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id, status])
  @@index([expires_at])
  @@map("upload_batches")
}

// Add to existing files model
model files {
  // ... existing fields ...
  batch_id      String?  @db.NVarChar(50)
  batch         upload_batches? @relation(fields: [batch_id], references: [id], onDelete: SetNull)

  @@index([batch_id])
}
```

### Batch Status State Machine

```
active ──────▶ completed   (all files processed successfully)
   │
   ├─────────▶ expired     (TTL exceeded before completion)
   │
   └─────────▶ cancelled   (user cancelled, cleanup triggered)
```

### Batch Progress Tracking

```typescript
interface BatchProgress {
  total: number;      // Total files in manifest
  confirmed: number;  // Files successfully uploaded to blob storage
  processed: number;  // Files successfully processed (vectorized, thumbnailed)
  failed: number;     // Files that failed processing
}

// Batch transitions to 'completed' when: processed + failed === total
```

---

## 5. Folder Resolution Algorithm

### Problem

Client sends folders with temporary IDs (`tempId`). Server must:
1. Create folder records in database
2. Resolve parent references (parentTempId → real folder_id)
3. Create file records with resolved folder_id references
4. All within a single transaction

### Algorithm: Topological Sort

```typescript
/**
 * Resolve folder hierarchy in topological order (parents before children)
 *
 * Input: Folders with tempId and parentTempId
 * Output: Folders sorted so parents come before children
 */
function topologicalSortFolders(folders: ManifestFolder[]): ManifestFolder[] {
  const sorted: ManifestFolder[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(folder: ManifestFolder) {
    if (visited.has(folder.tempId)) return;
    if (visiting.has(folder.tempId)) {
      throw new Error(`Circular folder reference detected: ${folder.tempId}`);
    }

    visiting.add(folder.tempId);

    // Visit parent first
    if (folder.parentTempId) {
      const parent = folders.find(f => f.tempId === folder.parentTempId);
      if (!parent) {
        throw new Error(`Parent folder not found: ${folder.parentTempId}`);
      }
      visit(parent);
    }

    visiting.delete(folder.tempId);
    visited.add(folder.tempId);
    sorted.push(folder);
  }

  folders.forEach(visit);
  return sorted;
}
```

### Transaction Flow

```typescript
async createBatch(userId: string, manifest: UploadManifest): Promise<BatchCreationResult> {
  return await this.prisma.$transaction(async (tx) => {
    // Step 1: Create batch record
    const batch = await tx.upload_batches.create({
      data: {
        user_id: userId,
        status: 'active',
        total_files: manifest.files.length,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
      }
    });

    // Step 2: Sort folders topologically
    const sortedFolders = topologicalSortFolders(manifest.folders);

    // Step 3: Create folders in order, building tempId → realId map
    const folderIdMap = new Map<string, string>();
    for (const folder of sortedFolders) {
      const parentId = folder.parentTempId ? folderIdMap.get(folder.parentTempId) : null;

      const dbFolder = await tx.folders.create({
        data: {
          user_id: userId,
          name: folder.name,
          parent_id: parentId,
        }
      });

      folderIdMap.set(folder.tempId, dbFolder.id);
    }

    // Step 4: Run duplicate detection (PRD-02) on all files
    const dupes = await this.duplicateDetector.detectBatch(
      userId,
      manifest.files.map(f => ({ name: f.name, size: f.size, folderId: folderIdMap.get(f.parentTempId) })),
      tx
    );
    if (dupes.length > 0) {
      throw new DuplicateFilesError(dupes);  // Rolls back transaction
    }

    // Step 5: Create file records with SAS URLs
    const fileResults: BatchFileResult[] = [];
    for (const file of manifest.files) {
      const folderId = file.parentTempId ? folderIdMap.get(file.parentTempId) : null;

      // Generate SAS URL (24h write-only)
      const sasUrl = await this.sasGenerator.generateUploadUrl(userId, file.name);

      const dbFile = await tx.files.create({
        data: {
          user_id: userId,
          batch_id: batch.id,
          name: file.name,
          size: file.size,
          mime_type: file.mimeType,
          folder_id: folderId,
          pipeline_status: 'registered',  // PRD-01 initial state
          storage_path: this.buildStoragePath(userId, file.name),
        }
      });

      fileResults.push({
        tempId: file.tempId,
        fileId: dbFile.id,
        sasUrl: sasUrl,
      });
    }

    // Step 6: Return complete batch metadata
    return {
      batchId: batch.id,
      files: fileResults,
      folders: Array.from(folderIdMap.entries()).map(([tempId, folderId]) => ({
        tempId,
        folderId,
      })),
      expiresAt: batch.expires_at,
    };
  });
}
```

**Key Properties**:
- Entire operation in single Prisma transaction
- Folder creation respects parent-child order
- Duplicate detection runs before any file records created
- Any failure at any step rolls back everything
- No partial state survives

---

## 6. API Specification

### 6.1 Create Batch

**Endpoint**: `POST /api/v2/uploads/batches`
**Authentication**: Required (JWT)
**Content-Type**: `application/json`

#### Request Body

```typescript
interface CreateBatchRequest {
  files: ManifestFile[];
  folders?: ManifestFolder[];
  metadata?: {
    batchName?: string;
    clientInfo?: string;
  };
}

interface ManifestFile {
  tempId: string;            // Client-generated temp ID for mapping
  name: string;              // File name (max 255 chars)
  size: number;              // File size in bytes
  mimeType: string;          // MIME type
  parentTempId?: string;     // Folder tempId (null = root)
}

interface ManifestFolder {
  tempId: string;            // Client-generated temp ID
  name: string;              // Folder name (max 255 chars)
  parentTempId?: string;     // Parent folder tempId (null = root)
}
```

#### Response (201 Created)

```typescript
interface CreateBatchResponse {
  batchId: string;
  files: BatchFileResult[];
  folders: BatchFolderResult[];
  expiresAt: string;         // ISO 8601
  status: 'active';
}

interface BatchFileResult {
  tempId: string;            // From request
  fileId: string;            // Real UUID
  sasUrl: string;            // Azure Storage SAS URL (24h write-only)
}

interface BatchFolderResult {
  tempId: string;            // From request
  folderId: string;          // Real UUID
}
```

#### Error Responses

```typescript
// 400 Bad Request - Invalid manifest
{
  error: 'INVALID_MANIFEST',
  message: 'Circular folder reference detected',
  details: { folderId: 'folder1' }
}

// 409 Conflict - Duplicate files detected (PRD-02)
{
  error: 'DUPLICATE_FILES',
  message: 'Duplicate files detected',
  duplicates: [
    { name: 'doc.pdf', existingFileId: 'FILE-UUID', folderId: 'FOLDER-UUID' }
  ]
}

// 413 Payload Too Large - Batch exceeds limits
{
  error: 'BATCH_TOO_LARGE',
  message: 'Batch exceeds maximum 500 files',
  limit: 500,
  actual: 750
}
```

### 6.2 Confirm File Upload

**Endpoint**: `POST /api/v2/uploads/batches/:batchId/files/:fileId/confirm`
**Authentication**: Required (JWT)
**Content-Type**: `application/json`

#### Request Body

```typescript
interface ConfirmFileRequest {
  // Optional: client-side hash for integrity verification
  hash?: string;
  hashAlgorithm?: 'sha256' | 'md5';
}
```

#### Response (200 OK)

```typescript
interface ConfirmFileResponse {
  fileId: string;
  pipelineStatus: 'queued';  // From PRD-01 state machine
  batchProgress: {
    total: number;
    confirmed: number;
    processed: number;
    failed: number;
  };
}
```

#### Error Responses

```typescript
// 404 Not Found - Batch or file not found
{
  error: 'BATCH_NOT_FOUND',
  message: 'Batch not found or expired'
}

// 409 Conflict - Blob not found in storage
{
  error: 'BLOB_NOT_FOUND',
  message: 'Blob not found in Azure Storage',
  details: { storagePath: 'user123/doc.pdf' }
}

// 410 Gone - Batch expired
{
  error: 'BATCH_EXPIRED',
  message: 'Batch expired (TTL: 24h)',
  expiredAt: '2026-02-09T12:00:00Z'
}
```

### 6.3 Get Batch Status

**Endpoint**: `GET /api/v2/uploads/batches/:batchId`
**Authentication**: Required (JWT)

#### Response (200 OK)

```typescript
interface GetBatchResponse {
  batchId: string;
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  progress: {
    total: number;
    confirmed: number;
    processed: number;
    failed: number;
  };
  files: BatchFileStatus[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface BatchFileStatus {
  fileId: string;
  name: string;
  pipelineStatus: FileProcessingStatus;  // From PRD-01
  errorMessage?: string;
}
```

### 6.4 Cancel Batch

**Endpoint**: `DELETE /api/v2/uploads/batches/:batchId`
**Authentication**: Required (JWT)

#### Response (200 OK)

```typescript
interface CancelBatchResponse {
  batchId: string;
  status: 'cancelled';
  cleanup: {
    filesDeleted: number;       // Unconfirmed files removed from DB
    blobsDeleted: number;        // Confirmed blobs deleted from storage
    jobsCancelled: number;       // Pending jobs cancelled
  };
}
```

---

## 7. Sequence Diagrams

### 7.1 Successful Upload Flow

```
Client                  API Server              Database            Azure Storage       Queue
  │                         │                       │                      │              │
  │  POST /batches          │                       │                      │              │
  │ (manifest)              │                       │                      │              │
  ├────────────────────────▶│                       │                      │              │
  │                         │                       │                      │              │
  │                         │ BEGIN TX              │                      │              │
  │                         ├──────────────────────▶│                      │              │
  │                         │                       │                      │              │
  │                         │ INSERT upload_batch   │                      │              │
  │                         ├──────────────────────▶│                      │              │
  │                         │ INSERT folders (topo) │                      │              │
  │                         ├──────────────────────▶│                      │              │
  │                         │ INSERT files          │                      │              │
  │                         ├──────────────────────▶│                      │              │
  │                         │                       │                      │              │
  │                         │ COMMIT TX             │                      │              │
  │                         ├──────────────────────▶│                      │              │
  │                         │                       │                      │              │
  │  201 Created            │                       │                      │              │
  │ (batchId, SAS URLs)     │                       │                      │              │
  │◀────────────────────────┤                       │                      │              │
  │                         │                       │                      │              │
  │  PUT blob (f1)          │                       │                      │              │
  ├─────────────────────────────────────────────────────────────────────▶│              │
  │  200 OK                 │                       │                      │              │
  │◀─────────────────────────────────────────────────────────────────────┤              │
  │                         │                       │                      │              │
  │  POST /confirm (f1)     │                       │                      │              │
  ├────────────────────────▶│                       │                      │              │
  │                         │                       │                      │              │
  │                         │ Verify blob exists    │                      │              │
  │                         ├─────────────────────────────────────────────▶│              │
  │                         │ Blob exists           │                      │              │
  │                         │◀─────────────────────────────────────────────┤              │
  │                         │                       │                      │              │
  │                         │ UPDATE file           │                      │              │
  │                         │ (status→queued)       │                      │              │
  │                         ├──────────────────────▶│                      │              │
  │                         │                       │                      │              │
  │                         │ Enqueue job           │                      │              │
  │                         ├───────────────────────────────────────────────────────────▶│
  │                         │                       │                      │              │
  │  200 OK                 │                       │                      │              │
  │ (progress)              │                       │                      │              │
  │◀────────────────────────┤                       │                      │              │
  │                         │                       │                      │              │
  │  PUT blob (f2)          │                       │                      │              │
  ├─────────────────────────────────────────────────────────────────────▶│              │
  │                         │                       │                      │              │
  │  POST /confirm (f2)     │                       │                      │              │
  ├────────────────────────▶│                       │                      │              │
  │  200 OK                 │                       │                      │              │
  │◀────────────────────────┤                       │                      │              │
  │                         │                       │                      │              │
  │  GET /batches/:id       │                       │                      │              │
  ├────────────────────────▶│                       │                      │              │
  │  200 OK                 │                       │                      │              │
  │ (status: completed)     │                       │                      │              │
  │◀────────────────────────┤                       │                      │              │
```

### 7.2 Failure Scenarios

#### Scenario A: Transaction Rollback (Duplicate Detected)

```
Client                  API Server              Database
  │                         │                       │
  │  POST /batches          │                       │
  │ (manifest with dupe)    │                       │
  ├────────────────────────▶│                       │
  │                         │                       │
  │                         │ BEGIN TX              │
  │                         ├──────────────────────▶│
  │                         │ INSERT batch          │
  │                         ├──────────────────────▶│
  │                         │ INSERT folders        │
  │                         ├──────────────────────▶│
  │                         │                       │
  │                         │ Check duplicates      │
  │                         ├──────────────────────▶│
  │                         │ FOUND: doc.pdf        │
  │                         │◀──────────────────────┤
  │                         │                       │
  │                         │ ROLLBACK TX           │
  │                         ├──────────────────────▶│
  │                         │                       │
  │  409 Conflict           │                       │
  │ (duplicate details)     │                       │
  │◀────────────────────────┤                       │
  │                         │                       │
  │ NO PARTIAL STATE IN DB  │                       │
```

#### Scenario B: Blob Upload Failure (Client Retries)

```
Client                  API Server              Azure Storage
  │                         │                       │
  │  POST /batches          │                       │
  ├────────────────────────▶│                       │
  │  201 Created            │                       │
  │ (SAS URLs)              │                       │
  │◀────────────────────────┤                       │
  │                         │                       │
  │  PUT blob (f1)          │                       │
  ├─────────────────────────────────────────────────▶│
  │  500 Internal Error     │                       │
  │◀─────────────────────────────────────────────────┤
  │                         │                       │
  │  [Client retries via Uppy]                      │
  │                         │                       │
  │  PUT blob (f1) [retry]  │                       │
  ├─────────────────────────────────────────────────▶│
  │  200 OK                 │                       │
  │◀─────────────────────────────────────────────────┤
  │                         │                       │
  │  POST /confirm (f1)     │                       │
  ├────────────────────────▶│                       │
  │  200 OK                 │                       │
  │◀────────────────────────┤                       │
```

#### Scenario C: Confirm Before Upload (Error)

```
Client                  API Server              Azure Storage
  │                         │                       │
  │  POST /batches          │                       │
  ├────────────────────────▶│                       │
  │  201 Created            │                       │
  │◀────────────────────────┤                       │
  │                         │                       │
  │  POST /confirm (f1)     │                       │
  │ [before uploading blob] │                       │
  ├────────────────────────▶│                       │
  │                         │                       │
  │                         │ Verify blob exists    │
  │                         ├─────────────────────────────────────▶│
  │                         │ 404 Not Found         │              │
  │                         │◀─────────────────────────────────────┤
  │                         │                       │              │
  │  409 Conflict           │                       │              │
  │ (blob not found)        │                       │              │
  │◀────────────────────────┤                       │              │
  │                         │                       │              │
  │ File stays in           │                       │              │
  │ 'registered' status     │                       │              │
```

---

## 8. Implementation Components

### 8.1 Domain Service: UploadBatchOrchestrator

**Location**: `backend/src/domains/files/batch/UploadBatchOrchestrator.ts`

```typescript
export interface IUploadBatchOrchestrator {
  /**
   * Phase A: Create batch atomically
   * @throws DuplicateFilesError if duplicates detected (PRD-02)
   * @throws InvalidManifestError if folder hierarchy invalid
   */
  createBatch(
    userId: string,
    manifest: UploadManifest
  ): Promise<BatchCreationResult>;

  /**
   * Phase C: Confirm file upload atomically
   * @throws BlobNotFoundError if blob doesn't exist in storage
   * @throws BatchExpiredError if batch TTL exceeded
   */
  confirmFile(
    batchId: string,
    fileId: string,
    userId: string
  ): Promise<ConfirmFileResult>;

  /**
   * Get batch status and progress
   */
  getBatchStatus(batchId: string, userId: string): Promise<BatchStatus>;

  /**
   * Cancel batch with cleanup
   */
  cancelBatch(batchId: string, userId: string): Promise<CancelBatchResult>;
}

export class UploadBatchOrchestrator implements IUploadBatchOrchestrator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly duplicateDetector: IDuplicateDetector,  // PRD-02
    private readonly sasGenerator: ISasUrlGenerator,
    private readonly blobService: IBlobService,
    private readonly queueService: IQueueService,
    private readonly logger: ILoggerMinimal
  ) {}

  async createBatch(
    userId: string,
    manifest: UploadManifest
  ): Promise<BatchCreationResult> {
    // Validate manifest
    this.validateManifest(manifest);

    return await this.prisma.$transaction(async (tx) => {
      // 1. Create batch record
      const batch = await tx.upload_batches.create({
        data: {
          user_id: userId.toUpperCase(),
          status: 'active',
          total_files: manifest.files.length,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          metadata: manifest.metadata ? JSON.stringify(manifest.metadata) : null,
        }
      });

      // 2. Sort folders topologically
      const sortedFolders = this.topologicalSortFolders(manifest.folders ?? []);

      // 3. Create folders, build tempId → realId map
      const folderIdMap = new Map<string, string>();
      for (const folder of sortedFolders) {
        const parentId = folder.parentTempId
          ? folderIdMap.get(folder.parentTempId)
          : null;

        const dbFolder = await tx.folders.create({
          data: {
            user_id: userId.toUpperCase(),
            name: folder.name,
            parent_id: parentId?.toUpperCase(),
          }
        });

        folderIdMap.set(folder.tempId, dbFolder.id);
      }

      // 4. Run duplicate detection (PRD-02)
      const filesToCheck = manifest.files.map(f => ({
        name: f.name,
        size: f.size,
        folderId: f.parentTempId ? folderIdMap.get(f.parentTempId) : null,
      }));

      const dupes = await this.duplicateDetector.detectBatch(
        userId,
        filesToCheck,
        tx
      );

      if (dupes.length > 0) {
        throw new DuplicateFilesError(dupes);  // Rolls back transaction
      }

      // 5. Create file records with SAS URLs
      const fileResults: BatchFileResult[] = [];
      for (const file of manifest.files) {
        const folderId = file.parentTempId
          ? folderIdMap.get(file.parentTempId)
          : null;

        const storagePath = this.buildStoragePath(userId, file.name);
        const sasUrl = await this.sasGenerator.generateUploadUrl(
          userId,
          storagePath,
          { expiresIn: 24 * 60 * 60 }  // 24h
        );

        const dbFile = await tx.files.create({
          data: {
            user_id: userId.toUpperCase(),
            batch_id: batch.id,
            name: file.name,
            size: file.size,
            mime_type: file.mimeType,
            folder_id: folderId?.toUpperCase(),
            pipeline_status: 'registered',  // PRD-01 initial state
            storage_path: storagePath,
          }
        });

        fileResults.push({
          tempId: file.tempId,
          fileId: dbFile.id,
          sasUrl: sasUrl,
        });
      }

      // 6. Return complete batch metadata
      return {
        batchId: batch.id,
        files: fileResults,
        folders: Array.from(folderIdMap.entries()).map(([tempId, folderId]) => ({
          tempId,
          folderId,
        })),
        expiresAt: batch.expires_at.toISOString(),
      };
    });
  }

  async confirmFile(
    batchId: string,
    fileId: string,
    userId: string
  ): Promise<ConfirmFileResult> {
    // 1. Load batch and file
    const batch = await this.prisma.upload_batches.findUnique({
      where: { id: batchId.toUpperCase(), user_id: userId.toUpperCase() }
    });

    if (!batch) {
      throw new BatchNotFoundError(batchId);
    }

    if (batch.status === 'expired') {
      throw new BatchExpiredError(batchId, batch.expires_at);
    }

    const file = await this.prisma.files.findUnique({
      where: {
        id: fileId.toUpperCase(),
        user_id: userId.toUpperCase(),
        batch_id: batchId.toUpperCase()
      }
    });

    if (!file) {
      throw new FileNotFoundError(fileId);
    }

    // 2. Verify blob exists in Azure Storage
    const blobExists = await this.blobService.exists(file.storage_path);
    if (!blobExists) {
      throw new BlobNotFoundError(file.storage_path);
    }

    // 3. Transition file status: registered → uploaded → queued (PRD-01)
    const updatedFile = await this.prisma.files.update({
      where: { id: fileId.toUpperCase() },
      data: { pipeline_status: 'queued' }
    });

    // 4. Enqueue processing job directly (no scheduler)
    await this.queueService.enqueueFileProcessing({
      fileId: file.id,
      userId: userId.toUpperCase(),
      storagePath: file.storage_path,
    });

    // 5. Update batch progress
    const updatedBatch = await this.prisma.upload_batches.update({
      where: { id: batchId.toUpperCase() },
      data: { confirmed: { increment: 1 } }
    });

    return {
      fileId: file.id,
      pipelineStatus: 'queued',
      batchProgress: {
        total: updatedBatch.total_files,
        confirmed: updatedBatch.confirmed,
        processed: updatedBatch.processed,
        failed: updatedBatch.failed,
      }
    };
  }

  private topologicalSortFolders(folders: ManifestFolder[]): ManifestFolder[] {
    const sorted: ManifestFolder[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const folderMap = new Map(folders.map(f => [f.tempId, f]));

    const visit = (folder: ManifestFolder) => {
      if (visited.has(folder.tempId)) return;
      if (visiting.has(folder.tempId)) {
        throw new InvalidManifestError(
          `Circular folder reference detected: ${folder.tempId}`
        );
      }

      visiting.add(folder.tempId);

      if (folder.parentTempId) {
        const parent = folderMap.get(folder.parentTempId);
        if (!parent) {
          throw new InvalidManifestError(
            `Parent folder not found: ${folder.parentTempId}`
          );
        }
        visit(parent);
      }

      visiting.delete(folder.tempId);
      visited.add(folder.tempId);
      sorted.push(folder);
    };

    folders.forEach(visit);
    return sorted;
  }

  private validateManifest(manifest: UploadManifest): void {
    if (manifest.files.length === 0) {
      throw new InvalidManifestError('Manifest must contain at least 1 file');
    }

    if (manifest.files.length > 500) {
      throw new InvalidManifestError(`Batch exceeds maximum 500 files (got ${manifest.files.length})`);
    }

    // Validate unique tempIds
    const tempIds = new Set<string>();
    for (const file of manifest.files) {
      if (tempIds.has(file.tempId)) {
        throw new InvalidManifestError(`Duplicate tempId: ${file.tempId}`);
      }
      tempIds.add(file.tempId);
    }

    for (const folder of manifest.folders ?? []) {
      if (tempIds.has(folder.tempId)) {
        throw new InvalidManifestError(`Duplicate tempId: ${folder.tempId}`);
      }
      tempIds.add(folder.tempId);
    }
  }

  private buildStoragePath(userId: string, fileName: string): string {
    return `${userId}/${crypto.randomUUID()}-${fileName}`;
  }
}
```

### 8.2 Route Controller

**Location**: `backend/src/routes/files/v2/batch.routes.ts`

```typescript
import express from 'express';
import { authenticateJWT } from '@/domains/auth/middleware/auth.middleware';
import { getUploadBatchOrchestrator } from '@/domains/files/batch/UploadBatchOrchestrator';
import { CreateBatchRequestSchema } from '@bc-agent/shared';

const router = express.Router();
const orchestrator = getUploadBatchOrchestrator();

// POST /api/v2/uploads/batches
router.post('/batches', authenticateJWT, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const manifest = CreateBatchRequestSchema.parse(req.body);

    const result = await orchestrator.createBatch(userId, manifest);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/uploads/batches/:batchId/files/:fileId/confirm
router.post('/batches/:batchId/files/:fileId/confirm', authenticateJWT, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { batchId, fileId } = req.params;

    const result = await orchestrator.confirmFile(batchId, fileId, userId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/uploads/batches/:batchId
router.get('/batches/:batchId', authenticateJWT, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { batchId } = req.params;

    const status = await orchestrator.getBatchStatus(batchId, userId);

    res.status(200).json(status);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/uploads/batches/:batchId
router.delete('/batches/:batchId', authenticateJWT, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { batchId } = req.params;

    const result = await orchestrator.cancelBatch(batchId, userId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
```

### 8.3 Shared Types (Zod Schemas)

**Location**: `packages/shared/src/types/upload-batch.types.ts`

```typescript
import { z } from 'zod';

export const ManifestFileSchema = z.object({
  tempId: z.string().min(1),
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().min(1),
  parentTempId: z.string().optional(),
});

export const ManifestFolderSchema = z.object({
  tempId: z.string().min(1),
  name: z.string().min(1).max(255),
  parentTempId: z.string().optional(),
});

export const CreateBatchRequestSchema = z.object({
  files: z.array(ManifestFileSchema).min(1).max(500),
  folders: z.array(ManifestFolderSchema).optional(),
  metadata: z.object({
    batchName: z.string().optional(),
    clientInfo: z.string().optional(),
  }).optional(),
});

export const BatchFileResultSchema = z.object({
  tempId: z.string(),
  fileId: z.string().uuid(),
  sasUrl: z.string().url(),
});

export const BatchFolderResultSchema = z.object({
  tempId: z.string(),
  folderId: z.string().uuid(),
});

export const CreateBatchResponseSchema = z.object({
  batchId: z.string().uuid(),
  files: z.array(BatchFileResultSchema),
  folders: z.array(BatchFolderResultSchema),
  expiresAt: z.string().datetime(),
  status: z.literal('active'),
});

export type ManifestFile = z.infer<typeof ManifestFileSchema>;
export type ManifestFolder = z.infer<typeof ManifestFolderSchema>;
export type CreateBatchRequest = z.infer<typeof CreateBatchRequestSchema>;
export type BatchFileResult = z.infer<typeof BatchFileResultSchema>;
export type BatchFolderResult = z.infer<typeof BatchFolderResultSchema>;
export type CreateBatchResponse = z.infer<typeof CreateBatchResponseSchema>;
```

---

## 9. Scope

### In Scope

1. **Phase A Implementation**: Single Prisma transaction for batch creation
2. **Phase C Implementation**: Atomic per-file confirmation with direct job enqueue
3. **Folder Resolution**: Topological sort and parent reference resolution
4. **Duplicate Detection Integration**: Call PRD-02 detector during batch creation
5. **State Machine Integration**: Use PRD-01 status transitions
6. **API Endpoints**: 4 new V2 endpoints under `/api/v2/uploads/`
7. **Prisma Schema**: `upload_batches` model and file relation
8. **Error Handling**: Proper error classes and rollback semantics
9. **Unit Tests**: Orchestrator logic, folder sort, validation
10. **Integration Tests**: Full transaction flow with Prisma

### Out of Scope (Future PRDs)

1. **Frontend Integration**: Uppy configuration for V2 API (separate PRD)
2. **Batch Expiration Worker**: Background job to clean expired batches (separate PRD)
3. **Progress WebSocket Events**: Real-time progress updates (separate PRD)
4. **Resume Interrupted Uploads**: Client-side resume after disconnect (separate PRD)
5. **Batch Templates**: Predefined folder structures (separate PRD)
6. **Admin Batch Management**: UI for admins to view/cancel batches (separate PRD)

---

## 10. Success Criteria

### Functional Requirements

- [ ] **Single Code Path**: 1 file, 25 files, or 500 files use identical logic
- [ ] **Atomicity**: Transaction failure rolls back entire batch (no partial state)
- [ ] **Folder Support**: Nested folder structures created correctly
- [ ] **Duplicate Detection**: PRD-02 integration prevents duplicates at batch creation
- [ ] **State Machine**: PRD-01 transitions enforced (`registered → queued`)
- [ ] **Direct Enqueue**: No polling scheduler, jobs enqueued immediately on confirm
- [ ] **Recoverable**: Batch queryable after client disconnect
- [ ] **Idempotent Confirm**: Multiple confirm calls don't break state

### Performance Requirements

- [ ] **Batch Creation**: < 2 seconds for 100 files (transaction + SAS URL generation)
- [ ] **Confirm Per File**: < 500ms per file (blob check + DB update + enqueue)
- [ ] **Folder Sort**: < 100ms for 50 folders (topological sort)

### Testing Requirements

- [ ] **Unit Tests**:
  - Folder topological sort (valid, circular, missing parent)
  - Manifest validation (empty, too large, duplicate tempIds)
  - Folder ID map resolution
- [ ] **Integration Tests**:
  - Full batch transaction (success)
  - Transaction rollback on duplicate (PRD-02)
  - Transaction rollback on invalid folder hierarchy
  - Confirm without blob (error)
  - Confirm idempotency
- [ ] **E2E Tests**:
  - Full lifecycle via curl: create → upload → confirm → status
  - 25-file batch with nested folders
  - Batch cancellation with cleanup

### Curl Verification

Complete workflow testable via curl:

```bash
# 1. Create batch
curl -X POST http://localhost:3002/api/v2/uploads/batches \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      {"tempId": "f1", "name": "doc.pdf", "size": 1024, "mimeType": "application/pdf"}
    ]
  }'

# Response: { "batchId": "...", "files": [{"fileId": "...", "sasUrl": "..."}] }

# 2. Upload blob
curl -X PUT "$SAS_URL" \
  -H "x-ms-blob-type: BlockBlob" \
  --data-binary @doc.pdf

# 3. Confirm file
curl -X POST http://localhost:3002/api/v2/uploads/batches/$BATCH_ID/files/$FILE_ID/confirm \
  -H "Authorization: Bearer $TOKEN"

# Response: { "pipelineStatus": "queued", "batchProgress": {...} }

# 4. Check status
curl http://localhost:3002/api/v2/uploads/batches/$BATCH_ID \
  -H "Authorization: Bearer $TOKEN"

# Response: { "status": "active", "progress": {...}, "files": [...] }
```

---

## 11. Reusable Code

The following existing code can be reused:

1. **SAS URL Generation**: `FileUploadService.generateSasUrlForBulkUpload()`
2. **Blob Existence Check**: `BlobService.exists(path)`
3. **Folder Resolution**: `FolderNameResolver.ts` logic (refactor into orchestrator)
4. **Duplicate Detection**: `DuplicateDetector.detectBatch()` from PRD-02
5. **State Machine**: `FileProcessingStateMachine.transition()` from PRD-01
6. **Queue Enqueue**: `QueueService.enqueueFileProcessing()`

---

## 12. Dependencies

### Upstream Dependencies

- **PRD-01**: File State Machine (Prisma repository)
  - Required for: `pipeline_status` transitions
  - Status: Must be completed first

- **PRD-02**: Duplicate Detection
  - Required for: `detectBatch()` call in transaction
  - Status: Must be completed first

### Downstream Dependencies

- **PRD-04**: Frontend Uppy V2 Integration (future)
  - Consumes: V2 batch API endpoints
  - Status: Blocked by PRD-03

---

## 13. Migration Strategy

### Phase 1: V2 Implementation (No Breaking Changes)

1. Create `upload_batches` Prisma model
2. Implement `UploadBatchOrchestrator`
3. Create V2 routes under `/api/v2/uploads/`
4. **V1 routes remain active** (no deprecation yet)

### Phase 2: Parallel Operation (Validation)

1. Frontend can use V1 or V2 (feature flag)
2. Monitor V2 error rates and performance
3. Compare data integrity between V1 and V2

### Phase 3: V1 Deprecation

1. Mark V1 routes `@deprecated` in code
2. Add deprecation headers to V1 responses:
   ```
   Deprecation: true
   Sunset: 2026-03-10T00:00:00Z
   Link: </api/v2/uploads/batches>; rel="alternate"
   ```
3. Update frontend to use V2 exclusively

### Phase 4: V1 Removal

1. Remove V1 route files (after 30-day sunset period)
2. Remove `UploadSessionManager`, `BulkUploadProcessor`, etc.
3. Archive legacy code with git tag `pre-unified-upload`

---

## 14. Closing Deliverables

Upon completion of PRD-03, the following artifacts MUST be delivered:

### Code Artifacts

- [ ] `backend/src/domains/files/batch/UploadBatchOrchestrator.ts` (domain service)
- [ ] `backend/src/domains/files/batch/IUploadBatchOrchestrator.ts` (interface)
- [ ] `backend/src/routes/files/v2/batch.routes.ts` (API controller)
- [ ] `packages/shared/src/types/upload-batch.types.ts` (Zod schemas)
- [ ] `backend/prisma/schema.prisma` (updated with `upload_batches` model)

### Test Artifacts

- [ ] `backend/tests/unit/domains/files/batch/UploadBatchOrchestrator.test.ts`
- [ ] `backend/tests/integration/domains/files/batch/batch-transaction.test.ts`
- [ ] `backend/tests/e2e/files/batch-upload.test.ts`

### Documentation Artifacts

- [ ] `docs/backend/FILES-BATCH-UPLOAD.md` (API guide with curl examples)
- [ ] Update `backend/src/domains/files/CLAUDE.md` with V2 architecture
- [ ] Update `CLAUDE.md` root doc with batch upload pattern

### Deprecation Artifacts

- [ ] Mark legacy routes with `@deprecated(PRD-03)` comments
- [ ] Add deprecation notices to V1 route README (if exists)
- [ ] Create `docs/migration/UPLOAD-V1-TO-V2.md` migration guide

### Verification Artifacts

- [ ] Curl script demonstrating full lifecycle (`scripts/verify-batch-upload.sh`)
- [ ] Performance benchmark results (100 files, transaction timing)
- [ ] Integration test results showing transaction rollback

---

## 15. Open Questions

1. **Batch TTL Policy**: 24 hours sufficient? Should it be configurable per user tier?
2. **Confirm Retry Logic**: Should server allow re-confirm if blob already verified?
3. **Partial Batch Completion**: If user only confirms 10 of 25 files, when does batch transition to 'completed'?
4. **SAS URL Expiration**: 24 hours matches batch TTL. Should it be shorter to limit exposure?
5. **Batch Name Uniqueness**: Should batch names be unique per user (for UI display)?

---

## 16. Risk Assessment

### High Risk

- **Transaction Performance**: 100-file batch with duplicate checks may exceed 2s target
  - Mitigation: Batch duplicate check into single query, optimize folder sort

- **SAS URL Generation**: Synchronous calls to Azure may slow transaction
  - Mitigation: Generate SAS URLs in parallel (Promise.all), consider caching pattern

### Medium Risk

- **Blob Verification Latency**: Azure Storage blob existence check adds 100-200ms per confirm
  - Mitigation: Consider HEAD request instead of GET, implement timeout

### Low Risk

- **Folder Circular Reference**: Malicious client could send complex graphs
  - Mitigation: Topological sort detects cycles, validates hierarchy

---

## 17. Metrics & Monitoring

### Key Metrics

1. **Batch Creation Time**: p50, p95, p99 (target: p95 < 2s for 100 files)
2. **Confirm Latency**: p50, p95, p99 (target: p95 < 500ms)
3. **Transaction Rollback Rate**: % of batches that fail creation (target: < 1%)
4. **Batch Completion Rate**: % of batches reaching 'completed' status (target: > 95%)
5. **Orphaned Batch Rate**: % of batches never confirmed (target: < 5%)

### Logging Requirements

```typescript
// Batch creation
logger.info({
  batchId,
  userId,
  fileCount: manifest.files.length,
  folderCount: manifest.folders?.length ?? 0,
  duration: elapsedMs
}, 'Batch created');

// Transaction rollback
logger.warn({
  batchId,
  userId,
  reason: 'duplicate_detected',
  duplicates: dupes.length
}, 'Batch creation rolled back');

// Confirm success
logger.info({
  batchId,
  fileId,
  userId,
  progress: batch.confirmed / batch.total_files
}, 'File confirmed');
```

---

## Appendix A: Comparison with Legacy Paths

| Feature | V1 Single | V1 Bulk | V1 Folder Session | V2 Unified |
|---------|-----------|---------|-------------------|------------|
| **Entry Points** | 1 route | 2 routes (init/complete) | 6 HTTP steps | 1 route |
| **Atomicity** | No | No (in-memory) | No (6 steps) | Yes (transaction) |
| **Folder Support** | No | No | Yes (polling) | Yes (manifest) |
| **Duplicate Detection** | Inconsistent | No | No | Yes (PRD-02) |
| **State Tracking** | DB | In-memory | Redis | SQL (Prisma) |
| **Recovery** | No | No (restart loses) | No (step loss) | Yes (queryable) |
| **Enqueue** | Direct | Polling | Polling scheduler | Direct |
| **Code Complexity** | 209 lines | 456 lines | 990 lines | Single orchestrator |

---

## Appendix B: Error Codes Reference

| HTTP Status | Error Code | Description | Retry? |
|-------------|------------|-------------|--------|
| 400 | `INVALID_MANIFEST` | Malformed manifest (circular refs, missing parents) | No |
| 400 | `BATCH_TOO_LARGE` | Exceeds 500 file limit | No |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT | No |
| 404 | `BATCH_NOT_FOUND` | Batch ID not found or wrong user | No |
| 404 | `FILE_NOT_FOUND` | File ID not found in batch | No |
| 409 | `DUPLICATE_FILES` | PRD-02 detected duplicates | No |
| 409 | `BLOB_NOT_FOUND` | Blob not in Azure Storage (confirm before upload) | Yes |
| 410 | `BATCH_EXPIRED` | Batch TTL exceeded (24h) | No |
| 413 | `PAYLOAD_TOO_LARGE` | Request body exceeds limit | No |
| 500 | `INTERNAL_ERROR` | Unexpected server error | Yes |

---

**End of PRD-03**
