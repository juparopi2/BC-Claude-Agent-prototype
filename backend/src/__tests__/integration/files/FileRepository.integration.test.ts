/**
 * FileRepository — State Machine Integration Tests (PRD-01)
 *
 * Tests the pipeline_status state machine with atomic CAS transitions,
 * multi-tenant isolation, soft-delete awareness, and recovery operations.
 *
 * Covered operations:
 * - transitionStatus (atomic CAS)
 * - transitionStatusWithRetry (retry counting)
 * - getPipelineStatus
 * - findByStatus
 * - findStuckFiles
 * - findAbandonedFiles
 * - getStatusDistribution
 * - forceStatus (admin recovery)
 *
 * @module __tests__/integration/files/FileRepository
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import { PipelineTestHelper, createPipelineTestHelper } from '../helpers/PipelineTestHelper';
import { FileRepository } from '@/services/files/repository/FileRepository';
import { PIPELINE_STATUS } from '@bc-agent/shared';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  })),
}));

describe('FileRepository — State Machine Integration (PRD-01)', () => {
  setupDatabaseForTests({ skipRedis: true });

  let helper: PipelineTestHelper;
  let repo: FileRepository;
  let testUser: { id: string; email: string };

  beforeEach(async () => {
    helper = createPipelineTestHelper();
    repo = new FileRepository();
    testUser = await helper.createTestUser();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  // ==========================================================================
  // transitionStatus — happy path
  // ==========================================================================

  describe('transitionStatus — happy path', () => {
    it(
      'should complete full pipeline progression: registered → uploaded → queued → extracting → chunking → embedding → ready',
      async () => {
        // Create file at registered
        const file = await helper.createFileWithPipelineStatus(testUser.id, {
          pipelineStatus: PIPELINE_STATUS.REGISTERED,
        });

        // registered → uploaded
        let result = await repo.transitionStatus(
          file.id,
          testUser.id,
          PIPELINE_STATUS.REGISTERED,
          PIPELINE_STATUS.UPLOADED,
        );
        expect(result.success).toBe(true);
        expect(result.previousStatus).toBe(PIPELINE_STATUS.REGISTERED);
        expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.UPLOADED);

        // uploaded → queued
        result = await repo.transitionStatus(
          file.id,
          testUser.id,
          PIPELINE_STATUS.UPLOADED,
          PIPELINE_STATUS.QUEUED,
        );
        expect(result.success).toBe(true);
        expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);

        // queued → extracting
        result = await repo.transitionStatus(
          file.id,
          testUser.id,
          PIPELINE_STATUS.QUEUED,
          PIPELINE_STATUS.EXTRACTING,
        );
        expect(result.success).toBe(true);
        expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.EXTRACTING);

        // extracting → chunking
        result = await repo.transitionStatus(
          file.id,
          testUser.id,
          PIPELINE_STATUS.EXTRACTING,
          PIPELINE_STATUS.CHUNKING,
        );
        expect(result.success).toBe(true);
        expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.CHUNKING);

        // chunking → embedding
        result = await repo.transitionStatus(
          file.id,
          testUser.id,
          PIPELINE_STATUS.CHUNKING,
          PIPELINE_STATUS.EMBEDDING,
        );
        expect(result.success).toBe(true);
        expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.EMBEDDING);

        // embedding → ready
        result = await repo.transitionStatus(
          file.id,
          testUser.id,
          PIPELINE_STATUS.EMBEDDING,
          PIPELINE_STATUS.READY,
        );
        expect(result.success).toBe(true);
        expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.READY);
      },
      15000,
    );

    it('should transition registered → uploaded', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.REGISTERED,
        PIPELINE_STATUS.UPLOADED,
      );

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(PIPELINE_STATUS.REGISTERED);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.UPLOADED);
    });

    it('should transition uploaded → queued', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.UPLOADED,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.UPLOADED,
        PIPELINE_STATUS.QUEUED,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });

    it('should transition queued → extracting', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.EXTRACTING,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.EXTRACTING);
    });

    it('should transition extracting → chunking', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.EXTRACTING,
        PIPELINE_STATUS.CHUNKING,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.CHUNKING);
    });

    it('should transition chunking → embedding', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.CHUNKING,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.CHUNKING,
        PIPELINE_STATUS.EMBEDDING,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.EMBEDDING);
    });

    it('should transition embedding → ready', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EMBEDDING,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.READY,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.READY);
    });

    it('should transition any state → failed (test with extracting → failed)', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.EXTRACTING,
        PIPELINE_STATUS.FAILED,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.FAILED);
    });

    it('should transition failed → queued (manual retry)', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.FAILED,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.QUEUED,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });
  });

  // ==========================================================================
  // transitionStatus — CAS atomicity
  // ==========================================================================

  describe('transitionStatus — CAS atomicity', () => {
    it('should reject when current status does not match expected "from"', async () => {
      // Create file at 'queued'
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Attempt transition 'extracting' → 'chunking' (current status is actually 'queued')
      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.EXTRACTING, // Wrong current status
        PIPELINE_STATUS.CHUNKING,
      );

      expect(result.success).toBe(false);
      expect(result.previousStatus).toBe(PIPELINE_STATUS.QUEUED);
      expect(result.error).toContain('Concurrent modification');
      // Verify DB status unchanged
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });

    it(
      'should handle two concurrent transitions — exactly one succeeds',
      async () => {
        // Create file at 'queued'
        const file = await helper.createFileWithPipelineStatus(testUser.id, {
          pipelineStatus: PIPELINE_STATUS.QUEUED,
        });

        // Attempt two simultaneous transitions: queued → extracting
        const results = await Promise.allSettled([
          repo.transitionStatus(
            file.id,
            testUser.id,
            PIPELINE_STATUS.QUEUED,
            PIPELINE_STATUS.EXTRACTING,
          ),
          repo.transitionStatus(
            file.id,
            testUser.id,
            PIPELINE_STATUS.QUEUED,
            PIPELINE_STATUS.EXTRACTING,
          ),
        ]);

        // Both promises should fulfill (not reject)
        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('fulfilled');

        // Extract the TransitionResult values
        const result1 = results[0].status === 'fulfilled' ? results[0].value : null;
        const result2 = results[1].status === 'fulfilled' ? results[1].value : null;

        expect(result1).not.toBeNull();
        expect(result2).not.toBeNull();

        // Exactly one should succeed
        const successCount = [result1?.success, result2?.success].filter(Boolean).length;
        expect(successCount).toBe(1);

        // Final DB status should be 'extracting'
        expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.EXTRACTING);
      },
      15000,
    );
  });

  // ==========================================================================
  // transitionStatus — invalid transitions
  // ==========================================================================

  describe('transitionStatus — invalid transitions', () => {
    it('should reject ready → queued (terminal state)', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.READY,
        PIPELINE_STATUS.QUEUED,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('ready');
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.READY);
    });

    it('should reject extracting → ready (skipping states)', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.EXTRACTING,
        PIPELINE_STATUS.READY,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.EXTRACTING);
    });

    it('should reject queued → registered (backward)', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.REGISTERED,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });

    it('should provide descriptive error messages containing from/to states', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.READY,
        PIPELINE_STATUS.QUEUED,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('ready');
      expect(result.error).toContain('queued');
    });
  });

  // ==========================================================================
  // transitionStatus — recovery
  // ==========================================================================

  describe('transitionStatus — recovery', () => {
    it('should allow failed → queued', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.FAILED,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.QUEUED,
      );

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });

    it('should reject failed → extracting (only queued is valid from failed)', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.FAILED,
      });

      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.EXTRACTING,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.FAILED);
    });
  });

  // ==========================================================================
  // transitionStatus — multi-tenant isolation
  // ==========================================================================

  describe('transitionStatus — multi-tenant isolation', () => {
    it('should reject transition when userId does not match owner', async () => {
      // Create 2 users
      const user1 = await helper.createTestUser();
      const user2 = await helper.createTestUser();

      // Create file owned by user1
      const file = await helper.createFileWithPipelineStatus(user1.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Attempt transition with user2's id
      const result = await repo.transitionStatus(
        file.id,
        user2.id, // Wrong user
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.EXTRACTING,
      );

      expect(result.success).toBe(false);
      // Status should remain unchanged
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });
  });

  // ==========================================================================
  // transitionStatus — soft-delete awareness
  // ==========================================================================

  describe('transitionStatus — soft-delete awareness', () => {
    it('should reject transition for file with deletion_status="pending"', async () => {
      // Create file with deletion_status='pending'
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
        deletionStatus: 'pending',
      });

      // Attempt transition
      const result = await repo.transitionStatus(
        file.id,
        testUser.id,
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.EXTRACTING,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('soft-deleted');
    });
  });

  // ==========================================================================
  // transitionStatusWithRetry
  // ==========================================================================

  describe('transitionStatusWithRetry', () => {
    it('should increment pipeline_retry_count atomically', async () => {
      // Create file at 'failed' with pipeline_retry_count=0
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.FAILED,
        pipelineRetryCount: 0,
      });

      // Do failed→queued with retry
      const result = await repo.transitionStatusWithRetry(
        file.id,
        testUser.id,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.QUEUED,
        1, // retryIncrement
      );

      expect(result.success).toBe(true);

      // Read file from DB, verify pipeline_retry_count=1
      const fileData = await helper.getFile(file.id);
      expect(fileData).not.toBeNull();
      expect(fileData?.pipeline_retry_count).toBe(1);
      expect(fileData?.pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
    });

    it('should increment retry count by custom amount', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.FAILED,
        pipelineRetryCount: 2,
      });

      const result = await repo.transitionStatusWithRetry(
        file.id,
        testUser.id,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.QUEUED,
        3, // retryIncrement
      );

      expect(result.success).toBe(true);

      const fileData = await helper.getFile(file.id);
      expect(fileData?.pipeline_retry_count).toBe(5); // 2 + 3
    });
  });

  // ==========================================================================
  // findStuckFiles
  // ==========================================================================

  describe('findStuckFiles', () => {
    it(
      'should find extracting file older than threshold and skip fresh files and terminal states',
      async () => {
        // Create 3 files:
        // 1. extracting with updated_at=20min ago
        const oldExtractingFile = await helper.createFileWithPipelineStatus(testUser.id, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        });
        await helper.setFileUpdatedAt(oldExtractingFile.id, new Date(Date.now() - 20 * 60 * 1000));

        // 2. extracting just now
        const freshExtractingFile = await helper.createFileWithPipelineStatus(testUser.id, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        });

        // 3. ready with updated_at=20min ago (terminal state)
        const oldReadyFile = await helper.createFileWithPipelineStatus(testUser.id, {
          pipelineStatus: PIPELINE_STATUS.READY,
        });
        await helper.setFileUpdatedAt(oldReadyFile.id, new Date(Date.now() - 20 * 60 * 1000));

        // Call findStuckFiles(15 minutes) scoped to testUser to avoid stale data from other runs
        const stuckFiles = await repo.findStuckFiles(15 * 60 * 1000, testUser.id);

        // Expect only the old extracting file returned
        expect(stuckFiles).toHaveLength(1);
        expect(stuckFiles[0].id.toUpperCase()).toBe(oldExtractingFile.id);
        expect(stuckFiles[0].pipeline_status).toBe(PIPELINE_STATUS.EXTRACTING);
      },
      15000,
    );

    it('should respect userId filter', async () => {
      const user1 = await helper.createTestUser();
      const user2 = await helper.createTestUser();

      // Create file for user1 extracting and old
      const file1 = await helper.createFileWithPipelineStatus(user1.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });
      await helper.setFileUpdatedAt(file1.id, new Date(Date.now() - 20 * 60 * 1000));

      // Create file for user2 extracting and old
      const file2 = await helper.createFileWithPipelineStatus(user2.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });
      await helper.setFileUpdatedAt(file2.id, new Date(Date.now() - 20 * 60 * 1000));

      // findStuckFiles with userId=user1
      const stuckFiles = await repo.findStuckFiles(15 * 60 * 1000, user1.id);

      // Only user1's file should be returned
      expect(stuckFiles).toHaveLength(1);
      expect(stuckFiles[0].id.toUpperCase()).toBe(file1.id);
      expect(stuckFiles[0].user_id.toUpperCase()).toBe(user1.id);
    });

    it('should find files in multiple active states', async () => {
      // Create old files in various active states
      const queuedFile = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });
      await helper.setFileUpdatedAt(queuedFile.id, new Date(Date.now() - 20 * 60 * 1000));

      const chunkingFile = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.CHUNKING,
      });
      await helper.setFileUpdatedAt(chunkingFile.id, new Date(Date.now() - 20 * 60 * 1000));

      const embeddingFile = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EMBEDDING,
      });
      await helper.setFileUpdatedAt(embeddingFile.id, new Date(Date.now() - 20 * 60 * 1000));

      const stuckFiles = await repo.findStuckFiles(15 * 60 * 1000);

      // Should find all 3 active state files
      expect(stuckFiles.length).toBeGreaterThanOrEqual(3);
      const fileIds = stuckFiles.map((f) => f.id.toUpperCase());
      expect(fileIds).toContain(queuedFile.id);
      expect(fileIds).toContain(chunkingFile.id);
      expect(fileIds).toContain(embeddingFile.id);
    });
  });

  // ==========================================================================
  // findAbandonedFiles
  // ==========================================================================

  describe('findAbandonedFiles', () => {
    it('should find files stuck in registered status beyond threshold', async () => {
      // Create old registered file
      const oldFile = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });
      await helper.setFileCreatedAt(oldFile.id, new Date(Date.now() - 20 * 60 * 1000));

      // Create fresh registered file
      const freshFile = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });

      // Find abandoned files (15 minute threshold)
      const abandonedFiles = await repo.findAbandonedFiles(15 * 60 * 1000);

      // Should only find the old file
      expect(abandonedFiles.length).toBeGreaterThanOrEqual(1);
      const fileIds = abandonedFiles.map((f) => f.id.toUpperCase());
      expect(fileIds).toContain(oldFile.id);
      expect(fileIds).not.toContain(freshFile.id);
    });

    it('should respect userId filter', async () => {
      const user1 = await helper.createTestUser();
      const user2 = await helper.createTestUser();

      // Create old registered file for user1
      const file1 = await helper.createFileWithPipelineStatus(user1.id, {
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });
      await helper.setFileCreatedAt(file1.id, new Date(Date.now() - 20 * 60 * 1000));

      // Create old registered file for user2
      const file2 = await helper.createFileWithPipelineStatus(user2.id, {
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });
      await helper.setFileCreatedAt(file2.id, new Date(Date.now() - 20 * 60 * 1000));

      // Find abandoned files for user1 only
      const abandonedFiles = await repo.findAbandonedFiles(15 * 60 * 1000, user1.id);

      // Should only find user1's file
      expect(abandonedFiles.some((f) => f.id.toUpperCase() === file1.id)).toBe(true);
      expect(abandonedFiles.every((f) => f.user_id.toUpperCase() === user1.id)).toBe(true);
    });
  });

  // ==========================================================================
  // getStatusDistribution
  // ==========================================================================

  describe('getStatusDistribution', () => {
    it('should return correct counts grouped by pipeline_status', async () => {
      // Create 3 files: 2 registered, 1 queued for testUser
      await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });
      await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.REGISTERED,
      });
      await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Call getStatusDistribution() (note: this is global, not per-user)
      const distribution = await repo.getStatusDistribution();

      // Verify registered >= 2 and queued >= 1
      expect(distribution.registered).toBeGreaterThanOrEqual(2);
      expect(distribution.queued).toBeGreaterThanOrEqual(1);

      // Verify all pipeline statuses are present in the result
      expect(distribution).toHaveProperty('registered');
      expect(distribution).toHaveProperty('uploaded');
      expect(distribution).toHaveProperty('queued');
      expect(distribution).toHaveProperty('extracting');
      expect(distribution).toHaveProperty('chunking');
      expect(distribution).toHaveProperty('embedding');
      expect(distribution).toHaveProperty('ready');
      expect(distribution).toHaveProperty('failed');
    });

    it('should return 0 for statuses with no files', async () => {
      const distribution = await repo.getStatusDistribution();

      // All counts should be non-negative
      Object.values(distribution).forEach((count) => {
        expect(count).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ==========================================================================
  // getPipelineStatus
  // ==========================================================================

  describe('getPipelineStatus', () => {
    it('should return current pipeline_status for a file', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      const status = await repo.getPipelineStatus(file.id, testUser.id);

      expect(status).toBe(PIPELINE_STATUS.EXTRACTING);
    });

    it('should return null for non-existent file', async () => {
      const fakeId = 'AAAAAAAA-0000-4000-8000-000000000000';
      const status = await repo.getPipelineStatus(fakeId, testUser.id);

      expect(status).toBeNull();
    });

    it('should return null for soft-deleted file', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
        deletionStatus: 'pending',
      });

      const status = await repo.getPipelineStatus(file.id, testUser.id);

      expect(status).toBeNull();
    });

    it('should enforce multi-tenant isolation', async () => {
      const user2 = await helper.createTestUser();

      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Attempt to read with wrong userId
      const status = await repo.getPipelineStatus(file.id, user2.id);

      expect(status).toBeNull();
    });
  });

  // ==========================================================================
  // findByStatus
  // ==========================================================================

  describe('findByStatus', () => {
    it('should find files by pipeline_status', async () => {
      // Create 2 files in 'queued' status
      const file1 = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });
      const file2 = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Create 1 file in 'extracting' status (should not be returned)
      await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      const files = await repo.findByStatus(PIPELINE_STATUS.QUEUED);

      // Should find at least the 2 queued files
      expect(files.length).toBeGreaterThanOrEqual(2);
      const fileIds = files.map((f) => f.id.toUpperCase());
      expect(fileIds).toContain(file1.id);
      expect(fileIds).toContain(file2.id);
    });

    it('should respect userId filter', async () => {
      const user1 = await helper.createTestUser();
      const user2 = await helper.createTestUser();

      const file1 = await helper.createFileWithPipelineStatus(user1.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });
      const file2 = await helper.createFileWithPipelineStatus(user2.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      const files = await repo.findByStatus(PIPELINE_STATUS.QUEUED, { userId: user1.id });

      // Should only find user1's file
      expect(files.some((f) => f.id.toUpperCase() === file1.id)).toBe(true);
      expect(files.every((f) => f.user_id.toUpperCase() === user1.id)).toBe(true);
      expect(files.some((f) => f.id.toUpperCase() === file2.id)).toBe(false);
    });

    it('should respect limit option', async () => {
      // Create 3 files in queued status
      await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });
      await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });
      await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      const files = await repo.findByStatus(PIPELINE_STATUS.QUEUED, {
        limit: 1,
        userId: testUser.id,
      });

      // Should return exactly 1 file
      expect(files).toHaveLength(1);
    });
  });

  // ==========================================================================
  // forceStatus
  // ==========================================================================

  describe('forceStatus', () => {
    it('should force file to any status bypassing state machine', async () => {
      // Create file at 'extracting'
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
      });

      // forceStatus to 'failed' (bypasses state machine validation)
      const result = await repo.forceStatus(file.id, testUser.id, PIPELINE_STATUS.FAILED);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify DB says 'failed'
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.FAILED);
    });

    it('should reject for non-existent file', async () => {
      const fakeId = 'BBBBBBBB-0000-4000-8000-000000000000';

      const result = await repo.forceStatus(fakeId, testUser.id, PIPELINE_STATUS.FAILED);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject for soft-deleted file', async () => {
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
        deletionStatus: 'pending',
      });

      const result = await repo.forceStatus(file.id, testUser.id, PIPELINE_STATUS.FAILED);

      expect(result.success).toBe(false);
      expect(result.error).toContain('soft-deleted');
    });

    it('should enforce multi-tenant isolation', async () => {
      const user2 = await helper.createTestUser();

      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Attempt forceStatus with wrong userId
      const result = await repo.forceStatus(file.id, user2.id, PIPELINE_STATUS.FAILED);

      expect(result.success).toBe(false);
      // Status should remain unchanged
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });

    it('should allow transitions not permitted by state machine', async () => {
      // Create file at 'ready' (terminal state)
      const file = await helper.createFileWithPipelineStatus(testUser.id, {
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      // Force transition to 'queued' (not allowed by state machine)
      const result = await repo.forceStatus(file.id, testUser.id, PIPELINE_STATUS.QUEUED);

      expect(result.success).toBe(true);
      expect(await helper.getFileStatus(file.id)).toBe(PIPELINE_STATUS.QUEUED);
    });
  });
});
