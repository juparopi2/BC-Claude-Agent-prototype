/**
 * FileRequeueRepairer Unit Tests (PRD-304 Phase 2)
 *
 * Validates permanentlyFailExhaustedFiles():
 *   1. Updates pipeline_status to 'failed' for each exhausted file
 *   2. Skips files that have already transitioned (count=0 — optimistic concurrency)
 *   3. Increments processing_failed scope counter via adjustScopeCounters('increment_failed')
 *   4. Isolates per-file errors — one failure does not abort the rest
 *   5. Files with null connection_scope_id do not cause scope counter updates
 *   6. Returns correct permanentlyFailed and errors counts
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
const mockExecuteRawUnsafe = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: { updateMany: mockFilesUpdateMany },
    $executeRawUnsafe: mockExecuteRawUnsafe,
  },
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
  mockExecuteRawUnsafe.mockResolvedValue(undefined);
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
    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
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
    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
  });

  it('increments processing_failed scope counter for each updated file', async () => {
    const file = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: SCOPE_ID_1 });
    const repairer = new FileRequeueRepairer();

    await repairer.permanentlyFailExhaustedFiles(USER_ID, [file]);

    expect(mockExecuteRawUnsafe).toHaveBeenCalledOnce();
    const sql: string = mockExecuteRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('processing_failed = processing_failed +');
    // Second arg is count (1), third arg is scopeId
    expect(mockExecuteRawUnsafe.mock.calls[0][1]).toBe(1);
    expect(mockExecuteRawUnsafe.mock.calls[0][2]).toBe(SCOPE_ID_1);
  });

  it('aggregates multiple files in the same scope into a single counter update', async () => {
    const file1 = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: SCOPE_ID_1 });
    const file2 = makeExhaustedFile({ id: FILE_ID_2, connection_scope_id: SCOPE_ID_1 });
    const repairer = new FileRequeueRepairer();

    await repairer.permanentlyFailExhaustedFiles(USER_ID, [file1, file2]);

    expect(mockFilesUpdateMany).toHaveBeenCalledTimes(2);
    // Only one scope counter update for SCOPE_ID_1 with count=2
    expect(mockExecuteRawUnsafe).toHaveBeenCalledOnce();
    expect(mockExecuteRawUnsafe.mock.calls[0][1]).toBe(2);
    expect(mockExecuteRawUnsafe.mock.calls[0][2]).toBe(SCOPE_ID_1);
  });

  it('updates counters for multiple distinct scopes independently', async () => {
    const file1 = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: SCOPE_ID_1 });
    const file2 = makeExhaustedFile({ id: FILE_ID_2, connection_scope_id: SCOPE_ID_2 });
    const repairer = new FileRequeueRepairer();

    await repairer.permanentlyFailExhaustedFiles(USER_ID, [file1, file2]);

    expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(2);
    const scopeIds = mockExecuteRawUnsafe.mock.calls.map((c) => c[2]);
    expect(scopeIds).toContain(SCOPE_ID_1);
    expect(scopeIds).toContain(SCOPE_ID_2);
  });

  it('does not call scope counter update for files with null connection_scope_id', async () => {
    const localFile = makeExhaustedFile({ id: FILE_ID_1, connection_scope_id: null });
    const repairer = new FileRequeueRepairer();

    const result = await repairer.permanentlyFailExhaustedFiles(USER_ID, [localFile]);

    expect(result.permanentlyFailed).toBe(1);
    // No scope to update
    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
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
