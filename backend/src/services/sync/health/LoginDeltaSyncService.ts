/**
 * LoginDeltaSyncService
 *
 * Enqueues delta sync jobs for stale scopes when a user logs in.
 * Fire-and-forget — errors are logged, never thrown.
 *
 * @module services/sync/health
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SCOPES_PER_LOGIN = 5;
const LOGIN_DELTA_COOLDOWN_SECONDS = 900; // 15 minutes
const LOGIN_DELTA_KEY_PREFIX = 'sync:login_delta:';

const logger = createChildLogger({ service: 'LoginDeltaSyncService' });

export interface LoginDeltaSyncResult {
  staleScopesFound: number;
  scopesEnqueued: number;
  scopesSkippedCooldown: number;
}

/**
 * Find stale scopes for a user and enqueue delta sync jobs.
 * Respects per-scope Redis cooldown to prevent duplicate syncs.
 */
export async function syncStaleScopes(userId: string): Promise<LoginDeltaSyncResult> {
  const staleScopes = await prisma.connection_scopes.findMany({
    where: {
      connections: {
        user_id: userId,
        status: 'connected',
      },
      sync_status: { in: ['synced', 'idle'] },
      last_sync_at: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
    },
    select: { id: true, connection_id: true, last_sync_at: true },
    orderBy: { last_sync_at: 'asc' },
    take: MAX_SCOPES_PER_LOGIN,
  });

  const result: LoginDeltaSyncResult = {
    staleScopesFound: staleScopes.length,
    scopesEnqueued: 0,
    scopesSkippedCooldown: 0,
  };

  if (staleScopes.length === 0) return result;

  const redis = getRedisClient();
  const mq = getMessageQueue();

  for (const scope of staleScopes) {
    const cooldownKey = `${LOGIN_DELTA_KEY_PREFIX}${scope.id.toUpperCase()}`;

    // Skip if on cooldown
    if (redis) {
      const ttl = await redis.ttl(cooldownKey);
      if (ttl > 0) {
        result.scopesSkippedCooldown++;
        continue;
      }
    }

    await mq.addExternalFileSyncJob({
      scopeId: scope.id,
      connectionId: scope.connection_id,
      userId,
      triggerType: 'polling',
    });

    // Set cooldown
    if (redis) {
      await redis.set(cooldownKey, '1', { EX: LOGIN_DELTA_COOLDOWN_SECONDS });
    }

    result.scopesEnqueued++;
  }

  logger.info({
    userId,
    ...result,
  }, 'Login delta sync completed');

  return result;
}
