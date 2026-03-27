/**
 * File Health State Definition — Single Source of Truth (PRD-304)
 *
 * Defines the UNIQUE healthy state for every file type in the system.
 * All health validation (backend services, audit scripts, reconciliation)
 * should reference these definitions instead of implementing ad-hoc checks.
 *
 * File types are classified by three axes:
 * - Source: local | onedrive | sharepoint
 * - Content: text | image
 * - Kind: file | folder
 *
 * @module @bc-agent/shared/constants/file-health-state
 */

import type { FileSourceType } from './connection-status';

// ============================================================================
// TYPES
// ============================================================================

/** How many of an external resource are expected */
export type ResourceExpectation = 'one_or_more' | 'exactly_one' | 'zero' | 'none';

/**
 * Complete specification of a healthy file's expected state.
 *
 * "Healthy" means: the file has passed through the entire processing pipeline
 * and all cross-system resources (DB, Blob, AI Search) are consistent.
 */
export interface HealthyFileExpectation {
  /** Human-readable label for logging/diagnostics */
  readonly label: string;

  // ── Classification ──────────────────────────────────────────────
  readonly sourceType: FileSourceType | 'any';
  readonly isImage: boolean;
  readonly isFolder: boolean;

  // ── DB column expectations (when pipeline_status = 'ready') ────
  /** Local files MUST have a blob_path; cloud files MUST NOT */
  readonly expectBlobPath: boolean;
  /** Cloud files MUST have external_id; local files MUST NOT */
  readonly expectExternalId: boolean;
  /** Cloud files MUST have external_drive_id */
  readonly expectExternalDriveId: boolean;
  /** Cloud files MUST have connection_id + connection_scope_id */
  readonly expectConnectionId: boolean;
  /** Text files have real extracted_text; images have placeholder; folders have null */
  readonly expectExtractedText: 'required' | 'placeholder' | 'none';
  /** Pipeline status must be 'ready' when healthy */
  readonly expectedPipelineStatus: 'ready';
  /** deletion_status must be null */
  readonly expectedDeletionStatus: null;

  // ── External resource expectations ─────────────────────────────
  /** Azure Blob Storage: local files must exist, cloud files must not */
  readonly expectBlobExists: boolean;
  /** file_chunks table: text files have 1+, images have 0, folders have none */
  readonly expectChunks: ResourceExpectation;
  /** image_embeddings table: images have exactly 1, others have none */
  readonly expectImageEmbedding: boolean;
  /** AI Search index: text files have 1+ docs, images have 1 doc, folders have none */
  readonly expectSearchDocs: ResourceExpectation;
}

/**
 * A violation found when validating a file against its expected healthy state.
 */
export interface FileHealthViolation {
  /** Machine-readable violation code */
  readonly code: string;
  /** Human-readable description */
  readonly message: string;
  /** Severity: error = broken, warning = degraded, info = cosmetic */
  readonly severity: 'error' | 'warning' | 'info';
  /** The expected value */
  readonly expected: unknown;
  /** The actual value found */
  readonly actual: unknown;
}

// ============================================================================
// HEALTHY STATE DEFINITIONS
// ============================================================================

/**
 * The complete matrix of expected healthy states per file type.
 *
 * Key format: `{sourceType}:{contentType}` or `folder` for folders.
 * Cloud folders use `folder:cloud` to differentiate from local folders.
 */
export const HEALTHY_FILE_STATES = {
  // ── Local files ─────────────────────────────────────────────────
  'local:text': {
    label: 'Local text file',
    sourceType: 'local',
    isImage: false,
    isFolder: false,
    expectBlobPath: true,
    expectExternalId: false,
    expectExternalDriveId: false,
    expectConnectionId: false,
    expectExtractedText: 'required',
    expectedPipelineStatus: 'ready',
    expectedDeletionStatus: null,
    expectBlobExists: true,
    expectChunks: 'one_or_more',
    expectImageEmbedding: false,
    expectSearchDocs: 'one_or_more',
  },
  'local:image': {
    label: 'Local image file',
    sourceType: 'local',
    isImage: true,
    isFolder: false,
    expectBlobPath: true,
    expectExternalId: false,
    expectExternalDriveId: false,
    expectConnectionId: false,
    expectExtractedText: 'placeholder',
    expectedPipelineStatus: 'ready',
    expectedDeletionStatus: null,
    expectBlobExists: true,
    expectChunks: 'zero',
    expectImageEmbedding: true,
    expectSearchDocs: 'exactly_one',
  },

  // ── OneDrive files ──────────────────────────────────────────────
  'onedrive:text': {
    label: 'OneDrive text file',
    sourceType: 'onedrive',
    isImage: false,
    isFolder: false,
    expectBlobPath: false,
    expectExternalId: true,
    expectExternalDriveId: true,
    expectConnectionId: true,
    expectExtractedText: 'required',
    expectedPipelineStatus: 'ready',
    expectedDeletionStatus: null,
    expectBlobExists: false,
    expectChunks: 'one_or_more',
    expectImageEmbedding: false,
    expectSearchDocs: 'one_or_more',
  },
  'onedrive:image': {
    label: 'OneDrive image file',
    sourceType: 'onedrive',
    isImage: true,
    isFolder: false,
    expectBlobPath: false,
    expectExternalId: true,
    expectExternalDriveId: true,
    expectConnectionId: true,
    expectExtractedText: 'placeholder',
    expectedPipelineStatus: 'ready',
    expectedDeletionStatus: null,
    expectBlobExists: false,
    expectChunks: 'zero',
    expectImageEmbedding: true,
    expectSearchDocs: 'exactly_one',
  },

  // ── SharePoint files ────────────────────────────────────────────
  'sharepoint:text': {
    label: 'SharePoint text file',
    sourceType: 'sharepoint',
    isImage: false,
    isFolder: false,
    expectBlobPath: false,
    expectExternalId: true,
    expectExternalDriveId: true,
    expectConnectionId: true,
    expectExtractedText: 'required',
    expectedPipelineStatus: 'ready',
    expectedDeletionStatus: null,
    expectBlobExists: false,
    expectChunks: 'one_or_more',
    expectImageEmbedding: false,
    expectSearchDocs: 'one_or_more',
  },
  'sharepoint:image': {
    label: 'SharePoint image file',
    sourceType: 'sharepoint',
    isImage: true,
    isFolder: false,
    expectBlobPath: false,
    expectExternalId: true,
    expectExternalDriveId: true,
    expectConnectionId: true,
    expectExtractedText: 'placeholder',
    expectedPipelineStatus: 'ready',
    expectedDeletionStatus: null,
    expectBlobExists: false,
    expectChunks: 'zero',
    expectImageEmbedding: true,
    expectSearchDocs: 'exactly_one',
  },

  // ── Folders (all source types) ──────────────────────────────────
  'folder': {
    label: 'Folder (any source)',
    sourceType: 'any',
    isImage: false,
    isFolder: true,
    expectBlobPath: false,
    expectExternalId: false,
    expectExternalDriveId: false,
    expectConnectionId: false,
    expectExtractedText: 'none',
    expectedPipelineStatus: 'ready',
    expectedDeletionStatus: null,
    expectBlobExists: false,
    expectChunks: 'none',
    expectImageEmbedding: false,
    expectSearchDocs: 'none',
  },
} as const satisfies Record<string, HealthyFileExpectation>;

/** All valid health state keys */
export type FileHealthStateKey = keyof typeof HEALTHY_FILE_STATES;

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Derive the health state key for a given file based on its properties.
 *
 * @param file - Object with sourceType, mimeType, and isFolder
 * @returns The health state key (e.g., 'local:text', 'sharepoint:image', 'folder')
 */
export function getFileHealthKey(file: {
  sourceType: string;
  mimeType: string;
  isFolder: boolean;
}): FileHealthStateKey {
  if (file.isFolder) return 'folder';
  const isImage = file.mimeType.startsWith('image/');
  const contentType = isImage ? 'image' : 'text';
  const key = `${file.sourceType}:${contentType}` as FileHealthStateKey;
  return key in HEALTHY_FILE_STATES ? key : 'local:text'; // fallback
}

/**
 * Get the expected healthy state for a file.
 *
 * @param file - Object with sourceType, mimeType, and isFolder
 * @returns The HealthyFileExpectation for this file type
 */
export function getExpectedHealthState(file: {
  sourceType: string;
  mimeType: string;
  isFolder: boolean;
}): HealthyFileExpectation {
  return HEALTHY_FILE_STATES[getFileHealthKey(file)];
}

/**
 * Validate a file against its expected healthy state.
 *
 * Returns an array of violations. Empty array = healthy.
 *
 * @param file - The file record to validate (camelCase API format)
 * @param resources - External resource counts
 * @returns Array of violations found (empty = healthy)
 */
export function validateFileHealth(
  file: {
    sourceType: string;
    mimeType: string;
    isFolder: boolean;
    blobPath: string | null;
    externalId: string | null;
    externalDriveId: string | null;
    connectionId: string | null;
    connectionScopeId: string | null;
    extractedText: string | null;
    pipelineStatus: string;
    deletionStatus: string | null;
  },
  resources: {
    blobExists: boolean;
    chunkCount: number;
    hasImageEmbedding: boolean;
    searchDocCount: number;
  },
): FileHealthViolation[] {
  const expect = getExpectedHealthState(file);
  const violations: FileHealthViolation[] = [];

  const add = (code: string, message: string, severity: FileHealthViolation['severity'], expected: unknown, actual: unknown) => {
    violations.push({ code, message, severity, expected, actual });
  };

  // ── Pipeline status ───────────────────────────────────────────
  if (file.pipelineStatus !== expect.expectedPipelineStatus) {
    add('pipeline_not_ready', `Expected pipeline_status='ready', got '${file.pipelineStatus}'`, 'error', 'ready', file.pipelineStatus);
  }

  // ── Deletion status ───────────────────────────────────────────
  if (file.deletionStatus !== expect.expectedDeletionStatus) {
    add('soft_deleted', `File is soft-deleted (deletion_status='${file.deletionStatus}')`, 'error', null, file.deletionStatus);
  }

  // ── Blob path ─────────────────────────────────────────────────
  if (expect.expectBlobPath && !file.blobPath) {
    add('missing_blob_path', 'Local file missing blob_path', 'error', 'non-null', null);
  }
  if (!expect.expectBlobPath && file.blobPath && !file.isFolder) {
    add('unexpected_blob_path', 'Cloud file should not have blob_path', 'warning', null, file.blobPath);
  }

  // ── External references ───────────────────────────────────────
  if (expect.expectExternalId && !file.externalId) {
    add('missing_external_id', 'Cloud file missing external_id', 'error', 'non-null', null);
  }
  if (expect.expectExternalDriveId && !file.externalDriveId) {
    add('missing_external_drive_id', 'Cloud file missing external_drive_id', 'error', 'non-null', null);
  }
  if (expect.expectConnectionId && !file.connectionId) {
    add('missing_connection_id', 'Cloud file missing connection_id', 'error', 'non-null', null);
  }
  if (expect.expectConnectionId && !file.connectionScopeId) {
    add('missing_connection_scope_id', 'Cloud file missing connection_scope_id', 'warning', 'non-null', null);
  }

  // ── Extracted text ────────────────────────────────────────────
  if (expect.expectExtractedText === 'required' && !file.extractedText) {
    add('missing_extracted_text', 'Text file missing extracted_text', 'warning', 'non-null', null);
  }

  // ── Blob exists (physical storage) ────────────────────────────
  if (expect.expectBlobExists && !resources.blobExists) {
    add('blob_not_found', 'Local file blob not found in Azure Storage', 'error', true, false);
  }

  // ── Chunks ────────────────────────────────────────────────────
  if (expect.expectChunks === 'one_or_more' && resources.chunkCount === 0) {
    add('no_chunks', 'Text file has 0 chunks in file_chunks table', 'error', '>=1', 0);
  }

  // ── Image embeddings ──────────────────────────────────────────
  if (expect.expectImageEmbedding && !resources.hasImageEmbedding) {
    add('missing_image_embedding', 'Image file missing image_embeddings record', 'error', true, false);
  }

  // ── Search index ──────────────────────────────────────────────
  if (expect.expectSearchDocs === 'one_or_more' && resources.searchDocCount === 0) {
    add('not_in_search_index', 'File has 0 documents in AI Search', 'error', '>=1', 0);
  }
  if (expect.expectSearchDocs === 'exactly_one' && resources.searchDocCount === 0) {
    add('not_in_search_index', 'Image file has 0 documents in AI Search', 'error', 1, 0);
  }

  return violations;
}

/**
 * Check if a resource expectation is satisfied by a count.
 */
export function isResourceExpectationMet(expectation: ResourceExpectation, count: number): boolean {
  switch (expectation) {
    case 'one_or_more': return count >= 1;
    case 'exactly_one': return count === 1;
    case 'zero': return count === 0;
    case 'none': return true; // 'none' means we don't check (folders)
  }
}
