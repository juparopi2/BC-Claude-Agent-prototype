# PRD-01: Foundation — State Machine & Prisma File Repository

**Status**: Draft
**Author**: System
**Date**: 2026-02-10
**Epic**: Unified Upload Pipeline Rewrite

---

## 1. Problem

### 1.1 Ambiguous State Management

The current file processing system suffers from fundamental state management issues:

1. **Overloaded `pending` state**: The value `pending` is reused for two different meanings:
   - "Freshly created, waiting to be scheduled"
   - "Scheduler picked it up and is processing"

   This ambiguity makes it impossible to distinguish between files waiting for processing and files actively being processed.

2. **Non-atomic transitions**: State changes require two separate UPDATE statements:
   ```sql
   -- First update
   UPDATE files SET processing_status = 'processing' WHERE id = @fileId;

   -- Second update (separate transaction)
   UPDATE files SET embedding_status = 'generating' WHERE id = @fileId;
   ```

   Between these updates, the file exists in an inconsistent state. If the process crashes, the file is stuck with mismatched statuses.

3. **Silent failure swallowing**: Raw SQL updates with 0 affected rows fail silently:
   ```typescript
   await executeQuery(sql, params);  // Returns void, no indication of success
   ```

   If the file was already updated by another process (race condition), the current process continues unaware that its update failed.

4. **No formal transition rules**: There is no definition of valid state transitions. Any code can set any status value at any time. Invalid transitions (e.g., `embedding → uploaded`) are not prevented or detected.

### 1.2 Combinatorial State Explosion

The dual-column status model creates 25+ possible combinations:

| `processing_status` | `embedding_status` | Meaning? |
|---------------------|-------------------|----------|
| `pending` | `null` | Just created? |
| `pending` | `pending` | Waiting or processing? |
| `processing` | `pending` | Which phase? |
| `completed` | `generating` | Inconsistent! |
| `failed` | `completed` | What failed? |

Most combinations are meaningless or invalid. Diagnosing a stuck file requires complex multi-column queries with ambiguous results:

```sql
-- What does this mean?
SELECT * FROM files
WHERE processing_status = 'completed'
  AND embedding_status = 'pending';
```

### 1.3 Impact

- **Debugging complexity**: Engineers must mentally compute the combined meaning of two fields
- **Race conditions**: Concurrent processes can create invalid states
- **Stuck files**: Files enter unrecoverable states with no clear recovery path
- **Testing difficulty**: 25+ combinations make comprehensive testing impractical
- **Monitoring gaps**: No clear answer to "how many files are actively processing?"

---

## 2. Deprecation Registry (Before Implementation)

### 2.1 Database Columns

| Column | Status | Replacement | Timeline |
|--------|--------|-------------|----------|
| `processing_status` | **@deprecated(PRD-01)** | `pipeline_status` | Dropped in PRD-07 |
| `embedding_status` | **@deprecated(PRD-01)** | `pipeline_status` | Dropped in PRD-07 |

Mark in `schema.prisma`:
```prisma
model files {
  // @deprecated(PRD-01) - Use pipeline_status instead. Dropped in PRD-07.
  processing_status String?

  // @deprecated(PRD-01) - Use pipeline_status instead. Dropped in PRD-07.
  embedding_status  String?

  // New unified status (added in PRD-01)
  pipeline_status   String?  // Nullable during migration, required after PRD-07
}
```

### 2.2 Code Modules

| Module | Status | Replacement | Timeline |
|--------|--------|-------------|----------|
| `FileRepository.ts` (raw SQL) | **@deprecated(PRD-01)** | `FileRepositoryV2` (Prisma) | Removed in PRD-07 |
| `FileQueryBuilder.ts` | **@deprecated(PRD-01)** | Prisma query patterns | Removed in PRD-07 |
| `ReadinessStateComputer.ts` | **@deprecated(PRD-01)** | Adapted for `pipeline_status` | Replaced in PRD-02 |

### 2.3 Shared Constants

| Constant | Status | Replacement | Timeline |
|----------|--------|-------------|----------|
| `PROCESSING_STATUS` | **@deprecated(PRD-01)** | `PIPELINE_STATUS` | Removed in PRD-07 |
| `EMBEDDING_STATUS` | **@deprecated(PRD-01)** | `PIPELINE_STATUS` | Removed in PRD-07 |

Mark in `@bc-agent/shared`:
```typescript
/**
 * @deprecated(PRD-01) Use PIPELINE_STATUS instead. Removed in PRD-07.
 */
export const PROCESSING_STATUS = { /* ... */ };

/**
 * @deprecated(PRD-01) Use PIPELINE_STATUS instead. Removed in PRD-07.
 */
export const EMBEDDING_STATUS = { /* ... */ };
```

### 2.4 Column Lifecycle Guarantee

| Column | PRD-01 | PRD-02..06 | PRD-07 |
|--------|--------|-----------|--------|
| `pipeline_status` | **ADD** (new) | Used by all V2 code | Stays (permanent) |
| `processing_status` | Kept (old code uses it) | Marked `@deprecated(PRD-01)` | **DROP** column |
| `embedding_status` | Kept (old code uses it) | Marked `@deprecated(PRD-01)` | **DROP** column |

**Migration strategy**: PRD-02-06 will write to BOTH old and new columns (dual-write) to maintain backward compatibility. PRD-07 backfills historical data and drops old columns.

---

## 3. Solution Pattern

### 3.1 Formal State Machine

Introduce a **`FileStateMachine`** module that defines all valid states and transitions as code:

```typescript
// backend/src/domains/files/state-machine/PipelineStatus.ts

/**
 * Unified pipeline status replacing processing_status + embedding_status.
 * Each file has exactly ONE status at any time.
 */
export enum PipelineStatus {
  /** Initial state: File record created, not yet uploaded to storage */
  REGISTERED = 'registered',

  /** File uploaded to blob storage, ready for scheduling */
  UPLOADED = 'uploaded',

  /** Scheduled for processing, waiting in queue */
  QUEUED = 'queued',

  /** Actively extracting text/metadata from file */
  EXTRACTING = 'extracting',

  /** Actively chunking extracted text */
  CHUNKING = 'chunking',

  /** Actively generating embeddings for chunks */
  EMBEDDING = 'embedding',

  /** Processing complete, ready for search */
  READY = 'ready',

  /** Processing failed (reachable from any active state) */
  FAILED = 'failed',
}

/**
 * Constants object for backward compatibility with existing code patterns.
 */
export const PIPELINE_STATUS = {
  REGISTERED: PipelineStatus.REGISTERED,
  UPLOADED: PipelineStatus.UPLOADED,
  QUEUED: PipelineStatus.QUEUED,
  EXTRACTING: PipelineStatus.EXTRACTING,
  CHUNKING: PipelineStatus.CHUNKING,
  EMBEDDING: PipelineStatus.EMBEDDING,
  READY: PipelineStatus.READY,
  FAILED: PipelineStatus.FAILED,
} as const;
```

### 3.2 Transition Table

Define all valid state transitions explicitly:

```typescript
// backend/src/domains/files/state-machine/transitions.ts

import { PipelineStatus } from './PipelineStatus';

/**
 * Valid state transitions map.
 * Key: current state
 * Value: array of valid next states
 */
export const PIPELINE_TRANSITIONS: Record<PipelineStatus, PipelineStatus[]> = {
  [PipelineStatus.REGISTERED]: [
    PipelineStatus.UPLOADED,
    PipelineStatus.FAILED,
  ],

  [PipelineStatus.UPLOADED]: [
    PipelineStatus.QUEUED,
    PipelineStatus.FAILED,
  ],

  [PipelineStatus.QUEUED]: [
    PipelineStatus.EXTRACTING,
    PipelineStatus.FAILED,
  ],

  [PipelineStatus.EXTRACTING]: [
    PipelineStatus.CHUNKING,
    PipelineStatus.FAILED,
  ],

  [PipelineStatus.CHUNKING]: [
    PipelineStatus.EMBEDDING,
    PipelineStatus.FAILED,
  ],

  [PipelineStatus.EMBEDDING]: [
    PipelineStatus.READY,
    PipelineStatus.FAILED,
  ],

  [PipelineStatus.READY]: [
    // Terminal state: no automatic transitions
    // Manual intervention could move to QUEUED for reprocessing
  ],

  [PipelineStatus.FAILED]: [
    // Manual retry could move back to QUEUED
  ],
};

/**
 * Check if a state transition is valid.
 *
 * @param from - Current state
 * @param to - Target state
 * @returns true if transition is valid
 */
export function canTransition(
  from: PipelineStatus,
  to: PipelineStatus
): boolean {
  const validTransitions = PIPELINE_TRANSITIONS[from];
  return validTransitions.includes(to);
}

/**
 * Get all valid next states from current state.
 *
 * @param from - Current state
 * @returns Array of valid next states
 */
export function getValidTransitions(from: PipelineStatus): PipelineStatus[] {
  return [...PIPELINE_TRANSITIONS[from]];
}

/**
 * Get human-readable transition error message.
 */
export function getTransitionErrorMessage(
  from: PipelineStatus,
  to: PipelineStatus
): string {
  const valid = getValidTransitions(from);
  return `Invalid transition from ${from} to ${to}. Valid transitions: ${valid.join(', ')}`;
}
```

### 3.3 State Transition Diagram

```
registered → uploaded → queued → extracting → chunking → embedding → ready
    ↓           ↓         ↓          ↓           ↓          ↓
  failed      failed    failed     failed      failed     failed

Notes:
- All active states can transition to 'failed'
- 'ready' and 'failed' are terminal states (no automatic transitions)
- Manual retry operations can move 'failed' → 'queued'
```

### 3.4 FileRepositoryV2 with Atomic Transitions

Replace raw SQL with Prisma and implement optimistic concurrency:

```typescript
// backend/src/domains/files/repository/FileRepositoryV2.ts

import { PrismaClient } from '@prisma/client';
import { PipelineStatus, canTransition, getTransitionErrorMessage } from '../state-machine';

export interface TransitionResult {
  success: boolean;
  previousStatus: PipelineStatus | null;
  error?: string;
}

export class FileRepositoryV2 {
  constructor(private prisma: PrismaClient) {}

  /**
   * Atomically transition a file's status with optimistic concurrency.
   *
   * Uses WHERE clause with current status to ensure state hasn't changed
   * since we last read it (optimistic locking).
   *
   * @param fileId - File ID (UPPERCASE GUID)
   * @param from - Expected current status
   * @param to - Target status
   * @returns TransitionResult with success flag and previous status
   *
   * @example
   * const result = await repo.transitionStatus(fileId, 'uploaded', 'queued');
   * if (!result.success) {
   *   logger.warn({ fileId, result }, 'Concurrent modification detected');
   * }
   */
  async transitionStatus(
    fileId: string,
    from: PipelineStatus,
    to: PipelineStatus
  ): Promise<TransitionResult> {
    // Validate transition is allowed by state machine
    if (!canTransition(from, to)) {
      return {
        success: false,
        previousStatus: from,
        error: getTransitionErrorMessage(from, to),
      };
    }

    try {
      // Atomic UPDATE with optimistic concurrency control
      const result = await this.prisma.files.updateMany({
        where: {
          id: fileId,
          pipeline_status: from,  // Optimistic lock: only update if still in expected state
        },
        data: {
          pipeline_status: to,
          updated_at: new Date(),
        },
      });

      // Check if update succeeded (1 row affected)
      if (result.count === 0) {
        // State was already changed by another process
        const currentFile = await this.prisma.files.findUnique({
          where: { id: fileId },
          select: { pipeline_status: true },
        });

        return {
          success: false,
          previousStatus: currentFile?.pipeline_status as PipelineStatus | null,
          error: 'Concurrent modification: file status was already changed',
        };
      }

      return {
        success: true,
        previousStatus: from,
      };
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };

      return {
        success: false,
        previousStatus: from,
        error: `Database error: ${errorInfo.message}`,
      };
    }
  }

  /**
   * Get current status of a file.
   */
  async getStatus(fileId: string): Promise<PipelineStatus | null> {
    const file = await this.prisma.files.findUnique({
      where: { id: fileId },
      select: { pipeline_status: true },
    });

    return file?.pipeline_status as PipelineStatus | null;
  }

  /**
   * Get files by status (for monitoring and scheduling).
   */
  async findByStatus(
    status: PipelineStatus,
    limit?: number
  ): Promise<Array<{ id: string; created_at: Date }>> {
    return this.prisma.files.findMany({
      where: { pipeline_status: status },
      select: { id: true, created_at: true },
      orderBy: { created_at: 'asc' },
      take: limit,
    });
  }

  /**
   * Count files by status (for monitoring).
   */
  async countByStatus(): Promise<Record<PipelineStatus, number>> {
    const results = await this.prisma.files.groupBy({
      by: ['pipeline_status'],
      _count: true,
    });

    const counts: Record<string, number> = {};
    for (const status of Object.values(PipelineStatus)) {
      counts[status] = 0;
    }

    for (const result of results) {
      if (result.pipeline_status) {
        counts[result.pipeline_status] = result._count;
      }
    }

    return counts as Record<PipelineStatus, number>;
  }
}
```

### 3.5 Error Handling Pattern

```typescript
// Example usage in FileProcessingService

async processFile(fileId: string): Promise<void> {
  const repo = new FileRepositoryV2(prisma);

  // Transition: queued → extracting
  const startResult = await repo.transitionStatus(
    fileId,
    PipelineStatus.QUEUED,
    PipelineStatus.EXTRACTING
  );

  if (!startResult.success) {
    this.logger.warn({
      fileId,
      expectedStatus: PipelineStatus.QUEUED,
      actualStatus: startResult.previousStatus,
      error: startResult.error,
    }, 'Failed to start extraction: file already processed by another worker');
    return;  // Another worker got it first, skip processing
  }

  try {
    // Do extraction work...
    await this.extractText(fileId);

    // Transition: extracting → chunking
    const nextResult = await repo.transitionStatus(
      fileId,
      PipelineStatus.EXTRACTING,
      PipelineStatus.CHUNKING
    );

    if (!nextResult.success) {
      throw new Error(`Unexpected state change: ${nextResult.error}`);
    }
  } catch (error) {
    // Transition to failed state
    await repo.transitionStatus(
      fileId,
      PipelineStatus.EXTRACTING,
      PipelineStatus.FAILED
    );
    throw error;
  }
}
```

### 3.6 Shared Types Package

Export types in `@bc-agent/shared` for frontend consumption:

```typescript
// packages/shared/src/types/pipeline-status.types.ts

export enum PipelineStatus {
  REGISTERED = 'registered',
  UPLOADED = 'uploaded',
  QUEUED = 'queued',
  EXTRACTING = 'extracting',
  CHUNKING = 'chunking',
  EMBEDDING = 'embedding',
  READY = 'ready',
  FAILED = 'failed',
}

export const PIPELINE_STATUS = {
  REGISTERED: PipelineStatus.REGISTERED,
  UPLOADED: PipelineStatus.UPLOADED,
  QUEUED: PipelineStatus.QUEUED,
  EXTRACTING: PipelineStatus.EXTRACTING,
  CHUNKING: PipelineStatus.CHUNKING,
  EMBEDDING: PipelineStatus.EMBEDDING,
  READY: PipelineStatus.READY,
  FAILED: PipelineStatus.FAILED,
} as const;

export interface TransitionResult {
  success: boolean;
  previousStatus: PipelineStatus | null;
  error?: string;
}

export class PipelineTransitionError extends Error {
  constructor(
    message: string,
    public readonly from: PipelineStatus,
    public readonly to: PipelineStatus,
    public readonly validTransitions: PipelineStatus[]
  ) {
    super(message);
    this.name = 'PipelineTransitionError';
  }
}
```

---

## 4. Scope

### 4.1 In Scope

1. **State Machine Implementation**
   - `PipelineStatus` enum definition
   - `PIPELINE_TRANSITIONS` transition table
   - Pure functions: `canTransition()`, `getValidTransitions()`, `getTransitionErrorMessage()`
   - Unit tests covering all 8 states and all valid/invalid transitions (100% coverage)

2. **Prisma Repository**
   - `FileRepositoryV2` class with Prisma client
   - `transitionStatus()` method with optimistic concurrency
   - `getStatus()`, `findByStatus()`, `countByStatus()` query methods
   - Unit tests with Prisma mock/in-memory database

3. **Database Schema**
   - Add `pipeline_status` column to `files` table (nullable, indexed)
   - Mark old columns with `@deprecated(PRD-01)` in schema comments
   - Migration script: `npx prisma db push`

4. **Shared Types Package**
   - Export `PipelineStatus` enum
   - Export `PIPELINE_STATUS` constants
   - Export `PIPELINE_TRANSITIONS` map
   - Export `PipelineTransitionError` class
   - Export `TransitionResult` interface

5. **Health Endpoint**
   - `GET /api/v2/uploads/health` returning:
     - List of valid states
     - Transition table (state → valid next states)
     - Current file distribution by `pipeline_status`
     - System metadata (version, timestamp)

### 4.2 Out of Scope (Future PRDs)

- Integration with existing upload flow (PRD-02)
- Scheduler migration to unified pipeline (PRD-03)
- Worker migration (PRD-04-06)
- Backfilling historical data (PRD-07)
- Dropping old columns (PRD-07)
- Frontend UI updates (separate epic)

### 4.3 Backward Compatibility

- Old code continues using `processing_status` + `embedding_status` (untouched)
- New `pipeline_status` column is nullable (no breaking changes)
- Existing API endpoints unchanged
- FileRepository (old) coexists with FileRepositoryV2 (new)

---

## 5. Success Criteria

### 5.1 Functional Requirements

- [ ] State machine rejects invalid transitions with descriptive error messages
- [ ] `transitionStatus()` correctly handles concurrent modifications (0 rows updated)
- [ ] All 8 states are reachable via valid transition paths
- [ ] `FAILED` state is reachable from all active states
- [ ] Health endpoint returns accurate state distribution matching database

### 5.2 Non-Functional Requirements

- [ ] 100% unit test coverage on state machine transitions (56 test cases: 8 states × 7 potential transitions)
- [ ] Atomic status updates complete in <10ms (single SQL UPDATE)
- [ ] No silent failures (all errors logged with context)
- [ ] All IDs are UPPERCASE (enforcement at ingestion)

### 5.3 Testability

Verify via curl:
```bash
# Get state machine metadata
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/health

# Expected response:
{
  "version": "2.0.0-alpha",
  "timestamp": "2026-02-10T12:00:00Z",
  "states": ["registered", "uploaded", "queued", ...],
  "transitions": {
    "registered": ["uploaded", "failed"],
    "uploaded": ["queued", "failed"],
    ...
  },
  "distribution": {
    "registered": 5,
    "uploaded": 12,
    "queued": 3,
    "extracting": 1,
    "chunking": 0,
    "embedding": 2,
    "ready": 48,
    "failed": 7
  }
}
```

---

## 6. Reusable Code

### 6.1 Adapt Existing Logic

1. **ReadinessStateComputer** (`backend/src/services/files/ReadinessStateComputer.ts`):
   - Current: Computes readiness from `processing_status` + `embedding_status`
   - Adapt: Map `pipeline_status` → boolean (ready if `status === 'ready'`)

2. **FileQueryBuilder** (`backend/src/services/files/FileQueryBuilder.ts`):
   - Current: Complex SQL WHERE clauses for dual-column filtering
   - Replace: Prisma `where: { pipeline_status: 'ready' }`

### 6.2 Existing Prisma Client

Use singleton Prisma client from `backend/src/infrastructure/database/prisma.ts`:

```typescript
import { prisma } from '@/infrastructure/database';

export class FileRepositoryV2 {
  constructor(private prisma = prisma) {}  // Default to singleton
}
```

---

## 7. Dependencies

### 7.1 Technical Dependencies

- Prisma Client (already installed)
- TypeScript 5.x (already installed)
- Azure SQL Server (existing database)

### 7.2 External Dependencies

**None** - This is a foundation phase with no external service dependencies.

### 7.3 Internal Dependencies

**None** - PRD-01 is independent. All subsequent PRDs depend on PRD-01.

---

## 8. Closing Deliverables (Template)

### 8.1 Code Deliverables

- [ ] `backend/src/domains/files/state-machine/PipelineStatus.ts`
- [ ] `backend/src/domains/files/state-machine/transitions.ts`
- [ ] `backend/src/domains/files/state-machine/index.ts` (barrel export)
- [ ] `backend/src/domains/files/repository/FileRepositoryV2.ts`
- [ ] `backend/src/routes/v2/uploads/health.routes.ts`
- [ ] `packages/shared/src/types/pipeline-status.types.ts`
- [ ] `packages/shared/src/index.ts` (export new types)

### 8.2 Database Deliverables

- [ ] `backend/prisma/schema.prisma` updated with:
  - New `pipeline_status String?` column on `files` table
  - Index on `pipeline_status` for query performance
  - Deprecation comments on old columns

### 8.3 Test Deliverables

- [ ] `backend/src/domains/files/state-machine/__tests__/transitions.test.ts`
  - Test all 56 valid/invalid transition combinations
  - Test `canTransition()` edge cases
  - Test `getValidTransitions()` completeness
- [ ] `backend/src/domains/files/repository/__tests__/FileRepositoryV2.test.ts`
  - Test atomic transitions with concurrent modifications
  - Test query methods (`findByStatus`, `countByStatus`)
  - Test error handling (invalid transitions, database errors)
- [ ] `backend/src/routes/v2/uploads/__tests__/health.routes.test.ts`
  - Test health endpoint response structure
  - Test state distribution accuracy

### 8.4 Documentation Deliverables

- [ ] Update `backend/src/domains/files/CLAUDE.md` with:
  - State machine architecture
  - FileRepositoryV2 usage examples
  - Migration strategy (dual-write plan for PRD-02)
- [ ] Update `CLAUDE.md` (root) with:
  - New `pipeline_status` column reference
  - Deprecation warnings for old columns
  - Link to upload pipeline rewrite epic

### 8.5 Verification Checklist

**Manual Testing**:
- [ ] Run `npx prisma db push` successfully
- [ ] Verify `pipeline_status` column exists in database
- [ ] Call `GET /api/v2/uploads/health` and verify response structure
- [ ] Create test file record with `pipeline_status = 'registered'`
- [ ] Transition through all states via repository methods
- [ ] Verify all transitions logged with correct metadata

**Automated Testing**:
- [ ] `npm run -w backend test:unit` passes (100% coverage on state machine)
- [ ] `npm run verify:types` passes
- [ ] `npm run -w backend lint` passes

**Database Verification**:
```sql
-- Verify column exists
SELECT TOP 1 pipeline_status FROM files;

-- Verify index exists
SELECT * FROM sys.indexes WHERE name LIKE '%pipeline_status%';

-- Verify old columns still exist (backward compatibility)
SELECT TOP 1 processing_status, embedding_status FROM files;
```

**Health Endpoint Verification**:
```bash
TOKEN="<test-token>"

# Should return 200 with valid JSON
curl -i -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/health

# Should include all 8 states
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/health \
  | jq '.states | length'  # Expected: 8

# Should include transition table
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/v2/uploads/health \
  | jq '.transitions.registered'  # Expected: ["uploaded", "failed"]
```

---

## Appendix A: State Machine Test Matrix

Required test coverage for `transitions.test.ts`:

| From State | To State | Expected Result | Test Case |
|-----------|----------|-----------------|-----------|
| registered | uploaded | ✅ Valid | Happy path |
| registered | failed | ✅ Valid | Error handling |
| registered | queued | ❌ Invalid | Skip stage |
| registered | registered | ❌ Invalid | No-op |
| uploaded | queued | ✅ Valid | Happy path |
| uploaded | failed | ✅ Valid | Error handling |
| uploaded | extracting | ❌ Invalid | Skip stage |
| queued | extracting | ✅ Valid | Happy path |
| queued | failed | ✅ Valid | Error handling |
| queued | uploaded | ❌ Invalid | Backward |
| extracting | chunking | ✅ Valid | Happy path |
| extracting | failed | ✅ Valid | Error handling |
| extracting | embedding | ❌ Invalid | Skip stage |
| chunking | embedding | ✅ Valid | Happy path |
| chunking | failed | ✅ Valid | Error handling |
| chunking | ready | ❌ Invalid | Skip stage |
| embedding | ready | ✅ Valid | Happy path |
| embedding | failed | ✅ Valid | Error handling |
| embedding | chunking | ❌ Invalid | Backward |
| ready | * | ❌ Invalid | Terminal state |
| failed | * | ❌ Invalid | Terminal state |

Total: 56 test cases (8 states × 7 transitions each)

---

## Appendix B: Migration Timeline

```
PRD-01 (Foundation) ──────────────────────────────┐
  │ Add pipeline_status column                     │
  │ Build state machine                            │
  │ Build FileRepositoryV2                         │
  │ Old code unchanged                             │
  └─────────────────────────────────────────────────┘
                    │
                    ▼
PRD-02 (Upload Flow) ─────────────────────────────┐
  │ Dual-write: populate BOTH old + new columns    │
  │ Upload endpoints use FileRepositoryV2          │
  │ Old paths still functional                     │
  └─────────────────────────────────────────────────┘
                    │
                    ▼
PRD-03..06 (Workers) ─────────────────────────────┐
  │ Each worker migrated individually              │
  │ Continue dual-write to both columns            │
  │ All transitions use state machine              │
  └─────────────────────────────────────────────────┘
                    │
                    ▼
PRD-07 (Cleanup) ─────────────────────────────────┐
  │ Backfill: copy old → new for historical data   │
  │ Make pipeline_status NOT NULL                  │
  │ Drop processing_status column                  │
  │ Drop embedding_status column                   │
  │ Remove FileRepository (old)                    │
  └─────────────────────────────────────────────────┘
```

---

**End of PRD-01**
