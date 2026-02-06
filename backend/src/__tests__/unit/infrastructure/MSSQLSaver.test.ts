import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MSSQLSaver } from '@/infrastructure/checkpointer/MSSQLSaver';
import { WRITES_IDX_MAP } from '@langchain/langgraph-checkpoint';
import type {
  Checkpoint,
  CheckpointMetadata,
  PendingWrite,
  ChannelVersions,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Creates a Buffer envelope for serialized data.
 * Envelope format:
 * - 4 bytes: type string length (UInt32LE)
 * - N bytes: type string (UTF-8)
 * - Rest: serialized data
 */
function createEnvelope(type: string, data: Uint8Array): Buffer {
  const typeBuffer = Buffer.from(type, 'utf8');
  const totalLength = 4 + typeBuffer.length + data.length;
  const envelope = Buffer.alloc(totalLength);

  // Write type length (4 bytes)
  envelope.writeUInt32LE(typeBuffer.length, 0);
  // Write type string
  typeBuffer.copy(envelope, 4);
  // Write data
  Buffer.from(data).copy(envelope, 4 + typeBuffer.length);

  return envelope;
}

/**
 * Mock serde for predictable serialization.
 */
const mockSerde = {
  dumpsTyped: vi.fn().mockImplementation(async (data: unknown) => {
    const json = JSON.stringify(data);
    return ['json', new TextEncoder().encode(json)] as [string, Uint8Array];
  }),
  loadsTyped: vi.fn().mockImplementation(async (_type: string, data: Uint8Array | string) => {
    const str = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
    return JSON.parse(str);
  }),
};

/**
 * Mock logger
 */
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/**
 * Helper to create mock Prisma client
 */
function createMockPrisma() {
  return {
    langgraph_checkpoints: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    langgraph_checkpoint_writes: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

/**
 * Helper to create RunnableConfig
 */
function createConfig(threadId: string, checkpointId?: string): RunnableConfig {
  return {
    configurable: {
      thread_id: threadId,
      checkpoint_ns: '',
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

/**
 * Helper to create sample checkpoint
 */
function createSampleCheckpoint(id = 'cp-001'): Checkpoint {
  return {
    v: 4,
    id,
    ts: '2024-01-01T00:00:00.000Z',
    channel_values: { messages: ['hello'] },
    channel_versions: { messages: 1 },
    versions_seen: { node1: { messages: 1 } },
  };
}

/**
 * Helper to create sample metadata
 */
function createSampleMetadata(): CheckpointMetadata {
  return {
    source: 'loop',
    step: 1,
    parents: {},
  };
}

/**
 * Helper to serialize checkpoint to envelope Buffer.
 */
async function serializeToEnvelope(data: unknown): Promise<Buffer> {
  const [type, bytes] = await mockSerde.dumpsTyped(data);
  return createEnvelope(type, bytes);
}

// ============================================================================
// Tests
// ============================================================================

describe('MSSQLSaver', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let saver: MSSQLSaver;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();

    // Reset serde implementation
    mockSerde.dumpsTyped.mockImplementation(async (data: unknown) => {
      const json = JSON.stringify(data);
      return ['json', new TextEncoder().encode(json)] as [string, Uint8Array];
    });
    mockSerde.loadsTyped.mockImplementation(async (_type: string, data: Uint8Array | string) => {
      const str = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
      return JSON.parse(str);
    });

    // Create saver with mocked dependencies
    saver = new MSSQLSaver(mockPrisma as any, { logger: mockLogger, serde: mockSerde as any });
  });

  // --------------------------------------------------------------------------
  // put() tests
  // --------------------------------------------------------------------------

  describe('put', () => {
    it('should store checkpoint correctly', async () => {
      const config = createConfig('thread-001');
      const checkpoint = createSampleCheckpoint('cp-001');
      const metadata = createSampleMetadata();
      const newVersions: ChannelVersions = {};

      mockPrisma.langgraph_checkpoints.upsert.mockResolvedValue({} as any);

      await saver.put(config, checkpoint, metadata, newVersions);

      expect(mockPrisma.langgraph_checkpoints.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.langgraph_checkpoints.upsert.mock.calls[0][0];

      expect(call.where.thread_id_checkpoint_ns_checkpoint_id).toEqual({
        thread_id: 'thread-001',
        checkpoint_ns: '',
        checkpoint_id: 'cp-001',
      });
      expect(call.create.thread_id).toBe('thread-001');
      expect(call.create.checkpoint_id).toBe('cp-001');
      expect(call.create.checkpoint_ns).toBe('');
      expect(call.create.checkpoint_data).toBeInstanceOf(Uint8Array);
      expect(call.create.metadata).toBeInstanceOf(Uint8Array);
    });

    it('should return config with new checkpoint_id', async () => {
      const config = createConfig('thread-001');
      const checkpoint = createSampleCheckpoint('cp-002');
      const metadata = createSampleMetadata();

      mockPrisma.langgraph_checkpoints.upsert.mockResolvedValue({} as any);

      const result = await saver.put(config, checkpoint, metadata, {});

      expect(result.configurable).toEqual({
        thread_id: 'thread-001',
        checkpoint_ns: '',
        checkpoint_id: 'cp-002',
      });
    });

    it('should include parent_checkpoint_id when provided in config', async () => {
      const config = createConfig('thread-001', 'cp-parent');
      const checkpoint = createSampleCheckpoint('cp-002');
      const metadata = createSampleMetadata();

      mockPrisma.langgraph_checkpoints.upsert.mockResolvedValue({} as any);

      await saver.put(config, checkpoint, metadata, {});

      const call = mockPrisma.langgraph_checkpoints.upsert.mock.calls[0][0];
      expect(call.create.parent_checkpoint_id).toBe('cp-parent');
      expect(call.update.parent_checkpoint_id).toBe('cp-parent');
    });
  });

  // --------------------------------------------------------------------------
  // getTuple() tests
  // --------------------------------------------------------------------------

  describe('getTuple', () => {
    it('should return undefined for non-existent thread', async () => {
      const config = createConfig('thread-nonexistent');

      mockPrisma.langgraph_checkpoints.findFirst.mockResolvedValue(null);

      const result = await saver.getTuple(config);

      expect(result).toBeUndefined();
      expect(mockPrisma.langgraph_checkpoints.findFirst).toHaveBeenCalledWith({
        where: {
          thread_id: 'thread-nonexistent',
          checkpoint_ns: '',
        },
        orderBy: {
          checkpoint_id: 'desc',
        },
      });
    });

    it('should use findUnique when checkpoint_id is specified', async () => {
      const config = createConfig('thread-001', 'cp-001');
      const checkpoint = createSampleCheckpoint('cp-001');
      const metadata = createSampleMetadata();

      mockPrisma.langgraph_checkpoints.findUnique.mockResolvedValue({
        thread_id: 'thread-001',
        checkpoint_ns: '',
        checkpoint_id: 'cp-001',
        parent_checkpoint_id: null,
        checkpoint_data: await serializeToEnvelope(checkpoint),
        metadata: await serializeToEnvelope(metadata),
      });
      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([]);

      const result = await saver.getTuple(config);

      expect(mockPrisma.langgraph_checkpoints.findUnique).toHaveBeenCalledWith({
        where: {
          thread_id_checkpoint_ns_checkpoint_id: {
            thread_id: 'thread-001',
            checkpoint_ns: '',
            checkpoint_id: 'cp-001',
          },
        },
      });
      expect(result).toBeDefined();
      expect(result?.checkpoint.id).toBe('cp-001');
    });

    it('should use findFirst without checkpoint_id to get latest', async () => {
      const config = createConfig('thread-001');
      const checkpoint = createSampleCheckpoint('cp-latest');
      const metadata = createSampleMetadata();

      mockPrisma.langgraph_checkpoints.findFirst.mockResolvedValue({
        thread_id: 'thread-001',
        checkpoint_ns: '',
        checkpoint_id: 'cp-latest',
        parent_checkpoint_id: null,
        checkpoint_data: await serializeToEnvelope(checkpoint),
        metadata: await serializeToEnvelope(metadata),
      });
      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([]);

      const result = await saver.getTuple(config);

      expect(mockPrisma.langgraph_checkpoints.findFirst).toHaveBeenCalledWith({
        where: {
          thread_id: 'thread-001',
          checkpoint_ns: '',
        },
        orderBy: {
          checkpoint_id: 'desc',
        },
      });
      expect(result?.checkpoint.id).toBe('cp-latest');
    });

    it('should include pending writes', async () => {
      const config = createConfig('thread-001', 'cp-001');
      const checkpoint = createSampleCheckpoint('cp-001');
      const metadata = createSampleMetadata();

      const write1Value = { type: 'message', content: 'test' };
      const write2Value = { type: 'command', action: 'run' };

      mockPrisma.langgraph_checkpoints.findUnique.mockResolvedValue({
        thread_id: 'thread-001',
        checkpoint_ns: '',
        checkpoint_id: 'cp-001',
        parent_checkpoint_id: null,
        checkpoint_data: await serializeToEnvelope(checkpoint),
        metadata: await serializeToEnvelope(metadata),
      });

      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([
        {
          task_id: 'task-1',
          channel: 'messages',
          idx: 0,
          value: await serializeToEnvelope(write1Value),
        },
        {
          task_id: 'task-1',
          channel: 'commands',
          idx: 1,
          value: await serializeToEnvelope(write2Value),
        },
      ]);

      const result = await saver.getTuple(config);

      expect(result?.pendingWrites).toHaveLength(2);
      expect(result?.pendingWrites[0]).toEqual(['task-1', 'messages', write1Value]);
      expect(result?.pendingWrites[1]).toEqual(['task-1', 'commands', write2Value]);
    });

    it('should build parentConfig when parent_checkpoint_id exists', async () => {
      const config = createConfig('thread-001', 'cp-002');
      const checkpoint = createSampleCheckpoint('cp-002');
      const metadata = createSampleMetadata();

      mockPrisma.langgraph_checkpoints.findUnique.mockResolvedValue({
        thread_id: 'thread-001',
        checkpoint_ns: '',
        checkpoint_id: 'cp-002',
        parent_checkpoint_id: 'cp-001',
        checkpoint_data: await serializeToEnvelope(checkpoint),
        metadata: await serializeToEnvelope(metadata),
      });
      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([]);

      const result = await saver.getTuple(config);

      expect(result?.parentConfig).toEqual({
        configurable: {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-001',
        },
      });
    });

    it('should throw if thread_id is missing from config', async () => {
      const config: RunnableConfig = {
        configurable: {
          checkpoint_ns: '',
        },
      };

      await expect(saver.getTuple(config)).rejects.toThrow('thread_id is required');
    });
  });

  // --------------------------------------------------------------------------
  // list() tests
  // --------------------------------------------------------------------------

  describe('list', () => {
    it('should yield checkpoints in reverse order', async () => {
      const config = createConfig('thread-001');
      const cp1 = createSampleCheckpoint('cp-001');
      const cp2 = createSampleCheckpoint('cp-002');
      const metadata = createSampleMetadata();

      mockPrisma.langgraph_checkpoints.findMany.mockResolvedValue([
        {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-002',
          parent_checkpoint_id: 'cp-001',
          checkpoint_data: await serializeToEnvelope(cp2),
          metadata: await serializeToEnvelope(metadata),
        },
        {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-001',
          parent_checkpoint_id: null,
          checkpoint_data: await serializeToEnvelope(cp1),
          metadata: await serializeToEnvelope(metadata),
        },
      ]);
      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([]);

      const results = [];
      for await (const tuple of saver.list(config)) {
        results.push(tuple);
      }

      expect(results).toHaveLength(2);
      expect(results[0].checkpoint.id).toBe('cp-002');
      expect(results[1].checkpoint.id).toBe('cp-001');
      expect(mockPrisma.langgraph_checkpoints.findMany).toHaveBeenCalledWith({
        where: {
          thread_id: 'thread-001',
          checkpoint_ns: '',
        },
        orderBy: {
          checkpoint_id: 'desc',
        },
        take: undefined,
      });
    });

    it('should respect limit parameter', async () => {
      const config = createConfig('thread-001');

      mockPrisma.langgraph_checkpoints.findMany.mockResolvedValue([]);

      const results = [];
      for await (const tuple of saver.list(config, { limit: 5 })) {
        results.push(tuple);
      }

      expect(mockPrisma.langgraph_checkpoints.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        })
      );
    });

    it('should respect before filter', async () => {
      const config = createConfig('thread-001');
      const cp1 = createSampleCheckpoint('cp-001');
      const cp2 = createSampleCheckpoint('cp-002');
      const cp3 = createSampleCheckpoint('cp-003');
      const metadata = createSampleMetadata();

      // Mock returns all checkpoints, but before filter should skip >= cp-002
      mockPrisma.langgraph_checkpoints.findMany.mockResolvedValue([
        {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-003',
          parent_checkpoint_id: 'cp-002',
          checkpoint_data: await serializeToEnvelope(cp3),
          metadata: await serializeToEnvelope(metadata),
        },
        {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-002',
          parent_checkpoint_id: 'cp-001',
          checkpoint_data: await serializeToEnvelope(cp2),
          metadata: await serializeToEnvelope(metadata),
        },
        {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-001',
          parent_checkpoint_id: null,
          checkpoint_data: await serializeToEnvelope(cp1),
          metadata: await serializeToEnvelope(metadata),
        },
      ]);
      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([]);

      const beforeConfig = createConfig('thread-001', 'cp-002');
      const results = [];
      for await (const tuple of saver.list(config, { before: beforeConfig })) {
        results.push(tuple);
      }

      // Should only include cp-001 (cp-002 and cp-003 are >= 'cp-002')
      expect(results).toHaveLength(1);
      expect(results[0].checkpoint.id).toBe('cp-001');
    });

    it('should respect metadata filter', async () => {
      const config = createConfig('thread-001');
      const cp1 = createSampleCheckpoint('cp-001');
      const cp2 = createSampleCheckpoint('cp-002');
      const metadata1 = { ...createSampleMetadata(), source: 'loop', step: 1 };
      const metadata2 = { ...createSampleMetadata(), source: 'input', step: 2 };

      mockPrisma.langgraph_checkpoints.findMany.mockResolvedValue([
        {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-002',
          parent_checkpoint_id: 'cp-001',
          checkpoint_data: await serializeToEnvelope(cp2),
          metadata: await serializeToEnvelope(metadata2),
        },
        {
          thread_id: 'thread-001',
          checkpoint_ns: '',
          checkpoint_id: 'cp-001',
          parent_checkpoint_id: null,
          checkpoint_data: await serializeToEnvelope(cp1),
          metadata: await serializeToEnvelope(metadata1),
        },
      ]);
      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([]);

      const results = [];
      for await (const tuple of saver.list(config, { filter: { source: 'loop' } })) {
        results.push(tuple);
      }

      // Should only include cp-001 with source='loop'
      expect(results).toHaveLength(1);
      expect(results[0].checkpoint.id).toBe('cp-001');
      expect(results[0].metadata.source).toBe('loop');
    });
  });

  // --------------------------------------------------------------------------
  // putWrites() tests
  // --------------------------------------------------------------------------

  describe('putWrites', () => {
    it('should store pending writes', async () => {
      const config = createConfig('thread-001', 'cp-001');
      const writes: PendingWrite[] = [
        ['messages', { type: 'message', content: 'hello' }],
        ['commands', { type: 'command', action: 'run' }],
      ];
      const taskId = 'task-1';

      mockPrisma.langgraph_checkpoint_writes.create.mockResolvedValue({} as any);

      await saver.putWrites(config, writes, taskId);

      expect(mockPrisma.langgraph_checkpoint_writes.create).toHaveBeenCalledTimes(2);

      const call1 = mockPrisma.langgraph_checkpoint_writes.create.mock.calls[0][0].data;
      expect(call1.thread_id).toBe('thread-001');
      expect(call1.checkpoint_id).toBe('cp-001');
      expect(call1.task_id).toBe('task-1');
      expect(call1.channel).toBe('messages');
      expect(call1.idx).toBe(0);
      expect(call1.value).toBeInstanceOf(Uint8Array);

      const call2 = mockPrisma.langgraph_checkpoint_writes.create.mock.calls[1][0].data;
      expect(call2.channel).toBe('commands');
      expect(call2.idx).toBe(1);
    });

    it('should be idempotent for positive indices', async () => {
      const config = createConfig('thread-001', 'cp-001');
      const writes: PendingWrite[] = [['messages', { type: 'message', content: 'hello' }]];
      const taskId = 'task-1';

      // Simulate duplicate key error
      const duplicateError = new Error(
        'Violation of PRIMARY KEY constraint. Cannot insert duplicate key.'
      );
      mockPrisma.langgraph_checkpoint_writes.create.mockRejectedValue(duplicateError);

      // Should not throw - idempotent for positive idx
      await expect(saver.putWrites(config, writes, taskId)).resolves.toBeUndefined();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-001',
          checkpointId: 'cp-001',
          taskId: 'task-1',
          channel: 'messages',
        }),
        'Write already exists, skipping'
      );
    });

    it('should throw on duplicate key error for negative indices', async () => {
      const config = createConfig('thread-001', 'cp-001');
      // WRITES_IDX_MAP maps special channels like '__error__', '__interrupt__' to negative indices
      const writes: PendingWrite[] = [['__error__', { error: 'test error' }]];
      const taskId = 'task-1';

      const duplicateError = new Error('Violation of UNIQUE constraint');
      mockPrisma.langgraph_checkpoint_writes.create.mockRejectedValue(duplicateError);

      // Should throw for negative idx (special channels)
      await expect(saver.putWrites(config, writes, taskId)).rejects.toThrow(
        'Violation of UNIQUE constraint'
      );
    });

    it('should throw if checkpoint_id is missing', async () => {
      const config = createConfig('thread-001'); // No checkpoint_id
      const writes: PendingWrite[] = [['messages', { content: 'test' }]];
      const taskId = 'task-1';

      await expect(saver.putWrites(config, writes, taskId)).rejects.toThrow(
        'checkpoint_id is required for putWrites'
      );
    });
  });

  // --------------------------------------------------------------------------
  // deleteThread() tests
  // --------------------------------------------------------------------------

  describe('deleteThread', () => {
    it('should remove all checkpoints and writes', async () => {
      const threadId = 'thread-001';

      mockPrisma.langgraph_checkpoint_writes.deleteMany.mockResolvedValue({ count: 5 } as any);
      mockPrisma.langgraph_checkpoints.deleteMany.mockResolvedValue({ count: 3 } as any);

      await saver.deleteThread(threadId);

      // Should delete writes first (foreign key constraint)
      expect(mockPrisma.langgraph_checkpoint_writes.deleteMany).toHaveBeenCalledWith({
        where: { thread_id: threadId },
      });
      expect(mockPrisma.langgraph_checkpoints.deleteMany).toHaveBeenCalledWith({
        where: { thread_id: threadId },
      });

      // Verify order: writes before checkpoints
      const writeCall = mockPrisma.langgraph_checkpoint_writes.deleteMany.mock.invocationCallOrder[0];
      const checkpointCall = mockPrisma.langgraph_checkpoints.deleteMany.mock.invocationCallOrder[0];
      expect(writeCall).toBeLessThan(checkpointCall);

      expect(mockLogger.info).toHaveBeenCalledWith({ threadId }, 'Thread deleted');
    });

    it('should throw on database error', async () => {
      const threadId = 'thread-001';
      const dbError = new Error('Database connection failed');

      mockPrisma.langgraph_checkpoint_writes.deleteMany.mockRejectedValue(dbError);

      await expect(saver.deleteThread(threadId)).rejects.toThrow('Database connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: 'Database connection failed' }),
          threadId,
        }),
        'Failed to delete thread'
      );
    });
  });

  // --------------------------------------------------------------------------
  // Integration tests
  // --------------------------------------------------------------------------

  describe('serialization round-trip', () => {
    it('should preserve data after put and getTuple', async () => {
      const config = createConfig('thread-001');
      const checkpoint = createSampleCheckpoint('cp-round-trip');
      const metadata = createSampleMetadata();

      // Store the serialized data
      let savedCheckpointData: Uint8Array;
      let savedMetadata: Uint8Array;

      mockPrisma.langgraph_checkpoints.upsert.mockImplementation(async (args: any) => {
        savedCheckpointData = args.create.checkpoint_data;
        savedMetadata = args.create.metadata;
        return {} as any;
      });

      await saver.put(config, checkpoint, metadata, {});

      // Retrieve with the saved data
      mockPrisma.langgraph_checkpoints.findFirst.mockResolvedValue({
        thread_id: 'thread-001',
        checkpoint_ns: '',
        checkpoint_id: 'cp-round-trip',
        parent_checkpoint_id: null,
        checkpoint_data: savedCheckpointData,
        metadata: savedMetadata,
      });
      mockPrisma.langgraph_checkpoint_writes.findMany.mockResolvedValue([]);

      const result = await saver.getTuple(config);

      expect(result).toBeDefined();
      expect(result?.checkpoint).toEqual(checkpoint);
      expect(result?.metadata).toEqual(metadata);
    });
  });

  describe('error handling', () => {
    it('should log and rethrow errors with proper serialization', async () => {
      const config = createConfig('thread-001');

      const dbError = new Error('Database error');
      mockPrisma.langgraph_checkpoints.findFirst.mockRejectedValue(dbError);

      await expect(saver.getTuple(config)).rejects.toThrow('Database error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            message: 'Database error',
            stack: expect.any(String),
            name: 'Error',
          },
          threadId: 'thread-001',
        }),
        'Failed to get checkpoint'
      );
    });
  });
});
