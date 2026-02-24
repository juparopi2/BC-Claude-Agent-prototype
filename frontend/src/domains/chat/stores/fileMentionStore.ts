/**
 * File Mention Store
 *
 * Zustand store for managing file/folder mentions in the chat input.
 * Mentions are added via @autocomplete or drag-and-drop from the file panel.
 *
 * @module domains/chat/stores/fileMentionStore
 */

import { create } from 'zustand';
import type { FileMention, FileMentionMode } from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

export interface FileMentionState {
  /** Current file/folder mentions */
  mentions: FileMention[];
}

export interface FileMentionActions {
  /** Add a mention (deduplicates by fileId) */
  addMention: (mention: FileMention) => void;
  /** Remove a mention by fileId */
  removeMention: (fileId: string) => void;
  /** Toggle mention mode between rag_context and direct_vision */
  toggleMode: (fileId: string) => void;
  /** Clear all mentions */
  clearMentions: () => void;
}

export type FileMentionStore = FileMentionState & FileMentionActions;

// ============================================================================
// Store Creation
// ============================================================================

export const useFileMentionStore = create<FileMentionStore>((set) => ({
  mentions: [],

  addMention: (mention) =>
    set((state) => {
      if (state.mentions.some((m) => m.fileId === mention.fileId)) return state;
      return { mentions: [...state.mentions, mention] };
    }),

  removeMention: (fileId) =>
    set((state) => ({
      mentions: state.mentions.filter((m) => m.fileId !== fileId),
    })),

  toggleMode: (fileId) =>
    set((state) => ({
      mentions: state.mentions.map((m) =>
        m.fileId === fileId
          ? { ...m, mode: (m.mode === 'rag_context' ? 'direct_vision' : 'rag_context') as FileMentionMode }
          : m
      ),
    })),

  clearMentions: () => set({ mentions: [] }),
}));

// ============================================================================
// Getter for Non-React Access
// ============================================================================

/**
 * Get the file mention store instance.
 * Use for direct access outside of React components.
 */
export function getFileMentionStore() {
  return useFileMentionStore.getState();
}

/**
 * Reset file mention store (for testing)
 */
export function resetFileMentionStore(): void {
  useFileMentionStore.getState().clearMentions();
}
