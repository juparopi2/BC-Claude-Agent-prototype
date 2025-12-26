/**
 * useFileAttachments Hook Tests
 *
 * Tests for file attachment management hook.
 * TDD: Tests written FIRST (RED phase).
 *
 * @module __tests__/domains/chat/hooks/useFileAttachments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileAttachments } from '@/src/domains/chat/hooks/useFileAttachments';
import * as fileApiModule from '@/src/infrastructure/api';

// Mock the file API
vi.mock('@/src/infrastructure/api', () => ({
  getFileApiClient: vi.fn(),
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('useFileAttachments', () => {
  let mockUploadFiles: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUploadFiles = vi.fn();
    vi.mocked(fileApiModule.getFileApiClient).mockReturnValue({
      uploadFiles: mockUploadFiles,
      getFileContent: vi.fn(),
      listFiles: vi.fn(),
      moveFiles: vi.fn(),
      moveToTrash: vi.fn(),
    } as unknown as ReturnType<typeof fileApiModule.getFileApiClient>);
  });

  describe('Initial State', () => {
    it('should start with empty attachments', () => {
      const { result } = renderHook(() => useFileAttachments());

      expect(result.current.attachments).toEqual([]);
    });

    it('should have completedFileIds as empty array', () => {
      const { result } = renderHook(() => useFileAttachments());

      expect(result.current.completedFileIds).toEqual([]);
    });

    it('should have hasUploading as false', () => {
      const { result } = renderHook(() => useFileAttachments());

      expect(result.current.hasUploading).toBe(false);
    });
  });

  describe('uploadFile', () => {
    it('should add file on upload start', async () => {
      // Mock slow upload that doesn't resolve immediately
      mockUploadFiles.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      act(() => {
        result.current.uploadFile(file);
      });

      expect(result.current.attachments.length).toBe(1);
      expect(result.current.attachments[0].name).toBe('test.pdf');
      expect(result.current.attachments[0].status).toBe('uploading');
    });

    it('should update progress during upload', async () => {
      let progressCallback: ((progress: number) => void) | undefined;

      mockUploadFiles.mockImplementation((files, folderId, onProgress) => {
        progressCallback = onProgress;
        return new Promise(() => {}); // Never resolves
      });

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      act(() => {
        result.current.uploadFile(file);
      });

      // Simulate progress update
      act(() => {
        progressCallback?.(50);
      });

      expect(result.current.attachments[0].progress).toBe(50);
    });

    it('should mark completed with file ID on success', async () => {
      mockUploadFiles.mockResolvedValue({
        success: true,
        data: {
          files: [{ id: 'file-123', name: 'test.pdf' }],
        },
      });

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadFile(file);
      });

      await waitFor(() => {
        expect(result.current.attachments[0].status).toBe('completed');
        expect(result.current.attachments[0].fileId).toBe('file-123');
        expect(result.current.attachments[0].progress).toBe(100);
      });
    });

    it('should mark error on failure', async () => {
      mockUploadFiles.mockResolvedValue({
        success: false,
        error: { message: 'Upload failed' },
      });

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadFile(file);
      });

      await waitFor(() => {
        expect(result.current.attachments[0].status).toBe('error');
        expect(result.current.attachments[0].error).toBeDefined();
      });
    });

    it('should mark error on exception', async () => {
      mockUploadFiles.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadFile(file);
      });

      await waitFor(() => {
        expect(result.current.attachments[0].status).toBe('error');
      });
    });
  });

  describe('removeAttachment', () => {
    it('should remove attachment by tempId', async () => {
      mockUploadFiles.mockResolvedValue({
        success: true,
        data: { files: [{ id: 'file-123', name: 'test.pdf' }] },
      });

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadFile(file);
      });

      const tempId = result.current.attachments[0].tempId;

      act(() => {
        result.current.removeAttachment(tempId);
      });

      expect(result.current.attachments.length).toBe(0);
    });
  });

  describe('clearAttachments', () => {
    it('should clear all attachments', async () => {
      mockUploadFiles.mockResolvedValue({
        success: true,
        data: { files: [{ id: 'file-123', name: 'test.pdf' }] },
      });

      const { result } = renderHook(() => useFileAttachments());

      // Add multiple files
      await act(async () => {
        await result.current.uploadFile(new File(['1'], 'a.pdf'));
        await result.current.uploadFile(new File(['2'], 'b.pdf'));
      });

      expect(result.current.attachments.length).toBe(2);

      act(() => {
        result.current.clearAttachments();
      });

      expect(result.current.attachments.length).toBe(0);
    });
  });

  describe('Computed Values', () => {
    it('should compute completedFileIds correctly', async () => {
      mockUploadFiles.mockResolvedValue({
        success: true,
        data: { files: [{ id: 'file-abc', name: 'test.pdf' }] },
      });

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadFile(file);
      });

      await waitFor(() => {
        expect(result.current.completedFileIds).toContain('file-abc');
      });
    });

    it('should compute hasUploading correctly', async () => {
      mockUploadFiles.mockReturnValue(new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      expect(result.current.hasUploading).toBe(false);

      act(() => {
        result.current.uploadFile(file);
      });

      expect(result.current.hasUploading).toBe(true);
    });

    it('hasUploading should be false when all completed', async () => {
      mockUploadFiles.mockResolvedValue({
        success: true,
        data: { files: [{ id: 'file-123', name: 'test.pdf' }] },
      });

      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.uploadFile(file);
      });

      await waitFor(() => {
        expect(result.current.hasUploading).toBe(false);
      });
    });
  });

  describe('Multiple Files', () => {
    it('should handle multiple file uploads', async () => {
      mockUploadFiles
        .mockResolvedValueOnce({
          success: true,
          data: { files: [{ id: 'file-1', name: 'a.pdf' }] },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { files: [{ id: 'file-2', name: 'b.pdf' }] },
        });

      const { result } = renderHook(() => useFileAttachments());

      await act(async () => {
        await result.current.uploadFile(new File(['1'], 'a.pdf'));
        await result.current.uploadFile(new File(['2'], 'b.pdf'));
      });

      await waitFor(() => {
        expect(result.current.attachments.length).toBe(2);
        expect(result.current.completedFileIds).toContain('file-1');
        expect(result.current.completedFileIds).toContain('file-2');
      });
    });

    it('should track individual file progress', async () => {
      const progressCallbacks: ((progress: number) => void)[] = [];

      mockUploadFiles.mockImplementation((files, folderId, onProgress) => {
        progressCallbacks.push(onProgress!);
        return new Promise(() => {}); // Never resolves
      });

      const { result } = renderHook(() => useFileAttachments());

      act(() => {
        result.current.uploadFile(new File(['1'], 'a.pdf'));
        result.current.uploadFile(new File(['2'], 'b.pdf'));
      });

      // Update first file progress
      act(() => {
        progressCallbacks[0]?.(30);
      });

      // Update second file progress
      act(() => {
        progressCallbacks[1]?.(60);
      });

      expect(result.current.attachments[0].progress).toBe(30);
      expect(result.current.attachments[1].progress).toBe(60);
    });
  });
});
