/**
 * File Management Routes
 *
 * Handles file upload, folder management, and file operations.
 *
 * Endpoints:
 * - POST /api/files/upload - Upload file(s)
 * - POST /api/files/folders - Create folder
 * - GET /api/files - List files
 * - GET /api/files/search/images - Search images by semantic query
 * - GET /api/files/:id - Get file metadata
 * - GET /api/files/:id/download - Download file
 * - PATCH /api/files/:id - Update file metadata
 * - DELETE /api/files/:id - Delete file
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import multer, { MulterError } from 'multer';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileService } from '@services/files';
import { getFileUploadService } from '@services/files';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import type { ParsedFile } from '@/types/file.types';

const logger = createChildLogger({ service: 'FileRoutes' });
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

/**
 * Wrapper for Multer middleware that catches and handles Multer errors
 * Returns 413 for file size limit, 400 for other validation errors
 */
function uploadWithErrorHandling(req: Request, res: Response, next: NextFunction): void {
  upload.array('files', 20)(req, res, (err) => {
    if (err instanceof MulterError) {
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          // 413 Payload Too Large
          res.status(413).json({
            error: 'Payload Too Large',
            message: 'File size exceeds 100MB limit',
            code: 'PAYLOAD_TOO_LARGE',
          });
          return;
        case 'LIMIT_FILE_COUNT':
          sendError(res, ErrorCode.VALIDATION_ERROR, 'Too many files (max 20)');
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

// ============================================
// Zod Schemas for Validation
// ============================================

const uploadFileSchema = z.object({
  parentFolderId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(), // For WebSocket progress events
});

/**
 * Regex pattern for valid folder/file names.
 *
 * Allows: Unicode letters (\p{L}), numbers (\p{N}), spaces, hyphens, underscores, commas, periods.
 * Supports Danish characters (æ, ø, å), German (ü, ß), and other European diacritics.
 */
const FOLDER_NAME_REGEX = /^[\p{L}\p{N}\s\-_,.]+$/u;

const createFolderSchema = z.object({
  name: z
    .string()
    .min(1, 'Folder name is required')
    .max(255, 'Folder name must be 255 characters or less')
    .regex(
      FOLDER_NAME_REGEX,
      'Folder name can only contain letters, numbers, spaces, hyphens, underscores, commas, and periods'
    ),
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
  name: z
    .string()
    .min(1, 'File name is required')
    .max(255, 'File name must be 255 characters or less')
    .regex(
      FOLDER_NAME_REGEX,
      'File name can only contain letters, numbers, spaces, hyphens, underscores, commas, and periods'
    )
    .optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
});

const imageSearchSchema = z.object({
  q: z.string().min(1, 'Query is required').max(1000, 'Query must be 1000 characters or less'),
  top: z.coerce.number().int().min(1).max(50).optional().default(10),
  minScore: z.coerce.number().min(0).max(1).optional().default(0.5),
});

// ============================================
// Helper Functions
// ============================================

/**
 * Detect and fix mojibake in filenames from multer
 *
 * Multer receives filenames from Content-Disposition headers which are
 * encoded as Latin-1 (ISO-8859-1) per HTTP RFC. When the browser sends
 * UTF-8 characters, they get misinterpreted as Latin-1, causing mojibake.
 *
 * This function detects common mojibake patterns and reverses them.
 *
 * @param filename - Potentially corrupted filename from multer
 * @returns Fixed filename with proper UTF-8 characters
 * @example
 * fixFilenameMojibake('Order received â proâ¢duhkâ¢tiv.pdf')
 * // Returns: 'Order received – pro•duhk•tiv.pdf'
 */
export function fixFilenameMojibake(filename: string): string {
  try {
    // Check if filename contains mojibake markers
    const hasMojibake = /[â€¢™'""–—Ã]/.test(filename);

    if (!hasMojibake) {
      // No mojibake detected, return as-is
      return filename;
    }

    // Convert the corrupted string back to UTF-8
    // The mojibake happened because UTF-8 bytes were interpreted as Latin-1
    // We reverse it by converting back: Latin-1 → bytes → UTF-8
    const latin1Buffer = Buffer.from(filename, 'latin1');
    const utf8String = latin1Buffer.toString('utf8');

    logger.debug({
      original: filename,
      fixed: utf8String
    }, 'Fixed mojibake in filename');

    return utf8String;
  } catch (error) {
    // If conversion fails, return original
    logger.warn({ filename, error }, 'Failed to fix mojibake, using original filename');
    return filename;
  }
}

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
  uploadWithErrorHandling, // Multer with proper error handling (413 for size limit)
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Get userId from authenticated request
      const userId = getUserId(req);

      // Validate body params (Multer puts non-file FormData fields in req.body)
      const validation = uploadFileSchema.safeParse(req.body);
      if (!validation.success) {
        sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid body parameters');
        return;
      }

      const { parentFolderId, sessionId } = validation.data;

      // Get services
      const fileService = getFileService();
      const fileUploadService = getFileUploadService();

      // Validate parent folder if provided
      if (parentFolderId) {
        const parentFolder = await fileService.getFile(userId, parentFolderId);
        if (!parentFolder) {
          sendError(res, ErrorCode.NOT_FOUND, 'Parent folder not found');
          return;
        }
        if (!parentFolder.isFolder) {
          sendError(res, ErrorCode.VALIDATION_ERROR, 'Parent must be a folder');
          return;
        }
      }

      // Validate files array exists and not empty
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'No files provided');
        return;
      }

      logger.info({ userId, fileCount: files.length, parentFolderId }, 'Uploading files');
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

          // Fix mojibake in filename before storing
          const fixedFilename = fixFilenameMojibake(file.originalname);

          // Create file record in database
          const fileId = await fileService.createFileRecord({
            userId,
            name: fixedFilename,
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

          // Enqueue file processing job (fire-and-forget)
          // This triggers text extraction via BullMQ worker
          const messageQueue = getMessageQueue();
          messageQueue.addFileProcessingJob({
            fileId,
            userId,
            sessionId,
            mimeType: file.mimetype,
            blobPath,
            fileName: fixedFilename,
          }).catch((err) => {
            // Fire-and-forget: log but don't fail the upload
            logger.warn({ err, userId, fileId, fileName: file.originalname }, 'Failed to enqueue file processing job');
          });

          // Get created file metadata
          const createdFile = await fileService.getFile(userId, fileId);
          if (createdFile) {
            uploadedFiles.push(createdFile);
          }

          logger.info({
            userId,
            fileId,
            originalName: file.originalname,
            fixedName: fixedFilename,
            fileName: file.originalname
          }, 'File uploaded successfully');
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
 * GET /api/files/search/images
 * Search images by semantic text query
 *
 * Uses Azure Vision VectorizeText API to convert text query into image embedding space,
 * then searches for semantically similar images in Azure AI Search.
 *
 * Query params:
 * - q: Search query text (required, max 1000 chars)
 * - top: Max results to return (default 10, max 50)
 * - minScore: Minimum similarity score 0-1 (default 0.5)
 */
router.get('/search/images', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate query params
    const validation = imageSearchSchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { q, top, minScore } = validation.data;

    logger.info({ userId, queryLength: q.length, top, minScore }, 'Searching images');

    // Generate image query embedding (1024d, same space as image embeddings)
    const embeddingService = EmbeddingService.getInstance();
    const embedding = await embeddingService.generateImageQueryEmbedding(q, userId, 'image-search');

    // Search for similar images
    const vectorSearchService = VectorSearchService.getInstance();
    const results = await vectorSearchService.searchImages({
      embedding: embedding.embedding,
      userId,
      top,
      minScore,
    });

    logger.info({ userId, query: q, resultCount: results.length }, 'Image search completed');

    res.json({
      results,
      query: q,
      top,
      minScore,
    });
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      userId: req.userId,
    }, 'Image search failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    if (error instanceof Error && error.message.includes('Azure Vision not configured')) {
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Image search not available');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to search images');
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

    // RFC 5987 encoding for filename with UTF-8 support (for international characters)
    // Format: filename*=UTF-8''encoded_filename
    const encodedFilename = encodeURIComponent(file.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"; filename*=UTF-8''${encodedFilename}`);

    res.setHeader('Content-Length', buffer.length.toString());

    // Send buffer
    res.send(buffer);
  } catch (error) {
    logger.error({ 
      error, 
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      userId: req.userId, 
      fileId: req.params.id 
    }, 'Download file failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    // Pass through specific blob storage errors if safe
    if (error instanceof Error && error.message.includes('BlobNotFound')) {
       sendError(res, ErrorCode.NOT_FOUND, 'File content not found in storage');
       return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to download file');
  }
});

/**
 * GET /api/files/:id/content
 * Stream file content for inline preview (images, PDFs, text)
 *
 * Similar to /download but with Content-Disposition: inline for browser preview.
 * Used by FilePreviewModal to display files without triggering a download.
 */
router.get('/:id/content', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
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

    logger.info({ userId, fileId: id }, 'Serving file content for preview');

    // Get file metadata (ownership check)
    const fileService = getFileService();
    const file = await fileService.getFile(userId, id);

    if (!file) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    // Check if it's a folder (folders cannot be previewed)
    if (file.isFolder) {
      logger.warn({ userId, fileId: id }, 'Cannot preview folder');
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Cannot preview a folder');
      return;
    }

    // Download blob from storage
    const fileUploadService = getFileUploadService();
    const buffer = await fileUploadService.downloadFromBlob(file.blobPath);

    logger.info({ userId, fileId: id, size: buffer.length }, 'File content served successfully');

    // Set Content-Type header
    res.setHeader('Content-Type', file.mimeType);

    // Set Content-Disposition: inline (for preview, not download)
    // This tells the browser to display the content inline if possible
    const encodedFilename = encodeURIComponent(file.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.setHeader('Content-Disposition', `inline; filename="${file.name}"; filename*=UTF-8''${encodedFilename}`);

    res.setHeader('Content-Length', buffer.length.toString());

    // Enable CORS for image preview (some browsers require this)
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

    // Send buffer
    res.send(buffer);
  } catch (error) {
    logger.error({
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      userId: req.userId,
      fileId: req.params.id
    }, 'Serve file content failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    // Pass through specific blob storage errors if safe
    if (error instanceof Error && error.message.includes('BlobNotFound')) {
      sendError(res, ErrorCode.NOT_FOUND, 'File content not found in storage');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to serve file content');
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

    // Delete file from database (returns list of blob_paths for cleanup)
    const fileService = getFileService();
    const blobPaths = await fileService.deleteFile(userId, id);

    // Helper to delete a single blob safely
    const deleteBlobSafely = async (path: string) => {
        try {
            const fileUploadService = getFileUploadService();
            await fileUploadService.deleteFromBlob(path);
            logger.info({ userId, blobPath: path }, 'File deleted from blob storage');
        } catch (blobError) {
            // Log error but don't fail the request (DB record already deleted)
            logger.error({ error: blobError, userId, blobPath: path }, 'Failed to delete blob (DB record already deleted)');
        }
    };

    // Delete all blobs in parallel
    if (blobPaths.length > 0) {
        await Promise.all(blobPaths.map(path => deleteBlobSafely(path)));
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
