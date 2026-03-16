/**
 * Duplicate Resolution Stores
 *
 * Merged module containing both file and folder duplicate resolution stores.
 * The two stores share common structural patterns (setResults, isAllResolved,
 * cancel, reset, getSkippedTempIds) while differing in their resolution types
 * and store-specific getter utilities.
 *
 * Previously split across duplicateStore.ts and folderDuplicateStore.ts.
 *
 * @module domains/files/stores/duplicateResolutionStore
 */

import { create } from 'zustand';
import type { DuplicateCheckResult, FolderDuplicateCheckResult } from '@bc-agent/shared';

// ============================================
// File Duplicate Store Types
// ============================================

export type DuplicateAction = 'skip' | 'replace' | 'keep';

export interface DuplicateStoreState {
  results: DuplicateCheckResult[];
  resolutions: Map<string, DuplicateAction>;
  isModalOpen: boolean;
  isCancelled: boolean;
  targetFolderPath: string | null;
}

export interface DuplicateStoreActions {
  setResults: (results: DuplicateCheckResult[], targetFolderPath?: string | null) => void;
  resolveOne: (tempId: string, action: DuplicateAction) => void;
  resolveAllRemaining: (action: DuplicateAction) => void;
  isAllResolved: () => boolean;
  getSkippedTempIds: () => string[];
  getKeepRenames: () => Map<string, string>;
  getReplacementTargets: () => Map<string, string>;
  closeModal: () => void;
  cancel: () => void;
  reset: () => void;
}

// ============================================
// Folder Duplicate Store Types
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
// File Duplicate Store
// ============================================

const fileDuplicateInitialState: DuplicateStoreState = {
  results: [],
  resolutions: new Map(),
  isModalOpen: false,
  isCancelled: false,
  targetFolderPath: null,
};

export const useDuplicateStore = create<DuplicateStoreState & DuplicateStoreActions>()(
  (set, get) => ({
    ...fileDuplicateInitialState,

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

    resolveOne: (tempId, action) => {
      set((state) => {
        const resolutions = new Map(state.resolutions);
        resolutions.set(tempId, action);

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
            resolutions.set(dup.tempId, action);
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
      resolutions.forEach((action, tempId) => {
        if (action === 'skip') {
          skipped.push(tempId);
        }
      });
      return skipped;
    },

    getKeepRenames: () => {
      const { results, resolutions } = get();
      const renames = new Map<string, string>();
      for (const result of results) {
        if (
          result.isDuplicate &&
          resolutions.get(result.tempId) === 'keep' &&
          result.suggestedName
        ) {
          renames.set(result.tempId, result.suggestedName);
        }
      }
      return renames;
    },

    getReplacementTargets: () => {
      const { results, resolutions } = get();
      const replacements = new Map<string, string>();
      for (const result of results) {
        if (
          result.isDuplicate &&
          resolutions.get(result.tempId) === 'replace' &&
          result.existingFile
        ) {
          replacements.set(result.tempId, result.existingFile.fileId);
        }
      }
      return replacements;
    },

    closeModal: () => set({ isModalOpen: false }),

    cancel: () => set({ isModalOpen: false, isCancelled: true }),

    reset: () => set({ ...fileDuplicateInitialState, resolutions: new Map() }),
  })
);

export function resetDuplicateStore(): void {
  useDuplicateStore.setState({ ...fileDuplicateInitialState, resolutions: new Map() });
}

// ============================================
// Folder Duplicate Store
// ============================================

const folderDuplicateInitialState: FolderDuplicateStoreState = {
  results: [],
  resolutions: new Map(),
  isModalOpen: false,
  isCancelled: false,
  targetFolderPath: null,
};

export const useFolderDuplicateStore = create<FolderDuplicateStoreState & FolderDuplicateStoreActions>()(
  (set, get) => ({
    ...folderDuplicateInitialState,

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

    reset: () => set({ ...folderDuplicateInitialState, resolutions: new Map() }),
  })
);

export function resetFolderDuplicateStore(): void {
  useFolderDuplicateStore.setState({ ...folderDuplicateInitialState, resolutions: new Map() });
}
