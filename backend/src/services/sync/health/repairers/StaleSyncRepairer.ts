/**
 * StaleSyncRepairer (AD-6)
 *
 * Self-contained proactive repairer for scopes that have not synced recently
 * (last_sync_at IS NULL or older than 48h) and are not currently syncing.
 *
 * Repair strategy per scope:
 *   1. Query stale scopes (last_sync_at IS NULL or < now - 48h, not syncing/queued/error,
 *      connection.status = 'connected', connection.user_id = userId)
 *   2. For each scope (max 3 per run):
 *      a. Check Redis cooldown: key `sync:stale_resync:{SCOPE_ID}` — skip if active
 *      b. Enqueue delta sync via getMessageQueue().addExternalFileSyncJob()
 *      c. Set Redis cooldown (TTL = 21600s / 6 hours)
 *      d. Increment deltaSyncsTriggered
 *   3. Redis fail-open on errors
 *
 * @module services/sync/health/repairers
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import type { StaleSyncRepairs } from '../types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_REPAIRS_PER_RUN = 3;
const STALE_SYNC_COOLDOWN_PREFIX = 'sync:stale_resync:';
const STALE_SYNC_COOLDOWN_SECONDS = 21_600; // 6 hours
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const SKIPPED_SYNC_STATUSES = ['syncing', 'sync_queued', 'error'];

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class StaleSyncRepairer {
  private readonly logger = createChildLogger({ service: 'StaleSyncRepairer' });

  /**
   * Detect and repair stale scopes by triggering delta sync.
   *
   * Self-contained: performs its own detection query to avoid coupling to
   * a separate detector (AD-6 pattern — low frequency, bounded scope).
   *
   * @param userId - Owning user (UPPERCASE UUID)
   * @returns Repair counts
   */
  async repair(userId: string): Promise<StaleSyncRepairs> {
    const repairs: StaleSyncRepairs = {
      deltaSyncsTriggered: 0,
      scopesSkippedCooldown: 0,
      scopesSkippedSyncing: 0,
      errors: 0,
    };

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    // Query stale scopes — must be on a connected connection owned by this user
    const staleScopes = await prisma.connection_scopes.findMany({
      where: {
        connections: {
          user_id: userId,
          status: 'connected',
        },
        sync_status: {
          notIn: SKIPPED_SYNC_STATUSES,
        },
        OR: [
          { last_sync_at: null },
          { last_sync_at: { lt: staleCutoff } },
        ],
      },
      select: {
        id: true,
        connection_id: true,
        sync_status: true,
        connections: {
          select: { id: true },
        },
      },
    });

    this.logger.debug(
      { userId, staleScopeCount: staleScopes.length },
      'StaleSyncRepairer: stale scopes detected',
    );

    for (const scope of staleScopes) {
      // ── Run cap ────────────────────────────────────────────────────────────
      if (repairs.deltaSyncsTriggered >= MAX_REPAIRS_PER_RUN) {
        break;
      }

      // ── Runtime guard: skip active sync statuses ───────────────────────────
      // Defensive: query filter already excludes these, but guard handles
      // any edge cases from concurrent status transitions.
      if (SKIPPED_SYNC_STATUSES.includes(scope.sync_status)) {
        repairs.scopesSkippedSyncing++;
        continue;
      }

      // ── Redis cooldown ─────────────────────────────────────────────────────
      if (await this.isCooldownActive(scope.id)) {
        repairs.scopesSkippedCooldown++;
        this.logger.debug(
          { scopeId: scope.id },
          'StaleSyncRepairer: scope on cooldown, skipping',
        );
        continue;
      }

      try {
        // Enqueue delta sync to catch up on missed changes
        await getMessageQueue().addExternalFileSyncJob({
          scopeId: scope.id,
          connectionId: scope.connection_id,
          userId,
          triggerType: 'delta',
        });

        // Set cooldown — fail-open on Redis errors
        await this.setCooldown(scope.id);

        repairs.deltaSyncsTriggered++;

        this.logger.info(
          { scopeId: scope.id, connectionId: scope.connection_id, userId },
          'StaleSyncRepairer: triggered delta sync for stale scope',
        );
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { scopeId: scope.id, error: errorInfo },
          'StaleSyncRepairer: failed to trigger delta sync',
        );
        repairs.errors++;
      }
    }

    return repairs;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — Redis cooldown helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** Check if a scope's stale resync is on cooldown. Fail-open. */
  private async isCooldownActive(scopeId: string): Promise<boolean> {
    const client = getRedisClient();
    if (!client) return false;

    try {
      const key = `${STALE_SYNC_COOLDOWN_PREFIX}${scopeId.toUpperCase()}`;
      const ttl = await client.ttl(key);
      return ttl > 0;
    } catch {
      return false; // Fail open
    }
  }

  /** Set cooldown for a scope after a delta sync is triggered. Best-effort. */
  private async setCooldown(scopeId: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
      const key = `${STALE_SYNC_COOLDOWN_PREFIX}${scopeId.toUpperCase()}`;
      await client.set(key, '1', { EX: STALE_SYNC_COOLDOWN_SECONDS });
    } catch {
      // Best-effort — fail open
    }
  }
}
