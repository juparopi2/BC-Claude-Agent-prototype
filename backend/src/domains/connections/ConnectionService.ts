/**
 * ConnectionService (PRD-100)
 *
 * Business logic layer for connection management.
 * Validates ownership, maps DB rows to API shapes, and delegates to
 * ConnectionRepository for all persistence operations.
 *
 * Key features:
 * - Ownership validation with timing-safe compare
 * - Maps ConnectionRow → ConnectionSummary (shared API contract)
 * - All IDs normalized to UPPERCASE at ingestion
 *
 * @module domains/connections
 */

import { createChildLogger } from '@/shared/utils/logger';
import { timingSafeCompare } from '@/shared/utils/session-ownership';
import { getConnectionRepository } from './ConnectionRepository';
import type { ConnectionRow, ScopeRow } from './ConnectionRepository';
import type {
  ConnectionSummary,
  ConnectionScopeDetail,
  ConnectionListResponse,
} from '@bc-agent/shared';
import type { ProviderId } from '@bc-agent/shared';
import type { ConnectionStatus, SyncStatus } from '@bc-agent/shared';
import type { CreateConnectionInput, UpdateConnectionInput } from '@bc-agent/shared/schemas';

const logger = createChildLogger({ service: 'ConnectionService' });

// ============================================================================
// ConnectionService
// ============================================================================

export class ConnectionService {
  /**
   * List all connections for the authenticated user.
   */
  async listConnections(userId: string): Promise<ConnectionListResponse> {
    const normalizedUserId = userId.toUpperCase();
    logger.debug({ userId: normalizedUserId }, 'Listing connections');

    const repo = getConnectionRepository();
    const rows = await repo.findByUser(normalizedUserId);

    // Fetch scope counts in parallel for all connections
    const scopeCounts = await Promise.all(
      rows.map((row) => repo.countScopesByConnection(row.id))
    );

    const connections = rows.map((row, index) =>
      this.toSummary(row, scopeCounts[index] ?? 0)
    );

    return { connections, count: connections.length };
  }

  /**
   * Get a single connection by ID, verifying ownership.
   * Throws if not found or owned by another user.
   */
  async getConnection(userId: string, connectionId: string): Promise<ConnectionSummary> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Getting connection');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    const scopeCount = await repo.countScopesByConnection(row.id);
    return this.toSummary(row, scopeCount);
  }

  /**
   * Create a new connection for the authenticated user.
   * Returns the created ConnectionSummary.
   */
  async createConnection(
    userId: string,
    input: CreateConnectionInput
  ): Promise<ConnectionSummary> {
    const normalizedUserId = userId.toUpperCase();
    logger.debug({ userId: normalizedUserId, provider: input.provider }, 'Creating connection');

    const repo = getConnectionRepository();
    const id = await repo.create(normalizedUserId, {
      provider: input.provider,
      displayName: input.displayName,
    });

    const row = await repo.findById(normalizedUserId, id);
    if (!row) {
      // Should never happen — we just created it
      throw new Error(`Failed to retrieve newly created connection ${id}`);
    }

    return this.toSummary(row, 0);
  }

  /**
   * Update mutable fields on a connection, verifying ownership.
   * Throws if not found or owned by another user.
   */
  async updateConnection(
    userId: string,
    connectionId: string,
    input: UpdateConnectionInput
  ): Promise<void> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Updating connection');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    await repo.update(normalizedConnectionId, {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.displayName !== undefined && { displayName: input.displayName }),
    });
  }

  /**
   * Delete a connection, verifying ownership first.
   * Throws if not found or owned by another user.
   */
  async deleteConnection(userId: string, connectionId: string): Promise<void> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Deleting connection');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    await repo.delete(normalizedConnectionId);
    logger.info({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Connection deleted');
  }

  /**
   * List all scopes for a connection, verifying ownership.
   * Throws if not found or owned by another user.
   */
  async listScopes(userId: string, connectionId: string): Promise<ConnectionScopeDetail[]> {
    const normalizedUserId = userId.toUpperCase();
    const normalizedConnectionId = connectionId.toUpperCase();
    logger.debug({ userId: normalizedUserId, connectionId: normalizedConnectionId }, 'Listing connection scopes');

    const repo = getConnectionRepository();
    const row = await repo.findById(normalizedUserId, normalizedConnectionId);

    if (!row) {
      throw new ConnectionNotFoundError(normalizedConnectionId);
    }

    this.assertOwnership(row.user_id, normalizedUserId, normalizedConnectionId);

    const scopes = await repo.findScopesByConnection(normalizedConnectionId);
    return scopes.map((scope) => this.toScopeDetail(scope));
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Map a DB row to the public-facing ConnectionSummary shape.
   */
  private toSummary(row: ConnectionRow, scopeCount: number): ConnectionSummary {
    return {
      id: row.id,
      provider: row.provider as ProviderId,
      status: row.status as ConnectionStatus,
      displayName: row.display_name,
      lastError: row.last_error,
      lastErrorAt: row.last_error_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      scopeCount,
    };
  }

  /**
   * Map a DB scope row to the public-facing ConnectionScopeDetail shape.
   */
  private toScopeDetail(row: ScopeRow): ConnectionScopeDetail {
    return {
      id: row.id,
      connectionId: row.connection_id,
      scopeType: row.scope_type,
      scopeResourceId: row.scope_resource_id,
      scopeDisplayName: row.scope_display_name,
      syncStatus: row.sync_status as SyncStatus,
      lastSyncAt: row.last_sync_at?.toISOString() ?? null,
      lastSyncError: row.last_sync_error,
      itemCount: row.item_count,
      createdAt: row.created_at.toISOString(),
    };
  }

  /**
   * Assert that the connection's recorded owner matches the requesting user.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  private assertOwnership(
    ownerId: string,
    requestingUserId: string,
    connectionId: string
  ): void {
    if (!timingSafeCompare(ownerId, requestingUserId)) {
      logger.warn(
        { connectionId, requestingUserId, ownershipMismatch: true },
        'Connection ownership validation failed'
      );
      throw new ConnectionForbiddenError(connectionId);
    }
  }
}

// ============================================================================
// Domain errors
// ============================================================================

export class ConnectionNotFoundError extends Error {
  readonly code = 'CONNECTION_NOT_FOUND';
  constructor(connectionId: string) {
    super(`Connection ${connectionId} not found`);
    this.name = 'ConnectionNotFoundError';
  }
}

export class ConnectionForbiddenError extends Error {
  readonly code = 'CONNECTION_FORBIDDEN';
  constructor(connectionId: string) {
    super(`Access to connection ${connectionId} is forbidden`);
    this.name = 'ConnectionForbiddenError';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ConnectionService | null = null;

/**
 * Returns the singleton ConnectionService instance.
 */
export function getConnectionService(): ConnectionService {
  if (!instance) {
    instance = new ConnectionService();
  }
  return instance;
}
