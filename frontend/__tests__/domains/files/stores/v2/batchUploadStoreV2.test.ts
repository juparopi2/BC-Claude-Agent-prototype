/**
 * batchUploadStoreV2 Tests
 *
 * Validates the multi-batch store model: independent batch entries,
 * per-batch mutations, and cross-batch file lookup.
 *
 * @module __tests__/domains/files/stores/v2/batchUploadStoreV2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useBatchUploadStoreV2,
  resetBatchUploadStoreV2,
} from '@/src/domains/files/stores/v2/batchUploadStoreV2';
import type { CreateBatchResponse, BatchProgress, PipelineStatus } from '@bc-agent/shared';
import { PIPELINE_STATUS, BATCH_STATUS } from '@bc-agent/shared';

function getStore() {
  return useBatchUploadStoreV2.getState();
}

function makeBatchResponse(batchId: string, files: { tempId: string; fileId: string }[]): CreateBatchResponse {
  return {
    batchId,
    status: BATCH_STATUS.ACTIVE,
    files: files.map((f) => ({
      tempId: f.tempId,
      fileId: f.fileId,
      sasUrl: `https://blob.test/${f.fileId}`,
      blobPath: `uploads/${f.fileId}`,
    })),
    folders: [],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function makeFileNames(pairs: [string, string][]): Map<string, string> {
  return new Map(pairs);
}

function makeBatchProgress(confirmed: number, total: number): BatchProgress {
  return {
    confirmed,
    total,
    isComplete: confirmed >= total,
  };
}

describe('batchUploadStoreV2', () => {
  beforeEach(() => {
    resetBatchUploadStoreV2();
  });

  // ============================================
  // addPreparing
  // ============================================

  it('addPreparing creates a new entry without affecting existing batches', () => {
    const store = getStore();
    store.addPreparing('batch-1', 3, false);
    store.addPreparing('batch-2', 5, true);

    const state = getStore();
    expect(state.batches.size).toBe(2);

    const b1 = state.batches.get('batch-1')!;
    expect(b1.phase).toBe('preparing');
    expect(b1.preparing?.fileCount).toBe(3);
    expect(b1.preparing?.hasFolders).toBe(false);

    const b2 = state.batches.get('batch-2')!;
    expect(b2.phase).toBe('preparing');
    expect(b2.preparing?.fileCount).toBe(5);
    expect(b2.preparing?.hasFolders).toBe(true);

    expect(state.hasActiveUploads).toBe(true);
  });

  // ============================================
  // activateBatch
  // ============================================

  it('activateBatch transitions only the target entry to active', () => {
    const store = getStore();
    store.addPreparing('batch-1', 2, false);
    store.addPreparing('batch-2', 1, false);

    const response = makeBatchResponse('BATCH-001', [
      { tempId: 'tmp-1', fileId: 'FILE-001' },
      { tempId: 'tmp-2', fileId: 'FILE-002' },
    ]);
    const names = makeFileNames([['tmp-1', 'doc.pdf'], ['tmp-2', 'img.png']]);
    store.activateBatch('batch-1', response, names);

    const state = getStore();
    const b1 = state.batches.get('batch-1')!;
    expect(b1.phase).toBe('active');
    expect(b1.preparing).toBeNull();
    expect(b1.activeBatch?.batchId).toBe('BATCH-001');
    expect(b1.files.size).toBe(2);
    expect(b1.isUploading).toBe(true);

    // batch-2 is unaffected
    const b2 = state.batches.get('batch-2')!;
    expect(b2.phase).toBe('preparing');
    expect(b2.files.size).toBe(0);
  });

  // ============================================
  // updateFileUploadProgress
  // ============================================

  it('updateFileUploadProgress updates only the target batch file', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    const response1 = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', response1, makeFileNames([['t1', 'a.pdf']]));

    store.addPreparing('batch-2', 1, false);
    const response2 = makeBatchResponse('B2', [{ tempId: 't2', fileId: 'F2' }]);
    store.activateBatch('batch-2', response2, makeFileNames([['t2', 'b.pdf']]));

    store.updateFileUploadProgress('batch-1', 'F1', 75);

    const state = getStore();
    expect(state.batches.get('batch-1')!.files.get('F1')!.uploadProgress).toBe(75);
    expect(state.batches.get('batch-2')!.files.get('F2')!.uploadProgress).toBe(0);
  });

  // ============================================
  // markFileConfirmed
  // ============================================

  it('markFileConfirmed updates only the target batch and transitions phase on completion', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    const response = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', response, makeFileNames([['t1', 'a.pdf']]));

    store.addPreparing('batch-2', 1, false);
    const response2 = makeBatchResponse('B2', [{ tempId: 't2', fileId: 'F2' }]);
    store.activateBatch('batch-2', response2, makeFileNames([['t2', 'b.pdf']]));

    store.markFileConfirmed('batch-1', 'F1', makeBatchProgress(1, 1));

    const state = getStore();
    const b1 = state.batches.get('batch-1')!;
    expect(b1.files.get('F1')!.confirmed).toBe(true);
    expect(b1.files.get('F1')!.uploadProgress).toBe(100);
    expect(b1.phase).toBe('completed');
    expect(b1.isUploading).toBe(false);

    // batch-2 still active
    const b2 = state.batches.get('batch-2')!;
    expect(b2.phase).toBe('active');
    expect(b2.isUploading).toBe(true);

    // hasActiveUploads still true because batch-2 is active
    expect(state.hasActiveUploads).toBe(true);
  });

  it('markFileConfirmed does not transition phase when batch is not complete', () => {
    const store = getStore();
    store.addPreparing('batch-1', 2, false);
    const response = makeBatchResponse('B1', [
      { tempId: 't1', fileId: 'F1' },
      { tempId: 't2', fileId: 'F2' },
    ]);
    store.activateBatch('batch-1', response, makeFileNames([['t1', 'a.pdf'], ['t2', 'b.pdf']]));

    store.markFileConfirmed('batch-1', 'F1', makeBatchProgress(1, 2));

    const state = getStore();
    const b1 = state.batches.get('batch-1')!;
    expect(b1.phase).toBe('active');
    expect(b1.isUploading).toBe(true);
    expect(b1.activeBatch?.confirmedCount).toBe(1);
  });

  // ============================================
  // removeBatch
  // ============================================

  it('removeBatch removes only the specified entry', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    store.addPreparing('batch-2', 1, false);

    store.removeBatch('batch-1');

    const state = getStore();
    expect(state.batches.size).toBe(1);
    expect(state.batches.has('batch-1')).toBe(false);
    expect(state.batches.has('batch-2')).toBe(true);
  });

  // ============================================
  // Two concurrent batches — independent state
  // ============================================

  it('two concurrent batches maintain independent state', () => {
    const store = getStore();

    // Create batch 1
    store.addPreparing('batch-1', 2, false);
    const resp1 = makeBatchResponse('B1', [
      { tempId: 't1', fileId: 'F1' },
      { tempId: 't2', fileId: 'F2' },
    ]);
    store.activateBatch('batch-1', resp1, makeFileNames([['t1', 'a.pdf'], ['t2', 'b.pdf']]));

    // Create batch 2
    store.addPreparing('batch-2', 1, true);
    const resp2 = makeBatchResponse('B2', [{ tempId: 't3', fileId: 'F3' }]);
    store.activateBatch('batch-2', resp2, makeFileNames([['t3', 'c.pdf']]));

    // Progress on batch 1 only
    store.updateFileUploadProgress('batch-1', 'F1', 50);
    store.markFileConfirmed('batch-1', 'F1', makeBatchProgress(1, 2));

    // Fail on batch 2
    store.markFileFailed('batch-2', 'F3', 'Network error');

    const state = getStore();

    // batch-1: F1 confirmed, F2 still uploading
    const b1 = state.batches.get('batch-1')!;
    expect(b1.files.get('F1')!.confirmed).toBe(true);
    expect(b1.files.get('F2')!.uploadProgress).toBe(0);
    expect(b1.phase).toBe('active');

    // batch-2: F3 failed
    const b2 = state.batches.get('batch-2')!;
    expect(b2.files.get('F3')!.error).toBe('Network error');
    expect(b2.phase).toBe('active'); // phase doesn't auto-fail from markFileFailed
  });

  // ============================================
  // updateFilePipelineStatusByFileId
  // ============================================

  it('updateFilePipelineStatusByFileId finds the correct batch', () => {
    const store = getStore();

    store.addPreparing('batch-1', 1, false);
    const resp1 = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', resp1, makeFileNames([['t1', 'a.pdf']]));

    store.addPreparing('batch-2', 1, false);
    const resp2 = makeBatchResponse('B2', [{ tempId: 't2', fileId: 'F2' }]);
    store.activateBatch('batch-2', resp2, makeFileNames([['t2', 'b.pdf']]));

    // Update F2 via byFileId (no batchKey needed)
    store.updateFilePipelineStatusByFileId('F2', PIPELINE_STATUS.READY);

    const state = getStore();
    expect(state.batches.get('batch-1')!.files.get('F1')!.pipelineStatus).toBeNull();
    expect(state.batches.get('batch-2')!.files.get('F2')!.pipelineStatus).toBe(PIPELINE_STATUS.READY);
  });

  it('updateFilePipelineStatusByFileId is a no-op for unknown fileId', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    const resp = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', resp, makeFileNames([['t1', 'a.pdf']]));

    // Should not throw
    store.updateFilePipelineStatusByFileId('UNKNOWN', PIPELINE_STATUS.READY);

    const state = getStore();
    expect(state.batches.get('batch-1')!.files.get('F1')!.pipelineStatus).toBeNull();
  });

  // ============================================
  // markFileFailedByFileId
  // ============================================

  it('markFileFailedByFileId finds the correct batch', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    const resp = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', resp, makeFileNames([['t1', 'a.pdf']]));

    store.markFileFailedByFileId('F1', 'Pipeline crash');

    const state = getStore();
    expect(state.batches.get('batch-1')!.files.get('F1')!.error).toBe('Pipeline crash');
  });

  // ============================================
  // hasFileId
  // ============================================

  it('hasFileId returns correct value across batches', () => {
    const store = getStore();

    store.addPreparing('batch-1', 1, false);
    const resp = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', resp, makeFileNames([['t1', 'a.pdf']]));

    expect(store.hasFileId('F1')).toBe(true);
    expect(store.hasFileId('UNKNOWN')).toBe(false);
  });

  // ============================================
  // computeHasActiveUploads
  // ============================================

  it('hasActiveUploads is false when all batches are completed', () => {
    const store = getStore();

    store.addPreparing('batch-1', 1, false);
    const resp = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', resp, makeFileNames([['t1', 'a.pdf']]));
    store.markFileConfirmed('batch-1', 'F1', makeBatchProgress(1, 1));

    const state = getStore();
    expect(state.hasActiveUploads).toBe(false);
  });

  it('hasActiveUploads is true when at least one batch is preparing', () => {
    const store = getStore();
    store.addPreparing('batch-1', 3, false);

    expect(getStore().hasActiveUploads).toBe(true);
  });

  it('hasActiveUploads is true when at least one batch is active', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    const resp = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', resp, makeFileNames([['t1', 'a.pdf']]));

    expect(getStore().hasActiveUploads).toBe(true);
  });

  // ============================================
  // setError
  // ============================================

  it('setError transitions batch to failed phase', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    const resp = makeBatchResponse('B1', [{ tempId: 't1', fileId: 'F1' }]);
    store.activateBatch('batch-1', resp, makeFileNames([['t1', 'a.pdf']]));

    store.setError('batch-1', 'Server error');

    const state = getStore();
    const b1 = state.batches.get('batch-1')!;
    expect(b1.error).toBe('Server error');
    expect(b1.phase).toBe('failed');
    expect(state.hasActiveUploads).toBe(false);
  });

  // ============================================
  // reset
  // ============================================

  it('reset clears all batches', () => {
    const store = getStore();
    store.addPreparing('batch-1', 1, false);
    store.addPreparing('batch-2', 1, false);

    store.reset();

    const state = getStore();
    expect(state.batches.size).toBe(0);
    expect(state.hasActiveUploads).toBe(false);
  });
});
