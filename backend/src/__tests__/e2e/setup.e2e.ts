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
process.env.ENABLE_FILE_LOGGING = 'true';
process.env.LOG_LEVEL = 'debug';
process.env.LOG_FILE_PATH = 'logs/e2e-test-run.json';
// Set Redis config for E2E tests (must be before imports)
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6399';
process.env.REDIS_PASSWORD = '';
delete process.env.REDIS_CONNECTION_STRING;

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// E2E API MODE MOCK SETUP
// ============================================================================
// CRITICAL: vi.mock is hoisted by Vitest and runs BEFORE any other code.
// This mock intercepts getAgentOrchestrator to return FakeAgentOrchestrator
// when E2E_USE_REAL_API is not set to 'true'.
// ============================================================================

import { FakeAgentOrchestrator } from '@domains/agent/orchestration';

// Singleton FakeAgentOrchestrator shared across all E2E tests
export const e2eFakeOrchestrator = new FakeAgentOrchestrator();

// Mock getAgentOrchestrator to return fake ONLY when explicitly disabled
// DEFAULT: Use real Claude API (E2E_USE_REAL_API !== 'false')
vi.mock('@domains/agent/orchestration', async (importOriginal) => {
  const original = await importOriginal<typeof import('@domains/agent/orchestration')>();

  // Use real API by default, only use fake when explicitly set to 'false'
  const useFakeApi = process.env.E2E_USE_REAL_API === 'false';

  if (useFakeApi) {
    // Use fake orchestrator (for CI/CD or cost-sensitive environments)
    return {
      ...original,
      getAgentOrchestrator: vi.fn(() => e2eFakeOrchestrator),
    };
  }

  // DEFAULT: Use real orchestrator - return original module unchanged
  return original;
});
import type { Server } from 'http';
import type { Express } from 'express';
import { initDatabase, closeDatabase } from '@/infrastructure/database/database';
import { initRedis, closeRedis } from '@/infrastructure/redis/redis';
import { initRedisClient, closeRedisClient } from '@/infrastructure/redis/redis-client';
import { REDIS_TEST_CONFIG } from '../integration/setup.integration';
import { TEST_SESSION_SECRET } from '../integration/helpers/constants';
import { cleanSlateForSuite, CleanSlateOptions, CleanSlateResult } from './helpers/CleanSlateDB';

/**
 * E2E API Mode Configuration
 *
 * Controls whether E2E tests use real Claude API or FakeAgentOrchestrator:
 * - E2E_USE_REAL_API=false: Use FakeAgentOrchestrator (fast, free, for CI/CD)
 * - E2E_USE_REAL_API unset or any other value (DEFAULT): Use real Claude API
 */
export const E2E_API_MODE = {
  /** Whether to use real Claude API (default: true) */
  useRealApi: process.env.E2E_USE_REAL_API !== 'false',
  /** Get mode description */
  get description(): string {
    return this.useRealApi ? 'Real Claude API' : 'FakeAgentOrchestrator (Mock)';
  },
};

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
  /** API mode (real or mock) */
  apiMode: E2E_API_MODE,
};

/**
 * Server state tracking
 */
let server: Server | null = null;
let app: Express | null = null;
let isServerRunning = false;

/**
 * Infrastructure status tracking (for graceful degradation)
 */
interface InfrastructureStatus {
  redis: boolean;
  database: boolean;
  redisError?: string;
  databaseError?: string;
}

let infrastructureStatus: InfrastructureStatus = {
  redis: false,
  database: false,
};

/**
 * Get current infrastructure status
 */
export function getInfrastructureStatus(): InfrastructureStatus {
  return { ...infrastructureStatus };
}

/**
 * Skip test if required infrastructure is not available
 * @param required - Array of required infrastructure ('redis' or 'database')
 * @throws Error if any required infrastructure is unavailable
 */
export function skipIfInfrastructureMissing(required: ('redis' | 'database')[]): void {
  for (const infra of required) {
    if (!infrastructureStatus[infra]) {
      const errorKey = `${infra}Error` as keyof InfrastructureStatus;
      throw new Error(
        `Test skipped: ${infra} not available. Error: ${infrastructureStatus[errorKey] || 'Unknown'}`
      );
    }
  }
}

/**
 * Global initialization state tracking
 *
 * In single-fork mode (singleFork: true), all E2E test files run in the
 * same process sequentially. We use globalThis to ensure state is truly
 * global across ALL module loads (vitest may invalidate module caches).
 *
 * This prevents:
 * - Multiple server startups on the same port
 * - Database/Redis being closed while workers still need them
 */
declare global {
  // eslint-disable-next-line no-var
  var __e2eGlobalInitialized: boolean | undefined;
  // eslint-disable-next-line no-var
  var __e2eCleanupRegistered: boolean | undefined;
  // eslint-disable-next-line no-var
  var __e2eServer: Server | null | undefined;
  // eslint-disable-next-line no-var
  var __e2eApp: Express | null | undefined;
  // eslint-disable-next-line no-var
  var __e2eIsServerRunning: boolean | undefined;
}

// Use globalThis to ensure state persists across module reloads
const getGlobalState = () => ({
  get initialized() { return globalThis.__e2eGlobalInitialized ?? false; },
  set initialized(v: boolean) { globalThis.__e2eGlobalInitialized = v; },
  get cleanupRegistered() { return globalThis.__e2eCleanupRegistered ?? false; },
  set cleanupRegistered(v: boolean) { globalThis.__e2eCleanupRegistered = v; },
  get server() { return globalThis.__e2eServer ?? null; },
  set server(v: Server | null) { globalThis.__e2eServer = v; },
  get app() { return globalThis.__e2eApp ?? null; },
  set app(v: Express | null) { globalThis.__e2eApp = v; },
  get isServerRunning() { return globalThis.__e2eIsServerRunning ?? false; },
  set isServerRunning(v: boolean) { globalThis.__e2eIsServerRunning = v; },
});

const globalState = getGlobalState();

/**
 * Register cleanup handler for process exit
 * This ensures resources are cleaned up when all tests complete
 */
function registerCleanupOnExit(): void {
  if (globalState.cleanupRegistered) return;
  globalState.cleanupRegistered = true;

  // Use beforeExit which fires when the event loop is empty
  process.on('beforeExit', async () => {
    if (globalState.initialized) {
      console.log('[E2E] Process exiting - cleaning up shared resources...');
      try {
        // Stop server first
        if (globalState.server && globalState.isServerRunning) {
          await new Promise<void>((resolve) => {
            globalState.server!.close(() => {
              globalState.isServerRunning = false;
              console.log('[E2E] Server stopped on exit');
              resolve();
            });
          });
        }
        // Close database
        await closeDatabase();
        console.log('[E2E] Database closed on exit');
        // Close Redis (both clients)
        await closeRedis();
        await closeRedisClient();
        console.log('[E2E] Redis closed on exit (both ioredis and redis-client)');
      } catch (error) {
        console.error('[E2E] Error during cleanup on exit:', error);
      }
      globalState.initialized = false;
    }
  });
}

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
    // Initialize ioredis client (used by most services)
    await initRedis();

    // Initialize redis package client (used by TestSessionFactory for session cookies)
    await initRedisClient();

    infrastructureStatus.redis = true;
    console.log(`[E2E] Redis initialized - both ioredis and redis-client (${REDIS_TEST_CONFIG.host}:${REDIS_TEST_CONFIG.port})`);
  } catch (error) {
    infrastructureStatus.redis = false;
    infrastructureStatus.redisError = error instanceof Error ? error.message : String(error);
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
    infrastructureStatus.database = true;
    console.log('[E2E] Database initialized');
  } catch (error) {
    infrastructureStatus.database = false;
    infrastructureStatus.databaseError = error instanceof Error ? error.message : String(error);
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
  // Check if server is already running (globalThis persists across module reloads)
  if (globalState.isServerRunning && globalState.server) {
    console.log('[E2E] Server already running, reusing existing instance');
    return { server: globalState.server, app: globalState.app! };
  }

  // Override the port for E2E tests BEFORE importing server
  process.env.PORT = String(E2E_CONFIG.serverPort);

  // Dynamically import the server module to avoid circular dependencies
  // and to ensure environment is properly configured first
  const { createApp, getHttpServer } = await import('@/server');

  // Create and configure the app (this initializes everything)
  const appInstance = await createApp();
  globalState.app = appInstance;
  app = appInstance;

  // Get the HTTP server instance
  const serverInstance = getHttpServer();
  globalState.server = serverInstance;
  server = serverInstance;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`[E2E] Server failed to start within ${E2E_CONFIG.serverStartupTimeout}ms`));
    }, E2E_CONFIG.serverStartupTimeout);

    serverInstance.listen(E2E_CONFIG.serverPort, () => {
      clearTimeout(timeout);
      globalState.isServerRunning = true;
      isServerRunning = true;
      console.log(`[E2E] Server started on port ${E2E_CONFIG.serverPort}`);
      resolve({ server: serverInstance, app: appInstance });
    });

    serverInstance.on('error', (error) => {
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
  /** Run clean slate before suite */
  cleanSlate?: boolean;
  /** Clean slate configuration */
  cleanSlateOptions?: CleanSlateOptions;
} = {}) {
  const timeout = options.timeout || E2E_CONFIG.serverStartupTimeout;

  beforeAll(async () => {
    // Only initialize on FIRST test file (using globalThis to persist across module reloads)
    if (!globalState.initialized) {
      console.log(`[E2E] API Mode: ${E2E_CONFIG.apiMode.description}`);
      console.log('[E2E] Initializing shared resources (first test file)...');

      // Register cleanup handler for process exit
      registerCleanupOnExit();

      // 1. Initialize Redis
      await initRedisForE2E();

      // 2. Initialize Database
      await initDatabaseForE2E();

      // 3. Clean slate if requested (AFTER database init, BEFORE server startup)
      if (options.cleanSlate) {
        console.log('[E2E] Running clean slate database cleanup...');
        const result = await cleanSlateForSuite(options.cleanSlateOptions);
        console.log(
          `[E2E] Clean slate complete: ${result.tablesCleared.length} tables, ` +
          `${Object.values(result.rowsDeleted).reduce((a, b) => a + b, 0)} rows in ${result.durationMs}ms`
        );
      }

      // 4. Start Server (if not skipped)
      if (!options.skipServerStartup) {
        await startServer();
      }

      globalState.initialized = true;
      console.log('[E2E] Shared resources initialized');
    } else {
      console.log('[E2E] Reusing shared resources (already initialized)');
      // Sync local variables with global state
      server = globalState.server;
      app = globalState.app;
      isServerRunning = globalState.isServerRunning;
    }
  }, timeout);

  afterAll(async () => {
    // In single-fork mode, we DO NOT cleanup resources here.
    // Resources are kept alive for all test files and cleaned up
    // on process exit via the beforeExit handler.
    //
    // This prevents the database from being closed while BullMQ
    // workers are still processing jobs from this or previous test files.
    console.log('[E2E] Test file complete (resources kept alive for next file)');
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
    const { getMessageQueue, QueueName } = await import('@/infrastructure/queue/MessageQueue');
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

      // Check for delayed jobs that might still be in transition
      if (finalStats.delayed > 0) {
        console.warn(`[E2E] ${finalStats.delayed} delayed jobs still in queue - waiting additional time`);
        await new Promise(resolve => setTimeout(resolve, Math.min(finalStats.delayed * 1000, 5000)));
      }
    } else {
      console.log('[E2E] MessageQueue has no pending jobs');
    }

    // CRITICAL: Add settling delay to ensure all DB writes have completed
    // BullMQ marks jobs as "completed" before the async DB writes finish,
    // which can cause FK violations during cleanup if we proceed too quickly.
    // Increased to 3000ms to account for:
    // - BullMQ state machine completion
    // - Azure SQL latency
    // - Multi-connection synchronization
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('[E2E] MessageQueue drained (with extended DB settling delay)');
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
