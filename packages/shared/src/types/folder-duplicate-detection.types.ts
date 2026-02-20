/**
 * Folder Duplicate Detection Types V2
 *
 * Types and Zod schemas for folder-level duplicate detection.
 * Checks root-level manifest folders against existing folders in the target location.
 *
 * @module @bc-agent/shared/types/folder-duplicate-detection
 */

import { z } from 'zod';

// ============================================
// Request Types
// ============================================

/** Input for checking a single folder */
export interface FolderDuplicateCheckInput {
  tempId: string;
  folderName: string;
  parentTempId?: string;
  fileCount: number;
}

/** Request body for POST /api/v2/uploads/check-folder-duplicates */
export interface CheckFolderDuplicatesRequestV2 {
  folders: FolderDuplicateCheckInput[];
  targetFolderId?: string;
}

// ============================================
// Response Types
// ============================================

/** Result for a single folder check */
export interface FolderDuplicateCheckResult {
  tempId: string;
  folderName: string;
  isDuplicate: boolean;
  existingFolderId?: string;
  suggestedName?: string;
  parentFolderId: string | null;
}

/** Response body for POST /api/v2/uploads/check-folder-duplicates */
export interface CheckFolderDuplicatesResponseV2 {
  results: FolderDuplicateCheckResult[];
  targetFolderPath: string | null;
}

// ============================================
// Zod Schemas
// ============================================

/** Validates a single folder input for duplicate checking */
export const folderDuplicateCheckInputSchema = z.object({
  tempId: z.string().min(1, 'tempId is required'),
  folderName: z.string().min(1, 'folderName is required').max(500),
  parentTempId: z.string().min(1).optional(),
  fileCount: z.number().int().nonnegative(),
});

/** Validates the full folder duplicate check request (max 200 folders) */
export const checkFolderDuplicatesRequestV2Schema = z.object({
  folders: z
    .array(folderDuplicateCheckInputSchema)
    .min(1, 'At least one folder is required')
    .max(200, 'Maximum 200 folders per batch'),
  targetFolderId: z.string().min(1).toUpperCase().optional(),
});
