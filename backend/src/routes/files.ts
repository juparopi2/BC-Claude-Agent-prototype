/**
 * File Management Routes
 *
 * Handles file upload, folder management, and file operations.
 *
 * Endpoints:
 * - POST /api/files/upload - Upload file(s)
 * - POST /api/files/folders - Create folder
 * - GET /api/files - List files
 * - GET /api/files/:id - Get file metadata
 * - GET /api/files/:id/download - Download file
 * - PATCH /api/files/:id - Update file metadata
 * - DELETE /api/files/:id - Delete file
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import multer from 'multer';
import { authenticateMicrosoft } from '@middleware/auth-oauth';
import { getFileService } from '@services/files';
import { getFileUploadService } from '@services/files';
import { getUsageTrackingService } from '@services/tracking/UsageTrackingService';
import { sendError } from '@/utils/error-response';
import { ErrorCode } from '@/constants/errors';
import { logger } from '@/utils/logger';
import type { ParsedFile } from '@/types/file.types';

const router = Router();

// ============================================
// Multer Configuration
// ============================================

const upload = multer({
  storage: multer.memoryStorage(), // In-memory (no disk I/O)
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB per file
    files: 20, // Max 20 files per request
    fieldSize: 10 * 1024, // 10 KB field size
  },
});

// ============================================
// Zod Schemas for Validation
// ============================================

const uploadFileSchema = z.object({
  parentFolderId: z.string().uuid().optional(),
});

const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentFolderId: z.string().uuid().optional(),
});

const getFilesSchema = z.object({
  folderId: z.string().uuid().optional(),
  sortBy: z.enum(['name', 'date', 'size']).optional().default('date'),
  favorites: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const fileIdSchema = z.object({
  id: z.string().uuid(),
});

const updateFileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
});

// ============================================
// Helper Functions
// ============================================

/**
 * Extract userId from authenticated request
 *
 * @param req - Express request with auth
 * @returns User ID
 * @throws Error if not authenticated
 */
function getUserId(req: Request): string {
  if (!req.userId) {
    throw new Error('User not authenticated');
  }
  return req.userId;
}

// ============================================
// Routes
// ============================================

/**
 * POST /api/files/upload
 * Upload one or more files
 */
router.post(
  '/upload',
  authenticateMicrosoft,
  upload.array('files', 20),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Get userId from authenticated request
      const userId = getUserId(req);

      // Validate query params
      const validation = uploadFileSchema.safeParse(req.query);
      if (!validation.success) {
        sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
        return;
      }

      const { parentFolderId } = validation.data;

      // Validate files array exists and not empty
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'No files provided');
        return;
      }

      logger.info({ userId, fileCount: files.length, parentFolderId }, 'Uploading files');

      const fileUploadService = getFileUploadService();
      const fileService = getFileService();
      const uploadedFiles: ParsedFile[] = [];

      // Loop through files and upload each one
      for (const file of files) {
        try {
          // Validate file type
          fileUploadService.validateFileType(file.mimetype);

          // Validate file size
          fileUploadService.validateFileSize(file.size, file.mimetype);

          // Generate blob path
          const blobPath = fileUploadService.generateBlobPath(userId, file.originalname);

          // Upload to blob storage
          await fileUploadService.uploadToBlob(file.buffer, blobPath, file.mimetype);

          // Create file record in database
          const fileId = await fileService.createFileRecord({
            userId,
            name: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            blobPath,
            parentFolderId,
          });

          // Track file upload usage (fire-and-forget)
          const usageTrackingService = getUsageTrackingService();
          usageTrackingService.trackFileUpload(userId, fileId, file.size, {
            mimeType: file.mimetype,
            fileName: file.originalname,
            blobPath
          }).catch((err) => {
            // Fire-and-forget: log but don't fail the upload
            logger.warn({ err, userId, fileId, fileName: file.originalname }, 'Failed to track file upload');
          });

          // Get created file metadata
          const createdFile = await fileService.getFile(userId, fileId);
          if (createdFile) {
            uploadedFiles.push(createdFile);
          }

          logger.info({ userId, fileId, fileName: file.originalname }, 'File uploaded successfully');
        } catch (fileError) {
          // Log error but continue with other files
          logger.error({ error: fileError, userId, fileName: file.originalname }, 'Failed to upload file');

          // If this is a validation error, we should still fail the whole request
          if (fileError instanceof Error && (
            fileError.message.includes('File type not allowed') ||
            fileError.message.includes('File size exceeds')
          )) {
            sendError(res, ErrorCode.VALIDATION_ERROR, fileError.message);
            return;
          }
        }
      }

      if (uploadedFiles.length === 0) {
        sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to upload any files');
        return;
      }

      logger.info({ userId, uploadedCount: uploadedFiles.length }, 'File upload complete');

      res.status(201).json({
        files: uploadedFiles,
      });
    } catch (error) {
      logger.error({ error, userId: req.userId }, 'Upload files failed');

      if (error instanceof ZodError) {
        sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
        return;
      }

      if (error instanceof Error && error.message === 'User not authenticated') {
        sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
        return;
      }

      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to upload files');
    }
  }
);

/**
 * POST /api/files/folders
 * Create a new folder
 */
router.post('/folders', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate request body
    const validation = createFolderSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Validation failed');
      return;
    }

    const { name, parentFolderId } = validation.data;

    logger.info({ userId, name, parentFolderId }, 'Creating folder');

    // Create folder with FileService
    const fileService = getFileService();
    const folderId = await fileService.createFolder(userId, name, parentFolderId);

    // Get created folder metadata
    const folder = await fileService.getFile(userId, folderId);

    if (!folder) {
      logger.error({ userId, folderId }, 'Failed to retrieve created folder');
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve created folder');
      return;
    }

    logger.info({ userId, folderId }, 'Folder created successfully');

    res.status(201).json({
      folder,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Create folder failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to create folder');
  }
});

/**
 * GET /api/files
 * List files with filtering, sorting, and pagination
 */
router.get('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate query params
    const validation = getFilesSchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { folderId, sortBy, favorites, limit, offset } = validation.data;

    logger.info({ userId, folderId, sortBy, favorites, limit, offset }, 'Getting files');

    // Get files with FileService
    const fileService = getFileService();
    const files = await fileService.getFiles({
      userId,
      folderId,
      sortBy,
      favorites,
      limit,
      offset,
    });

    // Get total count for pagination
    const total = await fileService.getFileCount(userId, folderId);

    logger.info({ userId, fileCount: files.length, total }, 'Files retrieved successfully');

    res.json({
      files,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get files failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get files');
  }
});

/**
 * GET /api/files/:id
 * Get file metadata (with ownership check)
 */
router.get('/:id', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate params
    const validation = fileIdSchema.safeParse(req.params);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid file ID');
      return;
    }

    const { id } = validation.data;

    logger.info({ userId, fileId: id }, 'Getting file metadata');

    // Get file with FileService (includes ownership check)
    const fileService = getFileService();
    const file = await fileService.getFile(userId, id);

    if (!file) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    logger.info({ userId, fileId: id }, 'File metadata retrieved');

    res.json({
      file,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Get file metadata failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get file metadata');
  }
});

/**
 * GET /api/files/:id/download
 * Download file blob
 */
router.get('/:id/download', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate params
    const validation = fileIdSchema.safeParse(req.params);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid file ID');
      return;
    }

    const { id } = validation.data;

    logger.info({ userId, fileId: id }, 'Downloading file');

    // Get file metadata (ownership check)
    const fileService = getFileService();
    const file = await fileService.getFile(userId, id);

    if (!file) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    // Check if it's a folder (folders cannot be downloaded)
    if (file.isFolder) {
      logger.warn({ userId, fileId: id }, 'Cannot download folder');
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Cannot download a folder');
      return;
    }

    // Download blob from storage
    const fileUploadService = getFileUploadService();
    const buffer = await fileUploadService.downloadFromBlob(file.blobPath);

    logger.info({ userId, fileId: id, size: buffer.length }, 'File downloaded successfully');

    // Set Content-Type and Content-Disposition headers
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.setHeader('Content-Length', buffer.length.toString());

    // Send buffer
    res.send(buffer);
  } catch (error) {
    logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Download file failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to download file');
  }
});

/**
 * PATCH /api/files/:id
 * Update file metadata (name, folder, favorite)
 */
router.patch('/:id', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate params
    const paramsValidation = fileIdSchema.safeParse(req.params);
    if (!paramsValidation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, paramsValidation.error.errors[0]?.message || 'Invalid file ID');
      return;
    }

    const { id } = paramsValidation.data;

    // Validate body
    const bodyValidation = updateFileSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, bodyValidation.error.errors[0]?.message || 'Validation failed');
      return;
    }

    const updates = bodyValidation.data;

    logger.info({ userId, fileId: id, updates }, 'Updating file');

    // Check file exists and is owned by user
    const fileService = getFileService();
    const existingFile = await fileService.getFile(userId, id);

    if (!existingFile) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    // Update file with FileService
    await fileService.updateFile(userId, id, updates);

    // Get updated file metadata
    const updatedFile = await fileService.getFile(userId, id);

    if (!updatedFile) {
      logger.error({ userId, fileId: id }, 'Failed to retrieve updated file');
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve updated file');
      return;
    }

    logger.info({ userId, fileId: id }, 'File updated successfully');

    res.json({
      file: updatedFile,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Update file failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    if (error instanceof Error && error.message === 'File not found or unauthorized') {
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to update file');
  }
});

/**
 * DELETE /api/files/:id
 * Delete file or folder (CASCADE deletes related records)
 */
router.delete('/:id', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate params
    const validation = fileIdSchema.safeParse(req.params);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid file ID');
      return;
    }

    const { id } = validation.data;

    logger.info({ userId, fileId: id }, 'Deleting file');

    // Delete file from database (returns blob_path for cleanup)
    const fileService = getFileService();
    const blobPath = await fileService.deleteFile(userId, id);

    // If blob_path exists, delete from blob storage
    if (blobPath) {
      try {
        const fileUploadService = getFileUploadService();
        await fileUploadService.deleteFromBlob(blobPath);
        logger.info({ userId, fileId: id, blobPath }, 'File deleted from blob storage');
      } catch (blobError) {
        // Log error but don't fail the request (DB record already deleted)
        logger.error({ error: blobError, userId, fileId: id, blobPath }, 'Failed to delete blob (DB record already deleted)');
      }
    }

    logger.info({ userId, fileId: id }, 'File deleted successfully');

    res.status(204).send();
  } catch (error) {
    logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Delete file failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    if (error instanceof Error && error.message === 'File not found or unauthorized') {
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to delete file');
  }
});

export default router;
