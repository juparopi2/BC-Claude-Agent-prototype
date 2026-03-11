/**
 * Webhook Routes (PRD-108)
 *
 * PUBLIC endpoints — no authenticateMicrosoft middleware.
 * Security is enforced by validating `clientState` against the database.
 *
 * Endpoints:
 * - POST /api/webhooks/graph           → Microsoft Graph change notifications
 * - POST /api/webhooks/graph/lifecycle → Microsoft Graph lifecycle notifications
 *
 * @module routes/webhooks
 */

import { Router, Request, Response } from 'express';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { getMessageQueue } from '@/infrastructure/queue';

const logger = createChildLogger({ service: 'WebhookRoutes' });
const router = Router();

// ============================================================================
// Local types
// ============================================================================

/**
 * Shape of a single change notification from Microsoft Graph.
 * https://learn.microsoft.com/en-us/graph/webhooks#notification-payload
 */
interface GraphNotification {
  subscriptionId: string;
  clientState: string;
  changeType: string;
  resource: string;
  tenantId: string;
  subscriptionExpirationDateTime: string;
}

/**
 * Shape of a single lifecycle notification from Microsoft Graph.
 * https://learn.microsoft.com/en-us/graph/webhooks-lifecycle
 */
interface LifecycleNotification {
  subscriptionId: string;
  clientState: string;
  lifecycleEvent: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed';
  resource: string;
}

/**
 * Scope row shape returned by the raw SQL query below.
 * We use $queryRaw (instead of Prisma typed queries) to keep the webhook
 * handler decoupled from Prisma client generation timing.
 */
interface ScopeWithClientState {
  id: string;
  connection_id: string;
  /** nullable in DB, may be absent from generated types */
  client_state: string | null;
  connections: {
    user_id: string;
  };
}

// ============================================================================
// Route: POST /graph
// Handles change notifications and the initial validation handshake.
// ============================================================================

router.post('/graph', async (req: Request, res: Response): Promise<void> => {
  // --- Validation handshake ---
  // Microsoft sends validationToken when creating a subscription.
  // Must respond within 10 seconds with 200 text/plain containing the token.
  if (req.query.validationToken) {
    const token = decodeURIComponent(req.query.validationToken as string);
    logger.info('Graph webhook validation handshake received');
    res.status(200).contentType('text/plain').send(token);
    return;
  }

  // --- Notification processing ---
  // Respond 202 immediately — Microsoft requires a fast response (<10s).
  res.status(202).end();

  const notifications: GraphNotification[] = Array.isArray(req.body?.value)
    ? (req.body.value as GraphNotification[])
    : [];

  if (notifications.length === 0) {
    logger.warn('Graph webhook received with no notifications in body');
    return;
  }

  logger.info({ notificationCount: notifications.length, notifications: notifications.map(n => ({
    subscriptionId: n.subscriptionId, changeType: n.changeType, resource: n.resource,
  })) }, 'Graph webhook notifications received');

  for (const notification of notifications) {
    try {
      // 1. Look up scope by subscriptionId.
      //    Use $queryRaw to access client_state which exists in the DB but is
      //    missing from the stale generated Prisma client types.
      const rows = await prisma.$queryRaw<ScopeWithClientState[]>`
        SELECT
          cs.id,
          cs.connection_id,
          cs.client_state,
          c.user_id AS [connections.user_id]
        FROM connection_scopes cs
        INNER JOIN connections c ON c.id = cs.connection_id
        WHERE cs.subscription_id = ${notification.subscriptionId}
      `;

      // Prisma raw results use flat column aliases — reshape to nested shape.
      const rawRow = rows[0] as (ScopeWithClientState & Record<string, unknown>) | undefined;
      const scope: ScopeWithClientState | null = rawRow
        ? {
            id: (rawRow['id'] as string).toUpperCase(),
            connection_id: (rawRow['connection_id'] as string).toUpperCase(),
            client_state: rawRow['client_state'] as string | null,
            connections: {
              user_id: (rawRow['connections.user_id'] as string).toUpperCase(),
            },
          }
        : null;

      if (!scope) {
        logger.warn(
          { subscriptionId: notification.subscriptionId },
          'Webhook: no scope found for subscription'
        );
        continue;
      }

      // 2. Validate clientState to prevent spoofed notifications
      if (scope.client_state !== notification.clientState) {
        logger.warn(
          { subscriptionId: notification.subscriptionId },
          'Webhook: clientState mismatch — rejecting'
        );
        continue;
      }

      // 3. Enqueue delta sync with jobId-based deduplication
      const messageQueue = getMessageQueue();
      await messageQueue.addExternalFileSyncJob({
        scopeId: scope.id,
        connectionId: scope.connection_id,
        userId: scope.connections.user_id,
        triggerType: 'webhook',
      });

      logger.info(
        { scopeId: scope.id, connectionId: scope.connection_id },
        'Webhook: delta sync enqueued'
      );
    } catch (err) {
      const errorInfo =
        err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
      logger.error(
        { error: errorInfo, subscriptionId: notification.subscriptionId },
        'Webhook: failed to process notification'
      );
    }
  }
});

// ============================================================================
// Route: POST /graph/lifecycle
// Handles lifecycle notifications (reauthorization, removal, missed).
// ============================================================================

router.post('/graph/lifecycle', async (req: Request, res: Response): Promise<void> => {
  // --- Validation handshake (same pattern as /graph) ---
  if (req.query.validationToken) {
    const token = decodeURIComponent(req.query.validationToken as string);
    logger.info('Graph lifecycle webhook validation handshake received');
    res.status(200).contentType('text/plain').send(token);
    return;
  }

  // Respond 202 immediately
  res.status(202).end();

  const notifications: LifecycleNotification[] = Array.isArray(req.body?.value)
    ? (req.body.value as LifecycleNotification[])
    : [];

  if (notifications.length === 0) {
    logger.warn('Graph lifecycle webhook received with no notifications in body');
    return;
  }

  for (const notification of notifications) {
    try {
      // 1. Look up scope by subscriptionId (same raw query pattern as /graph handler)
      const rows = await prisma.$queryRaw<ScopeWithClientState[]>`
        SELECT
          cs.id,
          cs.connection_id,
          cs.client_state,
          c.user_id AS [connections.user_id]
        FROM connection_scopes cs
        INNER JOIN connections c ON c.id = cs.connection_id
        WHERE cs.subscription_id = ${notification.subscriptionId}
      `;

      const rawRow = rows[0] as (ScopeWithClientState & Record<string, unknown>) | undefined;
      const scope: ScopeWithClientState | null = rawRow
        ? {
            id: (rawRow['id'] as string).toUpperCase(),
            connection_id: (rawRow['connection_id'] as string).toUpperCase(),
            client_state: rawRow['client_state'] as string | null,
            connections: {
              user_id: (rawRow['connections.user_id'] as string).toUpperCase(),
            },
          }
        : null;

      if (!scope) {
        logger.warn(
          { subscriptionId: notification.subscriptionId },
          'Lifecycle webhook: no scope found for subscription'
        );
        continue;
      }

      // 2. Validate clientState
      if (scope.client_state !== notification.clientState) {
        logger.warn(
          { subscriptionId: notification.subscriptionId },
          'Lifecycle webhook: clientState mismatch — rejecting'
        );
        continue;
      }

      // 3. Handle lifecycle event
      switch (notification.lifecycleEvent) {
        case 'reauthorizationRequired': {
          // Renew the subscription before it expires
          try {
            const { getSubscriptionManager } = await import(
              '@/services/sync/SubscriptionManager'
            );
            await getSubscriptionManager().renewSubscription(scope.id);
            logger.info(
              { scopeId: scope.id },
              'Lifecycle webhook: subscription renewed after reauthorizationRequired'
            );
          } catch (renewErr) {
            const errorInfo =
              renewErr instanceof Error
                ? { message: renewErr.message, name: renewErr.name }
                : { value: String(renewErr) };
            logger.error(
              { error: errorInfo, scopeId: scope.id },
              'Lifecycle webhook: failed to renew subscription'
            );
          }
          break;
        }

        case 'subscriptionRemoved': {
          // Re-create the subscription and enqueue a delta sync to catch up
          try {
            const { getSubscriptionManager } = await import(
              '@/services/sync/SubscriptionManager'
            );
            await getSubscriptionManager().createSubscription(
              scope.connection_id,
              scope.id
            );
            logger.info(
              { scopeId: scope.id, connectionId: scope.connection_id },
              'Lifecycle webhook: subscription re-created after subscriptionRemoved'
            );
          } catch (createErr) {
            const errorInfo =
              createErr instanceof Error
                ? { message: createErr.message, name: createErr.name }
                : { value: String(createErr) };
            logger.error(
              { error: errorInfo, scopeId: scope.id },
              'Lifecycle webhook: failed to re-create subscription'
            );
          }

          // Enqueue delta sync regardless of subscription re-creation outcome
          try {
            const messageQueue = getMessageQueue();
            await messageQueue.addExternalFileSyncJob({
              scopeId: scope.id,
              connectionId: scope.connection_id,
              userId: scope.connections.user_id,
              triggerType: 'webhook',
            });
            logger.info(
              { scopeId: scope.id },
              'Lifecycle webhook: delta sync enqueued after subscriptionRemoved'
            );
          } catch (syncErr) {
            const errorInfo =
              syncErr instanceof Error
                ? { message: syncErr.message, name: syncErr.name }
                : { value: String(syncErr) };
            logger.error(
              { error: errorInfo, scopeId: scope.id },
              'Lifecycle webhook: failed to enqueue delta sync after subscriptionRemoved'
            );
          }
          break;
        }

        case 'missed': {
          // Notifications were missed — run a delta sync to catch up
          try {
            const messageQueue = getMessageQueue();
            await messageQueue.addExternalFileSyncJob({
              scopeId: scope.id,
              connectionId: scope.connection_id,
              userId: scope.connections.user_id,
              triggerType: 'webhook',
            });
            logger.info(
              { scopeId: scope.id },
              'Lifecycle webhook: delta sync enqueued for missed notifications'
            );
          } catch (syncErr) {
            const errorInfo =
              syncErr instanceof Error
                ? { message: syncErr.message, name: syncErr.name }
                : { value: String(syncErr) };
            logger.error(
              { error: errorInfo, scopeId: scope.id },
              'Lifecycle webhook: failed to enqueue delta sync for missed notifications'
            );
          }
          break;
        }

        default: {
          logger.warn(
            { lifecycleEvent: notification.lifecycleEvent, subscriptionId: notification.subscriptionId },
            'Lifecycle webhook: unknown lifecycleEvent — ignoring'
          );
        }
      }
    } catch (err) {
      const errorInfo =
        err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
      logger.error(
        { error: errorInfo, subscriptionId: notification.subscriptionId },
        'Lifecycle webhook: failed to process notification'
      );
    }
  }
});

export default router;
