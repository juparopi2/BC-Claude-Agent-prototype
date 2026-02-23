/**
 * computeBatchProgress Tests
 *
 * Validates the pure function that computes upload progress from a files Map.
 *
 * @module __tests__/domains/files/hooks/computeBatchProgress
 */

import { describe, it, expect } from 'vitest';
import { computeBatchProgress } from '@/src/domains/files/hooks/useUploadProgress';
import type { BatchFileState } from '@/src/domains/files/stores/uploadBatchStore';
import { PIPELINE_STATUS } from '@bc-agent/shared';

function makeFile(overrides: Partial<BatchFileState> & { fileId: string }): BatchFileState {
  return {
    tempId: overrides.fileId,
    fileName: `${overrides.fileId}.pdf`,
    uploadProgress: 0,
    pipelineStatus: null,
    confirmed: false,
    ...overrides,
  };
}

function makeFilesMap(files: BatchFileState[]): Map<string, BatchFileState> {
  return new Map(files.map((f) => [f.fileId, f]));
}

describe('computeBatchProgress', () => {
  it('returns zero progress for empty files map', () => {
    const result = computeBatchProgress(new Map());

    expect(result.overallProgress).toBe(0);
    expect(result.uploadProgress).toBe(0);
    expect(result.counts.total).toBe(0);
    expect(result.currentPhase).toBe('uploading');
  });

  it('computes uploading phase when files are still uploading', () => {
    const files = makeFilesMap([
      makeFile({ fileId: 'F1', uploadProgress: 50 }),
      makeFile({ fileId: 'F2', uploadProgress: 100 }),
    ]);

    const result = computeBatchProgress(files);

    expect(result.uploadProgress).toBe(50); // 1 of 2 uploaded
    expect(result.counts.uploaded).toBe(1);
    expect(result.counts.total).toBe(2);
    expect(result.currentPhase).toBe('uploading');
  });

  it('computes processing phase when all files uploaded but not ready', () => {
    const files = makeFilesMap([
      makeFile({ fileId: 'F1', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.EXTRACTING }),
      makeFile({ fileId: 'F2', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.EXTRACTING }),
    ]);

    const result = computeBatchProgress(files);

    expect(result.uploadProgress).toBe(100);
    expect(result.overallProgress).toBe(0);
    expect(result.counts.processing).toBe(2);
    expect(result.currentPhase).toBe('processing');
  });

  it('computes completed phase when all files are ready', () => {
    const files = makeFilesMap([
      makeFile({ fileId: 'F1', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.READY }),
      makeFile({ fileId: 'F2', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.READY }),
    ]);

    const result = computeBatchProgress(files);

    expect(result.overallProgress).toBe(100);
    expect(result.counts.ready).toBe(2);
    expect(result.currentPhase).toBe('completed');
  });

  it('computes failed phase when remaining files are ready or failed', () => {
    const files = makeFilesMap([
      makeFile({ fileId: 'F1', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.READY }),
      makeFile({ fileId: 'F2', uploadProgress: 100, confirmed: true, error: 'Pipeline failed' }),
    ]);

    const result = computeBatchProgress(files);

    expect(result.counts.ready).toBe(1);
    expect(result.counts.failed).toBe(1);
    expect(result.currentPhase).toBe('failed');
  });

  it('remains in uploading phase when mix of uploaded and uploading', () => {
    const files = makeFilesMap([
      makeFile({ fileId: 'F1', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.READY }),
      makeFile({ fileId: 'F2', uploadProgress: 30 }),
      makeFile({ fileId: 'F3', uploadProgress: 0 }),
    ]);

    const result = computeBatchProgress(files);

    expect(result.counts.uploaded).toBe(1);
    expect(result.counts.ready).toBe(1);
    expect(result.currentPhase).toBe('uploading');
  });

  it('counts confirmed files that are processing (not ready, not failed)', () => {
    const files = makeFilesMap([
      makeFile({ fileId: 'F1', uploadProgress: 100, confirmed: true, pipelineStatus: null }),
      makeFile({ fileId: 'F2', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.EXTRACTING }),
      makeFile({ fileId: 'F3', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.READY }),
    ]);

    const result = computeBatchProgress(files);

    expect(result.counts.processing).toBe(2); // F1 (null status, confirmed) + F2 (extracting)
    expect(result.counts.ready).toBe(1);
    expect(result.currentPhase).toBe('processing');
  });

  it('handles single file batch', () => {
    const files = makeFilesMap([
      makeFile({ fileId: 'F1', uploadProgress: 100, confirmed: true, pipelineStatus: PIPELINE_STATUS.READY }),
    ]);

    const result = computeBatchProgress(files);

    expect(result.overallProgress).toBe(100);
    expect(result.uploadProgress).toBe(100);
    expect(result.counts.total).toBe(1);
    expect(result.currentPhase).toBe('completed');
  });
});
