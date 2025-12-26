/**
 * useFileUpload Hook Tests
 *
 * Tests for file upload hook that wraps uploadStore.
 *
 * @module __tests__/domains/files/hooks/useFileUpload
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '@/src/domains/files/hooks/useFileUpload';
import { resetUploadStore, useUploadStore } from '@/src/domains/files/stores/uploadStore';
import { resetFileListStore } from '@/src/domains/files/stores/fileListStore';

// Test fixtures
const createMockFile = (name = 'test.txt', size = 1024): File => {
  return new File(['test content'], name, { type: 'text/plain' });
};

describe('useFileUpload', () => {
  beforeEach(() => {
    resetUploadStore();
    resetFileListStore();
  });

  describe('queue state', () => {
    it('should expose empty queue initially', () => {
      const { result } = renderHook(() => useFileUpload());

      expect(result.current.queue).toEqual([]);
    });

    it('should expose queue from store', () => {
      act(() => {
        useUploadStore.getState().addToQueue([createMockFile()]);
      });

      const { result } = renderHook(() => useFileUpload());

      expect(result.current.queue).toHaveLength(1);
    });
  });

  describe('isUploading', () => {
    it('should be false initially', () => {
      const { result } = renderHook(() => useFileUpload());

      expect(result.current.isUploading).toBe(false);
    });

    it('should reflect store state', () => {
      act(() => {
        const { addToQueue, startUpload } = useUploadStore.getState();
        addToQueue([createMockFile()]);
        const itemId = useUploadStore.getState().queue[0].id;
        startUpload(itemId);
      });

      const { result } = renderHook(() => useFileUpload());

      expect(result.current.isUploading).toBe(true);
    });
  });

  describe('overallProgress', () => {
    it('should be 0 initially', () => {
      const { result } = renderHook(() => useFileUpload());

      expect(result.current.overallProgress).toBe(0);
    });

    it('should reflect store progress', () => {
      act(() => {
        const { addToQueue, updateProgress } = useUploadStore.getState();
        addToQueue([createMockFile()]);
        const itemId = useUploadStore.getState().queue[0].id;
        updateProgress(itemId, 50);
      });

      const { result } = renderHook(() => useFileUpload());

      expect(result.current.overallProgress).toBe(50);
    });
  });

  describe('addToQueue', () => {
    it('should add files to queue', () => {
      const { result } = renderHook(() => useFileUpload());

      act(() => {
        result.current.addToQueue([createMockFile('file1.txt'), createMockFile('file2.txt')]);
      });

      expect(result.current.queue).toHaveLength(2);
    });

    it('should set files with pending status', () => {
      const { result } = renderHook(() => useFileUpload());

      act(() => {
        result.current.addToQueue([createMockFile()]);
      });

      expect(result.current.queue[0].status).toBe('pending');
    });
  });

  describe('clearQueue', () => {
    it('should clear all items', () => {
      const { result } = renderHook(() => useFileUpload());

      act(() => {
        result.current.addToQueue([createMockFile(), createMockFile()]);
      });

      expect(result.current.queue).toHaveLength(2);

      act(() => {
        result.current.clearQueue();
      });

      expect(result.current.queue).toEqual([]);
    });

    it('should reset progress', () => {
      const { result } = renderHook(() => useFileUpload());

      act(() => {
        result.current.addToQueue([createMockFile()]);
        const itemId = useUploadStore.getState().queue[0].id;
        useUploadStore.getState().updateProgress(itemId, 75);
      });

      act(() => {
        result.current.clearQueue();
      });

      expect(result.current.overallProgress).toBe(0);
    });
  });

  describe('getters', () => {
    it('should return pending count', () => {
      const { result } = renderHook(() => useFileUpload());

      act(() => {
        result.current.addToQueue([createMockFile(), createMockFile(), createMockFile()]);
        const itemId = useUploadStore.getState().queue[0].id;
        useUploadStore.getState().startUpload(itemId);
      });

      expect(result.current.pendingCount).toBe(2);
    });

    it('should return completed count', () => {
      const { result } = renderHook(() => useFileUpload());

      act(() => {
        result.current.addToQueue([createMockFile(), createMockFile()]);
        const { startUpload, completeUpload } = useUploadStore.getState();
        const itemId = useUploadStore.getState().queue[0].id;
        startUpload(itemId);
        completeUpload(itemId, {
          id: 'server-id',
          name: 'test.txt',
          mimeType: 'text/plain',
          sizeBytes: 1024,
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: 'user-1',
        });
      });

      expect(result.current.completedCount).toBe(1);
    });

    it('should return failed count', () => {
      const { result } = renderHook(() => useFileUpload());

      act(() => {
        result.current.addToQueue([createMockFile()]);
        const { startUpload, failUpload } = useUploadStore.getState();
        const itemId = useUploadStore.getState().queue[0].id;
        startUpload(itemId);
        failUpload(itemId, 'Network error');
      });

      expect(result.current.failedCount).toBe(1);
    });
  });
});
