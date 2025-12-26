/**
 * uploadStore Tests
 *
 * Tests for upload queue state management.
 * TDD: Tests written FIRST before implementation.
 *
 * @module __tests__/domains/files/stores/uploadStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ParsedFile } from '@bc-agent/shared';
import {
  useUploadStore,
  resetUploadStore,
  type UploadItem,
} from '@/src/domains/files/stores/uploadStore';

// Test fixtures
const createMockFile = (name = 'test.txt', size = 1024): File => {
  return new File(['test content'], name, { type: 'text/plain' });
};

const createMockParsedFile = (overrides: Partial<ParsedFile> = {}): ParsedFile => ({
  id: `file-${Math.random().toString(36).substr(2, 9)}`,
  name: 'test-file.txt',
  mimeType: 'text/plain',
  sizeBytes: 1024,
  isFolder: false,
  isFavorite: false,
  parentFolderId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  userId: 'user-1',
  ...overrides,
});

describe('uploadStore', () => {
  beforeEach(() => {
    resetUploadStore();
  });

  describe('initial state', () => {
    it('should have empty queue', () => {
      const state = useUploadStore.getState();
      expect(state.queue).toEqual([]);
    });

    it('should have isUploading false', () => {
      const state = useUploadStore.getState();
      expect(state.isUploading).toBe(false);
    });

    it('should have overallProgress 0', () => {
      const state = useUploadStore.getState();
      expect(state.overallProgress).toBe(0);
    });
  });

  describe('addToQueue', () => {
    it('should add single file to queue', () => {
      const { addToQueue } = useUploadStore.getState();
      const file = createMockFile('single.txt');

      addToQueue([file]);

      const state = useUploadStore.getState();
      expect(state.queue).toHaveLength(1);
      expect(state.queue[0].file).toBe(file);
    });

    it('should add multiple files with pending status', () => {
      const { addToQueue } = useUploadStore.getState();
      const files = [
        createMockFile('file1.txt'),
        createMockFile('file2.txt'),
        createMockFile('file3.txt'),
      ];

      addToQueue(files);

      const state = useUploadStore.getState();
      expect(state.queue).toHaveLength(3);
      state.queue.forEach((item) => {
        expect(item.status).toBe('pending');
        expect(item.progress).toBe(0);
      });
    });

    it('should generate unique IDs for each item', () => {
      const { addToQueue } = useUploadStore.getState();
      const files = [createMockFile('a.txt'), createMockFile('b.txt')];

      addToQueue(files);

      const state = useUploadStore.getState();
      expect(state.queue[0].id).not.toBe(state.queue[1].id);
      expect(state.queue[0].id).toBeTruthy();
      expect(state.queue[1].id).toBeTruthy();
    });

    it('should append to existing queue', () => {
      const { addToQueue } = useUploadStore.getState();

      addToQueue([createMockFile('first.txt')]);
      addToQueue([createMockFile('second.txt')]);

      const state = useUploadStore.getState();
      expect(state.queue).toHaveLength(2);
    });
  });

  describe('startUpload', () => {
    it('should set item status to uploading', () => {
      const { addToQueue, startUpload } = useUploadStore.getState();
      const file = createMockFile();

      addToQueue([file]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);

      const state = useUploadStore.getState();
      expect(state.queue[0].status).toBe('uploading');
    });

    it('should set isUploading to true', () => {
      const { addToQueue, startUpload } = useUploadStore.getState();
      const file = createMockFile();

      addToQueue([file]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);

      expect(useUploadStore.getState().isUploading).toBe(true);
    });

    it('should handle non-existent item gracefully', () => {
      const { startUpload } = useUploadStore.getState();

      // Should not throw
      startUpload('non-existent-id');

      expect(useUploadStore.getState().isUploading).toBe(false);
    });
  });

  describe('updateProgress', () => {
    it('should update individual item progress', () => {
      const { addToQueue, startUpload, updateProgress } = useUploadStore.getState();
      const file = createMockFile();

      addToQueue([file]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      updateProgress(itemId, 50);

      const state = useUploadStore.getState();
      expect(state.queue[0].progress).toBe(50);
    });

    it('should recalculate overall progress', () => {
      const { addToQueue, startUpload, updateProgress } = useUploadStore.getState();
      const files = [createMockFile('a.txt'), createMockFile('b.txt')];

      addToQueue(files);
      const [item1, item2] = useUploadStore.getState().queue;

      startUpload(item1.id);
      updateProgress(item1.id, 100);
      startUpload(item2.id);
      updateProgress(item2.id, 50);

      // (100 + 50) / 2 = 75
      const state = useUploadStore.getState();
      expect(state.overallProgress).toBe(75);
    });

    it('should handle single file progress', () => {
      const { addToQueue, startUpload, updateProgress } = useUploadStore.getState();

      addToQueue([createMockFile()]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      updateProgress(itemId, 75);

      expect(useUploadStore.getState().overallProgress).toBe(75);
    });
  });

  describe('completeUpload', () => {
    it('should set status to completed', () => {
      const { addToQueue, startUpload, completeUpload } = useUploadStore.getState();
      const file = createMockFile();
      const resultFile = createMockParsedFile({ id: 'server-file-id' });

      addToQueue([file]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      completeUpload(itemId, resultFile);

      const state = useUploadStore.getState();
      expect(state.queue[0].status).toBe('completed');
      expect(state.queue[0].progress).toBe(100);
    });

    it('should store resultFile reference', () => {
      const { addToQueue, startUpload, completeUpload } = useUploadStore.getState();
      const file = createMockFile();
      const resultFile = createMockParsedFile({ id: 'uploaded-file-123' });

      addToQueue([file]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      completeUpload(itemId, resultFile);

      const state = useUploadStore.getState();
      expect(state.queue[0].resultFile).toEqual(resultFile);
    });

    it('should set isUploading to false when all complete', () => {
      const { addToQueue, startUpload, completeUpload } = useUploadStore.getState();

      addToQueue([createMockFile()]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      completeUpload(itemId, createMockParsedFile());

      // Single item completed, should check if all are done
      const state = useUploadStore.getState();
      expect(state.isUploading).toBe(false);
    });
  });

  describe('failUpload', () => {
    it('should set status to error', () => {
      const { addToQueue, startUpload, failUpload } = useUploadStore.getState();
      const file = createMockFile();

      addToQueue([file]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      failUpload(itemId, 'Network error');

      const state = useUploadStore.getState();
      expect(state.queue[0].status).toBe('error');
    });

    it('should store error message', () => {
      const { addToQueue, startUpload, failUpload } = useUploadStore.getState();
      const file = createMockFile();

      addToQueue([file]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      failUpload(itemId, 'File too large');

      const state = useUploadStore.getState();
      expect(state.queue[0].error).toBe('File too large');
    });

    it('should set isUploading to false when failed', () => {
      const { addToQueue, startUpload, failUpload } = useUploadStore.getState();

      addToQueue([createMockFile()]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      failUpload(itemId, 'Error');

      expect(useUploadStore.getState().isUploading).toBe(false);
    });
  });

  describe('removeFromQueue', () => {
    it('should remove single item', () => {
      const { addToQueue, removeFromQueue } = useUploadStore.getState();
      const files = [createMockFile('a.txt'), createMockFile('b.txt')];

      addToQueue(files);
      const [item1] = useUploadStore.getState().queue;
      removeFromQueue(item1.id);

      const state = useUploadStore.getState();
      expect(state.queue).toHaveLength(1);
      expect(state.queue[0].id).not.toBe(item1.id);
    });

    it('should recalculate overall progress after removal', () => {
      const { addToQueue, updateProgress, removeFromQueue } = useUploadStore.getState();
      const files = [createMockFile('a.txt'), createMockFile('b.txt')];

      addToQueue(files);
      const [item1, item2] = useUploadStore.getState().queue;

      // Set progress: item1=50, item2=100 -> overall=75
      updateProgress(item1.id, 50);
      updateProgress(item2.id, 100);

      // Remove item1, only item2 remains with 100%
      removeFromQueue(item1.id);

      expect(useUploadStore.getState().overallProgress).toBe(100);
    });
  });

  describe('clearQueue', () => {
    it('should remove all items', () => {
      const { addToQueue, clearQueue } = useUploadStore.getState();

      addToQueue([createMockFile('a.txt'), createMockFile('b.txt')]);
      clearQueue();

      expect(useUploadStore.getState().queue).toEqual([]);
    });

    it('should reset progress and isUploading', () => {
      const { addToQueue, startUpload, updateProgress, clearQueue } = useUploadStore.getState();

      addToQueue([createMockFile()]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      updateProgress(itemId, 50);
      clearQueue();

      const state = useUploadStore.getState();
      expect(state.overallProgress).toBe(0);
      expect(state.isUploading).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const { addToQueue, startUpload, updateProgress, reset } = useUploadStore.getState();

      addToQueue([createMockFile()]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);
      updateProgress(itemId, 75);

      reset();

      const state = useUploadStore.getState();
      expect(state.queue).toEqual([]);
      expect(state.isUploading).toBe(false);
      expect(state.overallProgress).toBe(0);
    });
  });

  describe('getters', () => {
    it('getPendingCount should return count of pending items', () => {
      const { addToQueue, startUpload, getPendingCount } = useUploadStore.getState();

      addToQueue([createMockFile('a.txt'), createMockFile('b.txt'), createMockFile('c.txt')]);
      const [item1] = useUploadStore.getState().queue;
      startUpload(item1.id);

      // 1 uploading, 2 pending
      expect(getPendingCount()).toBe(2);
    });

    it('getCompletedCount should return count of completed items', () => {
      const { addToQueue, startUpload, completeUpload, getCompletedCount } = useUploadStore.getState();

      addToQueue([createMockFile('a.txt'), createMockFile('b.txt')]);
      const [item1] = useUploadStore.getState().queue;
      startUpload(item1.id);
      completeUpload(item1.id, createMockParsedFile());

      expect(getCompletedCount()).toBe(1);
    });

    it('getFailedCount should return count of failed items', () => {
      const { addToQueue, startUpload, failUpload, getFailedCount } = useUploadStore.getState();

      addToQueue([createMockFile('a.txt'), createMockFile('b.txt')]);
      const [item1] = useUploadStore.getState().queue;
      startUpload(item1.id);
      failUpload(item1.id, 'Error');

      expect(getFailedCount()).toBe(1);
    });
  });

  describe('resetUploadStore', () => {
    it('should reset store to initial values (test utility)', () => {
      const { addToQueue, startUpload } = useUploadStore.getState();

      addToQueue([createMockFile()]);
      const itemId = useUploadStore.getState().queue[0].id;
      startUpload(itemId);

      resetUploadStore();

      const state = useUploadStore.getState();
      expect(state.queue).toEqual([]);
      expect(state.isUploading).toBe(false);
    });
  });
});
