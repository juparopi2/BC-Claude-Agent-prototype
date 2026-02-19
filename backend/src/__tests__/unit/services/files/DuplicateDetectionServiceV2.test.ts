/**
 * DuplicateDetectionServiceV2 Tests (PRD-02)
 *
 * Tests batch-optimized duplicate detection across 3 scopes (storage, pipeline, upload).
 * Validates match type logic, scope priority, and query safety.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DuplicateDetectionServiceV2,
  getDuplicateDetectionServiceV2,
  __resetDuplicateDetectionServiceV2,
} from '@/services/files/DuplicateDetectionServiceV2';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { DuplicateCheckInputV2 } from '@bc-agent/shared';

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

describe('DuplicateDetectionServiceV2', () => {
  let service: DuplicateDetectionServiceV2;

  const TEST_USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
  const TEST_FILE_ID = 'FILE-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
  const TEST_FOLDER_ID = 'FOLD-11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetDuplicateDetectionServiceV2();
    service = new DuplicateDetectionServiceV2();
  });

  describe('checkDuplicates', () => {
    // Test 1: Empty input
    it('should return empty results and zero summary for empty input', async () => {
      const { results, summary } = await service.checkDuplicates([], TEST_USER_ID);

      expect(results).toEqual([]);
      expect(summary).toEqual({
        totalChecked: 0,
        totalDuplicates: 0,
        byScope: { storage: 0, pipeline: 0, upload: 0 },
        byMatchType: { name: 0, content: 0, name_and_content: 0 },
      });

      // No DB calls when input is empty
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    // Test 2: Storage scope - name match (ready)
    it('should detect duplicate in storage scope with ready status by name+folder', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-001',
          fileName: 'report.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      // Mock responses: storage has match, pipeline and upload empty
      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'report.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]) // pipeline
        .mockResolvedValueOnce([]); // upload

      const { results, summary } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results).toEqual([
        {
          tempId: 'temp-001',
          fileName: 'report.pdf',
          isDuplicate: true,
          scope: 'storage',
          matchType: 'name',
          existingFile: {
            fileId: TEST_FILE_ID,
            fileName: 'report.pdf',
            fileSize: 1024,
            pipelineStatus: PIPELINE_STATUS.READY,
            folderId: null,
          },
          suggestedName: 'report (1).pdf',
        },
      ]);

      expect(summary).toEqual({
        totalChecked: 1,
        totalDuplicates: 1,
        byScope: { storage: 1, pipeline: 0, upload: 0 },
        byMatchType: { name: 1, content: 0, name_and_content: 0 },
      });
    });

    // Test 3: Storage scope - name match (null/legacy)
    it('should detect duplicate in storage scope with null pipeline_status by name+folder', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-002',
          fileName: 'legacy-doc.txt',
          folderId: TEST_FOLDER_ID,
          contentHash: undefined,
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'legacy-doc.txt',
            size_bytes: BigInt(512),
            pipeline_status: null, // Legacy file
            parent_folder_id: TEST_FOLDER_ID,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
        matchType: 'name',
        existingFile: {
          pipelineStatus: null,
        },
      });
    });

    // Test 4: Storage scope - hash match
    it('should detect duplicate in storage scope by content hash only', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-003',
          fileName: 'new-name.pdf',
          folderId: null,
          contentHash: 'abc123def456',
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'old-name.pdf', // Different name
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: 'abc123def456',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
        matchType: 'content',
        existingFile: {
          fileName: 'old-name.pdf',
        },
      });
    });

    // Test 5: Storage scope - name_and_content match
    it('should detect duplicate in storage scope with both name+folder and hash match', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-004',
          fileName: 'report.pdf',
          folderId: TEST_FOLDER_ID,
          contentHash: 'xyz789abc',
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'report.pdf',
            size_bytes: BigInt(4096),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: TEST_FOLDER_ID,
            content_hash: 'xyz789abc',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results, summary } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
        matchType: 'name_and_content',
      });

      expect(summary.byMatchType.name_and_content).toBe(1);
    });

    // Test 6: Storage scope - different folder no name match
    it('should not match by name if folder differs, but match by hash if provided', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-005',
          fileName: 'report.pdf',
          folderId: 'FOLD-DIFFERENT',
          contentHash: 'hash123',
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'report.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: TEST_FOLDER_ID, // Different folder
            content_hash: 'hash123',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      // Should match by content only (not name, since folder differs)
      expect(results[0]).toMatchObject({
        isDuplicate: true,
        matchType: 'content',
      });
    });

    // Test 7: Pipeline scope - match in active statuses
    it('should detect duplicate in pipeline scope with extracting status', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-006',
          fileName: 'processing.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([]) // storage empty
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'processing.pdf',
            size_bytes: BigInt(3072),
            pipeline_status: PIPELINE_STATUS.EXTRACTING,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]);

      const { results, summary } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'pipeline',
        matchType: 'name',
        existingFile: {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        },
      });

      expect(summary.byScope.pipeline).toBe(1);
    });

    // Test 8: Upload scope - match in registered/uploaded
    it('should detect duplicate in upload scope with registered status', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-007',
          fileName: 'upload.pdf',
          folderId: null,
          contentHash: 'uploadhash',
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'upload.pdf',
            size_bytes: BigInt(1536),
            pipeline_status: PIPELINE_STATUS.REGISTERED,
            parent_folder_id: null,
            content_hash: 'uploadhash',
          },
        ]);

      const { results, summary } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'upload',
        matchType: 'name_and_content',
      });

      expect(summary.byScope.upload).toBe(1);
    });

    // Test 9: Priority - storage wins over pipeline
    it('should prioritize storage match over pipeline match', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-008',
          fileName: 'priority.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: 'FILE-STORAGE-001',
            name: 'priority.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'FILE-PIPELINE-001',
            name: 'priority.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.QUEUED,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      // Storage should win
      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
        existingFile: {
          fileId: 'FILE-STORAGE-001',
        },
      });
    });

    // Test 10: Priority - pipeline wins over upload
    it('should prioritize pipeline match over upload match', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-009',
          fileName: 'priority2.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([]) // storage empty
        .mockResolvedValueOnce([
          {
            id: 'FILE-PIPELINE-002',
            name: 'priority2.pdf',
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.CHUNKING,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'FILE-UPLOAD-002',
            name: 'priority2.pdf',
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.UPLOADED,
            parent_folder_id: null,
            content_hash: null,
          },
        ]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      // Pipeline should win
      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'pipeline',
        existingFile: {
          fileId: 'FILE-PIPELINE-002',
        },
      });
    });

    // Test 11: Batch - mixed results
    it('should handle batch with multiple inputs and different results', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-010',
          fileName: 'found-storage.pdf',
          folderId: null,
          contentHash: undefined,
        },
        {
          tempId: 'temp-011',
          fileName: 'found-pipeline.pdf',
          folderId: null,
          contentHash: undefined,
        },
        {
          tempId: 'temp-012',
          fileName: 'not-found.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: 'FILE-001',
            name: 'found-storage.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'FILE-002',
            name: 'found-pipeline.pdf',
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.QUEUED,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]);

      const { results, summary } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results).toHaveLength(3);

      expect(results[0]).toMatchObject({
        tempId: 'temp-010',
        isDuplicate: true,
        scope: 'storage',
      });

      expect(results[1]).toMatchObject({
        tempId: 'temp-011',
        isDuplicate: true,
        scope: 'pipeline',
      });

      expect(results[2]).toMatchObject({
        tempId: 'temp-012',
        isDuplicate: false,
      });

      expect(summary).toEqual({
        totalChecked: 3,
        totalDuplicates: 2,
        byScope: { storage: 1, pipeline: 1, upload: 0 },
        byMatchType: { name: 2, content: 0, name_and_content: 0 },
      });
    });

    // Test 12: Summary - accurate counts
    it('should generate accurate summary counts for all match types and scopes', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-013',
          fileName: 'name-match.pdf',
          folderId: null,
          contentHash: undefined,
        },
        {
          tempId: 'temp-014',
          fileName: 'content-match.pdf',
          folderId: null,
          contentHash: 'hash456',
        },
        {
          tempId: 'temp-015',
          fileName: 'both-match.pdf',
          folderId: null,
          contentHash: 'hash789',
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: 'FILE-001',
            name: 'name-match.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null,
          },
          {
            id: 'FILE-002',
            name: 'different-name.pdf',
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: 'hash456',
          },
          {
            id: 'FILE-003',
            name: 'both-match.pdf',
            size_bytes: BigInt(3072),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: 'hash789',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { summary } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(summary).toEqual({
        totalChecked: 3,
        totalDuplicates: 3,
        byScope: { storage: 3, pipeline: 0, upload: 0 },
        byMatchType: { name: 1, content: 1, name_and_content: 1 },
      });
    });

    // Test 13: No hash inputs
    it('should handle inputs with no content hashes gracefully', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-016',
          fileName: 'no-hash.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'no-hash.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        matchType: 'name',
      });

      // Verify storage query doesn't include content_hash in OR clause
      const storageQuery = mockFindMany.mock.calls[0][0];
      expect(storageQuery.where.AND[0].OR).toHaveLength(1); // Only name, no hash
    });

    // Test 14: Query safety - user_id
    it('should include user_id in all scope queries', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-017',
          fileName: 'test.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany.mockResolvedValue([]);

      await service.checkDuplicates(inputs, TEST_USER_ID);

      // All 3 queries should include user_id
      expect(mockFindMany).toHaveBeenCalledTimes(3);

      for (let i = 0; i < 3; i++) {
        const query = mockFindMany.mock.calls[i][0];
        expect(query.where.user_id).toBe(TEST_USER_ID);
      }
    });

    // Test 15: Query safety - deletion_status null
    it('should include deletion_status: null in all scope queries', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-018',
          fileName: 'test.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany.mockResolvedValue([]);

      await service.checkDuplicates(inputs, TEST_USER_ID);

      // All 3 queries should include deletion_status: null
      for (let i = 0; i < 3; i++) {
        const query = mockFindMany.mock.calls[i][0];
        expect(query.where.deletion_status).toBeNull();
      }
    });

    // Test 16: Query safety - is_folder false
    it('should include is_folder: false in all scope queries', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-019',
          fileName: 'test.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      mockFindMany.mockResolvedValue([]);

      await service.checkDuplicates(inputs, TEST_USER_ID);

      // All 3 queries should include is_folder: false
      for (let i = 0; i < 3; i++) {
        const query = mockFindMany.mock.calls[i][0];
        expect(query.where.is_folder).toBe(false);
      }
    });

    // Test 17: Singleton - get returns same instance
    it('should return the same instance from getDuplicateDetectionServiceV2', () => {
      const instance1 = getDuplicateDetectionServiceV2();
      const instance2 = getDuplicateDetectionServiceV2();

      expect(instance1).toBe(instance2);
    });

    // Test 18: Singleton - __reset clears
    it('should create new instance after __resetDuplicateDetectionServiceV2', () => {
      const instance1 = getDuplicateDetectionServiceV2();
      __resetDuplicateDetectionServiceV2();
      const instance2 = getDuplicateDetectionServiceV2();

      expect(instance1).not.toBe(instance2);
    });

    // Test 19: Hash comparison case-insensitive
    it('should match hashes case-insensitively', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-020',
          fileName: 'case-test.pdf',
          folderId: null,
          contentHash: 'abc123DEF456', // Mixed case
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'case-test.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: 'ABC123def456', // Different case
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        matchType: 'name_and_content', // Both name and hash match
      });
    });

    // Test 20: No match returns isDuplicate false
    it('should return isDuplicate: false when no match in any scope', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-021',
          fileName: 'unique.pdf',
          folderId: null,
          contentHash: 'uniquehash',
        },
      ];

      // All scopes return empty
      mockFindMany.mockResolvedValue([]);

      const { results, summary } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toEqual({
        tempId: 'temp-021',
        fileName: 'unique.pdf',
        isDuplicate: false,
      });

      expect(summary).toEqual({
        totalChecked: 1,
        totalDuplicates: 0,
        byScope: { storage: 0, pipeline: 0, upload: 0 },
        byMatchType: { name: 0, content: 0, name_and_content: 0 },
      });
    });
  });

  describe('suggestedName — literal name behavior', () => {
    // Test 21: Literal name — no suffix stripping
    it('should treat file (1).pdf literally and suggest file (1) (1).pdf, not file (2).pdf', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-literal-1',
          fileName: 'file (1).pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      // storage has "file (1).pdf" in root; pipeline and upload are empty
      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'file (1).pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]) // pipeline
        .mockResolvedValueOnce([]); // upload
      // No targetFolderId → fetchSiblingNames returns empty map (no 4th DB call)

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0].isDuplicate).toBe(true);
      expect(results[0].scope).toBe('storage');
      // generateUniqueFileName treats "file (1)" as the literal base name,
      // so it looks for "file (1) (N).pdf" variants — none exist → returns "file (1) (1).pdf"
      expect(results[0].suggestedName).toBe('file (1) (1).pdf');
    });

    // Test 22: Literal name — no family grouping across siblings
    it('should not group "file (1).pdf" into the "file" family when computing suggestedName', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-literal-2',
          fileName: 'file (1).pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      // The DB query uses "name IN ['file (1).pdf']" — so only that exact name is returned.
      // file.pdf and file (2).pdf are NOT returned even if they exist in storage.
      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'file (1).pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]) // pipeline
        .mockResolvedValueOnce([]); // upload

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0].isDuplicate).toBe(true);
      // namesByFolder for __root__ only contains "file (1).pdf" (from matched DB files).
      // generateUniqueFileName("file (1).pdf", {"file (1).pdf"}) → "file (1) (1).pdf"
      // NOT "file (3).pdf" (which would require treating "(1)" as a family suffix)
      expect(results[0].suggestedName).toBe('file (1) (1).pdf');
    });

    // Test 23: suggestedName increments correctly with siblings (multiple iterations)
    it('should suggest report (2).pdf when report.pdf and report (1).pdf already exist as siblings', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-incr',
          fileName: 'report.pdf',
          folderId: null,
          contentHash: undefined,
        },
      ];

      // storage has "report.pdf" inside TEST_FOLDER_ID (matched by name query);
      // pipeline and upload empty;
      // sibling query (4th call, triggered by targetFolderId) returns both existing names
      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'report.pdf',
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: TEST_FOLDER_ID,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]) // pipeline
        .mockResolvedValueOnce([]) // upload
        .mockResolvedValueOnce([  // fetchSiblingNames → all files in TEST_FOLDER_ID
          { name: 'report.pdf' },
          { name: 'report (1).pdf' },
        ]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID, TEST_FOLDER_ID);

      expect(results[0].isDuplicate).toBe(true);
      expect(results[0].scope).toBe('storage');
      // folderNames = {"report.pdf", "report (1).pdf"} → maxSuffix = 1 → suggests (2)
      expect(results[0].suggestedName).toBe('report (2).pdf');
    });

    // Test 24: suggestedName with targetFolderId — literal name with siblings
    it('should suggest data (1) (1).xlsx (not data (3).xlsx) when data (1).xlsx is the literal input', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-literal-folder',
          fileName: 'data (1).xlsx',
          folderId: null,
          contentHash: undefined,
        },
      ];

      // storage has "data (1).xlsx" inside TEST_FOLDER_ID; sibling query returns all 3 variants
      mockFindMany
        .mockResolvedValueOnce([
          {
            id: TEST_FILE_ID,
            name: 'data (1).xlsx',
            size_bytes: BigInt(4096),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: TEST_FOLDER_ID,
            content_hash: null,
          },
        ])
        .mockResolvedValueOnce([]) // pipeline
        .mockResolvedValueOnce([]) // upload
        .mockResolvedValueOnce([  // fetchSiblingNames → all files in TEST_FOLDER_ID
          { name: 'data.xlsx' },
          { name: 'data (1).xlsx' },
          { name: 'data (2).xlsx' },
        ]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID, TEST_FOLDER_ID);

      expect(results[0].isDuplicate).toBe(true);
      expect(results[0].scope).toBe('storage');
      // baseName = "data (1)", extension = ".xlsx"
      // pattern looks for "data (1) (N).xlsx" — none of the siblings match → maxSuffix = 0
      // returns "data (1) (1).xlsx", NOT "data (3).xlsx"
      expect(results[0].suggestedName).toBe('data (1) (1).xlsx');
    });
  });

  describe('existingFile — name match priority over content-only match', () => {
    // Test 25: When name match and content match exist on DIFFERENT files,
    // existingFile should be the name-matched file (not the content-matched one)
    it('should return name-matched file as existingFile, not content-matched renamed copy', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-priority-1',
          fileName: '20251031_075420.jpg',
          folderId: null,
          contentHash: 'abc123def456',
        },
      ];

      // Storage returns 2 files:
      // - "20251031_075420.jpg" (name match, but content_hash is null — legacy upload)
      // - "20251031_075420 (1).jpg" (content match via hash, different name)
      mockFindMany
        .mockResolvedValueOnce([
          {
            id: 'FILE-ORIGINAL',
            name: '20251031_075420.jpg',
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: null, // Legacy file — no hash stored
          },
          {
            id: 'FILE-RENAMED-COPY',
            name: '20251031_075420 (1).jpg',
            size_bytes: BigInt(2048),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: 'abc123def456', // Same content as upload
          },
        ])
        .mockResolvedValueOnce([]) // pipeline
        .mockResolvedValueOnce([]); // upload

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
        matchType: 'name', // name match wins over content-only
        existingFile: {
          fileId: 'FILE-ORIGINAL', // The same-name file, NOT the renamed copy
          fileName: '20251031_075420.jpg',
        },
      });
    });

    // Test 26: When ONLY content match exists (no name match), content match is used
    it('should fall back to content match when no name match exists', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-priority-2',
          fileName: 'new-name.pdf',
          folderId: null,
          contentHash: 'hash999',
        },
      ];

      // Only content match — different name
      mockFindMany
        .mockResolvedValueOnce([
          {
            id: 'FILE-CONTENT-MATCH',
            name: 'old-name.pdf',
            size_bytes: BigInt(1024),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: 'hash999',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        matchType: 'content', // Content match used as fallback
        existingFile: {
          fileId: 'FILE-CONTENT-MATCH',
          fileName: 'old-name.pdf',
        },
      });
    });

    // Test 27: name_and_content still wins when both match on the SAME file
    it('should return name_and_content when both match on the same file', async () => {
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-priority-3',
          fileName: 'report.pdf',
          folderId: null,
          contentHash: 'hash-both',
        },
      ];

      mockFindMany
        .mockResolvedValueOnce([
          {
            id: 'FILE-BOTH-MATCH',
            name: 'report.pdf',
            size_bytes: BigInt(3072),
            pipeline_status: PIPELINE_STATUS.READY,
            parent_folder_id: null,
            content_hash: 'hash-both',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { results } = await service.checkDuplicates(inputs, TEST_USER_ID);

      expect(results[0]).toMatchObject({
        isDuplicate: true,
        matchType: 'name_and_content',
        existingFile: {
          fileId: 'FILE-BOTH-MATCH',
        },
      });
    });
  });
});
