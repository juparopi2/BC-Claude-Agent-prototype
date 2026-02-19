/**
 * Duplicate Store V2
 *
 * Zustand store for V2 three-scope duplicate detection.
 * Supports storage, pipeline, and upload scope with match type info.
 *
 * @module domains/files/stores/v2/duplicateStoreV2
 */

import { create } from 'zustand';
import type { DuplicateCheckResultV2 } from '@bc-agent/shared';

// ============================================
// Types
// ============================================

export type DuplicateActionV2 = 'skip' | 'replace' | 'keep';

export interface DuplicateStoreV2State {
  results: DuplicateCheckResultV2[];
  resolutions: Map<string, DuplicateActionV2>;
  isModalOpen: boolean;
  isCancelled: boolean;
  targetFolderPath: string | null;
}

export interface DuplicateStoreV2Actions {
  setResults: (results: DuplicateCheckResultV2[], targetFolderPath?: string | null) => void;
  resolveOne: (tempId: string, action: DuplicateActionV2) => void;
  resolveAllRemaining: (action: DuplicateActionV2) => void;
  isAllResolved: () => boolean;
  getSkippedTempIds: () => string[];
  getKeepRenames: () => Map<string, string>;
  getReplacementTargets: () => Map<string, string>;
  closeModal: () => void;
  cancel: () => void;
  reset: () => void;
}

// ============================================
// Store
// ============================================

const initialState: DuplicateStoreV2State = {
  results: [],
  resolutions: new Map(),
  isModalOpen: false,
  isCancelled: false,
  targetFolderPath: null,
};

export const useDuplicateStoreV2 = create<DuplicateStoreV2State & DuplicateStoreV2Actions>()(
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

    reset: () => set({ ...initialState, resolutions: new Map() }),
  })
);

export function resetDuplicateStoreV2(): void {
  useDuplicateStoreV2.setState({ ...initialState, resolutions: new Map() });
}
