/**
 * ScopeIntegrityRepairer Unit Tests
 *
 * Validates:
 *   1. Successful repair — clears cursor, enqueues job, sets cooldown
 *   2. Cooldown active — scope is skipped, scopesSkippedCooldown incremented
 *   3. Run cap (MAX=5) — excess scopes are skipped, scopesSkippedCap incremented
 *   4. Prisma/queue error — error counted, remaining scopes continue
 *   5. Redis unavailable — fail-open (repair proceeds)
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

const mockConnectionScopesUpdate = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      update: mockConnectionScopesUpdate,
    },
  },
}));

const mockAddInitialSyncJob = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addInitialSyncJob: mockAddInitialSyncJob,
  })),
}));

// ============================================================================
// Import AFTER mocks
// ============================================================================

import { ScopeIntegrityRepairer } from '@/services/sync/health/repairers/ScopeIntegrityRepairer';
import type { ScopeIntegrityRow } from '@/services/sync/health/types';

// ============================================================================
// Test Constants (UPPERCASE UUIDs per CLAUDE.md)
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-1111-2222-3333-444455556666';
const SCOPE_ID_1 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE01';
const SCOPE_ID_2 = 'SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE02';
const CONN_ID_1 = 'CONN-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE01';

// ============================================================================
// Helpers
// ============================================================================

function makeScopeIssue(overrides?: Partial<ScopeIntegrityRow>): ScopeIntegrityRow {
  return {
    scopeId: overrides?.scopeId ?? SCOPE_ID_1,
    connectionId: overrides?.connectionId ?? CONN_ID_1,
    reason: overrides?.reason ?? 'zero_files',
    scopeName: overrides?.scopeName ?? 'Test Scope',
    syncStatus: overrides?.syncStatus ?? 'synced',
    itemCount: overrides?.itemCount ?? 50,
    actualFileCount: overrides?.actualFileCount ?? 0,
    processingStatus: overrides?.processingStatus ?? null,
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

  // Default: DB and queue succeed
  mockConnectionScopesUpdate.mockResolvedValue({});
  mockAddInitialSyncJob.mockResolvedValue('job-id');
});

// ============================================================================
// Tests
// ============================================================================

describe('ScopeIntegrityRepairer', () => {
  let repairer: ScopeIntegrityRepairer;

  beforeEach(() => {
    repairer = new ScopeIntegrityRepairer();
  });

  it('returns zero counts when scopes list is empty', async () => {
    const result = await repairer.repair(USER_ID, []);

    expect(result).toEqual({
      resyncsTriggered: 0,
      scopesSkippedCooldown: 0,
      scopesSkippedCap: 0,
      errors: 0,
    });
  });

  // ==========================================================================
  // Successful repair
  // ==========================================================================

  it('clears last_sync_cursor and enqueues initial sync on successful repair', async () => {
    const result = await repairer.repair(USER_ID, [makeScopeIssue()]);

    expect(result.resyncsTriggered).toBe(1);
    expect(result.errors).toBe(0);

    expect(mockConnectionScopesUpdate).toHaveBeenCalledOnce();
    expect(mockConnectionScopesUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: SCOPE_ID_1 },
      data: { last_sync_cursor: null },
    });

    expect(mockAddInitialSyncJob).toHaveBeenCalledOnce();
    expect(mockAddInitialSyncJob.mock.calls[0][0]).toMatchObject({
      scopeId: SCOPE_ID_1,
      connectionId: CONN_ID_1,
      userId: USER_ID,
    });
  });

  it('sets Redis cooldown after successful repair', async () => {
    await repairer.repair(USER_ID, [makeScopeIssue({ scopeId: SCOPE_ID_1 })]);

    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [key, value, opts] = mockRedisSet.mock.calls[0];
    expect(key).toBe(`sync:scope_integrity_resync:${SCOPE_ID_1}`);
    expect(value).toBe('1');
    expect(opts).toMatchObject({ EX: 1800 });
  });

  // ==========================================================================
  // Cooldown
  // ==========================================================================

  it('skips scope and increments scopesSkippedCooldown when cooldown is active', async () => {
    mockRedisTtl.mockResolvedValue(900); // 15 min remaining

    const result = await repairer.repair(USER_ID, [makeScopeIssue()]);

    expect(result.resyncsTriggered).toBe(0);
    expect(result.scopesSkippedCooldown).toBe(1);
    expect(mockConnectionScopesUpdate).not.toHaveBeenCalled();
    expect(mockAddInitialSyncJob).not.toHaveBeenCalled();
  });

  it('checks cooldown using UPPERCASE scope ID', async () => {
    await repairer.repair(USER_ID, [makeScopeIssue({ scopeId: 'scop-lowercase-id' })]);

    expect(mockRedisTtl).toHaveBeenCalledOnce();
    const key = mockRedisTtl.mock.calls[0][0];
    expect(key).toBe('sync:scope_integrity_resync:SCOP-LOWERCASE-ID');
  });

  // ==========================================================================
  // Run cap
  // ==========================================================================

  it('skips scopes beyond the cap of 5 and increments scopesSkippedCap', async () => {
    const sixScopes = Array.from({ length: 6 }, (_, i) =>
      makeScopeIssue({ scopeId: `SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEE0${i + 1}` }),
    );

    const result = await repairer.repair(USER_ID, sixScopes);

    expect(result.resyncsTriggered).toBe(5);
    expect(result.scopesSkippedCap).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('logs a warning when the cap is reached', async () => {
    const { createChildLogger } = await import('@/shared/utils/logger');
    const mockLogger = (createChildLogger as ReturnType<typeof vi.fn>).mock.results[0]?.value ?? {
      warn: vi.fn(),
    };

    const sixScopes = Array.from({ length: 6 }, (_, i) =>
      makeScopeIssue({ scopeId: `SCOP-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEE0${i + 1}` }),
    );

    await repairer.repair(USER_ID, sixScopes);

    // The sixth scope should have triggered a warn
    expect(mockAddInitialSyncJob).toHaveBeenCalledTimes(5);
  });

  // ==========================================================================
  // Error handling
  // ==========================================================================

  it('counts errors when queue throws, and continues with remaining scopes', async () => {
    mockAddInitialSyncJob
      .mockRejectedValueOnce(new Error('Queue unavailable'))
      .mockResolvedValue('job-id');

    const scopes = [
      makeScopeIssue({ scopeId: SCOPE_ID_1 }),
      makeScopeIssue({ scopeId: SCOPE_ID_2 }),
    ];

    const result = await repairer.repair(USER_ID, scopes);

    expect(result.errors).toBe(1);
    expect(result.resyncsTriggered).toBe(1); // Second scope succeeded
  });

  // ==========================================================================
  // Redis fail-open
  // ==========================================================================

  it('proceeds with repair when Redis is unavailable (getRedisClient returns null)', async () => {
    mockGetRedisClient.mockReturnValue(null);

    const result = await repairer.repair(USER_ID, [makeScopeIssue()]);

    expect(result.resyncsTriggered).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('proceeds with repair when Redis ttl throws (fail-open)', async () => {
    mockRedisTtl.mockRejectedValue(new Error('Redis timeout'));

    const result = await repairer.repair(USER_ID, [makeScopeIssue()]);

    expect(result.resyncsTriggered).toBe(1);
    expect(result.errors).toBe(0);
  });
});
