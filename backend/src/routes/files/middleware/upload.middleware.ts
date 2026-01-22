/**
 * Upload Middleware
 *
 * Multer configuration and error handling for file uploads.
 *
 * @module routes/files/middleware/upload.middleware
 */

import { Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { MULTER_LIMITS } from '../constants/file.constants';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';

/**
 * Configured Multer instance for file uploads
 */
export const upload = multer({
  storage: multer.memoryStorage(), // In-memory (no disk I/O)
  limits: {
    fileSize: MULTER_LIMITS.FILE_SIZE,
    files: MULTER_LIMITS.MAX_FILES,
    fieldSize: MULTER_LIMITS.FIELD_SIZE,
  },
});

/**
 * Wrapper for Multer middleware that catches and handles Multer errors
 * Returns 413 for file size limit, 400 for other validation errors
 */
export function uploadWithErrorHandling(req: Request, res: Response, next: NextFunction): void {
  upload.array('files', MULTER_LIMITS.MAX_FILES)(req, res, (err) => {
    if (err instanceof MulterError) {
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          // 413 Payload Too Large
          res.status(413).json({
            error: 'Payload Too Large',
            message: `File size exceeds ${MULTER_LIMITS.FILE_SIZE / (1024 * 1024)}MB limit`,
            code: 'PAYLOAD_TOO_LARGE',
          });
          return;
        case 'LIMIT_FILE_COUNT':
          sendError(res, ErrorCode.VALIDATION_ERROR, `Too many files (max ${MULTER_LIMITS.MAX_FILES})`);
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
      next(err);
      return;
    }
    next();
  });
}
