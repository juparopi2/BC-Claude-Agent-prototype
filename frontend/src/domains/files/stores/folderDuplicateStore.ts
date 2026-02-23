/**
 * Folder Duplicate Store
 *
 * Zustand store for folder-level duplicate detection.
 * Supports skip, replace, keep_both, and cancel actions.
 *
 * @module domains/files/stores/folderDuplicateStore
 */

import { create } from 'zustand';
import type { FolderDuplicateCheckResult } from '@bc-agent/shared';

// ============================================
// Types
// ============================================

export type FolderDuplicateAction = 'skip' | 'replace' | 'keep_both';

export interface FolderDuplicateResolution {
  tempId: string;
  action: FolderDuplicateAction;
  /** For keep_both: the resolved folder name (auto or custom) */
  resolvedName: string;
  /** For replace: the existing folder ID to reuse */
  existingFolderId?: string;
}

export interface FolderDuplicateStoreState {
  results: FolderDuplicateCheckResult[];
  resolutions: Map<string, FolderDuplicateResolution>;
  isModalOpen: boolean;
  isCancelled: boolean;
  targetFolderPath: string | null;
}

export interface FolderDuplicateStoreActions {
  setResults: (results: FolderDuplicateCheckResult[], targetFolderPath?: string | null) => void;
  resolveOne: (resolution: FolderDuplicateResolution) => void;
  resolveAllRemaining: (action: FolderDuplicateAction) => void;
  isAllResolved: () => boolean;
  getSkippedTempIds: () => string[];
  getKeepBothRenames: () => Map<string, string>;
  getReplaceFolderIds: () => Map<string, string>;
  cancel: () => void;
  reset: () => void;
}

// ============================================
// Store
// ============================================

const initialState: FolderDuplicateStoreState = {
  results: [],
  resolutions: new Map(),
  isModalOpen: false,
  isCancelled: false,
  targetFolderPath: null,
};

export const useFolderDuplicateStore = create<FolderDuplicateStoreState & FolderDuplicateStoreActions>()(
  (set, get) => ({
    ...initialState,

    setResults: (results, targetFolderPath) => {
      const duplicates = results.filter((r) => r.isDuplicate);
      set({
        results,
        resolutions: new Map(),
        isCancelled: false,
        isModalOpen: duplicates.length > 0,
        targetFolderPath: targetFolderPath ?? null,
      });
    },

    resolveOne: (resolution) => {
      set((state) => {
        const resolutions = new Map(state.resolutions);
        resolutions.set(resolution.tempId, resolution);

        const duplicates = state.results.filter((r) => r.isDuplicate);
        const allResolved = duplicates.every((r) => resolutions.has(r.tempId));

        return {
          resolutions,
          isModalOpen: !allResolved,
        };
      });
    },

    resolveAllRemaining: (action) => {
      set((state) => {
        const resolutions = new Map(state.resolutions);
        const duplicates = state.results.filter((r) => r.isDuplicate);

        for (const dup of duplicates) {
          if (!resolutions.has(dup.tempId)) {
            const resolution: FolderDuplicateResolution = {
              tempId: dup.tempId,
              action,
              resolvedName: action === 'keep_both'
                ? (dup.suggestedName ?? dup.folderName)
                : dup.folderName,
              ...(action === 'replace' && dup.existingFolderId
                ? { existingFolderId: dup.existingFolderId }
                : {}),
            };
            resolutions.set(dup.tempId, resolution);
          }
        }

        return {
          resolutions,
          isModalOpen: false,
        };
      });
    },

    isAllResolved: () => {
      const { results, resolutions, isCancelled } = get();
      if (isCancelled) return true;
      const duplicates = results.filter((r) => r.isDuplicate);
      if (duplicates.length === 0) return true;
      return duplicates.every((r) => resolutions.has(r.tempId));
    },

    getSkippedTempIds: () => {
      const { resolutions } = get();
      const skipped: string[] = [];
      resolutions.forEach((res) => {
        if (res.action === 'skip') {
          skipped.push(res.tempId);
        }
      });
      return skipped;
    },

    getKeepBothRenames: () => {
      const { resolutions } = get();
      const renames = new Map<string, string>();
      resolutions.forEach((res) => {
        if (res.action === 'keep_both') {
          renames.set(res.tempId, res.resolvedName);
        }
      });
      return renames;
    },

    getReplaceFolderIds: () => {
      const { resolutions } = get();
      const replaceIds = new Map<string, string>();
      resolutions.forEach((res) => {
        if (res.action === 'replace' && res.existingFolderId) {
          replaceIds.set(res.tempId, res.existingFolderId);
        }
      });
      return replaceIds;
    },

    cancel: () => set({ isModalOpen: false, isCancelled: true }),

    reset: () => set({ ...initialState, resolutions: new Map() }),
  })
);

export function resetFolderDuplicateStore(): void {
  useFolderDuplicateStore.setState({ ...initialState, resolutions: new Map() });
}
