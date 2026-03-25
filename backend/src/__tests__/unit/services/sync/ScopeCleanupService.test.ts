/**
 * ScopeCleanupService Unit Tests (PRD-105)
 *
 * Tests cascading scope removal:
 * - Happy path: files deleted, AI Search cleaned, scope removed
 * - Partial failure: AI Search fails for some files, scope still removed
 * - Guard: throws ScopeCurrentlySyncingError for syncing scope
 * - Empty scope: no files, scope deleted cleanly
 * - Citation unlinking: message_citations.file_id NULLed before file deletion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks (Hoisted — must come before any imports from mocked modules)
// ============================================================================

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/domains/connections', () => ({
  getConnectionRepository: vi.fn(),
}));

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    files: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(),
  },
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import { getConnectionRepository } from '@/domains/connections';
import { prisma } from '@/infrastructure/database/prisma';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import {
  ScopeCleanupService,
  ScopeCurrentlySyncingError,
} from '@/services/sync/ScopeCleanupService';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const SCOPE_ID = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
const FILE_ID_1 = 'FILE-11111111-AAAA-BBBB-CCCC-111122223333';
const FILE_ID_2 = 'FILE-22222222-AAAA-BBBB-CCCC-444455556666';
const FILE_ID_3 = 'FILE-33333333-AAAA-BBBB-CCCC-777788889999';

// ============================================================================
// Shared mock objects (recreated in beforeEach)
// ============================================================================

const mockRepo = {
  findScopeById: vi.fn(),
  findFilesByScopeId: vi.fn(),
  deleteScopeById: vi.fn(),
};

const mockVectorService = {
  deleteChunksForFile: vi.fn(),
};

// ============================================================================
// Helpers
// ============================================================================

function defaultScope(overrides?: Partial<{ sync_status: string; connection_id: string }>) {
  return {
    id: SCOPE_ID,
    connection_id: overrides?.connection_id ?? CONNECTION_ID,
    sync_status: overrides?.sync_status ?? 'idle',
    scope_type: 'root',
    scope_resource_id: null,
    scope_display_name: null,
    scope_path: null,
    last_sync_at: null,
    last_sync_error: null,
    last_sync_cursor: null,
    item_count: 0,
    created_at: new Date(),
  };
}

function makeFile(id: string, name = 'doc.pdf') {
  return { id, name };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  (getConnectionRepository as ReturnType<typeof vi.fn>).mockReturnValue(mockRepo);
  (VectorSearchService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockVectorService);

  // Default: all operations succeed
  mockRepo.findScopeById.mockResolvedValue(defaultScope());
  mockRepo.findFilesByScopeId.mockResolvedValue([]);
  mockRepo.deleteScopeById.mockResolvedValue(undefined);
  (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (prisma.files.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
  mockVectorService.deleteChunksForFile.mockResolvedValue(undefined);
});

// ============================================================================
// Tests
// ============================================================================

describe('ScopeCleanupService', () => {
  let service: ScopeCleanupService;

  beforeEach(() => {
    service = new ScopeCleanupService();
  });

  // ==========================================================================
  // Happy path
  // ==========================================================================

  describe('removeScope() — happy path', () => {
    it('returns the correct ScopeRemovalResult with filesDeleted count', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([
        makeFile(FILE_ID_1, 'alpha.pdf'),
        makeFile(FILE_ID_2, 'beta.docx'),
      ]);

      const result = await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(result).toEqual({ scopeId: SCOPE_ID, filesDeleted: 2 });
    });

    it('NULLs message_citations before deleting files', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([makeFile(FILE_ID_1)]);

      const callOrder: string[] = [];
      (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('$executeRaw');
        return Promise.resolve(0);
      });
      (prisma.files.deleteMany as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('deleteMany');
        return Promise.resolve({ count: 1 });
      });

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(callOrder.indexOf('$executeRaw')).toBeLessThan(callOrder.indexOf('deleteMany'));
    });

    it('calls deleteChunksForFile for each file with correct arguments', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([
        makeFile(FILE_ID_1, 'alpha.pdf'),
        makeFile(FILE_ID_2, 'beta.pdf'),
      ]);

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockVectorService.deleteChunksForFile).toHaveBeenCalledTimes(2);
      expect(mockVectorService.deleteChunksForFile).toHaveBeenCalledWith(FILE_ID_1, USER_ID);
      expect(mockVectorService.deleteChunksForFile).toHaveBeenCalledWith(FILE_ID_2, USER_ID);
    });

    it('deletes files from the database using connection_scope_id filter', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([makeFile(FILE_ID_1)]);

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(prisma.files.deleteMany).toHaveBeenCalledWith({
        where: { connection_scope_id: SCOPE_ID },
      });
    });

    it('deletes the scope record after all other operations', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([makeFile(FILE_ID_1)]);

      const callOrder: string[] = [];
      (prisma.files.deleteMany as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('deleteMany');
        return Promise.resolve({ count: 1 });
      });
      mockRepo.deleteScopeById.mockImplementation(() => {
        callOrder.push('deleteScopeById');
        return Promise.resolve(undefined);
      });

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(callOrder.indexOf('deleteMany')).toBeLessThan(callOrder.indexOf('deleteScopeById'));
      expect(mockRepo.deleteScopeById).toHaveBeenCalledWith(SCOPE_ID);
    });

    it('validates scope belongs to the provided connection', async () => {
      mockRepo.findScopeById.mockResolvedValue(defaultScope());

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockRepo.findScopeById).toHaveBeenCalledWith(SCOPE_ID);
    });
  });

  // ==========================================================================
  // Empty scope
  // ==========================================================================

  describe('removeScope() — empty scope (no files)', () => {
    it('skips citation NULL and file deletion when no files exist', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([]);

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.files.deleteMany).not.toHaveBeenCalled();
      expect(mockVectorService.deleteChunksForFile).not.toHaveBeenCalled();
    });

    it('still deletes the scope record when no files exist', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([]);

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(mockRepo.deleteScopeById).toHaveBeenCalledOnce();
      expect(mockRepo.deleteScopeById).toHaveBeenCalledWith(SCOPE_ID);
    });

    it('returns filesDeleted: 0 for empty scope', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([]);

      const result = await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(result).toEqual({ scopeId: SCOPE_ID, filesDeleted: 0 });
    });
  });

  // ==========================================================================
  // Guard: syncing scope
  // ==========================================================================

  describe('removeScope() — guard: ScopeCurrentlySyncingError', () => {
    it('throws ScopeCurrentlySyncingError when scope sync_status is "syncing"', async () => {
      mockRepo.findScopeById.mockResolvedValue(defaultScope({ sync_status: 'syncing' }));

      await expect(service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID)).rejects.toThrow(
        ScopeCurrentlySyncingError
      );
    });

    it('ScopeCurrentlySyncingError has code SCOPE_CURRENTLY_SYNCING', async () => {
      mockRepo.findScopeById.mockResolvedValue(defaultScope({ sync_status: 'syncing' }));

      let caughtError: unknown;
      try {
        await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ScopeCurrentlySyncingError);
      expect((caughtError as ScopeCurrentlySyncingError).code).toBe('SCOPE_CURRENTLY_SYNCING');
    });

    it('ScopeCurrentlySyncingError message includes the scopeId', async () => {
      mockRepo.findScopeById.mockResolvedValue(defaultScope({ sync_status: 'syncing' }));

      await expect(service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID)).rejects.toThrow(
        SCOPE_ID
      );
    });

    it('does not perform any cleanup when scope is syncing', async () => {
      mockRepo.findScopeById.mockResolvedValue(defaultScope({ sync_status: 'syncing' }));

      await expect(service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID)).rejects.toThrow(
        ScopeCurrentlySyncingError
      );

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.files.deleteMany).not.toHaveBeenCalled();
      expect(mockVectorService.deleteChunksForFile).not.toHaveBeenCalled();
      expect(mockRepo.deleteScopeById).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Guard: scope not found / wrong connection
  // ==========================================================================

  describe('removeScope() — guard: scope validation', () => {
    it('throws when scope is not found', async () => {
      mockRepo.findScopeById.mockResolvedValue(null);

      await expect(service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID)).rejects.toThrow(
        `Scope ${SCOPE_ID} not found`
      );
    });

    it('throws when scope belongs to a different connection', async () => {
      const OTHER_CONNECTION = 'CONN-99999999-8888-7777-6666-555544443333';
      mockRepo.findScopeById.mockResolvedValue(defaultScope({ connection_id: OTHER_CONNECTION }));

      await expect(service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID)).rejects.toThrow(
        `Scope ${SCOPE_ID} does not belong to connection ${CONNECTION_ID}`
      );
    });

    it('does not perform cleanup when scope belongs to different connection', async () => {
      const OTHER_CONNECTION = 'CONN-99999999-8888-7777-6666-555544443333';
      mockRepo.findScopeById.mockResolvedValue(defaultScope({ connection_id: OTHER_CONNECTION }));

      await expect(service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID)).rejects.toThrow();

      expect(mockRepo.deleteScopeById).not.toHaveBeenCalled();
      expect(prisma.files.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Partial AI Search failure
  // ==========================================================================

  describe('removeScope() — partial AI Search failure', () => {
    it('continues and removes scope even when deleteChunksForFile fails for some files', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([
        makeFile(FILE_ID_1, 'alpha.pdf'),
        makeFile(FILE_ID_2, 'beta.pdf'),
        makeFile(FILE_ID_3, 'gamma.pdf'),
      ]);

      // Second file's AI Search cleanup fails
      mockVectorService.deleteChunksForFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('AI Search unavailable'))
        .mockResolvedValueOnce(undefined);

      const result = await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      // Scope still deleted
      expect(mockRepo.deleteScopeById).toHaveBeenCalledWith(SCOPE_ID);
      // Files still deleted
      expect(prisma.files.deleteMany).toHaveBeenCalledWith({
        where: { connection_scope_id: SCOPE_ID },
      });
      // Result still reports correct count
      expect(result).toEqual({ scopeId: SCOPE_ID, filesDeleted: 3 });
    });

    it('attempts AI Search cleanup for all files even when earlier ones fail', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([
        makeFile(FILE_ID_1, 'alpha.pdf'),
        makeFile(FILE_ID_2, 'beta.pdf'),
        makeFile(FILE_ID_3, 'gamma.pdf'),
      ]);

      mockVectorService.deleteChunksForFile
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(undefined);

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      // All three files attempted
      expect(mockVectorService.deleteChunksForFile).toHaveBeenCalledTimes(3);
    });

    it('resolves successfully (does not throw) when all AI Search cleanups fail', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([
        makeFile(FILE_ID_1, 'alpha.pdf'),
        makeFile(FILE_ID_2, 'beta.pdf'),
      ]);

      mockVectorService.deleteChunksForFile.mockRejectedValue(new Error('Search cluster down'));

      await expect(service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID)).resolves.toEqual({
        scopeId: SCOPE_ID,
        filesDeleted: 2,
      });
    });
  });

  // ==========================================================================
  // Citation unlinking
  // ==========================================================================

  describe('removeScope() — citation unlinking', () => {
    it('calls $executeRaw to NULL message_citations.file_id and parent_folder_id when files exist', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([makeFile(FILE_ID_1), makeFile(FILE_ID_2)]);

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      // 2 calls: NULL citations + NULL parent_folder_id (break self-ref FK)
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('does not call $executeRaw when scope has no files', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([]);

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('NULLs citations before AI Search cleanup', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([makeFile(FILE_ID_1)]);

      const callOrder: string[] = [];
      (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('$executeRaw');
        return Promise.resolve(0);
      });
      mockVectorService.deleteChunksForFile.mockImplementation(() => {
        callOrder.push('deleteChunksForFile');
        return Promise.resolve(undefined);
      });

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(callOrder.indexOf('$executeRaw')).toBeLessThan(
        callOrder.indexOf('deleteChunksForFile')
      );
    });
  });

  // ==========================================================================
  // Operation order
  // ==========================================================================

  describe('removeScope() — operation order', () => {
    it('executes all steps in the correct sequence', async () => {
      mockRepo.findFilesByScopeId.mockResolvedValue([makeFile(FILE_ID_1)]);

      const callOrder: string[] = [];

      mockRepo.findScopeById.mockImplementation(() => {
        callOrder.push('findScopeById');
        return Promise.resolve(defaultScope());
      });
      mockRepo.findFilesByScopeId.mockImplementation(() => {
        callOrder.push('findFilesByScopeId');
        return Promise.resolve([makeFile(FILE_ID_1)]);
      });
      (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('$executeRaw');
        return Promise.resolve(0);
      });
      mockVectorService.deleteChunksForFile.mockImplementation(() => {
        callOrder.push('deleteChunksForFile');
        return Promise.resolve(undefined);
      });
      (prisma.files.deleteMany as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('deleteMany');
        return Promise.resolve({ count: 1 });
      });
      mockRepo.deleteScopeById.mockImplementation(() => {
        callOrder.push('deleteScopeById');
        return Promise.resolve(undefined);
      });

      await service.removeScope(CONNECTION_ID, SCOPE_ID, USER_ID);

      expect(callOrder).toEqual([
        'findScopeById',
        'findFilesByScopeId',
        '$executeRaw',          // NULL message_citations.file_id
        'deleteChunksForFile',
        '$executeRaw',          // NULL parent_folder_id (break self-ref FK)
        'deleteMany',
        'deleteScopeById',
      ]);
    });
  });
});
