/**
 * useFiles Hook Tests
 *
 * Tests for file list hook that combines fileListStore with sortFilterStore.
 *
 * @module __tests__/domains/files/hooks/useFiles
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFiles } from '@/src/domains/files/hooks/useFiles';
import { resetFileListStore, useFileListStore } from '@/src/domains/files/stores/fileListStore';
import { resetSortFilterStore, useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { createMockFile, createMockFolder } from '@/__tests__/fixtures/FileFixture';

describe('useFiles', () => {
  beforeEach(() => {
    resetFileListStore();
    resetSortFilterStore();
  });

  describe('sortedFiles', () => {
    it('should expose files from store', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'alpha.txt' }),
        createMockFile({ id: 'file-2', name: 'beta.txt' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 2, false);
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.sortedFiles).toHaveLength(2);
    });

    it('should compute sorted files with folders first', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'zebra.txt' }),
        createMockFolder({ id: 'folder-1', name: 'alpha-folder' }),
        createMockFile({ id: 'file-2', name: 'apple.txt' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
        useSortFilterStore.getState().setSort('name', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      // Folder should be first
      expect(result.current.sortedFiles[0].isFolder).toBe(true);
      expect(result.current.sortedFiles[0].name).toBe('alpha-folder');
    });

    it('should apply sort by name ascending', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'charlie.txt' }),
        createMockFile({ id: 'file-2', name: 'alpha.txt' }),
        createMockFile({ id: 'file-3', name: 'bravo.txt' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
        useSortFilterStore.getState().setSort('name', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.sortedFiles[0].name).toBe('alpha.txt');
      expect(result.current.sortedFiles[1].name).toBe('bravo.txt');
      expect(result.current.sortedFiles[2].name).toBe('charlie.txt');
    });

    it('should apply sort by name descending', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'alpha.txt' }),
        createMockFile({ id: 'file-2', name: 'charlie.txt' }),
        createMockFile({ id: 'file-3', name: 'bravo.txt' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
        useSortFilterStore.getState().setSort('name', 'desc');
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.sortedFiles[0].name).toBe('charlie.txt');
      expect(result.current.sortedFiles[1].name).toBe('bravo.txt');
      expect(result.current.sortedFiles[2].name).toBe('alpha.txt');
    });

    it('should apply sort by date', () => {
      const files = [
        createMockFile({ id: 'file-1', updatedAt: '2024-01-01T00:00:00Z' }),
        createMockFile({ id: 'file-2', updatedAt: '2024-03-01T00:00:00Z' }),
        createMockFile({ id: 'file-3', updatedAt: '2024-02-01T00:00:00Z' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
        useSortFilterStore.getState().setSort('date', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.sortedFiles[0].id).toBe('file-1');
      expect(result.current.sortedFiles[1].id).toBe('file-3');
      expect(result.current.sortedFiles[2].id).toBe('file-2');
    });

    it('should apply sort by size', () => {
      const files = [
        createMockFile({ id: 'file-1', sizeBytes: 5000 }),
        createMockFile({ id: 'file-2', sizeBytes: 1000 }),
        createMockFile({ id: 'file-3', sizeBytes: 3000 }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
        useSortFilterStore.getState().setSort('size', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.sortedFiles[0].sizeBytes).toBe(1000);
      expect(result.current.sortedFiles[1].sizeBytes).toBe(3000);
      expect(result.current.sortedFiles[2].sizeBytes).toBe(5000);
    });
  });

  describe('loading and error state', () => {
    it('should expose loading state', () => {
      const { result } = renderHook(() => useFiles());

      expect(result.current.isLoading).toBe(false);

      act(() => {
        useFileListStore.getState().setLoading(true);
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should expose error state', () => {
      const { result } = renderHook(() => useFiles());

      expect(result.current.error).toBeNull();

      act(() => {
        useFileListStore.getState().setError('Network error');
      });

      expect(result.current.error).toBe('Network error');
    });
  });

  describe('pagination', () => {
    it('should expose hasMore', () => {
      act(() => {
        useFileListStore.getState().setFiles([createMockFile()], 10, true);
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.hasMore).toBe(true);
    });

    it('should expose totalFiles', () => {
      act(() => {
        useFileListStore.getState().setFiles([createMockFile()], 100, true);
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.totalFiles).toBe(100);
    });
  });

  describe('sort preferences', () => {
    it('should expose sortBy', () => {
      act(() => {
        useSortFilterStore.getState().setSort('name');
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.sortBy).toBe('name');
    });

    it('should expose sortOrder', () => {
      act(() => {
        useSortFilterStore.getState().setSort('date', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.sortOrder).toBe('asc');
    });

    it('should expose showFavoritesOnly', () => {
      act(() => {
        useSortFilterStore.getState().toggleFavoritesFilter();
      });

      const { result } = renderHook(() => useFiles());

      expect(result.current.showFavoritesOnly).toBe(true);
    });
  });

  describe('actions', () => {
    it('should provide setSort action', () => {
      const { result } = renderHook(() => useFiles());

      act(() => {
        result.current.setSort('name', 'asc');
      });

      expect(useSortFilterStore.getState().sortBy).toBe('name');
      expect(useSortFilterStore.getState().sortOrder).toBe('asc');
    });

    it('should provide toggleSortOrder action', () => {
      act(() => {
        useSortFilterStore.getState().setSort('date', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      act(() => {
        result.current.toggleSortOrder();
      });

      expect(useSortFilterStore.getState().sortOrder).toBe('desc');
    });

    it('should provide toggleFavoritesFilter action', () => {
      const { result } = renderHook(() => useFiles());

      act(() => {
        result.current.toggleFavoritesFilter();
      });

      expect(useSortFilterStore.getState().showFavoritesOnly).toBe(true);
    });
  });
});
