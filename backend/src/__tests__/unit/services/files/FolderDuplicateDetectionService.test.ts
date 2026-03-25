/**
 * FolderDuplicateDetectionService Unit Tests
 *
 * Tests root-level folder duplicate detection against existing folders
 * in the target location.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FolderDuplicateDetectionService,
  getFolderDuplicateDetectionService,
  __resetFolderDuplicateDetectionService,
} from '@/services/files/FolderDuplicateDetectionService';
import type { FolderDuplicateCheckInput } from '@bc-agent/shared';

// Mock Prisma client
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findMany: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { prisma } from '@/infrastructure/database/prisma';

const mockFindMany = vi.mocked(prisma.files.findMany);

const TEST_USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
const TEST_FOLDER_ID = 'FOLD-11111111-2222-3333-4444-555555555555';
const TEST_TARGET_FOLDER_ID = 'FOLD-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

describe('FolderDuplicateDetectionService', () => {
  let service: FolderDuplicateDetectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetFolderDuplicateDetectionService();
    service = new FolderDuplicateDetectionService();
  });

  describe('checkFolderDuplicates', () => {
    // Test 1: Empty input
    it('should return empty results for empty input', async () => {
      const result = await service.checkFolderDuplicates([], TEST_USER_ID);

      expect(result.results).toEqual([]);
      expect(result.targetFolderPath).toBeNull();

      // No DB calls when input is empty
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    // Test 2: No match — no duplicates found
    it('should return no duplicates when no existing folders match', async () => {
      mockFindMany
        .mockResolvedValueOnce([]) // findExistingFolders
        .mockResolvedValueOnce([]); // fetchSiblingFolderNames

      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Documents', fileCount: 3 }],
        TEST_USER_ID,
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          tempId: 'temp-1',
          folderName: 'Documents',
          isDuplicate: false,
        }),
      );
      expect(result.targetFolderPath).toBeNull();
    });

    // Test 3: Detect single duplicate at root level
    it('should detect duplicate folders at root level', async () => {
      mockFindMany
        .mockResolvedValueOnce([{ id: TEST_FOLDER_ID, name: 'Documents' }]) // findExistingFolders
        .mockResolvedValueOnce([{ name: 'Documents' }, { name: 'Photos' }]); // fetchSiblingFolderNames

      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Documents', fileCount: 5 }],
        TEST_USER_ID,
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          tempId: 'temp-1',
          folderName: 'Documents',
          isDuplicate: true,
          existingFolderId: TEST_FOLDER_ID,
          suggestedName: 'Documents (1)',
        }),
      );
    });

    // Test 4: Nested folders (parentTempId) are not checked
    it('should not check nested folders (with parentTempId)', async () => {
      mockFindMany
        .mockResolvedValueOnce([]) // findExistingFolders (only root folders checked)
        .mockResolvedValueOnce([]); // fetchSiblingFolderNames

      const result = await service.checkFolderDuplicates(
        [
          { tempId: 'temp-root', folderName: 'Root', fileCount: 0 },
          { tempId: 'temp-nested', folderName: 'Nested', parentTempId: 'temp-root', fileCount: 3 },
        ],
        TEST_USER_ID,
      );

      expect(result.results).toHaveLength(2);
      // Root folder was checked
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          tempId: 'temp-root',
          isDuplicate: false,
        }),
      );
      // Nested folder was NOT checked (always non-duplicate)
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          tempId: 'temp-nested',
          isDuplicate: false,
        }),
      );
    });

    // Test 5: suggestedName accounts for existing "(N)" suffixes
    it('should compute suggestedName accounting for existing "(N)" suffixes', async () => {
      mockFindMany
        .mockResolvedValueOnce([{ id: TEST_FOLDER_ID, name: 'Reports' }]) // findExistingFolders
        .mockResolvedValueOnce([{ name: 'Reports' }, { name: 'Reports (1)' }]); // fetchSiblingFolderNames

      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Reports', fileCount: 2 }],
        TEST_USER_ID,
      );

      expect(result.results[0]?.suggestedName).toBe('Reports (2)');
    });

    // Test 6: Multiple duplicates in one batch
    it('should detect multiple duplicates in a single batch', async () => {
      mockFindMany
        .mockResolvedValueOnce([
          { id: 'FOLD-AAAA', name: 'Docs' },
          { id: 'FOLD-BBBB', name: 'Photos' },
        ]) // findExistingFolders
        .mockResolvedValueOnce([{ name: 'Docs' }, { name: 'Photos' }]); // fetchSiblingFolderNames

      const result = await service.checkFolderDuplicates(
        [
          { tempId: 'temp-1', folderName: 'Docs', fileCount: 3 },
          { tempId: 'temp-2', folderName: 'Photos', fileCount: 5 },
          { tempId: 'temp-3', folderName: 'NewFolder', fileCount: 1 },
        ],
        TEST_USER_ID,
      );

      expect(result.results).toHaveLength(3);
      expect(result.results[0]?.isDuplicate).toBe(true);
      expect(result.results[1]?.isDuplicate).toBe(true);
      expect(result.results[2]?.isDuplicate).toBe(false);
    });

    // Test 7: targetFolderId is passed to query
    it('should check against targetFolderId when provided', async () => {
      mockFindMany
        .mockResolvedValueOnce([]) // findExistingFolders
        .mockResolvedValueOnce([]) // fetchSiblingFolderNames
        .mockResolvedValueOnce([]); // resolveFolderPaths

      await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Test', fileCount: 1 }],
        TEST_USER_ID,
        TEST_TARGET_FOLDER_ID,
      );

      // findExistingFolders should query with parent_folder_id = targetFolderId
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parent_folder_id: TEST_TARGET_FOLDER_ID,
          }),
        }),
      );
    });

    // Test 8: targetFolderPath resolved from targetFolderId
    it('should resolve targetFolderPath when targetFolderId provided', async () => {
      mockFindMany
        .mockResolvedValueOnce([]) // findExistingFolders
        .mockResolvedValueOnce([]) // fetchSiblingFolderNames
        .mockResolvedValueOnce([
          {
            id: TEST_TARGET_FOLDER_ID,
            name: 'Projects',
            parent_folder_id: null,
          },
        ]); // resolveFolderPaths

      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Test', fileCount: 1 }],
        TEST_USER_ID,
        TEST_TARGET_FOLDER_ID,
      );

      expect(result.targetFolderPath).toBe('Projects');
    });

    // Test 9: Only non-root inputs — no DB queries needed for duplicate check
    it('should return only non-root inputs as non-duplicate when no root folders exist', async () => {
      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-nested', folderName: 'Sub', parentTempId: 'temp-root', fileCount: 2 }],
        TEST_USER_ID,
      );

      // No root folders means no DB queries needed for duplicate check
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.isDuplicate).toBe(false);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    // Test 10: user_id is always included in queries
    it('should include user_id in all DB queries', async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Docs', fileCount: 1 }],
        TEST_USER_ID,
      );

      expect(mockFindMany).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i++) {
        const query = mockFindMany.mock.calls[i]?.[0];
        expect(query?.where?.user_id).toBe(TEST_USER_ID);
      }
    });

    // Test 11: deletion_status null is always included in queries
    it('should include deletion_status: null in all DB queries', async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Docs', fileCount: 1 }],
        TEST_USER_ID,
      );

      expect(mockFindMany).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i++) {
        const query = mockFindMany.mock.calls[i]?.[0];
        expect(query?.where?.deletion_status).toBeNull();
      }
    });

    // Test 12: is_folder: true is always included in queries
    it('should include is_folder: true in all DB queries', async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Docs', fileCount: 1 }],
        TEST_USER_ID,
      );

      expect(mockFindMany).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i++) {
        const query = mockFindMany.mock.calls[i]?.[0];
        expect(query?.where?.is_folder).toBe(true);
      }
    });

    // Test 13: deduplicated folder names sent to DB
    it('should deduplicate folder names before querying', async () => {
      mockFindMany
        .mockResolvedValueOnce([]) // findExistingFolders
        .mockResolvedValueOnce([]); // fetchSiblingFolderNames

      await service.checkFolderDuplicates(
        [
          { tempId: 'temp-1', folderName: 'Docs', fileCount: 1 },
          { tempId: 'temp-2', folderName: 'Docs', fileCount: 2 }, // duplicate name
        ],
        TEST_USER_ID,
      );

      const existingFoldersQuery = mockFindMany.mock.calls[0]?.[0];
      const namesInQuery: string[] = existingFoldersQuery?.where?.name?.in ?? [];
      // Verify only one "Docs" is sent to the query
      expect(namesInQuery).toEqual(['Docs']);
    });

    // Test 14: Mixed root and nested folders — nested folders inherit no-duplicate flag
    it('should flag root as duplicate and mark nested as non-duplicate', async () => {
      mockFindMany
        .mockResolvedValueOnce([{ id: TEST_FOLDER_ID, name: 'Root' }]) // findExistingFolders
        .mockResolvedValueOnce([{ name: 'Root' }]); // fetchSiblingFolderNames

      const result = await service.checkFolderDuplicates(
        [
          { tempId: 'temp-root', folderName: 'Root', fileCount: 2 },
          { tempId: 'temp-child', folderName: 'Child', parentTempId: 'temp-root', fileCount: 1 },
        ],
        TEST_USER_ID,
      );

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          tempId: 'temp-root',
          isDuplicate: true,
        }),
      );
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          tempId: 'temp-child',
          isDuplicate: false,
        }),
      );
    });

    // Test 15: non-duplicate has parentFolderId set from targetFolderId
    it('should set parentFolderId to targetFolderId for non-duplicate root folders', async () => {
      mockFindMany
        .mockResolvedValueOnce([]) // findExistingFolders — no match
        .mockResolvedValueOnce([]) // fetchSiblingFolderNames
        .mockResolvedValueOnce([]); // resolveFolderPaths

      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'NewDocs', fileCount: 1 }],
        TEST_USER_ID,
        TEST_TARGET_FOLDER_ID,
      );

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          isDuplicate: false,
          parentFolderId: TEST_TARGET_FOLDER_ID,
        }),
      );
    });

    // Test 16: nested folder path resolution (2 levels)
    it('should resolve nested targetFolderPath (2 levels)', async () => {
      const PARENT_ID = 'FOLD-PARENT00-AAAA-BBBB-CCCC-DDDDDDDDDDDD';
      const CHILD_ID = 'FOLD-CHILD000-AAAA-BBBB-CCCC-DDDDDDDDDDDD';

      mockFindMany
        .mockResolvedValueOnce([]) // findExistingFolders
        .mockResolvedValueOnce([]) // fetchSiblingFolderNames
        // resolveFolderPaths — first fetch: child folder
        .mockResolvedValueOnce([
          { id: CHILD_ID, name: 'Q4', parent_folder_id: PARENT_ID },
        ])
        // second fetch: parent folder
        .mockResolvedValueOnce([
          { id: PARENT_ID, name: 'Projects', parent_folder_id: null },
        ]);

      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Test', fileCount: 1 }],
        TEST_USER_ID,
        CHILD_ID,
      );

      expect(result.targetFolderPath).toBe('Projects / Q4');
    });

    // Test 17: targetFolderPath is null when no targetFolderId provided
    it('should return null targetFolderPath when no targetFolderId provided', async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.checkFolderDuplicates(
        [{ tempId: 'temp-1', folderName: 'Docs', fileCount: 1 }],
        TEST_USER_ID,
      );

      expect(result.targetFolderPath).toBeNull();
      // Only 2 DB calls (no resolveFolderPaths)
      expect(mockFindMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('singleton', () => {
    // Test 18: Singleton returns same instance
    it('should return the same instance from getFolderDuplicateDetectionService', () => {
      const instance1 = getFolderDuplicateDetectionService();
      const instance2 = getFolderDuplicateDetectionService();

      expect(instance1).toBe(instance2);
    });

    // Test 19: Reset clears singleton
    it('should create a new instance after __resetFolderDuplicateDetectionService', () => {
      const instance1 = getFolderDuplicateDetectionService();
      __resetFolderDuplicateDetectionService();
      const instance2 = getFolderDuplicateDetectionService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
