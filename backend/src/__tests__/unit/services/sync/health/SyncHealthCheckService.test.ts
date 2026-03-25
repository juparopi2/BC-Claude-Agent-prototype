/**
 * SyncHealthCheckService Unit Tests (PRD-300)
 *
 * Tests the health check run cycle:
 *   1. run() resets scopes stuck in syncing state (delegates to SyncRecoveryService)
 *   2. run() skips stuck scopes on expired/disconnected connections (counts errorScopesSkippedExpiredConnection)
 *   3. run() retries error scopes when backoff allows
 *   4. run() stops retrying after max backoff attempts (defers)
 *   5. run() emits sync:health_report WS event per affected user
 *   6. run() is per-scope isolated (one scope error does not abort run)
 *   7. getHealthForUser() returns SyncHealthReport filtered to that user
 *   8. getHealthForUser() classifies health statuses correctly (healthy, degraded, unhealthy)
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

// prisma mocks
const mockScopesFindMany = vi.hoisted(() => vi.fn());
const mockFilesGroupBy = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findMany: mockScopesFindMany,
    },
    files: {
      groupBy: mockFilesGroupBy,
    },
  },
}));

// Redis mocks
const mockRedisIncr = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisExpire = vi.hoisted(() => vi.fn());

const mockRedisClient = vi.hoisted(() => ({
  incr: mockRedisIncr,
  get: mockRedisGet,
  set: mockRedisSet,
  expire: mockRedisExpire,
}));

vi.mock('@/infrastructure/redis/redis-client', () => ({
  getRedisClient: vi.fn(() => mockRedisClient),
}));

// SyncRecoveryService mocks
const mockResetStuckScopes = vi.hoisted(() => vi.fn());
const mockRetryErrorScopes = vi.hoisted(() => vi.fn());

vi.mock('@/services/sync/health/SyncRecoveryService', () => ({
  getSyncRecoveryService: vi.fn(() => ({
    resetStuckScopes: mockResetStuckScopes,
    retryErrorScopes: mockRetryErrorScopes,
  })),
}));

// SocketService mocks
const mockIsSocketServiceInitialized = vi.hoisted(() => vi.fn());
const mockEmit = vi.hoisted(() => vi.fn());
const mockTo = vi.hoisted(() => vi.fn());

vi.mock('@/services/websocket/SocketService', () => ({
  isSocketServiceInitialized: mockIsSocketServiceInitialized,
  getSocketIO: vi.fn(() => ({
    to: mockTo,
  })),
}));

// @bc-agent/shared mock — use actual values
vi.mock('@bc-agent/shared', () => ({
  SYNC_WS_EVENTS: {
    SYNC_STARTED: 'sync:started',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_ERROR: 'sync:error',
    SYNC_FILE_ADDED: 'sync:file_added',
    SYNC_FILE_UPDATED: 'sync:file_updated',
    SYNC_FILE_REMOVED: 'sync:file_removed',
    SUBSCRIPTION_RENEWED: 'connection:subscription_renewed',
    SUBSCRIPTION_ERROR: 'connection:subscription_error',
    CONNECTION_EXPIRED: 'connection:expired',
    CONNECTION_DISCONNECTED: 'connection:disconnected',
    PROCESSING_PROGRESS: 'processing:progress',
    PROCESSING_COMPLETED: 'processing:completed',
    SYNC_HEALTH_REPORT: 'sync:health_report',
    SYNC_RECOVERY_COMPLETED: 'sync:recovery_completed',
  },
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import { SyncHealthCheckService } from '@/services/sync/health/SyncHealthCheckService';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const SCOPE_ID_1 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const SCOPE_ID_2 = 'SCOP-22222222-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';

// ============================================================================
// Helpers
// ============================================================================

/** Build a scope record matching ScopeWithConnection shape (with connections included) */
function makeScope(overrides?: {
  id?: string;
  sync_status?: string;
  updated_at?: Date;
  last_sync_at?: Date | null;
  scope_display_name?: string;
  connectionStatus?: string;
  userId?: string;
  connectionId?: string;
}) {
  return {
    id: overrides?.id ?? SCOPE_ID_1,
    sync_status: overrides?.sync_status ?? 'synced',
    updated_at: overrides?.updated_at ?? new Date(),
    last_sync_at: overrides?.last_sync_at !== undefined ? overrides.last_sync_at : new Date(),
    scope_display_name: overrides?.scope_display_name ?? 'Test Scope',
    connections: {
      id: overrides?.connectionId ?? CONNECTION_ID,
      user_id: overrides?.userId ?? USER_ID,
      status: overrides?.connectionStatus ?? 'connected',
    },
  };
}

/** Default empty file stats groupBy result */
const emptyFileStats = [
  { pipeline_status: 'ready', _count: 0 },
];

/** File stats with high failure rate (>50%) */
const highFailureFileStats = [
  { pipeline_status: 'ready', _count: 10 },
  { pipeline_status: 'failed', _count: 12 },
];

/** Default successful RecoveryResult */
const defaultRecoveryResult = {
  scopesReset: 1,
  scopesRequeued: 0,
  filesRequeued: 0,
  errors: [],
};

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Safe defaults
  mockScopesFindMany.mockResolvedValue([]);
  mockFilesGroupBy.mockResolvedValue(emptyFileStats);

  // Redis defaults: first attempt, no prior timestamp
  mockRedisIncr.mockResolvedValue(1);
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisExpire.mockResolvedValue(1);

  // Recovery defaults
  mockResetStuckScopes.mockResolvedValue(defaultRecoveryResult);
  mockRetryErrorScopes.mockResolvedValue({ ...defaultRecoveryResult, scopesRequeued: 1 });

  // WebSocket defaults: initialized
  mockIsSocketServiceInitialized.mockReturnValue(true);
  mockTo.mockReturnValue({ emit: mockEmit });
});

// ============================================================================
// Tests
// ============================================================================

describe('SyncHealthCheckService', () => {
  // ==========================================================================
  // run() — stuck syncing detection and reset
  // ==========================================================================

  describe('run() — stuck syncing detection', () => {
    it('detects a stuck syncing scope and delegates reset to SyncRecoveryService', async () => {
      // Set updated_at to 15 minutes ago — well past the 500ms test threshold
      const stuckUpdatedAt = new Date(Date.now() - 15 * 60 * 1000);
      const stuckScope = makeScope({
        sync_status: 'syncing',
        updated_at: stuckUpdatedAt,
        last_sync_at: new Date(), // recent — no stale_sync issue
      });

      mockScopesFindMany.mockResolvedValue([stuckScope]);

      // Use a very short threshold so the scope is definitely "stuck"
      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.stuckSyncingDetected).toBe(1);
      expect(mockResetStuckScopes).toHaveBeenCalledWith(
        expect.arrayContaining([SCOPE_ID_1]),
      );
      expect(metrics.stuckSyncingReset).toBe(1); // from defaultRecoveryResult
    });

    it('does not flag a syncing scope that is within the threshold window', async () => {
      // updated_at is only 1 second ago — should not be considered stuck
      const recentUpdatedAt = new Date(Date.now() - 1000);
      const activeScope = makeScope({
        sync_status: 'syncing',
        updated_at: recentUpdatedAt,
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([activeScope]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 600_000 });
      const metrics = await service.run();

      expect(metrics.stuckSyncingDetected).toBe(0);
      expect(mockResetStuckScopes).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // run() — error state skipped on expired/disconnected connection
  // ==========================================================================

  describe('run() — error scopes with expired connections', () => {
    it('increments errorScopesSkippedExpiredConnection for error scopes on expired connections', async () => {
      const errorScope = makeScope({
        sync_status: 'error',
        connectionStatus: 'expired',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([errorScope]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.errorScopesDetected).toBe(1);
      expect(metrics.errorScopesSkippedExpiredConnection).toBe(1);
      expect(metrics.errorScopesRetried).toBe(0);
      // Should not attempt retry for expired connection
      expect(mockRetryErrorScopes).not.toHaveBeenCalled();
    });

    it('increments errorScopesSkippedExpiredConnection for disconnected connections', async () => {
      const errorScope = makeScope({
        sync_status: 'error',
        connectionStatus: 'disconnected',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([errorScope]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.errorScopesSkippedExpiredConnection).toBe(1);
      expect(mockRetryErrorScopes).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // run() — error scope retry when backoff allows
  // ==========================================================================

  describe('run() — error scope retry with backoff', () => {
    it('retries an error scope on a connected connection when backoff allows', async () => {
      const errorScope = makeScope({
        sync_status: 'error',
        connectionStatus: 'connected',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([errorScope]);
      // First attempt — incr returns 1, no prior timestamp
      mockRedisIncr.mockResolvedValue(1);
      mockRedisGet.mockResolvedValue(null);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.errorScopesDetected).toBe(1);
      expect(metrics.errorScopesSkippedExpiredConnection).toBe(0);
      expect(metrics.errorScopesBackoffDeferred).toBe(0);
      expect(mockRetryErrorScopes).toHaveBeenCalledWith(
        expect.arrayContaining([SCOPE_ID_1]),
      );
    });
  });

  // ==========================================================================
  // run() — stops retrying after max backoff attempts
  // ==========================================================================

  describe('run() — max backoff attempts exceeded', () => {
    it('defers retry when attempt count exceeds MAX_BACKOFF_ATTEMPTS (5)', async () => {
      const errorScope = makeScope({
        sync_status: 'error',
        connectionStatus: 'connected',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([errorScope]);
      // incr returns 6 — exceeds MAX_BACKOFF_ATTEMPTS=5
      mockRedisIncr.mockResolvedValue(6);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.errorScopesDetected).toBe(1);
      expect(metrics.errorScopesBackoffDeferred).toBe(1);
      expect(metrics.errorScopesRetried).toBe(0);
      expect(mockRetryErrorScopes).not.toHaveBeenCalled();
    });

    it('defers when required backoff delay has not elapsed', async () => {
      const errorScope = makeScope({
        sync_status: 'error',
        connectionStatus: 'connected',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([errorScope]);
      // Attempt 2 requires 15 minute wait
      mockRedisIncr.mockResolvedValue(2);
      // Last attempt was only 1 second ago
      mockRedisGet.mockResolvedValue(String(Date.now() - 1000));

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.errorScopesBackoffDeferred).toBe(1);
      expect(mockRetryErrorScopes).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // run() — WebSocket health report emission
  // ==========================================================================

  describe('run() — WebSocket health report emission', () => {
    it('emits sync:health_report to each affected user room', async () => {
      const scope = makeScope({
        sync_status: 'synced',
        last_sync_at: new Date(),
        userId: USER_ID,
      });

      mockScopesFindMany.mockResolvedValue([scope]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      await service.run();

      expect(mockIsSocketServiceInitialized).toHaveBeenCalled();
      expect(mockTo).toHaveBeenCalledWith(`user:${USER_ID}`);
      expect(mockEmit).toHaveBeenCalledWith(
        'sync:health_report',
        expect.objectContaining({
          userId: USER_ID,
          report: expect.objectContaining({
            overallStatus: expect.any(String),
            summary: expect.objectContaining({
              totalScopes: 1,
            }),
            scopes: expect.arrayContaining([
              expect.objectContaining({
                scopeId: SCOPE_ID_1,
              }),
            ]),
          }),
        }),
      );
    });

    it('does not emit WS events when SocketService is not initialized', async () => {
      mockIsSocketServiceInitialized.mockReturnValue(false);

      const scope = makeScope({ sync_status: 'synced', last_sync_at: new Date() });
      mockScopesFindMany.mockResolvedValue([scope]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      await service.run();

      expect(mockTo).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('emits separate health reports for each distinct user', async () => {
      const USER_ID_2 = 'USER-99999999-9999-9999-9999-999999999999';

      const scope1 = makeScope({
        id: SCOPE_ID_1,
        sync_status: 'synced',
        last_sync_at: new Date(),
        userId: USER_ID,
      });
      const scope2 = makeScope({
        id: SCOPE_ID_2,
        sync_status: 'synced',
        last_sync_at: new Date(),
        userId: USER_ID_2,
      });

      mockScopesFindMany.mockResolvedValue([scope1, scope2]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      await service.run();

      expect(mockTo).toHaveBeenCalledWith(`user:${USER_ID}`);
      expect(mockTo).toHaveBeenCalledWith(`user:${USER_ID_2}`);
      expect(mockEmit).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // run() — per-scope isolation
  // ==========================================================================

  describe('run() — per-scope isolation', () => {
    it('continues processing remaining scopes when one scope inspection throws', async () => {
      // First scope will trigger an error in inspectScope via a bad DB call,
      // second scope should still be processed normally.
      const badScope = makeScope({
        id: SCOPE_ID_1,
        sync_status: 'synced',
        last_sync_at: new Date(),
      });
      const goodScope = makeScope({
        id: SCOPE_ID_2,
        sync_status: 'synced',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([badScope, goodScope]);

      // Fail on the first files.groupBy call, succeed on the second
      mockFilesGroupBy
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValueOnce(emptyFileStats);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      // Should not throw even though one scope failed
      const metrics = await service.run();

      expect(metrics.scopesChecked).toBe(2);
      // At least the good scope was processed — WS should emit for it
      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    it('returns complete metrics even when individual scopes throw', async () => {
      const scope1 = makeScope({ id: SCOPE_ID_1, sync_status: 'synced', last_sync_at: new Date() });
      const scope2 = makeScope({ id: SCOPE_ID_2, sync_status: 'synced', last_sync_at: new Date() });

      mockScopesFindMany.mockResolvedValue([scope1, scope2]);

      // Both groupBy calls throw
      mockFilesGroupBy.mockRejectedValue(new Error('DB error'));

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.scopesChecked).toBe(2);
      // durationMs should be set — run completed without throwing
      expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // run() — metrics accuracy
  // ==========================================================================

  describe('run() — metrics', () => {
    it('returns scopesChecked equal to number of fetched scopes', async () => {
      mockScopesFindMany.mockResolvedValue([
        makeScope({ id: SCOPE_ID_1, sync_status: 'synced', last_sync_at: new Date() }),
        makeScope({ id: SCOPE_ID_2, sync_status: 'synced', last_sync_at: new Date() }),
      ]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.scopesChecked).toBe(2);
    });

    it('returns zero stuckSyncingReset when no stuck scopes are found', async () => {
      mockScopesFindMany.mockResolvedValue([
        makeScope({ id: SCOPE_ID_1, sync_status: 'synced', last_sync_at: new Date() }),
      ]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const metrics = await service.run();

      expect(metrics.stuckSyncingDetected).toBe(0);
      expect(metrics.stuckSyncingReset).toBe(0);
      expect(mockResetStuckScopes).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getHealthForUser()
  // ==========================================================================

  describe('getHealthForUser()', () => {
    it('returns a SyncHealthReport filtered to the specified user', async () => {
      const scope = makeScope({
        id: SCOPE_ID_1,
        sync_status: 'synced',
        last_sync_at: new Date(),
        userId: USER_ID,
      });

      mockScopesFindMany.mockResolvedValue([scope]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(mockScopesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connections: { user_id: USER_ID },
          }),
        }),
      );
      expect(report.scopes).toHaveLength(1);
      expect(report.scopes[0].scopeId).toBe(SCOPE_ID_1);
    });

    it('normalizes userId to uppercase before querying', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      await service.getHealthForUser('user-12345678-1234-1234-1234-123456789abc');

      expect(mockScopesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connections: { user_id: 'USER-12345678-1234-1234-1234-123456789ABC' },
          }),
        }),
      );
    });

    it('classifies a scope with no issues as healthy', async () => {
      const recentDate = new Date();
      const scope = makeScope({
        sync_status: 'synced',
        last_sync_at: recentDate,
        updated_at: recentDate,
      });

      mockScopesFindMany.mockResolvedValue([scope]);
      mockFilesGroupBy.mockResolvedValue([
        { pipeline_status: 'ready', _count: 10 },
      ]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.scopes[0].healthStatus).toBe('healthy');
      expect(report.overallStatus).toBe('healthy');
      expect(report.summary.healthyScopes).toBe(1);
      expect(report.summary.degradedScopes).toBe(0);
      expect(report.summary.unhealthyScopes).toBe(0);
    });

    it('classifies a scope with only stale_sync as degraded', async () => {
      // last_sync_at is null — stale sync warning (severity: warning)
      const scope = makeScope({
        sync_status: 'synced',
        last_sync_at: null,
      });

      mockScopesFindMany.mockResolvedValue([scope]);
      mockFilesGroupBy.mockResolvedValue([
        { pipeline_status: 'ready', _count: 5 },
      ]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.scopes[0].healthStatus).toBe('degraded');
      expect(report.scopes[0].issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'stale_sync', severity: 'warning' }),
        ]),
      );
      expect(report.overallStatus).toBe('degraded');
      expect(report.summary.degradedScopes).toBe(1);
    });

    it('classifies a scope with error_state as unhealthy', async () => {
      const scope = makeScope({
        sync_status: 'error',
        last_sync_at: new Date(), // recent — avoid stale_sync
      });

      mockScopesFindMany.mockResolvedValue([scope]);
      mockFilesGroupBy.mockResolvedValue(emptyFileStats);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.scopes[0].healthStatus).toBe('unhealthy');
      expect(report.scopes[0].issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'error_state', severity: 'error' }),
        ]),
      );
      expect(report.overallStatus).toBe('unhealthy');
      expect(report.summary.unhealthyScopes).toBe(1);
    });

    it('classifies a stuck syncing scope as unhealthy', async () => {
      const stuckUpdatedAt = new Date(Date.now() - 15 * 60 * 1000);
      const scope = makeScope({
        sync_status: 'syncing',
        updated_at: stuckUpdatedAt,
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([scope]);
      mockFilesGroupBy.mockResolvedValue(emptyFileStats);

      // 500ms threshold — scope at 15min ago is definitely stuck
      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.scopes[0].healthStatus).toBe('unhealthy');
      expect(report.scopes[0].issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'stuck_syncing', severity: 'critical' }),
        ]),
      );
      expect(report.overallStatus).toBe('unhealthy');
    });

    it('classifies a scope with high failure rate as unhealthy', async () => {
      const scope = makeScope({
        sync_status: 'synced',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([scope]);
      // >50% failure rate: 10 ready, 12 failed = 54.5% failed
      mockFilesGroupBy.mockResolvedValue(highFailureFileStats);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.scopes[0].healthStatus).toBe('unhealthy');
      expect(report.scopes[0].issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'high_failure_rate', severity: 'error' }),
        ]),
      );
    });

    it('overall status is unhealthy when any scope is unhealthy', async () => {
      const healthyScope = makeScope({
        id: SCOPE_ID_1,
        sync_status: 'synced',
        last_sync_at: new Date(),
      });
      const unhealthyScope = makeScope({
        id: SCOPE_ID_2,
        sync_status: 'error',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([healthyScope, unhealthyScope]);
      mockFilesGroupBy.mockResolvedValue(emptyFileStats);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.overallStatus).toBe('unhealthy');
      expect(report.summary.totalScopes).toBe(2);
      expect(report.summary.healthyScopes).toBe(1);
      expect(report.summary.unhealthyScopes).toBe(1);
    });

    it('returns healthy report when user has no scopes', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.overallStatus).toBe('healthy');
      expect(report.summary.totalScopes).toBe(0);
      expect(report.scopes).toHaveLength(0);
    });

    it('includes timestamp in the report', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.timestamp).toBeInstanceOf(Date);
    });

    it('gracefully handles per-scope errors and returns partial report', async () => {
      const goodScope = makeScope({
        id: SCOPE_ID_1,
        sync_status: 'synced',
        last_sync_at: new Date(),
      });
      const badScope = makeScope({
        id: SCOPE_ID_2,
        sync_status: 'synced',
        last_sync_at: new Date(),
      });

      mockScopesFindMany.mockResolvedValue([goodScope, badScope]);

      // First scope succeeds, second fails
      mockFilesGroupBy
        .mockResolvedValueOnce(emptyFileStats)
        .mockRejectedValueOnce(new Error('DB timeout'));

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      // Should not throw
      const report = await service.getHealthForUser(USER_ID);

      // Only the good scope's report is included
      expect(report.scopes).toHaveLength(1);
      expect(report.scopes[0].scopeId).toBe(SCOPE_ID_1);
    });
  });

  // ==========================================================================
  // getHealthForUser() — stale sync detection
  // ==========================================================================

  describe('getHealthForUser() — stale sync detection', () => {
    it('flags a scope with last_sync_at older than 48h as stale', async () => {
      // 49 hours ago
      const staleDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
      const scope = makeScope({
        sync_status: 'synced',
        last_sync_at: staleDate,
      });

      mockScopesFindMany.mockResolvedValue([scope]);
      mockFilesGroupBy.mockResolvedValue([{ pipeline_status: 'ready', _count: 5 }]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      expect(report.scopes[0].issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'stale_sync', severity: 'warning' }),
        ]),
      );
    });

    it('does not flag a scope synced 24h ago as stale', async () => {
      // 24 hours ago — within the 48h window
      const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const scope = makeScope({
        sync_status: 'synced',
        last_sync_at: recentDate,
      });

      mockScopesFindMany.mockResolvedValue([scope]);
      mockFilesGroupBy.mockResolvedValue([{ pipeline_status: 'ready', _count: 5 }]);

      const service = new SyncHealthCheckService({ stuckThresholdMs: 500 });
      const report = await service.getHealthForUser(USER_ID);

      const staleIssues = report.scopes[0].issues.filter((i) => i.type === 'stale_sync');
      expect(staleIssues).toHaveLength(0);
    });
  });
});
