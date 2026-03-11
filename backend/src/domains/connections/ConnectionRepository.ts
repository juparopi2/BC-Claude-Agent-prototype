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
  token_expires_at: Date | null;
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
  scope_path: string | null;
  sync_status: string;
  last_sync_at: Date | null;
  last_sync_error: string | null;
  last_sync_cursor: string | null;
  item_count: number;
  subscription_id: string | null;
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
        token_expires_at: true,
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
        token_expires_at: true,
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
        scope_path: true,
        sync_status: true,
        last_sync_at: true,
        last_sync_error: true,
        last_sync_cursor: true,
        item_count: true,
        subscription_id: true,
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
   * Create a new connection_scope record.
   * Returns the new scope ID (UPPERCASE).
   */
  async createScope(
    connectionId: string,
    data: {
      scopeType: string;
      scopeResourceId: string;
      scopeDisplayName: string;
      scopePath?: string;
    }
  ): Promise<string> {
    const id = randomUUID().toUpperCase();

    logger.debug({ connectionId, scopeType: data.scopeType }, 'Creating connection scope');

    await prisma.connection_scopes.create({
      data: {
        id,
        connection_id: connectionId,
        scope_type: data.scopeType,
        scope_resource_id: data.scopeResourceId,
        scope_display_name: data.scopeDisplayName,
        scope_path: data.scopePath ?? null,
        sync_status: 'idle',
        item_count: 0,
      },
    });

    return id;
  }

  /**
   * Update a scope's sync state fields.
   */
  async updateScope(
    scopeId: string,
    data: Partial<{
      syncStatus: string;
      lastSyncAt: Date;
      lastSyncError: string | null;
      lastSyncCursor: string | null;
      itemCount: number;
    }>
  ): Promise<void> {
    logger.debug({ scopeId, fields: Object.keys(data) }, 'Updating connection scope');

    await prisma.connection_scopes.update({
      where: { id: scopeId },
      data: {
        ...(data.syncStatus !== undefined && { sync_status: data.syncStatus }),
        ...(data.lastSyncAt !== undefined && { last_sync_at: data.lastSyncAt }),
        ...(data.lastSyncError !== undefined && { last_sync_error: data.lastSyncError }),
        ...(data.lastSyncCursor !== undefined && { last_sync_cursor: data.lastSyncCursor }),
        ...(data.itemCount !== undefined && { item_count: data.itemCount }),
        updated_at: new Date(),
      },
    });
  }

  /**
   * Find a single scope by ID.
   * Returns null if not found.
   */
  async findScopeById(scopeId: string): Promise<ScopeRow | null> {
    logger.debug({ scopeId }, 'Fetching scope by ID');

    const row = await prisma.connection_scopes.findUnique({
      where: { id: scopeId },
      select: {
        id: true,
        connection_id: true,
        scope_type: true,
        scope_resource_id: true,
        scope_display_name: true,
        scope_path: true,
        sync_status: true,
        last_sync_at: true,
        last_sync_error: true,
        last_sync_cursor: true,
        item_count: true,
        subscription_id: true,
        created_at: true,
      },
    });

    if (!row) {
      return null;
    }

    return {
      ...row,
      id: row.id.toUpperCase(),
      connection_id: row.connection_id.toUpperCase(),
    };
  }

  /**
   * Count how many scopes a connection has.
   */
  async countScopesByConnection(connectionId: string): Promise<number> {
    return prisma.connection_scopes.count({
      where: { connection_id: connectionId },
    });
  }

  /**
   * Fetch scopes with actual file counts from the files table (PRD-105).
   * Uses raw SQL because Prisma doesn't have a direct relation from scopes → files.
   */
  async findScopesWithFileCounts(connectionId: string): Promise<(ScopeRow & { file_count: number })[]> {
    logger.debug({ connectionId }, 'Fetching scopes with file counts');

    const rows = await prisma.$queryRaw<Array<ScopeRow & { file_count: number }>>`
      SELECT
        cs.id,
        cs.connection_id,
        cs.scope_type,
        cs.scope_resource_id,
        cs.scope_display_name,
        cs.scope_path,
        cs.sync_status,
        cs.last_sync_at,
        cs.last_sync_error,
        cs.last_sync_cursor,
        cs.item_count,
        cs.created_at,
        CAST(COUNT(f.id) AS INT) AS file_count
      FROM connection_scopes cs
      LEFT JOIN files f ON f.connection_scope_id = cs.id
      WHERE cs.connection_id = ${connectionId}
      GROUP BY
        cs.id, cs.connection_id, cs.scope_type, cs.scope_resource_id,
        cs.scope_display_name, cs.scope_path, cs.sync_status, cs.last_sync_at,
        cs.last_sync_error, cs.last_sync_cursor, cs.item_count, cs.created_at
      ORDER BY cs.created_at ASC
    `;

    return rows.map((row) => ({
      ...row,
      id: row.id.toUpperCase(),
      connection_id: row.connection_id.toUpperCase(),
    }));
  }

  /**
   * Find all files belonging to a specific scope (PRD-105).
   * Returns minimal fields needed for cleanup (id, blob_path).
   */
  async findFilesByScopeId(scopeId: string): Promise<Array<{ id: string; blob_path: string | null }>> {
    logger.debug({ scopeId }, 'Fetching files by scope ID');

    const rows = await prisma.files.findMany({
      where: { connection_scope_id: scopeId },
      select: { id: true, blob_path: true },
    });

    return rows.map((row) => ({
      id: row.id.toUpperCase(),
      blob_path: row.blob_path,
    }));
  }

  /**
   * Hard-delete a single connection scope (PRD-105).
   */
  async deleteScopeById(scopeId: string): Promise<void> {
    logger.debug({ scopeId }, 'Deleting connection scope');

    await prisma.connection_scopes.delete({
      where: { id: scopeId },
    });
  }

  /**
   * Find a single connection by ID, including the msal_home_account_id field.
   * Needed for MSAL cache deletion during disconnect (PRD-109).
   */
  async findByIdWithMsal(userId: string, connectionId: string): Promise<(ConnectionRow & { msal_home_account_id: string | null }) | null> {
    logger.debug({ userId, connectionId }, 'Fetching connection with MSAL info');

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
        token_expires_at: true,
        msal_home_account_id: true,
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
   * Count the number of files belonging to a connection (PRD-109).
   */
  async countFilesByConnection(connectionId: string): Promise<number> {
    return prisma.files.count({ where: { connection_id: connectionId } });
  }

  /**
   * Count the number of file chunks belonging to a connection via its files (PRD-109).
   * Uses raw SQL join since there is no direct Prisma relation from chunks to connections.
   */
  async countChunksByConnection(connectionId: string): Promise<number> {
    const result = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT CAST(COUNT(fc.id) AS INT) AS count
      FROM file_chunks fc
      INNER JOIN files f ON fc.file_id = f.id
      WHERE f.connection_id = ${connectionId}
    `;
    return result[0]?.count ?? 0;
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
