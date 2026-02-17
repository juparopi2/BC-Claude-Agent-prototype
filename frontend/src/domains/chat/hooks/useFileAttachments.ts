/**
 * useFileAttachments Hook
 *
 * Manages file attachment uploads with progress tracking.
 * Uses Uppy + @uppy/xhr-upload for multipart FormData uploads.
 *
 * @module domains/chat/hooks/useFileAttachments
 */

import { useState, useMemo, useCallback } from 'react';
import { useSessionStore } from '@/src/domains/session/stores/sessionStore';
import { createFormUploadUppy } from '@/src/infrastructure/upload';
import { toast } from 'sonner';

export interface Attachment {
  /** Temporary ID for tracking before upload completes */
  tempId: string;
  /** Original file name */
  name: string;
  /** MIME type */
  type: string;
  /** File size in bytes */
  size: number;
  /** Upload status */
  status: 'pending' | 'uploading' | 'completed' | 'error';
  /** Upload progress (0-100) */
  progress: number;
  /** Server-assigned file ID after successful upload */
  fileId?: string;
  /** Error message if upload failed */
  error?: string;
}

export interface UseFileAttachmentsResult {
  /** Current list of attachments */
  attachments: Attachment[];
  /** Upload a file and track its progress */
  uploadFile: (file: File) => Promise<void>;
  /** Remove an attachment by tempId */
  removeAttachment: (tempId: string) => void;
  /** Clear all attachments */
  clearAttachments: () => void;
  /** List of file IDs for completed uploads */
  completedFileIds: string[];
  /** Whether any uploads are in progress */
  hasUploading: boolean;
}

/**
 * Hook for managing file attachments with upload progress
 */
export function useFileAttachments(): UseFileAttachmentsResult {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const uploadFile = useCallback(async (file: File) => {
    const tempId = crypto.randomUUID();

    // Add attachment with uploading status
    setAttachments(prev => [...prev, {
      tempId,
      name: file.name,
      type: file.type,
      size: file.size,
      status: 'uploading',
      progress: 0,
    }]);

    const sessionId = useSessionStore.getState().currentSession?.id;
    const uppy = createFormUploadUppy({ concurrency: 1 });

    uppy.addFile({
      name: file.name,
      type: file.type || 'application/octet-stream',
      data: file,
      meta: {
        queueItemId: tempId,
        sessionId: sessionId ?? undefined,
      },
    });

    uppy.on('upload-progress', (_f, progress) => {
      if (progress.bytesTotal && progress.bytesTotal > 0) {
        const pct = Math.round((progress.bytesUploaded / progress.bytesTotal) * 100);
        setAttachments(prev => prev.map(a =>
          a.tempId === tempId ? { ...a, progress: pct } : a
        ));
      }
    });

    uppy.on('upload-success', (_f, response) => {
      const body = response?.body as unknown as { files?: Array<{ id: string }> } | undefined;
      const uploadedFile = body?.files?.[0];
      if (uploadedFile) {
        setAttachments(prev => prev.map(a =>
          a.tempId === tempId
            ? { ...a, status: 'completed', fileId: uploadedFile.id, progress: 100 }
            : a
        ));
      } else {
        setAttachments(prev => prev.map(a =>
          a.tempId === tempId
            ? { ...a, status: 'error', error: 'Upload succeeded but no file returned', progress: 0 }
            : a
        ));
        toast.error(`Failed to upload ${file.name}`);
      }
      uppy.destroy();
    });

    uppy.on('upload-error', (_f, error) => {
      setAttachments(prev => prev.map(a =>
        a.tempId === tempId
          ? { ...a, status: 'error', error: 'Upload failed', progress: 0 }
          : a
      ));
      toast.error(`Failed to upload ${file.name}`);
      uppy.destroy();
    });

    await uppy.upload();
  }, []);

  const removeAttachment = useCallback((tempId: string) => {
    setAttachments(prev => prev.filter(a => a.tempId !== tempId));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const completedFileIds = useMemo(
    () => attachments
      .filter(a => a.status === 'completed' && a.fileId)
      .map(a => a.fileId!),
    [attachments]
  );

  const hasUploading = useMemo(
    () => attachments.some(a => a.status === 'uploading'),
    [attachments]
  );

  return {
    attachments,
    uploadFile,
    removeAttachment,
    clearAttachments,
    completedFileIds,
    hasUploading,
  };
}
