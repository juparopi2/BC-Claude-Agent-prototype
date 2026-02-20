/**
 * Folder Duplicate Store V2
 *
 * Zustand store for V2 folder-level duplicate detection.
 * Supports skip, replace, keep_both, and cancel actions.
 *
 * @module domains/files/stores/v2/folderDuplicateStoreV2
 */

import { create } from 'zustand';
import type { FolderDuplicateCheckResult } from '@bc-agent/shared';

// ============================================
// Types
// ============================================

export type FolderDuplicateActionV2 = 'skip' | 'replace' | 'keep_both';

export interface FolderDuplicateResolutionV2 {
  tempId: string;
  action: FolderDuplicateActionV2;
  /** For keep_both: the resolved folder name (auto or custom) */
  resolvedName: string;
  /** For replace: the existing folder ID to reuse */
  existingFolderId?: string;
}

export interface FolderDuplicateStoreV2State {
  results: FolderDuplicateCheckResult[];
  resolutions: Map<string, FolderDuplicateResolutionV2>;
  isModalOpen: boolean;
  isCancelled: boolean;
  targetFolderPath: string | null;
}

export interface FolderDuplicateStoreV2Actions {
  setResults: (results: FolderDuplicateCheckResult[], targetFolderPath?: string | null) => void;
  resolveOne: (resolution: FolderDuplicateResolutionV2) => void;
  resolveAllRemaining: (action: FolderDuplicateActionV2) => void;
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

const initialState: FolderDuplicateStoreV2State = {
  results: [],
  resolutions: new Map(),
  isModalOpen: false,
  isCancelled: false,
  targetFolderPath: null,
};

export const useFolderDuplicateStoreV2 = create<FolderDuplicateStoreV2State & FolderDuplicateStoreV2Actions>()(
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
            const resolution: FolderDuplicateResolutionV2 = {
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

export function resetFolderDuplicateStoreV2(): void {
  useFolderDuplicateStoreV2.setState({ ...initialState, resolutions: new Map() });
}
