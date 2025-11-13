/**
 * Chat Sessions Routes
 *
 * Handles CRUD operations for chat sessions and messages.
 *
 * Endpoints:
 * - GET /api/chat/sessions - Get all sessions for current user
 * - POST /api/chat/sessions - Create a new session
 * - GET /api/chat/sessions/:sessionId - Get specific session
 * - GET /api/chat/sessions/:sessionId/messages - Get messages for session
 * - DELETE /api/chat/sessions/:sessionId - Delete session
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { executeQuery } from '../config/database';
import { authenticateMicrosoft } from '../middleware/auth-oauth';
import { logger } from '../utils/logger';

const router = Router();

// ============================================
// Zod Schemas for Validation
// ============================================

const createSessionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
});

const getMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ============================================
// Helper Functions
// ============================================

/**
 * Transform database session row to frontend Session format
 */
function transformSession(row: {
  id: string;
  user_id: string;
  title: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  // Map is_active (boolean) to status (string enum)
  let status: 'active' | 'completed' | 'cancelled' = 'active';
  if (!row.is_active) {
    status = 'completed'; // Default inactive sessions to 'completed'
  }

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title || 'New Chat',
    status,
    last_activity_at: row.updated_at.toISOString(), // Use updated_at as last_activity_at
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Transform database message row to frontend Message format
 */
function transformMessage(row: {
  id: string;
  session_id: string;
  role: string;
  content: string;
  metadata: string | null;
  token_count: number | null;
  created_at: Date;
}) {
  // Parse metadata JSON if present
  let metadata: Record<string, unknown> = {};
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      // Ignore parse errors
    }
  }

  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    thinking_tokens: metadata.thinking_tokens as number | undefined,
    is_thinking: metadata.is_thinking as boolean | undefined,
    created_at: row.created_at.toISOString(),
  };
}

// ============================================
// Routes
// ============================================

/**
 * GET /api/chat/sessions
 * Get all sessions for current user
 */
router.get('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User ID not found in session',
      });
      return;
    }

    logger.info(`[Sessions] Getting sessions for user ${userId}`);

    // Query all sessions for the user
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
      ORDER BY updated_at DESC
    `;

    const result = await executeQuery<{
      id: string;
      user_id: string;
      title: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(query, { userId });

    // Transform backend format to frontend format
    const sessions = result.recordset.map(transformSession);

    logger.info(`[Sessions] Found ${sessions.length} sessions for user ${userId}`);

    res.json({
      sessions,
    });
  } catch (error) {
    logger.error('[Sessions] Get sessions failed:', error);
    res.status(500).json({
      error: 'Failed to get sessions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/chat/sessions
 * Create a new session
 */
router.post('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User ID not found in session',
      });
      return;
    }

    // Validate request body
    const validation = createSessionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Invalid request body',
        message: validation.error.errors[0]?.message || 'Validation failed',
      });
      return;
    }

    const { title } = validation.data;

    // Generate new session ID
    const sessionId = crypto.randomUUID();
    const sessionTitle = title || 'New Chat';

    logger.info(`[Sessions] Creating session ${sessionId} for user ${userId}`);

    // Insert new session
    const query = `
      INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
      OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.title, INSERTED.is_active, INSERTED.created_at, INSERTED.updated_at
      VALUES (@sessionId, @userId, @title, 1, GETUTCDATE(), GETUTCDATE())
    `;

    const result = await executeQuery<{
      id: string;
      user_id: string;
      title: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(query, {
      sessionId,
      userId,
      title: sessionTitle,
    });

    if (result.recordset.length === 0 || !result.recordset[0]) {
      throw new Error('Failed to create session');
    }

    const session = transformSession(result.recordset[0]);

    logger.info(`[Sessions] Session ${sessionId} created successfully`);

    res.status(201).json({
      session,
    });
  } catch (error) {
    logger.error('[Sessions] Create session failed:', error);
    res.status(500).json({
      error: 'Failed to create session',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/chat/sessions/:sessionId
 * Get specific session
 */
router.get('/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const { sessionId } = req.params;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User ID not found in session',
      });
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Session ID is required',
      });
      return;
    }

    logger.info(`[Sessions] Getting session ${sessionId} for user ${userId}`);

    // Query specific session (verify ownership)
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

    const result = await executeQuery<{
      id: string;
      user_id: string;
      title: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(query, { sessionId, userId });

    if (result.recordset.length === 0 || !result.recordset[0]) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Session not found or access denied',
      });
      return;
    }

    const session = transformSession(result.recordset[0]);

    logger.info(`[Sessions] Session ${sessionId} retrieved successfully`);

    res.json({
      session,
    });
  } catch (error) {
    logger.error('[Sessions] Get session failed:', error);
    res.status(500).json({
      error: 'Failed to get session',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/chat/sessions/:sessionId/messages
 * Get messages for a session
 */
router.get('/:sessionId/messages', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const { sessionId } = req.params;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User ID not found in session',
      });
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Session ID is required',
      });
      return;
    }

    // Validate query params
    const validation = getMessagesSchema.safeParse(req.query);
    if (!validation.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        message: validation.error.errors[0]?.message || 'Validation failed',
      });
      return;
    }

    const { limit, offset } = validation.data;

    logger.info(`[Sessions] Getting messages for session ${sessionId} (limit: ${limit}, offset: ${offset})`);

    // First, verify session ownership
    const sessionQuery = `
      SELECT id FROM sessions WHERE id = @sessionId AND user_id = @userId
    `;

    const sessionResult = await executeQuery<{ id: string }>(sessionQuery, { sessionId, userId });

    if (sessionResult.recordset.length === 0) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Session not found or access denied',
      });
      return;
    }

    // Query messages for the session
    const messagesQuery = `
      SELECT
        id,
        session_id,
        role,
        content,
        metadata,
        token_count,
        created_at
      FROM messages
      WHERE session_id = @sessionId
      ORDER BY created_at ASC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const messagesResult = await executeQuery<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      metadata: string | null;
      token_count: number | null;
      created_at: Date;
    }>(messagesQuery, { sessionId, offset, limit });

    const messages = messagesResult.recordset.map(transformMessage);

    logger.info(`[Sessions] Found ${messages.length} messages for session ${sessionId}`);

    res.json({
      messages,
    });
  } catch (error) {
    logger.error('[Sessions] Get messages failed:', error);
    res.status(500).json({
      error: 'Failed to get messages',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/chat/sessions/:sessionId
 * Delete a session (CASCADE deletes messages, approvals, todos)
 */
router.delete('/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const { sessionId } = req.params;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User ID not found in session',
      });
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Session ID is required',
      });
      return;
    }

    logger.info(`[Sessions] Deleting session ${sessionId} for user ${userId}`);

    // Delete session (verify ownership, CASCADE deletes related records)
    const query = `
      DELETE FROM sessions
      WHERE id = @sessionId AND user_id = @userId
    `;

    const result = await executeQuery(query, { sessionId, userId });

    // Check if session was deleted
    if (result.rowsAffected[0] === 0) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Session not found or access denied',
      });
      return;
    }

    logger.info(`[Sessions] Session ${sessionId} deleted successfully (CASCADE delete applied)`);

    res.json({
      success: true,
      message: 'Session deleted',
    });
  } catch (error) {
    logger.error('[Sessions] Delete session failed:', error);
    res.status(500).json({
      error: 'Failed to delete session',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
