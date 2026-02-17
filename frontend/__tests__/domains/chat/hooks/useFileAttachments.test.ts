/**
 * useFileAttachments Hook Tests
 *
 * Tests for file attachment management hook.
 * Mocks Uppy factory to control upload behavior.
 *
 * @module __tests__/domains/chat/hooks/useFileAttachments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileAttachments } from '@/src/domains/chat/hooks/useFileAttachments';

// Event handler type for the mock
type EventHandler = (...args: unknown[]) => void;

// Mock Uppy instance
function createMockUppy() {
  const handlers = new Map<string, EventHandler[]>();
  return {
    addFile: vi.fn(() => 'mock-file-id'),
    upload: vi.fn(async () => ({ successful: [], failed: [] })),
    destroy: vi.fn(),
    on: vi.fn((event: string, handler: EventHandler) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    opts: { autoProceed: false, id: 'test' },
    getPlugin: vi.fn(),
    getFiles: vi.fn(() => []),
    cancelAll: vi.fn(),
    _emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
  };
}

// Captured instances
const capturedInstances: ReturnType<typeof createMockUppy>[] = [];

vi.mock('@/src/infrastructure/upload', () => ({
  createFormUploadUppy: vi.fn(() => {
    const instance = createMockUppy();
    capturedInstances.push(instance);
    return instance;
  }),
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// Mock session store
vi.mock('@/src/domains/session/stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({ currentSession: { id: 'test-session' } }),
  },
}));

describe('useFileAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInstances.length = 0;
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
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      // Make upload never resolve so we can check intermediate state
      act(() => {
        result.current.uploadFile(file);
      });

      // The mock was captured
      expect(capturedInstances.length).toBe(1);
      // Override upload to never resolve
      capturedInstances[0].upload.mockReturnValue(new Promise(() => {}));

      expect(result.current.attachments.length).toBe(1);
      expect(result.current.attachments[0].name).toBe('test.pdf');
      expect(result.current.attachments[0].status).toBe('uploading');
    });

    it('should mark completed with file ID on success', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      // Start upload - the mock will be created during this call
      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.uploadFile(file);
      });

      // Now trigger success event on the captured instance
      const mockUppy = capturedInstances[0];
      expect(mockUppy).toBeDefined();

      await act(async () => {
        mockUppy._emit('upload-success', { id: 'mock-file-id' }, {
          body: { files: [{ id: 'file-123', name: 'test.pdf' }] },
        });
        await uploadPromise!;
      });

      await waitFor(() => {
        expect(result.current.attachments[0].status).toBe('completed');
        expect(result.current.attachments[0].fileId).toBe('file-123');
        expect(result.current.attachments[0].progress).toBe(100);
      });
    });

    it('should mark error on upload failure', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.uploadFile(file);
      });

      const mockUppy = capturedInstances[0];

      await act(async () => {
        mockUppy._emit('upload-error', { id: 'mock-file-id' }, new Error('Network error'));
        await uploadPromise!;
      });

      await waitFor(() => {
        expect(result.current.attachments[0].status).toBe('error');
        expect(result.current.attachments[0].error).toBeDefined();
      });
    });

    it('should update progress during upload', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      act(() => {
        result.current.uploadFile(file);
      });

      const mockUppy = capturedInstances[0];
      // Override upload to never resolve
      mockUppy.upload.mockReturnValue(new Promise(() => {}));

      act(() => {
        mockUppy._emit('upload-progress', { id: 'mock-file-id' }, { bytesUploaded: 50, bytesTotal: 100 });
      });

      expect(result.current.attachments[0].progress).toBe(50);
    });
  });

  describe('removeAttachment', () => {
    it('should remove attachment by tempId', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.uploadFile(file);
      });

      const mockUppy = capturedInstances[0];
      await act(async () => {
        mockUppy._emit('upload-success', { id: 'mock-file-id' }, {
          body: { files: [{ id: 'file-123', name: 'test.pdf' }] },
        });
        await uploadPromise!;
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
      const { result } = renderHook(() => useFileAttachments());

      let p1: Promise<void>;
      act(() => {
        p1 = result.current.uploadFile(new File(['1'], 'a.pdf'));
      });

      await act(async () => {
        capturedInstances[0]._emit('upload-success', { id: 'mock-file-id' }, {
          body: { files: [{ id: 'file-1', name: 'a.pdf' }] },
        });
        await p1!;
      });

      let p2: Promise<void>;
      act(() => {
        p2 = result.current.uploadFile(new File(['2'], 'b.pdf'));
      });

      await act(async () => {
        capturedInstances[1]._emit('upload-success', { id: 'mock-file-id' }, {
          body: { files: [{ id: 'file-2', name: 'b.pdf' }] },
        });
        await p2!;
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
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.uploadFile(file);
      });

      await act(async () => {
        capturedInstances[0]._emit('upload-success', { id: 'mock-file-id' }, {
          body: { files: [{ id: 'file-abc', name: 'test.pdf' }] },
        });
        await uploadPromise!;
      });

      await waitFor(() => {
        expect(result.current.completedFileIds).toContain('file-abc');
      });
    });

    it('should compute hasUploading correctly', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      expect(result.current.hasUploading).toBe(false);

      act(() => {
        result.current.uploadFile(file);
      });
      // Override upload to never resolve
      capturedInstances[0].upload.mockReturnValue(new Promise(() => {}));

      expect(result.current.hasUploading).toBe(true);
    });

    it('hasUploading should be false when all completed', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.uploadFile(file);
      });

      await act(async () => {
        capturedInstances[0]._emit('upload-success', { id: 'mock-file-id' }, {
          body: { files: [{ id: 'file-123', name: 'test.pdf' }] },
        });
        await uploadPromise!;
      });

      await waitFor(() => {
        expect(result.current.hasUploading).toBe(false);
      });
    });
  });
});
