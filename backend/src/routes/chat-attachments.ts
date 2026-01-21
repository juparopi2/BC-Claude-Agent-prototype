/**
 * Chat Attachments Routes
 *
 * Handles ephemeral chat attachment operations.
 * These attachments are sent directly to Anthropic (no RAG processing).
 *
 * Endpoints:
 * - POST /api/chat/attachments - Upload chat attachment
 * - GET /api/chat/attachments - List attachments for a session
 * - GET /api/chat/attachments/:id - Get single attachment metadata
 * - GET /api/chat/attachments/:id/content - Download attachment content
 * - DELETE /api/chat/attachments/:id - Delete attachment
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getChatAttachmentService } from '@/domains/chat-attachments';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import {
  CHAT_ATTACHMENT_CONFIG,
  validateChatAttachmentMimeType,
  validateChatAttachmentSize,
} from '@bc-agent/shared';

const logger = createChildLogger({ service: 'ChatAttachmentRoutes' });
const router = Router();

// ============================================
// Multer Configuration
// ============================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHAT_ATTACHMENT_CONFIG.MAX_DOCUMENT_SIZE_BYTES, // 32 MB (largest limit)
    files: 1, // One file per request
    fieldSize: 10 * 1024, // 10 KB field size
  },
  fileFilter: (_req, file, cb) => {
    // Validate MIME type
    const validation = validateChatAttachmentMimeType(file.mimetype);
    if (!validation.valid) {
      cb(new Error(validation.error!));
      return;
    }
    cb(null, true);
  },
});

/**
 * Wrapper for Multer middleware that catches and handles Multer errors
 */
function uploadWithErrorHandling(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err) => {
    if (err instanceof MulterError) {
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          res.status(413).json({
            error: 'Payload Too Large',
            message: 'File size exceeds maximum limit',
            code: 'PAYLOAD_TOO_LARGE',
          });
          return;
        case 'LIMIT_UNEXPECTED_FILE':
          sendError(res, ErrorCode.VALIDATION_ERROR, 'Unexpected file field');
          return;
        default:
          sendError(res, ErrorCode.VALIDATION_ERROR, err.message);
          return;
      }
    }
    if (err) {
      // MIME type validation error from fileFilter
      sendError(res, ErrorCode.VALIDATION_ERROR, err.message);
      return;
    }
    next();
  });
}

// ============================================
// Zod Schemas
// ============================================

const uploadBodySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
  ttlHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_ATTACHMENT_CONFIG.MAX_TTL_HOURS)
    .optional()
    .default(CHAT_ATTACHMENT_CONFIG.DEFAULT_TTL_HOURS),
});

const listQuerySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
});

const attachmentIdParamSchema = z.object({
  id: z.string().uuid('Invalid attachment ID format'),
});

// ============================================
// Apply Authentication Middleware
// ============================================

router.use(authenticateMicrosoft);

// ============================================
// Routes
// ============================================

/**
 * POST /api/chat/attachments
 *
 * Upload a chat attachment for a session.
 * File is stored in blob storage and associated with the session.
 *
 * Body (multipart/form-data):
 * - file: The file to upload (required)
 * - sessionId: UUID of the chat session (required)
 * - ttlHours: Optional TTL in hours (default: 24, max: 168)
 *
 * Response: 201 Created
 * {
 *   attachment: ParsedChatAttachment
 * }
 */
router.post(
  '/',
  uploadWithErrorHandling,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId?.toUpperCase();
      if (!userId) {
        sendError(res, ErrorCode.UNAUTHORIZED, 'User ID not found');
        return;
      }

      // Validate file presence
      if (!req.file) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'No file provided');
        return;
      }

      // Parse and validate body
      const bodyResult = uploadBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          bodyResult.error.errors.map(e => e.message).join(', ')
        );
        return;
      }

      const { sessionId, ttlHours } = bodyResult.data;

      // Additional size validation based on MIME type
      const sizeValidation = validateChatAttachmentSize(req.file.size, req.file.mimetype);
      if (!sizeValidation.valid) {
        sendError(res, ErrorCode.VALIDATION_ERROR, sizeValidation.error!);
        return;
      }

      // Upload attachment
      const attachmentService = getChatAttachmentService();
      const attachment = await attachmentService.uploadAttachment({
        userId,
        sessionId: sessionId.toUpperCase(),
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        buffer: req.file.buffer,
        ttlHours,
      });

      logger.info(
        { attachmentId: attachment.id, userId, sessionId, fileName: req.file.originalname },
        'Chat attachment uploaded'
      );

      res.status(201).json({ attachment });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/chat/attachments
 *
 * List all non-expired attachments for a session.
 *
 * Query params:
 * - sessionId: UUID of the chat session (required)
 *
 * Response: 200 OK
 * {
 *   attachments: ParsedChatAttachment[]
 * }
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId?.toUpperCase();
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User ID not found');
      return;
    }

    // Validate query params
    const queryResult = listQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      sendError(
        res,
        ErrorCode.VALIDATION_ERROR,
        queryResult.error.errors.map(e => e.message).join(', ')
      );
      return;
    }

    const { sessionId } = queryResult.data;

    const attachmentService = getChatAttachmentService();
    const attachments = await attachmentService.getAttachmentsBySession(
      userId,
      sessionId.toUpperCase()
    );

    res.json({ attachments });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/chat/attachments/:id
 *
 * Get a single attachment by ID.
 *
 * Response: 200 OK
 * {
 *   attachment: ParsedChatAttachment
 * }
 *
 * Response: 404 Not Found (if attachment not found or expired)
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId?.toUpperCase();
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User ID not found');
      return;
    }

    // Validate ID param
    const paramResult = attachmentIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid attachment ID');
      return;
    }

    const attachmentId = paramResult.data.id.toUpperCase();

    const attachmentService = getChatAttachmentService();
    const attachment = await attachmentService.getAttachment(userId, attachmentId);

    if (!attachment) {
      sendError(res, ErrorCode.NOT_FOUND, 'Attachment not found');
      return;
    }

    res.json({ attachment });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/chat/attachments/:id/content
 *
 * Download the raw content of a chat attachment.
 * Returns the file with appropriate Content-Type header.
 *
 * Response: 200 OK with file content
 * Response: 404 Not Found (if attachment not found or expired)
 */
router.get('/:id/content', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId?.toUpperCase();
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User ID not found');
      return;
    }

    // Validate ID param
    const paramResult = attachmentIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid attachment ID');
      return;
    }

    const attachmentId = paramResult.data.id.toUpperCase();

    // Get attachment record with blob path
    const attachmentService = getChatAttachmentService();
    const attachment = await attachmentService.getAttachmentRecord(userId, attachmentId);

    if (!attachment) {
      sendError(res, ErrorCode.NOT_FOUND, 'Attachment not found or expired');
      return;
    }

    // Download from blob storage
    const fileUploadService = getFileUploadService();
    const buffer = await fileUploadService.downloadFromBlob(attachment.blob_path);

    // Set response headers
    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(attachment.name)}"`
    );
    // Allow browser caching for 1 hour (attachments are ephemeral but still worth caching briefly)
    res.setHeader('Cache-Control', 'private, max-age=3600');

    logger.debug({ attachmentId, userId, mimeType: attachment.mime_type }, 'Serving attachment content');

    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/chat/attachments/:id
 *
 * Soft delete a chat attachment.
 * Blob will be cleaned up by the cleanup job.
 *
 * Response: 200 OK
 * {
 *   message: 'Attachment deleted'
 * }
 *
 * Response: 404 Not Found (if attachment not found)
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId?.toUpperCase();
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User ID not found');
      return;
    }

    // Validate ID param
    const paramResult = attachmentIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid attachment ID');
      return;
    }

    const attachmentId = paramResult.data.id.toUpperCase();

    const attachmentService = getChatAttachmentService();
    const result = await attachmentService.deleteAttachment(userId, attachmentId);

    if (!result) {
      sendError(res, ErrorCode.NOT_FOUND, 'Attachment not found');
      return;
    }

    logger.info({ attachmentId, userId }, 'Chat attachment deleted');

    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;
