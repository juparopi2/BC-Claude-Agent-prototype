/**
 * FileRepositoryV2 Tests (PRD-01)
 *
 * Tests Prisma-based unified pipeline_status repository.
 * Validates optimistic concurrency, state machine transitions, and status distribution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileRepositoryV2, __resetFileRepositoryV2 } from '@/services/files/repository/FileRepositoryV2';
import { PIPELINE_STATUS } from '@bc-agent/shared';

// Mock Prisma client
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import { prisma } from '@/infrastructure/database/prisma';

const mockUpdateMany = vi.mocked(prisma.files.updateMany);
const mockFindFirst = vi.mocked(prisma.files.findFirst);
const mockGroupBy = vi.mocked(prisma.files.groupBy);

describe('FileRepositoryV2', () => {
  let repository: FileRepositoryV2;

  const TEST_FILE_ID = 'FILE-12345678-1234-1234-1234-123456789ABC';
  const TEST_USER_ID = 'USER-87654321-4321-4321-4321-CBA987654321';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetFileRepositoryV2();
    repository = new FileRepositoryV2();
  });

  describe('transitionStatus', () => {
    it('returns success when updateMany.count === 1', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      const result = await repository.transitionStatus(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.REGISTERED,
        PIPELINE_STATUS.UPLOADED,
      );

      expect(result).toEqual({
        success: true,
        previousStatus: PIPELINE_STATUS.REGISTERED,
      });

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          id: TEST_FILE_ID,
          user_id: TEST_USER_ID,
          pipeline_status: PIPELINE_STATUS.REGISTERED,
          deletion_status: null,
        },
        data: {
          pipeline_status: PIPELINE_STATUS.UPLOADED,
          updated_at: expect.any(Date),
        },
      });
    });

    it('returns concurrent modification error when updateMany.count === 0 and file exists with different status', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({
        pipeline_status: PIPELINE_STATUS.EXTRACTING,
        deletion_status: null,
      });

      const result = await repository.transitionStatus(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.EXTRACTING,
      );

      expect(result).toEqual({
        success: false,
        previousStatus: PIPELINE_STATUS.EXTRACTING,
        error: "Concurrent modification: expected 'queued', found 'extracting'",
      });

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { id: TEST_FILE_ID, user_id: TEST_USER_ID },
        select: { pipeline_status: true, deletion_status: true },
      });
    });

    it('returns error for invalid transitions without calling updateMany', async () => {
      const result = await repository.transitionStatus(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.READY,
        PIPELINE_STATUS.REGISTERED,
      );

      expect(result).toEqual({
        success: false,
        previousStatus: PIPELINE_STATUS.READY,
        error: expect.stringContaining('Cannot transition'),
      });

      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('includes user_id and deletion_status: null in WHERE clause', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await repository.transitionStatus(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.EXTRACTING,
      );

      const whereClause = mockUpdateMany.mock.calls[0][0].where;
      expect(whereClause).toMatchObject({
        id: TEST_FILE_ID,
        user_id: TEST_USER_ID,
        deletion_status: null,
      });
    });

    it('returns file not found error when file does not exist', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue(null);

      const result = await repository.transitionStatus(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.EXTRACTING,
      );

      expect(result).toEqual({
        success: false,
        previousStatus: PIPELINE_STATUS.QUEUED,
        error: 'File not found',
      });
    });

    it('returns soft-deleted error when file has deletion_status set', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({
        pipeline_status: PIPELINE_STATUS.QUEUED,
        deletion_status: 'deleting',
      });

      const result = await repository.transitionStatus(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.QUEUED,
        PIPELINE_STATUS.EXTRACTING,
      );

      expect(result).toEqual({
        success: false,
        previousStatus: PIPELINE_STATUS.QUEUED,
        error: 'File is soft-deleted',
      });
    });
  });

  describe('getPipelineStatus', () => {
    it('returns the status when file exists', async () => {
      mockFindFirst.mockResolvedValue({
        pipeline_status: PIPELINE_STATUS.EXTRACTING,
      });

      const result = await repository.getPipelineStatus(TEST_FILE_ID, TEST_USER_ID);

      expect(result).toBe(PIPELINE_STATUS.EXTRACTING);

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { id: TEST_FILE_ID, user_id: TEST_USER_ID, deletion_status: null },
        select: { pipeline_status: true },
      });
    });

    it('returns null when file not found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await repository.getPipelineStatus(TEST_FILE_ID, TEST_USER_ID);

      expect(result).toBeNull();
    });

    it('returns null when pipeline_status is null', async () => {
      mockFindFirst.mockResolvedValue({
        pipeline_status: null,
      });

      const result = await repository.getPipelineStatus(TEST_FILE_ID, TEST_USER_ID);

      expect(result).toBeNull();
    });
  });

  describe('getStatusDistribution', () => {
    it('correctly maps groupBy results to Record with all 8 keys', async () => {
      mockGroupBy.mockResolvedValue([
        { pipeline_status: PIPELINE_STATUS.REGISTERED, _count: { id: 5 } },
        { pipeline_status: PIPELINE_STATUS.UPLOADED, _count: { id: 3 } },
        { pipeline_status: PIPELINE_STATUS.QUEUED, _count: { id: 2 } },
        { pipeline_status: PIPELINE_STATUS.EXTRACTING, _count: { id: 10 } },
        { pipeline_status: PIPELINE_STATUS.READY, _count: { id: 7 } },
      ] as unknown[]);

      const result = await repository.getStatusDistribution();

      expect(result).toEqual({
        [PIPELINE_STATUS.REGISTERED]: 5,
        [PIPELINE_STATUS.UPLOADED]: 3,
        [PIPELINE_STATUS.QUEUED]: 2,
        [PIPELINE_STATUS.EXTRACTING]: 10,
        [PIPELINE_STATUS.CHUNKING]: 0,
        [PIPELINE_STATUS.EMBEDDING]: 0,
        [PIPELINE_STATUS.READY]: 7,
        [PIPELINE_STATUS.FAILED]: 0,
      });
    });

    it('returns all zeros when no files have pipeline_status set', async () => {
      mockGroupBy.mockResolvedValue([]);

      const result = await repository.getStatusDistribution();

      expect(result).toEqual({
        [PIPELINE_STATUS.REGISTERED]: 0,
        [PIPELINE_STATUS.UPLOADED]: 0,
        [PIPELINE_STATUS.QUEUED]: 0,
        [PIPELINE_STATUS.EXTRACTING]: 0,
        [PIPELINE_STATUS.CHUNKING]: 0,
        [PIPELINE_STATUS.EMBEDDING]: 0,
        [PIPELINE_STATUS.READY]: 0,
        [PIPELINE_STATUS.FAILED]: 0,
      });

      expect(mockGroupBy).toHaveBeenCalledWith({
        by: ['pipeline_status'],
        _count: { id: true },
        where: {
          pipeline_status: { not: null },
          deletion_status: null,
        },
      });
    });

    it('handles missing statuses with groups having only some statuses', async () => {
      mockGroupBy.mockResolvedValue([
        { pipeline_status: PIPELINE_STATUS.READY, _count: { id: 15 } },
        { pipeline_status: PIPELINE_STATUS.FAILED, _count: { id: 2 } },
      ] as unknown[]);

      const result = await repository.getStatusDistribution();

      expect(result).toEqual({
        [PIPELINE_STATUS.REGISTERED]: 0,
        [PIPELINE_STATUS.UPLOADED]: 0,
        [PIPELINE_STATUS.QUEUED]: 0,
        [PIPELINE_STATUS.EXTRACTING]: 0,
        [PIPELINE_STATUS.CHUNKING]: 0,
        [PIPELINE_STATUS.EMBEDDING]: 0,
        [PIPELINE_STATUS.READY]: 15,
        [PIPELINE_STATUS.FAILED]: 2,
      });
    });
  });
});
