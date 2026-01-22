/**
 * RedisConnectionManager
 *
 * Manages Redis connection lifecycle for BullMQ.
 * Handles TLS configuration, reconnection, and graceful shutdown.
 *
 * Design:
 * - Supports both injected and self-created connections
 * - Tracks ownership for proper cleanup
 * - Configures TLS for Azure Redis Cache (port 6380)
 *
 * @module infrastructure/queue/core
 */

import { Redis, type RedisOptions } from 'ioredis';
import { getRedisConfig } from '@/infrastructure/redis/redis';
import { env } from '@/infrastructure/config';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import { CONNECTION_TIMEOUTS } from '../constants';

/**
 * Dependencies for RedisConnectionManager
 */
export interface RedisConnectionManagerDependencies {
  /** Pre-configured Redis connection (optional - for DI/testing) */
  redis?: Redis;
  logger?: ILoggerMinimal;
}

/**
 * RedisConnectionManager
 */
export class RedisConnectionManager {
  private readonly connection: Redis;
  private readonly ownsConnection: boolean;
  private readonly log: ILoggerMinimal;
  private isReady: boolean = false;
  private readyPromise: Promise<void>;

  constructor(deps?: RedisConnectionManagerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'RedisConnectionManager' });

    if (deps?.redis) {
      // Use injected connection
      this.connection = deps.redis;
      this.ownsConnection = false;
      this.log.debug('Using injected Redis connection');
    } else {
      // Create new connection
      this.connection = this.createConnection();
      this.ownsConnection = true;
    }

    // Setup event listeners
    this.setupEventListeners();

    // Create ready promise
    this.readyPromise = this.createReadyPromise();
  }

  /**
   * Create a new Redis connection with BullMQ-compatible settings
   */
  private createConnection(): Redis {
    const redisConfig = getRedisConfig();

    this.log.info('Creating BullMQ Redis connection', {
      host: redisConfig.host,
      port: redisConfig.port,
      hasPassword: !!redisConfig.password,
    });

    return new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      // Only include password if non-empty
      ...(redisConfig.password ? { password: redisConfig.password } : {}),
      maxRetriesPerRequest: null, // Required for BullMQ
      lazyConnect: false,
      enableReadyCheck: true,
      // TLS for Azure Redis Cache (port 6380)
      tls: redisConfig.port === 6380 ? { rejectUnauthorized: true } : undefined,
      // Reconnection strategy
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        if (targetErrors.some((target) => err.message.includes(target))) {
          this.log.warn('Redis reconnecting due to error', { error: err.message });
          return true;
        }
        return false;
      },
      // Retry strategy with exponential backoff
      retryStrategy: (times) => {
        if (times > CONNECTION_TIMEOUTS.MAX_RETRY_ATTEMPTS) {
          this.log.error('Redis max retry attempts reached', { attempts: times });
          return null;
        }
        const delay = Math.min(times * 100, CONNECTION_TIMEOUTS.MAX_BACKOFF_DELAY);
        this.log.info('Redis retry attempt', { attempt: times, delayMs: delay });
        return delay;
      },
    });
  }

  /**
   * Setup event listeners for diagnostics
   */
  private setupEventListeners(): void {
    this.connection.on('connect', () => {
      this.log.info('BullMQ IORedis: connect event fired');
    });

    this.connection.on('ready', () => {
      this.log.info('BullMQ IORedis: ready event fired (connection established)');
    });

    this.connection.on('error', (err) => {
      this.log.error('BullMQ IORedis: error event', {
        error: err.message,
        code: (err as NodeJS.ErrnoException).code,
      });
    });

    this.connection.on('close', () => {
      this.log.warn('BullMQ IORedis: close event (connection closed)');
    });

    this.connection.on('reconnecting', (timeToReconnect: number) => {
      this.log.warn('BullMQ IORedis: reconnecting...', { timeToReconnect });
    });

    this.connection.on('end', () => {
      this.log.warn('BullMQ IORedis: end event (no more reconnections)');
    });
  }

  /**
   * Create promise that resolves when Redis is ready
   */
  private createReadyPromise(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionTimeout = env.BULLMQ_CONNECTION_TIMEOUT || CONNECTION_TIMEOUTS.DEFAULT;
      const timeout = setTimeout(() => {
        reject(new Error(`Redis connection timeout for BullMQ (${connectionTimeout / 1000}s)`));
      }, connectionTimeout);

      const onReady = () => {
        clearTimeout(timeout);
        this.isReady = true;
        this.log.info('BullMQ Redis connection ready');
        resolve();
      };

      if (this.connection.status === 'ready') {
        onReady();
      } else {
        this.connection.once('ready', onReady);
        this.connection.once('error', (error) => {
          this.log.error('BullMQ Redis connection error during initialization', {
            error: error.message,
          });
          clearTimeout(timeout);
          reject(error);
        });
      }
    });
  }

  /**
   * Wait for Redis connection to be ready
   */
  async waitForReady(): Promise<void> {
    if (this.isReady) {
      return;
    }
    this.log.debug('Waiting for Redis connection...');
    await this.readyPromise;
  }

  /**
   * Check if connection is ready
   */
  getReadyStatus(): boolean {
    return this.isReady;
  }

  /**
   * Get the underlying Redis connection
   */
  getConnection(): Redis {
    return this.connection;
  }

  /**
   * Get Redis connection config for BullMQ components
   *
   * BullMQ creates independent connections from this config,
   * avoiding shared connection issues during cleanup.
   */
  getConnectionConfig(): RedisOptions {
    const options = this.connection.options;

    return {
      host: options.host || 'localhost',
      port: options.port || 6379,
      password: options.password,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      tls: options.tls ? {
        rejectUnauthorized: typeof options.tls === 'object' ? options.tls.rejectUnauthorized : true,
      } : undefined,
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        if (targetErrors.some((target) => err.message.includes(target))) {
          this.log.warn('Redis reconnecting due to error', { error: err.message });
          return true;
        }
        return false;
      },
      retryStrategy: (times) => {
        if (times > CONNECTION_TIMEOUTS.MAX_RETRY_ATTEMPTS) {
          this.log.error('Redis max retry attempts reached', { attempts: times });
          return null;
        }
        const delay = Math.min(times * 100, CONNECTION_TIMEOUTS.MAX_BACKOFF_DELAY);
        this.log.info('Redis retry attempt', { attempt: times, delayMs: delay });
        return delay;
      },
    };
  }

  /**
   * Check if this manager owns its Redis connection
   */
  ownsRedisConnection(): boolean {
    return this.ownsConnection;
  }

  /**
   * Close the Redis connection (only if owned)
   */
  async close(): Promise<void> {
    if (this.ownsConnection) {
      this.log.debug('Closing owned Redis connection');
      try {
        await this.connection.quit();
        this.log.debug('Redis connection closed');
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error('Failed to close Redis connection', { error: error.message });
        throw error;
      }
    } else {
      this.log.debug('Skipping Redis close (injected connection - caller owns it)');
    }
    this.isReady = false;
  }
}
