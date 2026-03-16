/**
 * SubscriptionManager (PRD-108, PRD-118)
 *
 * Manages Microsoft Graph change notification subscriptions for OneDrive
 * and SharePoint connection scopes. Handles creation, renewal, and deletion
 * of subscriptions, as well as querying scopes with expiring subscriptions.
 *
 * Design:
 * - Stateless singleton (getSubscriptionManager / __resetSubscriptionManager).
 * - Uses GraphHttpClient for all Graph API calls and GraphTokenManager for tokens.
 * - clientState is generated per-subscription as a 64-byte hex string (UPPERCASE)
 *   to validate incoming webhook notifications.
 * - Subscription expiration is capped at SUBSCRIPTION_MAX_DURATION_DAYS days
 *   (Microsoft Graph maximum for drive subscriptions is 30 days).
 * - deleteSubscription swallows 404 from Graph (subscription already expired)
 *   and clears DB fields silently.
 *
 * @module services/sync
 */

import { randomBytes } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { env } from '@/infrastructure/config';
import { getGraphHttpClient, GraphApiError } from '@/services/connectors/onedrive/GraphHttpClient';
import { getGraphTokenManager } from '@/services/connectors/GraphTokenManager';

const logger = createChildLogger({ service: 'SubscriptionManager' });

// ============================================================================
// Local types
// ============================================================================

/**
 * Shape of the Graph API response when creating or renewing a subscription.
 */
interface GraphSubscriptionResponse {
  id: string;
  expirationDateTime: string;
  resource: string;
}

// ============================================================================
// SubscriptionManager
// ============================================================================

export class SubscriptionManager {
  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Returns an ISO 8601 expiration timestamp that is SUBSCRIPTION_MAX_DURATION_DAYS
   * days from now.
   */
  private getExpirationDateTime(): string {
    return new Date(
      Date.now() + env.SUBSCRIPTION_MAX_DURATION_DAYS * 24 * 3600 * 1000
    ).toISOString();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Create a new Microsoft Graph change notification subscription for a scope.
   *
   * Steps:
   * 1. Load scope from DB to validate it exists.
   * 2. Load connection to get microsoft_drive_id.
   * 3. Generate a secure clientState (64-byte hex, UPPERCASE).
   * 4. Acquire a valid access token.
   * 5. POST /subscriptions to Graph API.
   * 6. Persist subscription_id, subscription_expires_at, client_state to DB.
   */
  async createSubscription(connectionId: string, scopeId: string): Promise<void> {
    logger.info({ connectionId, scopeId }, 'Creating Graph subscription');

    // 1. Load scope
    const scope = await prisma.connection_scopes.findUnique({
      where: { id: scopeId },
    });
    if (!scope) {
      throw new Error(`Scope not found: ${scopeId}`);
    }

    // 2. Load connection (need provider to distinguish SP folder scopes from OD shared scopes)
    const connection = await prisma.connections.findUnique({
      where: { id: connectionId },
      select: { microsoft_drive_id: true, provider: true },
    });
    if (!connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    // PRD-110: Skip subscription for shared scopes (no webhook support for remote drives)
    // PRD-118: SharePoint folder scopes also set remote_drive_id (to the library driveId),
    // but they DO need subscriptions — only skip for non-SharePoint providers.
    if (scope.remote_drive_id && connection.provider !== 'sharepoint') {
      logger.info({ connectionId, scopeId }, 'Skipping subscription for shared scope (remote drive)');
      return;
    }

    // PRD-111: Resolve driveId from scope level (SharePoint library) or connection level (OneDrive)
    let driveId: string | null = null;
    if (scope.scope_type === 'library') {
      driveId = scope.scope_resource_id;
    } else if (scope.remote_drive_id) {
      driveId = scope.remote_drive_id;
    } else if (connection.microsoft_drive_id) {
      driveId = connection.microsoft_drive_id;
    }

    if (!driveId) {
      throw new Error(`Cannot resolve driveId for subscription on scope ${scopeId} (connection ${connectionId})`);
    }

    // 3. Generate clientState (64-byte hex UPPERCASE)
    const clientState = randomBytes(64).toString('hex').toUpperCase();

    // 4. Get access token
    const token = await getGraphTokenManager().getValidToken(connectionId);

    // 5. POST /subscriptions
    const expirationDateTime = this.getExpirationDateTime();
    const webhookBase = env.GRAPH_WEBHOOK_BASE_URL;
    if (!webhookBase) {
      throw new Error('GRAPH_WEBHOOK_BASE_URL is not configured');
    }

    const requestBody = {
      changeType: 'updated',
      resource: `drives/${driveId}/root`,
      notificationUrl: `${webhookBase}/api/webhooks/graph`,
      lifecycleNotificationUrl: `${webhookBase}/api/webhooks/graph/lifecycle`,
      expirationDateTime,
      clientState,
    };

    const response = await getGraphHttpClient().post<GraphSubscriptionResponse>(
      '/subscriptions',
      token,
      requestBody
    );

    // 6. Persist to DB
    await prisma.connection_scopes.update({
      where: { id: scopeId },
      data: {
        subscription_id: response.id,
        subscription_expires_at: new Date(response.expirationDateTime),
        client_state: clientState,
      },
    });

    logger.info(
      {
        connectionId,
        scopeId,
        subscriptionId: response.id,
        expirationDateTime: response.expirationDateTime,
      },
      'Graph subscription created successfully'
    );
  }

  /**
   * Renew an existing Microsoft Graph subscription for a scope.
   *
   * Steps:
   * 1. Load scope from DB.
   * 2. Validate subscription_id exists.
   * 3. Load connection to obtain connectionId for token.
   * 4. Acquire a valid access token.
   * 5. PATCH /subscriptions/{subscription_id} with new expirationDateTime.
   * 6. Update subscription_expires_at in DB.
   */
  async renewSubscription(scopeId: string): Promise<void> {
    logger.info({ scopeId }, 'Renewing Graph subscription');

    // 1. Load scope
    const scope = await prisma.connection_scopes.findUnique({
      where: { id: scopeId },
    });
    if (!scope) {
      throw new Error(`Scope not found: ${scopeId}`);
    }

    // 2. Validate subscription_id
    if (!scope.subscription_id) {
      throw new Error(`Scope ${scopeId} has no active subscription_id to renew`);
    }

    const connectionId = scope.connection_id;

    // 3. Get access token
    const token = await getGraphTokenManager().getValidToken(connectionId);

    // 4. PATCH /subscriptions/{subscription_id}
    const expirationDateTime = this.getExpirationDateTime();

    const response = await getGraphHttpClient().patch<GraphSubscriptionResponse>(
      `/subscriptions/${scope.subscription_id}`,
      token,
      { expirationDateTime }
    );

    // 5. Update DB
    await prisma.connection_scopes.update({
      where: { id: scopeId },
      data: {
        subscription_expires_at: new Date(response.expirationDateTime),
      },
    });

    logger.info(
      {
        scopeId,
        connectionId,
        subscriptionId: scope.subscription_id,
        newExpirationDateTime: response.expirationDateTime,
      },
      'Graph subscription renewed successfully'
    );
  }

  /**
   * Delete a Microsoft Graph subscription for a scope and clear related DB fields.
   *
   * Steps:
   * 1. Load scope from DB.
   * 2. Return early if no subscription_id (nothing to delete).
   * 3. Load connection to obtain connectionId for token.
   * 4. Acquire a valid access token.
   * 5. DELETE /subscriptions/{subscription_id} (404 is swallowed silently).
   * 6. Clear subscription_id, subscription_expires_at, client_state in DB.
   */
  async deleteSubscription(scopeId: string): Promise<void> {
    logger.info({ scopeId }, 'Deleting Graph subscription');

    // 1. Load scope
    const scope = await prisma.connection_scopes.findUnique({
      where: { id: scopeId },
    });
    if (!scope) {
      throw new Error(`Scope not found: ${scopeId}`);
    }

    // 2. Nothing to delete
    if (!scope.subscription_id) {
      logger.debug({ scopeId }, 'No subscription_id on scope — skipping Graph API delete');
      return;
    }

    const connectionId = scope.connection_id;
    const subscriptionId = scope.subscription_id;

    // 3. Get access token
    const token = await getGraphTokenManager().getValidToken(connectionId);

    // 4. DELETE /subscriptions/{subscription_id}
    try {
      await getGraphHttpClient().delete(`/subscriptions/${subscriptionId}`, token);
    } catch (err) {
      if (err instanceof GraphApiError && err.statusCode === 404) {
        // Subscription already expired or deleted on Graph side — clear DB fields silently
        logger.debug(
          { scopeId, subscriptionId },
          'Graph subscription already gone (404) — clearing DB fields'
        );
      } else {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, stack: err.stack, name: err.name, cause: (err as Error & { cause?: unknown }).cause }
            : { value: String(err) };
        logger.error(
          { error: errorInfo, scopeId, connectionId, subscriptionId },
          'Failed to delete Graph subscription'
        );
        throw err;
      }
    }

    // 5. Clear DB fields
    await prisma.connection_scopes.update({
      where: { id: scopeId },
      data: {
        subscription_id: null,
        subscription_expires_at: null,
        client_state: null,
      },
    });

    logger.info(
      { scopeId, connectionId, subscriptionId },
      'Graph subscription deleted and DB fields cleared'
    );
  }

  /**
   * Find all scopes whose subscriptions expire within the given buffer window.
   *
   * Used by the renewal scheduler to proactively renew subscriptions before
   * they expire and notification delivery is interrupted.
   *
   * @param bufferHours  Number of hours ahead to look. Scopes expiring within
   *                     this window are returned.
   * @returns            Array of scopes with id, connection_id, subscription_id.
   */
  async findExpiringScopeSubscriptions(
    bufferHours: number
  ): Promise<Array<{ id: string; connection_id: string; subscription_id: string }>> {
    const expiryThreshold = new Date(Date.now() + bufferHours * 3600 * 1000);

    const scopes = await prisma.connection_scopes.findMany({
      where: {
        subscription_id: { not: null },
        subscription_expires_at: {
          not: null,
          lt: expiryThreshold,
        },
      },
      select: {
        id: true,
        connection_id: true,
        subscription_id: true,
      },
    });

    // TypeScript: subscription_id is string | null here, but we filtered for not null.
    // Cast to the narrowed return type.
    return scopes as Array<{ id: string; connection_id: string; subscription_id: string }>;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SubscriptionManager | undefined;

/**
 * Returns the singleton SubscriptionManager instance.
 */
export function getSubscriptionManager(): SubscriptionManager {
  if (!instance) {
    instance = new SubscriptionManager();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetSubscriptionManager(): void {
  instance = undefined;
}
