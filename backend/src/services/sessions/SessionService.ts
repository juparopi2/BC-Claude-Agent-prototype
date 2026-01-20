/**
 * Session Service
 *
 * Handles database operations for sessions and messages.
 * Provides cursor-based pagination for both resources.
 *
 * @module services/sessions/SessionService
 */

import { executeQuery } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';
import type {
  DbSessionRow,
  DbMessageRow,
  GetSessionsOptions,
  GetMessagesOptions,
  SessionResponse,
  MessageResponse,
  PaginatedSessionsResponse,
} from '@/domains/sessions';
import { transformSession, transformMessage } from './transformers';

const logger = createChildLogger({ service: 'SessionService' });

/**
 * Session Service
 *
 * Provides CRUD operations for sessions and messages with cursor-based pagination.
 */
export class SessionService {
  // ============================================
  // Session Operations
  // ============================================

  /**
   * Get sessions for a user with cursor-based pagination
   *
   * @param userId - User ID
   * @param options - Pagination options (limit, before cursor)
   * @returns Paginated sessions response
   */
  async getSessions(userId: string, options: GetSessionsOptions): Promise<PaginatedSessionsResponse> {
    const { limit, before } = options;

    // Fetch one extra to determine hasMore
    const fetchLimit = limit + 1;

    const query = `
      SELECT
        id,
        user_id,
        title,
        is_active,
        created_at,
        updated_at
      FROM sessions
      WHERE user_id = @userId
        ${before ? 'AND updated_at < @before' : ''}
      ORDER BY updated_at DESC
      OFFSET 0 ROWS FETCH NEXT @fetchLimit ROWS ONLY
    `;

    const params: Record<string, unknown> = { userId, fetchLimit };
    if (before) {
      params.before = new Date(before);
    }

    const result = await executeQuery<DbSessionRow>(query, params);
    const rows = result.recordset || [];

    // Check if there are more results
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map(transformSession);

    // Calculate next cursor
    const nextCursor = hasMore && sessions.length > 0
      ? sessions[sessions.length - 1].updated_at
      : null;

    logger.info(
      { userId, limit, before, count: sessions.length, hasMore },
      'Sessions fetched with pagination'
    );

    return {
      sessions,
      pagination: { hasMore, nextCursor },
    };
  }

  /**
   * Get a specific session by ID (with ownership verification)
   *
   * @param sessionId - Session ID
   * @param userId - User ID (for ownership verification)
   * @returns Session or null if not found/unauthorized
   */
  async getSession(sessionId: string, userId: string): Promise<SessionResponse | null> {
    const query = `
      SELECT
        id,
        user_id,
        title,
        is_active,
        created_at,
        updated_at
      FROM sessions
      WHERE id = @sessionId AND user_id = @userId
    `;

    const result = await executeQuery<DbSessionRow>(query, { sessionId, userId });

    if (result.recordset.length === 0 || !result.recordset[0]) {
      return null;
    }

    return transformSession(result.recordset[0]);
  }

  /**
   * Get message count for a session
   *
   * @param sessionId - Session ID
   * @returns Message count
   */
  async getMessageCount(sessionId: string): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM messages WHERE session_id = @sessionId`;
    const result = await executeQuery<{ count: number }>(query, { sessionId });
    return result.recordset[0]?.count ?? 0;
  }

  /**
   * Create a new session
   *
   * @param userId - User ID
   * @param sessionId - Pre-generated session ID
   * @param title - Session title
   * @returns Created session
   */
  async createSession(userId: string, sessionId: string, title: string): Promise<SessionResponse> {
    const query = `
      INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
      OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.title, INSERTED.is_active, INSERTED.created_at, INSERTED.updated_at
      VALUES (@sessionId, @userId, @title, 1, GETUTCDATE(), GETUTCDATE())
    `;

    const result = await executeQuery<DbSessionRow>(query, { sessionId, userId, title });

    if (result.recordset.length === 0 || !result.recordset[0]) {
      throw new Error('Failed to create session: No result returned');
    }

    logger.info({ sessionId, userId }, 'Session created');
    return transformSession(result.recordset[0]);
  }

  /**
   * Update session title
   *
   * @param sessionId - Session ID
   * @param userId - User ID (for ownership verification)
   * @param title - New title
   * @returns Updated session or null if not found/unauthorized
   */
  async updateSessionTitle(sessionId: string, userId: string, title: string): Promise<SessionResponse | null> {
    const updateQuery = `
      UPDATE sessions
      SET title = @title, updated_at = GETUTCDATE()
      WHERE id = @sessionId AND user_id = @userId
    `;

    const updateResult = await executeQuery(updateQuery, { sessionId, userId, title });

    if (updateResult.rowsAffected[0] === 0) {
      return null;
    }

    // Fetch updated session
    const selectQuery = `
      SELECT id, user_id, title, is_active, created_at, updated_at
      FROM sessions
      WHERE id = @sessionId
    `;

    const result = await executeQuery<DbSessionRow>(selectQuery, { sessionId });

    if (!result.recordset[0]) {
      return null;
    }

    logger.info({ sessionId }, 'Session title updated');
    return transformSession(result.recordset[0]);
  }

  /**
   * Delete a session (CASCADE deletes messages, approvals, todos)
   *
   * @param sessionId - Session ID
   * @param userId - User ID (for ownership verification)
   * @returns True if deleted, false if not found/unauthorized
   */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    const query = `
      DELETE FROM sessions
      WHERE id = @sessionId AND user_id = @userId
    `;

    const result = await executeQuery(query, { sessionId, userId });

    if (result.rowsAffected[0] === 0) {
      return false;
    }

    logger.info({ sessionId }, 'Session deleted');
    return true;
  }

  /**
   * Check if a session exists and belongs to the user
   *
   * @param sessionId - Session ID
   * @param userId - User ID
   * @returns True if session exists and belongs to user
   */
  async verifySessionOwnership(sessionId: string, userId: string): Promise<boolean> {
    const query = `SELECT id FROM sessions WHERE id = @sessionId AND user_id = @userId`;
    const result = await executeQuery<{ id: string }>(query, { sessionId, userId });
    return result.recordset.length > 0;
  }

  // ============================================
  // Message Operations
  // ============================================

  /**
   * Get messages for a session with cursor-based pagination
   *
   * Messages are returned in chronological order (oldest first).
   * Use `before` parameter to paginate backwards from a sequence_number.
   *
   * @param sessionId - Session ID
   * @param options - Pagination options (limit, before cursor)
   * @returns Array of messages
   */
  async getMessages(sessionId: string, options: GetMessagesOptions): Promise<{
    messages: MessageResponse[];
    pagination: { hasMore: boolean; nextCursor: number | null };
  }> {
    const { limit, before } = options;

    // Fetch one extra to determine hasMore
    const fetchLimit = limit + 1;

    // Query messages ordered by sequence_number DESC (to get latest first when paginating)
    // Then reverse in code to return chronological order
    const query = `
      SELECT
        id,
        session_id,
        role,
        message_type,
        content,
        metadata,
        stop_reason,
        token_count,
        sequence_number,
        created_at,
        model,
        input_tokens,
        output_tokens,
        event_id,
        tool_use_id
      FROM messages
      WHERE session_id = @sessionId
        ${before ? 'AND sequence_number < @before' : ''}
      ORDER BY sequence_number DESC
      OFFSET 0 ROWS FETCH NEXT @fetchLimit ROWS ONLY
    `;

    const params: Record<string, unknown> = { sessionId, fetchLimit };
    if (before) {
      params.before = before;
    }

    const result = await executeQuery<DbMessageRow>(query, params);
    const rows = result.recordset || [];

    // Check if there are more (older) results
    const hasMore = rows.length > limit;
    const messagesDesc = rows.slice(0, limit);

    // Reverse to get chronological order (oldest first)
    const messages = messagesDesc.reverse().map(transformMessage);

    // Next cursor is the smallest sequence_number (oldest message returned)
    const nextCursor = hasMore && messagesDesc.length > 0
      ? messagesDesc[messagesDesc.length - 1].sequence_number
      : null;

    logger.debug(
      { sessionId, limit, before, count: messages.length, hasMore },
      'Messages fetched with pagination'
    );

    return {
      messages,
      pagination: { hasMore, nextCursor },
    };
  }
}

// ============================================
// Singleton
// ============================================

let sessionServiceInstance: SessionService | null = null;

/**
 * Get the singleton SessionService instance
 */
export function getSessionService(): SessionService {
  if (!sessionServiceInstance) {
    sessionServiceInstance = new SessionService();
  }
  return sessionServiceInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSessionService(): void {
  sessionServiceInstance = null;
}
