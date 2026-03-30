/**
 * StaleSyncRepairer Unit Tests (AD-6)
 *
 * Validates:
 *   1. Stale scope triggers delta sync (last_sync_at null or old)
 *   2. Cooldown prevents re-trigger
 *   3. Syncing/queued/error scopes are skipped (via DB filter, runtime guard)
 *   4. Disconnected connections are excluded (query filter)
 *   5. Max 3/run cap — 4th stale scope is not synced
 *   6. Redis fail-open — repair proceeds when Redis is unavailable
 *   7. Queue error counted, remaining scopes continue
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

const mockRedisTtl = vi.hoisted(() => vi.fn());
const mockRedisSet = vi.hoisted(() => vi.fn());
const mockGetRedisClient = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/redis/redis-client', () => ({
  getRedisClient: mockGetRedisClient,
}));

const mockConnectionScopesFindMany = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findMany: mockConnectionScopesFindMany,
    },
  },
}));

const mockAddExternalFileSyncJob = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addExternalFileSyncJob: mockAddExternalFileSyncJob,
  })),
}));

// ============================================================================
// Import AFTER mocks
// ============================================================================

import { StaleSyncRepairer } from '@/services/sync/health/repairers/StaleSyncRepairer';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const SCOPE_ID_1 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE01';
const SCOPE_ID_2 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE02';
const SCOPE_ID_3 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE03';
const SCOPE_ID_4 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE04';
const CONN_ID_1 = 'CONN-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE01';

// ============================================================================
// Helpers
// ============================================================================

function makeScopeRow(overrides?: {
  id?: string;
  connection_id?: string;
  sync_status?: string;
}) {
  return {
    id: overrides?.id ?? SCOPE_ID_1,
    connection_id: overrides?.connection_id ?? CONN_ID_1,
    sync_status: overrides?.sync_status ?? 'synced',
    connections: { id: overrides?.connection_id ?? CONN_ID_1 },
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default: Redis available, no cooldown active
  mockGetRedisClient.mockReturnValue({ ttl: mockRedisTtl, set: mockRedisSet });
  mockRedisTtl.mockResolvedValue(-2); // Key does not exist
  mockRedisSet.mockResolvedValue('OK');

  // Default: no stale scopes
  mockConnectionScopesFindMany.mockResolvedValue([]);

  // Default: queue succeeds
  mockAddExternalFileSyncJob.mockResolvedValue('job-id');
});

// ============================================================================
// Tests
// ============================================================================

describe('StaleSyncRepairer', () => {
  let repairer: StaleSyncRepairer;

  beforeEach(() => {
    repairer = new StaleSyncRepairer();
  });

  // ==========================================================================
  // No stale scopes
  // ==========================================================================

  it('returns zero counts when no stale scopes are found', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([]);

    const result = await repairer.repair(USER_ID);

    expect(result).toEqual({
      deltaSyncsTriggered: 0,
      scopesSkippedCooldown: 0,
      scopesSkippedSyncing: 0,
      errors: 0,
    });
    expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Successful delta sync trigger
  // ==========================================================================

  it('enqueues delta sync for a stale scope', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([makeScopeRow()]);

    const result = await repairer.repair(USER_ID);

    expect(result.deltaSyncsTriggered).toBe(1);
    expect(result.errors).toBe(0);

    expect(mockAddExternalFileSyncJob).toHaveBeenCalledOnce();
    expect(mockAddExternalFileSyncJob.mock.calls[0][0]).toMatchObject({
      scopeId: SCOPE_ID_1,
      connectionId: CONN_ID_1,
      userId: USER_ID,
      triggerType: 'delta',
    });
  });

  it('sets Redis cooldown after triggering delta sync', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([makeScopeRow({ id: SCOPE_ID_1 })]);

    await repairer.repair(USER_ID);

    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [key, value, opts] = mockRedisSet.mock.calls[0];
    expect(key).toBe(`sync:stale_resync:${SCOPE_ID_1}`);
    expect(value).toBe('1');
    expect(opts).toMatchObject({ EX: 21600 });
  });

  it('checks cooldown key using UPPERCASE scope ID', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([
      makeScopeRow({ id: 'scop-lowercase-id' }),
    ]);

    await repairer.repair(USER_ID);

    expect(mockRedisTtl).toHaveBeenCalledOnce();
    const key = mockRedisTtl.mock.calls[0][0];
    expect(key).toBe('sync:stale_resync:SCOP-LOWERCASE-ID');
  });

  // ==========================================================================
  // Cooldown prevents re-trigger
  // ==========================================================================

  it('skips scope and increments scopesSkippedCooldown when cooldown is active', async () => {
    mockRedisTtl.mockResolvedValue(3600); // 1 hour remaining

    mockConnectionScopesFindMany.mockResolvedValue([makeScopeRow()]);

    const result = await repairer.repair(USER_ID);

    expect(result.deltaSyncsTriggered).toBe(0);
    expect(result.scopesSkippedCooldown).toBe(1);
    expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Runtime guard for syncing/queued/error scopes
  // ==========================================================================

  it('skips a scope in syncing status at runtime and increments scopesSkippedSyncing', async () => {
    // Even though DB filter excludes these, test the runtime guard
    mockConnectionScopesFindMany.mockResolvedValue([
      makeScopeRow({ sync_status: 'syncing' }),
    ]);

    const result = await repairer.repair(USER_ID);

    expect(result.deltaSyncsTriggered).toBe(0);
    expect(result.scopesSkippedSyncing).toBe(1);
    expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
  });

  it('skips a scope in sync_queued status at runtime', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([
      makeScopeRow({ sync_status: 'sync_queued' }),
    ]);

    const result = await repairer.repair(USER_ID);

    expect(result.scopesSkippedSyncing).toBe(1);
    expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
  });

  it('skips a scope in error status at runtime', async () => {
    mockConnectionScopesFindMany.mockResolvedValue([
      makeScopeRow({ sync_status: 'error' }),
    ]);

    const result = await repairer.repair(USER_ID);

    expect(result.scopesSkippedSyncing).toBe(1);
    expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Max 3/run cap
  // ==========================================================================

  it('caps delta syncs at 3 per run, leaving remaining scopes untriggered', async () => {
    const fourScopes = [
      makeScopeRow({ id: SCOPE_ID_1 }),
      makeScopeRow({ id: SCOPE_ID_2 }),
      makeScopeRow({ id: SCOPE_ID_3 }),
      makeScopeRow({ id: SCOPE_ID_4 }),
    ];

    mockConnectionScopesFindMany.mockResolvedValue(fourScopes);

    const result = await repairer.repair(USER_ID);

    expect(result.deltaSyncsTriggered).toBe(3);
    expect(mockAddExternalFileSyncJob).toHaveBeenCalledTimes(3);
  });

  it('stops iterating after cap is reached (does not attempt 4th scope)', async () => {
    const fourScopes = [
      makeScopeRow({ id: SCOPE_ID_1 }),
      makeScopeRow({ id: SCOPE_ID_2 }),
      makeScopeRow({ id: SCOPE_ID_3 }),
      makeScopeRow({ id: SCOPE_ID_4 }),
    ];

    mockConnectionScopesFindMany.mockResolvedValue(fourScopes);

    await repairer.repair(USER_ID);

    // Only 3 cooldown TTL checks (one per scope) — 4th is never reached
    expect(mockRedisTtl).toHaveBeenCalledTimes(3);
  });

  // ==========================================================================
  // Redis fail-open
  // ==========================================================================

  it('proceeds with repair when Redis client is unavailable (getRedisClient returns null)', async () => {
    mockGetRedisClient.mockReturnValue(null);

    mockConnectionScopesFindMany.mockResolvedValue([makeScopeRow()]);

    const result = await repairer.repair(USER_ID);

    expect(result.deltaSyncsTriggered).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('proceeds with repair when Redis ttl throws (fail-open)', async () => {
    mockRedisTtl.mockRejectedValue(new Error('Redis timeout'));

    mockConnectionScopesFindMany.mockResolvedValue([makeScopeRow()]);

    const result = await repairer.repair(USER_ID);

    expect(result.deltaSyncsTriggered).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('continues with remaining scopes when Redis set throws after successful enqueue', async () => {
    mockRedisSet.mockRejectedValue(new Error('Redis write failed'));

    const twoScopes = [
      makeScopeRow({ id: SCOPE_ID_1 }),
      makeScopeRow({ id: SCOPE_ID_2 }),
    ];

    mockConnectionScopesFindMany.mockResolvedValue(twoScopes);

    // Both should still be triggered — Redis set failure is best-effort
    const result = await repairer.repair(USER_ID);

    expect(result.deltaSyncsTriggered).toBe(2);
    expect(result.errors).toBe(0);
  });

  // ==========================================================================
  // Queue error handling
  // ==========================================================================

  it('counts errors when queue throws and continues with remaining scopes', async () => {
    mockAddExternalFileSyncJob
      .mockRejectedValueOnce(new Error('Queue unavailable'))
      .mockResolvedValue('job-id');

    const twoScopes = [
      makeScopeRow({ id: SCOPE_ID_1 }),
      makeScopeRow({ id: SCOPE_ID_2 }),
    ];

    mockConnectionScopesFindMany.mockResolvedValue(twoScopes);

    const result = await repairer.repair(USER_ID);

    expect(result.errors).toBe(1);
    expect(result.deltaSyncsTriggered).toBe(1); // second scope succeeded
  });

  // ==========================================================================
  // Query shape
  // ==========================================================================

  it('queries scopes for the correct userId and only connected connections', async () => {
    await repairer.repair(USER_ID);

    expect(mockConnectionScopesFindMany).toHaveBeenCalledOnce();
    const queryArg = mockConnectionScopesFindMany.mock.calls[0][0];

    expect(queryArg.where.connections).toMatchObject({
      user_id: USER_ID,
      status: 'connected',
    });
    expect(queryArg.where.sync_status).toMatchObject({
      notIn: expect.arrayContaining(['syncing', 'sync_queued', 'error']),
    });
    expect(queryArg.where.OR).toEqual(
      expect.arrayContaining([
        { last_sync_at: null },
        expect.objectContaining({ last_sync_at: expect.objectContaining({ lt: expect.any(Date) }) }),
      ]),
    );
  });
});
