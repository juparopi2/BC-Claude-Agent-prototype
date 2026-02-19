/**
 * Upload Batch Types (PRD-03)
 *
 * Types for the unified batch upload orchestrator.
 * Constants, Zod schemas for request validation, and response interfaces.
 *
 * @module @bc-agent/shared/types/upload-batch
 */

import { z } from 'zod';
import type { DuplicateCheckResultV2 } from './duplicate-detection.types';

// ============================================================================
// Batch Status Constants
// ============================================================================

export const BATCH_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

export type BatchStatus = (typeof BATCH_STATUS)[keyof typeof BATCH_STATUS];

// ============================================================================
// Zod Schemas (Request Validation)
// ============================================================================

export const manifestFileItemSchema = z.object({
  tempId: z.string().min(1),
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  parentTempId: z.string().min(1).optional(),
  replaceFileId: z.string().min(1).optional(),
});

export type ManifestFileItem = z.infer<typeof manifestFileItemSchema>;

export const manifestFolderItemSchema = z.object({
  tempId: z.string().min(1),
  folderName: z.string().min(1).max(500),
  parentTempId: z.string().min(1).optional(),
});

export type ManifestFolderItem = z.infer<typeof manifestFolderItemSchema>;

export const createBatchRequestSchema = z.object({
  files: z.array(manifestFileItemSchema).min(1).max(500),
  folders: z.array(manifestFolderItemSchema).max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
  skipDuplicateCheck: z.boolean().optional(),
  targetFolderId: z.string().uuid().toUpperCase().nullable().optional(),
});

export type CreateBatchRequest = z.infer<typeof createBatchRequestSchema>;

// ============================================================================
// Response Interfaces
// ============================================================================

export interface BatchFileResult {
  tempId: string;
  fileId: string;
  sasUrl: string;
  blobPath: string;
}

export interface BatchFolderResult {
  tempId: string;
  folderId: string;
}

export interface CreateBatchResponse {
  batchId: string;
  status: BatchStatus;
  files: BatchFileResult[];
  folders: BatchFolderResult[];
  duplicates?: DuplicateCheckResultV2[];
  expiresAt: string;
}

export interface BatchProgress {
  total: number;
  confirmed: number;
  isComplete: boolean;
}

export interface ConfirmFileResponse {
  fileId: string;
  pipelineStatus: string;
  batchProgress: BatchProgress;
}

export interface BatchFileStatus {
  fileId: string;
  name: string;
  pipelineStatus: string | null;
}

export interface BatchStatusResponse {
  batchId: string;
  status: BatchStatus;
  totalFiles: number;
  confirmedCount: number;
  createdAt: string;
  expiresAt: string;
  files: BatchFileStatus[];
}

export interface CancelBatchResponse {
  batchId: string;
  status: BatchStatus;
  filesAffected: number;
}
