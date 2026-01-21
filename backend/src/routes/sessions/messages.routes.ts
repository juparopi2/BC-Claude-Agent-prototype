/**
 * Messages Routes
 *
 * Handles operations for session messages.
 *
 * Endpoints:
 * - GET /api/chat/sessions/:sessionId/messages - Get messages for session (paginated)
 *
 * @module routes/sessions/messages.routes
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import { sendError } from '@/shared/utils/error-response';
import { getMessagesSchema } from '@/domains/sessions';
import { getSessionService } from '@/services/sessions';
import { getCitationService } from '@/services/citations';
import { getMessageChatAttachmentService } from '@/services/files/MessageChatAttachmentService';

const logger = createChildLogger({ service: 'MessagesRoutes' });
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
// GET /api/chat/sessions/:sessionId/messages
// Get messages for a session (paginated)
// ============================================
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

    // Validate UUID format
    if (!isValidUUID(sessionId)) {
      sendError(res, ErrorCode.INVALID_PARAMETER, 'Invalid session ID format');
      return;
    }

    // Validate query params
    const validation = getMessagesSchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { limit, before } = validation.data;

    logger.info({ sessionId, limit, before }, 'Getting messages');

    const sessionService = getSessionService();

    // Verify session ownership
    const hasAccess = await sessionService.verifySessionOwnership(sessionId, userId);
    if (!hasAccess) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found or access denied');
      return;
    }

    // Get messages with pagination
    const result = await sessionService.getMessages(sessionId, { limit, before });
    const { messages } = result;

    // Fetch citations for assistant standard messages
    const assistantMessageIds = messages
      .filter(m => m.type === 'standard' && m.role === 'assistant')
      .map(m => m.id);

    if (assistantMessageIds.length > 0) {
      try {
        const citationService = getCitationService();
        const citationsMap = await citationService.getCitationsForMessages(assistantMessageIds);

        // Attach citations to messages
        for (const message of messages) {
          if (message.type === 'standard' && message.role === 'assistant') {
            const messageCitations = citationsMap.get(message.id);
            if (messageCitations && messageCitations.length > 0) {
              (message as Record<string, unknown>).citedFiles = messageCitations;
            }
          }
        }

        logger.debug(
          { sessionId, citationMessagesCount: citationsMap.size },
          'Citations attached to messages'
        );
      } catch (citationError) {
        // Non-critical: log error but continue returning messages
        logger.warn(
          { error: citationError instanceof Error ? citationError.message : String(citationError), sessionId },
          'Failed to fetch citations, continuing without them'
        );
      }
    }

    // Fetch chat attachments for user standard messages
    const userMessageIds = messages
      .filter(m => m.type === 'standard' && m.role === 'user')
      .map(m => m.id);

    if (userMessageIds.length > 0) {
      try {
        const attachmentService = getMessageChatAttachmentService();
        const attachmentsMap = await attachmentService.getAttachmentsForMessages(userMessageIds);

        // Attach chat attachments to user messages
        for (const message of messages) {
          if (message.type === 'standard' && message.role === 'user') {
            const messageAttachments = attachmentsMap.get(message.id);
            if (messageAttachments && messageAttachments.length > 0) {
              (message as Record<string, unknown>).chatAttachments = messageAttachments;
            }
          }
        }

        logger.debug(
          { sessionId, attachmentMessagesCount: attachmentsMap.size },
          'Chat attachments attached to messages'
        );
      } catch (attachmentError) {
        // Non-critical: log error but continue returning messages
        logger.warn(
          { error: attachmentError instanceof Error ? attachmentError.message : String(attachmentError), sessionId },
          'Failed to fetch chat attachments, continuing without them'
        );
      }
    }

    logger.info({ sessionId, count: messages.length, hasMore: result.pagination.hasMore }, 'Messages retrieved');

    res.json({
      messages,
      pagination: result.pagination,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage, sessionId: req.params.sessionId }, 'Get messages failed');

    if (isUUIDConversionError(error)) {
      sendError(res, ErrorCode.SESSION_NOT_FOUND, 'Session not found');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get messages');
  }
});

export default router;
