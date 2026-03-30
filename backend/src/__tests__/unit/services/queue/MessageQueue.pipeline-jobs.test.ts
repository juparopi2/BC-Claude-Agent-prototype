/**
 * UNIT TEST — MessageQueue.removeExistingPipelineJobs + verifyPipelineJobExists
 *
 * Tests the BullMQ dedup fix: removing old completed/failed jobs before re-enqueue,
 * and verifying the new flow was created after enqueue.
 *
 * @module __tests__/unit/services/queue/MessageQueue.pipeline-jobs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock Dependencies
// ============================================================================

const { mockQueueManager, mockLogger } = vi.hoisted(() => {
  return {
    mockQueueManager: {
      getQueue: vi.fn(),
      initializeQueues: vi.fn(),
      closeAll: vi.fn(),
      getQueueName: vi.fn((name: string) => name),
      getAllQueues: vi.fn(() => new Map()),
    },
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => mockLogger),
    },
  };
});

// Mock all external imports
vi.mock('@/infrastructure/queue/core/QueueManager', () => ({
  QueueManager: vi.fn(() => mockQueueManager),
}));

vi.mock('@/infrastructure/queue/core/WorkerRegistry', () => ({
  WorkerRegistry: vi.fn(() => ({
    registerAll: vi.fn(),
    registerWorker: vi.fn(),
    startAll: vi.fn(),
    closeAll: vi.fn(),
    setupWorkerEventHandlers: vi.fn(),
    startHeartbeats: vi.fn(),
    getAllWorkers: vi.fn(() => new Map()),
  })),
}));

vi.mock('@/infrastructure/queue/core/QueueEventManager', () => ({
  QueueEventManager: vi.fn(() => ({
    initialize: vi.fn(),
    initializeEventListeners: vi.fn(),
    closeAll: vi.fn(),
    getQueueEvents: vi.fn(),
  })),
}));

vi.mock('@/infrastructure/queue/core/ScheduledJobManager', () => ({
  ScheduledJobManager: vi.fn(() => ({
    initializeMaintenanceJobs: vi.fn(),
    initializeScheduledJobs: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('@/infrastructure/queue/core/RedisConnectionManager', () => ({
  RedisConnectionManager: vi.fn(() => ({
    waitForReady: vi.fn(),
    getConnectionConfig: vi.fn(() => ({ host: 'localhost', port: 6379 })),
    getClient: vi.fn(() => ({
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => true),
      get: vi.fn(async () => null),
      options: { host: 'localhost', port: 6379, maxRetriesPerRequest: null },
      on: vi.fn(),
      once: vi.fn(),
      status: 'ready',
    })),
    close: vi.fn(),
  })),
}));

vi.mock('@/infrastructure/queue/core/FlowProducerManager', () => ({
  FlowProducerManager: vi.fn(() => ({
    addFlow: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('@/infrastructure/queue/core/RateLimiter', () => ({
  RateLimiter: vi.fn(() => ({
    checkLimit: vi.fn(async () => true),
    getStatus: vi.fn(),
  })),
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => mockLogger),
}));

vi.mock('@/infrastructure/database/execute-query', () => ({
  getExecuteQuery: vi.fn(),
}));

vi.mock('@/infrastructure/database/event-store', () => ({
  getEventStore: vi.fn(),
}));

// Mock all worker factories that MessageQueue.initializeWorkers() imports
const mockWorkerProcess = vi.fn();
const workerMock = { process: mockWorkerProcess };
vi.mock('@/infrastructure/queue/workers/MessagePersistenceWorker', () => ({
  getMessagePersistenceWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/ToolExecutionWorker', () => ({
  getToolExecutionWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/EventProcessingWorker', () => ({
  getEventProcessingWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/UsageAggregationWorker', () => ({
  UsageAggregationWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/CitationPersistenceWorker', () => ({
  getCitationPersistenceWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/FileExtractWorker', () => ({
  FileExtractWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/FileChunkWorker', () => ({
  FileChunkWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/FileEmbedWorker', () => ({
  FileEmbedWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/FilePipelineCompleteWorker', () => ({
  FilePipelineCompleteWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/FileDeletionWorker', () => ({
  FileDeletionWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/ExternalFileSyncWorker', () => ({
  ExternalFileSyncWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/MaintenanceWorker', () => ({
  MaintenanceWorker: vi.fn(() => workerMock),
}));
vi.mock('@/infrastructure/queue/workers/SubscriptionRenewalWorker', () => ({
  SubscriptionRenewalWorker: vi.fn(() => workerMock),
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockJob(jobId: string, state = 'completed') {
  return {
    id: jobId,
    remove: vi.fn(),
    getState: vi.fn(async () => state),
  };
}

function createMockQueue() {
  return {
    getJob: vi.fn(),
    remove: vi.fn(),
    add: vi.fn(),
    getJobCounts: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('MessageQueue.removeExistingPipelineJobs', () => {
  let MessageQueue: typeof import('@/infrastructure/queue/MessageQueue').MessageQueue;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/infrastructure/queue/MessageQueue');
    MessageQueue = mod.MessageQueue;
  });

  it('should call queue.getJob and job.remove for all 4 pipeline stages', async () => {
    const mq = new MessageQueue();
    // Force ready state
    (mq as unknown as { isReady: boolean }).isReady = true;

    const fileId = 'FILE-123';
    const extractJob = createMockJob(`extract--${fileId}`);
    const chunkJob = createMockJob(`chunk--${fileId}`);
    const embedJob = createMockJob(`embed--${fileId}`);
    const completeJob = createMockJob(`pipeline-complete--${fileId}`);

    const extractQueue = createMockQueue();
    const chunkQueue = createMockQueue();
    const embedQueue = createMockQueue();
    const completeQueue = createMockQueue();

    extractQueue.getJob.mockResolvedValue(extractJob);
    chunkQueue.getJob.mockResolvedValue(chunkJob);
    embedQueue.getJob.mockResolvedValue(embedJob);
    completeQueue.getJob.mockResolvedValue(completeJob);

    mockQueueManager.getQueue
      .mockReturnValueOnce(extractQueue)    // file-extract
      .mockReturnValueOnce(chunkQueue)      // file-chunk
      .mockReturnValueOnce(embedQueue)      // file-embed
      .mockReturnValueOnce(completeQueue);  // file-pipeline-complete

    await mq.removeExistingPipelineJobs(fileId);

    expect(extractQueue.getJob).toHaveBeenCalledWith(`extract--${fileId}`);
    expect(chunkQueue.getJob).toHaveBeenCalledWith(`chunk--${fileId}`);
    expect(embedQueue.getJob).toHaveBeenCalledWith(`embed--${fileId}`);
    expect(completeQueue.getJob).toHaveBeenCalledWith(`pipeline-complete--${fileId}`);

    expect(extractJob.remove).toHaveBeenCalledOnce();
    expect(chunkJob.remove).toHaveBeenCalledOnce();
    expect(embedJob.remove).toHaveBeenCalledOnce();
    expect(completeJob.remove).toHaveBeenCalledOnce();
  });

  it('should handle non-existent jobs gracefully (getJob returns null)', async () => {
    const mq = new MessageQueue();
    (mq as unknown as { isReady: boolean }).isReady = true;

    const queue = createMockQueue();
    queue.getJob.mockResolvedValue(null); // Job doesn't exist
    mockQueueManager.getQueue.mockReturnValue(queue);

    await expect(mq.removeExistingPipelineJobs('FILE-GONE')).resolves.toBeUndefined();
    expect(queue.getJob).toHaveBeenCalledTimes(4); // Still checked all 4
  });

  it('should continue removing other stages when one throws', async () => {
    const mq = new MessageQueue();
    (mq as unknown as { isReady: boolean }).isReady = true;

    const failingJob = createMockJob('extract--FILE-ERR');
    failingJob.remove.mockRejectedValue(new Error('Redis timeout'));

    const okJob = createMockJob('chunk--FILE-ERR');

    const failQueue = createMockQueue();
    failQueue.getJob.mockResolvedValue(failingJob);

    const okQueue = createMockQueue();
    okQueue.getJob.mockResolvedValue(okJob);

    mockQueueManager.getQueue
      .mockReturnValueOnce(failQueue)  // extract fails
      .mockReturnValueOnce(okQueue)    // chunk succeeds
      .mockReturnValueOnce(okQueue)    // embed succeeds
      .mockReturnValueOnce(okQueue);   // complete succeeds

    await expect(mq.removeExistingPipelineJobs('FILE-ERR')).resolves.toBeUndefined();

    // The failing job's remove was attempted
    expect(failingJob.remove).toHaveBeenCalledOnce();
    // The ok job's remove was also called (not aborted)
    expect(okJob.remove).toHaveBeenCalledTimes(3);
  });

  it('should skip when queue is not found', async () => {
    const mq = new MessageQueue();
    (mq as unknown as { isReady: boolean }).isReady = true;

    mockQueueManager.getQueue.mockReturnValue(undefined);

    await expect(mq.removeExistingPipelineJobs('FILE-NO-QUEUE')).resolves.toBeUndefined();
    // No getJob calls since queues returned undefined
  });
});

describe('MessageQueue.verifyPipelineJobExists', () => {
  let MessageQueue: typeof import('@/infrastructure/queue/MessageQueue').MessageQueue;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/infrastructure/queue/MessageQueue');
    MessageQueue = mod.MessageQueue;
  });

  it('should return true when extract job exists', async () => {
    const mq = new MessageQueue();
    (mq as unknown as { isReady: boolean }).isReady = true;

    const queue = createMockQueue();
    const job = createMockJob('extract--FILE-OK');
    queue.getJob.mockResolvedValue(job);
    mockQueueManager.getQueue.mockReturnValue(queue);

    const result = await mq.verifyPipelineJobExists('FILE-OK');

    expect(result).toBe(true);
    expect(queue.getJob).toHaveBeenCalledWith('extract--FILE-OK');
  });

  it('should return false when extract job does not exist', async () => {
    const mq = new MessageQueue();
    (mq as unknown as { isReady: boolean }).isReady = true;

    const queue = createMockQueue();
    queue.getJob.mockResolvedValue(null);
    mockQueueManager.getQueue.mockReturnValue(queue);

    const result = await mq.verifyPipelineJobExists('FILE-GONE');

    expect(result).toBe(false);
  });

  it('should return false and log warn when queue throws', async () => {
    const mq = new MessageQueue();
    (mq as unknown as { isReady: boolean }).isReady = true;

    const queue = createMockQueue();
    queue.getJob.mockRejectedValue(new Error('Redis down'));
    mockQueueManager.getQueue.mockReturnValue(queue);

    const result = await mq.verifyPipelineJobExists('FILE-ERR');

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'FILE-ERR' }),
      expect.stringContaining('Failed to verify'),
    );
  });

  it('should return false when queue is not found', async () => {
    const mq = new MessageQueue();
    (mq as unknown as { isReady: boolean }).isReady = true;

    mockQueueManager.getQueue.mockReturnValue(undefined);

    const result = await mq.verifyPipelineJobExists('FILE-NO-QUEUE');

    expect(result).toBe(false);
  });
});
