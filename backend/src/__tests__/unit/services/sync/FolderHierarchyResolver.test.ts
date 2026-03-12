/**
 * FolderHierarchyResolver Unit Tests (PRD-107, PRD-112)
 *
 * Tests the stateless utility functions for building and maintaining
 * the external-to-internal folder ID map used by sync services:
 * - buildFolderMap: seeds the map from existing DB folders
 * - sortFoldersByDepth: orders folder changes parents-first
 * - resolveParentFolderId: looks up internal IDs from the map
 * - ensureScopeRootFolder: creates or seeds the scope root in DB + map
 * - upsertFolder: creates or updates folder records in DB + map
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock Prisma
const mockFilesFindMany = vi.hoisted(() => vi.fn());
const mockFilesFindFirst = vi.hoisted(() => vi.fn());
const mockFilesCreate = vi.hoisted(() => vi.fn());
const mockFilesUpdate = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findMany: mockFilesFindMany,
      findFirst: mockFilesFindFirst,
      create: mockFilesCreate,
      update: mockFilesUpdate,
    },
  },
}));

// Mock crypto for deterministic UUIDs
const mockRandomUUID = vi.hoisted(() => vi.fn());
vi.mock('crypto', () => ({ randomUUID: mockRandomUUID }));

// ============================================================================
// Import functions AFTER mocks
// ============================================================================

import {
  buildFolderMap,
  sortFoldersByDepth,
  resolveParentFolderId,
  ensureScopeRootFolder,
  upsertFolder,
} from '@/services/sync/FolderHierarchyResolver';
import type { FolderIdMap } from '@/services/sync/FolderHierarchyResolver';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import type { DeltaChange } from '@bc-agent/shared';

// ============================================================================
// Test Constants
// ============================================================================

const CONNECTION_ID = 'CONN-1111-2222-3333-444444444444';
const USER_ID = 'USER-AAAA-BBBB-CCCC-DDDDDDDDDDDD';
const SCOPE_ID = 'SCOPE-1111-2222-3333-444444444444';
const GENERATED_UUID = 'GENERATED-UUID-1111-2222-333333333333';

// The source calls randomUUID().toUpperCase() — the mock returns lowercase
// to verify the toUpperCase() call in the production code.
const GENERATED_UUID_LOWER = GENERATED_UUID.toLowerCase();

// ============================================================================
// Helpers
// ============================================================================

function makeFolderChange(
  id: string,
  name: string,
  overrides?: Partial<{ parentId: string | null; parentPath: string | null; webUrl: string; lastModifiedAt: string }>
): DeltaChange {
  return {
    item: {
      id,
      name,
      isFolder: true,
      mimeType: null,
      sizeBytes: 0,
      lastModifiedAt: overrides?.lastModifiedAt ?? '2025-01-01T00:00:00Z',
      webUrl: overrides?.webUrl ?? `https://example.com/${name}`,
      eTag: null,
      parentId: overrides?.parentId ?? null,
      parentPath: overrides?.parentPath ?? null,
      childCount: null,
    },
    changeType: 'created' as const,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('FolderHierarchyResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: writes succeed
    mockFilesCreate.mockResolvedValue({});
    mockFilesUpdate.mockResolvedValue({});

    // Default: randomUUID returns lowercase so we can verify toUpperCase()
    mockRandomUUID.mockReturnValue(GENERATED_UUID_LOWER);
  });

  // ==========================================================================
  // buildFolderMap
  // ==========================================================================

  describe('buildFolderMap()', () => {
    it('returns an empty map when no folders exist in the DB', async () => {
      mockFilesFindMany.mockResolvedValue([]);

      const map = await buildFolderMap(CONNECTION_ID, 'onedrive');

      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
      expect(mockFilesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connection_id: CONNECTION_ID,
            is_folder: true,
            source_type: FILE_SOURCE_TYPE.ONEDRIVE,
          }),
        })
      );
    });

    it('uses SHAREPOINT source_type when provider is sharepoint', async () => {
      mockFilesFindMany.mockResolvedValue([]);

      await buildFolderMap(CONNECTION_ID, 'sharepoint');

      expect(mockFilesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connection_id: CONNECTION_ID,
            is_folder: true,
            source_type: FILE_SOURCE_TYPE.SHAREPOINT,
          }),
        })
      );
    });

    it('maps external_id to internal id for all folders returned by DB', async () => {
      mockFilesFindMany.mockResolvedValue([
        { id: 'INTERNAL-AAA', external_id: 'EXT-001' },
        { id: 'INTERNAL-BBB', external_id: 'EXT-002' },
        { id: 'INTERNAL-CCC', external_id: 'EXT-003' },
      ]);

      const map = await buildFolderMap(CONNECTION_ID, 'onedrive');

      expect(map.size).toBe(3);
      expect(map.get('EXT-001')).toBe('INTERNAL-AAA');
      expect(map.get('EXT-002')).toBe('INTERNAL-BBB');
      expect(map.get('EXT-003')).toBe('INTERNAL-CCC');
    });

    it('skips entries where external_id is null', async () => {
      mockFilesFindMany.mockResolvedValue([
        { id: 'INTERNAL-AAA', external_id: 'EXT-001' },
        { id: 'INTERNAL-BBB', external_id: null },
        { id: 'INTERNAL-CCC', external_id: 'EXT-003' },
      ]);

      const map = await buildFolderMap(CONNECTION_ID, 'onedrive');

      expect(map.size).toBe(2);
      expect(map.has('EXT-001')).toBe(true);
      expect(map.has('EXT-003')).toBe(true);
      // The null entry should not appear in the map
      expect(map.get('INTERNAL-BBB')).toBeUndefined();
    });
  });

  // ==========================================================================
  // sortFoldersByDepth
  // ==========================================================================

  describe('sortFoldersByDepth()', () => {
    it('returns an empty array when given an empty array', () => {
      const result = sortFoldersByDepth([]);
      expect(result).toEqual([]);
    });

    it('returns a single folder unchanged', () => {
      const single = makeFolderChange('F-001', 'Docs', { parentPath: 'root/Docs' });
      const result = sortFoldersByDepth([single]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(single);
    });

    it('sorts multiple folders so shallower parentPaths come first', () => {
      const deep = makeFolderChange('F-DEEP', 'Reports', { parentPath: 'root/Docs/Q1/Reports' });
      const mid = makeFolderChange('F-MID', 'Q1', { parentPath: 'root/Docs/Q1' });
      const shallow = makeFolderChange('F-SHALLOW', 'Docs', { parentPath: 'root/Docs' });

      const result = sortFoldersByDepth([deep, mid, shallow]);

      // Depths: 'root/Docs' → 2 segments, 'root/Docs/Q1' → 3, 'root/Docs/Q1/Reports' → 4
      expect(result[0]).toBe(shallow);
      expect(result[1]).toBe(mid);
      expect(result[2]).toBe(deep);
    });

    it('preserves relative order for folders with the same parentPath depth (stable sort)', () => {
      const a = makeFolderChange('F-A', 'Alpha', { parentPath: 'root/Folder' });
      const b = makeFolderChange('F-B', 'Beta', { parentPath: 'root/Other' });

      // Both have depth 2 — original order must be preserved
      const result = sortFoldersByDepth([a, b]);
      expect(result[0]).toBe(a);
      expect(result[1]).toBe(b);
    });

    it('treats null parentPath as depth -1 so those folders sort first', () => {
      const withPath = makeFolderChange('F-WITH', 'HasPath', { parentPath: 'root' });
      const nullPath = makeFolderChange('F-NULL', 'NoPath', { parentPath: null });

      const result = sortFoldersByDepth([withPath, nullPath]);

      // null → depth -1 < 'root' → depth 1
      expect(result[0]).toBe(nullPath);
      expect(result[1]).toBe(withPath);
    });

    it('does not mutate the original array', () => {
      const original = [
        makeFolderChange('F-DEEP', 'Deep', { parentPath: 'a/b/c' }),
        makeFolderChange('F-SHALLOW', 'Shallow', { parentPath: 'a' }),
      ];
      const originalRef = original[0];

      sortFoldersByDepth(original);

      // First element in original should still be the deep folder
      expect(original[0]).toBe(originalRef);
    });
  });

  // ==========================================================================
  // resolveParentFolderId
  // ==========================================================================

  describe('resolveParentFolderId()', () => {
    it('returns null when parentId is null', () => {
      const map: FolderIdMap = new Map([['EXT-001', 'INTERNAL-AAA']]);
      expect(resolveParentFolderId(null, map)).toBeNull();
    });

    it('returns the internal ID when parentId exists in the map', () => {
      const map: FolderIdMap = new Map([['EXT-001', 'INTERNAL-AAA']]);
      expect(resolveParentFolderId('EXT-001', map)).toBe('INTERNAL-AAA');
    });

    it('returns null when parentId is not found in the map', () => {
      const map: FolderIdMap = new Map([['EXT-001', 'INTERNAL-AAA']]);
      expect(resolveParentFolderId('EXT-UNKNOWN', map)).toBeNull();
    });
  });

  // ==========================================================================
  // ensureScopeRootFolder
  // ==========================================================================

  describe('ensureScopeRootFolder()', () => {
    const baseParams = {
      connectionId: CONNECTION_ID,
      scopeId: SCOPE_ID,
      userId: USER_ID,
      scopeResourceId: 'SCOPE-RES-001',
      scopeDisplayName: 'My Scope Folder',
      microsoftDriveId: 'DRIVE-001',
      provider: 'onedrive',
    };

    it('returns early without any DB call when scopeResourceId is already in the map', async () => {
      const folderMap: FolderIdMap = new Map([['SCOPE-RES-001', 'INTERNAL-EXISTING']]);

      await ensureScopeRootFolder({ ...baseParams, folderMap });

      expect(mockFilesFindFirst).not.toHaveBeenCalled();
      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(folderMap.get('SCOPE-RES-001')).toBe('INTERNAL-EXISTING');
    });

    it('adds existing DB folder to the map without creating a new record', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue({ id: 'DB-EXISTING-FOLDER-ID' });

      await ensureScopeRootFolder({ ...baseParams, folderMap });

      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(folderMap.get('SCOPE-RES-001')).toBe('DB-EXISTING-FOLDER-ID');
    });

    it('creates a new folder record and adds it to the map when not in DB', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue(null);

      await ensureScopeRootFolder({ ...baseParams, folderMap });

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(folderMap.get('SCOPE-RES-001')).toBe(GENERATED_UUID);
    });

    it('creates the folder record with an UPPERCASE UUID', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue(null);

      await ensureScopeRootFolder({ ...baseParams, folderMap });

      const createArg = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      // The mock returns lowercase; the source calls .toUpperCase() — result must be uppercase
      expect(createArg.data.id).toBe(GENERATED_UUID);
      expect(createArg.data.id as string).toMatch(/^[A-Z0-9-]+$/i);
      expect(createArg.data.id).toBe((createArg.data.id as string).toUpperCase());
    });

    it('created record has is_folder=true and source_type=FILE_SOURCE_TYPE.ONEDRIVE', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue(null);

      await ensureScopeRootFolder({ ...baseParams, folderMap });

      const createArg = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(createArg.data.is_folder).toBe(true);
      expect(createArg.data.source_type).toBe(FILE_SOURCE_TYPE.ONEDRIVE);
      expect(createArg.data.pipeline_status).toBe('ready');
      expect(createArg.data.external_id).toBe('SCOPE-RES-001');
      expect(createArg.data.connection_id).toBe(CONNECTION_ID);
      expect(createArg.data.user_id).toBe(USER_ID);
    });
  });

  // ==========================================================================
  // upsertFolder
  // ==========================================================================

  describe('upsertFolder()', () => {
    const baseItem = {
      id: 'EXT-FOLDER-001',
      name: 'Documents',
      isFolder: true,
      mimeType: null,
      sizeBytes: 0,
      lastModifiedAt: '2025-01-01T00:00:00Z',
      webUrl: 'https://example.com/Documents',
      eTag: null,
      parentId: null,
      parentPath: null,
      childCount: null,
    };

    const baseParams = {
      item: baseItem,
      connectionId: CONNECTION_ID,
      scopeId: SCOPE_ID,
      userId: USER_ID,
      microsoftDriveId: 'DRIVE-001',
      provider: 'onedrive',
    };

    it('updates name and parent_folder_id for an existing folder, adds it to folderMap', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue({ id: 'INTERNAL-EXISTING-FOLDER' });

      const result = await upsertFolder({ ...baseParams, folderMap });

      expect(mockFilesUpdate).toHaveBeenCalledTimes(1);
      expect(mockFilesCreate).not.toHaveBeenCalled();

      const updateArg = mockFilesUpdate.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(updateArg.where.id).toBe('INTERNAL-EXISTING-FOLDER');
      expect(updateArg.data.name).toBe('Documents');
      expect(updateArg.data.parent_folder_id).toBeNull();

      expect(folderMap.get('EXT-FOLDER-001')).toBe('INTERNAL-EXISTING-FOLDER');
      expect(result).toBe('INTERNAL-EXISTING-FOLDER');
    });

    it('creates a new folder record and adds it to folderMap when no existing record', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue(null);

      const result = await upsertFolder({ ...baseParams, folderMap });

      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(mockFilesUpdate).not.toHaveBeenCalled();

      expect(folderMap.get('EXT-FOLDER-001')).toBe(GENERATED_UUID);
      expect(result).toBe(GENERATED_UUID);
    });

    it('resolves parent_folder_id from the folderMap using the item parentId', async () => {
      const folderMap: FolderIdMap = new Map([['PARENT-EXT-ID', 'PARENT-INTERNAL-ID']]);
      mockFilesFindFirst.mockResolvedValue(null);

      const itemWithParent = { ...baseItem, parentId: 'PARENT-EXT-ID' };

      await upsertFolder({ ...baseParams, item: itemWithParent, folderMap });

      const createArg = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(createArg.data.parent_folder_id).toBe('PARENT-INTERNAL-ID');
    });

    it('returns the internal UUID for both the existing and new-creation paths', async () => {
      const folderMap1: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValueOnce({ id: 'EXISTING-UUID' });
      const existingResult = await upsertFolder({ ...baseParams, folderMap: folderMap1 });
      expect(existingResult).toBe('EXISTING-UUID');

      const folderMap2: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValueOnce(null);
      const newResult = await upsertFolder({ ...baseParams, folderMap: folderMap2 });
      expect(newResult).toBe(GENERATED_UUID);
    });

    it('new folder record has correct fields: mime_type, size_bytes, source_type, pipeline_status', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue(null);

      await upsertFolder({ ...baseParams, folderMap });

      const createArg = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(createArg.data).toMatchObject({
        mime_type: 'inode/directory',
        is_folder: true,
        source_type: FILE_SOURCE_TYPE.ONEDRIVE,
        pipeline_status: 'ready',
        external_id: 'EXT-FOLDER-001',
        connection_id: CONNECTION_ID,
        connection_scope_id: SCOPE_ID,
        user_id: USER_ID,
        name: 'Documents',
      });
      // size_bytes is BigInt(0) — check it is present and equals 0
      expect(createArg.data.size_bytes).toEqual(BigInt(0));
    });

    it('new folder id is UPPERCASE', async () => {
      const folderMap: FolderIdMap = new Map();
      mockFilesFindFirst.mockResolvedValue(null);

      await upsertFolder({ ...baseParams, folderMap });

      const createArg = mockFilesCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      const id = createArg.data.id as string;
      expect(id).toBe(id.toUpperCase());
    });
  });
});
