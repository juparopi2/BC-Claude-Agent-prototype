/**
 * MSSQLSaver - Custom LangGraph checkpointer for MSSQL using Prisma
 *
 * Implements persistent checkpoint storage for LangGraph agents using Azure SQL Server.
 * Extends BaseCheckpointSaver from @langchain/langgraph-checkpoint.
 *
 * Features:
 * - Persistent checkpoint storage with parent-child relationships
 * - Pending writes management for resumable graph execution
 * - Thread-level deletion support
 * - Backward compatibility migration for v<4 checkpoints
 *
 * Database tables:
 * - langgraph_checkpoints: Stores checkpoint state and metadata
 * - langgraph_checkpoint_writes: Stores pending writes per checkpoint
 *
 * Usage:
 * ```typescript
 * const saver = new MSSQLSaver(prisma);
 * const graph = createGraph().compile({ checkpointer: saver });
 * ```
 *
 * Note on Type Compatibility:
 * - TypeScript may report type errors due to @langchain/core version mismatches
 *   between backend/node_modules and root node_modules.
 * - The implementation is functionally correct and will work at runtime.
 * - Types from @langchain/langgraph-checkpoint (via @langchain/langgraph) are compatible.
 */

import { PrismaClient } from '@prisma/client';
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  WRITES_IDX_MAP,
  TASKS,
} from '@langchain/langgraph-checkpoint';
import type {
  Checkpoint,
  CheckpointTuple,
  CheckpointListOptions,
  ChannelVersions,
  CheckpointMetadata,
  PendingWrite,
  CheckpointPendingWrite,
  SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

/**
 * Envelope structure for serialized data storage.
 * Stores both the type string and serialized bytes in a single Buffer.
 *
 * Format:
 * - 4 bytes: type string length (UInt32LE)
 * - N bytes: type string (UTF-8)
 * - Rest: serialized data (Uint8Array)
 */
interface SerializedEnvelope {
  type: string;
  data: Uint8Array;
}

/**
 * MSSQLSaver - Persistent checkpoint storage for LangGraph using Prisma + MSSQL.
 *
 * Provides durable checkpoint persistence with support for:
 * - Checkpoint versioning and parent-child relationships
 * - Pending write tracking for resumable execution
 * - Thread-level cleanup
 * - Metadata filtering and pagination
 */
export class MSSQLSaver extends BaseCheckpointSaver {
  private prisma: PrismaClient;
  private log: ILoggerMinimal;

  /**
   * Creates a new MSSQLSaver instance.
   *
   * @param prisma - Prisma client instance for database access
   * @param deps - Optional dependencies for testing (logger, serializer)
   */
  constructor(
    prisma: PrismaClient,
    deps?: { logger?: ILoggerMinimal; serde?: SerializerProtocol }
  ) {
    super(deps?.serde);
    this.prisma = prisma;
    this.log = deps?.logger ?? createChildLogger({ service: 'MSSQLSaver' });
  }

  /**
   * Encodes a serialized value into a Buffer envelope.
   *
   * @param type - Type string from SerializerProtocol
   * @param data - Serialized data bytes
   * @returns Buffer containing [length][type][data]
   */
  private encodeEnvelope(type: string, data: Uint8Array): Buffer {
    const typeBuffer = Buffer.from(type, 'utf8');
    const lengthBuffer = Buffer.allocUnsafe(4);
    lengthBuffer.writeUInt32LE(typeBuffer.length, 0);

    return Buffer.concat([lengthBuffer, typeBuffer, Buffer.from(data)]);
  }

  /**
   * Decodes a Buffer envelope into type and data.
   *
   * @param buffer - Buffer containing [length][type][data]
   * @returns Decoded type and data
   */
  private decodeEnvelope(buffer: Buffer): SerializedEnvelope {
    const typeLength = buffer.readUInt32LE(0);
    const type = buffer.toString('utf8', 4, 4 + typeLength);
    // CRITICAL: Must specify length parameter to avoid including buffer pool garbage.
    // Without length, the Uint8Array view includes all bytes from offset to end of
    // the underlying ArrayBuffer, which may be an 8KB pooled buffer.
    const dataLength = buffer.length - 4 - typeLength;
    const data = new Uint8Array(buffer.buffer, buffer.byteOffset + 4 + typeLength, dataLength);

    return { type, data };
  }

  /**
   * Serializes checkpoint data for storage.
   *
   * @param checkpoint - Checkpoint to serialize
   * @returns Buffer containing serialized checkpoint
   */
  private async serializeCheckpoint(checkpoint: Checkpoint): Promise<Buffer> {
    const [type, data] = await this.serde.dumpsTyped(checkpoint);
    return this.encodeEnvelope(type, data);
  }

  /**
   * Deserializes checkpoint data from storage.
   *
   * @param buffer - Buffer containing serialized checkpoint
   * @returns Deserialized checkpoint
   */
  private async deserializeCheckpoint(buffer: Buffer): Promise<Checkpoint> {
    const { type, data } = this.decodeEnvelope(buffer);
    return (await this.serde.loadsTyped(type, data)) as Checkpoint;
  }

  /**
   * Serializes checkpoint metadata for storage.
   *
   * @param metadata - Metadata to serialize
   * @returns Buffer containing serialized metadata
   */
  private async serializeMetadata(metadata: CheckpointMetadata): Promise<Buffer> {
    const [type, data] = await this.serde.dumpsTyped(metadata);
    return this.encodeEnvelope(type, data);
  }

  /**
   * Deserializes checkpoint metadata from storage.
   *
   * @param buffer - Buffer containing serialized metadata
   * @returns Deserialized metadata
   */
  private async deserializeMetadata(buffer: Buffer): Promise<CheckpointMetadata> {
    const { type, data } = this.decodeEnvelope(buffer);
    return (await this.serde.loadsTyped(type, data)) as CheckpointMetadata;
  }

  /**
   * Serializes a pending write value for storage.
   *
   * @param value - Write value to serialize
   * @returns Buffer containing serialized value
   */
  private async serializeWriteValue(value: unknown): Promise<Buffer> {
    const [type, data] = await this.serde.dumpsTyped(value);
    return this.encodeEnvelope(type, data);
  }

  /**
   * Deserializes a pending write value from storage.
   *
   * @param buffer - Buffer containing serialized value
   * @returns Deserialized value
   */
  private async deserializeWriteValue(buffer: Buffer): Promise<unknown> {
    const { type, data } = this.decodeEnvelope(buffer);
    return await this.serde.loadsTyped(type, data);
  }

  /**
   * Extracts checkpoint configuration from RunnableConfig.
   *
   * @param config - LangGraph runnable configuration
   * @returns Extracted thread_id, checkpoint_ns, checkpoint_id
   */
  private extractConfigurable(config: RunnableConfig): {
    threadId: string;
    checkpointNs: string;
    checkpointId?: string;
  } {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    if (!threadId) {
      throw new Error('thread_id is required in config.configurable');
    }

    return { threadId, checkpointNs, checkpointId };
  }

  /**
   * Retrieves a checkpoint tuple from storage.
   *
   * If checkpoint_id is specified, retrieves that specific checkpoint.
   * Otherwise, retrieves the most recent checkpoint for the thread.
   *
   * @param config - Configuration containing thread_id and optional checkpoint_id
   * @returns CheckpointTuple if found, undefined otherwise
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, checkpointNs, checkpointId } = this.extractConfigurable(config);

    try {
      // Retrieve checkpoint
      const checkpointRecord = checkpointId
        ? await this.prisma.langgraph_checkpoints.findUnique({
            where: {
              thread_id_checkpoint_ns_checkpoint_id: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: checkpointId,
              },
            },
          })
        : await this.prisma.langgraph_checkpoints.findFirst({
            where: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
            },
            orderBy: {
              checkpoint_id: 'desc',
            },
          });

      if (!checkpointRecord) {
        return undefined;
      }

      // Retrieve pending writes
      const writeRecords = await this.prisma.langgraph_checkpoint_writes.findMany({
        where: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointRecord.checkpoint_id,
        },
        orderBy: [{ task_id: 'asc' }, { idx: 'asc' }],
      });

      // Deserialize checkpoint and metadata
      const checkpoint = await this.deserializeCheckpoint(
        Buffer.from(checkpointRecord.checkpoint_data)
      );
      const metadata = await this.deserializeMetadata(
        Buffer.from(checkpointRecord.metadata)
      );

      // Deserialize pending writes
      const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
        writeRecords.map(async (write) => {
          const value = await this.deserializeWriteValue(Buffer.from(write.value));
          return [write.task_id, write.channel, value] as CheckpointPendingWrite;
        })
      );

      // Migrate old checkpoints if needed (v < 4)
      await this.migratePendingSends(
        threadId,
        checkpointNs,
        checkpoint,
        checkpointRecord.parent_checkpoint_id ?? undefined
      );

      // Build parent config if parent exists
      const parentConfig = checkpointRecord.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: checkpointRecord.parent_checkpoint_id,
            },
          }
        : undefined;

      return {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: checkpointRecord.checkpoint_id,
          },
        },
        checkpoint,
        metadata,
        parentConfig,
        pendingWrites,
      };
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      this.log.error({ error: errorInfo, threadId, checkpointId }, 'Failed to get checkpoint');
      throw error;
    }
  }

  /**
   * Lists checkpoints for a thread, with optional filtering and pagination.
   *
   * @param config - Configuration containing thread_id
   * @param options - Optional filtering (limit, before) and metadata filters
   * @yields CheckpointTuple for each matching checkpoint
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const { threadId, checkpointNs } = this.extractConfigurable(config);

    try {
      // Fetch checkpoints with ordering
      const checkpoints = await this.prisma.langgraph_checkpoints.findMany({
        where: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
        },
        orderBy: {
          checkpoint_id: 'desc',
        },
        take: options?.limit,
      });

      for (const record of checkpoints) {
        // Apply "before" filter
        if (
          options?.before?.configurable?.checkpoint_id &&
          record.checkpoint_id >= (options.before.configurable.checkpoint_id as string)
        ) {
          continue;
        }

        // Deserialize checkpoint and metadata
        const checkpoint = await this.deserializeCheckpoint(
          Buffer.from(record.checkpoint_data)
        );
        const metadata = await this.deserializeMetadata(Buffer.from(record.metadata));

        // Apply metadata filters (in-memory)
        if (options?.filter) {
          let match = true;
          for (const [key, value] of Object.entries(options.filter)) {
            if (metadata[key] !== value) {
              match = false;
              break;
            }
          }
          if (!match) {
            continue;
          }
        }

        // Retrieve pending writes
        const writeRecords = await this.prisma.langgraph_checkpoint_writes.findMany({
          where: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: record.checkpoint_id,
          },
          orderBy: [{ task_id: 'asc' }, { idx: 'asc' }],
        });

        const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
          writeRecords.map(async (write) => {
            const value = await this.deserializeWriteValue(Buffer.from(write.value));
            return [write.task_id, write.channel, value] as CheckpointPendingWrite;
          })
        );

        // Migrate old checkpoints if needed
        await this.migratePendingSends(
          threadId,
          checkpointNs,
          checkpoint,
          record.parent_checkpoint_id ?? undefined
        );

        // Build parent config if parent exists
        const parentConfig = record.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: record.parent_checkpoint_id,
              },
            }
          : undefined;

        yield {
          config: {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: record.checkpoint_id,
            },
          },
          checkpoint,
          metadata,
          parentConfig,
          pendingWrites,
        };
      }
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      this.log.error({ error: errorInfo, threadId }, 'Failed to list checkpoints');
      throw error;
    }
  }

  /**
   * Stores a checkpoint with metadata and version information.
   *
   * @param config - Configuration containing thread_id and optional checkpoint_ns
   * @param checkpoint - Checkpoint state to store
   * @param metadata - Checkpoint metadata
   * @param newVersions - Channel version updates (unused in base implementation)
   * @returns Updated configuration with new checkpoint_id
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const { threadId, checkpointNs } = this.extractConfigurable(config);

    try {
      // Copy checkpoint to avoid mutation
      const checkpointCopy = copyCheckpoint(checkpoint);

      // Serialize checkpoint and metadata
      const checkpointData = await this.serializeCheckpoint(checkpointCopy);
      const metadataData = await this.serializeMetadata(metadata);

      // Extract parent checkpoint ID from config
      const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;

      // Use checkpoint's ID as the checkpoint_id
      const checkpointId = checkpointCopy.id;

      // Upsert checkpoint (convert Buffer to Uint8Array for Prisma)
      await this.prisma.langgraph_checkpoints.upsert({
        where: {
          thread_id_checkpoint_ns_checkpoint_id: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: checkpointId,
          },
        },
        update: {
          checkpoint_data: new Uint8Array(checkpointData),
          metadata: new Uint8Array(metadataData),
          parent_checkpoint_id: parentCheckpointId,
        },
        create: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
          parent_checkpoint_id: parentCheckpointId,
          checkpoint_data: new Uint8Array(checkpointData),
          metadata: new Uint8Array(metadataData),
        },
      });

      this.log.debug(
        { threadId, checkpointNs, checkpointId, parentCheckpointId },
        'Checkpoint saved'
      );

      return {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
        },
      };
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      this.log.error({ error: errorInfo, threadId }, 'Failed to put checkpoint');
      throw error;
    }
  }

  /**
   * Stores pending writes for a checkpoint.
   *
   * Supports idempotent writes: if a write with positive idx already exists, it is skipped.
   *
   * @param config - Configuration containing thread_id, checkpoint_ns, checkpoint_id
   * @param writes - Array of pending writes [channel, value]
   * @param taskId - Task ID for the writes
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const { threadId, checkpointNs, checkpointId } = this.extractConfigurable(config);

    if (!checkpointId) {
      throw new Error('checkpoint_id is required for putWrites');
    }

    try {
      for (let i = 0; i < writes.length; i++) {
        const [channel, value] = writes[i];

        // Determine index: use WRITES_IDX_MAP for special channels, otherwise sequential
        const idx = WRITES_IDX_MAP[channel] ?? i;

        // Serialize value
        const valueBuffer = await this.serializeWriteValue(value);

        // Extract type for storage
        const [type] = await this.serde.dumpsTyped(value);

        // Attempt to create write record (idempotent for positive idx)
        try {
          await this.prisma.langgraph_checkpoint_writes.create({
            data: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: checkpointId,
              task_id: taskId,
              idx,
              channel,
              type,
              value: new Uint8Array(valueBuffer),
            },
          });
        } catch (error) {
          // Ignore duplicate key errors for positive idx (idempotency)
          if (idx >= 0) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('PRIMARY KEY') || errorMessage.includes('UNIQUE')) {
              this.log.debug(
                { threadId, checkpointId, taskId, channel, idx },
                'Write already exists, skipping'
              );
              continue;
            }
          }
          throw error;
        }
      }

      this.log.debug(
        { threadId, checkpointId, taskId, writeCount: writes.length },
        'Pending writes saved'
      );
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      this.log.error(
        { error: errorInfo, threadId, checkpointId, taskId },
        'Failed to put writes'
      );
      throw error;
    }
  }

  /**
   * Deletes all checkpoints and writes for a thread.
   *
   * @param threadId - Thread ID to delete
   */
  async deleteThread(threadId: string): Promise<void> {
    try {
      // Delete writes first (foreign key constraint)
      await this.prisma.langgraph_checkpoint_writes.deleteMany({
        where: { thread_id: threadId },
      });

      // Delete checkpoints
      await this.prisma.langgraph_checkpoints.deleteMany({
        where: { thread_id: threadId },
      });

      this.log.info({ threadId }, 'Thread deleted');
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      this.log.error({ error: errorInfo, threadId }, 'Failed to delete thread');
      throw error;
    }
  }

  /**
   * Migrates pending sends from parent checkpoint for v<4 compatibility.
   *
   * For checkpoints with version < 4, pending sends were stored as TASKS writes
   * in the parent checkpoint. This method loads those writes and merges them
   * into the current checkpoint's __pregel_tasks channel.
   *
   * @param threadId - Thread ID
   * @param checkpointNs - Checkpoint namespace
   * @param checkpoint - Current checkpoint (mutable, will be modified)
   * @param parentCheckpointId - Parent checkpoint ID (if exists)
   */
  private async migratePendingSends(
    threadId: string,
    checkpointNs: string,
    checkpoint: Checkpoint,
    parentCheckpointId?: string
  ): Promise<void> {
    // Only migrate if checkpoint version < 4 and has parent
    const version = checkpoint.v ?? 1;
    if (version >= 4 || !parentCheckpointId) {
      return;
    }

    try {
      // Load parent's TASKS writes
      const parentWrites = await this.prisma.langgraph_checkpoint_writes.findMany({
        where: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: parentCheckpointId,
          channel: TASKS,
        },
      });

      if (parentWrites.length === 0) {
        return;
      }

      // Deserialize TASKS writes
      const tasksData = await Promise.all(
        parentWrites.map(async (write) => {
          return await this.deserializeWriteValue(Buffer.from(write.value));
        })
      );

      // Merge into checkpoint's TASKS channel_values
      const existingTasks = (checkpoint.channel_values[TASKS] as unknown[] | undefined) ?? [];
      checkpoint.channel_values[TASKS] = [...existingTasks, ...tasksData.flat()];

      this.log.debug(
        { threadId, checkpointId: checkpoint.id, migratedCount: tasksData.length },
        'Migrated pending sends from parent'
      );
    } catch (error) {
      // Log but don't fail - migration is best-effort
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      this.log.warn(
        { error: errorInfo, threadId, checkpointId: checkpoint.id },
        'Failed to migrate pending sends'
      );
    }
  }
}
