/**
 * File Processing Store Tests
 *
 * Unit tests for the file processing store.
 * Tests state management for file processing status tracking.
 *
 * @module __tests__/stores/fileProcessingStore.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useFileProcessingStore,
  resetFileProcessingStore,
  selectFileProcessingStatus,
  type FileProcessingStatus,
} from '@/src/domains/files/stores/fileProcessingStore';

describe('FileProcessingStore', () => {
  beforeEach(() => {
    act(() => {
      resetFileProcessingStore();
    });
  });

  describe('Initial State', () => {
    it('should have empty processingFiles map initially', () => {
      const state = useFileProcessingStore.getState();
      expect(state.processingFiles.size).toBe(0);
    });
  });

  describe('setProcessingStatus', () => {
    it('should add a new file processing status', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
          progress: 0,
          attemptNumber: 1,
          maxAttempts: 3,
        });
      });

      const state = useFileProcessingStore.getState();
      expect(state.processingFiles.size).toBe(1);

      const status = state.processingFiles.get('file-1');
      expect(status).toBeDefined();
      expect(status?.readinessState).toBe('processing');
      expect(status?.progress).toBe(0);
      expect(status?.attemptNumber).toBe(1);
      expect(status?.maxAttempts).toBe(3);
    });

    it('should update existing file processing status with partial data', () => {
      // Initial status
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
          progress: 0,
          attemptNumber: 1,
          maxAttempts: 3,
        });
      });

      // Update with partial data
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          progress: 50,
        });
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.readinessState).toBe('processing'); // Preserved
      expect(status?.progress).toBe(50); // Updated
      expect(status?.attemptNumber).toBe(1); // Preserved
    });

    it('should handle multiple files independently', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
          progress: 25,
        });
        useFileProcessingStore.getState().setProcessingStatus('file-2', {
          readinessState: 'uploading',
          progress: 75,
        });
      });

      const state = useFileProcessingStore.getState();
      expect(state.processingFiles.size).toBe(2);
      expect(state.processingFiles.get('file-1')?.progress).toBe(25);
      expect(state.processingFiles.get('file-2')?.progress).toBe(75);
    });
  });

  describe('updateProgress', () => {
    it('should update progress for existing file', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
          progress: 0,
        });
      });

      act(() => {
        useFileProcessingStore.getState().updateProgress('file-1', 50);
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.progress).toBe(50);
    });

    it('should update progress with attempt info', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
          progress: 0,
        });
      });

      act(() => {
        useFileProcessingStore.getState().updateProgress('file-1', 75, 2, 3);
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.progress).toBe(75);
      expect(status?.attemptNumber).toBe(2);
      expect(status?.maxAttempts).toBe(3);
    });

    it('should handle updating non-existent file gracefully', () => {
      // Should not throw
      expect(() => {
        act(() => {
          useFileProcessingStore.getState().updateProgress('non-existent', 50);
        });
      }).not.toThrow();

      // File should not be added
      const state = useFileProcessingStore.getState();
      expect(state.processingFiles.size).toBe(0);
    });
  });

  describe('markCompleted', () => {
    it('should mark file as ready and set progress to 100', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
          progress: 80,
        });
      });

      act(() => {
        useFileProcessingStore.getState().markCompleted('file-1');
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.readinessState).toBe('ready');
      expect(status?.progress).toBe(100);
      expect(status?.error).toBeUndefined();
    });

    it('should clear any previous error when marking as completed', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'failed',
          error: 'Some error',
        });
      });

      act(() => {
        useFileProcessingStore.getState().markCompleted('file-1');
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.readinessState).toBe('ready');
      expect(status?.error).toBeUndefined();
    });
  });

  describe('markFailed', () => {
    it('should mark file as failed with error message', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
          progress: 50,
        });
      });

      act(() => {
        useFileProcessingStore.getState().markFailed('file-1', 'Processing failed', true);
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.readinessState).toBe('failed');
      expect(status?.error).toBe('Processing failed');
      expect(status?.canRetryManually).toBe(true);
    });

    it('should set canRetryManually flag correctly', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
        });
      });

      act(() => {
        useFileProcessingStore.getState().markFailed('file-1', 'Max retries exceeded', false);
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.canRetryManually).toBe(false);
    });
  });

  describe('removeProcessingStatus', () => {
    it('should remove file from processingFiles map', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
        });
        useFileProcessingStore.getState().setProcessingStatus('file-2', {
          readinessState: 'ready',
        });
      });

      expect(useFileProcessingStore.getState().processingFiles.size).toBe(2);

      act(() => {
        useFileProcessingStore.getState().removeProcessingStatus('file-1');
      });

      const state = useFileProcessingStore.getState();
      expect(state.processingFiles.size).toBe(1);
      expect(state.processingFiles.has('file-1')).toBe(false);
      expect(state.processingFiles.has('file-2')).toBe(true);
    });

    it('should handle removing non-existent file gracefully', () => {
      expect(() => {
        act(() => {
          useFileProcessingStore.getState().removeProcessingStatus('non-existent');
        });
      }).not.toThrow();
    });
  });

  describe('reset', () => {
    it('should clear all processing files', () => {
      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
        });
        useFileProcessingStore.getState().setProcessingStatus('file-2', {
          readinessState: 'ready',
        });
      });

      expect(useFileProcessingStore.getState().processingFiles.size).toBe(2);

      act(() => {
        useFileProcessingStore.getState().reset();
      });

      expect(useFileProcessingStore.getState().processingFiles.size).toBe(0);
    });
  });

  describe('Selectors', () => {
    describe('selectFileProcessingStatus', () => {
      it('should return status for existing file', () => {
        const status: FileProcessingStatus = {
          readinessState: 'processing',
          progress: 50,
          attemptNumber: 1,
          maxAttempts: 3,
        };

        act(() => {
          useFileProcessingStore.getState().setProcessingStatus('file-1', status);
        });

        const state = useFileProcessingStore.getState();
        const result = selectFileProcessingStatus(state, 'file-1');
        expect(result).toEqual(status);
      });

      it('should return undefined for non-existent file', () => {
        const state = useFileProcessingStore.getState();
        const result = selectFileProcessingStatus(state, 'non-existent');
        expect(result).toBeUndefined();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid status updates', () => {
      act(() => {
        for (let i = 0; i <= 100; i += 10) {
          useFileProcessingStore.getState().setProcessingStatus('file-1', {
            readinessState: 'processing',
            progress: i,
          });
        }
      });

      const status = useFileProcessingStore.getState().processingFiles.get('file-1');
      expect(status?.progress).toBe(100);
    });

    it('should maintain Map reference immutability', () => {
      const initialMap = useFileProcessingStore.getState().processingFiles;

      act(() => {
        useFileProcessingStore.getState().setProcessingStatus('file-1', {
          readinessState: 'processing',
        });
      });

      const updatedMap = useFileProcessingStore.getState().processingFiles;
      expect(updatedMap).not.toBe(initialMap);
    });
  });
});
