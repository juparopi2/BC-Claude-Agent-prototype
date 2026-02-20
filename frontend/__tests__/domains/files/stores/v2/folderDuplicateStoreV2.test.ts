/**
 * folderDuplicateStoreV2 Unit Tests
 *
 * Validates folder duplicate state management: result loading, resolution
 * lifecycle, getter utilities, cancel, and reset.
 *
 * @module __tests__/domains/files/stores/v2/folderDuplicateStoreV2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useFolderDuplicateStoreV2,
  resetFolderDuplicateStoreV2,
} from '@/src/domains/files/stores/v2/folderDuplicateStoreV2';
import type { FolderDuplicateCheckResult } from '@bc-agent/shared';

// Helper to build a minimal FolderDuplicateCheckResult for tests
function makeResult(
  overrides: Partial<FolderDuplicateCheckResult> & { tempId: string },
): FolderDuplicateCheckResult {
  return {
    folderName: 'TestFolder',
    isDuplicate: false,
    parentFolderId: null,
    ...overrides,
  };
}

describe('folderDuplicateStoreV2', () => {
  beforeEach(() => {
    resetFolderDuplicateStoreV2();
  });

  // ============================================================
  // setResults
  // ============================================================

  describe('setResults', () => {
    it('should open modal when duplicates exist', () => {
      const results = [
        makeResult({
          tempId: 'a',
          folderName: 'Docs',
          isDuplicate: true,
          existingFolderId: 'F1',
          suggestedName: 'Docs (1)',
        }),
        makeResult({ tempId: 'b', folderName: 'New', isDuplicate: false }),
      ];

      useFolderDuplicateStoreV2.getState().setResults(results, 'Root / Projects');

      const state = useFolderDuplicateStoreV2.getState();
      expect(state.isModalOpen).toBe(true);
      expect(state.results).toHaveLength(2);
      expect(state.targetFolderPath).toBe('Root / Projects');
      expect(state.resolutions.size).toBe(0);
    });

    it('should not open modal when no duplicates exist', () => {
      const results = [makeResult({ tempId: 'a', isDuplicate: false })];
      useFolderDuplicateStoreV2.getState().setResults(results);

      expect(useFolderDuplicateStoreV2.getState().isModalOpen).toBe(false);
    });

    it('should reset resolutions and isCancelled on each call', () => {
      // Pre-populate some state
      useFolderDuplicateStoreV2.getState().setResults([
        makeResult({ tempId: 'old', isDuplicate: true, suggestedName: 'Old (1)' }),
      ]);
      useFolderDuplicateStoreV2.getState().resolveOne({
        tempId: 'old',
        action: 'skip',
        resolvedName: 'Old',
      });

      // Call setResults again with new data
      const newResults = [makeResult({ tempId: 'new', isDuplicate: false })];
      useFolderDuplicateStoreV2.getState().setResults(newResults);

      const state = useFolderDuplicateStoreV2.getState();
      expect(state.resolutions.size).toBe(0);
      expect(state.isCancelled).toBe(false);
      expect(state.results).toHaveLength(1);
      expect(state.results[0]?.tempId).toBe('new');
    });

    it('should store targetFolderPath as null when not provided', () => {
      useFolderDuplicateStoreV2.getState().setResults([
        makeResult({ tempId: 'a', isDuplicate: false }),
      ]);

      expect(useFolderDuplicateStoreV2.getState().targetFolderPath).toBeNull();
    });
  });

  // ============================================================
  // resolveOne
  // ============================================================

  describe('resolveOne', () => {
    it('should resolve a single duplicate with skip and close modal', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'F1', suggestedName: 'Docs (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveOne({
        tempId: 'a',
        action: 'skip',
        resolvedName: 'Docs',
      });

      const state = useFolderDuplicateStoreV2.getState();
      expect(state.resolutions.size).toBe(1);
      expect(state.resolutions.get('a')).toEqual({
        tempId: 'a',
        action: 'skip',
        resolvedName: 'Docs',
      });
      expect(state.isModalOpen).toBe(false);
    });

    it('should keep modal open while unresolved duplicates remain', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'F1', suggestedName: 'A (1)' }),
        makeResult({ tempId: 'b', isDuplicate: true, existingFolderId: 'F2', suggestedName: 'B (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveOne({
        tempId: 'a',
        action: 'replace',
        resolvedName: 'A',
        existingFolderId: 'F1',
      });

      expect(useFolderDuplicateStoreV2.getState().isModalOpen).toBe(true);
    });

    it('should close modal when last duplicate is resolved', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'F1', suggestedName: 'A (1)' }),
        makeResult({ tempId: 'b', isDuplicate: true, existingFolderId: 'F2', suggestedName: 'B (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'b', action: 'skip', resolvedName: 'B' });

      expect(useFolderDuplicateStoreV2.getState().isModalOpen).toBe(false);
    });

    it('should record existingFolderId on replace resolution', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'EXISTING-1', suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveOne({
        tempId: 'a',
        action: 'replace',
        resolvedName: 'A',
        existingFolderId: 'EXISTING-1',
      });

      const res = useFolderDuplicateStoreV2.getState().resolutions.get('a');
      expect(res?.existingFolderId).toBe('EXISTING-1');
    });
  });

  // ============================================================
  // resolveAllRemaining
  // ============================================================

  describe('resolveAllRemaining', () => {
    it('should resolve all unresolved duplicates with the same action', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'F1', suggestedName: 'A (1)' }),
        makeResult({ tempId: 'b', isDuplicate: true, existingFolderId: 'F2', suggestedName: 'B (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveAllRemaining('keep_both');

      const state = useFolderDuplicateStoreV2.getState();
      expect(state.resolutions.size).toBe(2);
      expect(state.isModalOpen).toBe(false);
      expect(state.resolutions.get('a')?.action).toBe('keep_both');
      expect(state.resolutions.get('b')?.action).toBe('keep_both');
    });

    it('should not overwrite already resolved duplicates', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'F1', suggestedName: 'A (1)' }),
        makeResult({ tempId: 'b', isDuplicate: true, existingFolderId: 'F2', suggestedName: 'B (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      // Resolve 'a' with skip first
      useFolderDuplicateStoreV2.getState().resolveOne({
        tempId: 'a',
        action: 'skip',
        resolvedName: 'A',
      });

      // Resolve remaining with replace
      useFolderDuplicateStoreV2.getState().resolveAllRemaining('replace');

      const res = useFolderDuplicateStoreV2.getState().resolutions;
      expect(res.get('a')?.action).toBe('skip'); // Not overwritten
      expect(res.get('b')?.action).toBe('replace');
    });

    it('should use suggestedName as resolvedName for keep_both', () => {
      const results = [
        makeResult({
          tempId: 'a',
          folderName: 'Docs',
          isDuplicate: true,
          suggestedName: 'Docs (1)',
        }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveAllRemaining('keep_both');

      const res = useFolderDuplicateStoreV2.getState().resolutions.get('a');
      expect(res?.resolvedName).toBe('Docs (1)');
    });

    it('should use folderName as resolvedName for skip when no suggestedName', () => {
      const results = [
        makeResult({
          tempId: 'a',
          folderName: 'Docs',
          isDuplicate: true,
          // no suggestedName
        }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveAllRemaining('skip');

      const res = useFolderDuplicateStoreV2.getState().resolutions.get('a');
      expect(res?.resolvedName).toBe('Docs');
    });

    it('should include existingFolderId for replace action when available', () => {
      const results = [
        makeResult({
          tempId: 'a',
          folderName: 'Docs',
          isDuplicate: true,
          existingFolderId: 'FOLD-REPLACE',
          suggestedName: 'Docs (1)',
        }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveAllRemaining('replace');

      const res = useFolderDuplicateStoreV2.getState().resolutions.get('a');
      expect(res?.existingFolderId).toBe('FOLD-REPLACE');
    });

    it('should close modal even when there are no unresolved duplicates', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'F1', suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      // Resolve all manually first
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });
      // Call again with no remaining unresolved
      useFolderDuplicateStoreV2.getState().resolveAllRemaining('replace');

      expect(useFolderDuplicateStoreV2.getState().isModalOpen).toBe(false);
    });
  });

  // ============================================================
  // isAllResolved
  // ============================================================

  describe('isAllResolved', () => {
    it('should return true when all duplicates are resolved', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });

      expect(useFolderDuplicateStoreV2.getState().isAllResolved()).toBe(true);
    });

    it('should return false when some duplicates are still unresolved', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
        makeResult({ tempId: 'b', isDuplicate: true, suggestedName: 'B (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });

      expect(useFolderDuplicateStoreV2.getState().isAllResolved()).toBe(false);
    });

    it('should return true when cancelled', () => {
      const results = [makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' })];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().cancel();

      expect(useFolderDuplicateStoreV2.getState().isAllResolved()).toBe(true);
    });

    it('should return true when no duplicates exist', () => {
      const results = [makeResult({ tempId: 'a', isDuplicate: false })];
      useFolderDuplicateStoreV2.getState().setResults(results);

      expect(useFolderDuplicateStoreV2.getState().isAllResolved()).toBe(true);
    });
  });

  // ============================================================
  // Getters
  // ============================================================

  describe('getSkippedTempIds', () => {
    it('should return only skipped tempIds', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
        makeResult({ tempId: 'b', isDuplicate: true, existingFolderId: 'F2', suggestedName: 'B (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'b', action: 'replace', resolvedName: 'B', existingFolderId: 'F2' });

      expect(useFolderDuplicateStoreV2.getState().getSkippedTempIds()).toEqual(['a']);
    });

    it('should return empty array when no skipped resolutions', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'F1', suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'replace', resolvedName: 'A', existingFolderId: 'F1' });

      expect(useFolderDuplicateStoreV2.getState().getSkippedTempIds()).toEqual([]);
    });
  });

  describe('getKeepBothRenames', () => {
    it('should return renamed map for keep_both resolutions', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'keep_both', resolvedName: 'A (1)' });

      const renames = useFolderDuplicateStoreV2.getState().getKeepBothRenames();
      expect(renames.get('a')).toBe('A (1)');
    });

    it('should return empty map when no keep_both resolutions', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });

      expect(useFolderDuplicateStoreV2.getState().getKeepBothRenames().size).toBe(0);
    });
  });

  describe('getReplaceFolderIds', () => {
    it('should return replacement map for replace resolutions', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, existingFolderId: 'EXISTING-1', suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({
        tempId: 'a',
        action: 'replace',
        resolvedName: 'A',
        existingFolderId: 'EXISTING-1',
      });

      const replaceIds = useFolderDuplicateStoreV2.getState().getReplaceFolderIds();
      expect(replaceIds.get('a')).toBe('EXISTING-1');
    });

    it('should return empty map when no replace resolutions', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });

      expect(useFolderDuplicateStoreV2.getState().getReplaceFolderIds().size).toBe(0);
    });

    it('should not include replace resolution without existingFolderId', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      // replace without existingFolderId (edge case)
      useFolderDuplicateStoreV2.getState().resolveOne({
        tempId: 'a',
        action: 'replace',
        resolvedName: 'A',
        // no existingFolderId
      });

      expect(useFolderDuplicateStoreV2.getState().getReplaceFolderIds().size).toBe(0);
    });
  });

  // ============================================================
  // cancel
  // ============================================================

  describe('cancel', () => {
    it('should close modal and set isCancelled', () => {
      const results = [makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' })];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().cancel();

      const state = useFolderDuplicateStoreV2.getState();
      expect(state.isModalOpen).toBe(false);
      expect(state.isCancelled).toBe(true);
    });

    it('isAllResolved returns true when cancelled', () => {
      const results = [makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' })];
      useFolderDuplicateStoreV2.getState().setResults(results);

      useFolderDuplicateStoreV2.getState().cancel();

      expect(useFolderDuplicateStoreV2.getState().isAllResolved()).toBe(true);
    });

    it('should preserve resolutions accumulated before cancel', () => {
      const results = [
        makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' }),
        makeResult({ tempId: 'b', isDuplicate: true, suggestedName: 'B (1)' }),
      ];
      useFolderDuplicateStoreV2.getState().setResults(results);
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });

      useFolderDuplicateStoreV2.getState().cancel();

      // 'a' resolution is preserved
      expect(useFolderDuplicateStoreV2.getState().resolutions.size).toBe(1);
    });
  });

  // ============================================================
  // reset
  // ============================================================

  describe('reset', () => {
    it('should reset to initial state', () => {
      const results = [makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' })];
      useFolderDuplicateStoreV2.getState().setResults(results, 'Root');
      useFolderDuplicateStoreV2.getState().resolveOne({ tempId: 'a', action: 'skip', resolvedName: 'A' });

      useFolderDuplicateStoreV2.getState().reset();

      const state = useFolderDuplicateStoreV2.getState();
      expect(state.results).toEqual([]);
      expect(state.resolutions.size).toBe(0);
      expect(state.isModalOpen).toBe(false);
      expect(state.isCancelled).toBe(false);
      expect(state.targetFolderPath).toBeNull();
    });

    it('resetFolderDuplicateStoreV2 utility also resets to initial state', () => {
      useFolderDuplicateStoreV2.getState().setResults(
        [makeResult({ tempId: 'a', isDuplicate: true, suggestedName: 'A (1)' })],
        'SomePath',
      );

      resetFolderDuplicateStoreV2();

      const state = useFolderDuplicateStoreV2.getState();
      expect(state.results).toEqual([]);
      expect(state.resolutions.size).toBe(0);
      expect(state.targetFolderPath).toBeNull();
    });
  });
});
