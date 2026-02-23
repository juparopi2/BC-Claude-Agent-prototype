/**
 * useUploadProgress Hook
 *
 * Derived selectors from uploadBatchStore for UI consumption.
 * Exports a pure function `computeBatchProgress` for per-batch progress
 * and a convenience hook for single-batch usage.
 *
 * @module domains/files/hooks/useUploadProgress
 */

import { useMemo } from 'react';
import { useBatchUploadStore } from '../stores/uploadBatchStore';
import type { BatchFileState } from '../stores/uploadBatchStore';
import { useShallow } from 'zustand/react/shallow';
import { PIPELINE_STATUS } from '@bc-agent/shared';

export type UploadPhase = 'preparing' | 'uploading' | 'processing' | 'completed' | 'failed';

export interface UploadCounts {
  total: number;
  uploaded: number;
  confirmed: number;
  processing: number;
  ready: number;
  failed: number;
}

export interface UploadProgress {
  overallProgress: number;
  uploadProgress: number;
  counts: UploadCounts;
  currentPhase: UploadPhase;
}

const EMPTY_PROGRESS: UploadProgress = {
  overallProgress: 0,
  uploadProgress: 0,
  counts: { total: 0, uploaded: 0, confirmed: 0, processing: 0, ready: 0, failed: 0 },
  currentPhase: 'uploading',
};

/**
 * Pure function that computes progress metrics from a files Map.
 * Can be used by BatchProgressCard with useMemo.
 */
export function computeBatchProgress(files: Map<string, BatchFileState>): UploadProgress {
  const fileArray = Array.from(files.values());
  const total = fileArray.length;

  if (total === 0) {
    return EMPTY_PROGRESS;
  }

  const uploaded = fileArray.filter((f) => f.uploadProgress >= 100).length;
  const confirmed = fileArray.filter((f) => f.confirmed).length;
  const ready = fileArray.filter((f) => f.pipelineStatus === PIPELINE_STATUS.READY).length;
  const failed = fileArray.filter((f) => f.error != null).length;
  const processing = fileArray.filter(
    (f) =>
      f.confirmed &&
      f.pipelineStatus !== PIPELINE_STATUS.READY &&
      f.pipelineStatus !== PIPELINE_STATUS.FAILED &&
      !f.error
  ).length;

  const uploadProgress = Math.round((uploaded / total) * 100);
  const overallProgress = Math.round((ready / total) * 100);

  let currentPhase: UploadPhase = 'uploading';
  if (failed > 0 && failed + ready === total) {
    currentPhase = 'failed';
  } else if (ready === total) {
    currentPhase = 'completed';
  } else if (uploaded === total) {
    currentPhase = 'processing';
  }

  return {
    overallProgress,
    uploadProgress,
    counts: { total, uploaded, confirmed, processing, ready, failed },
    currentPhase,
  };
}

/**
 * Convenience hook that aggregates progress across all batches.
 * Useful for global upload status indicators.
 */
export function useUploadProgress(): UploadProgress {
  const batches = useBatchUploadStore(useShallow((s) => s.batches));

  return useMemo(() => {
    // Merge all files from all batches into a single Map for aggregate progress
    const allFiles = new Map<string, BatchFileState>();
    for (const entry of batches.values()) {
      for (const [fileId, file] of entry.files) {
        allFiles.set(fileId, file);
      }
    }
    return computeBatchProgress(allFiles);
  }, [batches]);
}
