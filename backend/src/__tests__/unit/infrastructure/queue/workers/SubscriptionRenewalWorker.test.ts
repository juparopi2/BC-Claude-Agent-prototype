/**
 * SubscriptionRenewalWorker Unit Tests (PRD-108, PRD-118)
 *
 * Tests the polling fallback (pollDelta) correctly finds stale scopes
 * with sync_status 'synced' (PRD-116+) in addition to legacy 'idle'.
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

const mockScopesFindMany = vi.hoisted(() => vi.fn());
const mockConnectionsFindUnique = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connection_scopes: {
      findMany: mockScopesFindMany,
    },
    connections: {
      findUnique: mockConnectionsFindUnique,
    },
  },
}));

const mockAddExternalFileSyncJob = vi.hoisted(() => vi.fn());
vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addExternalFileSyncJob: mockAddExternalFileSyncJob,
  })),
}));

const mockFindExpiringScopeSubscriptions = vi.hoisted(() => vi.fn());
const mockRenewSubscription = vi.hoisted(() => vi.fn());
const mockCreateSubscription = vi.hoisted(() => vi.fn());

vi.mock('@/services/sync/SubscriptionManager', () => ({
  getSubscriptionManager: vi.fn(() => ({
    findExpiringScopeSubscriptions: mockFindExpiringScopeSubscriptions,
    renewSubscription: mockRenewSubscription,
    createSubscription: mockCreateSubscription,
  })),
}));

vi.mock('@/infrastructure/config', () => ({
  env: {
    SUBSCRIPTION_RENEWAL_BUFFER_HOURS: 2,
  },
}));

// ============================================================================
// Import service AFTER mocks
// ============================================================================

import {
  getSubscriptionRenewalWorker,
  __resetSubscriptionRenewalWorker,
} from '@/infrastructure/queue/workers/SubscriptionRenewalWorker';
import type { Job } from 'bullmq';
import type { SubscriptionMgmtJob } from '@/infrastructure/queue/types/jobs.types';

// ============================================================================
// Test Constants
// ============================================================================

const CONNECTION_ID = 'CONN-1111-2222-3333-444444444444';
const SCOPE_ID = 'SCOPE-1111-2222-3333-444444444444';
const USER_ID = 'USER-1111-2222-3333-444444444444';

// ============================================================================
// Tests
// ============================================================================

describe('SubscriptionRenewalWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSubscriptionRenewalWorker();

    mockScopesFindMany.mockResolvedValue([]);
    mockFindExpiringScopeSubscriptions.mockResolvedValue([]);
    mockRenewSubscription.mockResolvedValue(undefined);
    mockCreateSubscription.mockResolvedValue(undefined);
    mockAddExternalFileSyncJob.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // pollDelta — sync_status filter (PRD-118 GAP 2)
  // ==========================================================================

  describe('pollDelta()', () => {
    it('queries for scopes with sync_status in [synced, idle]', async () => {
      const worker = getSubscriptionRenewalWorker();
      const job = { id: 'job-1', data: { type: 'poll-delta' } } as Job<SubscriptionMgmtJob>;

      await worker.process(job);

      expect(mockScopesFindMany).toHaveBeenCalledTimes(1);
      const queryArg = mockScopesFindMany.mock.calls[0][0] as {
        where: { sync_status: unknown };
      };

      // PRD-118: Must match both 'synced' (current post-sync status) and 'idle' (legacy)
      expect(queryArg.where.sync_status).toEqual({ in: ['synced', 'idle'] });
    });

    it('enqueues delta sync for stale synced scopes with active connections', async () => {
      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
      mockScopesFindMany.mockResolvedValue([
        {
          id: SCOPE_ID,
          connection_id: CONNECTION_ID,
          connections: { user_id: USER_ID, status: 'connected' },
        },
      ]);

      const worker = getSubscriptionRenewalWorker();
      const job = { id: 'job-1', data: { type: 'poll-delta' } } as Job<SubscriptionMgmtJob>;

      await worker.process(job);

      expect(mockAddExternalFileSyncJob).toHaveBeenCalledTimes(1);
      expect(mockAddExternalFileSyncJob).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeId: SCOPE_ID,
          connectionId: CONNECTION_ID,
          userId: USER_ID,
          triggerType: 'polling',
        })
      );
    });

    it('filters out disconnected connections', async () => {
      mockScopesFindMany.mockResolvedValue([
        {
          id: SCOPE_ID,
          connection_id: CONNECTION_ID,
          connections: { user_id: USER_ID, status: 'disconnected' },
        },
      ]);

      const worker = getSubscriptionRenewalWorker();
      const job = { id: 'job-1', data: { type: 'poll-delta' } } as Job<SubscriptionMgmtJob>;

      await worker.process(job);

      expect(mockAddExternalFileSyncJob).not.toHaveBeenCalled();
    });

    it('includes last_sync_cursor not null and last_sync_at threshold in query', async () => {
      const worker = getSubscriptionRenewalWorker();
      const job = { id: 'job-1', data: { type: 'poll-delta' } } as Job<SubscriptionMgmtJob>;

      const beforeCall = Date.now();
      await worker.process(job);

      const queryArg = mockScopesFindMany.mock.calls[0][0] as {
        where: {
          last_sync_cursor: { not: null };
          last_sync_at: { lt: Date };
        };
      };

      expect(queryArg.where.last_sync_cursor).toEqual({ not: null });
      expect(queryArg.where.last_sync_at.lt).toBeInstanceOf(Date);

      // Threshold should be approximately 30 minutes ago
      const threshold = queryArg.where.last_sync_at.lt;
      const expected30MinAgo = beforeCall - 30 * 60 * 1000;
      expect(threshold.getTime()).toBeGreaterThanOrEqual(expected30MinAgo - 1000);
      expect(threshold.getTime()).toBeLessThanOrEqual(expected30MinAgo + 2000);
    });
  });
});
