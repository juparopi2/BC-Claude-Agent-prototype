/**
 * SubscriptionRenewalWorker (PRD-108)
 *
 * Handles two job types:
 * - renew-subscriptions: Renews expiring Graph API subscriptions
 * - poll-delta: Polling fallback for missed webhooks
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { SubscriptionMgmtJob } from '../types/jobs.types';
import { JOB_NAMES } from '../constants';

export class SubscriptionRenewalWorker {
  private readonly log: ILoggerMinimal;

  constructor(deps?: { logger?: ILoggerMinimal }) {
    this.log = deps?.logger ?? createChildLogger({ service: 'SubscriptionRenewalWorker' });
  }

  async process(job: Job<SubscriptionMgmtJob>): Promise<void> {
    const { type } = job.data;

    this.log.info({ jobId: job.id, type }, 'Processing subscription management job');

    switch (type) {
      case JOB_NAMES.SUBSCRIPTION_MGMT.RENEW:
        await this.renewExpiring();
        break;
      case JOB_NAMES.SUBSCRIPTION_MGMT.POLL:
        await this.pollDelta();
        break;
      default:
        this.log.warn({ type }, 'Unknown subscription management job type');
    }
  }

  private async renewExpiring(): Promise<void> {
    const { getSubscriptionManager } = await import('@/services/sync/SubscriptionManager');
    const { env } = await import('@/infrastructure/config');
    const manager = getSubscriptionManager();

    const expiring = await manager.findExpiringScopeSubscriptions(env.SUBSCRIPTION_RENEWAL_BUFFER_HOURS);

    this.log.info({ count: expiring.length }, 'Found expiring subscriptions');

    for (const scope of expiring) {
      try {
        await manager.renewSubscription(scope.id);
        this.log.info({ scopeId: scope.id }, 'Subscription renewed');
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };

        // Token expired — skip this scope entirely
        if (error instanceof Error && error.name === 'ConnectionTokenExpiredError') {
          this.log.warn({ scopeId: scope.id, connectionId: scope.connection_id }, 'Token expired — skipping scope');
          continue;
        }

        // If 404, subscription expired — recreate and trigger sync
        if (error instanceof Error && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404) {
          this.log.warn({ scopeId: scope.id }, 'Subscription expired (404) — recreating');
          try {
            await manager.createSubscription(scope.connection_id, scope.id);
            await this.enqueueDeltaSync(scope.id, scope.connection_id);
          } catch (recreateErr) {
            const recreateInfo = recreateErr instanceof Error
              ? { message: recreateErr.message, name: recreateErr.name }
              : { value: String(recreateErr) };
            this.log.error({ error: recreateInfo, scopeId: scope.id }, 'Failed to recreate subscription');
          }
        } else {
          this.log.error({ error: errorInfo, scopeId: scope.id }, 'Failed to renew subscription');
        }
      }
    }
  }

  private async pollDelta(): Promise<void> {
    const { prisma } = await import('@/infrastructure/database/prisma');

    // Find scopes that haven't synced recently and are idle
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    const staleScopeRows = await prisma.connection_scopes.findMany({
      where: {
        sync_status: { in: ['synced', 'idle'] },
        last_sync_cursor: { not: null },
        last_sync_at: { lt: staleThreshold },
      },
      select: {
        id: true,
        connection_id: true,
        connections: { select: { user_id: true, status: true } },
      },
    });

    // Filter to only connected connections
    const staleScopes = staleScopeRows.filter(s => s.connections.status === 'connected');

    this.log.info({ count: staleScopes.length }, 'Found stale scopes for polling');

    for (const scope of staleScopes) {
      try {
        await this.enqueueDeltaSync(scope.id, scope.connection_id, scope.connections.user_id);
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        this.log.warn({ error: errorInfo, scopeId: scope.id }, 'Failed to enqueue polling sync');
      }
    }
  }

  private async enqueueDeltaSync(scopeId: string, connectionId: string, userId?: string): Promise<void> {
    const { getMessageQueue } = await import('@/infrastructure/queue');

    // If userId not provided, look it up
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const { prisma } = await import('@/infrastructure/database/prisma');
      const connection = await prisma.connections.findUnique({
        where: { id: connectionId },
        select: { user_id: true },
      });
      resolvedUserId = connection?.user_id;
    }

    if (!resolvedUserId) {
      this.log.warn({ scopeId, connectionId }, 'Cannot enqueue delta sync — no userId found');
      return;
    }

    await getMessageQueue().addExternalFileSyncJob({
      scopeId,
      connectionId,
      userId: resolvedUserId,
      triggerType: 'polling',
    });
  }
}

// Singleton
let instance: SubscriptionRenewalWorker | undefined;

export function getSubscriptionRenewalWorker(deps?: { logger?: ILoggerMinimal }): SubscriptionRenewalWorker {
  if (!instance) {
    instance = new SubscriptionRenewalWorker(deps);
  }
  return instance;
}

export function __resetSubscriptionRenewalWorker(): void {
  instance = undefined;
}
