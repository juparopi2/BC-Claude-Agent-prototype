/**
 * Batch Upload Store V2
 *
 * Zustand store for V2 batch upload state.
 * Supports multiple concurrent batches, each tracked independently.
 *
 * @module domains/files/stores/v2/batchUploadStoreV2
 */

import { create } from 'zustand';
import type {
  CreateBatchResponse,
  BatchProgress,
  PipelineStatus,
} from '@bc-agent/shared';

// ============================================
// Types
// ============================================

export interface BatchFileState {
  fileId: string;
  tempId: string;
  fileName: string;
  /** Blob upload progress 0-100 */
  uploadProgress: number;
  /** Pipeline processing status (null until confirmed) */
  pipelineStatus: PipelineStatus | null;
  /** Error message if upload or processing failed */
  error?: string;
  /** Whether blob upload is confirmed */
  confirmed: boolean;
}

export interface ActiveBatch {
  batchId: string;
  status: string;
  totalFiles: number;
  confirmedCount: number;
  expiresAt: string;
}

export interface PreparingState {
  fileCount: number;
  hasFolders: boolean;
}

export type BatchPhase = 'preparing' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface BatchEntry {
  batchKey: string;
  phase: BatchPhase;
  preparing: PreparingState | null;
  activeBatch: ActiveBatch | null;
  files: Map<string, BatchFileState>;
  isUploading: boolean;
  isPaused: boolean;
  error: string | null;
  createdAt: number;
}

export interface BatchUploadState {
  batches: Map<string, BatchEntry>;
  hasActiveUploads: boolean;
}

export interface BatchUploadActions {
  addPreparing: (batchKey: string, fileCount: number, hasFolders: boolean) => void;
  activateBatch: (batchKey: string, response: CreateBatchResponse, fileNames: Map<string, string>) => void;
  updateFileUploadProgress: (batchKey: string, fileId: string, progress: number) => void;
  updateFilePipelineStatus: (batchKey: string, fileId: string, status: PipelineStatus) => void;
  markFileConfirmed: (batchKey: string, fileId: string, batchProgress: BatchProgress) => void;
  markFileFailed: (batchKey: string, fileId: string, error: string) => void;
  setPaused: (batchKey: string, paused: boolean) => void;
  setError: (batchKey: string, error: string | null) => void;
  removeBatch: (batchKey: string) => void;
  /** Find owner batch by fileId and update pipeline status */
  updateFilePipelineStatusByFileId: (fileId: string, status: PipelineStatus) => void;
  /** Find owner batch by fileId and mark failed */
  markFileFailedByFileId: (fileId: string, error: string) => void;
  /** Check if a fileId belongs to any batch */
  hasFileId: (fileId: string) => boolean;
  reset: () => void;
}

// ============================================
// Helpers
// ============================================

function computeHasActiveUploads(batches: Map<string, BatchEntry>): boolean {
  for (const entry of batches.values()) {
    if (entry.phase === 'preparing' || entry.phase === 'active') {
      return true;
    }
  }
  return false;
}

function findBatchByFileId(batches: Map<string, BatchEntry>, fileId: string): BatchEntry | undefined {
  for (const entry of batches.values()) {
    if (entry.files.has(fileId)) {
      return entry;
    }
  }
  return undefined;
}

// ============================================
// Store
// ============================================

const initialState: BatchUploadState = {
  batches: new Map(),
  hasActiveUploads: false,
};

export const useBatchUploadStoreV2 = create<BatchUploadState & BatchUploadActions>()(
  (set, get) => ({
    ...initialState,

    addPreparing: (batchKey, fileCount, hasFolders) =>
      set((state) => {
        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, {
          batchKey,
          phase: 'preparing',
          preparing: { fileCount, hasFolders },
          activeBatch: null,
          files: new Map(),
          isUploading: false,
          isPaused: false,
          error: null,
          createdAt: Date.now(),
        });
        return {
          batches: newBatches,
          hasActiveUploads: true,
        };
      }),

    activateBatch: (batchKey, response, fileNames) => {
      set((state) => {
        const existing = state.batches.get(batchKey);
        if (!existing) return state;

        const files = new Map<string, BatchFileState>();
        for (const f of response.files) {
          files.set(f.fileId, {
            fileId: f.fileId,
            tempId: f.tempId,
            fileName: fileNames.get(f.tempId) ?? f.tempId,
            uploadProgress: 0,
            pipelineStatus: null,
            confirmed: false,
          });
        }

        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, {
          ...existing,
          phase: 'active',
          preparing: null,
          activeBatch: {
            batchId: response.batchId,
            status: response.status,
            totalFiles: response.files.length,
            confirmedCount: 0,
            expiresAt: response.expiresAt,
          },
          files,
          isUploading: true,
          isPaused: false,
          error: null,
        });

        return {
          batches: newBatches,
          hasActiveUploads: computeHasActiveUploads(newBatches),
        };
      });
    },

    updateFileUploadProgress: (batchKey, fileId, progress) => {
      set((state) => {
        const entry = state.batches.get(batchKey);
        if (!entry) return state;

        const file = entry.files.get(fileId);
        if (!file) return state;

        const newFiles = new Map(entry.files);
        newFiles.set(fileId, { ...file, uploadProgress: progress });

        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, { ...entry, files: newFiles });

        return { batches: newBatches };
      });
    },

    updateFilePipelineStatus: (batchKey, fileId, status) => {
      set((state) => {
        const entry = state.batches.get(batchKey);
        if (!entry) return state;

        const file = entry.files.get(fileId);
        if (!file) return state;

        const newFiles = new Map(entry.files);
        newFiles.set(fileId, { ...file, pipelineStatus: status });

        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, { ...entry, files: newFiles });

        return { batches: newBatches };
      });
    },

    markFileConfirmed: (batchKey, fileId, batchProgress) => {
      set((state) => {
        const entry = state.batches.get(batchKey);
        if (!entry) return state;

        const file = entry.files.get(fileId);
        if (!file) return state;

        const newFiles = new Map(entry.files);
        newFiles.set(fileId, { ...file, confirmed: true, uploadProgress: 100 });

        const isComplete = batchProgress.isComplete;
        const newEntry: BatchEntry = {
          ...entry,
          files: newFiles,
          activeBatch: entry.activeBatch
            ? {
                ...entry.activeBatch,
                confirmedCount: batchProgress.confirmed,
                status: isComplete ? 'completed' : entry.activeBatch.status,
              }
            : null,
          isUploading: !isComplete,
          phase: isComplete ? 'completed' : entry.phase,
        };

        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, newEntry);

        return {
          batches: newBatches,
          hasActiveUploads: computeHasActiveUploads(newBatches),
        };
      });
    },

    markFileFailed: (batchKey, fileId, error) => {
      set((state) => {
        const entry = state.batches.get(batchKey);
        if (!entry) return state;

        const file = entry.files.get(fileId);
        if (!file) return state;

        const newFiles = new Map(entry.files);
        newFiles.set(fileId, { ...file, error });

        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, { ...entry, files: newFiles });

        return { batches: newBatches };
      });
    },

    setPaused: (batchKey, paused) => {
      set((state) => {
        const entry = state.batches.get(batchKey);
        if (!entry) return state;

        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, { ...entry, isPaused: paused });

        return { batches: newBatches };
      });
    },

    setError: (batchKey, error) => {
      set((state) => {
        const entry = state.batches.get(batchKey);
        if (!entry) return state;

        const newBatches = new Map(state.batches);
        newBatches.set(batchKey, {
          ...entry,
          error,
          phase: error ? 'failed' : entry.phase,
        });

        return {
          batches: newBatches,
          hasActiveUploads: computeHasActiveUploads(newBatches),
        };
      });
    },

    removeBatch: (batchKey) => {
      set((state) => {
        const newBatches = new Map(state.batches);
        newBatches.delete(batchKey);

        return {
          batches: newBatches,
          hasActiveUploads: computeHasActiveUploads(newBatches),
        };
      });
    },

    updateFilePipelineStatusByFileId: (fileId, status) => {
      const entry = findBatchByFileId(get().batches, fileId);
      if (entry) {
        get().updateFilePipelineStatus(entry.batchKey, fileId, status);
      }
    },

    markFileFailedByFileId: (fileId, error) => {
      const entry = findBatchByFileId(get().batches, fileId);
      if (entry) {
        get().markFileFailed(entry.batchKey, fileId, error);
      }
    },

    hasFileId: (fileId) => {
      return findBatchByFileId(get().batches, fileId) !== undefined;
    },

    reset: () => set({ batches: new Map(), hasActiveUploads: false }),
  })
);

export function resetBatchUploadStoreV2(): void {
  useBatchUploadStoreV2.setState({ batches: new Map(), hasActiveUploads: false });
}
