/**
 * SyncReconciliationService Unit Tests (PRD-300)
 *
 * Tests the reconciliation run:
 *   1. Identifies files in DB (ready) but missing from the search index
 *   2. Identifies documents in the search index with no matching DB file (orphans)
 *   3. Dry-run mode: no mutations when SYNC_RECONCILIATION_AUTO_REPAIR is unset
 *   4. Auto-repair mode: re-enqueues missing files, deletes orphaned search docs
 *   5. Limits processing to MAX_USERS_PER_RUN (50) users
 *   6. Paginates DB file queries in batches of 500 (DB_BATCH_SIZE)
 *   7. Per-user isolation: one user error does not abort the remaining users
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks (Hoisted — must come before any imports from mocked modules)
// ============================================================================

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// files table
const mockFilesFindMany = vi.hoisted(() => vi.fn());
const mockFilesFindUnique = vi.hoisted(() => vi.fn());
const mockFilesUpdate = vi.hoisted(() => vi.fn());
const mockFilesUpdateMany = vi.hoisted(() => vi.fn());

// image_embeddings table
const mockImageEmbeddingsFindMany = vi.hoisted(() => vi.fn());

// file_chunks table
const mockFileChunksDeleteMany = vi.hoisted(() => vi.fn());
const mockFileChunksFindMany = vi.hoisted(() => vi.fn());

// connection_scopes table (folder hierarchy detection)
const mockConnectionScopesFindMany = vi.hoisted(() => vi.fn());
const mockConnectionScopesUpdate = vi.hoisted(() => vi.fn());
const mockConnectionScopesFindUnique = vi.hoisted(() => vi.fn());

// Raw SQL queries (folder hierarchy detection)
const mockQueryRaw = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findMany: mockFilesFindMany,
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: mockFilesFindUnique,
      update: mockFilesUpdate,
      updateMany: mockFilesUpdateMany,
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    image_embeddings: {
      findMany: mockImageEmbeddingsFindMany,
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    file_chunks: {
      deleteMany: mockFileChunksDeleteMany,
      findMany: mockFileChunksFindMany,
    },
    connection_scopes: {
      findMany: mockConnectionScopesFindMany,
      findUnique: mockConnectionScopesFindUnique,
      update: mockConnectionScopesUpdate,
    },
    $queryRaw: mockQueryRaw,
  },
}));

// Queue
const mockAddFileProcessingFlow = vi.hoisted(() => vi.fn());
const mockAddInitialSyncJob = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
    addInitialSyncJob: mockAddInitialSyncJob,
  })),
}));

// VectorSearchService (dynamic import in implementation)
const mockGetUniqueFileIds = vi.hoisted(() => vi.fn());
const mockDeleteChunksForFile = vi.hoisted(() => vi.fn());
const mockGetFileMetadataForUser = vi.hoisted(() => vi.fn());

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      getUniqueFileIds: mockGetUniqueFileIds,
      deleteChunksForFile: mockDeleteChunksForFile,
      getFileMetadataForUser: mockGetFileMetadataForUser,
    })),
  },
}));

// FolderHierarchyResolver (dynamic import for scope root folder recreation)
vi.mock('@/services/sync/FolderHierarchyResolver', () => ({
  ensureScopeRootFolder: vi.fn().mockResolvedValue(undefined),
}));

// env — mock the module so SYNC_RECONCILIATION_AUTO_REPAIR is controllable per-test
const mockEnv = vi.hoisted(() => ({ SYNC_RECONCILIATION_AUTO_REPAIR: false as boolean }));

vi.mock('@/infrastructure/config/environment', () => ({
  get env() {
    return mockEnv;
  },
}));

// Redis client — mock for cooldown checks
const mockRedisTtl = vi.hoisted(() => vi.fn());
const mockRedisSet = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/redis/redis-client', () => ({
  getRedisClient: vi.fn(() => ({
    ttl: mockRedisTtl,
    set: mockRedisSet,
  })),
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import { SyncReconciliationService } from '@/services/sync/health/SyncReconciliationService';
import { ReconciliationCooldownError, ReconciliationInProgressError } from '@/services/sync/health/types';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const USER_ID_1 = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const USER_ID_2 = 'USER-BBBBBBBB-1111-2222-3333-444455556666';
const FILE_ID_1 = 'FILE-11111111-AAAA-BBBB-CCCC-DDDDEEEE1111';
const FILE_ID_2 = 'FILE-22222222-AAAA-BBBB-CCCC-DDDDEEEE2222';
const FILE_ID_3 = 'FILE-33333333-AAAA-BBBB-CCCC-DDDDEEEE3333'; // orphan in search only
const SCOPE_ID = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal file record as returned by files.findUnique during repair */
function makeFileRecord(fileId: string, overrides?: { name?: string; mime_type?: string; connection_scope_id?: string }) {
  return {
    id: fileId,
    name: overrides?.name ?? 'document.pdf',
    mime_type: overrides?.mime_type ?? 'application/pdf',
    user_id: USER_ID_1,
    connection_scope_id: overrides?.connection_scope_id ?? SCOPE_ID,
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Reset env to safe default (dry-run) before each test
  mockEnv.SYNC_RECONCILIATION_AUTO_REPAIR = false;

  // Safe defaults — operations succeed, return empty results
  mockFilesFindMany.mockResolvedValue([]);
  mockFilesFindUnique.mockResolvedValue(null);
  mockFilesUpdate.mockResolvedValue({});
  mockFilesUpdateMany.mockResolvedValue({ count: 1 });
  mockAddFileProcessingFlow.mockResolvedValue(undefined);
  mockGetUniqueFileIds.mockResolvedValue([]);
  mockDeleteChunksForFile.mockResolvedValue(undefined);
  mockImageEmbeddingsFindMany.mockResolvedValue([]);
  mockFileChunksDeleteMany.mockResolvedValue({ count: 0 });
  mockFileChunksFindMany.mockResolvedValue([]);
  mockGetFileMetadataForUser.mockResolvedValue(new Map());
  mockRedisTtl.mockResolvedValue(-2); // Key does not exist = no cooldown
  mockRedisSet.mockResolvedValue('OK');
  mockQueryRaw.mockResolvedValue([]); // No orphaned children by default
  mockConnectionScopesFindMany.mockResolvedValue([]); // No scopes by default
  mockConnectionScopesFindUnique.mockResolvedValue(null);
  mockConnectionScopesUpdate.mockResolvedValue({});
  mockAddInitialSyncJob.mockResolvedValue('job-id');
});

afterEach(() => {
  // Reset env mock to avoid test pollution
  mockEnv.SYNC_RECONCILIATION_AUTO_REPAIR = false;
});

// ============================================================================
// Tests
// ============================================================================

describe('SyncReconciliationService', () => {
  let service: SyncReconciliationService;

  beforeEach(() => {
    service = new SyncReconciliationService();
  });

  // ==========================================================================
  // run() — missing-from-search detection
  // ==========================================================================

  describe('run() — missing-from-search detection', () => {
    it('identifies files in DB that are missing from the search index', async () => {
      // Distinct users query returns USER_ID_1
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { user_id?: string } }) => {
        if (args.distinct) {
          // First call: distinct users query
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Second call: per-user file IDs (FILE_ID_1 and FILE_ID_2 are in DB)
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }]);
      });

      // Search only has FILE_ID_1 — FILE_ID_2 is missing from search
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1]);

      const reports = await service.run();

      expect(reports).toHaveLength(1);
      const report = reports[0];
      expect(report.userId).toBe(USER_ID_1);
      expect(report.missingFromSearch).toContain(FILE_ID_2);
      expect(report.missingFromSearch).not.toContain(FILE_ID_1);
      expect(report.dbReadyFiles).toBe(2);
      expect(report.searchIndexedFiles).toBe(1);
    });

    it('reports zero missing files when DB and search are in sync', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }]);
      });

      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1, FILE_ID_2]);

      const reports = await service.run();

      expect(reports[0].missingFromSearch).toHaveLength(0);
      expect(reports[0].orphanedInSearch).toHaveLength(0);
    });
  });

  // ==========================================================================
  // run() — orphaned-in-search detection
  // ==========================================================================

  describe('run() — orphaned-in-search detection', () => {
    it('identifies search documents with no matching DB file', async () => {
      // Distinct users query returns USER_ID_1
      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // DB only has FILE_ID_1
        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      // Search has FILE_ID_1 and FILE_ID_3 — FILE_ID_3 is orphaned
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1, FILE_ID_3]);

      const reports = await service.run();

      expect(reports).toHaveLength(1);
      const report = reports[0];
      expect(report.orphanedInSearch).toContain(FILE_ID_3);
      expect(report.orphanedInSearch).not.toContain(FILE_ID_1);
      expect(report.searchIndexedFiles).toBe(2);
      expect(report.dbReadyFiles).toBe(1);
    });
  });

  // ==========================================================================
  // run() — dry-run mode (default, no auto-repair)
  // ==========================================================================

  describe('run() — dry-run mode', () => {
    it('does NOT perform repairs when SYNC_RECONCILIATION_AUTO_REPAIR is not set', async () => {
      // Ensure auto-repair is disabled (beforeEach already sets this, redundant safety)
      mockEnv.SYNC_RECONCILIATION_AUTO_REPAIR = false;

      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      // FILE_ID_2 is missing from search; FILE_ID_3 is orphaned
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_3]);

      const reports = await service.run();

      // No mutations should occur
      expect(mockFilesUpdateMany).not.toHaveBeenCalled();
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
      expect(mockDeleteChunksForFile).not.toHaveBeenCalled();

      expect(reports[0].dryRun).toBe(true);
      expect(reports[0].repairs).toMatchObject({ missingRequeued: 0, orphansDeleted: 0, errors: 0 });
    });

    it('does NOT perform repairs when SYNC_RECONCILIATION_AUTO_REPAIR=false', async () => {
      mockEnv.SYNC_RECONCILIATION_AUTO_REPAIR = false;

      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_3]);

      const reports = await service.run();

      expect(mockFilesUpdateMany).not.toHaveBeenCalled();
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
      expect(mockDeleteChunksForFile).not.toHaveBeenCalled();
      expect(reports[0].dryRun).toBe(true);
    });
  });

  // ==========================================================================
  // run() — auto-repair mode
  // ==========================================================================

  describe('run() — auto-repair mode', () => {
    beforeEach(() => {
      mockEnv.SYNC_RECONCILIATION_AUTO_REPAIR = true;
    });

    it('re-enqueues missing files: resets pipeline_status and calls addFileProcessingFlow', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { pipeline_status?: unknown; deletion_status?: unknown } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Return empty for stuck-deletion detector query
        if (args.where?.deletion_status === 'pending') {
          return Promise.resolve([]);
        }
        // Return empty for failed/stuck queries — only test missing-from-search detection
        if (args.where?.pipeline_status === 'failed' || (args.where?.pipeline_status as { in?: string[] })?.in) {
          return Promise.resolve([]);
        }
        // DB has FILE_ID_1 and FILE_ID_2
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }]);
      });

      // Search only has FILE_ID_1 — FILE_ID_2 is missing
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1]);

      // findUnique returns the file details for re-enqueueing
      mockFilesFindUnique.mockResolvedValue(makeFileRecord(FILE_ID_2));

      const reports = await service.run();

      // pipeline_status reset to 'queued' (optimistic concurrency: where includes pipeline_status)
      expect(mockFilesUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: FILE_ID_2, pipeline_status: 'ready' }),
          data: expect.objectContaining({ pipeline_status: 'queued' }),
        }),
      );

      // File re-enqueued for processing
      expect(mockAddFileProcessingFlow).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: FILE_ID_2, userId: USER_ID_1 }),
      );

      expect(reports[0].dryRun).toBe(false);
      expect(reports[0].repairs.missingRequeued).toBe(1);
      expect(reports[0].repairs.orphansDeleted).toBe(0);
      expect(reports[0].repairs.errors).toBe(0);
    });

    it('deletes orphaned search documents via deleteChunksForFile', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { pipeline_status?: unknown; connections?: unknown; connection_id?: unknown; deletion_status?: unknown } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Return empty for stuck-deletion detector query
        if (args.where?.deletion_status === 'pending') {
          return Promise.resolve([]);
        }
        // Return empty for failed/stuck/external-not-found queries — only test orphan detection
        if (args.where?.pipeline_status === 'failed' || (args.where?.pipeline_status as { in?: string[] })?.in) {
          return Promise.resolve([]);
        }
        // Return empty for disconnected-connection query
        if (args.where?.connections || args.where?.connection_id) {
          return Promise.resolve([]);
        }
        // DB only has FILE_ID_1 (ready files batch)
        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      // Search has FILE_ID_1 and FILE_ID_3 — FILE_ID_3 is orphaned
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1, FILE_ID_3]);

      const reports = await service.run();

      expect(mockDeleteChunksForFile).toHaveBeenCalledWith(FILE_ID_3, USER_ID_1);
      expect(mockDeleteChunksForFile).not.toHaveBeenCalledWith(FILE_ID_1, expect.anything());

      expect(reports[0].repairs.orphansDeleted).toBe(1);
      expect(reports[0].repairs.missingRequeued).toBe(0);
      expect(reports[0].repairs.errors).toBe(0);
    });

    it('repairs both missing and orphaned in the same run', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { pipeline_status?: unknown; deletion_status?: unknown } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Return empty for stuck-deletion detector query
        if (args.where?.deletion_status === 'pending') {
          return Promise.resolve([]);
        }
        // Return empty for failed/stuck queries — only test missing+orphan detection
        if (args.where?.pipeline_status === 'failed' || (args.where?.pipeline_status as { in?: string[] })?.in) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }]);
      });

      // Search has FILE_ID_1 and FILE_ID_3: FILE_ID_2 is missing, FILE_ID_3 is orphaned
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1, FILE_ID_3]);

      mockFilesFindUnique.mockResolvedValue(makeFileRecord(FILE_ID_2));

      const reports = await service.run();

      expect(mockFilesUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: FILE_ID_2 }) }),
      );
      expect(mockAddFileProcessingFlow).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: FILE_ID_2 }),
      );
      expect(mockDeleteChunksForFile).toHaveBeenCalledWith(FILE_ID_3, USER_ID_1);

      expect(reports[0].repairs.missingRequeued).toBe(1);
      expect(reports[0].repairs.orphansDeleted).toBe(1);
      expect(reports[0].repairs.errors).toBe(0);
    });

    it('skips re-enqueueing a missing file when findUnique returns null', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { pipeline_status?: unknown; mime_type?: unknown } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Only return files for the paginated ready-files query; return empty for
        // failed-retriable, stuck-files, and ready-images queries so that only the
        // missingFromSearch repair path is exercised in this test.
        if (args.where?.pipeline_status === 'ready' && !args.where?.mime_type) {
          return Promise.resolve([{ id: FILE_ID_1 }]);
        }
        return Promise.resolve([]);
      });

      // FILE_ID_1 is missing from search
      mockGetUniqueFileIds.mockResolvedValue([]);

      // File no longer exists in DB (concurrent deletion race)
      mockFilesFindUnique.mockResolvedValue(null);

      // Prevent ReadyWithoutChunksDetector from re-enqueueing FILE_ID_1
      // (it would find it as ready-without-chunks and use updateMany, bypassing findUnique)
      mockFileChunksFindMany.mockResolvedValue([{ file_id: FILE_ID_1 }]);

      const reports = await service.run();

      // updateMany and addFileProcessingFlow should NOT be called when file is gone
      expect(mockFilesUpdateMany).not.toHaveBeenCalled();
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();

      expect(reports[0].repairs.missingRequeued).toBe(0);
      expect(reports[0].repairs.errors).toBe(0);
    });

    it('increments repairs.errors when a re-enqueue operation fails, continues processing', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { pipeline_status?: unknown; deletion_status?: unknown } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Return empty for stuck-deletion detector query
        if (args.where?.deletion_status === 'pending') {
          return Promise.resolve([]);
        }
        // Return empty for failed/stuck queries — only test missing-from-search repair error path
        if (args.where?.pipeline_status === 'failed' || (args.where?.pipeline_status as { in?: string[] })?.in) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }]);
      });

      // Both files missing from search
      mockGetUniqueFileIds.mockResolvedValue([]);

      mockFilesFindUnique
        .mockResolvedValueOnce(makeFileRecord(FILE_ID_1))
        .mockResolvedValueOnce(makeFileRecord(FILE_ID_2));

      // First updateMany fails, second succeeds
      mockFilesUpdateMany
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValueOnce({ count: 1 });

      const reports = await service.run();

      expect(reports[0].repairs.errors).toBe(1);
      expect(reports[0].repairs.missingRequeued).toBe(1);
    });

    it('increments repairs.errors when deleteChunksForFile fails, continues processing', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { pipeline_status?: unknown; deletion_status?: unknown } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Return empty for stuck-deletion detector query
        if (args.where?.deletion_status === 'pending') {
          return Promise.resolve([]);
        }
        // Return empty for failed/stuck queries — only test orphan deletion error path
        if (args.where?.pipeline_status === 'failed' || (args.where?.pipeline_status as { in?: string[] })?.in) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      // Search has two orphaned files
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_2, FILE_ID_3]);

      // First delete fails, second succeeds
      mockDeleteChunksForFile
        .mockRejectedValueOnce(new Error('Search service unavailable'))
        .mockResolvedValueOnce(undefined);

      const reports = await service.run();

      expect(reports[0].repairs.errors).toBe(1);
      expect(reports[0].repairs.orphansDeleted).toBe(1);
    });
  });

  // ==========================================================================
  // run() — MAX_USERS_PER_RUN limit
  // ==========================================================================

  describe('run() — MAX_USERS_PER_RUN limit', () => {
    it('passes take: 50 to the distinct users query', async () => {
      // Return no users — we only care about the query args
      mockFilesFindMany.mockResolvedValue([]);

      await service.run();

      expect(mockFilesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          distinct: ['user_id'],
          take: 50,
        }),
      );
    });

    it('processes only the users returned (respects take: 50 implicitly via DB)', async () => {
      // Simulate DB returning exactly 2 users (fewer than 50 — validates the limit flows through)
      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }, { user_id: USER_ID_2 }]);
        }
        return Promise.resolve([]);
      });

      mockGetUniqueFileIds.mockResolvedValue([]);

      const reports = await service.run();

      expect(reports).toHaveLength(2);
      expect(reports.map((r) => r.userId)).toContain(USER_ID_1);
      expect(reports.map((r) => r.userId)).toContain(USER_ID_2);
    });
  });

  // ==========================================================================
  // run() — DB pagination (DB_BATCH_SIZE = 500)
  // ==========================================================================

  describe('run() — pagination', () => {
    it('paginates DB file queries in batches of 500', async () => {
      // Distinct users query returns one user
      let callCount = 0;

      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; skip?: number }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }

        callCount++;

        if (callCount === 1) {
          // First batch: full page of 500 items triggers another fetch
          return Promise.resolve(
            Array.from({ length: 500 }, (_, i) => ({ id: `FILE-BATCH1-${String(i).padStart(4, '0')}` })),
          );
        }

        // Second batch: fewer than 500 items signals end of pagination
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }]);
      });

      mockGetUniqueFileIds.mockResolvedValue([]);

      const reports = await service.run();

      // findMany called: 1 (distinct users) + 2 (batches) + 9 (failed retriable, stuck, external-not-found, ready images, disconnected-connection, ready-without-chunks, stale-metadata, stuck-deletion, is-shared-misclassification) = 12 times
      expect(mockFilesFindMany).toHaveBeenCalledTimes(12);

      // Report should reflect all 502 DB files (500 + 2)
      expect(reports[0].dbReadyFiles).toBe(502);
    });

    it('stops paginating after the first batch when it returns fewer than 500 items', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Only 3 files — well below batch size
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }, { id: FILE_ID_3 }]);
      });

      mockGetUniqueFileIds.mockResolvedValue([]);

      const reports = await service.run();

      // 1 (distinct users) + 1 (single batch) + 9 (failed retriable, stuck, external-not-found, ready images, disconnected-connection, ready-without-chunks, stale-metadata, stuck-deletion, is-shared-misclassification) = 11 calls
      expect(mockFilesFindMany).toHaveBeenCalledTimes(11);
      expect(reports[0].dbReadyFiles).toBe(3);
    });
  });

  // ==========================================================================
  // run() — per-user isolation
  // ==========================================================================

  describe('run() — per-user isolation', () => {
    it('continues processing remaining users when one user reconciliation throws', async () => {
      // Return two users
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { user_id?: string } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }, { user_id: USER_ID_2 }]);
        }

        // For USER_ID_1, throw an error (simulates search service failure)
        // For USER_ID_2, return normally
        const where = args.where as { user_id?: string } | undefined;
        if (where?.user_id === USER_ID_1) {
          throw new Error('Search service connection refused');
        }

        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      mockGetUniqueFileIds.mockImplementation((userId: string) => {
        if (userId === USER_ID_1) {
          return Promise.reject(new Error('Search service connection refused'));
        }
        return Promise.resolve([FILE_ID_1]);
      });

      const reports = await service.run();

      // Only USER_ID_2 should produce a report (USER_ID_1 failed and was skipped)
      expect(reports).toHaveLength(1);
      expect(reports[0].userId).toBe(USER_ID_2);
    });

    it('returns an empty array when all users fail', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      mockGetUniqueFileIds.mockRejectedValue(new Error('Search index offline'));

      const reports = await service.run();

      expect(reports).toHaveLength(0);
    });

    it('returns an empty array when no users have ready files', async () => {
      mockFilesFindMany.mockResolvedValue([]);

      const reports = await service.run();

      expect(reports).toHaveLength(0);
      // Per-user findMany should never have been called
      expect(mockFilesFindMany).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Report shape
  // ==========================================================================

  describe('report shape', () => {
    it('returns a well-formed ReconciliationReport with all required fields', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }, { id: FILE_ID_2 }]);
      });

      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1]);

      const reports = await service.run();

      expect(reports).toHaveLength(1);
      const report = reports[0];

      expect(report).toMatchObject({
        userId: USER_ID_1,
        dbReadyFiles: 2,
        searchIndexedFiles: 1,
        dryRun: true,
        repairs: { missingRequeued: 0, orphansDeleted: 0, errors: 0 },
      });

      expect(report.timestamp).toBeInstanceOf(Date);
      expect(Array.isArray(report.missingFromSearch)).toBe(true);
      expect(Array.isArray(report.orphanedInSearch)).toBe(true);
    });

    it('normalises file IDs to UPPERCASE in set comparisons', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // DB returns lowercase id
        return Promise.resolve([{ id: FILE_ID_1.toLowerCase() }]);
      });

      // Search returns uppercase id — same file, different case
      mockGetUniqueFileIds.mockResolvedValue([FILE_ID_1.toUpperCase()]);

      const reports = await service.run();

      // Should NOT report drift when only the case differs
      expect(reports[0].missingFromSearch).toHaveLength(0);
      expect(reports[0].orphanedInSearch).toHaveLength(0);
    });
  });

  // ==========================================================================
  // reconcileUserOnDemand() — cooldown and concurrency
  // ==========================================================================

  describe('reconcileUserOnDemand()', () => {
    beforeEach(() => {
      // Return no files so reconciliation completes quickly
      mockFilesFindMany.mockResolvedValue([]);
      mockGetUniqueFileIds.mockResolvedValue([]);
    });

    it('throws ReconciliationCooldownError when cooldown is active', async () => {
      mockRedisTtl.mockResolvedValue(120); // 120 seconds remaining

      await expect(service.reconcileUserOnDemand(USER_ID_1))
        .rejects.toThrow(ReconciliationCooldownError);
    });

    it('sets Redis cooldown after successful reconciliation', async () => {
      mockRedisTtl.mockResolvedValue(-2); // No cooldown

      await service.reconcileUserOnDemand(USER_ID_1);

      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringContaining(USER_ID_1.toUpperCase()),
        '1',
        { EX: 300 },
      );
    });

    it('always repairs regardless of SYNC_RECONCILIATION_AUTO_REPAIR env var', async () => {
      mockEnv.SYNC_RECONCILIATION_AUTO_REPAIR = false;
      mockRedisTtl.mockResolvedValue(-2);

      // Set up a file that needs repair (failed retriable)
      mockFilesFindMany.mockImplementation((args: { where?: { pipeline_status?: unknown } }) => {
        if (args.where?.pipeline_status === 'failed') {
          return Promise.resolve([{ id: FILE_ID_1, name: 'test.pdf', mime_type: 'application/pdf', connection_scope_id: SCOPE_ID }]);
        }
        return Promise.resolve([]);
      });

      const report = await service.reconcileUserOnDemand(USER_ID_1);

      expect(report.dryRun).toBe(false);
      // Should have attempted repair via updateMany
      expect(mockFilesUpdateMany).toHaveBeenCalled();
    });

    it('throws ReconciliationInProgressError when concurrent call for same user', async () => {
      mockRedisTtl.mockResolvedValue(-2);

      // Make reconcileUser take a long time
      mockGetUniqueFileIds.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 100)));

      // Start first call (don't await)
      const first = service.reconcileUserOnDemand(USER_ID_1);

      // Second call should throw immediately
      await expect(service.reconcileUserOnDemand(USER_ID_1))
        .rejects.toThrow(ReconciliationInProgressError);

      // Let first call complete
      await first;
    });

    it('allows reconciliation for different users sequentially', async () => {
      mockRedisTtl.mockResolvedValue(-2);

      const r1 = await service.reconcileUserOnDemand(USER_ID_1);
      // Reset cooldown for second user (different userId so different key)
      const r2 = await service.reconcileUserOnDemand(USER_ID_2);

      expect(r1.userId).toBe(USER_ID_1);
      expect(r2.userId).toBe(USER_ID_2);
    });
  });

  // ==========================================================================
  // Optimistic concurrency — repair skips transitioned files
  // ==========================================================================

  describe('optimistic concurrency', () => {
    beforeEach(() => {
      mockEnv.SYNC_RECONCILIATION_AUTO_REPAIR = true;
    });

    it('skips enqueue when updateMany returns count=0 (file already transitioned)', async () => {
      mockFilesFindMany.mockImplementation((args: { distinct?: string[]; where?: { pipeline_status?: unknown; deletion_status?: unknown } }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        // Return empty for stuck-deletion detector query
        if (args.where?.deletion_status === 'pending') {
          return Promise.resolve([]);
        }
        // Return empty for failed/stuck queries — only test missing-from-search optimistic concurrency
        if (args.where?.pipeline_status === 'failed' || (args.where?.pipeline_status as { in?: string[] })?.in) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: FILE_ID_1 }]);
      });

      // FILE_ID_1 is missing from search
      mockGetUniqueFileIds.mockResolvedValue([]);
      mockFilesFindUnique.mockResolvedValue(makeFileRecord(FILE_ID_1));

      // updateMany returns 0 = file already transitioned away from 'ready'
      mockFilesUpdateMany.mockResolvedValue({ count: 0 });

      const reports = await service.run();

      // Should NOT enqueue since updateMany didn't update anything
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
      expect(reports[0].repairs.missingRequeued).toBe(0);
      expect(reports[0].repairs.errors).toBe(0);
    });
  });

  // ==========================================================================
  // run() — skips users with in-progress on-demand reconciliation
  // ==========================================================================

  describe('run() — cron vs on-demand coexistence', () => {
    it('skips user gracefully when on-demand reconciliation is active', async () => {
      mockRedisTtl.mockResolvedValue(-2);

      // Use a deferred promise to keep the on-demand call active until we're done
      let resolveSearch!: (value: string[]) => void;
      const searchPromise = new Promise<string[]>((resolve) => { resolveSearch = resolve; });

      mockFilesFindMany.mockImplementation((args: { distinct?: string[] }) => {
        if (args.distinct) {
          return Promise.resolve([{ user_id: USER_ID_1 }]);
        }
        return Promise.resolve([]);
      });
      mockGetUniqueFileIds.mockReturnValue(searchPromise);

      // Start on-demand (don't await — keeps lock held)
      const onDemand = service.reconcileUserOnDemand(USER_ID_1);

      // Allow microtasks to process so on-demand acquires the lock
      await new Promise((r) => setTimeout(r, 10));

      // Cron run should skip USER_ID_1 (lock held by on-demand)
      const reports = await service.run();
      expect(reports).toHaveLength(0);

      // Release the on-demand call
      resolveSearch([]);
      await onDemand;
    });
  });
});
