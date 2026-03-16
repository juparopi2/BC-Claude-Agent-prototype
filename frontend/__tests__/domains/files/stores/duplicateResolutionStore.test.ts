/**
 * DuplicateResolutionStore Tests (PRD-114)
 *
 * Tests for the merged store containing both file and folder duplicate stores.
 *
 * @module __tests__/domains/files/stores/duplicateResolutionStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useDuplicateStore,
  useFolderDuplicateStore,
  resetDuplicateStore,
  resetFolderDuplicateStore,
} from '../../../../src/domains/files/stores/duplicateResolutionStore';
import type { DuplicateCheckResult, FolderDuplicateCheckResult } from '@bc-agent/shared';

// ============================================================================
// Test Fixtures
// ============================================================================

const fileResult: DuplicateCheckResult = {
  tempId: 'temp-1',
  fileName: 'file.txt',
  isDuplicate: true,
  suggestedName: 'file (1).txt',
  existingFile: {
    fileId: 'EXISTING-1',
    fileName: 'file.txt',
    fileSize: 512,
    pipelineStatus: null,
    folderId: null,
    folderName: null,
    folderPath: null,
  },
  matchType: 'name',
  scope: 'storage',
};

const folderResult: FolderDuplicateCheckResult = {
  tempId: 'folder-1',
  folderName: 'Documents',
  isDuplicate: true,
  suggestedName: 'Documents (1)',
  existingFolderId: 'FOLDER-EXISTING-1',
  parentFolderId: null,
};

// ============================================================================
// Helpers
// ============================================================================

function getFileStore() {
  return useDuplicateStore.getState();
}

function getFolderStore() {
  return useFolderDuplicateStore.getState();
}

// ============================================================================
// Tests
// ============================================================================

describe('File Duplicate Store (useDuplicateStore)', () => {
  beforeEach(() => {
    resetDuplicateStore();
  });

  // --------------------------------------------------------------------------
  // setResults
  // --------------------------------------------------------------------------

  describe('setResults', () => {
    it('should open modal when duplicates exist', () => {
      getFileStore().setResults([fileResult]);

      const state = getFileStore();
      expect(state.isModalOpen).toBe(true);
      expect(state.results).toHaveLength(1);
    });

    it('should NOT open modal for non-duplicates', () => {
      const nonDuplicate: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'unique.txt',
        isDuplicate: false,
      };

      getFileStore().setResults([nonDuplicate]);

      expect(getFileStore().isModalOpen).toBe(false);
    });

    it('should reset resolutions and isCancelled on each call', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'skip');

      getFileStore().setResults([fileResult]);

      const state = getFileStore();
      expect(state.resolutions.size).toBe(0);
      expect(state.isCancelled).toBe(false);
    });

    it('should store the targetFolderPath when provided', () => {
      getFileStore().setResults([fileResult], 'Root / Projects');

      expect(getFileStore().targetFolderPath).toBe('Root / Projects');
    });

    it('should set targetFolderPath to null when not provided', () => {
      getFileStore().setResults([fileResult]);

      expect(getFileStore().targetFolderPath).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // resolveOne
  // --------------------------------------------------------------------------

  describe('resolveOne', () => {
    it('should record a resolution and close the modal when all duplicates are resolved', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'skip');

      const state = getFileStore();
      expect(state.resolutions.get('temp-1')).toBe('skip');
      expect(state.isModalOpen).toBe(false);
    });

    it('should keep the modal open while other duplicates remain unresolved', () => {
      const second: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'other.txt',
        isDuplicate: true,
        suggestedName: 'other (1).txt',
      };

      getFileStore().setResults([fileResult, second]);
      getFileStore().resolveOne('temp-1', 'skip');

      expect(getFileStore().isModalOpen).toBe(true);
    });

    it('should close the modal when the last duplicate is resolved', () => {
      const second: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'other.txt',
        isDuplicate: true,
        suggestedName: 'other (1).txt',
      };

      getFileStore().setResults([fileResult, second]);
      getFileStore().resolveOne('temp-1', 'replace');
      getFileStore().resolveOne('temp-2', 'keep');

      expect(getFileStore().isModalOpen).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // resolveAllRemaining
  // --------------------------------------------------------------------------

  describe('resolveAllRemaining', () => {
    it('should batch-resolve all unresolved duplicates with the given action', () => {
      const second: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'other.txt',
        isDuplicate: true,
        suggestedName: 'other (1).txt',
      };

      getFileStore().setResults([fileResult, second]);
      getFileStore().resolveAllRemaining('skip');

      const state = getFileStore();
      expect(state.resolutions.get('temp-1')).toBe('skip');
      expect(state.resolutions.get('temp-2')).toBe('skip');
      expect(state.isModalOpen).toBe(false);
    });

    it('should not overwrite an already-resolved entry', () => {
      const second: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'other.txt',
        isDuplicate: true,
        suggestedName: 'other (1).txt',
      };

      getFileStore().setResults([fileResult, second]);
      getFileStore().resolveOne('temp-1', 'keep');
      getFileStore().resolveAllRemaining('skip');

      expect(getFileStore().resolutions.get('temp-1')).toBe('keep');
      expect(getFileStore().resolutions.get('temp-2')).toBe('skip');
    });
  });

  // --------------------------------------------------------------------------
  // isAllResolved
  // --------------------------------------------------------------------------

  describe('isAllResolved', () => {
    it('should return true when cancelled', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().cancel();

      expect(getFileStore().isAllResolved()).toBe(true);
    });

    it('should return true when there are no duplicates', () => {
      const nonDuplicate: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'unique.txt',
        isDuplicate: false,
      };

      getFileStore().setResults([nonDuplicate]);

      expect(getFileStore().isAllResolved()).toBe(true);
    });

    it('should return false when some duplicates are still unresolved', () => {
      const second: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'other.txt',
        isDuplicate: true,
        suggestedName: 'other (1).txt',
      };

      getFileStore().setResults([fileResult, second]);
      getFileStore().resolveOne('temp-1', 'skip');

      expect(getFileStore().isAllResolved()).toBe(false);
    });

    it('should return true when all duplicates are resolved', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'replace');

      expect(getFileStore().isAllResolved()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Getter utilities
  // --------------------------------------------------------------------------

  describe('getSkippedTempIds', () => {
    it('should return only the IDs resolved as skip', () => {
      const second: DuplicateCheckResult = {
        tempId: 'temp-2',
        fileName: 'other.txt',
        isDuplicate: true,
        suggestedName: 'other (1).txt',
      };

      getFileStore().setResults([fileResult, second]);
      getFileStore().resolveOne('temp-1', 'skip');
      getFileStore().resolveOne('temp-2', 'replace');

      expect(getFileStore().getSkippedTempIds()).toEqual(['temp-1']);
    });

    it('should return an empty array when nothing was skipped', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'keep');

      expect(getFileStore().getSkippedTempIds()).toEqual([]);
    });
  });

  describe('getKeepRenames', () => {
    it('should return a map of tempId -> suggestedName for keep resolutions', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'keep');

      const renames = getFileStore().getKeepRenames();
      expect(renames.get('temp-1')).toBe('file (1).txt');
    });

    it('should return an empty map when no keep resolutions exist', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'skip');

      expect(getFileStore().getKeepRenames().size).toBe(0);
    });
  });

  describe('getReplacementTargets', () => {
    it('should return a map of tempId -> existingFile.fileId for replace resolutions', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'replace');

      const targets = getFileStore().getReplacementTargets();
      expect(targets.get('temp-1')).toBe('EXISTING-1');
    });

    it('should return an empty map when no replace resolutions exist', () => {
      getFileStore().setResults([fileResult]);
      getFileStore().resolveOne('temp-1', 'skip');

      expect(getFileStore().getReplacementTargets().size).toBe(0);
    });

    it('should not include a replace resolution that has no existingFile', () => {
      const noExisting: DuplicateCheckResult = {
        tempId: 'temp-noex',
        fileName: 'file.txt',
        isDuplicate: true,
        suggestedName: 'file (1).txt',
        // existingFile intentionally omitted
      };

      getFileStore().setResults([noExisting]);
      getFileStore().resolveOne('temp-noex', 'replace');

      expect(getFileStore().getReplacementTargets().size).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('should clear all state to initial values', () => {
      getFileStore().setResults([fileResult], 'Root');
      getFileStore().resolveOne('temp-1', 'skip');

      getFileStore().reset();

      const state = getFileStore();
      expect(state.results).toEqual([]);
      expect(state.resolutions.size).toBe(0);
      expect(state.isModalOpen).toBe(false);
      expect(state.isCancelled).toBe(false);
      expect(state.targetFolderPath).toBeNull();
    });
  });
});

// ============================================================================
// Folder Duplicate Store
// ============================================================================

describe('Folder Duplicate Store (useFolderDuplicateStore)', () => {
  beforeEach(() => {
    resetFolderDuplicateStore();
  });

  // --------------------------------------------------------------------------
  // setResults
  // --------------------------------------------------------------------------

  describe('setResults', () => {
    it('should open modal when duplicates exist', () => {
      getFolderStore().setResults([folderResult]);

      expect(getFolderStore().isModalOpen).toBe(true);
      expect(getFolderStore().results).toHaveLength(1);
    });

    it('should NOT open modal when no duplicates exist', () => {
      const nonDuplicate: FolderDuplicateCheckResult = {
        tempId: 'folder-2',
        folderName: 'NewFolder',
        isDuplicate: false,
        parentFolderId: null,
      };

      getFolderStore().setResults([nonDuplicate]);

      expect(getFolderStore().isModalOpen).toBe(false);
    });

    it('should reset resolutions and isCancelled on each call', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });

      getFolderStore().setResults([folderResult]);

      expect(getFolderStore().resolutions.size).toBe(0);
      expect(getFolderStore().isCancelled).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // resolveOne
  // --------------------------------------------------------------------------

  describe('resolveOne', () => {
    it('should record a FolderDuplicateResolution', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({
        tempId: 'folder-1',
        action: 'keep_both',
        resolvedName: 'Documents (1)',
      });

      const res = getFolderStore().resolutions.get('folder-1');
      expect(res).toBeDefined();
      expect(res?.action).toBe('keep_both');
      expect(res?.resolvedName).toBe('Documents (1)');
    });

    it('should close modal when all duplicates are resolved', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });

      expect(getFolderStore().isModalOpen).toBe(false);
    });

    it('should keep modal open while other duplicates remain unresolved', () => {
      const second: FolderDuplicateCheckResult = {
        tempId: 'folder-2',
        folderName: 'Photos',
        isDuplicate: true,
        suggestedName: 'Photos (1)',
        existingFolderId: 'FOLDER-EXISTING-2',
        parentFolderId: null,
      };

      getFolderStore().setResults([folderResult, second]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });

      expect(getFolderStore().isModalOpen).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // resolveAllRemaining
  // --------------------------------------------------------------------------

  describe('resolveAllRemaining', () => {
    it('should use suggestedName as resolvedName for keep_both', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveAllRemaining('keep_both');

      const res = getFolderStore().resolutions.get('folder-1');
      expect(res?.action).toBe('keep_both');
      expect(res?.resolvedName).toBe('Documents (1)');
    });

    it('should use folderName as resolvedName for replace', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveAllRemaining('replace');

      const res = getFolderStore().resolutions.get('folder-1');
      expect(res?.action).toBe('replace');
      expect(res?.resolvedName).toBe('Documents');
    });

    it('should include existingFolderId on replace when available', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveAllRemaining('replace');

      const res = getFolderStore().resolutions.get('folder-1');
      expect(res?.existingFolderId).toBe('FOLDER-EXISTING-1');
    });

    it('should not overwrite an already-resolved entry', () => {
      const second: FolderDuplicateCheckResult = {
        tempId: 'folder-2',
        folderName: 'Photos',
        isDuplicate: true,
        suggestedName: 'Photos (1)',
        parentFolderId: null,
      };

      getFolderStore().setResults([folderResult, second]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });
      getFolderStore().resolveAllRemaining('keep_both');

      expect(getFolderStore().resolutions.get('folder-1')?.action).toBe('skip');
      expect(getFolderStore().resolutions.get('folder-2')?.action).toBe('keep_both');
    });
  });

  // --------------------------------------------------------------------------
  // Getter utilities
  // --------------------------------------------------------------------------

  describe('getSkippedTempIds', () => {
    it('should return only the IDs resolved as skip', () => {
      const second: FolderDuplicateCheckResult = {
        tempId: 'folder-2',
        folderName: 'Photos',
        isDuplicate: true,
        suggestedName: 'Photos (1)',
        parentFolderId: null,
      };

      getFolderStore().setResults([folderResult, second]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });
      getFolderStore().resolveOne({ tempId: 'folder-2', action: 'keep_both', resolvedName: 'Photos (1)' });

      expect(getFolderStore().getSkippedTempIds()).toEqual(['folder-1']);
    });

    it('should return an empty array when nothing was skipped', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'keep_both', resolvedName: 'Documents (1)' });

      expect(getFolderStore().getSkippedTempIds()).toEqual([]);
    });
  });

  describe('getKeepBothRenames', () => {
    it('should return a map of tempId -> resolvedName for keep_both resolutions', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'keep_both', resolvedName: 'Documents (1)' });

      const renames = getFolderStore().getKeepBothRenames();
      expect(renames.get('folder-1')).toBe('Documents (1)');
    });

    it('should return an empty map when no keep_both resolutions exist', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });

      expect(getFolderStore().getKeepBothRenames().size).toBe(0);
    });
  });

  describe('getReplaceFolderIds', () => {
    it('should return a map of tempId -> existingFolderId for replace resolutions', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({
        tempId: 'folder-1',
        action: 'replace',
        resolvedName: 'Documents',
        existingFolderId: 'FOLDER-EXISTING-1',
      });

      const replaceIds = getFolderStore().getReplaceFolderIds();
      expect(replaceIds.get('folder-1')).toBe('FOLDER-EXISTING-1');
    });

    it('should return an empty map when no replace resolutions exist', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });

      expect(getFolderStore().getReplaceFolderIds().size).toBe(0);
    });

    it('should not include a replace resolution with no existingFolderId', () => {
      getFolderStore().setResults([folderResult]);
      getFolderStore().resolveOne({
        tempId: 'folder-1',
        action: 'replace',
        resolvedName: 'Documents',
        // no existingFolderId
      });

      expect(getFolderStore().getReplaceFolderIds().size).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('should clear all state to initial values', () => {
      getFolderStore().setResults([folderResult], 'Root / Projects');
      getFolderStore().resolveOne({ tempId: 'folder-1', action: 'skip', resolvedName: 'Documents' });

      getFolderStore().reset();

      const state = getFolderStore();
      expect(state.results).toEqual([]);
      expect(state.resolutions.size).toBe(0);
      expect(state.isModalOpen).toBe(false);
      expect(state.isCancelled).toBe(false);
      expect(state.targetFolderPath).toBeNull();
    });
  });
});

// ============================================================================
// Store independence
// ============================================================================

describe('Store independence', () => {
  beforeEach(() => {
    resetDuplicateStore();
    resetFolderDuplicateStore();
  });

  it('changes to the file store should not affect the folder store', () => {
    getFileStore().setResults([fileResult]);

    expect(getFolderStore().isModalOpen).toBe(false);
    expect(getFolderStore().results).toHaveLength(0);
  });

  it('changes to the folder store should not affect the file store', () => {
    getFolderStore().setResults([folderResult]);

    expect(getFileStore().isModalOpen).toBe(false);
    expect(getFileStore().results).toHaveLength(0);
  });

  it('resetting the file store should not affect folder store state', () => {
    getFileStore().setResults([fileResult]);
    getFolderStore().setResults([folderResult]);

    resetDuplicateStore();

    expect(getFileStore().results).toHaveLength(0);
    expect(getFolderStore().results).toHaveLength(1);
  });

  it('resetting the folder store should not affect file store state', () => {
    getFileStore().setResults([fileResult]);
    getFolderStore().setResults([folderResult]);

    resetFolderDuplicateStore();

    expect(getFileStore().results).toHaveLength(1);
    expect(getFolderStore().results).toHaveLength(0);
  });
});
