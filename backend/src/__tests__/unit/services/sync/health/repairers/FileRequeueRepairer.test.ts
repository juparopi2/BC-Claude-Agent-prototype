/**
 * FileRequeueRepairer Unit Tests (PRD-304 Phase 2 + pipeline-requeue-dedup-fix)
 *
 * Validates:
 *   - permanentlyFailExhaustedFiles(): terminal transition, optimistic concurrency, scope counters
 *   - Requeue methods (requeueStuckFiles, requeueFailedRetriable, requeueMissingFromSearch, etc.):
 *     Remove-Before-Enqueue pattern, verify-after-enqueue, error counting
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

const mockFilesUpdateMany = vi.hoisted(() => vi.fn());
const mockFilesFindUnique = vi.hoisted(() => vi.fn());
const mockExecuteRaw = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      updateMany: mockFilesUpdateMany,
      findUnique: mockFilesFindUnique,
    },
    $executeRaw: mockExecuteRaw,
  },
}));

const mockRemoveExistingPipelineJobs = vi.hoisted(() => vi.fn());
const mockAddFileProcessingFlow = vi.hoisted(() => vi.fn());
const mockVerifyPipelineJobExists = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    removeExistingPipelineJobs: mockRemoveExistingPipelineJobs,
    addFileProcessingFlow: mockAddFileProcessingFlow,
    verifyPipelineJobExists: mockVerifyPipelineJobExists,
  })),
}));

// ============================================================================
// Import AFTER mocks
// ============================================================================

import { FileRequeueRepairer } from '@/services/sync/health/repairers/FileRequeueRepairer';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const FILE_ID_1 = 'FILE-11111111-AAAA-BBBB-CCCC-DDDDEEEE1111';
const FILE_ID_2 = 'FILE-22222222-AAAA-BBBB-CCCC-DDDDEEEE2222';
const FILE_ID_3 = 'FILE-33333333-AAAA-BBBB-CCCC-DDDDEEEE3333';
const SCOPE_ID_1 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const SCOPE_ID_2 = 'SCOP-BBBBBBBB-CCCC-DDDD-EEEE-FFFFFFFFFFFF';

// ============================================================================
// Helpers
// ============================================================================

function makeExhaustedFile(overrides?: {
  id?: string;
  name?: string;
  mime_type?: string;
  connection_scope_id?: string | null;
  pipeline_retry_count?: number;
}) {
  return {
    id: overrides?.id ?? FILE_ID_1,
    name: overrides?.name ?? 'stuck.pdf',
    mime_type: overrides?.mime_type ?? 'application/pdf',
    connection_scope_id:
      overrides !== undefined && 'connection_scope_id' in overrides
        ? overrides.connection_scope_id
        : SCOPE_ID_1,
    pipeline_retry_count: overrides?.pipeline_retry_count ?? 3,
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Default: updateMany returns count=1 (file was updated)
  mockFilesUpdateMany.mockResolvedValue({ count: 1 });
  // Default: raw SQL succeeds
  mockExecuteRaw.mockResolvedValue(undefined);
  // Default: pipeline job operations succeed
  mockRemoveExistingPipelineJobs.mockResolvedValue(undefined);
  mockAddFileProcessingFlow.mockResolvedValue(undefined);
  mockVerifyPipelineJobExists.mockResolvedValue(true);
  // Default: findUnique returns a file
  mockFilesFindUnique.mockResolvedValue(null);
});

// ============================================================================
// Tests
// ============================================================================

describe('FileRequeueRepairer.permanentlyFailExhaustedFiles()', () => {
  it('returns { permanentlyFailed: 0, errors: 0 } for empty input', async () => {
    const repairer = new FileRequeueRepairer();
    const result = await repairer.permanentlyFailExhaustedFiles(USER_ID, []);

    expect(result).toEqual({ permanentlyFailed: 0, errors: 0 });
    expect(mockFilesUpdateMany).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('updates a single exhausted file to failed', async () => {
    const file = makeExhaustedFile({ id: FILE_ID_1, pipeline_retry_count: 3 });
    const repairer = new FileRequeueRepairer();

    const result = await repairer.permanentlyFailExhaustedFiles(USER_ID, [file]);

    expect(result.permanentlyFailed).toBe(1);
    expect(result.errors).toBe(0);

    expect(mockFilesUpdateMany).toHaveBeenCalledOnce();
    const call = mockFilesUpdateMany.mock.calls[0][0];
    expect(call.where.id).toBe(FILE_ID_1);
    expect(call.where.pipeline_status).toEqual({ in: ['queued', 'extracting', 'chunking', 'embedding'] });
    expect(call.where.pipeline_retry_count).toEqual({ gte: 3 });
    expect(call.data.pipeline_status).toBe('failed');
    expect(call.data.last_error).toBe('Permanently failed: max retries exhausted');
    expect(call.data.updated_at).toBeInstanceOf(Date);
  });

  it('skips file when updateMany returns count=0 (optimistic concurrency)', async () => {
    mockFilesUpdateMany.mockResolvedValue({ count: 0 });
    const file = makeExhaustedFile();
    const repairer = new FileRequeueRepairer();

    const result = await repairer.permanentlyFailExhaustedFiles(USER_ID, [file]);

    expect(result.permanentlyFailed).toBe(0);
    expect(result.errors).toBe(0);
    // Scope counter must NOT be incremented when file was not updated
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('increments processing_failed scope counter for each updated file', async () => {
    const file = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: SCOPE_ID_1 });
    const repairer = new FileRequeueRepairer();

    await repairer.permanentlyFailExhaustedFiles(USER_ID, [file]);

    expect(mockExecuteRaw).toHaveBeenCalledOnce();
    const sqlParts = mockExecuteRaw.mock.calls[0][0];
    expect(sqlParts.join('')).toContain('processing_failed = processing_failed +');
  });

  it('aggregates multiple files in the same scope into a single counter update', async () => {
    const file1 = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: SCOPE_ID_1 });
    const file2 = makeExhaustedFile({ id: FILE_ID_2, connection_scope_id: SCOPE_ID_1 });
    const repairer = new FileRequeueRepairer();

    await repairer.permanentlyFailExhaustedFiles(USER_ID, [file1, file2]);

    expect(mockFilesUpdateMany).toHaveBeenCalledTimes(2);
    // Only one scope counter update for SCOPE_ID_1 with count=2
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
    expect(mockExecuteRaw.mock.calls[0][1]).toBe(2);
    expect(mockExecuteRaw.mock.calls[0][2]).toBe(SCOPE_ID_1);
  });

  it('updates counters for multiple distinct scopes independently', async () => {
    const file1 = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: SCOPE_ID_1 });
    const file2 = makeExhaustedFile({ id: FILE_ID_2, connection_scope_id: SCOPE_ID_2 });
    const repairer = new FileRequeueRepairer();

    await repairer.permanentlyFailExhaustedFiles(USER_ID, [file1, file2]);

    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
    const scopeIds = mockExecuteRaw.mock.calls.map((c) => c[2]);
    expect(scopeIds).toContain(SCOPE_ID_1);
    expect(scopeIds).toContain(SCOPE_ID_2);
  });

  it('does not call scope counter update for files with null connection_scope_id', async () => {
    const localFile = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: null });
    const repairer = new FileRequeueRepairer();

    const result = await repairer.permanentlyFailExhaustedFiles(USER_ID, [localFile]);

    expect(result.permanentlyFailed).toBe(1);
    // No scope to update
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('captures per-file errors without aborting remaining files', async () => {
    const file1 = makeExhaustedFile({ id: FILE_ID_1 });
    const file2 = makeExhaustedFile({ id: FILE_ID_2 });
    const file3 = makeExhaustedFile({ id: FILE_ID_3 });

    // file1 throws, file2 and file3 succeed
    mockFilesUpdateMany
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValue({ count: 1 });

    const repairer = new FileRequeueRepairer();
    const result = await repairer.permanentlyFailExhaustedFiles(USER_ID, [file1, file2, file3]);

    expect(result.permanentlyFailed).toBe(2);
    expect(result.errors).toBe(1);
  });

  it('handles pipeline_retry_count > 3 correctly (still exhausted)', async () => {
    const file = makeExhaustedFile({ id: FILE_ID_1, pipeline_retry_count: 10 });
    const repairer = new FileRequeueRepairer();

    const result = await repairer.permanentlyFailExhaustedFiles(USER_ID, [file]);

    expect(result.permanentlyFailed).toBe(1);
    expect(mockFilesUpdateMany.mock.calls[0][0].where.pipeline_retry_count).toEqual({ gte: 3 });
  });
});

// ============================================================================
// Requeue Methods — Remove-Before-Enqueue Pattern
// ============================================================================

function makeStuckFile(overrides?: Partial<{
  id: string;
  name: string;
  mime_type: string;
  connection_scope_id: string | null;
}>) {
  return {
    id: overrides?.id ?? FILE_ID_1,
    name: overrides?.name ?? 'stuck.pdf',
    mime_type: overrides?.mime_type ?? 'application/pdf',
    connection_scope_id: overrides?.connection_scope_id ?? SCOPE_ID_1,
  };
}

describe('FileRequeueRepairer.requeueStuckFiles()', () => {
  it('calls remove → enqueue → verify in correct order for a stuck file', async () => {
    const file = makeStuckFile();
    const repairer = new FileRequeueRepairer();
    const callOrder: string[] = [];

    mockRemoveExistingPipelineJobs.mockImplementation(async () => { callOrder.push('remove'); });
    mockAddFileProcessingFlow.mockImplementation(async () => { callOrder.push('enqueue'); });
    mockVerifyPipelineJobExists.mockImplementation(async () => { callOrder.push('verify'); return true; });

    const result = await repairer.requeueStuckFiles(USER_ID, [file]);

    expect(result.stuckRequeued).toBe(1);
    expect(result.errors).toBe(0);
    expect(callOrder).toEqual(['remove', 'enqueue', 'verify']);
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledWith(FILE_ID_1);
    expect(mockAddFileProcessingFlow).toHaveBeenCalledWith(expect.objectContaining({
      fileId: FILE_ID_1,
      userId: USER_ID,
    }));
    expect(mockVerifyPipelineJobExists).toHaveBeenCalledWith(FILE_ID_1);
  });

  it('counts as error when verify returns false (BullMQ dedup still blocking)', async () => {
    const file = makeStuckFile();
    const repairer = new FileRequeueRepairer();

    mockVerifyPipelineJobExists.mockResolvedValue(false);

    const result = await repairer.requeueStuckFiles(USER_ID, [file]);

    expect(result.stuckRequeued).toBe(0);
    expect(result.errors).toBe(1);
    // remove and enqueue were still called
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledOnce();
    expect(mockAddFileProcessingFlow).toHaveBeenCalledOnce();
  });

  it('skips remove+enqueue+verify when optimistic CAS returns count=0', async () => {
    const file = makeStuckFile();
    const repairer = new FileRequeueRepairer();

    mockFilesUpdateMany.mockResolvedValue({ count: 0 });

    const result = await repairer.requeueStuckFiles(USER_ID, [file]);

    expect(result.stuckRequeued).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockRemoveExistingPipelineJobs).not.toHaveBeenCalled();
    expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
    expect(mockVerifyPipelineJobExists).not.toHaveBeenCalled();
  });

  it('handles multiple files — one verify fails, others succeed', async () => {
    const file1 = makeStuckFile({ id: FILE_ID_1 });
    const file2 = makeStuckFile({ id: FILE_ID_2 });
    const file3 = makeStuckFile({ id: FILE_ID_3, connection_scope_id: SCOPE_ID_2 });
    const repairer = new FileRequeueRepairer();

    mockVerifyPipelineJobExists
      .mockResolvedValueOnce(true)   // file1 succeeds
      .mockResolvedValueOnce(false)  // file2 fails verify
      .mockResolvedValueOnce(true);  // file3 succeeds

    const result = await repairer.requeueStuckFiles(USER_ID, [file1, file2, file3]);

    expect(result.stuckRequeued).toBe(2);
    expect(result.errors).toBe(1);
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledTimes(3);
    expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(3);
  });

  it('catches removeExistingPipelineJobs error and increments errors', async () => {
    const file = makeStuckFile();
    const repairer = new FileRequeueRepairer();

    mockRemoveExistingPipelineJobs.mockRejectedValue(new Error('Redis down'));

    const result = await repairer.requeueStuckFiles(USER_ID, [file]);

    expect(result.stuckRequeued).toBe(0);
    expect(result.errors).toBe(1);
    // enqueue and verify should NOT be called since remove threw
    expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
    expect(mockVerifyPipelineJobExists).not.toHaveBeenCalled();
  });
});

describe('FileRequeueRepairer.requeueFailedRetriable()', () => {
  it('calls remove → enqueue → verify and resets retry count', async () => {
    const file = makeStuckFile();
    const repairer = new FileRequeueRepairer();

    const result = await repairer.requeueFailedRetriable(USER_ID, [file]);

    expect(result.failedRequeued).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledWith(FILE_ID_1);
    expect(mockVerifyPipelineJobExists).toHaveBeenCalledWith(FILE_ID_1);

    // Verify DB update resets retry count and clears error
    const updateCall = mockFilesUpdateMany.mock.calls[0][0];
    expect(updateCall.data.pipeline_status).toBe('queued');
    expect(updateCall.data.pipeline_retry_count).toBe(0);
    expect(updateCall.data.last_error).toBeNull();
  });

  it('counts as error when verify returns false', async () => {
    const file = makeStuckFile();
    const repairer = new FileRequeueRepairer();
    mockVerifyPipelineJobExists.mockResolvedValue(false);

    const result = await repairer.requeueFailedRetriable(USER_ID, [file]);

    expect(result.failedRequeued).toBe(0);
    expect(result.errors).toBe(1);
  });
});

describe('FileRequeueRepairer.requeueMissingFromSearch()', () => {
  it('calls remove → enqueue → verify for files found via findUnique', async () => {
    const repairer = new FileRequeueRepairer();

    mockFilesFindUnique.mockResolvedValue({
      id: FILE_ID_1,
      name: 'missing.pdf',
      mime_type: 'application/pdf',
      user_id: USER_ID,
      connection_scope_id: SCOPE_ID_1,
    });

    const result = await repairer.requeueMissingFromSearch(USER_ID, [FILE_ID_1]);

    expect(result.missingRequeued).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledWith(FILE_ID_1);
    expect(mockAddFileProcessingFlow).toHaveBeenCalledWith(expect.objectContaining({
      fileId: FILE_ID_1,
    }));
    expect(mockVerifyPipelineJobExists).toHaveBeenCalledWith(FILE_ID_1);
  });

  it('skips file not found in DB', async () => {
    const repairer = new FileRequeueRepairer();
    mockFilesFindUnique.mockResolvedValue(null);

    const result = await repairer.requeueMissingFromSearch(USER_ID, [FILE_ID_1]);

    expect(result.missingRequeued).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockRemoveExistingPipelineJobs).not.toHaveBeenCalled();
  });

  it('counts as error when verify returns false', async () => {
    const repairer = new FileRequeueRepairer();
    mockFilesFindUnique.mockResolvedValue({
      id: FILE_ID_1,
      name: 'missing.pdf',
      mime_type: 'application/pdf',
      user_id: USER_ID,
      connection_scope_id: SCOPE_ID_1,
    });
    mockVerifyPipelineJobExists.mockResolvedValue(false);

    const result = await repairer.requeueMissingFromSearch(USER_ID, [FILE_ID_1]);

    expect(result.missingRequeued).toBe(0);
    expect(result.errors).toBe(1);
  });
});

describe('FileRequeueRepairer.requeueReadyWithoutChunks()', () => {
  it('calls remove → enqueue → verify', async () => {
    const file = makeStuckFile({ name: 'nochunks.pdf' });
    const repairer = new FileRequeueRepairer();

    const result = await repairer.requeueReadyWithoutChunks(USER_ID, [file]);

    expect(result.readyWithoutChunksRequeued).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledWith(FILE_ID_1);
    expect(mockVerifyPipelineJobExists).toHaveBeenCalledWith(FILE_ID_1);
  });
});

describe('FileRequeueRepairer.requeueImagesMissingEmbeddings()', () => {
  it('calls remove → enqueue → verify for image file', async () => {
    const repairer = new FileRequeueRepairer();
    mockFilesFindUnique.mockResolvedValue({
      id: FILE_ID_1,
      name: 'photo.jpg',
      mime_type: 'image/jpeg',
      connection_scope_id: SCOPE_ID_1,
    });

    const result = await repairer.requeueImagesMissingEmbeddings(USER_ID, [FILE_ID_1]);

    expect(result.imageRequeued).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledWith(FILE_ID_1);
    expect(mockVerifyPipelineJobExists).toHaveBeenCalledWith(FILE_ID_1);
  });
});

describe('FileRequeueRepairer.requeueStaleMetadata()', () => {
  it('calls remove → enqueue → verify', async () => {
    const file = makeStuckFile({ name: 'stale.pdf' });
    const repairer = new FileRequeueRepairer();

    const result = await repairer.requeueStaleMetadata(USER_ID, [file]);

    expect(result.staleMetadataRequeued).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockRemoveExistingPipelineJobs).toHaveBeenCalledWith(FILE_ID_1);
    expect(mockVerifyPipelineJobExists).toHaveBeenCalledWith(FILE_ID_1);
  });

  it('counts as error when verify returns false', async () => {
    const file = makeStuckFile();
    const repairer = new FileRequeueRepairer();
    mockVerifyPipelineJobExists.mockResolvedValue(false);

    const result = await repairer.requeueStaleMetadata(USER_ID, [file]);

    expect(result.staleMetadataRequeued).toBe(0);
    expect(result.errors).toBe(1);
  });
});
