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
 */
export interface ILoggerMinimal {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
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
}
