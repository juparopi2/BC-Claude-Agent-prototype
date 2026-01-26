/**
 * Upload Limit Store Tests
 *
 * Tests for the upload limit exceeded error store.
 *
 * @module __tests__/domains/files/stores/uploadLimitStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useUploadLimitStore,
  resetUploadLimitStore,
} from '@/src/domains/files/stores/uploadLimitStore';
import type { LimitExceededError } from '@/src/domains/files/types/folderUpload.types';

describe('uploadLimitStore', () => {
  beforeEach(() => {
    resetUploadLimitStore();
  });

  describe('initial state', () => {
    it('should have modal closed initially', () => {
      const state = useUploadLimitStore.getState();
      expect(state.isModalOpen).toBe(false);
    });

    it('should have empty errors array initially', () => {
      const state = useUploadLimitStore.getState();
      expect(state.errors).toEqual([]);
    });
  });

  describe('showErrors', () => {
    it('should open modal and set errors', () => {
      const errors: LimitExceededError[] = [
        {
          type: 'file_count',
          message: 'Too many files',
          actual: 15000,
          limit: 10000,
          unit: 'files',
        },
      ];

      useUploadLimitStore.getState().showErrors(errors);

      const state = useUploadLimitStore.getState();
      expect(state.isModalOpen).toBe(true);
      expect(state.errors).toEqual(errors);
    });

    it('should handle multiple errors', () => {
      const errors: LimitExceededError[] = [
        {
          type: 'file_count',
          message: 'Too many files',
          actual: 15000,
          limit: 10000,
          unit: 'files',
        },
        {
          type: 'total_size',
          message: 'Total size exceeds limit',
          actual: 20,
          limit: 10,
          unit: 'GB',
        },
      ];

      useUploadLimitStore.getState().showErrors(errors);

      const state = useUploadLimitStore.getState();
      expect(state.errors).toHaveLength(2);
    });
  });

  describe('closeModal', () => {
    it('should close modal', () => {
      const errors: LimitExceededError[] = [
        {
          type: 'file_count',
          message: 'Too many files',
          actual: 15000,
          limit: 10000,
          unit: 'files',
        },
      ];

      useUploadLimitStore.getState().showErrors(errors);
      expect(useUploadLimitStore.getState().isModalOpen).toBe(true);

      useUploadLimitStore.getState().closeModal();
      expect(useUploadLimitStore.getState().isModalOpen).toBe(false);
    });

    it('should preserve errors after close (for reference)', () => {
      const errors: LimitExceededError[] = [
        {
          type: 'file_count',
          message: 'Too many files',
          actual: 15000,
          limit: 10000,
          unit: 'files',
        },
      ];

      useUploadLimitStore.getState().showErrors(errors);
      useUploadLimitStore.getState().closeModal();

      // Errors are preserved until reset
      expect(useUploadLimitStore.getState().errors).toEqual(errors);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const errors: LimitExceededError[] = [
        {
          type: 'file_count',
          message: 'Too many files',
          actual: 15000,
          limit: 10000,
          unit: 'files',
        },
      ];

      useUploadLimitStore.getState().showErrors(errors);
      useUploadLimitStore.getState().reset();

      const state = useUploadLimitStore.getState();
      expect(state.isModalOpen).toBe(false);
      expect(state.errors).toEqual([]);
    });
  });

  describe('resetUploadLimitStore', () => {
    it('should reset store (test utility)', () => {
      useUploadLimitStore.getState().showErrors([
        {
          type: 'file_count',
          message: 'Too many files',
          actual: 15000,
          limit: 10000,
          unit: 'files',
        },
      ]);

      resetUploadLimitStore();

      const state = useUploadLimitStore.getState();
      expect(state.isModalOpen).toBe(false);
      expect(state.errors).toEqual([]);
    });
  });
});
