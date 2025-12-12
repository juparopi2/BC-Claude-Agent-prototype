/**
 * filePreviewStore Tests
 *
 * Tests for the file preview Zustand store.
 * TDD: Tests written FIRST (RED phase) before implementation.
 *
 * @module __tests__/stores/filePreviewStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useFilePreviewStore, resetFilePreviewStore } from '@/lib/stores/filePreviewStore';

describe('filePreviewStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    resetFilePreviewStore();
  });

  describe('initial state', () => {
    it('should have isOpen as false initially', () => {
      const state = useFilePreviewStore.getState();
      expect(state.isOpen).toBe(false);
    });

    it('should have fileId as null initially', () => {
      const state = useFilePreviewStore.getState();
      expect(state.fileId).toBeNull();
    });

    it('should have fileName as null initially', () => {
      const state = useFilePreviewStore.getState();
      expect(state.fileName).toBeNull();
    });

    it('should have mimeType as null initially', () => {
      const state = useFilePreviewStore.getState();
      expect(state.mimeType).toBeNull();
    });
  });

  describe('openPreview', () => {
    it('should set isOpen to true', () => {
      const { openPreview } = useFilePreviewStore.getState();
      openPreview('file-123', 'document.pdf', 'application/pdf');

      const state = useFilePreviewStore.getState();
      expect(state.isOpen).toBe(true);
    });

    it('should set fileId correctly', () => {
      const { openPreview } = useFilePreviewStore.getState();
      openPreview('file-456', 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

      const state = useFilePreviewStore.getState();
      expect(state.fileId).toBe('file-456');
    });

    it('should set fileName correctly', () => {
      const { openPreview } = useFilePreviewStore.getState();
      openPreview('file-789', 'photo.jpg', 'image/jpeg');

      const state = useFilePreviewStore.getState();
      expect(state.fileName).toBe('photo.jpg');
    });

    it('should set mimeType correctly', () => {
      const { openPreview } = useFilePreviewStore.getState();
      openPreview('file-abc', 'data.json', 'application/json');

      const state = useFilePreviewStore.getState();
      expect(state.mimeType).toBe('application/json');
    });
  });

  describe('closePreview', () => {
    it('should set isOpen to false', () => {
      const { openPreview, closePreview } = useFilePreviewStore.getState();

      // First open
      openPreview('file-123', 'document.pdf', 'application/pdf');
      expect(useFilePreviewStore.getState().isOpen).toBe(true);

      // Then close
      closePreview();
      expect(useFilePreviewStore.getState().isOpen).toBe(false);
    });

    it('should clear fileId', () => {
      const { openPreview, closePreview } = useFilePreviewStore.getState();

      openPreview('file-123', 'document.pdf', 'application/pdf');
      closePreview();

      expect(useFilePreviewStore.getState().fileId).toBeNull();
    });

    it('should clear fileName', () => {
      const { openPreview, closePreview } = useFilePreviewStore.getState();

      openPreview('file-123', 'document.pdf', 'application/pdf');
      closePreview();

      expect(useFilePreviewStore.getState().fileName).toBeNull();
    });

    it('should clear mimeType', () => {
      const { openPreview, closePreview } = useFilePreviewStore.getState();

      openPreview('file-123', 'document.pdf', 'application/pdf');
      closePreview();

      expect(useFilePreviewStore.getState().mimeType).toBeNull();
    });
  });

  describe('resetFilePreviewStore', () => {
    it('should reset all state to initial values', () => {
      const { openPreview } = useFilePreviewStore.getState();

      // Open preview
      openPreview('file-123', 'document.pdf', 'application/pdf');

      // Reset
      resetFilePreviewStore();

      const state = useFilePreviewStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.fileId).toBeNull();
      expect(state.fileName).toBeNull();
      expect(state.mimeType).toBeNull();
    });
  });
});
