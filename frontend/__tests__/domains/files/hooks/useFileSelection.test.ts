/**
 * useFileSelection Hook Tests
 *
 * Tests for file selection hook that wraps selectionStore.
 *
 * @module __tests__/domains/files/hooks/useFileSelection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileSelection } from '@/src/domains/files/hooks/useFileSelection';
import { resetSelectionStore } from '@/src/domains/files/stores/selectionStore';
import { resetFileListStore, useFileListStore } from '@/src/domains/files/stores/fileListStore';
import { createMockFile } from '@/__tests__/fixtures/FileFixture';

describe('useFileSelection', () => {
  beforeEach(() => {
    resetSelectionStore();
    resetFileListStore();
  });

  describe('selectedFileIds', () => {
    it('should expose selectedFileIds from store', () => {
      const { result } = renderHook(() => useFileSelection());

      expect(result.current.selectedFileIds).toBeInstanceOf(Set);
      expect(result.current.selectedFileIds.size).toBe(0);
    });
  });

  describe('selectedFiles', () => {
    it('should return empty array when no selection', () => {
      const { result } = renderHook(() => useFileSelection());

      expect(result.current.selectedFiles).toEqual([]);
    });

    it('should return full file objects for selected IDs', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'doc1.txt' }),
        createMockFile({ id: 'file-2', name: 'doc2.txt' }),
        createMockFile({ id: 'file-3', name: 'doc3.txt' }),
      ];

      // Set files in fileListStore
      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
      });

      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectFile('file-1');
        result.current.selectFile('file-3', true);
      });

      expect(result.current.selectedFiles).toHaveLength(2);
      expect(result.current.selectedFiles.map((f) => f.id)).toContain('file-1');
      expect(result.current.selectedFiles.map((f) => f.id)).toContain('file-3');
    });
  });

  describe('selectFile', () => {
    it('should select single file', () => {
      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectFile('file-1');
      });

      expect(result.current.selectedFileIds.has('file-1')).toBe(true);
    });

    it('should multi-select with Ctrl (second param true)', () => {
      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectFile('file-1');
        result.current.selectFile('file-2', true);
      });

      expect(result.current.selectedFileIds.has('file-1')).toBe(true);
      expect(result.current.selectedFileIds.has('file-2')).toBe(true);
    });
  });

  describe('selectRange', () => {
    it('should range select with Shift', () => {
      const files = [
        createMockFile({ id: 'file-1' }),
        createMockFile({ id: 'file-2' }),
        createMockFile({ id: 'file-3' }),
        createMockFile({ id: 'file-4' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 4, false);
      });

      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectFile('file-1');
        result.current.selectRange('file-3');
      });

      // Should select file-1, file-2, file-3
      expect(result.current.selectedFileIds.size).toBe(3);
      expect(result.current.selectedFileIds.has('file-1')).toBe(true);
      expect(result.current.selectedFileIds.has('file-2')).toBe(true);
      expect(result.current.selectedFileIds.has('file-3')).toBe(true);
      expect(result.current.selectedFileIds.has('file-4')).toBe(false);
    });
  });

  describe('selectAll', () => {
    it('should select all visible files', () => {
      const files = [
        createMockFile({ id: 'file-1' }),
        createMockFile({ id: 'file-2' }),
        createMockFile({ id: 'file-3' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
      });

      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selectedFileIds.size).toBe(3);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selection', () => {
      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectFile('file-1');
        result.current.selectFile('file-2', true);
        result.current.clearSelection();
      });

      expect(result.current.selectedFileIds.size).toBe(0);
    });
  });

  describe('hasSelection', () => {
    it('should return false when no selection', () => {
      const { result } = renderHook(() => useFileSelection());

      expect(result.current.hasSelection).toBe(false);
    });

    it('should return true when has selection', () => {
      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectFile('file-1');
      });

      expect(result.current.hasSelection).toBe(true);
    });
  });

  describe('selectedCount', () => {
    it('should return 0 when no selection', () => {
      const { result } = renderHook(() => useFileSelection());

      expect(result.current.selectedCount).toBe(0);
    });

    it('should return correct count', () => {
      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectFile('file-1');
        result.current.selectFile('file-2', true);
        result.current.selectFile('file-3', true);
      });

      expect(result.current.selectedCount).toBe(3);
    });
  });
});
