/**
 * SyncRecoveryService Unit Tests (PRD-300)
 *
 * Tests the four recovery operations:
 *   1. resetStuckScopes — resets 'syncing' scopes back to 'idle'
 *   2. retryErrorScopes — re-enqueues sync jobs for 'error' scopes
 *   3. retryFailedFiles — re-enqueues failed file processing
 *   4. runFullRecovery  — orchestrates reset + retry in sequence
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

// connection_scopes table
const mockScopesFindMany = vi.hoisted(() => vi.fn());
const mockScopesUpdate = vi.hoisted(() => vi.fn());
const mockScopesFindUnique = vi.hoisted(() => vi.fn());

// connections table
const mockConnectionsFindUnique = vi.hoisted(() => vi.fn());

// files table
const mockFilesFindMany = vi.hoisted(() => vi.fn());
const mockFilesUpdate = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findMany: mockScopesFindMany,
      update: mockScopesUpdate,
      findUnique: mockScopesFindUnique,
    },
    connections: {
      findUnique: mockConnectionsFindUnique,
    },
    files: {
      findMany: mockFilesFindMany,
      update: mockFilesUpdate,
    },
  },
}));

// Queue
const mockAddExternalFileSyncJob = vi.hoisted(() => vi.fn());
const mockAddInitialSyncJob = vi.hoisted(() => vi.fn());
const mockAddFileProcessingFlow = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addExternalFileSyncJob: mockAddExternalFileSyncJob,
    addInitialSyncJob: mockAddInitialSyncJob,
    addFileProcessingFlow: mockAddFileProcessingFlow,
  })),
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import { SyncRecoveryService } from '@/services/sync/health/SyncRecoveryService';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const SCOPE_ID = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
const FILE_ID_1 = 'FILE-11111111-AAAA-BBBB-CCCC-111122223333';
const FILE_ID_2 = 'FILE-22222222-AAAA-BBBB-CCCC-444455556666';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal scope record as returned by findUnique (with connections included) */
function makeScope(overrides?: {
  id?: string;
  last_sync_cursor?: string | null;
  connectionStatus?: string;
  userId?: string;
}) {
  return {
    id: overrides?.id ?? SCOPE_ID,
    last_sync_cursor: overrides?.last_sync_cursor ?? null,
    connections: {
      id: CONNECTION_ID,
      user_id: overrides?.userId ?? USER_ID,
      status: overrides?.connectionStatus ?? 'connected',
    },
  };
}

/** Build a minimal file record as returned by files.findMany */
function makeFile(
  id: string,
  overrides?: { pipeline_status?: string; pipeline_retry_count?: number; name?: string; mime_type?: string },
) {
  return {
    id,
    name: overrides?.name ?? 'document.pdf',
    mime_type: overrides?.mime_type ?? 'application/pdf',
    pipeline_status: overrides?.pipeline_status ?? 'failed',
    pipeline_retry_count: overrides?.pipeline_retry_count ?? 0,
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Safe defaults — all operations succeed, return empty results
  mockScopesFindMany.mockResolvedValue([]);
  mockScopesUpdate.mockResolvedValue({});
  mockScopesFindUnique.mockResolvedValue(makeScope());
  mockConnectionsFindUnique.mockResolvedValue({ status: 'connected' });
  mockFilesFindMany.mockResolvedValue([]);
  mockFilesUpdate.mockResolvedValue({});
  mockAddExternalFileSyncJob.mockResolvedValue(undefined);
  mockAddInitialSyncJob.mockResolvedValue(undefined);
  mockAddFileProcessingFlow.mockResolvedValue(undefined);
});

// ============================================================================
// Tests
// ============================================================================

describe('SyncRecoveryService', () => {
  let service: SyncRecoveryService;

  beforeEach(() => {
    service = new SyncRecoveryService();
  });

  // ==========================================================================
  // resetStuckScopes
  // ==========================================================================

  describe('resetStuckScopes', () => {
    it('resets scopes stuck in syncing to idle', async () => {
      mockScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockScopesFindUnique.mockResolvedValue(makeScope({ connectionStatus: 'connected' }));
      mockScopesUpdate.mockResolvedValue({});

      const result = await service.resetStuckScopes();

      expect(mockScopesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SCOPE_ID },
          data: expect.objectContaining({ sync_status: 'idle' }),
        }),
      );
      expect(result.scopesReset).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('skips scopes with expired connections', async () => {
      mockScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockScopesFindUnique.mockResolvedValue(makeScope({ connectionStatus: 'expired' }));

      const result = await service.resetStuckScopes();

      expect(mockScopesUpdate).not.toHaveBeenCalled();
      expect(result.scopesReset).toBe(0);
    });

    it('handles per-scope errors gracefully without throwing', async () => {
      mockScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockScopesFindUnique.mockResolvedValue(makeScope({ connectionStatus: 'connected' }));
      mockScopesUpdate.mockRejectedValue(new Error('DB timeout'));

      const result = await service.resetStuckScopes();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(SCOPE_ID);
      expect(result.scopesReset).toBe(0);
    });

    it('uses provided scopeIds instead of the time-based query', async () => {
      const explicitId = SCOPE_ID;
      mockScopesFindUnique.mockResolvedValue(makeScope({ id: explicitId, connectionStatus: 'connected' }));

      await service.resetStuckScopes([explicitId]);

      // findMany should NOT have been called with the time-based where clause —
      // it should not be called at all since scopeIds were provided directly.
      expect(mockScopesFindMany).not.toHaveBeenCalled();

      // The scope lookup uses findUnique with the provided id
      expect(mockScopesFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: explicitId } }),
      );
    });
  });

  // ==========================================================================
  // retryErrorScopes
  // ==========================================================================

  describe('retryErrorScopes', () => {
    it('re-enqueues error scopes with delta sync when cursor exists', async () => {
      mockScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockScopesFindUnique.mockResolvedValue(
        makeScope({ connectionStatus: 'connected', last_sync_cursor: 'https://cursor.example' }),
      );

      const result = await service.retryErrorScopes();

      expect(mockScopesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SCOPE_ID },
          data: expect.objectContaining({ sync_status: 'sync_queued' }),
        }),
      );
      expect(mockAddExternalFileSyncJob).toHaveBeenCalledWith(
        expect.objectContaining({ scopeId: SCOPE_ID, triggerType: 'manual' }),
      );
      expect(mockAddInitialSyncJob).not.toHaveBeenCalled();
      expect(result.scopesRequeued).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('re-enqueues error scopes with initial sync when no cursor', async () => {
      mockScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockScopesFindUnique.mockResolvedValue(
        makeScope({ connectionStatus: 'connected', last_sync_cursor: null }),
      );

      const result = await service.retryErrorScopes();

      expect(mockAddInitialSyncJob).toHaveBeenCalledWith(
        expect.objectContaining({ scopeId: SCOPE_ID }),
      );
      expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
      expect(result.scopesRequeued).toBe(1);
    });

    it('skips scopes with disconnected connections', async () => {
      mockScopesFindMany.mockResolvedValue([{ id: SCOPE_ID }]);
      mockScopesFindUnique.mockResolvedValue(makeScope({ connectionStatus: 'disconnected' }));

      const result = await service.retryErrorScopes();

      expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
      expect(mockAddInitialSyncJob).not.toHaveBeenCalled();
      expect(result.scopesRequeued).toBe(0);
    });

    it('filters by userId when provided', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      await service.retryErrorScopes(undefined, USER_ID);

      expect(mockScopesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connections: { user_id: USER_ID },
          }),
        }),
      );
    });
  });

  // ==========================================================================
  // retryFailedFiles
  // ==========================================================================

  describe('retryFailedFiles', () => {
    it('re-enqueues failed files and increments retry count', async () => {
      mockFilesFindMany.mockResolvedValue([
        makeFile(FILE_ID_1, { pipeline_retry_count: 1 }),
        makeFile(FILE_ID_2, { pipeline_retry_count: 1 }),
      ]);

      const result = await service.retryFailedFiles(SCOPE_ID, USER_ID);

      expect(mockFilesUpdate).toHaveBeenCalledTimes(2);
      expect(mockFilesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: FILE_ID_1 },
          data: expect.objectContaining({
            pipeline_status: 'queued',
            pipeline_retry_count: { increment: 1 },
          }),
        }),
      );
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(2);
      expect(result.filesRequeued).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('excludes files at max retries via the query filter', async () => {
      // Only files with pipeline_retry_count < 3 are returned by the query.
      // This test verifies the query is set up correctly and only eligible files are processed.
      mockFilesFindMany.mockResolvedValue([
        makeFile(FILE_ID_1, { pipeline_retry_count: 2 }),
      ]);

      const result = await service.retryFailedFiles(SCOPE_ID, USER_ID);

      expect(mockFilesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pipeline_status: 'failed',
            pipeline_retry_count: { lt: 3 },
          }),
        }),
      );
      expect(result.filesRequeued).toBe(1);
    });

    it('handles per-file errors gracefully — first succeeds, second fails', async () => {
      mockFilesFindMany.mockResolvedValue([
        makeFile(FILE_ID_1, { pipeline_retry_count: 0 }),
        makeFile(FILE_ID_2, { pipeline_retry_count: 0 }),
      ]);

      // First update succeeds, second rejects
      mockFilesUpdate
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Lock timeout'));

      const result = await service.retryFailedFiles(SCOPE_ID, USER_ID);

      expect(result.filesRequeued).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(FILE_ID_2);
    });
  });

  // ==========================================================================
  // runFullRecovery
  // ==========================================================================

  describe('runFullRecovery', () => {
    it('orchestrates resetStuckScopes and retryErrorScopes in sequence', async () => {
      // Simulate one stuck scope and one error scope
      mockScopesFindMany
        .mockResolvedValueOnce([{ id: SCOPE_ID }]) // resetStuckScopes: stuck scopes query
        .mockResolvedValueOnce([]); // retryErrorScopes: error scopes query

      mockScopesFindUnique.mockResolvedValue(makeScope({ connectionStatus: 'connected' }));

      const result = await service.runFullRecovery();

      // Both operations ran — findMany called at least twice (once per operation)
      expect(mockScopesFindMany).toHaveBeenCalledTimes(2);

      // resetStuckScopes updated the stuck scope to idle
      expect(mockScopesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sync_status: 'idle' }),
        }),
      );

      expect(result.scopesReset).toBe(1);
      expect(result.scopesRequeued).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('aggregates results from both operations', async () => {
      // resetStuckScopes: one stuck scope -> reset to idle
      // retryErrorScopes: one error scope with cursor -> re-enqueued
      mockScopesFindMany
        .mockResolvedValueOnce([{ id: SCOPE_ID }]) // stuck scopes
        .mockResolvedValueOnce([{ id: SCOPE_ID }]); // error scopes

      mockScopesFindUnique
        .mockResolvedValueOnce(makeScope({ connectionStatus: 'connected' })) // for resetStuckScopes
        .mockResolvedValueOnce(makeScope({ connectionStatus: 'connected', last_sync_cursor: 'https://cursor' })); // for retryErrorScopes

      const result = await service.runFullRecovery();

      expect(result.scopesReset).toBe(1);
      expect(result.scopesRequeued).toBe(1);
      expect(result.filesRequeued).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('passes userId to retryErrorScopes when provided', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      await service.runFullRecovery(USER_ID);

      // The second findMany call (retryErrorScopes) should filter by userId
      const secondCall = mockScopesFindMany.mock.calls[1];
      expect(secondCall[0]).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            connections: { user_id: USER_ID },
          }),
        }),
      );
    });
  });
});
