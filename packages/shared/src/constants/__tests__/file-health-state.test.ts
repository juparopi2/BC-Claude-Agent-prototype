/**
 * File Health State Matrix Verification Tests (PRD-304)
 *
 * Validates that:
 *   1. HEALTHY_FILE_STATES matrix is internally consistent
 *   2. getExpectedHealthState() returns the correct expectation per file type
 *   3. validateFileHealth() correctly identifies healthy and unhealthy states
 *   4. Text files expect chunks and search docs; images expect embeddings, not chunks
 *   5. Folders expect no chunks, no image embeddings, no search docs
 *   6. Cloud files expect no blob_path; local files expect blob_path
 *   7. isResourceExpectationMet() correctly evaluates each expectation type
 *
 * @module @bc-agent/shared/constants/__tests__/file-health-state
 */

import { describe, it, expect } from 'vitest';
import {
  HEALTHY_FILE_STATES,
  getFileHealthKey,
  getExpectedHealthState,
  validateFileHealth,
  isResourceExpectationMet,
  type FileHealthStateKey,
} from '../file-health-state';

// ============================================================================
// Helpers — canonical file + resources for each type
// ============================================================================

function makeLocalTextFile(overrides?: Record<string, unknown>) {
  return {
    sourceType: 'local',
    mimeType: 'text/plain',
    isFolder: false,
    blobPath: '/blob/storage/path',
    externalId: null,
    externalDriveId: null,
    connectionId: null,
    connectionScopeId: null,
    extractedText: 'some extracted text',
    pipelineStatus: 'ready',
    deletionStatus: null,
    ...overrides,
  };
}

function makeLocalImageFile(overrides?: Record<string, unknown>) {
  return {
    sourceType: 'local',
    mimeType: 'image/png',
    isFolder: false,
    blobPath: '/blob/storage/image',
    externalId: null,
    externalDriveId: null,
    connectionId: null,
    connectionScopeId: null,
    extractedText: '[image]',
    pipelineStatus: 'ready',
    deletionStatus: null,
    ...overrides,
  };
}

function makeCloudTextFile(sourceType: 'onedrive' | 'sharepoint', overrides?: Record<string, unknown>) {
  return {
    sourceType,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    isFolder: false,
    blobPath: null,
    externalId: 'EXT-ID-001',
    externalDriveId: 'DRIVE-001',
    connectionId: 'CONN-001',
    connectionScopeId: 'SCOPE-001',
    extractedText: 'some extracted text',
    pipelineStatus: 'ready',
    deletionStatus: null,
    ...overrides,
  };
}

function makeCloudImageFile(sourceType: 'onedrive' | 'sharepoint', overrides?: Record<string, unknown>) {
  return {
    sourceType,
    mimeType: 'image/jpeg',
    isFolder: false,
    blobPath: null,
    externalId: 'EXT-ID-IMG-001',
    externalDriveId: 'DRIVE-001',
    connectionId: 'CONN-001',
    connectionScopeId: 'SCOPE-001',
    extractedText: '[image]',
    pipelineStatus: 'ready',
    deletionStatus: null,
    ...overrides,
  };
}

function makeFolder(overrides?: Record<string, unknown>) {
  return {
    sourceType: 'local',
    mimeType: 'inode/directory',
    isFolder: true,
    blobPath: null,
    externalId: null,
    externalDriveId: null,
    connectionId: null,
    connectionScopeId: null,
    extractedText: null,
    pipelineStatus: 'ready',
    deletionStatus: null,
    ...overrides,
  };
}

/** Healthy resources for a text file */
const healthyTextResources = {
  blobExists: true,
  chunkCount: 3,
  hasImageEmbedding: false,
  searchDocCount: 3,
};

/** Healthy resources for a cloud text file (no blob) */
const healthyCloudTextResources = {
  blobExists: false,
  chunkCount: 3,
  hasImageEmbedding: false,
  searchDocCount: 3,
};

/** Healthy resources for a local image file */
const healthyLocalImageResources = {
  blobExists: true,
  chunkCount: 0,
  hasImageEmbedding: true,
  searchDocCount: 1,
};

/** Healthy resources for a cloud image file */
const healthyCloudImageResources = {
  blobExists: false,
  chunkCount: 0,
  hasImageEmbedding: true,
  searchDocCount: 1,
};

/** Healthy resources for a folder */
const healthyFolderResources = {
  blobExists: false,
  chunkCount: 0,
  hasImageEmbedding: false,
  searchDocCount: 0,
};

// ============================================================================
// HEALTHY_FILE_STATES matrix structure
// ============================================================================

describe('HEALTHY_FILE_STATES matrix', () => {
  const ALL_KEYS: FileHealthStateKey[] = [
    'local:text',
    'local:image',
    'onedrive:text',
    'onedrive:image',
    'sharepoint:text',
    'sharepoint:image',
    'folder',
  ];

  it('defines all expected file type keys', () => {
    for (const key of ALL_KEYS) {
      expect(HEALTHY_FILE_STATES).toHaveProperty(key);
    }
  });

  it('all entries have expectedPipelineStatus = ready', () => {
    for (const [key, state] of Object.entries(HEALTHY_FILE_STATES)) {
      expect(state.expectedPipelineStatus).toBe('ready');
    }
  });

  it('all entries have expectedDeletionStatus = null', () => {
    for (const [, state] of Object.entries(HEALTHY_FILE_STATES)) {
      expect(state.expectedDeletionStatus).toBeNull();
    }
  });

  // Text files should expect chunks and search docs
  it('text file types expect one_or_more chunks', () => {
    const textKeys: FileHealthStateKey[] = ['local:text', 'onedrive:text', 'sharepoint:text'];
    for (const key of textKeys) {
      expect(HEALTHY_FILE_STATES[key].expectChunks).toBe('one_or_more');
    }
  });

  it('text file types expect search docs', () => {
    const textKeys: FileHealthStateKey[] = ['local:text', 'onedrive:text', 'sharepoint:text'];
    for (const key of textKeys) {
      expect(HEALTHY_FILE_STATES[key].expectSearchDocs).toBe('one_or_more');
    }
  });

  it('text file types do NOT expect image embeddings', () => {
    const textKeys: FileHealthStateKey[] = ['local:text', 'onedrive:text', 'sharepoint:text'];
    for (const key of textKeys) {
      expect(HEALTHY_FILE_STATES[key].expectImageEmbedding).toBe(false);
    }
  });

  // Image files should expect embeddings but not chunks
  it('image file types expect zero chunks', () => {
    const imageKeys: FileHealthStateKey[] = ['local:image', 'onedrive:image', 'sharepoint:image'];
    for (const key of imageKeys) {
      expect(HEALTHY_FILE_STATES[key].expectChunks).toBe('zero');
    }
  });

  it('image file types expect image embeddings', () => {
    const imageKeys: FileHealthStateKey[] = ['local:image', 'onedrive:image', 'sharepoint:image'];
    for (const key of imageKeys) {
      expect(HEALTHY_FILE_STATES[key].expectImageEmbedding).toBe(true);
    }
  });

  it('image file types expect exactly one search doc', () => {
    const imageKeys: FileHealthStateKey[] = ['local:image', 'onedrive:image', 'sharepoint:image'];
    for (const key of imageKeys) {
      expect(HEALTHY_FILE_STATES[key].expectSearchDocs).toBe('exactly_one');
    }
  });

  // Local files require blob_path; cloud files must not have it
  it('local files expect blob_path', () => {
    expect(HEALTHY_FILE_STATES['local:text'].expectBlobPath).toBe(true);
    expect(HEALTHY_FILE_STATES['local:image'].expectBlobPath).toBe(true);
  });

  it('cloud files do NOT expect blob_path', () => {
    const cloudKeys: FileHealthStateKey[] = ['onedrive:text', 'onedrive:image', 'sharepoint:text', 'sharepoint:image'];
    for (const key of cloudKeys) {
      expect(HEALTHY_FILE_STATES[key].expectBlobPath).toBe(false);
    }
  });

  // Folders should have no resources
  it('folders expect no chunks (none)', () => {
    expect(HEALTHY_FILE_STATES['folder'].expectChunks).toBe('none');
  });

  it('folders do NOT expect image embeddings', () => {
    expect(HEALTHY_FILE_STATES['folder'].expectImageEmbedding).toBe(false);
  });

  it('folders expect no search docs (none)', () => {
    expect(HEALTHY_FILE_STATES['folder'].expectSearchDocs).toBe('none');
  });

  it('folders do NOT expect blob_path', () => {
    expect(HEALTHY_FILE_STATES['folder'].expectBlobPath).toBe(false);
  });

  // Cloud files need external references; local files do not
  it('cloud files expect external_id', () => {
    const cloudKeys: FileHealthStateKey[] = ['onedrive:text', 'onedrive:image', 'sharepoint:text', 'sharepoint:image'];
    for (const key of cloudKeys) {
      expect(HEALTHY_FILE_STATES[key].expectExternalId).toBe(true);
    }
  });

  it('local files do NOT expect external_id', () => {
    expect(HEALTHY_FILE_STATES['local:text'].expectExternalId).toBe(false);
    expect(HEALTHY_FILE_STATES['local:image'].expectExternalId).toBe(false);
  });
});

// ============================================================================
// getExpectedHealthState() key derivation
// ============================================================================

describe('getFileHealthKey()', () => {
  it('returns local:text for local non-image file', () => {
    expect(getFileHealthKey({ sourceType: 'local', mimeType: 'text/plain', isFolder: false })).toBe('local:text');
  });

  it('returns local:image for local image file', () => {
    expect(getFileHealthKey({ sourceType: 'local', mimeType: 'image/png', isFolder: false })).toBe('local:image');
  });

  it('returns onedrive:text for OneDrive Word document', () => {
    expect(getFileHealthKey({ sourceType: 'onedrive', mimeType: 'application/msword', isFolder: false })).toBe('onedrive:text');
  });

  it('returns onedrive:image for OneDrive image file', () => {
    expect(getFileHealthKey({ sourceType: 'onedrive', mimeType: 'image/jpeg', isFolder: false })).toBe('onedrive:image');
  });

  it('returns sharepoint:text for SharePoint text file', () => {
    expect(getFileHealthKey({ sourceType: 'sharepoint', mimeType: 'application/pdf', isFolder: false })).toBe('sharepoint:text');
  });

  it('returns sharepoint:image for SharePoint image file', () => {
    expect(getFileHealthKey({ sourceType: 'sharepoint', mimeType: 'image/gif', isFolder: false })).toBe('sharepoint:image');
  });

  it('returns folder for any isFolder=true file (regardless of sourceType)', () => {
    expect(getFileHealthKey({ sourceType: 'local', mimeType: 'inode/directory', isFolder: true })).toBe('folder');
    expect(getFileHealthKey({ sourceType: 'onedrive', mimeType: 'inode/directory', isFolder: true })).toBe('folder');
    expect(getFileHealthKey({ sourceType: 'sharepoint', mimeType: 'inode/directory', isFolder: true })).toBe('folder');
  });
});

// ============================================================================
// validateFileHealth() — healthy cases (expect zero violations)
// ============================================================================

describe('validateFileHealth() — healthy states produce zero violations', () => {
  it('local text file in healthy state has no violations', () => {
    const violations = validateFileHealth(makeLocalTextFile(), healthyTextResources);
    expect(violations).toHaveLength(0);
  });

  it('local image file in healthy state has no violations', () => {
    const violations = validateFileHealth(makeLocalImageFile(), healthyLocalImageResources);
    expect(violations).toHaveLength(0);
  });

  it('OneDrive text file in healthy state has no violations', () => {
    const violations = validateFileHealth(makeCloudTextFile('onedrive'), healthyCloudTextResources);
    expect(violations).toHaveLength(0);
  });

  it('OneDrive image file in healthy state has no violations', () => {
    const violations = validateFileHealth(makeCloudImageFile('onedrive'), healthyCloudImageResources);
    expect(violations).toHaveLength(0);
  });

  it('SharePoint text file in healthy state has no violations', () => {
    const violations = validateFileHealth(makeCloudTextFile('sharepoint'), healthyCloudTextResources);
    expect(violations).toHaveLength(0);
  });

  it('SharePoint image file in healthy state has no violations', () => {
    const violations = validateFileHealth(makeCloudImageFile('sharepoint'), healthyCloudImageResources);
    expect(violations).toHaveLength(0);
  });

  it('folder in healthy state has no violations', () => {
    const violations = validateFileHealth(makeFolder(), healthyFolderResources);
    expect(violations).toHaveLength(0);
  });
});

// ============================================================================
// validateFileHealth() — unhealthy cases (expect specific violations)
// ============================================================================

describe('validateFileHealth() — violation detection', () => {
  it('reports pipeline_not_ready when pipelineStatus is not ready', () => {
    const file = makeLocalTextFile({ pipelineStatus: 'failed' });
    const violations = validateFileHealth(file, healthyTextResources);

    expect(violations.some((v) => v.code === 'pipeline_not_ready')).toBe(true);
  });

  it('reports soft_deleted when deletionStatus is non-null', () => {
    const file = makeLocalTextFile({ deletionStatus: 'pending' });
    const violations = validateFileHealth(file, healthyTextResources);

    expect(violations.some((v) => v.code === 'soft_deleted')).toBe(true);
  });

  it('reports missing_blob_path when local file has no blobPath', () => {
    const file = makeLocalTextFile({ blobPath: null });
    const violations = validateFileHealth(file, { ...healthyTextResources, blobExists: false });

    expect(violations.some((v) => v.code === 'missing_blob_path')).toBe(true);
  });

  it('reports no_chunks when text file has zero chunks', () => {
    const file = makeLocalTextFile();
    const violations = validateFileHealth(file, { ...healthyTextResources, chunkCount: 0 });

    expect(violations.some((v) => v.code === 'no_chunks')).toBe(true);
  });

  it('reports missing_image_embedding when image file has no embedding', () => {
    const file = makeLocalImageFile();
    const violations = validateFileHealth(file, { ...healthyLocalImageResources, hasImageEmbedding: false });

    expect(violations.some((v) => v.code === 'missing_image_embedding')).toBe(true);
  });

  it('reports not_in_search_index when text file has no search docs', () => {
    const file = makeLocalTextFile();
    const violations = validateFileHealth(file, { ...healthyTextResources, searchDocCount: 0 });

    expect(violations.some((v) => v.code === 'not_in_search_index')).toBe(true);
  });

  it('reports missing_external_id when cloud file has no externalId', () => {
    const file = makeCloudTextFile('onedrive', { externalId: null });
    const violations = validateFileHealth(file, healthyCloudTextResources);

    expect(violations.some((v) => v.code === 'missing_external_id')).toBe(true);
  });

  it('reports blob_not_found when local file blob does not exist in storage', () => {
    const file = makeLocalTextFile();
    const violations = validateFileHealth(file, { ...healthyTextResources, blobExists: false });

    expect(violations.some((v) => v.code === 'blob_not_found')).toBe(true);
  });
});

// ============================================================================
// isResourceExpectationMet()
// ============================================================================

describe('isResourceExpectationMet()', () => {
  it('one_or_more is met by count >= 1', () => {
    expect(isResourceExpectationMet('one_or_more', 1)).toBe(true);
    expect(isResourceExpectationMet('one_or_more', 5)).toBe(true);
  });

  it('one_or_more is NOT met by count = 0', () => {
    expect(isResourceExpectationMet('one_or_more', 0)).toBe(false);
  });

  it('exactly_one is met by count = 1', () => {
    expect(isResourceExpectationMet('exactly_one', 1)).toBe(true);
  });

  it('exactly_one is NOT met by count = 0 or count = 2', () => {
    expect(isResourceExpectationMet('exactly_one', 0)).toBe(false);
    expect(isResourceExpectationMet('exactly_one', 2)).toBe(false);
  });

  it('zero is met by count = 0', () => {
    expect(isResourceExpectationMet('zero', 0)).toBe(true);
  });

  it('zero is NOT met by count >= 1', () => {
    expect(isResourceExpectationMet('zero', 1)).toBe(false);
  });

  it('none is always met regardless of count', () => {
    expect(isResourceExpectationMet('none', 0)).toBe(true);
    expect(isResourceExpectationMet('none', 999)).toBe(true);
  });
});
