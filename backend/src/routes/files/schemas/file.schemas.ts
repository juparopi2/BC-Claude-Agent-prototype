/**
 * File Routes Zod Schemas
 *
 * Validation schemas for all file-related endpoints.
 *
 * @module routes/files/schemas/file.schemas
 */

import { z } from 'zod';
import {
  FOLDER_NAME_REGEX,
  FILE_VALIDATION,
  FILE_PAGINATION,
} from '../constants/file.constants';

/**
 * Schema for file upload request body
 */
export const uploadFileSchema = z.object({
  parentFolderId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(), // For WebSocket progress events
});

export type UploadFileInput = z.infer<typeof uploadFileSchema>;

/**
 * Schema for create folder request
 */
export const createFolderSchema = z.object({
  name: z
    .string()
    .min(1, 'Folder name is required')
    .max(FILE_VALIDATION.MAX_NAME_LENGTH, `Folder name must be ${FILE_VALIDATION.MAX_NAME_LENGTH} characters or less`)
    .regex(
      FOLDER_NAME_REGEX,
      'Folder name can only contain letters, numbers, spaces, hyphens, underscores, commas, periods, and ampersands'
    ),
  parentFolderId: z.string().uuid().optional(),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;

/**
 * Schema for get files query parameters
 */
export const getFilesSchema = z.object({
  folderId: z.string().uuid().optional(),
  sortBy: z.enum(['name', 'date', 'size']).optional().default('date'),
  favoritesFirst: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(FILE_PAGINATION.MAX_LIMIT).optional().default(FILE_PAGINATION.DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).optional().default(FILE_PAGINATION.DEFAULT_OFFSET),
});

export type GetFilesInput = z.infer<typeof getFilesSchema>;

/**
 * Schema for file ID parameter
 */
export const fileIdSchema = z.object({
  id: z.string().uuid(),
});

export type FileIdInput = z.infer<typeof fileIdSchema>;

/**
 * Schema for update file request
 */
export const updateFileSchema = z.object({
  name: z
    .string()
    .min(1, 'File name is required')
    .max(FILE_VALIDATION.MAX_NAME_LENGTH, `File name must be ${FILE_VALIDATION.MAX_NAME_LENGTH} characters or less`)
    .regex(
      FOLDER_NAME_REGEX,
      'File name can only contain letters, numbers, spaces, hyphens, underscores, commas, periods, and ampersands'
    )
    .optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
});

export type UpdateFileInput = z.infer<typeof updateFileSchema>;

/**
 * Schema for image search query
 */
export const imageSearchSchema = z.object({
  q: z.string().min(1, 'Query is required').max(FILE_VALIDATION.MAX_SEARCH_QUERY_LENGTH, `Query must be ${FILE_VALIDATION.MAX_SEARCH_QUERY_LENGTH} characters or less`),
  top: z.coerce.number().int().min(1).max(FILE_VALIDATION.MAX_SEARCH_RESULTS).optional().default(FILE_VALIDATION.DEFAULT_SEARCH_RESULTS),
  minScore: z.coerce.number().min(0).max(1).optional().default(FILE_VALIDATION.DEFAULT_MIN_SCORE),
});

export type ImageSearchInput = z.infer<typeof imageSearchSchema>;

/**
 * Schema for duplicate check request (content-based)
 */
export const checkDuplicatesSchema = z.object({
  files: z.array(z.object({
    tempId: z.string().min(1, 'tempId is required'),
    contentHash: z.string().length(FILE_VALIDATION.CONTENT_HASH_LENGTH, `contentHash must be ${FILE_VALIDATION.CONTENT_HASH_LENGTH} characters (SHA-256 hex)`).regex(/^[a-f0-9]+$/i, 'contentHash must be valid hex'),
    fileName: z.string().min(1, 'fileName is required').max(500, 'fileName must be 500 characters or less'),
  })).min(1, 'At least one file required').max(FILE_VALIDATION.MAX_DUPLICATE_CHECK_FILES, `Maximum ${FILE_VALIDATION.MAX_DUPLICATE_CHECK_FILES} files per request`),
});

export type CheckDuplicatesInput = z.infer<typeof checkDuplicatesSchema>;

/**
 * Schema for retry processing request body
 */
export const retryProcessingSchema = z.object({
  scope: z.enum(['full', 'embedding_only']).optional().default('full'),
});

export type RetryProcessingInput = z.infer<typeof retryProcessingSchema>;

/**
 * Schema for batch folder creation request
 *
 * Creates multiple folders in a single request, useful for folder upload.
 * Folders are created in topological order (parents before children).
 */
export const createFolderBatchSchema = z.object({
  folders: z.array(z.object({
    /** Client-generated temporary ID for correlation */
    tempId: z.string().min(1, 'tempId is required'),
    /** Folder name */
    name: z
      .string()
      .min(1, 'Folder name is required')
      .max(FILE_VALIDATION.MAX_NAME_LENGTH, `Folder name must be ${FILE_VALIDATION.MAX_NAME_LENGTH} characters or less`)
      .regex(
        FOLDER_NAME_REGEX,
        'Folder name can only contain letters, numbers, spaces, hyphens, underscores, commas, periods, and ampersands'
      ),
    /**
     * Parent path for nesting. Use tempId of parent folder.
     * null = root level (or under targetFolderId if provided)
     */
    parentTempId: z.string().nullable(),
  })).min(1, 'At least one folder required').max(100, 'Maximum 100 folders per batch'),
  /** Target folder ID where all root folders will be created */
  targetFolderId: z.string().uuid().nullable().optional(),
});

export type CreateFolderBatchInput = z.infer<typeof createFolderBatchSchema>;
