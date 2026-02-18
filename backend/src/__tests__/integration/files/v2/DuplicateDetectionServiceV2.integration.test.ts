import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { setupDatabaseForTests } from '../../helpers';
import { V2PipelineTestHelper, createV2PipelineTestHelper } from '../../helpers/V2PipelineTestHelper';
import { DuplicateDetectionServiceV2 } from '@/services/files/DuplicateDetectionServiceV2';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { DuplicateCheckInputV2 } from '@bc-agent/shared';
import { executeQuery } from '@/infrastructure/database/database';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(),
  })),
}));

describe('DuplicateDetectionServiceV2 — 3-Scope Integration (PRD-02)', () => {
  setupDatabaseForTests({ skipRedis: true });

  let helper: V2PipelineTestHelper;
  let service: DuplicateDetectionServiceV2;
  let testUser: { id: string; email: string };

  beforeEach(async () => {
    helper = createV2PipelineTestHelper();
    service = new DuplicateDetectionServiceV2();
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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

    it('should detect in legacy files (pipeline_status=null)', async () => {
      // Create file first, then set pipeline_status to null via raw SQL
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        name: 'legacy.doc',
        pipelineStatus: PIPELINE_STATUS.READY, // Temporary status
      });

      // Set pipeline_status to null (legacy)
      await executeQuery(
        'UPDATE files SET pipeline_status = NULL WHERE id = @id',
        { id: file.id }
      );

      // Check for duplicate
      const inputs: DuplicateCheckInputV2[] = [
        {
          tempId: 'temp-005',
          fileName: 'legacy.doc',
        },
      ];

      const result = await service.checkDuplicates(inputs, testUser.id);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        tempId: 'temp-005',
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [];

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
      const inputs: DuplicateCheckInputV2[] = [];
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
      const inputs: DuplicateCheckInputV2[] = [
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
});
