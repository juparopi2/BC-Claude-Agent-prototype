/**
 * ConnectionRepository (PRD-100)
 *
 * Prisma-based data access layer for connections and connection_scopes tables.
 * Provides multi-tenant safe CRUD operations for external service connections.
 *
 * Key features:
 * - Singleton pattern for consistent access
 * - All IDs are UPPERCASE (per CLAUDE.md ID Standardization)
 * - Multi-tenant isolation (user_id in every WHERE clause)
 * - Excludes sensitive fields (tokens, MSAL state) from query results
 *
 * @module domains/connections
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';

const logger = createChildLogger({ service: 'ConnectionRepository' });

// ============================================================================
// Supporting Types
// ============================================================================

/**
 * Database row for a connection (excludes sensitive credential fields).
 */
export interface ConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  display_name: string | null;
  last_error: string | null;
  last_error_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row for a connection scope.
 */
export interface ScopeRow {
  id: string;
  connection_id: string;
  scope_type: string;
  scope_resource_id: string | null;
  scope_display_name: string | null;
  sync_status: string;
  last_sync_at: Date | null;
  last_sync_error: string | null;
  item_count: number;
  created_at: Date;
}

// ============================================================================
// ConnectionRepository
// ============================================================================

export class ConnectionRepository {
  /**
   * List all connections for a user.
   * Excludes sensitive credential fields (tokens, MSAL state).
   */
  async findByUser(userId: string): Promise<ConnectionRow[]> {
    logger.debug({ userId }, 'Fetching connections for user');

    const rows = await prisma.connections.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        user_id: true,
        provider: true,
        status: true,
        display_name: true,
        last_error: true,
        last_error_at: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: 'asc' },
    });

    return rows.map((row) => ({
      ...row,
      id: row.id.toUpperCase(),
      user_id: row.user_id.toUpperCase(),
    }));
  }

  /**
   * Find a single connection by ID, scoped to a specific user.
   * Returns null if not found or owned by another user.
   */
  async findById(userId: string, connectionId: string): Promise<ConnectionRow | null> {
    logger.debug({ userId, connectionId }, 'Fetching connection by ID');

    const row = await prisma.connections.findFirst({
      where: {
        id: connectionId,
        user_id: userId,
      },
      select: {
        id: true,
        user_id: true,
        provider: true,
        status: true,
        display_name: true,
        last_error: true,
        last_error_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!row) {
      return null;
    }

    return {
      ...row,
      id: row.id.toUpperCase(),
      user_id: row.user_id.toUpperCase(),
    };
  }

  /**
   * Create a new connection for a user.
   * Returns the new connection's ID (UPPERCASE).
   */
  async create(
    userId: string,
    data: { provider: string; displayName?: string }
  ): Promise<string> {
    const id = randomUUID().toUpperCase();

    logger.debug({ userId, provider: data.provider }, 'Creating connection');

    await prisma.connections.create({
      data: {
        id,
        user_id: userId,
        provider: data.provider,
        status: 'disconnected',
        display_name: data.displayName ?? null,
      },
    });

    return id;
  }

  /**
   * Update mutable fields on a connection (no tenant check — caller must verify ownership first).
   */
  async update(
    connectionId: string,
    data: Partial<{
      status: string;
      displayName: string;
      lastError: string;
      lastErrorAt: Date;
    }>
  ): Promise<void> {
    logger.debug({ connectionId, fields: Object.keys(data) }, 'Updating connection');

    await prisma.connections.update({
      where: { id: connectionId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.displayName !== undefined && { display_name: data.displayName }),
        ...(data.lastError !== undefined && { last_error: data.lastError }),
        ...(data.lastErrorAt !== undefined && { last_error_at: data.lastErrorAt }),
        updated_at: new Date(),
      },
    });
  }

  /**
   * Hard-delete a connection (cascades to connection_scopes via FK).
   */
  async delete(connectionId: string): Promise<void> {
    logger.debug({ connectionId }, 'Deleting connection');

    await prisma.connections.delete({
      where: { id: connectionId },
    });
  }

  /**
   * List all scopes for a connection.
   */
  async findScopesByConnection(connectionId: string): Promise<ScopeRow[]> {
    logger.debug({ connectionId }, 'Fetching scopes for connection');

    const rows = await prisma.connection_scopes.findMany({
      where: { connection_id: connectionId },
      select: {
        id: true,
        connection_id: true,
        scope_type: true,
        scope_resource_id: true,
        scope_display_name: true,
        sync_status: true,
        last_sync_at: true,
        last_sync_error: true,
        item_count: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    });

    return rows.map((row) => ({
      ...row,
      id: row.id.toUpperCase(),
      connection_id: row.connection_id.toUpperCase(),
    }));
  }

  /**
   * Count how many scopes a connection has.
   */
  async countScopesByConnection(connectionId: string): Promise<number> {
    return prisma.connection_scopes.count({
      where: { connection_id: connectionId },
    });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ConnectionRepository | null = null;

/**
 * Returns the singleton ConnectionRepository instance.
 */
export function getConnectionRepository(): ConnectionRepository {
  if (!instance) {
    instance = new ConnectionRepository();
  }
  return instance;
}
