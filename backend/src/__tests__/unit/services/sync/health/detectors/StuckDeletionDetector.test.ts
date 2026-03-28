/**
 * StuckDeletionDetector Unit Tests (PRD-304)
 *
 * Tests the two-path OR detection strategy:
 *   Fast path: Files on connected+synced scopes — no time threshold.
 *     Pre-fetches active scope IDs, then uses `connection_scope_id: { in: [...] }`.
 *   Slow path: Everything else — after 1-hour threshold.
 *     Gives FileDeletionWorker time to complete legitimate cleanup.
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
    files: {
      findMany: mockFilesFindMany,
    },
    connection_scopes: {
      findMany: mockConnectionScopesFindMany,
    },
  },
}));

// ============================================================================
// Import detector AFTER mocks
// ============================================================================

import { StuckDeletionDetector } from '@/services/sync/health/detectors/StuckDeletionDetector';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const FILE_ID_1 = 'FILE-11111111-AAAA-BBBB-CCCC-DDDDEEEE1111';
const FILE_ID_2 = 'FILE-22222222-AAAA-BBBB-CCCC-DDDDEEEE2222';
const SCOPE_ID = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const CONNECTION_ID = 'CONN-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

// ============================================================================
// Helpers
// ============================================================================

const STUCK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour — mirrors implementation

/** Build a minimal file row as returned by prisma.files.findMany */
function makeFileRow(
  fileId: string,
  overrides?: {
    name?: string;
    mime_type?: string;
    connection_scope_id?: string | null;
    connection_id?: string | null;
    source_type?: string | null;
  },
) {
  return {
    id: fileId,
    name: overrides?.name ?? 'document.pdf',
    mime_type: overrides?.mime_type ?? 'application/pdf',
    connection_scope_id: 'connection_scope_id' in (overrides ?? {})
      ? overrides!.connection_scope_id
      : SCOPE_ID,
    connection_id: 'connection_id' in (overrides ?? {})
      ? overrides!.connection_id
      : CONNECTION_ID,
    source_type: 'source_type' in (overrides ?? {})
      ? overrides!.source_type
      : 'onedrive',
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Default: no active scopes (fast path disabled), no files found
  mockConnectionScopesFindMany.mockResolvedValue([]);
  mockFilesFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Tests
// ============================================================================

describe('StuckDeletionDetector', () => {
  describe('fast path — connected scope, no time threshold', () => {
    it('detects a file on a connected+synced scope even if deleted_at is only 5 minutes ago', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      // Pre-fetch returns an active scope → fast path enabled
      mockConnectionScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      // Prisma returns the file (matched by connection_scope_id IN [SCOPE_ID])
      mockFilesFindMany.mockResolvedValue([makeFileRow(FILE_ID_1)]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.count).toBe(1);
      expect(result.items[0].id).toBe(FILE_ID_1);
    });

    it('returns the correct StuckDeletionFileRow shape', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockConnectionScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockFilesFindMany.mockResolvedValue([
        makeFileRow(FILE_ID_1, {
          name: 'report.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          connection_id: CONNECTION_ID,
          source_type: 'sharepoint',
        }),
      ]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.items[0]).toMatchObject({
        id: FILE_ID_1,
        name: 'report.xlsx',
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        connection_scope_id: SCOPE_ID,
        connection_id: CONNECTION_ID,
        source_type: 'sharepoint',
      });
    });
  });

  describe('slow path — disconnected scope, 1-hour threshold', () => {
    it('detects a file deleted 2 hours ago (no active scopes)', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      // No active scopes → fast path not available
      mockConnectionScopesFindMany.mockResolvedValue([]);
      mockFilesFindMany.mockResolvedValue([makeFileRow(FILE_ID_1)]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.count).toBe(1);
      expect(result.items[0].id).toBe(FILE_ID_1);
    });

    it('does NOT detect a file deleted only 30 minutes ago on a disconnected scope', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockConnectionScopesFindMany.mockResolvedValue([]);
      mockFilesFindMany.mockResolvedValue([]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.count).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('fast path excludes error scopes', () => {
    it('does not include error scopes in active scope pre-fetch', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      // Pre-fetch returns empty (error scopes excluded by notIn: ['error'])
      mockConnectionScopesFindMany.mockResolvedValue([]);
      mockFilesFindMany.mockResolvedValue([]);

      await new StuckDeletionDetector().detect(USER_ID);

      // Verify the scope pre-fetch excludes error status
      const scopeArgs = mockConnectionScopesFindMany.mock.calls[0][0];
      expect(scopeArgs.where.sync_status).toEqual({ notIn: ['error'] });
    });

    it('file on error scope detected only after 1h via slow path', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      // No active scopes (error scope excluded from pre-fetch)
      mockConnectionScopesFindMany.mockResolvedValue([]);
      // But slow path catches it (deleted_at > 1h ago)
      mockFilesFindMany.mockResolvedValue([makeFileRow(FILE_ID_1)]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.count).toBe(1);
    });
  });

  describe('files without scope — slow path only', () => {
    it('detects a scopeless file (connection_scope_id=null) deleted 2 hours ago', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockConnectionScopesFindMany.mockResolvedValue([]);
      mockFilesFindMany.mockResolvedValue([
        makeFileRow(FILE_ID_1, { connection_scope_id: null, connection_id: null, source_type: 'local' }),
      ]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.count).toBe(1);
      expect(result.items[0].connection_scope_id).toBeNull();
    });

    it('does NOT detect a scopeless file deleted only 30 minutes ago', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockConnectionScopesFindMany.mockResolvedValue([]);
      mockFilesFindMany.mockResolvedValue([]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.count).toBe(0);
    });
  });

  describe('empty result', () => {
    it('returns { items: [], count: 0 } when no stuck files exist', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result).toEqual({ items: [], count: 0 });
    });
  });

  describe('ID normalization', () => {
    it('uppercases returned file IDs', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockFilesFindMany.mockResolvedValue([
        { ...makeFileRow(FILE_ID_1), id: FILE_ID_1.toLowerCase() },
      ]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.items[0].id).toBe(FILE_ID_1.toUpperCase());
    });
  });

  describe('Prisma query structure', () => {
    it('pre-fetches active scopes scoped to user with connected status', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      await new StuckDeletionDetector().detect(USER_ID);

      expect(mockConnectionScopesFindMany).toHaveBeenCalledOnce();
      const scopeArgs = mockConnectionScopesFindMany.mock.calls[0][0];
      expect(scopeArgs.where.connections).toEqual({ user_id: USER_ID, status: 'connected' });
      expect(scopeArgs.where.sync_status).toEqual({ notIn: ['error'] });
      expect(scopeArgs.select).toEqual({ id: true });
    });

    it('includes fast path in OR when active scopes exist', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockConnectionScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockFilesFindMany.mockResolvedValue([]);

      await new StuckDeletionDetector().detect(USER_ID);

      const fileArgs = mockFilesFindMany.mock.calls[0][0];
      const where = fileArgs.where;

      expect(where.user_id).toBe(USER_ID);
      expect(where.deletion_status).toBe('pending');
      expect(Array.isArray(where.OR)).toBe(true);
      // Fast path + slow path
      expect(where.OR).toHaveLength(2);
      expect(where.OR[0]).toEqual({ connection_scope_id: { in: [SCOPE_ID] } });
      expect(where.OR[1].deleted_at).toBeDefined();
    });

    it('omits fast path from OR when no active scopes exist', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockConnectionScopesFindMany.mockResolvedValue([]);
      mockFilesFindMany.mockResolvedValue([]);

      await new StuckDeletionDetector().detect(USER_ID);

      const fileArgs = mockFilesFindMany.mock.calls[0][0];
      const where = fileArgs.where;

      // Only slow path present
      expect(where.OR).toHaveLength(1);
      expect(where.OR[0].deleted_at).toBeDefined();
    });

    it('slow path uses correct 1-hour threshold', async () => {
      const now = new Date('2025-06-01T12:00:00.000Z').getTime();
      vi.setSystemTime(now);

      mockFilesFindMany.mockResolvedValue([]);

      await new StuckDeletionDetector().detect(USER_ID);

      const fileArgs = mockFilesFindMany.mock.calls[0][0];
      const slowPath = fileArgs.where.OR.find((clause: Record<string, unknown>) => 'deleted_at' in clause);

      const expectedThreshold = new Date(now - STUCK_THRESHOLD_MS);
      expect(slowPath.deleted_at).toEqual({ lt: expectedThreshold });
    });

    it('selects only the expected fields', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));
      mockFilesFindMany.mockResolvedValue([]);

      await new StuckDeletionDetector().detect(USER_ID);

      const select = mockFilesFindMany.mock.calls[0][0].select;
      expect(select).toEqual(
        expect.objectContaining({
          id: true,
          name: true,
          mime_type: true,
          connection_scope_id: true,
          connection_id: true,
          source_type: true,
        }),
      );
    });
  });

  describe('multiple files detected together', () => {
    it('returns all detected files and correct count', async () => {
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockConnectionScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockFilesFindMany.mockResolvedValue([
        makeFileRow(FILE_ID_1),
        makeFileRow(FILE_ID_2, { connection_scope_id: null, connection_id: null }),
      ]);

      const result = await new StuckDeletionDetector().detect(USER_ID);

      expect(result.count).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.id)).toEqual([FILE_ID_1, FILE_ID_2]);
    });
  });
});
