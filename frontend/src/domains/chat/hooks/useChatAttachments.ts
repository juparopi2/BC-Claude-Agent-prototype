/**
 * useChatAttachments Hook
 *
 * Manages ephemeral chat attachment uploads with progress tracking.
 * Chat attachments are sent directly to Anthropic as document content blocks
 * (not processed through RAG/embeddings like Knowledge Base files).
 *
 * Key differences from useFileAttachments:
 * - Attachments are ephemeral with TTL (default 24h)
 * - Not indexed or searchable
 * - Sent directly to LLM as document/image blocks
 *
 * @module domains/chat/hooks/useChatAttachments
 */

import { useState, useMemo, useCallback } from 'react';
import { getChatAttachmentApiClient } from '@/src/infrastructure/api';
import type { ParsedChatAttachment } from '@bc-agent/shared';
import { toast } from 'sonner';

/**
 * Chat attachment with upload tracking
 */
export interface ChatAttachment {
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
  /** Server-assigned attachment ID after successful upload */
  attachmentId?: string;
  /** Full attachment data from server */
  attachmentData?: ParsedChatAttachment;
  /** Error message if upload failed */
  error?: string;
}

export interface UseChatAttachmentsResult {
  /** Current list of chat attachments */
  attachments: ChatAttachment[];
  /** Upload a file as chat attachment */
  uploadAttachment: (sessionId: string, file: File) => Promise<void>;
  /** Remove an attachment by tempId */
  removeAttachment: (tempId: string) => void;
  /** Clear all attachments */
  clearAttachments: () => void;
  /** List of attachment IDs for completed uploads (to send with message) */
  completedAttachmentIds: string[];
  /** Whether any uploads are in progress */
  hasUploading: boolean;
  /** Whether there are any attachments (uploading or completed) */
  hasAttachments: boolean;
  /** Total count of attachments */
  attachmentCount: number;
}

/**
 * Hook for managing ephemeral chat attachments with upload progress
 *
 * @example
 * ```tsx
 * const {
 *   attachments,
 *   uploadAttachment,
 *   removeAttachment,
 *   clearAttachments,
 *   completedAttachmentIds,
 *   hasUploading,
 * } = useChatAttachments();
 *
 * // Upload a file
 * const handleFileSelect = (file: File) => {
 *   uploadAttachment(sessionId, file);
 * };
 *
 * // Send message with attachments
 * const handleSend = () => {
 *   socket.emit('chat:message', {
 *     message: text,
 *     sessionId,
 *     chatAttachments: completedAttachmentIds,
 *   });
 *   clearAttachments();
 * };
 * ```
 */
export function useChatAttachments(): UseChatAttachmentsResult {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const uploadAttachment = useCallback(async (sessionId: string, file: File) => {
    const tempId = crypto.randomUUID();

    // Add attachment with uploading status
    const newAttachment: ChatAttachment = {
      tempId,
      name: file.name,
      type: file.type,
      size: file.size,
      status: 'uploading',
      progress: 0,
    };

    setAttachments(prev => [...prev, newAttachment]);

    try {
      const api = getChatAttachmentApiClient();
      const result = await api.uploadAttachment(
        sessionId,
        file,
        (progress) => {
          setAttachments(prev =>
            prev.map(a =>
              a.tempId === tempId ? { ...a, progress } : a
            )
          );
        }
      );

      if (result.success) {
        const uploadedAttachment = result.data.attachment;
        setAttachments(prev =>
          prev.map(a =>
            a.tempId === tempId
              ? {
                  ...a,
                  status: 'completed',
                  attachmentId: uploadedAttachment.id,
                  attachmentData: uploadedAttachment,
                  progress: 100,
                }
              : a
          )
        );
      } else {
        throw new Error(result.error?.message || 'Upload failed');
      }
    } catch (error) {
      console.error('Chat attachment upload error:', error);
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
    // Get the attachment to check if we need to delete from server
    const attachment = attachments.find(a => a.tempId === tempId);

    // Remove from local state immediately
    setAttachments(prev => prev.filter(a => a.tempId !== tempId));

    // If it was uploaded, delete from server (fire and forget)
    if (attachment?.attachmentId) {
      const api = getChatAttachmentApiClient();
      api.deleteAttachment(attachment.attachmentId).catch(error => {
        console.warn('Failed to delete attachment from server:', error);
        // Don't show error to user since local state is already updated
      });
    }
  }, [attachments]);

  const clearAttachments = useCallback(() => {
    // Delete all uploaded attachments from server (fire and forget)
    const api = getChatAttachmentApiClient();
    for (const attachment of attachments) {
      if (attachment.attachmentId) {
        api.deleteAttachment(attachment.attachmentId).catch(error => {
          console.warn('Failed to delete attachment from server:', error);
        });
      }
    }

    setAttachments([]);
  }, [attachments]);

  const completedAttachmentIds = useMemo(
    () => attachments
      .filter(a => a.status === 'completed' && a.attachmentId)
      .map(a => a.attachmentId!),
    [attachments]
  );

  const hasUploading = useMemo(
    () => attachments.some(a => a.status === 'uploading'),
    [attachments]
  );

  const hasAttachments = useMemo(
    () => attachments.length > 0,
    [attachments]
  );

  const attachmentCount = attachments.length;

  return {
    attachments,
    uploadAttachment,
    removeAttachment,
    clearAttachments,
    completedAttachmentIds,
    hasUploading,
    hasAttachments,
    attachmentCount,
  };
}
