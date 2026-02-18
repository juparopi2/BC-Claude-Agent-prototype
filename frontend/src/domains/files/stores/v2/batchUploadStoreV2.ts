/**
 * Batch Upload Store V2
 *
 * Zustand store for V2 batch upload state.
 * Tracks batch metadata, per-file upload progress, and pipeline status.
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

export interface BatchUploadState {
  activeBatch: ActiveBatch | null;
  files: Map<string, BatchFileState>;
  isUploading: boolean;
  isPaused: boolean;
  error: string | null;
}

export interface BatchUploadActions {
  setActiveBatch: (response: CreateBatchResponse, fileNames: Map<string, string>) => void;
  updateFileUploadProgress: (fileId: string, progress: number) => void;
  updateFilePipelineStatus: (fileId: string, status: PipelineStatus) => void;
  markFileConfirmed: (fileId: string, batchProgress: BatchProgress) => void;
  markFileFailed: (fileId: string, error: string) => void;
  setPaused: (paused: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

// ============================================
// Store
// ============================================

const initialState: BatchUploadState = {
  activeBatch: null,
  files: new Map(),
  isUploading: false,
  isPaused: false,
  error: null,
};

export const useBatchUploadStoreV2 = create<BatchUploadState & BatchUploadActions>()(
  (set) => ({
    ...initialState,

    setActiveBatch: (response, fileNames) => {
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

      set({
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
    },

    updateFileUploadProgress: (fileId, progress) => {
      set((state) => {
        const files = new Map(state.files);
        const file = files.get(fileId);
        if (file) {
          files.set(fileId, { ...file, uploadProgress: progress });
        }
        return { files };
      });
    },

    updateFilePipelineStatus: (fileId, status) => {
      set((state) => {
        const files = new Map(state.files);
        const file = files.get(fileId);
        if (file) {
          files.set(fileId, { ...file, pipelineStatus: status });
        }
        return { files };
      });
    },

    markFileConfirmed: (fileId, batchProgress) => {
      set((state) => {
        const files = new Map(state.files);
        const file = files.get(fileId);
        if (file) {
          files.set(fileId, { ...file, confirmed: true, uploadProgress: 100 });
        }

        const isComplete = batchProgress.isComplete;
        return {
          files,
          activeBatch: state.activeBatch
            ? {
                ...state.activeBatch,
                confirmedCount: batchProgress.confirmed,
                status: isComplete ? 'completed' : state.activeBatch.status,
              }
            : null,
          isUploading: !isComplete,
        };
      });
    },

    markFileFailed: (fileId, error) => {
      set((state) => {
        const files = new Map(state.files);
        const file = files.get(fileId);
        if (file) {
          files.set(fileId, { ...file, error });
        }
        return { files };
      });
    },

    setPaused: (paused) => set({ isPaused: paused }),

    setError: (error) => set({ error }),

    reset: () => set({ ...initialState, files: new Map() }),
  })
);

export function resetBatchUploadStoreV2(): void {
  useBatchUploadStoreV2.setState({ ...initialState, files: new Map() });
}
