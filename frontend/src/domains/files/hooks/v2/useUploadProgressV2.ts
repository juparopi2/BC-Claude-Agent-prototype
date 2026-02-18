/**
 * useUploadProgressV2 Hook
 *
 * Derived selectors from batchUploadStoreV2 for UI consumption.
 *
 * @module domains/files/hooks/v2/useUploadProgressV2
 */

import { useMemo } from 'react';
import { useBatchUploadStoreV2 } from '../../stores/v2/batchUploadStoreV2';
import { useShallow } from 'zustand/react/shallow';
import { PIPELINE_STATUS } from '@bc-agent/shared';

export type UploadPhaseV2 = 'preparing' | 'uploading' | 'processing' | 'completed' | 'failed';

export interface UploadCountsV2 {
  total: number;
  uploaded: number;
  confirmed: number;
  processing: number;
  ready: number;
  failed: number;
}

export interface UploadProgressV2 {
  overallProgress: number;
  uploadProgress: number;
  counts: UploadCountsV2;
  currentPhase: UploadPhaseV2;
}

/**
 * Hook that computes derived progress metrics from the batch upload store
 */
export function useUploadProgressV2(): UploadProgressV2 {
  const files = useBatchUploadStoreV2(useShallow((s) => s.files));

  return useMemo(() => {
    const fileArray = Array.from(files.values());
    const total = fileArray.length;

    if (total === 0) {
      return {
        overallProgress: 0,
        uploadProgress: 0,
        counts: { total: 0, uploaded: 0, confirmed: 0, processing: 0, ready: 0, failed: 0 },
        currentPhase: 'uploading' as UploadPhaseV2,
      };
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

    let currentPhase: UploadPhaseV2 = 'uploading';
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
  }, [files]);
}
