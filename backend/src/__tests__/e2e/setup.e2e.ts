/**
 * E2E Test Setup
 *
 * Global setup for end-to-end tests that simulate frontend interactions.
 * This setup initializes the full server stack including:
 * - Express server
 * - Socket.IO
 * - Database connection
 * - Redis connection
 * - BullMQ workers
 *
 * @module __tests__/e2e/setup.e2e
 */

// CRITICAL: Set test environment variables BEFORE any imports
// This prevents dotenv from overwriting with .env values
process.env.SESSION_SECRET = 'test-secret-for-integration-test';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn'; // Reduce log verbosity during tests
// Set Redis config for E2E tests (must be before imports)
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6399';
process.env.REDIS_PASSWORD = '';
delete process.env.REDIS_CONNECTION_STRING;

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import type { Express } from 'express';
import { initDatabase, closeDatabase } from '@/config/database';
import { initRedis, closeRedis } from '@/config/redis';
import { REDIS_TEST_CONFIG } from '../integration/setup.integration';
import { TEST_SESSION_SECRET } from '../integration/helpers/constants';

/**
 * E2E Test Environment Configuration
 */
export const E2E_CONFIG = {
  /** Port for the test server */
  serverPort: parseInt(process.env.E2E_TEST_PORT || '3099', 10),
  /** Base URL for HTTP requests */
  get baseUrl() {
    return `http://localhost:${this.serverPort}`;
  },
  /** WebSocket URL */
  get wsUrl() {
    return `ws://localhost:${this.serverPort}`;
  },
  /** Default timeout for operations (ms) */
  defaultTimeout: 30000,
  /** Timeout for server startup (ms) */
  serverStartupTimeout: 60000,
};

/**
 * Server state tracking
 */
let server: Server | null = null;
let app: Express | null = null;
let isServerRunning = false;

/**
 * Initialize Redis for E2E tests using local Docker config
 * Overrides environment variables to use test Redis (localhost:6399)
 */
async function initRedisForE2E(): Promise<void> {
  // First: Close any existing Redis connection
  try {
    await closeRedis();
  } catch {
    // Ignore - connection might not exist yet
  }

  // Override environment variables to use local Docker Redis
  process.env.REDIS_HOST = REDIS_TEST_CONFIG.host;
  process.env.REDIS_PORT = String(REDIS_TEST_CONFIG.port);
  process.env.REDIS_PASSWORD = ''; // Docker Redis has no password
  delete process.env.REDIS_CONNECTION_STRING;

  // CRITICAL: Session secret must match TestSessionFactory's TEST_SESSION_SECRET
  // for session cookie signatures to validate
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;

  try {
    await initRedis();
    console.log(`[E2E] Redis initialized (${REDIS_TEST_CONFIG.host}:${REDIS_TEST_CONFIG.port})`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[E2E] Redis not available. Run: docker compose -f docker-compose.test.yml up -d\n` +
      `Error: ${errorMessage}`
    );
  }
}

/**
 * Initialize database for E2E tests
 */
async function initDatabaseForE2E(): Promise<void> {
  try {
    await initDatabase();
    console.log('[E2E] Database initialized');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[E2E] Database not available. Check DATABASE_* environment variables.\n` +
      `Error: ${errorMessage}`
    );
  }
}

/**
 * Start the Express server for E2E tests
 */
async function startServer(): Promise<{ server: Server; app: Express }> {
  // Override the port for E2E tests BEFORE importing server
  process.env.PORT = String(E2E_CONFIG.serverPort);

  // Dynamically import the server module to avoid circular dependencies
  // and to ensure environment is properly configured first
  const { createApp, getHttpServer } = await import('@/server');

  // Create and configure the app (this initializes everything)
  app = await createApp();

  // Get the HTTP server instance
  server = getHttpServer();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`[E2E] Server failed to start within ${E2E_CONFIG.serverStartupTimeout}ms`));
    }, E2E_CONFIG.serverStartupTimeout);

    server!.listen(E2E_CONFIG.serverPort, () => {
      clearTimeout(timeout);
      isServerRunning = true;
      console.log(`[E2E] Server started on port ${E2E_CONFIG.serverPort}`);
      resolve({ server: server!, app: app! });
    });

    server!.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`[E2E] Server startup failed: ${error.message}`));
    });
  });
}

/**
 * Stop the Express server
 */
async function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server && isServerRunning) {
      server.close(() => {
        isServerRunning = false;
        server = null;
        app = null;
        console.log('[E2E] Server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Setup hook for E2E test files
 *
 * @example
 * ```typescript
 * import { setupE2ETest } from '../setup.e2e';
 *
 * describe('E2E: My Test Suite', () => {
 *   const { getBaseUrl, getServerPort } = setupE2ETest();
 *
 *   it('should work with real server', async () => {
 *     const response = await fetch(`${getBaseUrl()}/health`);
 *     expect(response.ok).toBe(true);
 *   });
 * });
 * ```
 */
export function setupE2ETest(options: {
  /** Skip server startup (use existing server) */
  skipServerStartup?: boolean;
  /** Custom timeout for initialization */
  timeout?: number;
} = {}) {
  const timeout = options.timeout || E2E_CONFIG.serverStartupTimeout;

  beforeAll(async () => {
    // 1. Initialize Redis
    await initRedisForE2E();

    // 2. Initialize Database
    await initDatabaseForE2E();

    // 3. Start Server (if not skipped)
    if (!options.skipServerStartup) {
      await startServer();
    }
  }, timeout);

  afterAll(async () => {
    // 1. Stop Server
    if (!options.skipServerStartup) {
      await stopServer();
    }

    // 2. Close Database
    await closeDatabase();

    // 3. Close Redis
    await closeRedis();
  }, timeout);

  return {
    /** Get the base URL for HTTP requests */
    getBaseUrl: () => E2E_CONFIG.baseUrl,
    /** Get the WebSocket URL */
    getWsUrl: () => E2E_CONFIG.wsUrl,
    /** Get the server port */
    getServerPort: () => E2E_CONFIG.serverPort,
    /** Check if server is running */
    isServerRunning: () => isServerRunning,
    /** Get the Express app instance (for advanced use) */
    getApp: () => app,
    /** Get the HTTP server instance (for advanced use) */
    getServer: () => server,
  };
}

/**
 * Lightweight setup for E2E tests that connect to an existing server
 *
 * Use this when running E2E tests against a separately started server
 * (e.g., for debugging or CI with pre-started server)
 */
export function setupE2ETestLightweight() {
  return {
    getBaseUrl: () => E2E_CONFIG.baseUrl,
    getWsUrl: () => E2E_CONFIG.wsUrl,
    getServerPort: () => E2E_CONFIG.serverPort,
  };
}

/**
 * Drain MessageQueue before test cleanup
 *
 * CRITICAL: Call this in test file's afterAll BEFORE factory.cleanup()
 * to prevent FK violations from async job processing.
 *
 * This function waits for all active and waiting jobs to complete before
 * test cleanup deletes sessions from the database.
 */
export async function drainMessageQueue(): Promise<void> {
  try {
    const { getMessageQueue, QueueName } = await import('@/services/queue/MessageQueue');
    const messageQueue = getMessageQueue();

    // Wait for queue to be ready first
    await messageQueue.waitForReady();

    // Get stats to check if there are pending jobs
    const stats = await messageQueue.getQueueStats(QueueName.MESSAGE_PERSISTENCE);

    if (stats.active > 0 || stats.waiting > 0) {
      console.log(`[E2E] Waiting for ${stats.active} active + ${stats.waiting} waiting jobs to complete...`);

      // Wait up to 10 seconds for jobs to complete
      const maxWait = 10000;
      const checkInterval = 500;
      let elapsed = 0;

      while (elapsed < maxWait) {
        const currentStats = await messageQueue.getQueueStats(QueueName.MESSAGE_PERSISTENCE);
        if (currentStats.active === 0 && currentStats.waiting === 0) {
          console.log('[E2E] All MessageQueue jobs completed');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        elapsed += checkInterval;
      }

      // Final check
      const finalStats = await messageQueue.getQueueStats(QueueName.MESSAGE_PERSISTENCE);
      if (finalStats.active > 0 || finalStats.waiting > 0) {
        console.warn(
          `[E2E] MessageQueue still has pending jobs after ${maxWait}ms: ` +
          `${finalStats.active} active, ${finalStats.waiting} waiting`
        );
      }
    } else {
      console.log('[E2E] MessageQueue has no pending jobs');
    }

    console.log('[E2E] MessageQueue drained');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[E2E] Failed to drain MessageQueue:', errorMessage);
  }
}

/**
 * Check if E2E environment is properly configured
 */
export async function verifyE2EEnvironment(): Promise<{
  redis: boolean;
  database: boolean;
  server: boolean;
}> {
  const results = {
    redis: false,
    database: false,
    server: false,
  };

  // Check Redis
  try {
    const { getRedis } = await import('@/config/redis');
    const redis = getRedis();
    if (redis) {
      const pong = await redis.ping();
      results.redis = pong === 'PONG';
    }
  } catch {
    results.redis = false;
  }

  // Check Database
  try {
    const { executeQuery } = await import('@/config/database');
    const result = await executeQuery<{ result: number }>('SELECT 1 as result');
    results.database = result.recordset[0]?.result === 1;
  } catch {
    results.database = false;
  }

  // Check Server
  try {
    const response = await fetch(`${E2E_CONFIG.baseUrl}/health/liveness`);
    results.server = response.ok;
  } catch {
    results.server = false;
  }

  return results;
}
