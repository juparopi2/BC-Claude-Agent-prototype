/**
 * ScopeIntegrityDetector Unit Tests
 *
 * Validates:
 *   1. Detects zero_files — synced scope with item_count > 0 but 0 actual files
 *   2. Detects count_mismatch — actual file count diverges > 20% from item_count
 *   3. Detects processing_stuck — processing_status='processing' AND updated_at > 1h ago
 *   4. Skips scopes that are not 'synced' for zero_files/count_mismatch
 *   5. Skips scopes with item_count = 0 (nothing expected)
 *   6. Does NOT flag count_mismatch when divergence is <= 20%
 *   7. Returns empty result when no issues found
 *   8. Returns IDs normalised to UPPERCASE
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

const mockConnectionScopesFindMany = vi.hoisted(() => vi.fn());
const mockFilesCount = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findMany: mockConnectionScopesFindMany,
    },
    files: {
      count: mockFilesCount,
    },
  },
}));

// ============================================================================
// Import AFTER mocks
// ============================================================================

import { ScopeIntegrityDetector } from '@/services/sync/health/detectors/ScopeIntegrityDetector';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const SCOPE_ID_1 = 'scop-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01'; // lowercase to test UPPERCASE normalisation
const SCOPE_ID_2 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE02';
const SCOPE_ID_3 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE03';
const CONN_ID_1 = 'conn-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01';

// ============================================================================
// Helpers
// ============================================================================

function makeScopeRow(overrides?: {
  id?: string;
  connection_id?: string;
  sync_status?: string;
  item_count?: number | null;
  processing_status?: string | null;
  updated_at?: Date;
  scope_display_name?: string | null;
}) {
  return {
    id: overrides?.id ?? SCOPE_ID_1,
    connection_id: overrides?.connection_id ?? CONN_ID_1,
    sync_status: overrides?.sync_status ?? 'synced',
    item_count: overrides !== undefined && 'item_count' in overrides ? overrides.item_count : 10,
    processing_status: overrides !== undefined && 'processing_status' in overrides
      ? overrides.processing_status
      : null,
    updated_at: overrides?.updated_at ?? new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago by default
    scope_display_name: overrides?.scope_display_name ?? 'Test Scope',
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockConnectionScopesFindMany.mockResolvedValue([]);
  mockFilesCount.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Tests
// ============================================================================

describe('ScopeIntegrityDetector', () => {
  const detector = new ScopeIntegrityDetector();

  it('has name ScopeIntegrityDetector', () => {
    expect(detector.name).toBe('ScopeIntegrityDetector');
  });

  it('returns empty result when no scopes exist', async () => {
    const result = await detector.detect(USER_ID);
    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
  });

  // ==========================================================================
  // zero_files detection
  // ==========================================================================

  describe('zero_files', () => {
    it('detects a synced scope with item_count > 0 but 0 actual files', async () => {
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ id: SCOPE_ID_1, sync_status: 'synced', item_count: 50 }),
      ]);
      mockFilesCount.mockResolvedValue(0);

      const result = await detector.detect(USER_ID);

      expect(result.count).toBe(1);
      expect(result.items[0].reason).toBe('zero_files');
      expect(result.items[0].itemCount).toBe(50);
      expect(result.items[0].actualFileCount).toBe(0);
    });

    it('normalises scopeId and connectionId to UPPERCASE', async () => {
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ id: 'scop-lowercase-id', connection_id: 'conn-lowercase-id', item_count: 5 }),
      ]);
      mockFilesCount.mockResolvedValue(0);

      const result = await detector.detect(USER_ID);

      expect(result.items[0].scopeId).toBe('SCOP-LOWERCASE-ID');
      expect(result.items[0].connectionId).toBe('CONN-LOWERCASE-ID');
    });
  });

  // ==========================================================================
  // count_mismatch detection
  // ==========================================================================

  describe('count_mismatch', () => {
    it('detects count divergence greater than 20%', async () => {
      // item_count=100, actual=70 → 30% divergence → should flag
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ id: SCOPE_ID_2, sync_status: 'synced', item_count: 100 }),
      ]);
      mockFilesCount.mockResolvedValue(70);

      const result = await detector.detect(USER_ID);

      expect(result.count).toBe(1);
      expect(result.items[0].reason).toBe('count_mismatch');
      expect(result.items[0].itemCount).toBe(100);
      expect(result.items[0].actualFileCount).toBe(70);
    });

    it('does NOT flag when divergence is exactly 20%', async () => {
      // item_count=100, actual=80 → 20% divergence → NOT flagged (threshold is > 0.20)
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ id: SCOPE_ID_2, sync_status: 'synced', item_count: 100 }),
      ]);
      mockFilesCount.mockResolvedValue(80);

      const result = await detector.detect(USER_ID);

      expect(result.count).toBe(0);
    });

    it('does NOT flag when divergence is below 20%', async () => {
      // item_count=100, actual=90 → 10% divergence → NOT flagged
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ id: SCOPE_ID_2, sync_status: 'synced', item_count: 100 }),
      ]);
      mockFilesCount.mockResolvedValue(90);

      const result = await detector.detect(USER_ID);

      expect(result.count).toBe(0);
    });
  });

  // ==========================================================================
  // processing_stuck detection
  // ==========================================================================

  describe('processing_stuck', () => {
    it('detects a scope stuck in processing for > 1 hour', async () => {
      const now = new Date('2025-06-15T12:00:00.000Z').getTime();
      vi.setSystemTime(now);

      const stuckUpdatedAt = new Date(now - 2 * 60 * 60 * 1000); // 2h ago
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({
          id: SCOPE_ID_3,
          sync_status: 'syncing',
          processing_status: 'processing',
          updated_at: stuckUpdatedAt,
        }),
      ]);

      const result = await detector.detect(USER_ID);

      expect(result.count).toBe(1);
      expect(result.items[0].reason).toBe('processing_stuck');
      expect(result.items[0].processingStatus).toBe('processing');
    });

    it('does NOT flag processing_stuck when updated_at is within 1 hour', async () => {
      const now = new Date('2025-06-15T12:00:00.000Z').getTime();
      vi.setSystemTime(now);

      const recentUpdatedAt = new Date(now - 30 * 60 * 1000); // 30 min ago
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({
          id: SCOPE_ID_3,
          sync_status: 'syncing',
          processing_status: 'processing',
          updated_at: recentUpdatedAt,
        }),
      ]);

      const result = await detector.detect(USER_ID);

      expect(result.count).toBe(0);
    });

    it('processing_stuck takes priority — scope is not re-checked for zero_files', async () => {
      const now = new Date('2025-06-15T12:00:00.000Z').getTime();
      vi.setSystemTime(now);

      // A synced scope with item_count > 0, stuck in processing, and 0 files
      // Should only produce ONE issue (processing_stuck, not zero_files)
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({
          id: SCOPE_ID_1,
          sync_status: 'synced',
          item_count: 100,
          processing_status: 'processing',
          updated_at: new Date(now - 2 * 60 * 60 * 1000),
        }),
      ]);
      mockFilesCount.mockResolvedValue(0);

      const result = await detector.detect(USER_ID);

      expect(result.count).toBe(1);
      expect(result.items[0].reason).toBe('processing_stuck');
    });
  });

  // ==========================================================================
  // Negative cases — skipped scopes
  // ==========================================================================

  describe('skipped scopes', () => {
    it('does NOT flag scopes with sync_status !== synced for zero_files', async () => {
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ sync_status: 'syncing', item_count: 100 }),
      ]);
      mockFilesCount.mockResolvedValue(0);

      const result = await detector.detect(USER_ID);

      // filesCount should NOT have been called (sync guard kicks in first)
      expect(mockFilesCount).not.toHaveBeenCalled();
      expect(result.count).toBe(0);
    });

    it('does NOT flag scopes with item_count = 0', async () => {
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ sync_status: 'synced', item_count: 0 }),
      ]);

      const result = await detector.detect(USER_ID);

      expect(mockFilesCount).not.toHaveBeenCalled();
      expect(result.count).toBe(0);
    });

    it('does NOT flag scopes with item_count = null', async () => {
      mockConnectionScopesFindMany.mockResolvedValue([
        makeScopeRow({ sync_status: 'synced', item_count: null }),
      ]);

      const result = await detector.detect(USER_ID);

      expect(mockFilesCount).not.toHaveBeenCalled();
      expect(result.count).toBe(0);
    });
  });

  // ==========================================================================
  // Query parameters
  // ==========================================================================

  it('queries only connected scopes for the given user', async () => {
    await detector.detect(USER_ID);

    expect(mockConnectionScopesFindMany).toHaveBeenCalledOnce();
    const args = mockConnectionScopesFindMany.mock.calls[0][0];
    expect(args.where.connections).toEqual({ user_id: USER_ID, status: 'connected' });
  });

  it('counts non-folder, non-deleted files for the scope', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([
      makeScopeRow({ id: SCOPE_ID_1, sync_status: 'synced', item_count: 10 }),
    ]);
    mockFilesCount.mockResolvedValue(10);

    await detector.detect(USER_ID);

    expect(mockFilesCount).toHaveBeenCalledOnce();
    const countArgs = mockFilesCount.mock.calls[0][0];
    expect(countArgs.where).toMatchObject({
      connection_scope_id: SCOPE_ID_1,
      deleted_at: null,
      is_folder: false,
    });
  });
});
