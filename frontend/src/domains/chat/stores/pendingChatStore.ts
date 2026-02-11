/**
 * Pending Chat Store
 *
 * Zustand store for managing pending chat state when creating a new session.
 * Stores message, options, and file metadata until navigation to chat page completes.
 *
 * File objects cannot be serialized, so they are stored separately in pendingFileManager.
 * Only metadata (name, size, type) is persisted here.
 *
 * @module domains/chat/stores/pendingChatStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

/**
 * Metadata for a pending file (actual File object stored in pendingFileManager)
 */
export interface PendingFileInfo {
  tempId: string;
  name: string;
  size: number;
  type: string;
}

/**
 * Pending chat state
 */
export interface PendingChatState {
  /** User message to send */
  message: string;

  /** Enable automatic semantic search on user's files */
  useMyContext: boolean;

  // Future options (extensible)

  /** Specific agent to route to (null = auto-route via supervisor) */
  selectedAgent: string | null;

  /** File IDs mentioned via @mentions */
  mentionedFileIds: string[];

  /** Metadata for pending files (actual File objects in pendingFileManager) */
  pendingFiles: PendingFileInfo[];

  /** Flag indicating pending state exists and is ready to process */
  hasPendingChat: boolean;
}

/**
 * Pending chat actions
 */
export interface PendingChatActions {
  setMessage: (message: string) => void;
  setUseMyContext: (enabled: boolean) => void;
  setSelectedAgent: (agent: string | null) => void;
  addMentionedFile: (fileId: string) => void;
  removeMentionedFile: (fileId: string) => void;
  addPendingFile: (file: PendingFileInfo) => void;
  removePendingFile: (tempId: string) => void;
  /** Mark state as ready for processing (sets hasPendingChat = true) */
  markReady: () => void;
  /** Clear all pending state */
  clearPendingChat: () => void;
}

export type PendingChatStore = PendingChatState & PendingChatActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: PendingChatState = {
  message: '',
  useMyContext: false,
  selectedAgent: null,
  mentionedFileIds: [],
  pendingFiles: [],
  hasPendingChat: false,
};

// ============================================================================
// Store Creation
// ============================================================================

export const usePendingChatStore = create<PendingChatStore>()(
  persist(
    (set) => ({
      ...initialState,

      setMessage: (message) => set({ message }),

      setUseMyContext: (enabled) => set({ useMyContext: enabled }),

      setSelectedAgent: (agent) => set({ selectedAgent: agent }),

      addMentionedFile: (fileId) =>
        set((state) => ({
          mentionedFileIds: [...state.mentionedFileIds, fileId],
        })),

      removeMentionedFile: (fileId) =>
        set((state) => ({
          mentionedFileIds: state.mentionedFileIds.filter((id) => id !== fileId),
        })),

      addPendingFile: (file) =>
        set((state) => ({
          pendingFiles: [...state.pendingFiles, file],
        })),

      removePendingFile: (tempId) =>
        set((state) => ({
          pendingFiles: state.pendingFiles.filter((f) => f.tempId !== tempId),
        })),

      markReady: () => set({ hasPendingChat: true }),

      clearPendingChat: () => set(initialState),
    }),
    {
      name: 'pending-chat-storage',
      // Only persist serializable state
      // NOTE: pendingFiles metadata IS persisted, but actual File objects
      // are in pendingFileManager and will be lost on refresh
      partialize: (state) => ({
        message: state.message,
        useMyContext: state.useMyContext,
        selectedAgent: state.selectedAgent,
        mentionedFileIds: state.mentionedFileIds,
        // Include file metadata (but actual File objects are lost on refresh)
        pendingFiles: state.pendingFiles,
        hasPendingChat: state.hasPendingChat,
      }),
    }
  )
);

// ============================================================================
// Getter for Non-React Access
// ============================================================================

/**
 * Get the pending chat store instance.
 * Use for direct access outside of React components.
 */
export function getPendingChatStore() {
  return usePendingChatStore.getState();
}

/**
 * Reset pending chat store (for testing)
 */
export function resetPendingChatStore(): void {
  usePendingChatStore.getState().clearPendingChat();
}
