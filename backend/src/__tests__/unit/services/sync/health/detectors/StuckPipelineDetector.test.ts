/**
 * StuckPipelineDetector Unit Tests (PRD-304)
 *
 * Validates:
 *   1. Detects files stuck in intermediate pipeline states for > 30 min
 *   2. Does NOT detect recently-updated files (within threshold)
 *   3. WHERE clause guards: deletion_status=null, transient sync guard
 *   4. Local files (connection_scope_id=null) are eligible
 *   5. Empty result returns { items: [], count: 0 }
 *   6. Returned IDs are normalised to UPPERCASE
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const mockFilesFindMany = vi.hoisted(() => vi.fn());
const mockConnectionScopesFindMany = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: { findMany: mockFilesFindMany },
    connection_scopes: { findMany: mockConnectionScopesFindMany },
  },
}));

// ============================================================================
// Import AFTER mocks
// ============================================================================

import { StuckPipelineDetector } from '@/services/sync/health/detectors/StuckPipelineDetector';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const FILE_ID_1 = 'file-11111111-aaaa-bbbb-cccc-ddddeeee1111'; // lowercase to test normalisation
const FILE_ID_2 = 'FILE-22222222-AAAA-BBBB-CCCC-DDDDEEEE2222';
const SCOPE_ID = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const SYNCING_SCOPE_ID = 'SCOP-SYNC0001-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

// ============================================================================
// Helpers
// ============================================================================

function makeFileRow(overrides?: {
  id?: string;
  name?: string;
  mime_type?: string;
  connection_scope_id?: string | null;
}) {
  return {
    id: overrides?.id ?? FILE_ID_1,
    name: overrides?.name ?? 'document.pdf',
    mime_type: overrides?.mime_type ?? 'application/pdf',
    connection_scope_id:
      overrides !== undefined && 'connection_scope_id' in overrides
        ? overrides.connection_scope_id
        : SCOPE_ID,
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Default: no syncing scopes, no files found
  mockConnectionScopesFindMany.mockResolvedValue([]);
  mockFilesFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Tests
// ============================================================================

describe('StuckPipelineDetector', () => {
  it('detects stuck files in an intermediate pipeline state', async () => {
    const stuckFile = makeFileRow({ id: FILE_ID_1, name: 'extracting.pdf' });
    mockFilesFindMany.mockResolvedValue([stuckFile]);

    const result = await new StuckPipelineDetector().detect(USER_ID);

    expect(result.count).toBe(1);
    expect(result.items[0].id).toBe(FILE_ID_1.toUpperCase());
    expect(result.items[0].name).toBe('extracting.pdf');
  });

  it('uses correct 30-minute threshold for updated_at', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z').getTime();
    vi.setSystemTime(now);

    await new StuckPipelineDetector().detect(USER_ID);

    const whereClause = mockFilesFindMany.mock.calls[0][0].where;
    const threshold = whereClause.updated_at.lt as Date;
    expect(threshold.getTime()).toBe(now - 30 * 60 * 1000);
  });

  it('includes deletion_status: null guard', async () => {
    await new StuckPipelineDetector().detect(USER_ID);

    const whereClause = mockFilesFindMany.mock.calls[0][0].where;
    expect(whereClause).toHaveProperty('deletion_status', null);
  });

  it('pre-fetches syncing scopes for the user', async () => {
    await new StuckPipelineDetector().detect(USER_ID);

    expect(mockConnectionScopesFindMany).toHaveBeenCalledOnce();
    const scopeArgs = mockConnectionScopesFindMany.mock.calls[0][0];
    expect(scopeArgs.where.connections).toEqual({ user_id: USER_ID });
    expect(scopeArgs.where.sync_status).toEqual({ in: ['syncing', 'sync_queued'] });
  });

  it('adds sync guard OR when syncing scopes exist', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([{ id: SYNCING_SCOPE_ID }]);

    await new StuckPipelineDetector().detect(USER_ID);

    const whereClause = mockFilesFindMany.mock.calls[0][0].where;
    expect(whereClause).toHaveProperty('OR');
    expect(whereClause.OR).toEqual([
      { connection_scope_id: null },
      { connection_scope_id: { notIn: [SYNCING_SCOPE_ID] } },
    ]);
  });

  it('does NOT add sync guard when no syncing scopes exist', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([]);

    await new StuckPipelineDetector().detect(USER_ID);

    const whereClause = mockFilesFindMany.mock.calls[0][0].where;
    expect(whereClause.OR).toBeUndefined();
  });

  it('includes a local file (connection_scope_id=null) in results', async () => {
    const localFile = makeFileRow({ id: FILE_ID_2, connection_scope_id: null });
    mockFilesFindMany.mockResolvedValue([localFile]);

    const result = await new StuckPipelineDetector().detect(USER_ID);

    expect(result.count).toBe(1);
    expect(result.items[0].connection_scope_id).toBeNull();
  });

  it('returns { items: [], count: 0 } when no stuck files exist', async () => {
    const result = await new StuckPipelineDetector().detect(USER_ID);

    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('normalises returned IDs to UPPERCASE', async () => {
    mockFilesFindMany.mockResolvedValue([makeFileRow({ id: 'file-lowercase-id' })]);

    const result = await new StuckPipelineDetector().detect(USER_ID);

    expect(result.items[0].id).toBe('FILE-LOWERCASE-ID');
  });

  it('queries for all four intermediate pipeline statuses', async () => {
    await new StuckPipelineDetector().detect(USER_ID);

    const whereClause = mockFilesFindMany.mock.calls[0][0].where;
    expect(whereClause.pipeline_status).toEqual({
      in: expect.arrayContaining(['queued', 'extracting', 'chunking', 'embedding']),
    });
  });
});
