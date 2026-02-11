# PRD-07: Migration & Deprecation - Unified Upload System

**Status**: Draft
**Created**: 2026-02-10
**Depends On**: PRD-00 through PRD-06
**Phase**: 7 (Final Cleanup)

---

## 1. Problem Statement

After implementing PRDs 00-06, the codebase contains two complete upload systems operating in parallel:

1. **Legacy System**: 4 separate upload paths (single file, session, bulk, folder), polling scheduler, raw SQL repository, dual status columns (`processing_status` + `embedding_status`), Redis sessions, in-memory batch store
2. **V2 System**: Unified batch orchestrator, state machine, Prisma repository, single `pipeline_status` column, SQL-backed batches

**Current State Issues**:
- 2x maintenance surface: every bug fix must be duplicated
- Confusion: developers don't know which system to use
- Technical debt: ~20 deprecated files with `@deprecated(PRD-XX)` markers
- Database bloat: dual status columns storing redundant information
- Feature flag complexity: `USE_V2_UPLOAD_PIPELINE` branching throughout code

**Goal**: This PRD provides a **mechanical, step-by-step process** to:
- Migrate all historical data to the V2 schema
- Remove all deprecated code (backend, frontend, shared)
- Promote V2 to the permanent system (remove `/v2/` prefix)
- Update documentation to reflect the unified architecture

---

## 2. Deprecation Registry (Aggregated Master Checklist)

This section consolidates all `@deprecated` markers from PRDs 00-06 into a single master checklist for removal.

### 2.1 Backend - Routes (4 files, ~1,655 lines)

| File | Lines | Replacement | PRD |
|------|-------|-------------|-----|
| `backend/src/routes/files/upload-session.routes.ts` | 990 | V2 batch endpoints | PRD-03 |
| `backend/src/routes/files/upload.routes.ts` | 209 | V2 batch with 1 file | PRD-03 |
| `backend/src/routes/files/bulk.routes.ts` | 456 | V2 batch orchestrator | PRD-03 |
| `backend/src/routes/files/duplicates.routes.ts` | ~100 | `POST /api/v2/uploads/check-duplicates` | PRD-02 |

### 2.2 Backend - Domain Logic (8 files)

| File | Replacement | PRD |
|------|-------------|-----|
| `backend/src/domains/files/upload-session/UploadSessionManager.ts` | `UploadBatchOrchestrator` | PRD-03 |
| `backend/src/domains/files/upload-session/UploadSessionStore.ts` | `upload_batches` table | PRD-03 |
| `backend/src/domains/files/upload-session/FolderNameResolver.ts` | Logic absorbed into V2 | PRD-03 |
| `backend/src/domains/files/bulk-upload/BulkUploadProcessor.ts` | V2 batch orchestrator | PRD-03 |
| `backend/src/domains/files/bulk-upload/BulkUploadBatchStore.ts` | `upload_batches` table | PRD-03 |
| `backend/src/domains/files/scheduler/FileProcessingScheduler.ts` | Direct enqueue from confirm | PRD-04 |
| `backend/src/services/files/FileDuplicateService.ts` | `DuplicateDetectionServiceV2` | PRD-02 |
| `backend/src/services/files/PartialDataCleaner.ts` | `StuckFileRecoveryJob` + `OrphanCleanupJob` | PRD-05 |

### 2.3 Backend - Repository & Data Access (3 files)

| File | Replacement | PRD |
|------|-------------|-----|
| `backend/src/services/files/FileRepository.ts` | `FileRepositoryV2` (Prisma) | PRD-01 |
| `backend/src/services/files/FileQueryBuilder.ts` | Prisma query patterns | PRD-01 |
| `backend/src/services/files/ReadinessStateComputer.ts` | `pipeline_status` single-field | PRD-01 |

### 2.4 Backend - Workers (6 files)

| File | Replacement | PRD |
|------|-------------|-----|
| `backend/src/infrastructure/queue/workers/FileProcessingWorker.ts` | V2 worker with state machine | PRD-04 |
| `backend/src/infrastructure/queue/workers/FileChunkingWorker.ts` | V2 Flow child worker | PRD-04 |
| `backend/src/infrastructure/queue/workers/EmbeddingGenerationWorker.ts` | V2 Flow child worker | PRD-04 |
| `backend/src/infrastructure/queue/workers/FileBulkUploadWorker.ts` | Eliminated (V2 handles inline) | PRD-04 |
| `backend/src/infrastructure/queue/workers/FileCleanupWorker.ts` | `OrphanCleanupJob` | PRD-05 |
| `backend/src/infrastructure/queue/RateLimiter.ts` | BullMQ native rate limiting | PRD-04 |

### 2.5 Backend - Database Schema (2 columns)

| Column | Table | Replacement | PRD |
|--------|-------|-------------|-----|
| `processing_status` | `files` | `pipeline_status` | PRD-01 |
| `embedding_status` | `files` | `pipeline_status` | PRD-01 |

### 2.6 Frontend - Hooks (2 files)

| File | Replacement | PRD |
|------|-------------|-----|
| `frontend/src/domains/files/hooks/useFileUpload.ts` | `useUploadV2` | PRD-06 |
| `frontend/src/domains/files/hooks/useFolderUpload.ts` | `useUploadV2` | PRD-06 |

### 2.7 Frontend - Stores (5 files)

| File | Replacement | PRD |
|------|-------------|-----|
| `frontend/src/domains/files/stores/uploadSessionStore.ts` | `uploadBatchStoreV2` | PRD-06 |
| `frontend/src/domains/files/stores/multiUploadSessionStore.ts` | `uploadBatchStoreV2` | PRD-06 |
| `frontend/src/domains/files/stores/uploadStore.ts` | `uploadBatchStoreV2` | PRD-06 |
| `frontend/src/domains/files/stores/duplicateStore.ts` | V2 duplicate flow | PRD-06 |

### 2.8 Frontend - API Client (1 file, partial)

| Function | File | Replacement | PRD |
|----------|------|-------------|-----|
| `uploadToBlob()` | `frontend/src/lib/fileApiClient.ts` | Uppy AwsS3 `getUploadParameters` | PRD-00 |

### 2.9 Shared - Types & Constants (2 enums)

| Constant | Replacement | PRD |
|----------|-------------|-----|
| `PROCESSING_STATUS` | `PIPELINE_STATUS` | PRD-01 |
| `EMBEDDING_STATUS` | `PIPELINE_STATUS` | PRD-01 |

### 2.10 Configuration - Feature Flags (1 flag)

| Flag | Files | Action | PRD |
|------|-------|--------|-----|
| `USE_V2_UPLOAD_PIPELINE` | Various | Remove (V2 is now default) | PRD-06 |

### 2.11 Routes - API Versioning

| Old Path | New Path | PRD |
|----------|----------|-----|
| `/api/v2/uploads/*` | `/api/uploads/*` | PRD-07 |

---

## 3. Solution: Three-Stage Migration

This migration follows a **safe, incremental approach** with rollback capability at each stage.

### Stage 1: Data Migration (Reversible)

**Goal**: Backfill `pipeline_status` for all historical files without dropping old columns yet.

**Steps**:

1. **Create migration script**: `backend/scripts/migrate-pipeline-status.ts`
2. **Run backfill SQL** (idempotent, can be run multiple times):

```sql
-- Backfill pipeline_status from legacy dual-column states
UPDATE files
SET pipeline_status = CASE
  -- Success states
  WHEN processing_status = 'completed' AND embedding_status = 'completed' THEN 'ready'

  -- Failure states (prioritize any failure)
  WHEN processing_status = 'failed' OR embedding_status = 'failed' THEN 'failed'

  -- Processing states (ordered by pipeline progression)
  WHEN processing_status = 'processing' THEN 'extracting'
  WHEN processing_status = 'chunking' THEN 'chunking'
  WHEN embedding_status = 'processing' THEN 'embedding'

  -- Queued states
  WHEN processing_status = 'pending_processing' THEN 'queued'

  -- Initial states
  WHEN processing_status = 'pending' THEN 'registered'

  -- Default fallback (should never happen)
  ELSE 'registered'
END
WHERE pipeline_status IS NULL;
```

3. **Validation queries**:

```sql
-- Count files with NULL pipeline_status (should be 0 after migration)
SELECT COUNT(*) as null_count FROM files WHERE pipeline_status IS NULL;

-- Count files by pipeline_status (verify distribution makes sense)
SELECT pipeline_status, COUNT(*) as count
FROM files
GROUP BY pipeline_status
ORDER BY count DESC;

-- Spot check: find mismatches (should be 0 after migration)
SELECT
  id,
  processing_status,
  embedding_status,
  pipeline_status
FROM files
WHERE pipeline_status IS NULL
LIMIT 10;
```

4. **Make `pipeline_status` NOT NULL**:

```sql
-- After validation, enforce NOT NULL constraint
ALTER TABLE files
ALTER COLUMN pipeline_status NVARCHAR(50) NOT NULL;
```

**Success Criteria**:
- Zero files with `pipeline_status IS NULL`
- `pipeline_status` distribution matches expected production patterns
- All files with `processing_status = 'completed' AND embedding_status = 'completed'` have `pipeline_status = 'ready'`

**Rollback**: If issues found, simply re-run the UPDATE query with corrected CASE logic.

---

### Stage 2: Schema Cleanup (Irreversible - Create Backup First)

**Goal**: Drop deprecated columns after data migration is validated.

**Pre-Flight Checks**:

```bash
# Verify zero deprecated column references in code
grep -rn "processing_status\|embedding_status" --include="*.ts" backend/src/ | grep -v "DEPRECATED\|@deprecated"

# Should return 0 results (except in migration scripts and this PRD)
```

**Backup Strategy**:

```sql
-- Create backup table with old columns (one-time)
SELECT * INTO files_backup_pre_migration FROM files;

-- Verify backup
SELECT COUNT(*) FROM files_backup_pre_migration;
```

**Migration SQL**:

```sql
-- Drop deprecated columns (irreversible without backup restore)
ALTER TABLE files DROP COLUMN processing_status;
ALTER TABLE files DROP COLUMN embedding_status;
```

**Post-Migration**:

```bash
# Regenerate Prisma client
cd backend
npx prisma db pull           # Sync schema from DB
npx prisma generate          # Regenerate typed client
npx prisma format            # Format schema.prisma
```

**Schema Validation**:

```typescript
// Verify Prisma types no longer include old columns
import { files } from '@prisma/client';
// TypeScript should show error if trying to access:
// file.processing_status  ❌ Property does not exist
// file.embedding_status   ❌ Property does not exist
// file.pipeline_status    ✅ Exists
```

**Success Criteria**:
- `processing_status` and `embedding_status` columns do not exist in `files` table
- Prisma schema (`schema.prisma`) has no references to old columns
- `npm run verify:types` passes with zero errors
- Backup table `files_backup_pre_migration` exists with historical data

**Rollback**: Restore from backup table if critical issues found immediately:

```sql
-- Emergency rollback (within 24 hours)
DROP TABLE files;
SELECT * INTO files FROM files_backup_pre_migration;
```

---

### Stage 3: Code Removal (Irreversible - Git Commit After Each Subsection)

**Goal**: Remove all deprecated code in a systematic, verifiable order.

**Commit Strategy**: Create one commit per subsection (3.1, 3.2, 3.3, etc.) to enable granular rollback if needed.

---

#### 3.1 Remove Backend Routes (4 files)

**Files to Delete**:
```bash
rm backend/src/routes/files/upload-session.routes.ts
rm backend/src/routes/files/upload.routes.ts
rm backend/src/routes/files/bulk.routes.ts
rm backend/src/routes/files/duplicates.routes.ts
```

**Update Route Registration**: `backend/src/routes/files/index.ts`

```typescript
// REMOVE these lines:
import uploadSessionRouter from './upload-session.routes';
import uploadRouter from './upload.routes';
import bulkRouter from './bulk.routes';
import duplicatesRouter from './duplicates.routes';

router.use('/upload-session', uploadSessionRouter);
router.use('/upload', uploadRouter);
router.use('/bulk', bulkRouter);
router.use('/duplicates', duplicatesRouter);

// KEEP only:
import uploadV2Router from './upload-v2.routes';
router.use('/uploads', uploadV2Router);  // Note: /uploads (no /v2/ prefix)
```

**Verification**:
```bash
# Old endpoints should 404
curl -X POST http://localhost:3002/api/files/upload-session/start  # 404
curl -X POST http://localhost:3002/api/files/bulk/upload           # 404

# New endpoints should work
curl -X POST http://localhost:3002/api/uploads/batch/start         # 200
```

**Commit**: `git commit -m "chore(PRD-07): remove legacy upload routes (4 files)"`

---

#### 3.2 Remove Backend Domain Logic (8 files)

**Files to Delete**:
```bash
rm -rf backend/src/domains/files/upload-session/
rm -rf backend/src/domains/files/bulk-upload/
rm backend/src/domains/files/scheduler/FileProcessingScheduler.ts
rm backend/src/services/files/FileDuplicateService.ts
rm backend/src/services/files/PartialDataCleaner.ts
```

**Verification**:
```bash
# Search for import statements (should be 0 results)
grep -rn "UploadSessionManager\|UploadSessionStore\|BulkUploadProcessor\|FileProcessingScheduler" --include="*.ts" backend/src/

# Type check
npm run -w backend type-check
```

**Commit**: `git commit -m "chore(PRD-07): remove legacy domain logic (8 files)"`

---

#### 3.3 Remove Backend Repository & Data Access (3 files)

**Files to Delete**:
```bash
rm backend/src/services/files/FileRepository.ts
rm backend/src/services/files/FileQueryBuilder.ts
rm backend/src/services/files/ReadinessStateComputer.ts
```

**Update Imports**: Search and replace across backend:

```bash
# Find all imports of old repository
grep -rn "from '@/services/files/FileRepository'" --include="*.ts" backend/src/
# Replace with: from '@/services/files/FileRepositoryV2'
```

**Verification**:
```bash
# No imports of old files
grep -rn "FileRepository'\|FileQueryBuilder\|ReadinessStateComputer" --include="*.ts" backend/src/ | grep "from"

# Type check
npm run -w backend type-check
```

**Commit**: `git commit -m "chore(PRD-07): remove legacy repository layer (3 files)"`

---

#### 3.4 Remove Backend Workers (6 files)

**Files to Delete**:
```bash
rm backend/src/infrastructure/queue/workers/FileProcessingWorker.ts
rm backend/src/infrastructure/queue/workers/FileChunkingWorker.ts
rm backend/src/infrastructure/queue/workers/EmbeddingGenerationWorker.ts
rm backend/src/infrastructure/queue/workers/FileBulkUploadWorker.ts
rm backend/src/infrastructure/queue/workers/FileCleanupWorker.ts
rm backend/src/infrastructure/queue/RateLimiter.ts
```

**Update Worker Registration**: `backend/src/infrastructure/queue/workers/index.ts`

```typescript
// REMOVE these lines:
import { FileProcessingWorker } from './FileProcessingWorker';
import { FileChunkingWorker } from './FileChunkingWorker';
import { EmbeddingGenerationWorker } from './EmbeddingGenerationWorker';
import { FileBulkUploadWorker } from './FileBulkUploadWorker';
import { FileCleanupWorker } from './FileCleanupWorker';

// KEEP only V2 workers:
import { FileProcessingWorkerV2 } from './FileProcessingWorkerV2';
import { FileChunkingWorkerV2 } from './FileChunkingWorkerV2';
import { EmbeddingGenerationWorkerV2 } from './EmbeddingGenerationWorkerV2';
```

**Verification**:
```bash
# No imports of old workers
grep -rn "FileProcessingWorker'\|FileChunkingWorker'\|FileBulkUploadWorker" --include="*.ts" backend/src/ | grep -v "V2"

# BullMQ queues should start without errors
npm run -w backend dev  # Check logs for worker initialization
```

**Commit**: `git commit -m "chore(PRD-07): remove legacy workers (6 files)"`

---

#### 3.5 Remove Frontend Hooks (2 files)

**Files to Delete**:
```bash
rm frontend/src/domains/files/hooks/useFileUpload.ts
rm frontend/src/domains/files/hooks/useFolderUpload.ts
```

**Update Re-exports**: `frontend/src/domains/files/hooks/index.ts`

```typescript
// REMOVE:
export { useFileUpload } from './useFileUpload';
export { useFolderUpload } from './useFolderUpload';

// KEEP:
export { useUploadV2 } from './useUploadV2';
```

**Search and Replace in Components**:

```bash
# Find all usages
grep -rn "useFileUpload\|useFolderUpload" --include="*.tsx" --include="*.ts" frontend/src/

# Replace with useUploadV2 (manual review recommended)
```

**Verification**:
```bash
# No imports of old hooks
grep -rn "from.*useFileUpload\|from.*useFolderUpload" --include="*.ts" --include="*.tsx" frontend/src/

# Type check
npm run verify:types
```

**Commit**: `git commit -m "chore(PRD-07): remove legacy upload hooks (2 files)"`

---

#### 3.6 Remove Frontend Stores (4 files)

**Files to Delete**:
```bash
rm frontend/src/domains/files/stores/uploadSessionStore.ts
rm frontend/src/domains/files/stores/multiUploadSessionStore.ts
rm frontend/src/domains/files/stores/uploadStore.ts
rm frontend/src/domains/files/stores/duplicateStore.ts
```

**Update Re-exports**: `frontend/src/domains/files/stores/index.ts`

```typescript
// REMOVE:
export { useUploadSessionStore } from './uploadSessionStore';
export { useMultiUploadSessionStore } from './multiUploadSessionStore';
export { useUploadStore } from './uploadStore';
export { useDuplicateStore } from './duplicateStore';

// KEEP:
export { useUploadBatchStoreV2 } from './uploadBatchStoreV2';
```

**Search and Replace in Components**:

```bash
# Find all usages
grep -rn "useUploadSessionStore\|useMultiUploadSessionStore\|useUploadStore\|useDuplicateStore" --include="*.tsx" frontend/src/

# Replace with useUploadBatchStoreV2 (manual review recommended)
```

**Verification**:
```bash
# No imports of old stores
grep -rn "uploadSessionStore\|multiUploadSessionStore\|uploadStore\|duplicateStore" --include="*.ts" --include="*.tsx" frontend/src/ | grep "from"

# Type check
npm run verify:types
```

**Commit**: `git commit -m "chore(PRD-07): remove legacy stores (4 files)"`

---

#### 3.7 Remove Shared Types & Constants (2 enums)

**File to Edit**: `packages/shared/src/types/index.ts`

```typescript
// REMOVE:
export const PROCESSING_STATUS = {
  PENDING: 'pending',
  PENDING_PROCESSING: 'pending_processing',
  PROCESSING: 'processing',
  CHUNKING: 'chunking',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const EMBEDDING_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type ProcessingStatus = typeof PROCESSING_STATUS[keyof typeof PROCESSING_STATUS];
export type EmbeddingStatus = typeof EMBEDDING_STATUS[keyof typeof EMBEDDING_STATUS];

// KEEP:
export const PIPELINE_STATUS = {
  REGISTERED: 'registered',
  QUEUED: 'queued',
  EXTRACTING: 'extracting',
  CHUNKING: 'chunking',
  EMBEDDING: 'embedding',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export type PipelineStatus = typeof PIPELINE_STATUS[keyof typeof PIPELINE_STATUS];
```

**Search and Replace**:

```bash
# Find all usages of old constants
grep -rn "PROCESSING_STATUS\|EMBEDDING_STATUS" --include="*.ts" backend/ frontend/ packages/

# Replace with PIPELINE_STATUS (manual review recommended)
```

**Verification**:
```bash
# No imports of old constants
grep -rn "PROCESSING_STATUS\|EMBEDDING_STATUS" --include="*.ts" backend/ frontend/ packages/ | grep -v "@deprecated\|DEPRECATED"

# Build shared package
npm run build:shared

# Type check all packages
npm run verify:types
```

**Commit**: `git commit -m "chore(PRD-07): remove legacy status enums from shared types"`

---

#### 3.8 Remove Feature Flag (1 flag)

**Search for Flag**:

```bash
grep -rn "USE_V2_UPLOAD_PIPELINE" --include="*.ts" --include="*.tsx" backend/ frontend/
```

**Files to Update** (remove conditional branches):

Example pattern:
```typescript
// BEFORE:
if (USE_V2_UPLOAD_PIPELINE) {
  return await uploadV2Service.upload(file);
} else {
  return await legacyUploadService.upload(file);
}

// AFTER:
return await uploadV2Service.upload(file);
```

**Remove Environment Variable**:

```bash
# Remove from .env.example
# Remove from .env
# Remove from deployment configs (Azure Container Apps, etc.)
```

**Verification**:
```bash
# No references to feature flag
grep -rn "USE_V2_UPLOAD_PIPELINE" --include="*.ts" --include="*.tsx" --include="*.env*" .

# Type check
npm run verify:types
```

**Commit**: `git commit -m "chore(PRD-07): remove V2 upload feature flag"`

---

#### 3.9 Rename V2 Routes to Permanent URLs

**Goal**: Remove `/v2/` prefix from API routes since V2 is now the only system.

**Backend Route File Rename**:

```bash
# Rename route file
mv backend/src/routes/files/upload-v2.routes.ts backend/src/routes/files/upload.routes.ts
```

**Update Route Registration**: `backend/src/routes/files/index.ts`

```typescript
// BEFORE:
import uploadV2Router from './upload-v2.routes';
router.use('/v2/uploads', uploadV2Router);

// AFTER:
import uploadRouter from './upload.routes';
router.use('/uploads', uploadRouter);  // No /v2/ prefix
```

**Update Frontend API Client**: `frontend/src/lib/fileApiClient.ts`

```typescript
// BEFORE:
const BASE_URL = '/api/v2/uploads';

// AFTER:
const BASE_URL = '/api/uploads';
```

**Verification**:
```bash
# Old V2 URLs should 404
curl -X POST http://localhost:3002/api/v2/uploads/batch/start  # 404

# New permanent URLs should work
curl -X POST http://localhost:3002/api/uploads/batch/start     # 200
```

**Commit**: `git commit -m "chore(PRD-07): promote V2 routes to permanent URLs"`

---

#### 3.10 Update Documentation

**Files to Update**:

1. **CLAUDE.md**: Update file upload architecture section
2. **README.md**: Update API endpoint documentation
3. **docs/backend/**: Update any backend architecture docs
4. **docs/frontend/**: Update frontend upload flow docs

**Search for References**:

```bash
grep -rn "upload-session\|bulk upload\|processing_status\|embedding_status" --include="*.md" docs/ *.md
```

**Key Documentation Updates**:

**CLAUDE.md** - Section 3.X (File Upload Flow):
```markdown
### 3.X File Upload Flow (Unified V2 System)

1. **Frontend**: Uppy manages file selection, chunking, and progress
2. **Backend**: Single `UploadBatchOrchestrator` coordinates all uploads
3. **State Machine**: `pipeline_status` tracks file through 7 states
4. **Processing Pipeline**: BullMQ Flow with 3 workers (extract → chunk → embed)
5. **Error Recovery**: Automatic retries with exponential backoff

**API Endpoints**:
- `POST /api/uploads/batch/start` - Initialize upload batch
- `POST /api/uploads/batch/confirm` - Commit batch and start processing
- `POST /api/uploads/check-duplicates` - Pre-upload duplicate check
- `GET /api/uploads/batch/:batchId` - Get batch status
```

**Commit**: `git commit -m "docs(PRD-07): update documentation for unified upload system"`

---

### Stage 3 Verification Checklist

After all subsections (3.1-3.10), run comprehensive verification:

```bash
# 1. Zero deprecated markers
grep -rn "@deprecated\|DEPRECATED(PRD" --include="*.ts" backend/ frontend/ packages/
# Expected: 0 results

# 2. Zero old column references
grep -rn "processing_status\|embedding_status" --include="*.ts" backend/ frontend/ packages/ | grep -v "DEPRECATED\|migration"
# Expected: 0 results (except in migration scripts and this PRD)

# 3. Type check passes
npm run verify:types
# Expected: ✓ Passed

# 4. Backend tests pass
npm run -w backend test:unit
# Expected: All tests pass

# 5. Frontend tests pass
npm run -w bc-agent-frontend test
# Expected: All tests pass

# 6. Backend builds successfully
npm run -w backend build
# Expected: Build successful

# 7. Frontend builds successfully
npm run -w bc-agent-frontend build
# Expected: Build successful
```

**Final Commit**: `git commit -m "chore(PRD-07): complete migration to unified upload system"`

---

## 4. Scope

### In Scope

**Data Migration**:
- Backfill `pipeline_status` for all historical files
- Validate migration with SQL queries
- Create backup table for rollback safety

**Schema Changes**:
- Drop `processing_status` column from `files` table
- Drop `embedding_status` column from `files` table
- Make `pipeline_status` NOT NULL
- Regenerate Prisma client

**Code Removal** (29 files total):
- 4 backend route files (~1,655 lines)
- 8 backend domain logic files
- 3 backend repository/data access files
- 6 backend worker files
- 2 frontend hook files
- 4 frontend store files
- 1 partial API client cleanup
- 1 shared types file (2 enums removed)

**Configuration**:
- Remove `USE_V2_UPLOAD_PIPELINE` feature flag
- Update environment variable templates

**API Changes**:
- Rename `/api/v2/uploads/*` to `/api/uploads/*`
- Ensure old endpoints return 404

**Documentation**:
- Update CLAUDE.md
- Update README.md
- Update architecture docs
- Remove references to dual upload systems

### Out of Scope

- New feature development (V2 system is already complete)
- Performance optimization (handled in PRD-04)
- UI/UX changes (handled in PRD-06)
- Additional testing beyond verification (tests exist from PRD-00 to PRD-06)

---

## 5. Success Criteria

### Data Integrity
- [ ] All files have `pipeline_status` NOT NULL
- [ ] Zero files with `pipeline_status IS NULL`
- [ ] Backup table `files_backup_pre_migration` exists with complete data
- [ ] `pipeline_status` distribution matches expected production patterns

### Code Cleanliness
- [ ] `grep -rn "@deprecated\|DEPRECATED(PRD" --include="*.ts"` returns 0 results
- [ ] `grep -rn "processing_status\|embedding_status" --include="*.ts"` returns 0 results (except migration scripts)
- [ ] `grep -rn "USE_V2_UPLOAD_PIPELINE"` returns 0 results
- [ ] All old route files deleted (4 files)
- [ ] All old domain logic files deleted (8 files)
- [ ] All old repository files deleted (3 files)
- [ ] All old worker files deleted (6 files)
- [ ] All old frontend hooks deleted (2 files)
- [ ] All old frontend stores deleted (4 files)

### Build & Type Safety
- [ ] `npm run verify:types` passes with 0 errors
- [ ] `npm run -w backend type-check` passes
- [ ] `npm run -w backend build` succeeds
- [ ] `npm run -w bc-agent-frontend build` succeeds
- [ ] `npm run build:shared` succeeds

### Testing
- [ ] `npm run -w backend test:unit` passes (all tests)
- [ ] `npm run -w bc-agent-frontend test` passes (all tests)
- [ ] No tests reference deprecated code

### API Endpoints
- [ ] `POST /api/uploads/batch/start` returns 200
- [ ] `POST /api/uploads/batch/confirm` returns 200
- [ ] `POST /api/uploads/check-duplicates` returns 200
- [ ] `POST /api/files/upload-session/start` returns 404
- [ ] `POST /api/files/bulk/upload` returns 404
- [ ] `POST /api/v2/uploads/batch/start` returns 404

### Documentation
- [ ] CLAUDE.md reflects unified system only
- [ ] No references to "legacy upload" or "V2 upload" (just "upload")
- [ ] API documentation shows new permanent URLs
- [ ] Architecture diagrams updated (if applicable)

---

## 6. Reusable Code

**None** - This PRD is purely a removal/cleanup phase. No new reusable components are created.

However, the following **migration artifacts** should be retained for future reference:

1. **Migration Script**: `backend/scripts/migrate-pipeline-status.ts`
   - Useful template for future column migrations
   - Documents the state mapping logic

2. **Validation Queries**: SQL queries from Stage 1
   - Reusable pattern for validating data migrations
   - Can be adapted for other schema changes

3. **Deprecation Checklist**: Section 2 of this PRD
   - Template for future deprecation planning
   - Shows how to track deprecated code across PRDs

---

## 7. Dependencies

### Required PRDs (Must be 100% Complete)
- ✅ **PRD-00**: Frontend blob upload with Uppy
- ✅ **PRD-01**: State machine and `pipeline_status` column
- ✅ **PRD-02**: Duplicate detection V2
- ✅ **PRD-03**: Batch orchestrator V2
- ✅ **PRD-04**: Processing pipeline V2
- ✅ **PRD-05**: Error recovery V2
- ✅ **PRD-06**: Frontend V2 wiring

### System Requirements
- **Database Backup**: Full backup before Stage 2 (schema changes)
- **Redis Available**: For session cleanup during migration
- **Azure Storage Available**: For blob cleanup during migration

### Stakeholder Sign-Off
- [ ] Engineering Lead: Confirms all PRD-00 to PRD-06 are stable in production
- [ ] QA: Confirms V2 system passes all acceptance tests
- [ ] Product: Approves removal of legacy system features

---

## 8. Testing Strategy

### Pre-Migration Testing
Run full test suite to establish baseline:
```bash
npm run verify:types
npm run -w backend test:unit
npm run -w bc-agent-frontend test
npm run test:e2e  # If E2E tests exist
```

### Migration Testing (Stage 1)
1. **Data Validation Queries** (see Stage 1, step 3)
2. **Spot Check 100 Random Files**:
```sql
SELECT TOP 100 id, processing_status, embedding_status, pipeline_status
FROM files
ORDER BY NEWID();  -- Random sample
```
3. **Verify Edge Cases**:
```sql
-- Files in failed state
SELECT COUNT(*) FROM files WHERE pipeline_status = 'failed';

-- Files in processing state (should transition)
SELECT COUNT(*) FROM files WHERE pipeline_status IN ('extracting', 'chunking', 'embedding');
```

### Post-Migration Testing (Stage 3)
1. **Smoke Tests**: Upload a single file through entire pipeline
2. **Batch Upload**: Upload 10 files simultaneously
3. **Duplicate Detection**: Upload same file twice
4. **Error Handling**: Trigger a processing failure (invalid file)
5. **API Endpoint Verification**: `curl` all endpoints (see Stage 3.9)

### Regression Testing
Run full test suite after each subsection commit:
```bash
# After each git commit in Stage 3
npm run verify:types && \
npm run -w backend test:unit && \
npm run -w bc-agent-frontend test
```

---

## 9. Rollback Strategy

### Stage 1 Rollback (Data Migration)
**Risk**: Low (old columns still exist)

**Rollback SQL**:
```sql
-- Reset pipeline_status to NULL and re-run migration with corrected logic
UPDATE files SET pipeline_status = NULL;
-- Then re-run corrected backfill query
```

### Stage 2 Rollback (Schema Changes)
**Risk**: High (irreversible without backup)

**Rollback Procedure**:
```sql
-- Restore from backup table (emergency only)
DROP TABLE files;
SELECT * INTO files FROM files_backup_pre_migration;

-- Regenerate Prisma client
npx prisma db pull
npx prisma generate
```

**Timeline**: Must be done within 24 hours of Stage 2 completion.

### Stage 3 Rollback (Code Removal)
**Risk**: Medium (git history available)

**Rollback Procedure**:
```bash
# Revert to commit before Stage 3
git log --oneline  # Find commit hash before "chore(PRD-07)"
git revert <commit-hash>

# Or revert individual subsections
git revert <subsection-commit-hash>
```

**Note**: If V2 system has critical bugs, recommend fixing V2 code rather than restoring legacy system.

---

## 10. Risks & Mitigations

### Risk 1: Data Loss During Migration
**Impact**: High
**Probability**: Low
**Mitigation**:
- Create `files_backup_pre_migration` table before Stage 2
- Run migration SQL in transaction with validation
- Keep backup table for 30 days post-migration

### Risk 2: Breaking Production Features
**Impact**: High
**Probability**: Medium
**Mitigation**:
- Complete PRD-00 to PRD-06 in production first
- Run migration in staging environment first
- Enable V2 feature flag in production for 2+ weeks before PRD-07
- Gradual rollout: migrate 10% of traffic first

### Risk 3: Missed Deprecated Code References
**Impact**: Medium
**Probability**: Medium
**Mitigation**:
- Comprehensive `grep` searches before each commit
- Run `npm run verify:types` after each subsection
- Automated CI checks for `@deprecated` markers

### Risk 4: API Client Breakage (Frontend)
**Impact**: High
**Probability**: Low
**Mitigation**:
- Update frontend API URLs before backend route removal
- Deploy backend route rename separately with both URLs active for 1 week
- Monitor error logs for 404s on old endpoints

### Risk 5: Lost Historical Data Insights
**Impact**: Low
**Probability**: High
**Mitigation**:
- Export analytics queries that depend on `processing_status`/`embedding_status` before migration
- Document state mapping in this PRD (Section 3, Stage 1)
- Keep backup table for historical analysis

---

## 11. Timeline & Milestones

### Week 1: Pre-Migration Preparation
- [ ] **Day 1-2**: Full system backup (DB + Redis + Storage)
- [ ] **Day 3**: Create `migrate-pipeline-status.ts` script
- [ ] **Day 4**: Run migration in staging environment
- [ ] **Day 5**: Validate staging migration (run all tests)

### Week 2: Stage 1 - Data Migration (Production)
- [ ] **Day 1**: Execute Stage 1 SQL in production (off-peak hours)
- [ ] **Day 2**: Validate data migration (run validation queries)
- [ ] **Day 3-5**: Monitor production for issues, rollback if needed

### Week 3: Stage 2 - Schema Cleanup
- [ ] **Day 1**: Create production backup (`files_backup_pre_migration`)
- [ ] **Day 2**: Execute Stage 2 SQL in production (maintenance window)
- [ ] **Day 3**: Regenerate Prisma client, deploy backend
- [ ] **Day 4-5**: Monitor production, verify no column access errors

### Week 4-5: Stage 3 - Code Removal
- [ ] **Week 4**: Execute subsections 3.1-3.5 (backend cleanup)
  - One subsection per day, commit after verification
- [ ] **Week 5**: Execute subsections 3.6-3.10 (frontend + docs)
  - Deploy frontend changes mid-week
  - Update documentation end of week

### Week 6: Final Verification & Cleanup
- [ ] **Day 1-2**: Run full test suite (unit + integration + E2E)
- [ ] **Day 3**: Deploy all changes to production
- [ ] **Day 4-5**: Monitor production logs for errors
- [ ] **End of Week**: Mark PRD-07 as COMPLETE ✅

---

## 12. Verification Commands (Quick Reference)

```bash
# ============================================
# PRE-MIGRATION BASELINE
# ============================================
npm run verify:types
npm run -w backend test:unit
npm run -w bc-agent-frontend test

# ============================================
# STAGE 1: DATA MIGRATION VALIDATION
# ============================================
# Run validation queries (see Section 3, Stage 1, step 3)

# ============================================
# STAGE 2: SCHEMA CLEANUP VALIDATION
# ============================================
npx prisma db pull
npx prisma generate
npm run verify:types

# ============================================
# STAGE 3: CODE REMOVAL VALIDATION
# ============================================

# Zero deprecated markers
grep -rn "@deprecated\|DEPRECATED(PRD" --include="*.ts" backend/ frontend/ packages/

# Zero old column references
grep -rn "processing_status\|embedding_status" --include="*.ts" backend/ frontend/ packages/ | grep -v "DEPRECATED\|migration"

# Zero feature flag references
grep -rn "USE_V2_UPLOAD_PIPELINE" --include="*.ts" --include="*.tsx" --include="*.env*" .

# Zero old route imports
grep -rn "upload-session.routes\|upload.routes\|bulk.routes\|duplicates.routes" --include="*.ts" backend/src/ | grep -v "DEPRECATED"

# Zero old service imports
grep -rn "UploadSessionManager\|FileProcessingScheduler\|FileDuplicateService" --include="*.ts" backend/src/ | grep "from"

# Zero old worker imports
grep -rn "FileProcessingWorker\|FileChunkingWorker\|FileBulkUploadWorker" --include="*.ts" backend/src/ | grep -v "V2"

# Zero old hook imports
grep -rn "useFileUpload\|useFolderUpload" --include="*.ts" --include="*.tsx" frontend/src/ | grep "from"

# Zero old store imports
grep -rn "uploadSessionStore\|multiUploadSessionStore\|uploadStore\|duplicateStore" --include="*.ts" --include="*.tsx" frontend/src/ | grep "from"

# Zero old constant imports
grep -rn "PROCESSING_STATUS\|EMBEDDING_STATUS" --include="*.ts" backend/ frontend/ packages/ | grep -v "@deprecated"

# ============================================
# API ENDPOINT VALIDATION
# ============================================
# Old endpoints should 404
curl -X POST http://localhost:3002/api/files/upload-session/start  # Expect: 404
curl -X POST http://localhost:3002/api/files/bulk/upload           # Expect: 404
curl -X POST http://localhost:3002/api/v2/uploads/batch/start     # Expect: 404

# New endpoints should work
curl -X POST http://localhost:3002/api/uploads/batch/start         # Expect: 200
curl -X POST http://localhost:3002/api/uploads/check-duplicates   # Expect: 200

# ============================================
# BUILD VALIDATION
# ============================================
npm run build:shared
npm run -w backend build
npm run -w bc-agent-frontend build

# ============================================
# TEST VALIDATION
# ============================================
npm run verify:types
npm run -w backend test:unit
npm run -w bc-agent-frontend test
```

---

## 13. Closing Deliverables

Upon completion of PRD-07, the following artifacts must be delivered:

### Code Artifacts
- [ ] Migration script: `backend/scripts/migrate-pipeline-status.ts`
- [ ] Updated `schema.prisma` with only `pipeline_status` column
- [ ] Regenerated Prisma client
- [ ] All deprecated files removed (29 files)
- [ ] All deprecated code references removed

### Database Artifacts
- [ ] Backup table: `files_backup_pre_migration` (retained for 30 days)
- [ ] `pipeline_status` column NOT NULL with validated data
- [ ] `processing_status` column dropped
- [ ] `embedding_status` column dropped

### Documentation
- [ ] Updated CLAUDE.md (Section 3: File Upload Flow)
- [ ] Updated README.md (API endpoints)
- [ ] Updated backend architecture docs
- [ ] Updated frontend architecture docs
- [ ] This PRD marked as COMPLETE ✅

### Verification Report
Create `docs/plans/upload-issue/PRD-07-VERIFICATION-REPORT.md`:

```markdown
# PRD-07 Verification Report

**Date**: YYYY-MM-DD
**Status**: COMPLETE ✅

## Data Migration
- Files migrated: X,XXX
- Files with pipeline_status: X,XXX (100%)
- Backup table size: XX GB

## Code Removal
- Files deleted: 29
- Lines removed: ~X,XXX
- Deprecated markers remaining: 0

## Build Status
- Backend type-check: ✅ PASS
- Frontend type-check: ✅ PASS
- Backend tests: ✅ XX/XX PASS
- Frontend tests: ✅ XX/XX PASS

## API Status
- Old endpoints (404): ✅ Verified
- New endpoints (200): ✅ Verified

## Production Status
- Deployed: YYYY-MM-DD HH:MM UTC
- Monitoring period: 5 days
- Critical issues: 0
- Performance impact: None

## Sign-Off
- Engineering Lead: [Name] - [Date]
- QA Lead: [Name] - [Date]
- Product Owner: [Name] - [Date]
```

### Git Commits
Expected commit sequence:
1. `feat(PRD-07): add pipeline_status migration script`
2. `chore(PRD-07): backfill pipeline_status for all files`
3. `chore(PRD-07): drop processing_status and embedding_status columns`
4. `chore(PRD-07): remove legacy upload routes (4 files)`
5. `chore(PRD-07): remove legacy domain logic (8 files)`
6. `chore(PRD-07): remove legacy repository layer (3 files)`
7. `chore(PRD-07): remove legacy workers (6 files)`
8. `chore(PRD-07): remove legacy upload hooks (2 files)`
9. `chore(PRD-07): remove legacy stores (4 files)`
10. `chore(PRD-07): remove legacy status enums from shared types`
11. `chore(PRD-07): remove V2 upload feature flag`
12. `chore(PRD-07): promote V2 routes to permanent URLs`
13. `docs(PRD-07): update documentation for unified upload system`
14. `chore(PRD-07): complete migration to unified upload system`

---

## 14. Post-Migration Monitoring

### Key Metrics to Monitor (First 7 Days)

**Error Rates**:
```bash
# Monitor error logs for file upload failures
grep "pipeline_status\|processing_status\|embedding_status" logs/backend.log
# Expected: 0 occurrences of old columns

# Monitor API 404s
grep "404.*uploads\|404.*files" logs/backend.log
# Expected: Only old endpoint 404s (expected), no new endpoint 404s
```

**Performance**:
- Upload latency (should be unchanged or better)
- Processing time (should be unchanged)
- Database query performance (should be better with fewer columns)

**User Impact**:
- Support tickets related to uploads (should be 0)
- Failed upload rate (should be unchanged)
- Duplicate detection accuracy (should be unchanged)

### Rollback Trigger Conditions

Execute rollback if any of the following occur in first 48 hours:

1. **Critical Data Loss**: Users report missing files (>5 reports)
2. **High Error Rate**: Upload failures >10% of baseline
3. **Database Corruption**: `pipeline_status` NULL count >0
4. **Production Outage**: Upload feature completely unavailable >1 hour

---

## 15. Success Declaration

PRD-07 is considered **COMPLETE** when all of the following are true:

- ✅ All 29 deprecated files removed
- ✅ All validation commands pass (Section 12)
- ✅ Production deployment successful with 0 rollbacks
- ✅ 7-day monitoring period complete with no critical issues
- ✅ All deliverables submitted (Section 13)
- ✅ Verification report approved by Engineering Lead, QA, and Product Owner

**Final Sign-Off**:
```
PRD-07: Migration & Deprecation - Unified Upload System
Status: COMPLETE ✅
Date: YYYY-MM-DD
Approved By: [Names]
```

---

## Appendix A: State Mapping Reference

For historical analysis, this table documents how old dual-column states map to new single-column state:

| `processing_status` | `embedding_status` | `pipeline_status` | Notes |
|---------------------|--------------------|--------------------|-------|
| `completed` | `completed` | `ready` | Fully processed, searchable |
| `failed` | `*` | `failed` | Any processing failure |
| `*` | `failed` | `failed` | Any embedding failure |
| `processing` | `pending` | `extracting` | Text extraction in progress |
| `chunking` | `pending` | `chunking` | Chunking in progress |
| `completed` | `processing` | `embedding` | Embedding in progress |
| `pending_processing` | `pending` | `queued` | Waiting for processing worker |
| `pending` | `pending` | `registered` | Just uploaded, not queued yet |

---

## Appendix B: File Deletion Checklist

Print this checklist and check off files as deleted:

### Backend Routes
- [ ] `backend/src/routes/files/upload-session.routes.ts`
- [ ] `backend/src/routes/files/upload.routes.ts`
- [ ] `backend/src/routes/files/bulk.routes.ts`
- [ ] `backend/src/routes/files/duplicates.routes.ts`

### Backend Domain Logic
- [ ] `backend/src/domains/files/upload-session/UploadSessionManager.ts`
- [ ] `backend/src/domains/files/upload-session/UploadSessionStore.ts`
- [ ] `backend/src/domains/files/upload-session/FolderNameResolver.ts`
- [ ] `backend/src/domains/files/bulk-upload/BulkUploadProcessor.ts`
- [ ] `backend/src/domains/files/bulk-upload/BulkUploadBatchStore.ts`
- [ ] `backend/src/domains/files/scheduler/FileProcessingScheduler.ts`
- [ ] `backend/src/services/files/FileDuplicateService.ts`
- [ ] `backend/src/services/files/PartialDataCleaner.ts`

### Backend Repository
- [ ] `backend/src/services/files/FileRepository.ts`
- [ ] `backend/src/services/files/FileQueryBuilder.ts`
- [ ] `backend/src/services/files/ReadinessStateComputer.ts`

### Backend Workers
- [ ] `backend/src/infrastructure/queue/workers/FileProcessingWorker.ts`
- [ ] `backend/src/infrastructure/queue/workers/FileChunkingWorker.ts`
- [ ] `backend/src/infrastructure/queue/workers/EmbeddingGenerationWorker.ts`
- [ ] `backend/src/infrastructure/queue/workers/FileBulkUploadWorker.ts`
- [ ] `backend/src/infrastructure/queue/workers/FileCleanupWorker.ts`
- [ ] `backend/src/infrastructure/queue/RateLimiter.ts`

### Frontend Hooks
- [ ] `frontend/src/domains/files/hooks/useFileUpload.ts`
- [ ] `frontend/src/domains/files/hooks/useFolderUpload.ts`

### Frontend Stores
- [ ] `frontend/src/domains/files/stores/uploadSessionStore.ts`
- [ ] `frontend/src/domains/files/stores/multiUploadSessionStore.ts`
- [ ] `frontend/src/domains/files/stores/uploadStore.ts`
- [ ] `frontend/src/domains/files/stores/duplicateStore.ts`

**Total Files**: 29

---

**End of PRD-07**
