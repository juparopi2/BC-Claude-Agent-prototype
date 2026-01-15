/**
 * useFileAttachments Hook
 *
 * Manages file attachment uploads with progress tracking.
 * Extracted from ChatInput.tsx for reusability.
 *
 * @module domains/chat/hooks/useFileAttachments
 */

import { useState, useMemo, useCallback } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useSessionStore } from '@/src/domains/session/stores/sessionStore';
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
    const newAttachment: Attachment = {
      tempId,
      name: file.name,
      type: file.type,
      size: file.size,
      status: 'uploading',
      progress: 0,
    };

    setAttachments(prev => [...prev, newAttachment]);

    try {
      const fileApi = getFileApiClient();
      // Get sessionId for WebSocket event targeting (D25)
      const sessionId = useSessionStore.getState().currentSession?.id;
      const result = await fileApi.uploadFiles([file], undefined, sessionId, (progress) => {
        setAttachments(prev =>
          prev.map(a =>
            a.tempId === tempId ? { ...a, progress } : a
          )
        );
      });

      if (result.success) {
        const uploadedFile = result.data.files[0];
        if (uploadedFile) {
          setAttachments(prev =>
            prev.map(a =>
              a.tempId === tempId
                ? { ...a, status: 'completed', fileId: uploadedFile.id, progress: 100 }
                : a
            )
          );
        } else {
          throw new Error('Upload succeeded but no file returned');
        }
      } else {
        throw new Error(result.error?.message || 'Upload failed');
      }
    } catch (error) {
      console.error('File upload error:', error);
      setAttachments(prev =>
        prev.map(a =>
          a.tempId === tempId
            ? { ...a, status: 'error', error: 'Upload failed', progress: 0 }
            : a
        )
      );
      toast.error(`Failed to upload ${file.name}`);
    }
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
