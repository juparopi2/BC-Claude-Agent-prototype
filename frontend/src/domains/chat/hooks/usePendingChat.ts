/**
 * usePendingChat Hook
 *
 * Combines pendingChatStore and pendingFileManager to provide
 * a unified interface for managing new chat creation with files.
 *
 * @module domains/chat/hooks/usePendingChat
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  usePendingChatStore,
  getPendingChatStore,
  type PendingFileInfo,
} from '../stores/pendingChatStore';
import { pendingFileManager } from '../services/pendingFileManager';
import { useSessionStore } from '@/src/domains/session';
import { useUIPreferencesStore } from '@/src/domains/ui';

// ============================================================================
// Types
// ============================================================================

/**
 * Return type for usePendingChat hook
 */
export interface UsePendingChatReturn {
  // State (from store)
  /** User message to send */
  message: string;
  /** Whether extended thinking is enabled (persisted in UIPreferencesStore) */
  enableThinking: boolean;
  /** Whether to search user's files for context */
  useMyContext: boolean;
  /** Selected agent ID ('auto' or AGENT_ID value) */
  selectedAgentId: string;
  /** Metadata for pending files */
  pendingFiles: PendingFileInfo[];
  /** Whether there's a pending chat ready to process */
  hasPendingChat: boolean;

  // Actions
  /** Set the message text */
  setMessage: (msg: string) => void;
  /** Toggle extended thinking (persisted in UIPreferencesStore) */
  setEnableThinking: (enabled: boolean) => void;
  /** Toggle semantic search on user files */
  setUseMyContext: (enabled: boolean) => void;
  /** Set selected agent ID */
  setSelectedAgentId: (agentId: string) => void;
  /** Add a file to pending (returns tempId) */
  addFile: (file: File) => string;
  /** Remove a file by tempId */
  removeFile: (tempId: string) => void;

  // Submit flow
  /** Submit: creates session and navigates. Returns sessionId or null on error */
  submit: () => Promise<string | null>;
  /** Clear all pending state */
  clear: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing pending chat state and file uploads.
 *
 * Use this on the /new page to:
 * 1. Collect message and options from user
 * 2. Allow file attachments before session exists
 * 3. Create session and navigate to /chat/[sessionId]
 *
 * The chat page will then:
 * 1. Detect hasPendingChat
 * 2. Upload files using the session's attachment API
 * 3. Send the message with attachments
 * 4. Clear pending state
 *
 * @example
 * ```tsx
 * function NewChatPage() {
 *   const {
 *     message,
 *     pendingFiles,
 *     setMessage,
 *     addFile,
 *     removeFile,
 *     submit,
 *   } = usePendingChat();
 *
 *   const handleSend = async () => {
 *     const sessionId = await submit();
 *     // If successful, navigation happens automatically
 *   };
 *
 *   return (
 *     <div>
 *       <input value={message} onChange={(e) => setMessage(e.target.value)} />
 *       <input type="file" onChange={(e) => {
 *         if (e.target.files) addFile(e.target.files[0]);
 *       }} />
 *       <button onClick={handleSend}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function usePendingChat(): UsePendingChatReturn {
  const router = useRouter();
  const createSession = useSessionStore((s) => s.createSession);

  // Store state
  const message = usePendingChatStore((s) => s.message);
  const useMyContext = usePendingChatStore((s) => s.useMyContext);
  const pendingFiles = usePendingChatStore((s) => s.pendingFiles);
  const hasPendingChat = usePendingChatStore((s) => s.hasPendingChat);

  // UI preferences (persisted in localStorage via UIPreferencesStore)
  const enableThinking = useUIPreferencesStore((s) => s.enableThinking);
  const setEnableThinking = useUIPreferencesStore((s) => s.setEnableThinking);
  const selectedAgentId = useUIPreferencesStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUIPreferencesStore((s) => s.setSelectedAgentId);

  // Store actions
  const setMessage = usePendingChatStore((s) => s.setMessage);
  const setUseMyContext = usePendingChatStore((s) => s.setUseMyContext);
  const addPendingFile = usePendingChatStore((s) => s.addPendingFile);
  const removePendingFile = usePendingChatStore((s) => s.removePendingFile);
  const markReady = usePendingChatStore((s) => s.markReady);
  const clearPendingChat = usePendingChatStore((s) => s.clearPendingChat);

  /**
   * Add a file to pending state
   * @param file - File object to add
   * @returns tempId for the file
   */
  const addFile = useCallback(
    (file: File): string => {
      const tempId = crypto.randomUUID().toUpperCase();

      // Add to in-memory manager (holds actual File object)
      pendingFileManager.add(tempId, file);

      // Add metadata to store (serializable, persisted)
      addPendingFile({
        tempId,
        name: file.name,
        size: file.size,
        type: file.type,
      });

      return tempId;
    },
    [addPendingFile]
  );

  /**
   * Remove a file from pending state
   * @param tempId - Temporary ID of the file to remove
   */
  const removeFile = useCallback(
    (tempId: string) => {
      pendingFileManager.remove(tempId);
      removePendingFile(tempId);
    },
    [removePendingFile]
  );

  /**
   * Submit: Create session and navigate to chat page.
   *
   * The chat page will handle:
   * 1. Detecting hasPendingChat
   * 2. Uploading files
   * 3. Sending message
   * 4. Clearing state
   *
   * @returns sessionId on success, null on error
   */
  const submit = useCallback(async (): Promise<string | null> => {
    const store = getPendingChatStore();

    // Validate: need message or files
    if (!store.message.trim() && store.pendingFiles.length === 0) {
      toast.error('Please enter a message or attach a file');
      return null;
    }

    try {
      // 1. Mark state as ready BEFORE session creation
      // This ensures the flag is set even if navigation is slow
      markReady();

      // 2. Create session (title will be auto-generated from first message)
      const session = await createSession(undefined, store.message.trim() || undefined);
      if (!session) {
        throw new Error('Failed to create session');
      }

      // 3. Navigate to chat page
      // Files will be uploaded there once we have sessionId
      router.push(`/chat/${session.id}`);

      return session.id;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create session';
      toast.error(errorMessage);

      // Clear state on error
      clearPendingChat();
      pendingFileManager.clear();

      return null;
    }
  }, [createSession, router, markReady, clearPendingChat]);

  /**
   * Clear all pending state
   */
  const clear = useCallback(() => {
    clearPendingChat();
    pendingFileManager.clear();
  }, [clearPendingChat]);

  return {
    // State
    message,
    enableThinking,
    useMyContext,
    selectedAgentId,
    pendingFiles,
    hasPendingChat,

    // Actions
    setMessage,
    setEnableThinking,
    setUseMyContext,
    setSelectedAgentId,
    addFile,
    removeFile,

    // Submit
    submit,
    clear,
  };
}
