/**
 * LoginDeltaSyncService Unit Tests
 *
 * Verifies stale scope detection, Redis cooldown per scope,
 * cap at 5 scopes, and fire-and-forget behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockScopesFindMany = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findMany: mockScopesFindMany,
    },
  },
}));

const mockRedisTtl = vi.hoisted(() => vi.fn());
const mockRedisSet = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/redis/redis-client', () => ({
  getRedisClient: vi.fn(() => ({
    ttl: mockRedisTtl,
    set: mockRedisSet,
  })),
}));

const mockAddExternalFileSyncJob = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addExternalFileSyncJob: mockAddExternalFileSyncJob,
  })),
}));

// ============================================================================
// Import AFTER mocks
// ============================================================================

import { syncStaleScopes } from '@/services/sync/health/LoginDeltaSyncService';

// ============================================================================
// Test constants
// ============================================================================

const USER_ID = 'USER-AAAA-BBBB-CCCC-DDDD';
const SCOPE_A = 'SCOPE-AAAA-1111-2222-3333';
const SCOPE_B = 'SCOPE-BBBB-1111-2222-3333';
const SCOPE_C = 'SCOPE-CCCC-1111-2222-3333';
const CONN_ID = 'CONN-AAAA-1111-2222-3333';

const makeScope = (id: string, minutesAgo: number) => ({
  id,
  connection_id: CONN_ID,
  last_sync_at: new Date(Date.now() - minutesAgo * 60 * 1000),
});

// ============================================================================
// Tests
// ============================================================================

describe('LoginDeltaSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScopesFindMany.mockResolvedValue([]);
    mockRedisTtl.mockResolvedValue(-2); // No cooldown
    mockRedisSet.mockResolvedValue('OK');
    mockAddExternalFileSyncJob.mockResolvedValue('job-id');
  });

  describe('syncStaleScopes()', () => {
    it('returns zero counts when no stale scopes found', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      const result = await syncStaleScopes(USER_ID);

      expect(result.staleScopesFound).toBe(0);
      expect(result.scopesEnqueued).toBe(0);
      expect(result.scopesSkippedCooldown).toBe(0);
      expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
    });

    it('enqueues delta sync for stale scopes', async () => {
      mockScopesFindMany.mockResolvedValue([
        makeScope(SCOPE_A, 30),
        makeScope(SCOPE_B, 20),
      ]);

      const result = await syncStaleScopes(USER_ID);

      expect(result.staleScopesFound).toBe(2);
      expect(result.scopesEnqueued).toBe(2);
      expect(mockAddExternalFileSyncJob).toHaveBeenCalledTimes(2);
      expect(mockAddExternalFileSyncJob).toHaveBeenCalledWith({
        scopeId: SCOPE_A,
        connectionId: CONN_ID,
        userId: USER_ID,
        triggerType: 'polling',
      });
    });

    it('skips scopes on Redis cooldown', async () => {
      mockScopesFindMany.mockResolvedValue([
        makeScope(SCOPE_A, 30),
        makeScope(SCOPE_B, 20),
      ]);

      // SCOPE_A on cooldown, SCOPE_B not
      mockRedisTtl.mockImplementation((key: string) => {
        if (key.includes(SCOPE_A)) return Promise.resolve(600); // On cooldown
        return Promise.resolve(-2); // Not on cooldown
      });

      const result = await syncStaleScopes(USER_ID);

      expect(result.scopesEnqueued).toBe(1);
      expect(result.scopesSkippedCooldown).toBe(1);
      expect(mockAddExternalFileSyncJob).toHaveBeenCalledTimes(1);
      expect(mockAddExternalFileSyncJob).toHaveBeenCalledWith(
        expect.objectContaining({ scopeId: SCOPE_B }),
      );
    });

    it('sets Redis cooldown after enqueuing (15 min TTL)', async () => {
      mockScopesFindMany.mockResolvedValue([makeScope(SCOPE_A, 30)]);

      await syncStaleScopes(USER_ID);

      expect(mockRedisSet).toHaveBeenCalledWith(
        `sync:login_delta:${SCOPE_A.toUpperCase()}`,
        '1',
        { EX: 900 },
      );
    });

    it('queries with correct filters (synced/idle, connected, staleness, cap 5)', async () => {
      mockScopesFindMany.mockResolvedValue([]);

      await syncStaleScopes(USER_ID);

      const queryArg = mockScopesFindMany.mock.calls[0][0];

      expect(queryArg.where.connections.user_id).toBe(USER_ID);
      expect(queryArg.where.connections.status).toBe('connected');
      expect(queryArg.where.sync_status).toEqual({ in: ['synced', 'idle'] });
      expect(queryArg.where.last_sync_at.lt).toBeInstanceOf(Date);
      expect(queryArg.orderBy).toEqual({ last_sync_at: 'asc' });
      expect(queryArg.take).toBe(5);
    });

    it('caps at 5 scopes per login (query enforces take: 5)', async () => {
      // Even if query somehow returns more, the take: 5 in Prisma enforces the cap
      // Here we verify the query parameter directly
      mockScopesFindMany.mockResolvedValue([]);

      await syncStaleScopes(USER_ID);

      expect(mockScopesFindMany.mock.calls[0][0].take).toBe(5);
    });

    it('enqueues scopes ordered by stalest first (oldest last_sync_at)', async () => {
      mockScopesFindMany.mockResolvedValue([
        makeScope(SCOPE_A, 60), // Stalest
        makeScope(SCOPE_B, 30),
        makeScope(SCOPE_C, 20), // Freshest
      ]);

      await syncStaleScopes(USER_ID);

      // Should enqueue in order returned by query (already sorted by asc)
      expect(mockAddExternalFileSyncJob.mock.calls[0][0].scopeId).toBe(SCOPE_A);
      expect(mockAddExternalFileSyncJob.mock.calls[1][0].scopeId).toBe(SCOPE_B);
      expect(mockAddExternalFileSyncJob.mock.calls[2][0].scopeId).toBe(SCOPE_C);
    });
  });
});
