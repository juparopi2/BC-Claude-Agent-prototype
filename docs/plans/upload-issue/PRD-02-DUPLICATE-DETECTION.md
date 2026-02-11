# PRD-02: Unified Duplicate Detection Service

**Status**: Draft
**Created**: 2026-02-10
**Author**: System Architect
**Epic**: Upload Pipeline Rewrite
**Dependencies**: PRD-01 (Pipeline Status Column)

---

## 1. Problem Statement

### Current State Issues

The file upload system has fragmented and incomplete duplicate detection across four upload paths:

1. **Single/Multi-file upload**: Uses `FileDuplicateService.checkByName()` for name-based checks only
2. **Bulk upload (>20 files)**: NO pre-upload duplicate check whatsoever
3. **Folder upload**: Has folder-name deduplication via `FolderNameResolver` but no file-level duplicate detection
4. **Content hash duplicates**: Never detected pre-upload (same file content with different names)
5. **In-flight duplicates**: No check against files currently in the processing queue or active upload batches

### Impact

- Users can upload the same file multiple times with different names
- No detection of files already being processed in the pipeline
- No detection of files in pending upload batches
- Wasted storage, processing resources, and embedding generation costs
- Poor user experience (no "file already exists" warning until after upload)
- Inconsistent behavior across different upload paths

### Business Impact

- **Storage costs**: Duplicate files consume Azure Blob Storage unnecessarily
- **Processing costs**: Duplicate embeddings generated via Azure OpenAI (expensive)
- **User confusion**: Different behavior depending on upload method used
- **Data quality**: Multiple identical copies of the same document pollute search results

---

## 2. Deprecation Registry (Before Implementation)

The following components will be deprecated and replaced:

| Component | Location | Reason | Replacement |
|-----------|----------|--------|-------------|
| `FileDuplicateService.checkByName()` | `backend/src/services/files/FileDuplicateService.ts` | Single-file, name-only check | `DuplicateDetectionServiceV2.checkDuplicates()` |
| `FileDuplicateService.findByContentHash()` | `backend/src/services/files/FileDuplicateService.ts` | Single-file, content-only check | `DuplicateDetectionServiceV2.checkDuplicates()` |
| `POST /api/files/check-duplicates` | `backend/src/routes/files/duplicates.routes.ts` | Legacy single-file endpoint | `POST /api/v2/uploads/check-duplicates` |
| `duplicates.routes.ts` | `backend/src/routes/files/` | Entire legacy route file | Mark `@deprecated(PRD-02)`, migrate to v2 |

**Migration Timeline**:
- Add `@deprecated` JSDoc tags with PRD-02 reference
- Keep legacy endpoints active for 2 release cycles
- Log warnings when legacy endpoints are used
- Remove after frontend fully migrated to v2 endpoints

---

## 3. Solution Pattern

### Three-Scope Detection Architecture

A single `DuplicateDetectionServiceV2` performs batch-optimized duplicate detection across three scopes:

#### Scope 1: Existing Files in Storage
Checks against files already persisted in the database:

- **By name within same folder**: `WHERE name = @name AND folder_id = @folderId AND deletion_status IS NULL`
- **By content hash across all folders**: `WHERE content_hash = @hash AND deletion_status IS NULL`

#### Scope 2: Active Processing Pipeline
Checks against files currently being processed:

- Files with `pipeline_status` in `['queued', 'extracting', 'chunking', 'embedding']`
- Prevents duplicate processing jobs for the same file

#### Scope 3: Active Upload Batches
Checks against files in pending upload sessions:

- Files with `pipeline_status` in `['registered', 'uploaded']`
- Part of upload batches that haven't been cancelled
- Prevents duplicate file registration in concurrent upload sessions

### Detection Algorithm

```typescript
interface DuplicateCheckInput {
  fileName: string;
  fileSize?: number;
  contentHash?: string;  // Optional: for content-based deduplication
  folderId?: string;      // Optional: for folder-scoped name checks
}

interface DuplicateCheckResult {
  fileName: string;
  action: 'proceed' | 'duplicate_name' | 'duplicate_content' | 'in_pipeline' | 'in_upload';
  scope?: 'storage' | 'pipeline' | 'upload';
  existingFileId?: string;
  existingFileName?: string;
  existingFolderId?: string;
  reason?: string;
}

interface DuplicateCheckResponse {
  results: DuplicateCheckResult[];
  summary: {
    total: number;
    canProceed: number;
    duplicates: number;
    inPipeline: number;
    inUpload: number;
  };
}
```

**Algorithm Flow**:

```
1. Batch Input Validation
   ├─ Validate fileName, fileSize, optional contentHash
   ├─ Group by folderId for folder-scoped checks
   └─ Extract unique contentHashes for hash-based checks

2. Execute Three-Scope Queries (Parallel)
   ├─ Query 1: Existing Files (Storage Scope)
   │   ├─ Name match: WHERE name IN (@names) AND folder_id = @folderId AND deletion_status IS NULL
   │   └─ Hash match: WHERE content_hash IN (@hashes) AND deletion_status IS NULL
   │
   ├─ Query 2: Active Pipeline (Processing Scope)
   │   └─ WHERE name IN (@names) AND pipeline_status IN ('queued', 'extracting', 'chunking', 'embedding')
   │
   └─ Query 3: Active Uploads (Upload Scope)
       └─ WHERE name IN (@names) AND pipeline_status IN ('registered', 'uploaded') AND batch_status != 'cancelled'

3. Result Aggregation
   ├─ Merge results from three scopes
   ├─ Priority: storage > pipeline > upload (first match wins)
   └─ Generate per-file verdict with action + reason

4. Return Batch Response
   └─ Array of per-file results + summary statistics
```

### Batch Query Optimization

**Critical Requirement**: No N+1 queries. For 500 files, execute 2-3 queries total.

**SQL Query Pattern (Prisma Raw)**:

```sql
-- Query 1: Existing Files (Name + Content Hash)
SELECT
  f.id,
  f.name,
  f.folder_id,
  f.content_hash,
  'storage' as scope,
  CASE
    WHEN f.content_hash IN (@hashes) THEN 'duplicate_content'
    WHEN f.name IN (@names) THEN 'duplicate_name'
  END as match_type
FROM files f
WHERE
  f.deletion_status IS NULL
  AND (
    (f.name IN (@names) AND f.folder_id = @folderId)
    OR f.content_hash IN (@hashes)
  );

-- Query 2: Active Pipeline
SELECT
  f.id,
  f.name,
  f.pipeline_status,
  'pipeline' as scope
FROM files f
WHERE
  f.name IN (@names)
  AND f.folder_id = @folderId
  AND f.pipeline_status IN ('queued', 'extracting', 'chunking', 'embedding');

-- Query 3: Active Uploads
SELECT
  f.id,
  f.name,
  f.pipeline_status,
  ub.status as batch_status,
  'upload' as scope
FROM files f
INNER JOIN upload_batches ub ON f.upload_batch_id = ub.id
WHERE
  f.name IN (@names)
  AND f.folder_id = @folderId
  AND f.pipeline_status IN ('registered', 'uploaded')
  AND ub.status != 'cancelled';
```

**Performance Target**: 500 files checked in <500ms (avg ~1ms per file)

---

## 4. Scope

### In Scope

1. **Core Service**: `DuplicateDetectionServiceV2` with three-scope batch detection
2. **API Endpoint**: `POST /api/v2/uploads/check-duplicates`
3. **Shared Types**: Export from `@bc-agent/shared`
   - `DuplicateCheckInput`
   - `DuplicateCheckResult`
   - `DuplicateCheckResponse`
   - `DuplicateScope` enum
4. **Unit Tests**: Each scope independently + combined batch scenarios
5. **Integration Tests**: Prisma batch query performance validation
6. **Documentation**: API contract, error codes, usage examples

### Out of Scope (Future Work)

1. **Auto-resolution**: Automatic rename/skip/replace (handled by frontend)
2. **Fuzzy matching**: "Similar" filename detection (e.g., "Report.pdf" vs "Report (1).pdf")
3. **Image perceptual hashing**: Detecting visually identical images with different encoding
4. **Cross-workspace deduplication**: Currently limited to same workspace/user
5. **Duplicate cleanup utilities**: Tools to find and remove existing duplicates

---

## 5. Success Criteria

### Functional Requirements

- ✅ Detects name duplicates within the same folder
- ✅ Detects content hash duplicates across all folders
- ✅ Detects files currently in the processing pipeline
- ✅ Detects files in active upload batches
- ✅ Returns per-file actionable verdict with reference to existing file
- ✅ Handles batch requests of 500+ files efficiently

### Performance Requirements

- ✅ 500 files checked in <500ms (batch query optimization)
- ✅ No N+1 query patterns (max 2-3 queries regardless of input size)
- ✅ <100ms latency for small batches (<10 files)

### Integration Requirements

- ✅ Testable via curl with mock data
- ✅ Frontend can use verdicts to show resolution dialog (skip, rename, replace)
- ✅ Works with all four upload paths (single, multi, bulk, folder)
- ✅ Graceful degradation if `contentHash` not provided (name-only check)

### Code Quality Requirements

- ✅ Full unit test coverage (>90%)
- ✅ Integration tests with Prisma for batch queries
- ✅ Strict TypeScript types (no `any`)
- ✅ Structured logging with `createChildLogger({ service: 'DuplicateDetectionV2' })`
- ✅ Error handling for database failures

---

## 6. Technical Design

### 6.1 Service Interface

**File**: `backend/src/services/files/DuplicateDetectionServiceV2.ts`

```typescript
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateCheckResponse
} from '@bc-agent/shared';

export class DuplicateDetectionServiceV2 {
  private logger = createChildLogger({ service: 'DuplicateDetectionV2' });

  /**
   * Batch duplicate detection across three scopes:
   * 1. Existing files in storage (by name + content hash)
   * 2. Active processing pipeline (files being processed)
   * 3. Active upload batches (pending uploads)
   *
   * @param inputs - Array of file metadata to check
   * @param userId - User ID for tenant isolation
   * @returns Per-file duplicate detection results
   */
  async checkDuplicates(
    inputs: DuplicateCheckInput[],
    userId: string
  ): Promise<DuplicateCheckResponse> {
    this.logger.info({ count: inputs.length, userId }, 'Starting batch duplicate check');

    const startTime = Date.now();

    // Step 1: Input validation and grouping
    const validated = this.validateAndGroupInputs(inputs);

    // Step 2: Execute three-scope queries in parallel
    const [storageMatches, pipelineMatches, uploadMatches] = await Promise.all([
      this.checkStorageScope(validated, userId),
      this.checkPipelineScope(validated, userId),
      this.checkUploadScope(validated, userId)
    ]);

    // Step 3: Aggregate results and generate verdicts
    const results = this.aggregateResults(inputs, storageMatches, pipelineMatches, uploadMatches);

    // Step 4: Generate summary statistics
    const summary = this.generateSummary(results);

    const duration = Date.now() - startTime;
    this.logger.info({ duration, summary }, 'Batch duplicate check completed');

    return { results, summary };
  }

  /**
   * Check Scope 1: Existing files in storage
   * - Name match within same folder
   * - Content hash match across all folders
   */
  private async checkStorageScope(
    validated: ValidatedInputs,
    userId: string
  ): Promise<StorageMatch[]> {
    const { fileNames, contentHashes, folderIds } = validated;

    // Build dynamic query based on available data
    const nameConditions = folderIds.map((folderId, idx) =>
      `(f.name IN (${this.buildInClause(fileNames)}) AND f.folder_id = '${folderId}')`
    ).join(' OR ');

    const hashCondition = contentHashes.length > 0
      ? `OR f.content_hash IN (${this.buildInClause(contentHashes)})`
      : '';

    const query = `
      SELECT
        f.id,
        f.name,
        f.folder_id,
        f.content_hash,
        f.size,
        'storage' as scope,
        CASE
          WHEN f.content_hash IN (${this.buildInClause(contentHashes)}) THEN 'duplicate_content'
          ELSE 'duplicate_name'
        END as match_type
      FROM files f
      WHERE
        f.user_id = @userId
        AND f.deletion_status IS NULL
        AND (${nameConditions} ${hashCondition})
    `;

    return prisma.$queryRaw<StorageMatch[]>`${query}`;
  }

  /**
   * Check Scope 2: Active processing pipeline
   * - Files with pipeline_status in ['queued', 'extracting', 'chunking', 'embedding']
   */
  private async checkPipelineScope(
    validated: ValidatedInputs,
    userId: string
  ): Promise<PipelineMatch[]> {
    const { fileNames, folderIds } = validated;

    return prisma.files.findMany({
      where: {
        user_id: userId,
        name: { in: fileNames },
        folder_id: { in: folderIds },
        pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] }
      },
      select: {
        id: true,
        name: true,
        folder_id: true,
        pipeline_status: true
      }
    });
  }

  /**
   * Check Scope 3: Active upload batches
   * - Files with pipeline_status in ['registered', 'uploaded']
   * - Part of batches that haven't been cancelled
   */
  private async checkUploadScope(
    validated: ValidatedInputs,
    userId: string
  ): Promise<UploadMatch[]> {
    return prisma.files.findMany({
      where: {
        user_id: userId,
        name: { in: validated.fileNames },
        folder_id: { in: validated.folderIds },
        pipeline_status: { in: ['registered', 'uploaded'] },
        upload_batch: {
          status: { not: 'cancelled' }
        }
      },
      select: {
        id: true,
        name: true,
        folder_id: true,
        pipeline_status: true,
        upload_batch: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });
  }

  /**
   * Aggregate results from three scopes and generate per-file verdicts
   * Priority: storage > pipeline > upload (first match wins)
   */
  private aggregateResults(
    inputs: DuplicateCheckInput[],
    storageMatches: StorageMatch[],
    pipelineMatches: PipelineMatch[],
    uploadMatches: UploadMatch[]
  ): DuplicateCheckResult[] {
    return inputs.map(input => {
      // Check storage scope first (highest priority)
      const storageMatch = storageMatches.find(m =>
        (m.name === input.fileName && m.folder_id === input.folderId) ||
        (m.content_hash === input.contentHash)
      );

      if (storageMatch) {
        return {
          fileName: input.fileName,
          action: storageMatch.match_type === 'duplicate_content'
            ? 'duplicate_content'
            : 'duplicate_name',
          scope: 'storage',
          existingFileId: storageMatch.id,
          existingFileName: storageMatch.name,
          existingFolderId: storageMatch.folder_id,
          reason: storageMatch.match_type === 'duplicate_content'
            ? 'File with identical content already exists'
            : 'File with same name already exists in this folder'
        };
      }

      // Check pipeline scope
      const pipelineMatch = pipelineMatches.find(m =>
        m.name === input.fileName && m.folder_id === input.folderId
      );

      if (pipelineMatch) {
        return {
          fileName: input.fileName,
          action: 'in_pipeline',
          scope: 'pipeline',
          existingFileId: pipelineMatch.id,
          existingFileName: pipelineMatch.name,
          reason: `File is currently being processed (status: ${pipelineMatch.pipeline_status})`
        };
      }

      // Check upload scope
      const uploadMatch = uploadMatches.find(m =>
        m.name === input.fileName && m.folder_id === input.folderId
      );

      if (uploadMatch) {
        return {
          fileName: input.fileName,
          action: 'in_upload',
          scope: 'upload',
          existingFileId: uploadMatch.id,
          existingFileName: uploadMatch.name,
          reason: 'File is in an active upload batch'
        };
      }

      // No duplicates found
      return {
        fileName: input.fileName,
        action: 'proceed',
        reason: 'No duplicates detected'
      };
    });
  }

  /**
   * Generate summary statistics for the batch check
   */
  private generateSummary(results: DuplicateCheckResult[]) {
    return {
      total: results.length,
      canProceed: results.filter(r => r.action === 'proceed').length,
      duplicates: results.filter(r =>
        r.action === 'duplicate_name' || r.action === 'duplicate_content'
      ).length,
      inPipeline: results.filter(r => r.action === 'in_pipeline').length,
      inUpload: results.filter(r => r.action === 'in_upload').length
    };
  }

  private validateAndGroupInputs(inputs: DuplicateCheckInput[]): ValidatedInputs {
    // Extract unique values for batch queries
    const fileNames = [...new Set(inputs.map(i => i.fileName))];
    const contentHashes = [...new Set(inputs.map(i => i.contentHash).filter(Boolean))];
    const folderIds = [...new Set(inputs.map(i => i.folderId).filter(Boolean))];

    return { fileNames, contentHashes, folderIds };
  }

  private buildInClause(values: string[]): string {
    return values.map(v => `'${v}'`).join(', ');
  }
}

// Singleton instance
let instance: DuplicateDetectionServiceV2 | null = null;

export function getDuplicateDetectionServiceV2(): DuplicateDetectionServiceV2 {
  if (!instance) {
    instance = new DuplicateDetectionServiceV2();
  }
  return instance;
}
```

### 6.2 API Endpoint

**File**: `backend/src/routes/files/duplicate-detection-v2.routes.ts`

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { createChildLogger } from '@/shared/utils/logger';
import { getDuplicateDetectionServiceV2 } from '@/services/files/DuplicateDetectionServiceV2';
import type { DuplicateCheckInput } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'DuplicateDetectionV2Routes' });
const router = Router();

const DuplicateCheckRequestSchema = z.object({
  files: z.array(
    z.object({
      fileName: z.string().min(1).max(255),
      fileSize: z.number().int().positive().optional(),
      contentHash: z.string().optional(),
      folderId: z.string().uuid().optional()
    })
  ).min(1).max(1000) // Max 1000 files per batch
});

/**
 * POST /api/v2/uploads/check-duplicates
 *
 * Batch duplicate detection endpoint.
 * Checks files against storage, pipeline, and upload scopes.
 *
 * Request Body:
 * {
 *   "files": [
 *     {
 *       "fileName": "document.pdf",
 *       "fileSize": 1024000,
 *       "contentHash": "sha256:abc123...",
 *       "folderId": "A1B2C3D4-..."
 *     }
 *   ]
 * }
 *
 * Response:
 * {
 *   "results": [
 *     {
 *       "fileName": "document.pdf",
 *       "action": "duplicate_name",
 *       "scope": "storage",
 *       "existingFileId": "...",
 *       "existingFileName": "document.pdf",
 *       "reason": "File with same name already exists in this folder"
 *     }
 *   ],
 *   "summary": {
 *     "total": 1,
 *     "canProceed": 0,
 *     "duplicates": 1,
 *     "inPipeline": 0,
 *     "inUpload": 0
 *   }
 * }
 */
router.post('/check-duplicates', async (req, res, next) => {
  try {
    // Validate request body
    const parsed = DuplicateCheckRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.errors
      });
    }

    const { files } = parsed.data;
    const userId = req.user!.id; // Authenticated user

    logger.info({ userId, fileCount: files.length }, 'Duplicate check request received');

    // Execute batch duplicate detection
    const service = getDuplicateDetectionServiceV2();
    const response = await service.checkDuplicates(files, userId);

    logger.info({
      userId,
      summary: response.summary
    }, 'Duplicate check completed');

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) }
    }, 'Duplicate check failed');
    next(error);
  }
});

export default router;
```

### 6.3 Shared Types

**File**: `packages/shared/src/types/duplicate-detection.types.ts`

```typescript
/**
 * Input for duplicate detection check
 */
export interface DuplicateCheckInput {
  /** File name to check */
  fileName: string;

  /** Optional file size for additional validation */
  fileSize?: number;

  /** Optional content hash (SHA-256) for content-based deduplication */
  contentHash?: string;

  /** Optional folder ID for folder-scoped name checks */
  folderId?: string;
}

/**
 * Duplicate detection scope
 */
export type DuplicateScope = 'storage' | 'pipeline' | 'upload';

/**
 * Action to take based on duplicate detection result
 */
export type DuplicateAction =
  | 'proceed'              // No duplicates, safe to proceed
  | 'duplicate_name'       // File with same name exists
  | 'duplicate_content'    // File with same content exists
  | 'in_pipeline'          // File is being processed
  | 'in_upload';           // File is in an active upload batch

/**
 * Result of duplicate detection for a single file
 */
export interface DuplicateCheckResult {
  /** File name that was checked */
  fileName: string;

  /** Action to take based on detection result */
  action: DuplicateAction;

  /** Scope where duplicate was detected (if any) */
  scope?: DuplicateScope;

  /** ID of existing file (if duplicate found) */
  existingFileId?: string;

  /** Name of existing file (if duplicate found) */
  existingFileName?: string;

  /** Folder ID of existing file (if duplicate found) */
  existingFolderId?: string;

  /** Human-readable reason for the action */
  reason?: string;
}

/**
 * Summary statistics for batch duplicate check
 */
export interface DuplicateCheckSummary {
  /** Total files checked */
  total: number;

  /** Files that can proceed (no duplicates) */
  canProceed: number;

  /** Files that are duplicates (name or content) */
  duplicates: number;

  /** Files currently in processing pipeline */
  inPipeline: number;

  /** Files in active upload batches */
  inUpload: number;
}

/**
 * Complete response from duplicate detection check
 */
export interface DuplicateCheckResponse {
  /** Per-file detection results */
  results: DuplicateCheckResult[];

  /** Summary statistics */
  summary: DuplicateCheckSummary;
}
```

**Export from shared package index**:

```typescript
// packages/shared/src/types/index.ts
export type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateCheckResponse,
  DuplicateCheckSummary,
  DuplicateScope,
  DuplicateAction
} from './duplicate-detection.types';
```

---

## 7. Reusable Code

### From `FileDuplicateService`

The following logic can be absorbed into `DuplicateDetectionServiceV2`:

**Name-based check**:
```typescript
// From FileDuplicateService.checkByName()
const existing = await prisma.files.findFirst({
  where: {
    user_id: userId,
    name: fileName,
    folder_id: folderId,
    deletion_status: null
  }
});
```

**Content hash check**:
```typescript
// From FileDuplicateService.findByContentHash()
const existing = await prisma.files.findFirst({
  where: {
    user_id: userId,
    content_hash: contentHash,
    deletion_status: null
  }
});
```

### From `FolderNameResolver`

The folder-name deduplication pattern can be applied:

```typescript
// Generate unique folder name if duplicate
const baseName = extractBaseName(folderName);
let suffix = 1;
let uniqueName = folderName;

while (await isDuplicate(uniqueName, parentFolderId)) {
  uniqueName = `${baseName} (${suffix})`;
  suffix++;
}
```

This pattern can be reused for auto-resolution in future PRDs.

---

## 8. Dependencies

### Required PRDs

- **PRD-01: Pipeline Status Column** (MUST be completed first)
  - Adds `pipeline_status` enum column to `files` table
  - Enables detection of files in processing queue and upload batches

### External Dependencies

- **Prisma**: For batch queries and database access
- **Zod**: For request validation
- **@bc-agent/shared**: For shared type definitions

### Database Requirements

- `pipeline_status` column must exist in `files` table
- Indexes required for query performance:
  - `(user_id, name, folder_id, deletion_status)`
  - `(user_id, content_hash, deletion_status)`
  - `(user_id, pipeline_status)`

---

## 9. Testing Strategy

### 9.1 Unit Tests

**File**: `backend/src/services/files/__tests__/DuplicateDetectionServiceV2.test.ts`

```typescript
describe('DuplicateDetectionServiceV2', () => {
  describe('checkStorageScope', () => {
    it('should detect name duplicate in same folder', async () => {
      // Arrange: Insert existing file
      // Act: Check duplicate
      // Assert: Returns duplicate_name
    });

    it('should detect content hash duplicate across folders', async () => {
      // Arrange: Insert file with known hash in different folder
      // Act: Check duplicate with same hash
      // Assert: Returns duplicate_content
    });

    it('should not flag files in different folders with same name', async () => {
      // Arrange: Insert file in folder A
      // Act: Check file in folder B with same name
      // Assert: Returns proceed
    });
  });

  describe('checkPipelineScope', () => {
    it('should detect files with pipeline_status=queued', async () => {
      // Arrange: Insert file with pipeline_status='queued'
      // Act: Check duplicate
      // Assert: Returns in_pipeline
    });

    it('should not flag files with pipeline_status=completed', async () => {
      // Arrange: Insert file with pipeline_status='completed'
      // Act: Check duplicate
      // Assert: Returns proceed (checked by storage scope instead)
    });
  });

  describe('checkUploadScope', () => {
    it('should detect files in active upload batches', async () => {
      // Arrange: Insert file with upload_batch_id and status='registered'
      // Act: Check duplicate
      // Assert: Returns in_upload
    });

    it('should not flag files in cancelled batches', async () => {
      // Arrange: Insert file in cancelled batch
      // Act: Check duplicate
      // Assert: Returns proceed
    });
  });

  describe('batch optimization', () => {
    it('should check 500 files in <500ms', async () => {
      // Arrange: Generate 500 mock files
      // Act: Check duplicates
      // Assert: Duration < 500ms
    });

    it('should execute max 3 queries for 500 files', async () => {
      // Arrange: Spy on Prisma query execution
      // Act: Check 500 files
      // Assert: Query count <= 3
    });
  });
});
```

### 9.2 Integration Tests

**File**: `backend/src/services/files/__tests__/DuplicateDetectionServiceV2.integration.test.ts`

```typescript
describe('DuplicateDetectionServiceV2 Integration', () => {
  beforeEach(async () => {
    // Setup test database
    await cleanupTestData();
  });

  it('should prioritize storage > pipeline > upload', async () => {
    // Arrange: Create file in all three scopes
    const fileName = 'test.pdf';
    await createFileInStorage(fileName);
    await createFileInPipeline(fileName);
    await createFileInUpload(fileName);

    // Act: Check duplicate
    const result = await service.checkDuplicates([{ fileName }], userId);

    // Assert: Returns storage scope (highest priority)
    expect(result.results[0].scope).toBe('storage');
  });

  it('should handle mixed results in single batch', async () => {
    // Arrange: Create scenario with all action types
    await createFileInStorage('duplicate-name.pdf');
    await createFileInPipeline('in-pipeline.pdf');
    await createFileInUpload('in-upload.pdf');

    const inputs = [
      { fileName: 'duplicate-name.pdf' },
      { fileName: 'in-pipeline.pdf' },
      { fileName: 'in-upload.pdf' },
      { fileName: 'new-file.pdf' }
    ];

    // Act: Check duplicates
    const result = await service.checkDuplicates(inputs, userId);

    // Assert: Correct action for each file
    expect(result.results[0].action).toBe('duplicate_name');
    expect(result.results[1].action).toBe('in_pipeline');
    expect(result.results[2].action).toBe('in_upload');
    expect(result.results[3].action).toBe('proceed');

    // Assert: Correct summary
    expect(result.summary.canProceed).toBe(1);
    expect(result.summary.duplicates).toBe(1);
    expect(result.summary.inPipeline).toBe(1);
    expect(result.summary.inUpload).toBe(1);
  });
});
```

### 9.3 E2E Test (curl)

```bash
# Test duplicate detection endpoint
curl -X POST http://localhost:3002/api/v2/uploads/check-duplicates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      {
        "fileName": "document.pdf",
        "fileSize": 1024000,
        "contentHash": "sha256:abc123...",
        "folderId": "A1B2C3D4-E5F6-7890-1234-567890ABCDEF"
      },
      {
        "fileName": "new-file.pdf",
        "fileSize": 2048000,
        "folderId": "A1B2C3D4-E5F6-7890-1234-567890ABCDEF"
      }
    ]
  }'

# Expected response:
# {
#   "results": [
#     {
#       "fileName": "document.pdf",
#       "action": "duplicate_name",
#       "scope": "storage",
#       "existingFileId": "...",
#       "existingFileName": "document.pdf",
#       "reason": "File with same name already exists in this folder"
#     },
#     {
#       "fileName": "new-file.pdf",
#       "action": "proceed",
#       "reason": "No duplicates detected"
#     }
#   ],
#   "summary": {
#     "total": 2,
#     "canProceed": 1,
#     "duplicates": 1,
#     "inPipeline": 0,
#     "inUpload": 0
#   }
# }
```

---

## 10. Migration Plan

### Phase 1: Implementation (Week 1)
1. Implement `DuplicateDetectionServiceV2` with three-scope detection
2. Add shared types to `@bc-agent/shared`
3. Create API endpoint with request validation
4. Write unit tests for each scope

### Phase 2: Integration (Week 2)
1. Add integration tests with Prisma
2. Performance test with 500-file batches
3. Add deprecation warnings to legacy `FileDuplicateService`
4. Update API documentation

### Phase 3: Frontend Integration (Week 3)
1. Update frontend file upload flows to call new endpoint
2. Implement resolution dialog based on returned verdicts
3. E2E tests for duplicate detection in UI
4. Monitor legacy endpoint usage

### Phase 4: Deprecation (2 releases later)
1. Remove legacy `FileDuplicateService.checkByName()`
2. Remove legacy `POST /api/files/check-duplicates` endpoint
3. Remove `duplicates.routes.ts`
4. Update all documentation

---

## 11. Closing Deliverables

### Code Artifacts

- [ ] `backend/src/services/files/DuplicateDetectionServiceV2.ts` - Core service implementation
- [ ] `backend/src/routes/files/duplicate-detection-v2.routes.ts` - API endpoint
- [ ] `packages/shared/src/types/duplicate-detection.types.ts` - Shared type definitions
- [ ] `backend/src/services/files/__tests__/DuplicateDetectionServiceV2.test.ts` - Unit tests
- [ ] `backend/src/services/files/__tests__/DuplicateDetectionServiceV2.integration.test.ts` - Integration tests

### Documentation

- [ ] API endpoint documentation (request/response schemas, error codes)
- [ ] Update `backend/src/domains/files/CLAUDE.md` with three-scope detection pattern
- [ ] Add deprecation notices to legacy `FileDuplicateService`
- [ ] Update `CHANGELOG.md` with PRD-02 changes

### Testing Evidence

- [ ] Unit test coverage report (>90% coverage)
- [ ] Integration test results with batch query performance metrics
- [ ] curl test results showing successful duplicate detection
- [ ] Performance benchmark: 500 files checked in <500ms

### Verification Checklist

- [ ] All three scopes (storage, pipeline, upload) correctly detect duplicates
- [ ] Batch queries execute in <3 queries regardless of input size
- [ ] Per-file verdicts include actionable information (existingFileId, reason)
- [ ] Summary statistics accurately reflect batch results
- [ ] Error handling for database failures with proper logging
- [ ] Frontend can use verdicts to show resolution dialog
- [ ] Legacy endpoints marked with `@deprecated` tags
- [ ] No breaking changes to existing upload flows

---

## 12. Future Enhancements (Not in Scope)

### Auto-Resolution Strategies
- **Smart rename**: Automatically append `(1)`, `(2)` suffixes for name conflicts
- **User preferences**: Remember "always skip" or "always replace" settings
- **Bulk actions**: Apply same resolution to multiple files in batch

### Advanced Detection
- **Fuzzy filename matching**: Detect "Report.pdf" vs "Report (1).pdf" as related
- **Image perceptual hashing**: Detect visually identical images with different encoding
- **Cross-workspace deduplication**: Opt-in to share files across workspaces

### Performance Optimization
- **Redis caching**: Cache recent duplicate checks for 5 minutes
- **Bloom filters**: Fast negative lookups for common "no duplicate" cases
- **Background deduplication**: Periodic cleanup job to find existing duplicates

### Analytics
- **Duplicate rate metrics**: Track how often users upload duplicates
- **Storage savings**: Calculate storage saved by blocking duplicates
- **User behavior**: Identify users who frequently upload duplicates

---

**End of PRD-02**
