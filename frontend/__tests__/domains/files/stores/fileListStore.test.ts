/**
 * fileListStore Tests
 *
 * Tests for file list state management.
 * TDD: Tests written FIRST before implementation.
 *
 * @module __tests__/domains/files/stores/fileListStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useFileListStore,
  resetFileListStore,
} from '@/src/domains/files/stores/fileListStore';
import { createMockFile, createMockFolder } from '@/__tests__/fixtures/FileFixture';

describe('fileListStore', () => {
  beforeEach(() => {
    resetFileListStore();
  });

  describe('initial state', () => {
    it('should have empty files array', () => {
      const state = useFileListStore.getState();
      expect(state.files).toEqual([]);
    });

    it('should have default pagination values', () => {
      const state = useFileListStore.getState();
      expect(state.totalFiles).toBe(0);
      expect(state.hasMore).toBe(false);
      expect(state.currentOffset).toBe(0);
      expect(state.currentLimit).toBe(50);
    });

    it('should have isLoading false', () => {
      const state = useFileListStore.getState();
      expect(state.isLoading).toBe(false);
    });

    it('should have null error', () => {
      const state = useFileListStore.getState();
      expect(state.error).toBeNull();
    });
  });

  describe('setFiles', () => {
    it('should set files array', () => {
      const { setFiles } = useFileListStore.getState();
      const files = [createMockFile({ id: 'file-1' }), createMockFile({ id: 'file-2' })];

      setFiles(files, 10, true);

      const state = useFileListStore.getState();
      expect(state.files).toHaveLength(2);
      expect(state.files[0].id).toBe('file-1');
      expect(state.files[1].id).toBe('file-2');
    });

    it('should set totalFiles count', () => {
      const { setFiles } = useFileListStore.getState();
      const files = [createMockFile()];

      setFiles(files, 100, true);

      expect(useFileListStore.getState().totalFiles).toBe(100);
    });

    it('should set hasMore flag', () => {
      const { setFiles } = useFileListStore.getState();
      const files = [createMockFile()];

      setFiles(files, 100, true);
      expect(useFileListStore.getState().hasMore).toBe(true);

      setFiles(files, 1, false);
      expect(useFileListStore.getState().hasMore).toBe(false);
    });

    it('should reset currentOffset when setting new files', () => {
      const { setFiles } = useFileListStore.getState();

      // First set some files
      setFiles([createMockFile()], 10, true);

      // Simulate pagination having advanced
      useFileListStore.setState({ currentOffset: 50 });

      // Set new files should reset offset
      setFiles([createMockFile()], 5, false);

      expect(useFileListStore.getState().currentOffset).toBe(1);
    });
  });

  describe('addFile', () => {
    it('should prepend new file to list', () => {
      const { setFiles, addFile } = useFileListStore.getState();
      const existingFile = createMockFile({ id: 'existing' });
      const newFile = createMockFile({ id: 'new' });

      setFiles([existingFile], 1, false);
      addFile(newFile);

      const state = useFileListStore.getState();
      expect(state.files).toHaveLength(2);
      expect(state.files[0].id).toBe('new');
      expect(state.files[1].id).toBe('existing');
    });

    it('should increment totalFiles', () => {
      const { setFiles, addFile } = useFileListStore.getState();

      setFiles([createMockFile()], 5, true);
      addFile(createMockFile());

      expect(useFileListStore.getState().totalFiles).toBe(6);
    });
  });

  describe('updateFile', () => {
    it('should update existing file by ID', () => {
      const { setFiles, updateFile } = useFileListStore.getState();
      const file = createMockFile({ id: 'file-1', name: 'original.txt' });

      setFiles([file], 1, false);
      updateFile('file-1', { name: 'updated.txt' });

      const state = useFileListStore.getState();
      expect(state.files[0].name).toBe('updated.txt');
    });

    it('should not modify other files', () => {
      const { setFiles, updateFile } = useFileListStore.getState();
      const file1 = createMockFile({ id: 'file-1', name: 'file1.txt' });
      const file2 = createMockFile({ id: 'file-2', name: 'file2.txt' });

      setFiles([file1, file2], 2, false);
      updateFile('file-1', { name: 'updated.txt' });

      const state = useFileListStore.getState();
      expect(state.files[0].name).toBe('updated.txt');
      expect(state.files[1].name).toBe('file2.txt');
    });

    it('should handle non-existent file gracefully', () => {
      const { setFiles, updateFile } = useFileListStore.getState();
      const file = createMockFile({ id: 'file-1', name: 'original.txt' });

      setFiles([file], 1, false);

      // Should not throw
      updateFile('non-existent', { name: 'updated.txt' });

      const state = useFileListStore.getState();
      expect(state.files[0].name).toBe('original.txt');
    });

    it('should update isFavorite status', () => {
      const { setFiles, updateFile } = useFileListStore.getState();
      const file = createMockFile({ id: 'file-1', isFavorite: false });

      setFiles([file], 1, false);
      updateFile('file-1', { isFavorite: true });

      expect(useFileListStore.getState().files[0].isFavorite).toBe(true);
    });
  });

  describe('deleteFiles', () => {
    it('should remove files by IDs', () => {
      const { setFiles, deleteFiles } = useFileListStore.getState();
      const files = [
        createMockFile({ id: 'file-1' }),
        createMockFile({ id: 'file-2' }),
        createMockFile({ id: 'file-3' }),
      ];

      setFiles(files, 3, false);
      deleteFiles(['file-1', 'file-3']);

      const state = useFileListStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0].id).toBe('file-2');
    });

    it('should decrement totalFiles correctly', () => {
      const { setFiles, deleteFiles } = useFileListStore.getState();
      const files = [
        createMockFile({ id: 'file-1' }),
        createMockFile({ id: 'file-2' }),
        createMockFile({ id: 'file-3' }),
      ];

      setFiles(files, 10, true);
      deleteFiles(['file-1', 'file-2']);

      expect(useFileListStore.getState().totalFiles).toBe(8);
    });

    it('should handle empty IDs array', () => {
      const { setFiles, deleteFiles } = useFileListStore.getState();
      const files = [createMockFile({ id: 'file-1' })];

      setFiles(files, 1, false);
      deleteFiles([]);

      const state = useFileListStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.totalFiles).toBe(1);
    });

    it('should not decrement below zero', () => {
      const { setFiles, deleteFiles } = useFileListStore.getState();

      setFiles([createMockFile({ id: 'file-1' })], 1, false);
      deleteFiles(['file-1', 'non-existent-1', 'non-existent-2']);

      expect(useFileListStore.getState().totalFiles).toBe(0);
    });
  });

  describe('appendFiles', () => {
    it('should append to existing files', () => {
      const { setFiles, appendFiles } = useFileListStore.getState();
      const initial = [createMockFile({ id: 'file-1' })];
      const more = [createMockFile({ id: 'file-2' }), createMockFile({ id: 'file-3' })];

      setFiles(initial, 3, true);
      appendFiles(more, false);

      const state = useFileListStore.getState();
      expect(state.files).toHaveLength(3);
      expect(state.files[0].id).toBe('file-1');
      expect(state.files[1].id).toBe('file-2');
      expect(state.files[2].id).toBe('file-3');
    });

    it('should update hasMore flag', () => {
      const { setFiles, appendFiles } = useFileListStore.getState();

      setFiles([createMockFile()], 10, true);
      expect(useFileListStore.getState().hasMore).toBe(true);

      appendFiles([createMockFile()], false);
      expect(useFileListStore.getState().hasMore).toBe(false);
    });

    it('should update currentOffset', () => {
      const { setFiles, appendFiles } = useFileListStore.getState();

      setFiles([createMockFile()], 10, true);
      expect(useFileListStore.getState().currentOffset).toBe(1);

      appendFiles([createMockFile(), createMockFile()], true);
      expect(useFileListStore.getState().currentOffset).toBe(3);
    });
  });

  describe('setLoading', () => {
    it('should set loading state to true', () => {
      const { setLoading } = useFileListStore.getState();

      setLoading(true);

      expect(useFileListStore.getState().isLoading).toBe(true);
    });

    it('should set loading state to false', () => {
      const { setLoading } = useFileListStore.getState();

      setLoading(true);
      setLoading(false);

      expect(useFileListStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      const { setError } = useFileListStore.getState();

      setError('Something went wrong');

      expect(useFileListStore.getState().error).toBe('Something went wrong');
    });

    it('should clear error with null', () => {
      const { setError } = useFileListStore.getState();

      setError('Error');
      setError(null);

      expect(useFileListStore.getState().error).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const { setFiles, setLoading, setError, reset } = useFileListStore.getState();

      // Set various state
      setFiles([createMockFile()], 10, true);
      setLoading(true);
      setError('Error');

      // Reset
      reset();

      const state = useFileListStore.getState();
      expect(state.files).toEqual([]);
      expect(state.totalFiles).toBe(0);
      expect(state.hasMore).toBe(false);
      expect(state.currentOffset).toBe(0);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('resetFileListStore', () => {
    it('should reset store to initial values (test utility)', () => {
      const { setFiles, setLoading } = useFileListStore.getState();

      setFiles([createMockFile()], 5, true);
      setLoading(true);

      resetFileListStore();

      const state = useFileListStore.getState();
      expect(state.files).toEqual([]);
      expect(state.isLoading).toBe(false);
    });
  });
});
