/**
 * ProcessingFlowFactory Unit Tests (PRD-04)
 */

import { describe, it, expect } from 'vitest';
import { ProcessingFlowFactory, type FileFlowParams } from '@/infrastructure/queue/flow/ProcessingFlowFactory';
import { QueueName } from '@/infrastructure/queue/constants';

const SAMPLE_PARAMS: FileFlowParams = {
  fileId: 'FILE-0001-0001-0001-000000000001',
  batchId: 'BATCH-0001-0001-0001-000000000001',
  userId: 'USER-0001-0001-0001-000000000001',
  mimeType: 'application/pdf',
  blobPath: 'users/USER-0001/files/test.pdf',
  fileName: 'test.pdf',
};

describe('ProcessingFlowFactory', () => {
  describe('createFileFlow', () => {
    it('should create a flow with correct nesting order', () => {
      const flow = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);

      // Root: pipeline-complete (runs LAST)
      expect(flow.queueName).toBe(QueueName.V2_FILE_PIPELINE_COMPLETE);
      expect(flow.children).toHaveLength(1);

      // Child of root: embed (runs 3rd)
      const embedJob = flow.children![0]!;
      expect(embedJob.queueName).toBe(QueueName.V2_FILE_EMBED);
      expect(embedJob.children).toHaveLength(1);

      // Child of embed: chunk (runs 2nd)
      const chunkJob = embedJob.children![0]!;
      expect(chunkJob.queueName).toBe(QueueName.V2_FILE_CHUNK);
      expect(chunkJob.children).toHaveLength(1);

      // Deepest child: extract (runs FIRST)
      const extractJob = chunkJob.children![0]!;
      expect(extractJob.queueName).toBe(QueueName.V2_FILE_EXTRACT);
      expect(extractJob.children).toBeUndefined();
    });

    it('should populate all data fields on the extract job', () => {
      const flow = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);
      const extractJob = flow.children![0]!.children![0]!.children![0]!;

      expect(extractJob.data).toEqual({
        fileId: SAMPLE_PARAMS.fileId,
        batchId: SAMPLE_PARAMS.batchId,
        userId: SAMPLE_PARAMS.userId,
        mimeType: SAMPLE_PARAMS.mimeType,
        blobPath: SAMPLE_PARAMS.blobPath,
        fileName: SAMPLE_PARAMS.fileName,
      });
    });

    it('should populate minimal data on intermediate jobs', () => {
      const flow = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);

      // pipeline-complete data
      expect(flow.data).toEqual({
        fileId: SAMPLE_PARAMS.fileId,
        batchId: SAMPLE_PARAMS.batchId,
        userId: SAMPLE_PARAMS.userId,
      });

      // embed data
      const embedJob = flow.children![0]!;
      expect(embedJob.data).toEqual({
        fileId: SAMPLE_PARAMS.fileId,
        batchId: SAMPLE_PARAMS.batchId,
        userId: SAMPLE_PARAMS.userId,
      });

      // chunk data includes mimeType
      const chunkJob = embedJob.children![0]!;
      expect(chunkJob.data).toEqual({
        fileId: SAMPLE_PARAMS.fileId,
        batchId: SAMPLE_PARAMS.batchId,
        userId: SAMPLE_PARAMS.userId,
        mimeType: SAMPLE_PARAMS.mimeType,
      });
    });

    it('should set idempotent jobIds on all stages', () => {
      const flow = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);
      const fileId = SAMPLE_PARAMS.fileId;

      expect(flow.opts?.jobId).toBe(`pipeline-complete--${fileId}`);
      expect(flow.children![0]!.opts?.jobId).toBe(`embed--${fileId}`);
      expect(flow.children![0]!.children![0]!.opts?.jobId).toBe(`chunk--${fileId}`);
      expect(flow.children![0]!.children![0]!.children![0]!.opts?.jobId).toBe(`extract--${fileId}`);
    });

    it('should configure retry attempts on all stages', () => {
      const flow = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);

      // pipeline-complete: 2 attempts
      expect(flow.opts?.attempts).toBe(2);

      // embed: 3 attempts
      expect(flow.children![0]!.opts?.attempts).toBe(3);

      // chunk: 3 attempts
      expect(flow.children![0]!.children![0]!.opts?.attempts).toBe(3);

      // extract: 3 attempts
      expect(flow.children![0]!.children![0]!.children![0]!.opts?.attempts).toBe(3);
    });

    it('should configure exponential backoff on all stages', () => {
      const flow = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);

      // extract: 5000ms delay
      const extractOpts = flow.children![0]!.children![0]!.children![0]!.opts;
      expect(extractOpts?.backoff).toEqual({
        type: 'exponential',
        delay: 5000,
      });

      // chunk: 3000ms delay
      const chunkOpts = flow.children![0]!.children![0]!.opts;
      expect(chunkOpts?.backoff).toEqual({
        type: 'exponential',
        delay: 3000,
      });

      // embed: 3000ms delay
      const embedOpts = flow.children![0]!.opts;
      expect(embedOpts?.backoff).toEqual({
        type: 'exponential',
        delay: 3000,
      });
    });

    it('should produce the same flow for the same params (deterministic)', () => {
      const flow1 = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);
      const flow2 = ProcessingFlowFactory.createFileFlow(SAMPLE_PARAMS);

      expect(flow1).toEqual(flow2);
    });
  });
});
