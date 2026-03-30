/**
 * File Health Store
 *
 * Tracks problematic files (failed, stuck, blob-missing) for the
 * FileHealthWarning UI. Populated by useFileHealth hook via
 * GET /api/files/health/issues.
 *
 * @module domains/files/stores/fileHealthStore
 */

import { create } from 'zustand';
import type { FileHealthIssue, FileHealthIssuesResponse } from '@bc-agent/shared';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface FileHealthState {
  issues: FileHealthIssue[];
  summary: FileHealthIssuesResponse['summary'] | null;
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  /** True while a backend reconciliation is in progress (login or manual). */
  isReconciling: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface FileHealthActions {
  /** Replace the full issue list + summary (after a fetch). */
  setIssues: (issues: FileHealthIssue[], summary: FileHealthIssuesResponse['summary']) => void;

  /** Optimistically remove a single issue after retry or delete. */
  removeIssue: (fileId: string) => void;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setReconciling: (value: boolean) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: FileHealthState = {
  issues: [],
  summary: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  isReconciling: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFileHealthStore = create<FileHealthState & FileHealthActions>()((set) => ({
  ...INITIAL_STATE,

  setIssues: (issues, summary) =>
    set({
      issues,
      summary,
      error: null,
      lastFetchedAt: Date.now(),
    }),

  removeIssue: (fileId) =>
    set((state) => {
      const updated = state.issues.filter((i) => i.fileId !== fileId);
      const summary = state.summary
        ? {
            externalNotFound: updated.filter((i) => i.issueType === 'external_not_found').length,
            retryExhausted: updated.filter((i) => i.issueType === 'retry_exhausted').length,
            blobMissing: updated.filter((i) => i.issueType === 'blob_missing').length,
            failedRetriable: updated.filter((i) => i.issueType === 'failed_retriable').length,
            stuckProcessing: updated.filter((i) => i.issueType === 'stuck_processing').length,
            total: updated.length,
          }
        : null;
      return { issues: updated, summary };
    }),

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setReconciling: (value) => set({ isReconciling: value }),
  reset: () => set(INITIAL_STATE),
}));

// ---------------------------------------------------------------------------
// Reset (for tests)
// ---------------------------------------------------------------------------

export function resetFileHealthStore(): void {
  useFileHealthStore.setState(INITIAL_STATE);
}
