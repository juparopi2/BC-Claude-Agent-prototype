/**
 * MessageQueue Dependency Interfaces
 *
 * Defines injectable dependencies for MessageQueue service.
 * Following the pattern from DirectAgentService (US-001.5).
 *
 * @module services/queue/IMessageQueueDependencies
 */

import type { Redis } from 'ioredis';
import type { SqlParams } from '@/infrastructure/database/database';

// Re-export SqlParams for consumers
export type { SqlParams };

/**
 * EventStore minimal interface
 *
 * Only includes methods actually used by MessageQueue.
 * This allows for easier testing with fake implementations.
 */
export interface IEventStoreMinimal {
  markAsProcessed(eventId: string): Promise<void>;
}

/**
 * Database query function type
 *
 * Matches the signature of executeQuery from @/config/database
 */
export type ExecuteQueryFn = <T = Record<string, unknown>>(
  query: string,
  params?: SqlParams
) => Promise<{ recordset: T[]; rowsAffected: number[] }>;

/**
 * Logger minimal interface
 *
 * Pino-compatible interface that supports both call patterns:
 * - logger.info({ data }, 'message')  - object first (standard Pino)
 * - logger.info('message', { data })  - message first (also supported)
 *
 * Uses variadic args for maximum flexibility.
 *
 * Includes child() method for creating job-scoped loggers that:
 * - Inherit the service name from the parent logger
 * - Work correctly with LOG_SERVICES filtering
 * - Follow standard Pino patterns for context propagation
 */
export interface ILoggerMinimal {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  child(bindings: Record<string, unknown>): ILoggerMinimal;
}

/**
 * Embedding result from EmbeddingService
 */
export interface IEmbeddingResult {
  embedding: number[];
  model: string;
}

/**
 * EmbeddingService minimal interface
 *
 * Only includes methods actually used by MessageQueue.
 * Allows for easier testing with mock implementations.
 */
export interface IEmbeddingServiceMinimal {
  generateTextEmbeddingsBatch(texts: string[], userId: string, fileId?: string): Promise<IEmbeddingResult[]>;
}

/**
 * Chunk data for vector indexing
 */
export interface IChunkForIndexing {
  chunkId: string;
  fileId: string;
  userId: string;
  content: string;
  embedding: number[];
  chunkIndex: number;
  tokenCount: number;
  embeddingModel: string;
  createdAt: Date;
}

/**
 * VectorSearchService minimal interface
 *
 * Only includes methods actually used by MessageQueue.
 * Allows for easier testing with mock implementations.
 */
export interface IVectorSearchServiceMinimal {
  indexChunksBatch(chunks: IChunkForIndexing[]): Promise<string[]>;
}

/**
 * Full dependencies interface for MessageQueue DI
 *
 * All dependencies are optional - defaults from module imports are used if not provided.
 * This maintains backward compatibility while enabling testing.
 *
 * @example
 * // Production usage (no dependencies - uses defaults)
 * const queue = getMessageQueue();
 *
 * @example
 * // Test usage (inject real or fake dependencies)
 * const queue = getMessageQueue({
 *   redis: new IORedis({ ...REDIS_TEST_CONFIG, maxRetriesPerRequest: null }),
 *   executeQuery,  // Real database
 *   eventStore: getEventStore(),  // Real EventStore
 *   logger,  // Real logger
 * });
 */
export interface IMessageQueueDependencies {
  /**
   * Pre-configured Redis connection
   * If provided, MessageQueue will use this instead of creating its own.
   */
  redis?: Redis;

  /**
   * Database query executor function
   * If provided, MessageQueue will use this instead of the global executeQuery.
   */
  executeQuery?: ExecuteQueryFn;

  /**
   * EventStore service (or minimal interface)
   * If provided, MessageQueue will use this instead of getEventStore().
   */
  eventStore?: IEventStoreMinimal;

  /**
   * Logger instance
   * If provided, MessageQueue will use this instead of the global logger.
   */
  logger?: ILoggerMinimal;

  /**
   * EmbeddingService instance (or minimal interface)
   * If provided, MessageQueue will use this instead of dynamic import.
   * Useful for testing with mocks.
   */
  embeddingService?: IEmbeddingServiceMinimal;

  /**
   * VectorSearchService instance (or minimal interface)
   * If provided, MessageQueue will use this instead of dynamic import.
   * Useful for testing with mocks.
   */
  vectorSearchService?: IVectorSearchServiceMinimal;

  /**
   * Queue name prefix for test isolation
   *
   * When running integration tests, multiple MessageQueue instances may create
   * workers that listen on the same queue names in Redis. Even after close(),
   * workers may still be active and process jobs from other tests.
   *
   * By providing a unique prefix (e.g., `test-${Date.now()}`), each test gets
   * completely isolated queue names like "test-123--embedding-generation".
   * Note: BullMQ doesn't allow ':' in queue names, so '--' is used as separator.
   *
   * @example
   * // Test usage with isolated queues
   * const queue = getMessageQueue({
   *   queueNamePrefix: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
   *   embeddingService: mockEmbeddingService,
   * });
   */
  queueNamePrefix?: string;
}
