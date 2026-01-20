/**
 * Sessions Routes
 *
 * Handles CRUD operations for chat sessions.
 *
 * Endpoints:
 * - GET /api/chat/sessions - Get all sessions for current user (paginated)
 * - POST /api/chat/sessions - Create a new session
 * - GET /api/chat/sessions/:sessionId - Get specific session
 * - PATCH /api/chat/sessions/:sessionId - Update session title
 * - DELETE /api/chat/sessions/:sessionId - Delete session
 *
 * @module routes/sessions/sessions.routes
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import { sendError } from '@/shared/utils/error-response';
import {
  createSessionSchema,
  updateSessionSchema,
  getSessionsSchema,
} from '@/domains/sessions';
import { getSessionService, getSessionTitleGenerator } from '@/services/sessions';

const logger = createChildLogger({ service: 'SessionRoutes' });
const router = Router();

// UUID regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Handle SQL/UUID conversion errors
 */
function isUUIDConversionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes('Conversion failed') ||
    msg.includes('uniqueidentifier') ||
    msg.toLowerCase().includes('invalid') ||
    msg.includes('Invalid UUID')
  );
}

// ============================================
// GET /api/chat/sessions
// Get all sessions for current user (paginated)
// ============================================
router.get('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    if (!userId) {
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    // Validate query params
    const validation = getSessionsSchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { limit, before } = validation.data;

    logger.info({ userId, limit, before }, 'Getting sessions');

    const sessionService = getSessionService();
    const result = await sessionService.getSessions(userId, { limit, before });

    logger.info({ userId, count: result.sessions.length, hasMore: result.pagination.hasMore }, 'Sessions retrieved');

    res.json(result);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Get sessions failed');
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get sessions');
  }
});

// ============================================
// POST /api/chat/sessions
// Create a new session
// ============================================
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
    const sessionId = crypto.randomUUID().toUpperCase();
    let sessionTitle = title || 'New Chat';

    // Generate title from initial message if provided
    if (!title && validation.data.initialMessage) {
      try {
        const titleGenerator = getSessionTitleGenerator();
        const generatedTitle = await titleGenerator.generateTitle(validation.data.initialMessage);

        if (generatedTitle && generatedTitle.trim().length > 0) {
          sessionTitle = generatedTitle;
        }

        logger.info({ sessionId, generatedTitle: sessionTitle }, 'Generated title from initial message');
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to generate title from initial message'
        );
        // Fallback to 'New Chat' is already set
      }
    }

    logger.info({ sessionId, userId }, 'Creating session');

    const sessionService = getSessionService();
    const session = await sessionService.createSession(userId, sessionId, sessionTitle);

    logger.info({ sessionId }, 'Session created successfully');

    res.status(201).json(session);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Create session failed');
    sendError(res, ErrorCode.SESSION_CREATE_ERROR);
  }
});

// ============================================
// GET /api/chat/sessions/:sessionId
// Get specific session
// ============================================
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

    // Validate UUID format to avoid SQL errors (return 400, not 404)
    if (!isValidUUID(sessionId)) {
      sendError(res, ErrorCode.INVALID_PARAMETER, 'Invalid session ID format');
      return;
    }

    logger.info({ sessionId, userId }, 'Getting session');

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId, userId);

    if (!session) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    // Get message count
    const messageCount = await sessionService.getMessageCount(sessionId);

    logger.info({ sessionId }, 'Session retrieved successfully');

    res.json({
      ...session,
      messageCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage, sessionId: req.params.sessionId }, 'Get session failed');

    if (isUUIDConversionError(error)) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get session');
  }
});

// ============================================
// PATCH /api/chat/sessions/:sessionId
// Update session title
// ============================================
router.patch('/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
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

    // Validate request body
    const validation = updateSessionSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Title is required');
      return;
    }

    const { title } = validation.data;

    logger.info({ sessionId }, 'Updating session title');

    const sessionService = getSessionService();
    const session = await sessionService.updateSessionTitle(sessionId, userId, title.trim());

    if (!session) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    logger.info({ sessionId }, 'Session title updated successfully');

    res.json(session);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Update title error');
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to update session');
  }
});

// ============================================
// DELETE /api/chat/sessions/:sessionId
// Delete session (CASCADE deletes messages, approvals, todos)
// ============================================
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

    // Validate UUID format to avoid SQL errors (return 400, not 500)
    if (!isValidUUID(sessionId)) {
      sendError(res, ErrorCode.INVALID_PARAMETER, 'Invalid session ID format');
      return;
    }

    logger.info({ sessionId, userId }, 'Deleting session');

    const sessionService = getSessionService();
    const deleted = await sessionService.deleteSession(sessionId, userId);

    if (!deleted) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    logger.info({ sessionId }, 'Session deleted successfully (CASCADE delete applied)');

    res.status(204).send();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage, sessionId: req.params.sessionId }, 'Delete session failed');

    if (isUUIDConversionError(error)) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to delete session');
  }
});

export default router;
