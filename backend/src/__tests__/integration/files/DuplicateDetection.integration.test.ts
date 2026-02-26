import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { setupDatabaseForTests } from '../helpers';
import { PipelineTestHelper, createPipelineTestHelper } from '../helpers/PipelineTestHelper';
import { DuplicateDetectionService } from '@/services/files/DuplicateDetectionService';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { DuplicateCheckInput } from '@bc-agent/shared';
import { executeQuery } from '@/infrastructure/database/database';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(),
  })),
}));

describe('DuplicateDetection — 3-Scope Integration (PRD-02)', () => {
  setupDatabaseForTests({ skipRedis: true });

  let helper: PipelineTestHelper;
  let service: DuplicateDetectionService;
  let testUser: { id: string; email: string };

  beforeEach(async () => {
    helper = createPipelineTestHelper();
    service = new DuplicateDetectionService();
    testUser = await helper.createTestUser();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  describe('Storage scope', () => {
    it('should detect by name in ready files', async () => {
      // Create file with status 'ready'
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'report.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      // Check for duplicate
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-001',
          fileName: 'report.pdf',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-001',
        isDuplicate: true,
        scope: 'storage',
        matchType: 'name',
      });
      expect(result.results[0].existingFile).toBeDefined();
      expect(result.results[0].existingFile?.fileName).toBe('report.pdf');
    }, 15000);

    it('should detect by content hash in ready files', async () => {
      const contentHash = 'a'.repeat(64); // 64 hex chars

      // Create file with content hash
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'original.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash,
      });

      // Check for duplicate with different name but same hash
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-002',
          fileName: 'different-name.pdf',
          contentHash,
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-002',
        isDuplicate: true,
        scope: 'storage',
        matchType: 'content',
      });
    }, 15000);

    it('should detect name_and_content match type', async () => {
      const contentHash = 'abc123def456'.repeat(5) + 'abcd'; // 64 chars

      // Create file with both name and content hash
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'data.csv',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash,
      });

      // Check for duplicate with same name AND same hash
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-003',
          fileName: 'data.csv',
          contentHash,
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-003',
        isDuplicate: true,
        scope: 'storage',
        matchType: 'name_and_content',
      });
    }, 15000);

    it('should detect in failed files (storage scope includes failed)', async () => {
      // Create file with status 'failed'
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'test.txt',
        pipelineStatus: PIPELINE_STATUS.FAILED,
      });

      // Check for duplicate
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-004',
          fileName: 'test.txt',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-004',
        isDuplicate: true,
        scope: 'storage',
      });
    }, 15000);

  });

  describe('Pipeline scope', () => {
    it('should detect in extracting/queued/chunking/embedding files', async () => {
      // Create file with status 'extracting'
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'processing.pdf',
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      // Check for duplicate
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-006',
          fileName: 'processing.pdf',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-006',
        isDuplicate: true,
        scope: 'pipeline',
      });
    }, 15000);
  });

  describe('Upload scope', () => {
    it('should detect in registered/uploaded files', async () => {
      // Create file with status 'registered'
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'uploading.pdf',
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });

      // Check for duplicate
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-007',
          fileName: 'uploading.pdf',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-007',
        isDuplicate: true,
        scope: 'upload',
      });
    }, 15000);
  });

  describe('Scope priority', () => {
    it('should prefer storage over pipeline (same name, one ready + one extracting)', async () => {
      // Create file A in storage scope (ready)
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'doc.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      // Create file B in pipeline scope (extracting)
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'doc.pdf',
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      // Check for duplicate - should return storage scope
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-008',
          fileName: 'doc.pdf',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-008',
        isDuplicate: true,
        scope: 'storage', // Not pipeline
      });
    }, 15000);

    it('should prefer pipeline over upload', async () => {
      // Create file in pipeline scope (queued)
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'pipeline-vs-upload.pdf',
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Create file in upload scope (registered)
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'pipeline-vs-upload.pdf',
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });

      // Check for duplicate - should return pipeline scope
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-009',
          fileName: 'pipeline-vs-upload.pdf',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-009',
        isDuplicate: true,
        scope: 'pipeline', // Not upload
      });
    }, 15000);

    it('should return upload only when no storage/pipeline match', async () => {
      // Create file only in upload scope
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'only-upload.pdf',
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });

      // Check for duplicate - should return upload scope
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-010',
          fileName: 'only-upload.pdf',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-010',
        isDuplicate: true,
        scope: 'upload',
      });
    }, 15000);
  });

  describe('Batch operations', () => {
    it('should handle empty input', async () => {
      const inputs: DuplicateCheckInput[] = [];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toEqual([]);
      expect(result.summary.totalChecked).toBe(0);
      expect(result.summary.totalDuplicates).toBe(0);
    }, 15000);

    it('should handle 50 files in single batch', async () => {
      // Create 10 ready files with distinct names
      for (let i = 0; i < 10; i++) {
        await helper.createFileWithPipelineStatus(testUser.id, {
          name: `existing-file-${i}.pdf`,
          pipelineStatus: PIPELINE_STATUS.READY,
        });
      }

      // Check 50 files where 10 match
      const inputs: DuplicateCheckInput[] = [];
      for (let i = 0; i < 50; i++) {
        inputs.push({
          tempId: `temp-batch-${i}`,
          fileName: `existing-file-${i}.pdf`,
        });
      }

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(50);
      expect(result.summary.totalChecked).toBe(50);
      expect(result.summary.totalDuplicates).toBe(10); // Only first 10 match

      // Verify first 10 are duplicates
      for (let i = 0; i < 10; i++) {
        expect(result.results[i].isDuplicate).toBe(true);
      }

      // Verify remaining 40 are not duplicates
      for (let i = 10; i < 50; i++) {
        expect(result.results[i].isDuplicate).toBe(false);
      }
    }, 15000);

    it('should correlate results by tempId', async () => {
      // Create test files
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'file-a.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'file-b.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      // Check 3 files
      const inputs: DuplicateCheckInput[] = [
        { tempId: 'alpha', fileName: 'file-a.pdf' },
        { tempId: 'beta', fileName: 'new-file.pdf' },
        { tempId: 'gamma', fileName: 'file-b.pdf' },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(3);

      // Verify each result tempId matches input
      const resultMap = new Map(result.results.map(r => [r.tempId, r]));
      expect(resultMap.get('alpha')?.isDuplicate).toBe(true);
      expect(resultMap.get('beta')?.isDuplicate).toBe(false);
      expect(resultMap.get('gamma')?.isDuplicate).toBe(true);
    }, 15000);
  });

  describe('Multi-tenant isolation', () => {
    it('should not detect files from other users', async () => {
      // Create another user
      const otherUser = await helper.createTestUser();

      // User1 has file 'secret.pdf'
      await helper.createFileWithPipelineStatus(otherUser.id, {
        name: 'secret.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      // Check as testUser (different user)
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-isolation',
          fileName: 'secret.pdf',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-isolation',
        isDuplicate: false, // Not visible to testUser
      });
    }, 15000);
  });

  describe('Summary statistics', () => {
    it('should have accurate byScope and byMatchType counts', async () => {
      const hash1 = 'a'.repeat(64);
      const hash2 = 'b'.repeat(64);

      // Create files in multiple scopes with various match types
      // Storage scope: name match
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'storage-name.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      // Storage scope: content match
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'storage-content-original.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash: hash1,
      });

      // Storage scope: name_and_content match
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'storage-both.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash: hash2,
      });

      // Pipeline scope: name match
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'pipeline-name.pdf',
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Upload scope: name match
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'upload-name.pdf',
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });

      // Check for duplicates
      const inputs: DuplicateCheckInput[] = [
        { tempId: 't1', fileName: 'storage-name.pdf' },
        { tempId: 't2', fileName: 'storage-content-different.pdf', contentHash: hash1 },
        { tempId: 't3', fileName: 'storage-both.pdf', contentHash: hash2 },
        { tempId: 't4', fileName: 'pipeline-name.pdf' },
        { tempId: 't5', fileName: 'upload-name.pdf' },
        { tempId: 't6', fileName: 'no-match.pdf' }, // Not a duplicate
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.summary.totalChecked).toBe(6);
      expect(result.summary.totalDuplicates).toBe(5);

      // Verify byScope
      expect(result.summary.byScope.storage).toBe(3);
      expect(result.summary.byScope.pipeline).toBe(1);
      expect(result.summary.byScope.upload).toBe(1);

      // Verify byMatchType
      expect(result.summary.byMatchType.name).toBe(3); // storage-name, pipeline-name, upload-name
      expect(result.summary.byMatchType.content).toBe(1); // storage-content
      expect(result.summary.byMatchType.name_and_content).toBe(1); // storage-both
    }, 15000);
  });

  describe('suggestedName — literal name rename behavior', () => {
    it('should suggest (1) suffix for a simple duplicate', async () => {
      // Baseline: uploading 'report.pdf' when one already exists → suggest 'report (1).pdf'
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'report.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      const inputs: DuplicateCheckInput[] = [
        { tempId: 'temp-sn-1', fileName: 'report.pdf' },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results[0].suggestedName).toBe('report (1).pdf');
    }, 15000);

    it('should treat (N) suffix literally — not strip and regroup', async () => {
      // KEY: 'file (1).pdf' is the canonical name stored in DB.
      // When uploading another 'file (1).pdf', the service must NOT strip the '(1)'
      // and regroup it as if 'file.pdf' is the base. Instead, it appends a new suffix
      // to the full name: 'file (1) (1).pdf', NOT 'file (2).pdf'.
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'file (1).pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      const inputs: DuplicateCheckInput[] = [
        { tempId: 'temp-sn-2', fileName: 'file (1).pdf' },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      // Must be literal append, NOT 'file (2).pdf'
      expect(result.results[0].suggestedName).toBe('file (1) (1).pdf');
    }, 15000);

    it('should not group into family — literal name produces literal rename', async () => {
      // 'data (1).xlsx' exists in the same root folder.
      // Without targetFolderId, namesByFolder only has the matched row.
      // generateUniqueFileName treats 'data (1)' literally → 'data (1) (1).xlsx'
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'data (1).xlsx',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      const inputs: DuplicateCheckInput[] = [
        { tempId: 'temp-sn-3', fileName: 'data (1).xlsx' },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
      });
      // Must NOT be 'data (3).xlsx' — that would indicate incorrect family grouping
      expect(result.results[0].suggestedName).toBe('data (1) (1).xlsx');
    }, 15000);

    it('should skip taken slots via targetFolderId sibling scan', async () => {
      // Create a real folder record, then place files inside it.
      // targetFolderId triggers fetchSiblingNames so all names are visible.
      const folder = await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'test-folder-slots',
        pipelineStatus: PIPELINE_STATUS.READY,
      });
      // Hack: mark it as folder via raw SQL (helper hardcodes is_folder=false)
      await executeQuery(
        'UPDATE files SET is_folder = 1, size_bytes = 0 WHERE id = @id',
        { id: folder.id },
      );

      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'report.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        parentFolderId: folder.id,
      });
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'report (1).pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        parentFolderId: folder.id,
      });

      const inputs: DuplicateCheckInput[] = [
        { tempId: 'temp-sn-4', fileName: 'report.pdf' },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id, folder.id);

      // (1) is already taken → next free slot is (2)
      expect(result.results[0].suggestedName).toBe('report (2).pdf');
    }, 15000);

    it('should follow literal rename chains — file (1) (1).pdf already exists', async () => {
      // Create a real folder, then place 'file (1).pdf' + 'file (1) (1).pdf' inside.
      const folder = await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'test-folder-chains',
        pipelineStatus: PIPELINE_STATUS.READY,
      });
      await executeQuery(
        'UPDATE files SET is_folder = 1, size_bytes = 0 WHERE id = @id',
        { id: folder.id },
      );

      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'file (1).pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        parentFolderId: folder.id,
      });
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'file (1) (1).pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        parentFolderId: folder.id,
      });

      const inputs: DuplicateCheckInput[] = [
        { tempId: 'temp-sn-5', fileName: 'file (1).pdf' },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id, folder.id);

      // 'file (1) (1).pdf' is taken → next is 'file (1) (2).pdf'
      expect(result.results[0].suggestedName).toBe('file (1) (2).pdf');
    }, 15000);
  });

  describe('existingFile — name match priority over content-only match', () => {
    // Exact reproduction of the user's scenario:
    // Upload "20251031_075420.jpg" when both the original AND a "(1)" copy exist.
    // The modal must show the original (same-name) as existingFile, not the copy.

    it('should return the same-name file as existingFile, not the content-matched renamed copy', async () => {
      const contentHash = 'deadbeef'.repeat(8); // 64 chars

      // Original file — same name, NO content_hash (legacy upload before hashing)
      const original = await helper.createFileWithPipelineStatus(testUser.id, {
        name: '20251031_075420.jpg',
        pipelineStatus: PIPELINE_STATUS.READY,
        // contentHash intentionally omitted → null in DB
      });

      // Renamed copy — different name, HAS content_hash (created via "Keep Both")
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: '20251031_075420 (1).jpg',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash,
      });

      // User uploads "20251031_075420.jpg" again, frontend computes hash → same as copy
      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-exact-scenario',
          fileName: '20251031_075420.jpg',
          contentHash,
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results[0]).toMatchObject({
        tempId: 'temp-exact-scenario',
        isDuplicate: true,
        scope: 'storage',
        matchType: 'name', // name match must win over content-only
      });
      // existingFile must be the ORIGINAL (same name), NOT the renamed copy
      // Note: Prisma returns lowercase UUIDs from SQL Server; helper returns UPPERCASE
      expect(result.results[0].existingFile?.fileId.toUpperCase()).toBe(original.id.toUpperCase());
      expect(result.results[0].existingFile?.fileName).toBe('20251031_075420.jpg');
      // suggestedName must account for both siblings: (1) is taken → suggests (2)
      expect(result.results[0].suggestedName).toBe('20251031_075420 (2).jpg');
    }, 15000);

    it('should return name_and_content when original has hash AND name matches', async () => {
      const contentHash = 'cafebabe'.repeat(8); // 64 chars

      // Original file — same name AND same content_hash
      const original = await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'photo.png',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash,
      });

      // Copy with different name but same hash
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'photo (1).png',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash,
      });

      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-both-match',
          fileName: 'photo.png',
          contentHash,
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
        matchType: 'name_and_content', // both name + hash match on the SAME file
      });
      expect(result.results[0].existingFile?.fileId.toUpperCase()).toBe(original.id.toUpperCase());
      expect(result.results[0].existingFile?.fileName).toBe('photo.png');
    }, 15000);

    it('should fall back to content match when no name match exists at all', async () => {
      const contentHash = 'aabbccdd'.repeat(8);

      // Only a differently-named file with matching hash
      await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'original-name.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
        contentHash,
      });

      const inputs: DuplicateCheckInput[] = [
        {
          tempId: 'temp-content-only',
          fileName: 'completely-different.pdf',
          contentHash,
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results[0]).toMatchObject({
        isDuplicate: true,
        scope: 'storage',
        matchType: 'content', // Content-only fallback is correct here
      });
      expect(result.results[0].existingFile?.fileName).toBe('original-name.pdf');
    }, 15000);
  });
});
