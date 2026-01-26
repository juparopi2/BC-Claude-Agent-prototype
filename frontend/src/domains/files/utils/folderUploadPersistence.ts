/**
 * Folder Upload Persistence Utilities
 *
 * Handles localStorage persistence for pause/resume functionality.
 * Stores folder structure and progress state for resuming interrupted uploads.
 *
 * @module domains/files/utils/folderUploadPersistence
 */

import type { PersistedFolderUploadState, FolderStructure } from '../types/folderUpload.types';

/**
 * localStorage key for persisted upload state
 */
const STORAGE_KEY = 'folder-upload-state';

/**
 * Maximum age for persisted state (24 hours)
 * After this time, persisted state is considered stale
 */
const MAX_STATE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Save folder upload state to localStorage
 *
 * @param state - The upload state to persist
 */
export function saveUploadState(state: PersistedFolderUploadState): void {
  try {
    // Create serializable version (FolderStructure contains File objects)
    const serializableState = {
      ...state,
      structure: serializeFolderStructure(state.structure),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState));
  } catch (error) {
    console.error('[FolderUploadPersistence] Failed to save state:', error);
  }
}

/**
 * Load folder upload state from localStorage
 *
 * @returns The persisted state or null if none exists or if stale
 */
export function loadUploadState(): PersistedFolderUploadState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as PersistedFolderUploadState;

    // Check if state is stale
    const pausedAt = new Date(state.pausedAt).getTime();
    const age = Date.now() - pausedAt;
    if (age > MAX_STATE_AGE_MS) {
      clearUploadState();
      return null;
    }

    return state;
  } catch (error) {
    console.error('[FolderUploadPersistence] Failed to load state:', error);
    return null;
  }
}

/**
 * Check if there is a persisted upload state available
 *
 * @returns True if there is a valid persisted state
 */
export function hasPersistedState(): boolean {
  return loadUploadState() !== null;
}

/**
 * Clear persisted upload state
 */
export function clearUploadState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[FolderUploadPersistence] Failed to clear state:', error);
  }
}

/**
 * Serialize folder structure for storage (File objects cannot be stored)
 *
 * Note: This stores metadata only - actual files must be re-selected by user
 * on resume. For true resume, we rely on the fact that folders are already
 * created and only pending file uploads need to be completed.
 */
function serializeFolderStructure(structure: FolderStructure): SerializedFolderStructure {
  return {
    rootFolders: structure.rootFolders,
    totalFiles: structure.totalFiles,
    totalFolders: structure.totalFolders,
    // Store only metadata for files (File objects cannot be serialized)
    allFilesPaths: structure.allFiles.map((f) => ({
      path: f.path,
      name: f.name,
      isValid: f.isValid,
    })),
    validFilesPaths: structure.validFiles.map((f) => f.path),
    invalidFilesPaths: structure.invalidFiles.map((f) => f.path),
  };
}

/**
 * Serialized folder structure (without File objects)
 */
interface SerializedFolderStructure {
  rootFolders: FolderStructure['rootFolders'];
  totalFiles: number;
  totalFolders: number;
  allFilesPaths: Array<{ path: string; name: string; isValid: boolean }>;
  validFilesPaths: string[];
  invalidFilesPaths: string[];
}

/**
 * Get summary of persisted state for UI display
 *
 * @returns Summary or null if no state
 */
export function getPersistedStateSummary(): PersistedStateSummary | null {
  const state = loadUploadState();
  if (!state) return null;

  const totalBatches = state.totalBatches;
  const completedBatches = state.completedBatches.length;
  const progress = Math.round((completedBatches / totalBatches) * 100);

  return {
    megaBatchId: state.megaBatchId,
    totalBatches,
    completedBatches,
    progress,
    pausedAt: state.pausedAt,
    targetFolderId: state.targetFolderId,
  };
}

/**
 * Summary of persisted upload state
 */
export interface PersistedStateSummary {
  megaBatchId: string;
  totalBatches: number;
  completedBatches: number;
  progress: number;
  pausedAt: string;
  targetFolderId: string | null;
}
