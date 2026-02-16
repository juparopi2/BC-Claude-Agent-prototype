/**
 * MessagePersistenceWorker Unit Tests
 *
 * Tests the Phase 2 persistence logic and event marking behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ILoggerMinimal, IEventStoreMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';
import type { MessagePersistenceJob } from '@/infrastructure/queue/types';

// ============================================================================
// Mocks
// ============================================================================

const mockPrisma = {
  messages: {
    upsert: vi.fn().mockResolvedValue({}),
  },
};

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => mockLogger),
}));

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(),
}));

const mockLogger: ILoggerMinimal = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

function createMockEventStore(): IEventStoreMinimal {
  return {
    markAsProcessed: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockJob(overrides: Partial<MessagePersistenceJob> = {}): Job<MessagePersistenceJob> {
  const defaultData: MessagePersistenceJob = {
    sessionId: 'TEST-SESSION-ID',
    messageId: 'TEST-MESSAGE-ID',
    role: 'assistant',
    messageType: 'message',
    content: 'Hello world',
    metadata: null,
    sequenceNumber: 1,
    eventId: 'TEST-EVENT-ID',
    userId: 'TEST-USER-ID',
    correlationId: 'TEST-CORRELATION-ID',
    ...overrides,
  };

  return {
    id: 'job-1',
    data: defaultData,
    attemptsMade: 0,
    name: 'message-persistence',
  } as unknown as Job<MessagePersistenceJob>;
}

// ============================================================================
// Tests
// ============================================================================

describe('MessagePersistenceWorker', () => {
  let worker: InstanceType<typeof import('@/infrastructure/queue/workers/MessagePersistenceWorker').MessagePersistenceWorker>;
  let mockEventStore: IEventStoreMinimal;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.messages.upsert.mockResolvedValue({});

    // Reset singleton
    const { __resetMessagePersistenceWorker, MessagePersistenceWorker } = await import(
      '@/infrastructure/queue/workers/MessagePersistenceWorker'
    );
    __resetMessagePersistenceWorker();

    mockEventStore = createMockEventStore();
    worker = new MessagePersistenceWorker({
      logger: mockLogger,
      prisma: mockPrisma as unknown as import('@prisma/client').PrismaClient,
      eventStore: mockEventStore,
    });
  });

  it('should call markAsProcessed after successful upsert when eventId is provided', async () => {
    const job = createMockJob({ eventId: 'EVT-001' });

    await worker.process(job);

    expect(mockPrisma.messages.upsert).toHaveBeenCalledOnce();
    expect(mockEventStore.markAsProcessed).toHaveBeenCalledWith('EVT-001');
  });

  it('should NOT call markAsProcessed when eventId is undefined', async () => {
    const job = createMockJob({ eventId: undefined });

    await worker.process(job);

    expect(mockPrisma.messages.upsert).toHaveBeenCalledOnce();
    expect(mockEventStore.markAsProcessed).not.toHaveBeenCalled();
  });

  it('should NOT call markAsProcessed when eventId is null', async () => {
    const job = createMockJob({ eventId: null as unknown as undefined });

    await worker.process(job);

    expect(mockPrisma.messages.upsert).toHaveBeenCalledOnce();
    expect(mockEventStore.markAsProcessed).not.toHaveBeenCalled();
  });

  it('should propagate error if markAsProcessed fails', async () => {
    const markError = new Error('Redis connection failed');
    (mockEventStore.markAsProcessed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(markError);
    const job = createMockJob({ eventId: 'EVT-FAIL' });

    await expect(worker.process(job)).rejects.toThrow('Redis connection failed');

    expect(mockPrisma.messages.upsert).toHaveBeenCalledOnce();
    expect(mockEventStore.markAsProcessed).toHaveBeenCalledWith('EVT-FAIL');
  });

  it('should call markAsProcessed AFTER upsert succeeds (ordering)', async () => {
    const callOrder: string[] = [];

    mockPrisma.messages.upsert.mockImplementation(async () => {
      callOrder.push('upsert');
      return {};
    });
    (mockEventStore.markAsProcessed as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('markAsProcessed');
    });

    const job = createMockJob({ eventId: 'EVT-ORDER' });
    await worker.process(job);

    expect(callOrder).toEqual(['upsert', 'markAsProcessed']);
  });

  it('should NOT call markAsProcessed if upsert fails', async () => {
    mockPrisma.messages.upsert.mockRejectedValueOnce(new Error('DB error'));
    const job = createMockJob({ eventId: 'EVT-002' });

    await expect(worker.process(job)).rejects.toThrow('DB error');

    expect(mockEventStore.markAsProcessed).not.toHaveBeenCalled();
  });

  it('should throw on invalid messageId', async () => {
    const job = createMockJob({ messageId: '' });

    await expect(worker.process(job)).rejects.toThrow('Invalid messageId');

    expect(mockPrisma.messages.upsert).not.toHaveBeenCalled();
    expect(mockEventStore.markAsProcessed).not.toHaveBeenCalled();
  });
});
