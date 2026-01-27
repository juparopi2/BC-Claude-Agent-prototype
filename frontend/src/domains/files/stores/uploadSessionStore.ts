/**
 * Upload Session Store
 *
 * Zustand store for managing folder-based upload session state.
 * Tracks upload progress by folder instead of arbitrary batches.
 *
 * Design:
 * - Pure state management (no API calls)
 * - Folder-by-folder progress tracking
 * - Real-time updates via WebSocket events
 *
 * @module domains/files/stores/uploadSessionStore
 */

import { create } from 'zustand';
import type {
  UploadSession,
  FolderBatch,
  UploadSessionStatus,
  FolderBatchStatus,
  UploadSessionProgress,
} from '@bc-agent/shared';

/**
 * Upload session state
 */
export interface UploadSessionState {
  /** Current upload session (null if no active session) */
  session: UploadSession | null;

  /** Whether upload is in progress */
  isActive: boolean;

  /** Computed progress information */
  progress: UploadSessionProgress | null;
}

/**
 * Upload session actions
 */
export interface UploadSessionActions {
  /** Set the current session */
  setSession: (session: UploadSession) => void;

  /** Update session fields */
  updateSession: (updates: Partial<UploadSession>) => void;

  /** Update a specific folder batch */
  updateBatch: (tempId: string, updates: Partial<FolderBatch>) => void;

  /** Set session status */
  setStatus: (status: UploadSessionStatus) => void;

  /** Set current folder index */
  setCurrentFolderIndex: (index: number) => void;

  /** Increment completed folders */
  incrementCompletedFolders: () => void;

  /** Increment failed folders */
  incrementFailedFolders: () => void;

  /** Clear session (completed or aborted) */
  clearSession: () => void;

  /** Reset to initial state */
  reset: () => void;

  /** Get current folder being processed */
  getCurrentFolder: () => FolderBatch | null;

  /** Get progress as percentage */
  getOverallPercent: () => number;
}

/**
 * Initial state
 */
const initialState: UploadSessionState = {
  session: null,
  isActive: false,
  progress: null,
};

/**
 * Phase weights for progress calculation
 *
 * Each folder batch goes through phases. We weight progress to show
 * movement during setup phases (creating folder, registering files)
 * before actual blob uploads begin.
 *
 * Weight distribution per folder (out of 100):
 * - pending: 0% (not started)
 * - creating: 5% (folder being created in DB)
 * - registering: 15% (files being registered - early persistence)
 * - uploading: 20-100% (20% base + 80% proportional to uploadedFiles/totalFiles)
 * - processing: 100% (all files uploaded, processing jobs enqueued)
 * - completed: 100% (done)
 * - failed: 0% (excluded from progress)
 */
const PHASE_WEIGHTS: Record<FolderBatchStatus, number> = {
  pending: 0,
  creating: 5,
  registering: 15,
  uploading: 20, // Base weight, actual upload progress added dynamically
  processing: 100,
  completed: 100,
  failed: 0,
};

/**
 * Compute progress from session
 *
 * Uses phase-weighted progress so the UI shows movement during setup phases
 * (creating folder, registering files) before actual blob uploads begin.
 * This fixes the issue where progress stayed at 0% until files started uploading.
 */
function computeProgress(session: UploadSession | null): UploadSessionProgress | null {
  if (!session) return null;

  const currentFolder =
    session.currentFolderIndex >= 0 && session.currentFolderIndex < session.folderBatches.length
      ? session.folderBatches[session.currentFolderIndex]!
      : null;

  // Calculate totals across ALL batches
  let totalFiles = 0;
  let uploadedFiles = 0;
  let totalWeight = 0;
  let completedWeight = 0;

  for (const batch of session.folderBatches) {
    totalFiles += batch.totalFiles;
    uploadedFiles += batch.uploadedFiles;
    totalWeight += 100; // Each folder contributes 100 points max

    // Get base weight from phase
    let batchWeight = PHASE_WEIGHTS[batch.status] ?? 0;

    // If uploading, add progress based on uploadedFiles within this batch
    if (batch.status === 'uploading' && batch.totalFiles > 0) {
      // 80% of folder progress comes from actual file uploads (20% is base for starting upload phase)
      const uploadProgress = (batch.uploadedFiles / batch.totalFiles) * 80;
      batchWeight = 20 + uploadProgress;
    }

    completedWeight += batchWeight;
  }

  // Calculate overall percentage from weighted progress
  const overallPercent = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;

  return {
    sessionId: session.id,
    currentFolderIndex: session.currentFolderIndex,
    totalFolders: session.totalFolders,
    currentFolder,
    overallPercent,
    completedFolders: session.completedFolders,
    failedFolders: session.failedFolders,
    status: session.status,
    totalFiles,
    uploadedFiles,
  };
}

/**
 * Upload session store
 *
 * Manages folder-based upload session state. Receives updates from
 * WebSocket events via useFolderBatchEvents hook.
 *
 * @example
 * ```tsx
 * function UploadProgress() {
 *   const { session, progress, isActive } = useUploadSessionStore();
 *
 *   if (!isActive || !progress) return null;
 *
 *   return (
 *     <div>
 *       <h3>Folder {progress.currentFolderIndex + 1} of {progress.totalFolders}</h3>
 *       {progress.currentFolder && (
 *         <p>{progress.currentFolder.name}: {progress.currentFolder.uploadedFiles}/{progress.currentFolder.totalFiles}</p>
 *       )}
 *       <ProgressBar value={progress.overallPercent} />
 *     </div>
 *   );
 * }
 * ```
 */
export const useUploadSessionStore = create<UploadSessionState & UploadSessionActions>()(
  (set, get) => ({
    ...initialState,

    setSession: (session) => {
      set({
        session,
        isActive: session.status === 'active' || session.status === 'initializing',
        progress: computeProgress(session),
      });
    },

    updateSession: (updates) => {
      set((state) => {
        if (!state.session) return state;

        const newSession = { ...state.session, ...updates };
        return {
          session: newSession,
          isActive: newSession.status === 'active' || newSession.status === 'initializing',
          progress: computeProgress(newSession),
        };
      });
    },

    updateBatch: (tempId, updates) => {
      set((state) => {
        if (!state.session) return state;

        const batchIndex = state.session.folderBatches.findIndex((b) => b.tempId === tempId);
        if (batchIndex === -1) return state;

        const newBatches = [...state.session.folderBatches];
        newBatches[batchIndex] = { ...newBatches[batchIndex]!, ...updates };

        const newSession = { ...state.session, folderBatches: newBatches };

        return {
          session: newSession,
          progress: computeProgress(newSession),
        };
      });
    },

    setStatus: (status) => {
      set((state) => {
        if (!state.session) return state;

        const newSession = { ...state.session, status };
        const isActive = status === 'active' || status === 'initializing';

        return {
          session: newSession,
          isActive,
          progress: computeProgress(newSession),
        };
      });
    },

    setCurrentFolderIndex: (index) => {
      set((state) => {
        if (!state.session) return state;

        const newSession = { ...state.session, currentFolderIndex: index };

        return {
          session: newSession,
          progress: computeProgress(newSession),
        };
      });
    },

    incrementCompletedFolders: () => {
      set((state) => {
        if (!state.session) return state;

        const newSession = {
          ...state.session,
          completedFolders: state.session.completedFolders + 1,
        };

        return {
          session: newSession,
          progress: computeProgress(newSession),
        };
      });
    },

    incrementFailedFolders: () => {
      set((state) => {
        if (!state.session) return state;

        const newSession = {
          ...state.session,
          failedFolders: state.session.failedFolders + 1,
        };

        return {
          session: newSession,
          progress: computeProgress(newSession),
        };
      });
    },

    clearSession: () => {
      set(initialState);
    },

    reset: () => {
      set(initialState);
    },

    getCurrentFolder: () => {
      const state = get();
      if (!state.session) return null;

      const { session } = state;
      if (session.currentFolderIndex < 0 || session.currentFolderIndex >= session.folderBatches.length) {
        return null;
      }

      return session.folderBatches[session.currentFolderIndex] ?? null;
    },

    getOverallPercent: () => {
      const state = get();
      return state.progress?.overallPercent ?? 0;
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetUploadSessionStore(): void {
  useUploadSessionStore.setState(initialState);
}
