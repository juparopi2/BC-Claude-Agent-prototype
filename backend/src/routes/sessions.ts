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
import { ErrorCode } from '@/constants/errors';
import { sendError } from '@/utils/error-response';
// ✅ Import native SDK types (source of truth)
import type { StopReason, TextCitation } from '@anthropic-ai/sdk/resources/messages';

const router = Router();

// ============================================
// Zod Schemas for Validation
// ============================================

const createSessionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  // NOTE: initialMessage removed - messages should be sent via Socket.IO after room join
  // Keeping schema field for backward compatibility, but it will be ignored
  initialMessage: z.string().min(1).max(10000).optional(),
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
 * Handles 3 message types: standard, thinking, tool_use
 *
 * ⭐ PHASE 4.6: Uses shared types from @bc-agent/shared for contract enforcement.
 * CRITICAL: Returns `type` field (not `message_type`) for discriminated union.
 * CRITICAL: Token fields MUST be nested in `token_usage` object.
 */

// Database row type
interface DbMessageRow {
  id: string;
  session_id: string;
  role: string;
  message_type: string;
  content: string;
  metadata: string | null;
  token_count: number | null;
  stop_reason: StopReason | null;
  sequence_number: number | null;
  created_at: Date;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  event_id: string | null;
  tool_use_id: string | null;
}

function transformMessage(row: DbMessageRow) {
  // Parse metadata JSON if present
  let metadata: Record<string, unknown> = {};
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      // Ignore parse errors
    }
  }

  // Build token_usage if present (NESTED structure per shared types contract)
  const token_usage = (row.input_tokens != null && row.output_tokens != null)
    ? { input_tokens: row.input_tokens, output_tokens: row.output_tokens }
    : undefined;

  // Base fields shared by all message types
  const base = {
    id: row.id,
    session_id: row.session_id,
    sequence_number: row.sequence_number ?? 0,
    created_at: row.created_at.toISOString(),
    event_id: row.event_id || undefined,
  };

  // Transform based on message type
  switch (row.message_type) {
    case 'thinking':
      // Extended thinking message
      // CRITICAL: content is in DB `content` column, NOT metadata.content
      return {
        ...base,
        type: 'thinking' as const,        // ✅ Discriminator for union
        role: 'assistant' as const,       // ✅ ADD MISSING ROLE
        content: row.content || '',       // ✅ From content column
        duration_ms: metadata.duration_ms as number | undefined,
        model: row.model || undefined,
        token_usage,                      // ✅ Nested structure
      };

    case 'tool_use':
      // Tool execution message
      return {
        ...base,
        type: 'tool_use' as const,        // ✅ Discriminator for union
        role: 'assistant' as const,       // ✅ Always assistant
        tool_name: metadata.tool_name as string || '',
        tool_args: (metadata.tool_args as Record<string, unknown>) || {},
        status: (metadata.status as 'pending' | 'success' | 'error') || 'pending',
        result: metadata.tool_result,
        error_message: metadata.error_message as string | undefined,
        tool_use_id: row.tool_use_id || undefined,
      };

    case 'tool_result':
      // Tool execution result (separate from request)
      return {
        ...base,
        type: 'tool_result' as const,
        role: 'assistant' as const,
        tool_name: (metadata.tool_name as string) || '',
        tool_args: (metadata.tool_args as Record<string, unknown>) || {},
        success: (metadata.success as boolean) ?? true,
        result: metadata.tool_result,
        error_message: metadata.error_message as string | undefined,
        tool_use_id: row.tool_use_id || undefined,
        duration_ms: metadata.duration_ms as number | undefined,
      };

    case 'text':
    case 'standard':
    default:
      // Standard text message (user or assistant)
      // CRITICAL: Must return `type: 'standard'` not `message_type: 'text'`
      return {
        ...base,
        type: 'standard' as const,        // ✅ ADD TYPE DISCRIMINATOR
        role: row.role as 'user' | 'assistant',
        content: row.content || '',       // ✅ From content column
        token_usage,                      // ✅ Nested structure
        stop_reason: row.stop_reason || undefined,
        model: row.model || undefined,
        // Citations (if present in metadata)
        citations: metadata.citations as TextCitation[] | undefined,
        citations_count: metadata.citations_count as number | undefined,
      };
  }
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
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
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
    const sessions = (result.recordset || []).map(transformSession);

    logger.info(`[Sessions] Found ${sessions.length} sessions for user ${userId}`);

    res.json({
      sessions,
    });
  } catch (error) {
    logger.error('[Sessions] Get sessions failed:', error);
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get sessions');
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
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    // Validate request body
    const validation = createSessionSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Validation failed');
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
      logger.error('[Sessions] Create session failed: No result returned');
      sendError(res, ErrorCode.SESSION_CREATE_ERROR);
      return;
    }

    const session = transformSession(result.recordset[0]);

    logger.info(`[Sessions] Session ${sessionId} created successfully (messages will be sent via Socket.IO)`);

    // NOTE: Initial message processing REMOVED
    // Messages are now sent via Socket.IO events (chat:message) after room join
    // This eliminates the race condition where backend emits events before frontend is ready

    res.status(201).json({
      session,
    });
  } catch (error) {
    logger.error('[Sessions] Create session failed:', error);
    sendError(res, ErrorCode.SESSION_CREATE_ERROR);
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
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    if (!sessionId) {
      sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'Session ID is required');
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
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    const session = transformSession(result.recordset[0]);

    logger.info(`[Sessions] Session ${sessionId} retrieved successfully`);

    res.json({
      session,
    });
  } catch (error) {
    logger.error('[Sessions] Get session failed:', error);
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get session');
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
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    if (!sessionId) {
      sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'Session ID is required');
      return;
    }

    // Validate query params
    const validation = getMessagesSchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
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
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    // Query messages for the session
    // ⭐ UPDATED: Include all token tracking and model columns for E2E data flow
    // ⭐ CRITICAL: ORDER BY sequence_number ASC ensures correct message ordering
    // (fallback to created_at for any NULL sequence_numbers, though these should not exist)
    const messagesQuery = `
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
      ORDER BY sequence_number ASC, created_at ASC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const messagesResult = await executeQuery<{
      id: string;
      session_id: string;
      role: string;
      message_type: string;
      content: string;
      metadata: string | null;
      stop_reason: StopReason | null;  // ✅ Native SDK stop_reason
      token_count: number | null;
      sequence_number: number | null;  // ✅ Event sourcing sequence
      created_at: Date;
      // ⭐ Token tracking columns
      model: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      event_id: string | null;
      tool_use_id: string | null;
    }>(messagesQuery, { sessionId, offset, limit });

    const messages = (messagesResult.recordset || []).map(transformMessage);

    logger.info(`[Sessions] Found ${messages.length} messages for session ${sessionId}`);

    res.json({
      messages,
    });
  } catch (error) {
    logger.error('[Sessions] Get messages failed:', error);
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get messages');
  }
});

/**
 * PATCH /api/chat/sessions/:sessionId
 * Update a session title
 */
router.patch('/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const { sessionId } = req.params;
    const { title } = req.body;

    if (!userId) {
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    if (!sessionId) {
      sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'Session ID is required');
      return;
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Title is required and must be a non-empty string');
      return;
    }

    if (title.length > 500) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Title must be 500 characters or less');
      return;
    }

    logger.info(`[Sessions] Updating title for session ${sessionId}`);

    // Update session title (verify ownership)
    const query = `
      UPDATE sessions
      SET title = @title, updated_at = GETUTCDATE()
      WHERE id = @sessionId AND user_id = @userId
    `;

    const result = await executeQuery(query, { sessionId, userId, title: title.trim() });

    // Check if session was updated
    if (result.rowsAffected[0] === 0) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    // Fetch updated session
    const updatedSession = await executeQuery<{
      id: string;
      user_id: string;
      title: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      'SELECT * FROM sessions WHERE id = @sessionId',
      { sessionId }
    );

    const sessionData = updatedSession.recordset?.[0];

    if (!sessionData) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND);
      return;
    }

    logger.info(`[Sessions] Session ${sessionId} title updated successfully`);

    res.json({
      success: true,
      session: transformSession(sessionData),
    });
  } catch (error) {
    logger.error('[Sessions] Update title error:', error);
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to update session');
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
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    if (!sessionId) {
      sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'Session ID is required');
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
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    logger.info(`[Sessions] Session ${sessionId} deleted successfully (CASCADE delete applied)`);

    res.json({
      success: true,
      message: 'Session deleted',
    });
  } catch (error) {
    logger.error('[Sessions] Delete session failed:', error);
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to delete session');
  }
});

export default router;
