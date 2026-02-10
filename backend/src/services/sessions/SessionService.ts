/**
 * Session Service
 *
 * Handles database operations for sessions and messages.
 * Provides cursor-based pagination for both resources.
 *
 * @module services/sessions/SessionService
 */

import { prisma } from '@/infrastructure/database/prisma';
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

    const rows = await prisma.sessions.findMany({
      where: {
        user_id: userId,
        ...(before ? { updated_at: { lt: new Date(before) } } : {}),
      },
      orderBy: { updated_at: 'desc' },
      take: fetchLimit,
    }) as unknown as DbSessionRow[];

    // Check if there are more results
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map(transformSession);

    // Calculate next cursor
    const nextCursor = hasMore && sessions.length > 0
      ? sessions[sessions.length - 1]!.updated_at
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
    const row = await prisma.sessions.findFirst({
      where: { id: sessionId, user_id: userId },
    }) as unknown as DbSessionRow | null;

    if (!row) {
      return null;
    }

    return transformSession(row);
  }

  /**
   * Get message count for a session
   *
   * @param sessionId - Session ID
   * @returns Message count
   */
  async getMessageCount(sessionId: string): Promise<number> {
    return prisma.messages.count({ where: { session_id: sessionId } });
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
    const now = new Date();
    const row = await prisma.sessions.create({
      data: {
        id: sessionId,
        user_id: userId,
        title,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    }) as unknown as DbSessionRow;

    logger.info({ sessionId, userId }, 'Session created');
    return transformSession(row);
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
    const updateResult = await prisma.sessions.updateMany({
      where: { id: sessionId, user_id: userId },
      data: { title, updated_at: new Date() },
    });

    if (updateResult.count === 0) {
      return null;
    }

    // Fetch updated session
    const row = await prisma.sessions.findFirst({
      where: { id: sessionId },
    }) as unknown as DbSessionRow | null;

    if (!row) {
      return null;
    }

    logger.info({ sessionId }, 'Session title updated');
    return transformSession(row);
  }

  /**
   * Delete a session (CASCADE deletes messages, approvals, todos)
   *
   * @param sessionId - Session ID
   * @param userId - User ID (for ownership verification)
   * @returns True if deleted, false if not found/unauthorized
   */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    const result = await prisma.sessions.deleteMany({
      where: { id: sessionId, user_id: userId },
    });

    if (result.count === 0) {
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
    const row = await prisma.sessions.findFirst({
      where: { id: sessionId, user_id: userId },
      select: { id: true },
    });
    return row !== null;
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
    const rows = await prisma.messages.findMany({
      where: {
        session_id: sessionId,
        ...(before ? { sequence_number: { lt: before } } : {}),
      },
      orderBy: { sequence_number: 'desc' },
      take: fetchLimit,
    }) as unknown as DbMessageRow[];

    // Check if there are more (older) results
    const hasMore = rows.length > limit;
    const messagesDesc = rows.slice(0, limit);

    // Reverse to get chronological order (oldest first)
    const messages = [...messagesDesc].reverse().map(transformMessage);

    // Next cursor is the smallest sequence_number (oldest message returned)
    const nextCursor = hasMore && messagesDesc.length > 0
      ? messagesDesc[messagesDesc.length - 1]!.sequence_number
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
