/**
 * Multi Upload Session Store
 *
 * Zustand store for managing multiple concurrent upload sessions.
 * Enables users to upload multiple folders simultaneously with independent
 * progress tracking for each session.
 *
 * Design:
 * - Pure state management (no API calls)
 * - Multiple sessions tracked by sessionId
 * - Real-time updates via WebSocket events
 * - Each session has independent progress calculation
 *
 * @module domains/files/stores/multiUploadSessionStore
 */

import { create } from 'zustand';
import type {
  UploadSession,
  FolderBatch,
  UploadSessionProgress,
  FolderBatchStatus,
} from '@bc-agent/shared';

/**
 * Phase weights for progress calculation (same as uploadSessionStore)
 */
const PHASE_WEIGHTS: Record<FolderBatchStatus, number> = {
  pending: 0,
  creating: 5,
  registering: 15,
  uploading: 20,
  processing: 100,
  completed: 100,
  failed: 0,
};

/**
 * Compute progress from session
 */
function computeProgress(session: UploadSession): UploadSessionProgress {
  const currentFolder =
    session.currentFolderIndex >= 0 && session.currentFolderIndex < session.folderBatches.length
      ? session.folderBatches[session.currentFolderIndex]!
      : null;

  let totalFiles = 0;
  let uploadedFiles = 0;
  let totalWeight = 0;
  let completedWeight = 0;

  for (const batch of session.folderBatches) {
    totalFiles += batch.totalFiles;
    uploadedFiles += batch.uploadedFiles;
    totalWeight += 100;

    let batchWeight = PHASE_WEIGHTS[batch.status] ?? 0;

    if (batch.status === 'uploading' && batch.totalFiles > 0) {
      const uploadProgress = (batch.uploadedFiles / batch.totalFiles) * 80;
      batchWeight = 20 + uploadProgress;
    }

    completedWeight += batchWeight;
  }

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
 * Multi upload session state
 */
export interface MultiUploadSessionState {
  /** Map of sessionId -> session */
  sessions: Map<string, UploadSession>;

  /** Map of sessionId -> computed progress */
  progressMap: Map<string, UploadSessionProgress>;

  /** Number of active sessions */
  activeCount: number;
}

/**
 * Multi upload session actions
 */
export interface MultiUploadSessionActions {
  /** Add a new session */
  addSession: (session: UploadSession) => void;

  /** Update session fields */
  updateSession: (sessionId: string, updates: Partial<UploadSession>) => void;

  /** Update a specific folder batch in a session */
  updateBatch: (sessionId: string, tempId: string, updates: Partial<FolderBatch>) => void;

  /** Remove a session */
  removeSession: (sessionId: string) => void;

  /** Get a session by ID */
  getSession: (sessionId: string) => UploadSession | undefined;

  /** Get progress for a session */
  getProgress: (sessionId: string) => UploadSessionProgress | undefined;

  /** Get all active sessions */
  getActiveSessions: () => UploadSession[];

  /** Clear all sessions */
  clearAll: () => void;

  /** Reset to initial state */
  reset: () => void;
}

/**
 * Initial state
 */
const initialState: MultiUploadSessionState = {
  sessions: new Map(),
  progressMap: new Map(),
  activeCount: 0,
};

/**
 * Count active sessions
 */
function countActiveSessions(sessions: Map<string, UploadSession>): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.status === 'active' || session.status === 'initializing') {
      count++;
    }
  }
  return count;
}

/**
 * Multi upload session store
 *
 * Manages multiple concurrent upload sessions. Each session has independent
 * progress tracking and can be cancelled without affecting others.
 *
 * @example
 * ```tsx
 * function MultiUploadProgress() {
 *   const { sessions, progressMap, activeCount } = useMultiUploadSessionStore();
 *
 *   return (
 *     <div>
 *       <h3>{activeCount} uploads in progress</h3>
 *       {Array.from(sessions.values()).map(session => {
 *         const progress = progressMap.get(session.id);
 *         return (
 *           <SessionProgress key={session.id} session={session} progress={progress} />
 *         );
 *       })}
 *     </div>
 *   );
 * }
 * ```
 */
export const useMultiUploadSessionStore = create<MultiUploadSessionState & MultiUploadSessionActions>()(
  (set, get) => ({
    ...initialState,

    addSession: (session) => {
      set((state) => {
        const newSessions = new Map(state.sessions);
        newSessions.set(session.id, session);

        const newProgressMap = new Map(state.progressMap);
        newProgressMap.set(session.id, computeProgress(session));

        return {
          sessions: newSessions,
          progressMap: newProgressMap,
          activeCount: countActiveSessions(newSessions),
        };
      });
    },

    updateSession: (sessionId, updates) => {
      set((state) => {
        const existingSession = state.sessions.get(sessionId);
        if (!existingSession) return state;

        const updatedSession = { ...existingSession, ...updates };
        const newSessions = new Map(state.sessions);
        newSessions.set(sessionId, updatedSession);

        const newProgressMap = new Map(state.progressMap);
        newProgressMap.set(sessionId, computeProgress(updatedSession));

        return {
          sessions: newSessions,
          progressMap: newProgressMap,
          activeCount: countActiveSessions(newSessions),
        };
      });
    },

    updateBatch: (sessionId, tempId, updates) => {
      set((state) => {
        const existingSession = state.sessions.get(sessionId);
        if (!existingSession) return state;

        const batchIndex = existingSession.folderBatches.findIndex((b) => b.tempId === tempId);
        if (batchIndex === -1) return state;

        const newBatches = [...existingSession.folderBatches];
        newBatches[batchIndex] = { ...newBatches[batchIndex]!, ...updates };

        const updatedSession = { ...existingSession, folderBatches: newBatches };
        const newSessions = new Map(state.sessions);
        newSessions.set(sessionId, updatedSession);

        const newProgressMap = new Map(state.progressMap);
        newProgressMap.set(sessionId, computeProgress(updatedSession));

        return {
          sessions: newSessions,
          progressMap: newProgressMap,
          activeCount: countActiveSessions(newSessions),
        };
      });
    },

    removeSession: (sessionId) => {
      set((state) => {
        const newSessions = new Map(state.sessions);
        newSessions.delete(sessionId);

        const newProgressMap = new Map(state.progressMap);
        newProgressMap.delete(sessionId);

        return {
          sessions: newSessions,
          progressMap: newProgressMap,
          activeCount: countActiveSessions(newSessions),
        };
      });
    },

    getSession: (sessionId) => {
      return get().sessions.get(sessionId);
    },

    getProgress: (sessionId) => {
      return get().progressMap.get(sessionId);
    },

    getActiveSessions: () => {
      const sessions: UploadSession[] = [];
      for (const session of get().sessions.values()) {
        if (session.status === 'active' || session.status === 'initializing') {
          sessions.push(session);
        }
      }
      return sessions;
    },

    clearAll: () => {
      set(initialState);
    },

    reset: () => {
      set(initialState);
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetMultiUploadSessionStore(): void {
  useMultiUploadSessionStore.setState(initialState);
}
