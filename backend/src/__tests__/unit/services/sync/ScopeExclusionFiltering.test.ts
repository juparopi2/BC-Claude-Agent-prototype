/**
 * ScopeExclusionFiltering Tests (PRD-112)
 *
 * Tests for exclusion scope filtering in the sync engine.
 *
 * Covers:
 * - ConnectionRepository.findExclusionScopesByConnection — only returns exclude-mode scopes
 * - ConnectionRepository.createScope with scopeMode — passes scope_mode to Prisma; defaults to 'include'
 * - ScopeCleanupService.removeFileByExternalId — happy path, not-found, and vector-failure resilience
 * - Exclusion filtering logic — pure Set-based filtering used in InitialSyncService / DeltaSyncService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks (Hoisted — must come before any imports from mocked modules)
// ============================================================================

const mockScopesFindMany = vi.hoisted(() => vi.fn());
const mockScopesCreate = vi.hoisted(() => vi.fn());
const mockScopesFindUnique = vi.hoisted(() => vi.fn());
const mockFilesFindFirst = vi.hoisted(() => vi.fn());
const mockFilesDelete = vi.hoisted(() => vi.fn());
const mockFileChunksDeleteMany = vi.hoisted(() => vi.fn());
const mockExecuteRaw = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findMany: mockScopesFindMany,
      create: mockScopesCreate,
      findUnique: mockScopesFindUnique,
    },
    files: {
      findFirst: mockFilesFindFirst,
      delete: mockFilesDelete,
    },
    file_chunks: {
      deleteMany: mockFileChunksDeleteMany,
    },
    $executeRaw: mockExecuteRaw,
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockDeleteChunksForFile = vi.hoisted(() => vi.fn());

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      deleteChunksForFile: mockDeleteChunksForFile,
    })),
  },
}));

vi.mock('@/domains/connections', () => ({
  getConnectionRepository: vi.fn(),
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import { ConnectionRepository } from '@/domains/connections/ConnectionRepository';
import { ScopeCleanupService } from '@/services/sync/ScopeCleanupService';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const FILE_ID_1 = 'FILE-11111111-AAAA-BBBB-CCCC-111122223333';
const FILE_ID_2 = 'FILE-22222222-AAAA-BBBB-CCCC-444455556666';
const USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
const now = new Date('2026-01-01T00:00:00Z');

// ============================================================================
// Helpers
// ============================================================================

function makeScopeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    connection_id: CONNECTION_ID,
    scope_type: 'file',
    scope_resource_id: 'file-abc',
    scope_mode: 'exclude',
    scope_display_name: 'test.pdf',
    scope_path: null,
    sync_status: 'idle',
    last_sync_at: null,
    last_sync_error: null,
    last_sync_cursor: null,
    item_count: 0,
    subscription_id: null,
    remote_drive_id: null,
    created_at: now,
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default: all operations succeed
  mockScopesFindMany.mockResolvedValue([]);
  mockScopesCreate.mockResolvedValue({});
  mockScopesFindUnique.mockResolvedValue(null);
  mockFilesFindFirst.mockResolvedValue(null);
  mockFilesDelete.mockResolvedValue({});
  mockFileChunksDeleteMany.mockResolvedValue({ count: 0 });
  mockExecuteRaw.mockResolvedValue(0);
  mockDeleteChunksForFile.mockResolvedValue(undefined);
});

// ============================================================================
// Tests
// ============================================================================

describe('PRD-112: Scope Exclusion Filtering', () => {
  // ==========================================================================
  // ConnectionRepository.findExclusionScopesByConnection
  // ==========================================================================

  describe('ConnectionRepository.findExclusionScopesByConnection', () => {
    it('queries Prisma with scope_mode: exclude filter', async () => {
      mockScopesFindMany.mockResolvedValue([makeScopeRow()]);

      const repo = new ConnectionRepository();
      await repo.findExclusionScopesByConnection(CONNECTION_ID);

      expect(mockScopesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connection_id: CONNECTION_ID, scope_mode: 'exclude' },
        })
      );
    });

    it('returns only exclude-mode scopes', async () => {
      mockScopesFindMany.mockResolvedValue([makeScopeRow()]);

      const repo = new ConnectionRepository();
      const result = await repo.findExclusionScopesByConnection(CONNECTION_ID);

      expect(result).toHaveLength(1);
      expect(result[0]!.scope_mode).toBe('exclude');
    });

    it('returns empty array when no exclusion scopes exist', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      const repo = new ConnectionRepository();
      const result = await repo.findExclusionScopesByConnection(CONNECTION_ID);

      expect(result).toEqual([]);
    });

    it('normalizes returned IDs to UPPERCASE', async () => {
      mockScopesFindMany.mockResolvedValue([
        makeScopeRow({ id: 'scop-lowercase-id', connection_id: 'conn-lowercase-id' }),
      ]);

      const repo = new ConnectionRepository();
      const result = await repo.findExclusionScopesByConnection(CONNECTION_ID);

      expect(result[0]!.id).toBe('SCOP-LOWERCASE-ID');
      expect(result[0]!.connection_id).toBe('CONN-LOWERCASE-ID');
    });
  });

  // ==========================================================================
  // ConnectionRepository.createScope with scopeMode
  // ==========================================================================

  describe('ConnectionRepository.createScope with scopeMode', () => {
    it('passes scope_mode: exclude to Prisma when scopeMode is "exclude"', async () => {
      mockScopesCreate.mockResolvedValue({});

      const repo = new ConnectionRepository();
      await repo.createScope(CONNECTION_ID, {
        scopeType: 'file',
        scopeResourceId: 'file-abc',
        scopeDisplayName: 'test.pdf',
        scopeMode: 'exclude',
      });

      expect(mockScopesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope_mode: 'exclude',
          }),
        })
      );
    });

    it('defaults scope_mode to "include" when scopeMode is not specified', async () => {
      mockScopesCreate.mockResolvedValue({});

      const repo = new ConnectionRepository();
      await repo.createScope(CONNECTION_ID, {
        scopeType: 'folder',
        scopeResourceId: 'folder-abc',
        scopeDisplayName: 'Documents',
      });

      expect(mockScopesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope_mode: 'include',
          }),
        })
      );
    });

    it('passes scope_mode: include explicitly when specified', async () => {
      mockScopesCreate.mockResolvedValue({});

      const repo = new ConnectionRepository();
      await repo.createScope(CONNECTION_ID, {
        scopeType: 'folder',
        scopeResourceId: 'folder-xyz',
        scopeDisplayName: 'Shared Docs',
        scopeMode: 'include',
      });

      expect(mockScopesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope_mode: 'include',
          }),
        })
      );
    });

    it('returns an UPPERCASE UUID for the new scope', async () => {
      mockScopesCreate.mockResolvedValue({});

      const repo = new ConnectionRepository();
      const id = await repo.createScope(CONNECTION_ID, {
        scopeType: 'file',
        scopeResourceId: 'file-001',
        scopeDisplayName: 'report.pdf',
        scopeMode: 'exclude',
      });

      expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    });
  });

  // ==========================================================================
  // ScopeCleanupService.removeFileByExternalId
  // ==========================================================================

  describe('ScopeCleanupService.removeFileByExternalId', () => {
    it('returns filesDeleted: 1 when file exists and all cleanup succeeds', async () => {
      mockFilesFindFirst.mockResolvedValue({ id: FILE_ID_1 });

      const service = new ScopeCleanupService();
      const result = await service.removeFileByExternalId(CONNECTION_ID, 'ext-123', USER_ID);

      expect(result).toEqual({ filesDeleted: 1 });
    });

    it('queries files by connection_id and external_id', async () => {
      mockFilesFindFirst.mockResolvedValue({ id: FILE_ID_1 });

      const service = new ScopeCleanupService();
      await service.removeFileByExternalId(CONNECTION_ID, 'ext-123', USER_ID);

      expect(mockFilesFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connection_id: CONNECTION_ID, external_id: 'ext-123' },
        })
      );
    });

    it('deletes the file record by ID', async () => {
      mockFilesFindFirst.mockResolvedValue({ id: FILE_ID_1 });

      const service = new ScopeCleanupService();
      await service.removeFileByExternalId(CONNECTION_ID, 'ext-123', USER_ID);

      expect(mockFilesDelete).toHaveBeenCalledWith({ where: { id: FILE_ID_1 } });
    });

    it('deletes file_chunks before deleting the file record', async () => {
      mockFilesFindFirst.mockResolvedValue({ id: FILE_ID_1 });

      const callOrder: string[] = [];
      mockFileChunksDeleteMany.mockImplementation(() => {
        callOrder.push('file_chunks.deleteMany');
        return Promise.resolve({ count: 3 });
      });
      mockFilesDelete.mockImplementation(() => {
        callOrder.push('files.delete');
        return Promise.resolve({});
      });

      const service = new ScopeCleanupService();
      await service.removeFileByExternalId(CONNECTION_ID, 'ext-123', USER_ID);

      expect(callOrder.indexOf('file_chunks.deleteMany')).toBeLessThan(
        callOrder.indexOf('files.delete')
      );
    });

    it('NULLs message_citations before deleting the file', async () => {
      mockFilesFindFirst.mockResolvedValue({ id: FILE_ID_1 });

      const callOrder: string[] = [];
      mockExecuteRaw.mockImplementation(() => {
        callOrder.push('$executeRaw');
        return Promise.resolve(0);
      });
      mockFilesDelete.mockImplementation(() => {
        callOrder.push('files.delete');
        return Promise.resolve({});
      });

      const service = new ScopeCleanupService();
      await service.removeFileByExternalId(CONNECTION_ID, 'ext-123', USER_ID);

      expect(callOrder.indexOf('$executeRaw')).toBeLessThan(
        callOrder.indexOf('files.delete')
      );
    });

    it('returns filesDeleted: 0 when file is not found', async () => {
      mockFilesFindFirst.mockResolvedValue(null);

      const service = new ScopeCleanupService();
      const result = await service.removeFileByExternalId(CONNECTION_ID, 'ext-nonexistent', USER_ID);

      expect(result).toEqual({ filesDeleted: 0 });
    });

    it('does not delete anything when file is not found', async () => {
      mockFilesFindFirst.mockResolvedValue(null);

      const service = new ScopeCleanupService();
      await service.removeFileByExternalId(CONNECTION_ID, 'ext-nonexistent', USER_ID);

      expect(mockFilesDelete).not.toHaveBeenCalled();
      expect(mockFileChunksDeleteMany).not.toHaveBeenCalled();
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('continues and returns filesDeleted: 1 when vector cleanup fails', async () => {
      mockFilesFindFirst.mockResolvedValue({ id: FILE_ID_2 });
      mockDeleteChunksForFile.mockRejectedValueOnce(new Error('AI Search unavailable'));

      const service = new ScopeCleanupService();
      const result = await service.removeFileByExternalId(CONNECTION_ID, 'ext-456', USER_ID);

      // Vector failure is non-fatal — file still deleted
      expect(result).toEqual({ filesDeleted: 1 });
      expect(mockFilesDelete).toHaveBeenCalledWith({ where: { id: FILE_ID_2 } });
    });

    it('calls deleteChunksForFile with the correct fileId and userId', async () => {
      mockFilesFindFirst.mockResolvedValue({ id: FILE_ID_1 });

      const service = new ScopeCleanupService();
      await service.removeFileByExternalId(CONNECTION_ID, 'ext-123', USER_ID);

      expect(mockDeleteChunksForFile).toHaveBeenCalledWith(FILE_ID_1, USER_ID);
    });
  });

  // ==========================================================================
  // Exclusion filtering logic (pure Set-based filtering)
  // Simulates what InitialSyncService and DeltaSyncService use internally.
  // ==========================================================================

  describe('Exclusion filtering logic', () => {
    it('filters out file changes whose item.id is in the excluded set', () => {
      const excludedResourceIds = new Set(['file-excluded-1', 'file-excluded-2']);

      const fileChanges = [
        { changeType: 'created', item: { id: 'file-ok-1', name: 'ok1.pdf', isFolder: false } },
        { changeType: 'created', item: { id: 'file-excluded-1', name: 'excluded1.pdf', isFolder: false } },
        { changeType: 'created', item: { id: 'file-ok-2', name: 'ok2.docx', isFolder: false } },
        { changeType: 'created', item: { id: 'file-excluded-2', name: 'excluded2.xlsx', isFolder: false } },
      ];

      const filtered = fileChanges.filter((c) => !excludedResourceIds.has(c.item.id));

      expect(filtered).toHaveLength(2);
      expect(filtered.map((c) => c.item.id)).toEqual(['file-ok-1', 'file-ok-2']);
    });

    it('returns all items unchanged when the exclusion set is empty', () => {
      const excludedResourceIds = new Set<string>();

      const fileChanges = [
        { changeType: 'created', item: { id: 'file-1', name: 'a.pdf', isFolder: false } },
        { changeType: 'created', item: { id: 'file-2', name: 'b.pdf', isFolder: false } },
      ];

      const filtered =
        excludedResourceIds.size > 0
          ? fileChanges.filter((c) => !excludedResourceIds.has(c.item.id))
          : fileChanges;

      expect(filtered).toHaveLength(2);
    });

    it('returns empty array when all items are excluded', () => {
      const excludedResourceIds = new Set(['file-1', 'file-2']);

      const fileChanges = [
        { changeType: 'created', item: { id: 'file-1', name: 'a.pdf', isFolder: false } },
        { changeType: 'created', item: { id: 'file-2', name: 'b.pdf', isFolder: false } },
      ];

      const filtered = fileChanges.filter((c) => !excludedResourceIds.has(c.item.id));

      expect(filtered).toHaveLength(0);
    });

    it('filters folder changes independently from file changes', () => {
      const excludedResourceIds = new Set(['folder-excluded']);

      const folderChanges = [
        { changeType: 'created', item: { id: 'folder-ok', name: 'Docs', isFolder: true } },
        { changeType: 'created', item: { id: 'folder-excluded', name: 'Private', isFolder: true } },
      ];

      const fileChanges = [
        { changeType: 'created', item: { id: 'file-1', name: 'report.pdf', isFolder: false } },
      ];

      const filteredFolders = folderChanges.filter((c) => !excludedResourceIds.has(c.item.id));
      const filteredFiles = fileChanges.filter((c) => !excludedResourceIds.has(c.item.id));

      expect(filteredFolders).toHaveLength(1);
      expect(filteredFolders[0]!.item.id).toBe('folder-ok');
      expect(filteredFiles).toHaveLength(1);
      expect(filteredFiles[0]!.item.id).toBe('file-1');
    });

    it('handles "deleted" changeType entries the same as "created"', () => {
      const excludedResourceIds = new Set(['file-excluded']);

      const changes = [
        { changeType: 'deleted', item: { id: 'file-ok', name: 'keep.pdf', isFolder: false } },
        { changeType: 'deleted', item: { id: 'file-excluded', name: 'skip.pdf', isFolder: false } },
      ];

      const filtered = changes.filter((c) => !excludedResourceIds.has(c.item.id));

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.item.id).toBe('file-ok');
    });
  });
});
