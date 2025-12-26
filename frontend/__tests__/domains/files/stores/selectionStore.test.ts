/**
 * selectionStore Tests
 *
 * Tests for file selection state management.
 * TDD: Tests written FIRST before implementation.
 *
 * @module __tests__/domains/files/stores/selectionStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSelectionStore,
  resetSelectionStore,
} from '@/src/domains/files/stores/selectionStore';

describe('selectionStore', () => {
  beforeEach(() => {
    resetSelectionStore();
  });

  describe('initial state', () => {
    it('should have empty selectedFileIds initially', () => {
      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.size).toBe(0);
    });

    it('should have null lastSelectedId initially', () => {
      const state = useSelectionStore.getState();
      expect(state.lastSelectedId).toBeNull();
    });
  });

  describe('selectFile (single select)', () => {
    it('should select a single file', () => {
      const { selectFile } = useSelectionStore.getState();
      selectFile('file-1');

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-1')).toBe(true);
      expect(state.selectedFileIds.size).toBe(1);
    });

    it('should replace selection when selecting without multi flag', () => {
      const { selectFile } = useSelectionStore.getState();

      selectFile('file-1');
      selectFile('file-2');

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-1')).toBe(false);
      expect(state.selectedFileIds.has('file-2')).toBe(true);
      expect(state.selectedFileIds.size).toBe(1);
    });

    it('should update lastSelectedId', () => {
      const { selectFile } = useSelectionStore.getState();
      selectFile('file-1');

      expect(useSelectionStore.getState().lastSelectedId).toBe('file-1');
    });
  });

  describe('selectFile (multi select)', () => {
    it('should add to selection when multi is true', () => {
      const { selectFile } = useSelectionStore.getState();

      selectFile('file-1');
      selectFile('file-2', true);

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-1')).toBe(true);
      expect(state.selectedFileIds.has('file-2')).toBe(true);
      expect(state.selectedFileIds.size).toBe(2);
    });

    it('should toggle off when selecting already selected file with multi', () => {
      const { selectFile } = useSelectionStore.getState();

      selectFile('file-1');
      selectFile('file-2', true);
      selectFile('file-1', true); // Toggle off

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-1')).toBe(false);
      expect(state.selectedFileIds.has('file-2')).toBe(true);
      expect(state.selectedFileIds.size).toBe(1);
    });

    it('should select multiple files', () => {
      const { selectFile } = useSelectionStore.getState();

      selectFile('file-1');
      selectFile('file-2', true);
      selectFile('file-3', true);

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.size).toBe(3);
    });
  });

  describe('selectRange', () => {
    const allFileIds = ['file-1', 'file-2', 'file-3', 'file-4', 'file-5'];

    it('should select range from last selected to clicked file', () => {
      const { selectFile, selectRange } = useSelectionStore.getState();

      selectFile('file-2'); // Select starting point
      selectRange('file-4', allFileIds); // Range to file-4

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-2')).toBe(true);
      expect(state.selectedFileIds.has('file-3')).toBe(true);
      expect(state.selectedFileIds.has('file-4')).toBe(true);
      expect(state.selectedFileIds.size).toBe(3);
    });

    it('should select range backwards', () => {
      const { selectFile, selectRange } = useSelectionStore.getState();

      selectFile('file-4'); // Select starting point
      selectRange('file-2', allFileIds); // Range to file-2 (backwards)

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-2')).toBe(true);
      expect(state.selectedFileIds.has('file-3')).toBe(true);
      expect(state.selectedFileIds.has('file-4')).toBe(true);
      expect(state.selectedFileIds.size).toBe(3);
    });

    it('should select only clicked file if no previous selection', () => {
      const { selectRange } = useSelectionStore.getState();

      selectRange('file-3', allFileIds);

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-3')).toBe(true);
      expect(state.selectedFileIds.size).toBe(1);
    });

    it('should handle file not in list gracefully', () => {
      const { selectFile, selectRange } = useSelectionStore.getState();

      selectFile('file-2');
      selectRange('file-unknown', allFileIds);

      // Should not change selection
      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-2')).toBe(true);
      expect(state.selectedFileIds.size).toBe(1);
    });

    it('should update lastSelectedId after range selection', () => {
      const { selectFile, selectRange } = useSelectionStore.getState();

      selectFile('file-2');
      selectRange('file-4', allFileIds);

      expect(useSelectionStore.getState().lastSelectedId).toBe('file-4');
    });
  });

  describe('selectAll', () => {
    const allFileIds = ['file-1', 'file-2', 'file-3'];

    it('should select all provided file IDs', () => {
      const { selectAll } = useSelectionStore.getState();
      selectAll(allFileIds);

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.has('file-1')).toBe(true);
      expect(state.selectedFileIds.has('file-2')).toBe(true);
      expect(state.selectedFileIds.has('file-3')).toBe(true);
      expect(state.selectedFileIds.size).toBe(3);
    });

    it('should handle empty array', () => {
      const { selectAll } = useSelectionStore.getState();
      selectAll([]);

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.size).toBe(0);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selected files', () => {
      const { selectFile, clearSelection } = useSelectionStore.getState();

      selectFile('file-1');
      selectFile('file-2', true);

      clearSelection();

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.size).toBe(0);
    });

    it('should reset lastSelectedId', () => {
      const { selectFile, clearSelection } = useSelectionStore.getState();

      selectFile('file-1');
      clearSelection();

      expect(useSelectionStore.getState().lastSelectedId).toBeNull();
    });
  });

  describe('selectHasSelection', () => {
    it('should return false when no selection', () => {
      const hasSelection = useSelectionStore.getState().hasSelection();
      expect(hasSelection).toBe(false);
    });

    it('should return true when has selection', () => {
      const { selectFile, hasSelection } = useSelectionStore.getState();
      selectFile('file-1');

      expect(hasSelection()).toBe(true);
    });
  });

  describe('getSelectedCount', () => {
    it('should return 0 when no selection', () => {
      const count = useSelectionStore.getState().getSelectedCount();
      expect(count).toBe(0);
    });

    it('should return correct count', () => {
      const { selectFile, getSelectedCount } = useSelectionStore.getState();

      selectFile('file-1');
      selectFile('file-2', true);
      selectFile('file-3', true);

      expect(getSelectedCount()).toBe(3);
    });
  });

  describe('resetSelectionStore', () => {
    it('should reset all state to initial values', () => {
      const { selectFile } = useSelectionStore.getState();

      selectFile('file-1');
      selectFile('file-2', true);

      resetSelectionStore();

      const state = useSelectionStore.getState();
      expect(state.selectedFileIds.size).toBe(0);
      expect(state.lastSelectedId).toBeNull();
    });
  });
});
