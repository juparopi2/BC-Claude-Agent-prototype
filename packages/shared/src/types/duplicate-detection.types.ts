/**
 * Duplicate Detection Types (PRD-02)
 *
 * Types and Zod schemas for the batch-optimized duplicate detection service.
 * Checks 3 scopes (storage, pipeline, upload) in max 3 DB queries.
 *
 * @module @bc-agent/shared/types/duplicate-detection
 */

import { z } from 'zod';

// ============================================
// Core Types
// ============================================

/** How the duplicate was matched */
export type DuplicateMatchType = 'name' | 'content' | 'name_and_content';

/** Which scope detected the duplicate */
export type DuplicateScope = 'storage' | 'pipeline' | 'upload';

/** Information about the existing file that matched */
export interface DuplicateMatchInfo {
  fileId: string;
  fileName: string;
  fileSize: number | null;
  pipelineStatus: string | null;
  folderId: string | null;
  folderName: string | null;
  folderPath: string | null;
}

// ============================================
// Request Types
// ============================================

/** Input for checking a single file */
export interface DuplicateCheckInput {
  tempId: string;
  fileName: string;
  fileSize?: number;
  contentHash?: string;
  folderId?: string;
}

/** Request body for POST /api/v2/uploads/check-duplicates */
export interface CheckDuplicatesRequest {
  files: DuplicateCheckInput[];
  /** Target folder UUID — used for name matching and suggestedName computation */
  targetFolderId?: string;
}

// ============================================
// Response Types
// ============================================

/** Action the user chose for a duplicate file */
export type DuplicateResolutionAction = 'skip' | 'replace' | 'keep';

/** Result for a single file check */
export interface DuplicateCheckResult {
  tempId: string;
  fileName: string;
  isDuplicate: boolean;
  scope?: DuplicateScope;
  matchType?: DuplicateMatchType;
  existingFile?: DuplicateMatchInfo;
  suggestedName?: string;
}

/** Summary statistics for the batch check */
export interface DuplicateCheckSummary {
  totalChecked: number;
  totalDuplicates: number;
  byScope: Record<DuplicateScope, number>;
  byMatchType: Record<DuplicateMatchType, number>;
}

/** Response body for POST /api/v2/uploads/check-duplicates */
export interface CheckDuplicatesResponse {
  results: DuplicateCheckResult[];
  summary: DuplicateCheckSummary;
  /** Destination folder path (null = root) */
  targetFolderPath: string | null;
}

// ============================================
// Zod Schemas
// ============================================

/** Validates a single file input for duplicate checking */
export const duplicateCheckInputSchema = z.object({
  tempId: z.string().min(1, 'tempId is required'),
  fileName: z.string().min(1, 'fileName is required'),
  fileSize: z.number().int().positive().optional(),
  contentHash: z
    .string()
    .length(64, 'contentHash must be 64 characters (SHA-256 hex)')
    .regex(/^[a-fA-F0-9]+$/, 'contentHash must be valid hex')
    .optional(),
  folderId: z.string().min(1).optional(),
});

/** Validates the full duplicate check request (max 1000 files) */
export const checkDuplicatesRequestSchema = z.object({
  files: z
    .array(duplicateCheckInputSchema)
    .min(1, 'At least one file is required')
    .max(1000, 'Maximum 1000 files per batch'),
  targetFolderId: z.string().min(1).toUpperCase().optional(),
});
