/**
 * ScopeIntegrityRepairer
 *
 * Repairs scope integrity issues detected by ScopeIntegrityDetector.
 *
 * Repair strategy per scope:
 *   1. Check Redis cooldown (sync:scope_integrity_resync:{SCOPE_ID}) — skip if active
 *   2. Enforce run cap of MAX_REPAIRS_PER_RUN — skip remaining if exceeded
 *   3. Clear last_sync_cursor → forces full initial sync on next run
 *   4. Enqueue initial sync job via getMessageQueue().addInitialSyncJob()
 *   5. Set Redis cooldown (TTL = 30 min) — fail-open on Redis errors
 *
 * @module services/sync/health/repairers
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import type { ScopeIntegrityRow, ScopeIntegrityRepairs } from '../types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_REPAIRS_PER_RUN = 5;
const SCOPE_INTEGRITY_COOLDOWN_PREFIX = 'sync:scope_integrity_resync:';
const SCOPE_INTEGRITY_COOLDOWN_SECONDS = 1800; // 30 minutes

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class ScopeIntegrityRepairer {
  private readonly logger = createChildLogger({ service: 'ScopeIntegrityRepairer' });

  /**
   * Repair scope integrity issues by re-triggering initial sync.
   *
   * @param userId - Owning user (used for queue job payload)
   * @param scopes - Issues detected by ScopeIntegrityDetector
   * @returns Repair counts
   */
  async repair(userId: string, scopes: ScopeIntegrityRow[]): Promise<ScopeIntegrityRepairs> {
    const repairs: ScopeIntegrityRepairs = {
      resyncsTriggered: 0,
      scopesSkippedCooldown: 0,
      scopesSkippedCap: 0,
      errors: 0,
    };

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const scope of scopes) {
      // ── Run cap ────────────────────────────────────────────────────────────
      if (repairs.resyncsTriggered >= MAX_REPAIRS_PER_RUN) {
        repairs.scopesSkippedCap++;
        this.logger.warn(
          { scopeId: scope.scopeId, reason: scope.reason },
          'ScopeIntegrityRepairer: run cap reached, skipping scope',
        );
        continue;
      }

      // ── Redis cooldown ─────────────────────────────────────────────────────
      if (await this.isCooldownActive(scope.scopeId)) {
        repairs.scopesSkippedCooldown++;
        this.logger.debug(
          { scopeId: scope.scopeId },
          'ScopeIntegrityRepairer: scope on cooldown, skipping',
        );
        continue;
      }

      try {
        // Clear delta cursor — forces InitialSyncService to rebuild from scratch
        await prisma.connection_scopes.update({
          where: { id: scope.scopeId },
          data: { last_sync_cursor: null },
        });

        // Enqueue initial sync job
        await getMessageQueue().addInitialSyncJob({
          scopeId: scope.scopeId,
          connectionId: scope.connectionId,
          userId,
        });

        // Set cooldown — fail-open on Redis errors
        await this.setCooldown(scope.scopeId);

        repairs.resyncsTriggered++;

        this.logger.info(
          { scopeId: scope.scopeId, reason: scope.reason, scopeName: scope.scopeName },
          'ScopeIntegrityRepairer: triggered resync',
        );
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { scopeId: scope.scopeId, error: errorInfo },
          'ScopeIntegrityRepairer: failed to trigger resync',
        );
        repairs.errors++;
      }
    }

    return repairs;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — Redis cooldown helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** Check if a scope's integrity resync is on cooldown. Fail-open. */
  private async isCooldownActive(scopeId: string): Promise<boolean> {
    const client = getRedisClient();
    if (!client) return false;

    try {
      const key = `${SCOPE_INTEGRITY_COOLDOWN_PREFIX}${scopeId.toUpperCase()}`;
      const ttl = await client.ttl(key);
      return ttl > 0;
    } catch {
      return false; // Fail open
    }
  }

  /** Set cooldown for a scope after a resync is triggered. Best-effort. */
  private async setCooldown(scopeId: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
      const key = `${SCOPE_INTEGRITY_COOLDOWN_PREFIX}${scopeId.toUpperCase()}`;
      await client.set(key, '1', { EX: SCOPE_INTEGRITY_COOLDOWN_SECONDS });
    } catch {
      // Best-effort — fail open
    }
  }
}
