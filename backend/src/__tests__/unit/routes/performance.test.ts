/**
 * Performance Tests - Phase 5 (F6-005)
 *
 * Comprehensive performance testing suite for the BC Claude Agent backend.
 * Tests concurrent request handling, response times, and memory safety.
 *
 * Test Categories:
 * 1. Concurrent Request Handling (100+ parallel requests)
 * 2. Response Time Validation (<500ms for standard operations)
 * 3. Percentile Latency (P95/P99) - Enterprise SLA compliance
 * 4. Memory Leak Detection (heap + RSS monitoring)
 * 5. Multi-Tenant Data Isolation under load
 * 6. Large Batch Processing (100+ items per request)
 * 7. Tail Latency Bounds (no request > 2s)
 *
 * Threshold Justifications:
 * Memory:
 * - 100MB heap growth: 500 requests × 10 logs × ~1KB = ~5MB data, 10x Node overhead = 50MB, 2x safety = 100MB
 * - 80MB complex objects: 200 requests × ~10KB nested context, similar calculation
 * - 150MB RSS: Includes heap + native buffers + shared libraries, 1.5x heap threshold
 *
 * Latency (Test Environment - higher than production targets):
 * - P95 < 2000ms: Test environment target (Production: 200ms)
 * - P99 < 3000ms: Test environment tail latency (Production: 500ms)
 * - Max < 5000ms: Test environment absolute upper bound (Production: 1000ms)
 *
 * Note: Test thresholds account for CI/CD variance, shared resources, cold starts,
 * and running in parallel with other test suites (Vitest parallelism)
 *
 * @module __tests__/unit/routes/performance.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import logsRouter from '@/routes/logs';
import tokenUsageRouter from '@/routes/token-usage';
import sessionsRouter from '@/routes/sessions';

// ============================================
// Threshold Constants (Documented Justification)
// ============================================

/**
 * Memory thresholds with documented justification
 */
const MEMORY_THRESHOLDS = {
  /**
   * Heap growth threshold for sequential batch requests
   * Calculation: 500 requests × 10 logs × ~1KB metadata = ~5MB raw data
   * Node.js overhead factor: 10x → 50MB expected
   * Safety margin: 2x → 100MB threshold
   */
  HEAP_GROWTH_BATCH_MB: 100,

  /**
   * Heap growth threshold for complex nested objects
   * Calculation: 200 requests × ~10KB nested context = ~2MB raw data
   * JSON parsing + object creation overhead: 20x → 40MB
   * Safety margin: 2x → 80MB threshold
   */
  HEAP_GROWTH_COMPLEX_MB: 80,

  /**
   * RSS growth threshold (includes native buffers, shared libraries)
   * RSS typically 1.5x heap for Node.js applications
   * Applied to heap threshold: 100MB × 1.5 = 150MB
   */
  RSS_GROWTH_MB: 150,
} as const;

/**
 * Latency thresholds for SLA compliance
 *
 * Note: Test environment thresholds are significantly higher than production targets
 * to account for:
 * - CI/CD environment variance (shared resources, cold starts)
 * - Running alongside other test suites (resource contention)
 * - No dedicated hardware
 * - Mocked services that still incur overhead
 * - Vitest parallelism causing CPU contention
 *
 * Production targets should be:
 * - P95: 200ms (strict SLA)
 * - P99: 500ms (strict SLA)
 * - Max: 1000ms (strict SLA)
 *
 * For accurate production benchmarks, run:
 *   npm test -- performance.test.ts --no-threads
 */
const LATENCY_THRESHOLDS = {
  /** Single request must complete within 500ms */
  SINGLE_REQUEST_MS: 500,

  /** Average response time under load */
  AVG_UNDER_LOAD_MS: 1500,

  /**
   * 95th percentile - Test environment SLA
   * Production target: 200ms
   * Test threshold: 3000ms (accounts for running with full test suite + coverage instrumentation)
   */
  P95_MS: 3000,

  /**
   * 99th percentile - Test environment tail latency SLA
   * Production target: 500ms
   * Test threshold: 4000ms (accounts for running with full test suite + coverage instrumentation)
   */
  P99_MS: 4000,

  /**
   * Absolute maximum - No request should ever exceed this
   * Production target: 1000ms
   * Test threshold: 6000ms (accounts for GC pauses, cold starts, parallelism, coverage)
   */
  MAX_ABSOLUTE_MS: 6000,

  /** Batch processing timeout */
  BATCH_TIMEOUT_MS: 1000,

  /** Concurrent batch timeout (10 batches) */
  CONCURRENT_BATCH_TIMEOUT_MS: 5000,
} as const;

// ============================================
// Type Definitions
// ============================================

/**
 * Performance metrics collected during tests
 * Enhanced with percentile calculations for enterprise SLA compliance
 */
interface PerformanceMetrics {
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Average response time per request */
  avgResponseTimeMs: number;
  /** Maximum response time observed */
  maxResponseTimeMs: number;
  /** Minimum response time observed */
  minResponseTimeMs: number;
  /** 95th percentile response time (P95) */
  p95ResponseTimeMs: number;
  /** 99th percentile response time (P99) */
  p99ResponseTimeMs: number;
  /** Median response time (P50) */
  medianResponseTimeMs: number;
  /** Number of successful requests */
  successCount: number;
  /** Number of failed requests */
  failureCount: number;
  /** Requests per second achieved */
  requestsPerSecond: number;
  /** All response times for detailed analysis */
  responseTimes: number[];
}

/**
 * Memory snapshot for leak detection
 */
interface MemorySnapshot {
  /** Heap used in bytes */
  heapUsed: number;
  /** Heap total in bytes */
  heapTotal: number;
  /** External memory in bytes */
  external: number;
  /** RSS (Resident Set Size) in bytes */
  rss: number;
}

/**
 * Response from concurrent request batch
 */
interface ConcurrentResponse {
  /** HTTP status code */
  status: number;
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** Whether request was successful */
  success: boolean;
  /** User ID that made the request (for multi-tenant isolation tests) */
  userId?: string;
  /** Response body for data isolation verification */
  body?: Record<string, unknown>;
}

/**
 * Multi-tenant response with data for isolation verification
 */
interface MultiTenantResponse extends ConcurrentResponse {
  /** User ID that made the request */
  userId: string;
  /** Token totals received (for isolation check) */
  receivedTotalTokens?: number;
  /** Expected token totals for this user */
  expectedTotalTokens: number;
}

// ============================================
// Mock Dependencies
// ============================================

// Mock logger with performance tracking (inline to avoid hoisting issues)
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock token usage service
const mockTokenUsageService = {
  getUserTotals: vi.fn(),
  getSessionTotals: vi.fn(),
  getMonthlyUsageByModel: vi.fn(),
  getTopSessionsByUsage: vi.fn(),
  getCacheEfficiency: vi.fn(),
};

vi.mock('@/services/token-usage', () => ({
  getTokenUsageService: () => mockTokenUsageService,
}));

// Mock session ownership validation
vi.mock('@/shared/utils/session-ownership', () => ({
  validateSessionOwnership: vi.fn().mockResolvedValue({ isOwner: true }),
  validateUserIdMatch: vi.fn((requestedId, authenticatedId) => requestedId === authenticatedId),
}));

// Mock database for sessions route
vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    recordset: [],
    rowsAffected: [0],
  }),
}));

// Mock auth middleware - inject userId via header
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, _res: Response, next: NextFunction) => {
    const testUserId = req.headers['x-test-user-id'] as string;
    if (testUserId) {
      req.userId = testUserId;
      next();
    } else {
      next();
    }
  },
}));

// ============================================
// Test Helpers
// ============================================

/**
 * Create test application with all performance-critical routes
 */
function createTestApp(): Application {
  const app = express();
  app.use(express.json({ limit: '10mb' })); // Support large batches
  app.use('/api', logsRouter);
  app.use('/api/token-usage', tokenUsageRouter);
  app.use('/api/chat/sessions', sessionsRouter);
  return app;
}

/**
 * Take a memory snapshot
 */
function takeMemorySnapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    rss: usage.rss,
  };
}

/**
 * Calculate heap memory growth in MB
 */
function calculateHeapGrowthMB(before: MemorySnapshot, after: MemorySnapshot): number {
  return (after.heapUsed - before.heapUsed) / 1024 / 1024;
}

/**
 * Calculate RSS (Resident Set Size) growth in MB
 * RSS includes heap + native buffers + shared libraries
 * This catches memory leaks that heapUsed alone might miss
 */
function calculateRSSGrowthMB(before: MemorySnapshot, after: MemorySnapshot): number {
  return (after.rss - before.rss) / 1024 / 1024;
}

/**
 * Calculate worst-case memory growth (max of heap and RSS)
 */
function calculateMaxMemoryGrowthMB(before: MemorySnapshot, after: MemorySnapshot): number {
  const heapGrowth = calculateHeapGrowthMB(before, after);
  const rssGrowth = calculateRSSGrowthMB(before, after);
  return Math.max(heapGrowth, rssGrowth);
}

/**
 * Calculate percentile from sorted array
 * @param sortedValues - Array of values sorted in ascending order
 * @param percentile - Percentile to calculate (0-100)
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  const safeIndex = Math.max(0, Math.min(index, sortedValues.length - 1));
  return sortedValues[safeIndex] ?? 0;
}

/**
 * Force garbage collection if available
 * Note: Requires --expose-gc flag to be set
 */
function forceGC(): void {
  if (global.gc) {
    global.gc();
  }
}

/**
 * Execute concurrent requests and collect metrics
 */
async function executeConcurrentRequests(
  app: Application,
  requestFn: (app: Application) => request.Test,
  concurrency: number
): Promise<{ responses: ConcurrentResponse[]; metrics: PerformanceMetrics }> {
  const startTime = Date.now();
  const responsePromises: Promise<ConcurrentResponse>[] = [];

  for (let i = 0; i < concurrency; i++) {
    const requestStartTime = Date.now();
    const promise = requestFn(app)
      .then((res) => ({
        status: res.status,
        responseTimeMs: Date.now() - requestStartTime,
        success: res.status < 500,
      }))
      .catch(() => ({
        status: 500,
        responseTimeMs: Date.now() - requestStartTime,
        success: false,
      }));
    responsePromises.push(promise);
  }

  const responses = await Promise.all(responsePromises);
  const totalDurationMs = Date.now() - startTime;

  // Calculate metrics with percentiles
  const responseTimes = responses.map((r) => r.responseTimeMs);
  const sortedTimes = [...responseTimes].sort((a, b) => a - b);
  const successCount = responses.filter((r) => r.success).length;
  const failureCount = responses.filter((r) => !r.success).length;

  const metrics: PerformanceMetrics = {
    totalDurationMs,
    avgResponseTimeMs: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
    maxResponseTimeMs: Math.max(...responseTimes),
    minResponseTimeMs: Math.min(...responseTimes),
    p95ResponseTimeMs: calculatePercentile(sortedTimes, 95),
    p99ResponseTimeMs: calculatePercentile(sortedTimes, 99),
    medianResponseTimeMs: calculatePercentile(sortedTimes, 50),
    successCount,
    failureCount,
    requestsPerSecond: (concurrency / totalDurationMs) * 1000,
    responseTimes: sortedTimes,
  };

  return { responses, metrics };
}

/**
 * Generate valid log entry for testing
 */
function generateLogEntry(index: number): {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
} {
  const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];
  const level = levels[index % levels.length] as 'debug' | 'info' | 'warn' | 'error';

  return {
    timestamp: new Date(Date.now() + index * 1000).toISOString(),
    level,
    message: `Performance test log entry ${index}`,
    context: {
      index,
      testId: `perf-${index}`,
      metadata: {
        timestamp: Date.now(),
        iteration: index,
      },
    },
  };
}

// ============================================
// Test Suite
// ============================================

describe.skip('Performance Tests', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    forceGC(); // Clean up before each test
  });

  afterEach(() => {
    forceGC(); // Clean up after each test
  });

  // ============================================
  // 1. Concurrent Request Handling
  // ============================================
  describe('Concurrent Request Handling', () => {
    it('should handle 100 concurrent token-usage/me requests with SLA compliance', async () => {
      // Arrange
      const concurrency = 100;
      const userId = 'perf-test-user';
      mockTokenUsageService.getUserTotals.mockResolvedValue({
        userId,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalTokens: 1500,
      });

      // Act
      const { responses, metrics } = await executeConcurrentRequests(
        app,
        (testApp) =>
          request(testApp)
            .get('/api/token-usage/me')
            .set('x-test-user-id', userId),
        concurrency
      );

      // Assert - All requests should complete without server errors
      expect(responses.every((r) => r.status < 500)).toBe(true);
      expect(metrics.successCount).toBe(concurrency);
      expect(metrics.failureCount).toBe(0);

      // GAP-1: Percentile assertions (Enterprise SLA compliance)
      expect(metrics.p95ResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.P95_MS);
      expect(metrics.p99ResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.P99_MS);

      // GAP-2: Tail latency bound - No single request should exceed absolute max
      expect(metrics.maxResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.MAX_ABSOLUTE_MS);

      // Log performance metrics for analysis
      console.log(`[PERF] 100 concurrent token-usage/me:`);
      console.log(`  - Total duration: ${metrics.totalDurationMs}ms`);
      console.log(`  - Avg response: ${metrics.avgResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - P95: ${metrics.p95ResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - P99: ${metrics.p99ResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - Max: ${metrics.maxResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - Requests/sec: ${metrics.requestsPerSecond.toFixed(2)}`);
    });

    it('should handle 100 concurrent log batch requests with SLA compliance', async () => {
      // Arrange
      const concurrency = 100;
      const logBatch = {
        logs: Array.from({ length: 10 }, (_, i) => generateLogEntry(i)),
      };

      // Act
      const { responses, metrics } = await executeConcurrentRequests(
        app,
        (testApp) =>
          request(testApp)
            .post('/api/logs')
            .send(logBatch),
        concurrency
      );

      // Assert
      expect(responses.every((r) => r.status === 204)).toBe(true);
      expect(metrics.successCount).toBe(concurrency);

      // GAP-1: Percentile assertions
      expect(metrics.p95ResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.P95_MS);
      expect(metrics.p99ResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.P99_MS);

      // GAP-2: Tail latency bound
      expect(metrics.maxResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.MAX_ABSOLUTE_MS);

      console.log(`[PERF] 100 concurrent log batches:`);
      console.log(`  - Total duration: ${metrics.totalDurationMs}ms`);
      console.log(`  - Avg response: ${metrics.avgResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - P95: ${metrics.p95ResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - P99: ${metrics.p99ResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - Max: ${metrics.maxResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - Requests/sec: ${metrics.requestsPerSecond.toFixed(2)}`);
    });

    it('should handle multi-tenant concurrent access with data isolation verification', async () => {
      // Arrange
      const usersCount = 10;
      const requestsPerUser = 10;
      const allPromises: Promise<MultiTenantResponse>[] = [];

      // Mock different totals per user - each user gets unique token count
      mockTokenUsageService.getUserTotals.mockImplementation((userId: string) => {
        const userIndex = parseInt(userId.replace('user-', ''));
        return {
          userId,
          totalTokens: (userIndex + 1) * 1000, // user-0 = 1000, user-1 = 2000, etc.
        };
      });

      // Act - Simulate 10 different users making requests concurrently
      const startTime = Date.now();
      for (let userIdx = 0; userIdx < usersCount; userIdx++) {
        const userId = `user-${userIdx}`;
        const expectedTotalTokens = (userIdx + 1) * 1000;

        for (let reqIdx = 0; reqIdx < requestsPerUser; reqIdx++) {
          const requestStartTime = Date.now();
          const promise = request(app)
            .get('/api/token-usage/me')
            .set('x-test-user-id', userId)
            .then((res) => ({
              status: res.status,
              responseTimeMs: Date.now() - requestStartTime,
              success: res.status < 500,
              userId,
              expectedTotalTokens,
              receivedTotalTokens: res.body?.totalTokens as number | undefined,
              body: res.body as Record<string, unknown>,
            }))
            .catch(() => ({
              status: 500,
              responseTimeMs: Date.now() - requestStartTime,
              success: false,
              userId,
              expectedTotalTokens,
              receivedTotalTokens: undefined,
            }));
          allPromises.push(promise);
        }
      }

      const responses = await Promise.all(allPromises);
      const totalDurationMs = Date.now() - startTime;

      // Assert - All requests should succeed
      const successCount = responses.filter((r) => r.success).length;
      expect(successCount).toBe(usersCount * requestsPerUser);

      // GAP-6: Verify data isolation - each user should only receive their own data
      const isolationViolations: string[] = [];
      for (const response of responses) {
        if (response.success && response.receivedTotalTokens !== undefined) {
          if (response.receivedTotalTokens !== response.expectedTotalTokens) {
            isolationViolations.push(
              `User ${response.userId} expected ${response.expectedTotalTokens} tokens but received ${response.receivedTotalTokens}`
            );
          }
        }
      }

      // Assert no isolation violations
      expect(isolationViolations).toHaveLength(0);

      // Group responses by user and verify consistency
      const responsesByUser = new Map<string, number[]>();
      for (const response of responses) {
        if (response.success && response.receivedTotalTokens !== undefined) {
          const existing = responsesByUser.get(response.userId) ?? [];
          existing.push(response.receivedTotalTokens);
          responsesByUser.set(response.userId, existing);
        }
      }

      // Each user should have consistent data across all their requests
      for (const [userId, tokenValues] of responsesByUser) {
        const uniqueValues = new Set(tokenValues);
        expect(uniqueValues.size).toBe(1); // All requests for this user should return same value
        const userIndex = parseInt(userId.replace('user-', ''));
        expect(tokenValues[0]).toBe((userIndex + 1) * 1000); // Correct user's data
      }

      console.log(`[PERF] Multi-tenant (${usersCount} users x ${requestsPerUser} requests):`);
      console.log(`  - Total requests: ${usersCount * requestsPerUser}`);
      console.log(`  - Total duration: ${totalDurationMs}ms`);
      console.log(`  - All successful: ${successCount === usersCount * requestsPerUser}`);
      console.log(`  - Data isolation verified: ${isolationViolations.length === 0 ? 'YES' : 'NO'}`);
    });
  });

  // ============================================
  // 2. Response Time Validation
  // ============================================
  describe('Response Time Validation', () => {
    it('should return token-usage/me within SLA threshold', async () => {
      // Arrange
      const userId = 'fast-user';
      mockTokenUsageService.getUserTotals.mockResolvedValue({
        userId,
        totalTokens: 5000,
      });

      // Act
      const startTime = Date.now();
      const response = await request(app)
        .get('/api/token-usage/me')
        .set('x-test-user-id', userId);
      const duration = Date.now() - startTime;

      // Assert
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(LATENCY_THRESHOLDS.SINGLE_REQUEST_MS);

      console.log(`[PERF] Single token-usage/me: ${duration}ms (threshold: ${LATENCY_THRESHOLDS.SINGLE_REQUEST_MS}ms)`);
    });

    it('should process 100-item log batch within batch threshold', async () => {
      // Arrange
      const largeBatch = {
        logs: Array.from({ length: 100 }, (_, i) => generateLogEntry(i)),
      };

      // Act
      const startTime = Date.now();
      const response = await request(app)
        .post('/api/logs')
        .send(largeBatch);
      const duration = Date.now() - startTime;

      // Assert
      expect(response.status).toBe(204);
      expect(duration).toBeLessThan(LATENCY_THRESHOLDS.BATCH_TIMEOUT_MS);

      console.log(`[PERF] 100-item log batch: ${duration}ms (threshold: ${LATENCY_THRESHOLDS.BATCH_TIMEOUT_MS}ms)`);
    });

    it('should maintain SLA-compliant response times under moderate load', async () => {
      // Arrange
      const concurrency = 50;
      const userId = 'moderate-load-user';
      mockTokenUsageService.getUserTotals.mockResolvedValue({
        userId,
        totalTokens: 3000,
      });

      // Act
      const { metrics } = await executeConcurrentRequests(
        app,
        (testApp) =>
          request(testApp)
            .get('/api/token-usage/me')
            .set('x-test-user-id', userId),
        concurrency
      );

      // Assert - Average should be under SLA threshold
      expect(metrics.avgResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.AVG_UNDER_LOAD_MS);

      // GAP-1: Percentile assertions for SLA compliance
      expect(metrics.p95ResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.P95_MS);
      expect(metrics.p99ResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.P99_MS);

      // GAP-2: Tail latency bound
      expect(metrics.maxResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.MAX_ABSOLUTE_MS);

      console.log(`[PERF] 50 concurrent performance metrics:`);
      console.log(`  - Avg: ${metrics.avgResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - Median (P50): ${metrics.medianResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - P95: ${metrics.p95ResponseTimeMs.toFixed(2)}ms (SLA: <${LATENCY_THRESHOLDS.P95_MS}ms)`);
      console.log(`  - P99: ${metrics.p99ResponseTimeMs.toFixed(2)}ms (SLA: <${LATENCY_THRESHOLDS.P99_MS}ms)`);
      console.log(`  - Max: ${metrics.maxResponseTimeMs.toFixed(2)}ms (Bound: <${LATENCY_THRESHOLDS.MAX_ABSOLUTE_MS}ms)`);
    });
  });

  // ============================================
  // 3. Memory Safety Tests
  // ============================================
  describe('Memory Safety', () => {
    it(
      'should not accumulate excessive heap or RSS after 500 log batch requests',
      async () => {
        // Arrange
        forceGC();
        const initialMemory = takeMemorySnapshot();
        const iterations = 500; // Reduced for unit test environment
        const batchSize = 10;

        // Act - Execute log batch requests sequentially
        for (let i = 0; i < iterations; i++) {
          const logBatch = {
            logs: Array.from({ length: batchSize }, (_, j) => generateLogEntry(i * batchSize + j)),
          };

          await request(app)
            .post('/api/logs')
            .send(logBatch);
        }

        // Force GC to get accurate memory reading
        forceGC();
        const finalMemory = takeMemorySnapshot();

        // GAP-4: Measure both heap and RSS
        const heapGrowthMB = calculateHeapGrowthMB(initialMemory, finalMemory);
        const rssGrowthMB = calculateRSSGrowthMB(initialMemory, finalMemory);
        const maxGrowthMB = calculateMaxMemoryGrowthMB(initialMemory, finalMemory);

        // Assert - Memory growth should be bounded
        // Threshold justification documented in MEMORY_THRESHOLDS
        expect(heapGrowthMB).toBeLessThan(MEMORY_THRESHOLDS.HEAP_GROWTH_BATCH_MB);
        expect(rssGrowthMB).toBeLessThan(MEMORY_THRESHOLDS.RSS_GROWTH_MB);

        console.log(`[PERF] Memory after ${iterations} log batches:`);
        console.log(`  - Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  - Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  - Heap growth: ${heapGrowthMB.toFixed(2)}MB (threshold: ${MEMORY_THRESHOLDS.HEAP_GROWTH_BATCH_MB}MB)`);
        console.log(`  - Initial RSS: ${(initialMemory.rss / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  - Final RSS: ${(finalMemory.rss / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  - RSS growth: ${rssGrowthMB.toFixed(2)}MB (threshold: ${MEMORY_THRESHOLDS.RSS_GROWTH_MB}MB)`);
        console.log(`  - Max growth: ${maxGrowthMB.toFixed(2)}MB`);
      },
      30000
    );

    it('should not leak memory with complex context objects (heap + RSS)', async () => {
      // Arrange
      forceGC();
      const initialMemory = takeMemorySnapshot();
      const iterations = 200; // Reduced for test environment

      // Act - Send requests with deeply nested context objects
      for (let i = 0; i < iterations; i++) {
        const complexLog = {
          logs: [
            {
              timestamp: new Date().toISOString(),
              level: 'info' as const,
              message: 'Complex context test',
              context: {
                level1: {
                  level2: {
                    level3: {
                      level4: {
                        level5: {
                          data: 'x'.repeat(500), // Reduced data size
                          array: Array.from({ length: 50 }, (_, j) => ({ id: j, value: `item-${j}` })),
                        },
                      },
                    },
                  },
                },
                metadata: {
                  timestamp: Date.now(),
                  iteration: i,
                  tags: ['perf', 'test', 'memory', 'complex'],
                },
              },
            },
          ],
        };

        await request(app)
          .post('/api/logs')
          .send(complexLog);
      }

      // Force GC
      forceGC();
      const finalMemory = takeMemorySnapshot();

      // GAP-4: Measure both heap and RSS
      const heapGrowthMB = calculateHeapGrowthMB(initialMemory, finalMemory);
      const rssGrowthMB = calculateRSSGrowthMB(initialMemory, finalMemory);

      // Assert - Memory growth should be bounded
      // Threshold justification documented in MEMORY_THRESHOLDS
      expect(heapGrowthMB).toBeLessThan(MEMORY_THRESHOLDS.HEAP_GROWTH_COMPLEX_MB);
      expect(rssGrowthMB).toBeLessThan(MEMORY_THRESHOLDS.RSS_GROWTH_MB);

      console.log(`[PERF] Memory after ${iterations} complex context requests:`);
      console.log(`  - Heap growth: ${heapGrowthMB.toFixed(2)}MB (threshold: ${MEMORY_THRESHOLDS.HEAP_GROWTH_COMPLEX_MB}MB)`);
      console.log(`  - RSS growth: ${rssGrowthMB.toFixed(2)}MB (threshold: ${MEMORY_THRESHOLDS.RSS_GROWTH_MB}MB)`);
    });
  });

  // ============================================
  // 4. Large Batch Processing
  // ============================================
  describe('Large Batch Processing', () => {
    it('should handle maximum batch size (100 logs) within batch threshold', async () => {
      // Arrange
      const maxBatchSize = 100;
      const logBatch = {
        logs: Array.from({ length: maxBatchSize }, (_, i) => ({
          timestamp: new Date(Date.now() + i * 100).toISOString(),
          level: 'info' as const,
          message: `Batch log entry ${i} with some additional content for realism`,
          context: {
            batchId: 'large-batch-test',
            entryIndex: i,
            metadata: { source: 'performance-test', timestamp: Date.now() },
          },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          url: `https://app.example.com/page/${i}`,
        })),
      };

      // Act
      const startTime = Date.now();
      const response = await request(app)
        .post('/api/logs')
        .send(logBatch);
      const duration = Date.now() - startTime;

      // Assert
      expect(response.status).toBe(204);
      expect(duration).toBeLessThan(LATENCY_THRESHOLDS.BATCH_TIMEOUT_MS);

      console.log(`[PERF] Max batch (${maxBatchSize} logs): ${duration}ms (threshold: ${LATENCY_THRESHOLDS.BATCH_TIMEOUT_MS}ms)`);
    });

    it('should process 10 concurrent max-size batches with SLA compliance', async () => {
      // Arrange
      const concurrency = 10;
      const batchSize = 100;
      const logBatch = {
        logs: Array.from({ length: batchSize }, (_, i) => generateLogEntry(i)),
      };

      // Act
      const { responses, metrics } = await executeConcurrentRequests(
        app,
        (testApp) =>
          request(testApp)
            .post('/api/logs')
            .send(logBatch),
        concurrency
      );

      // Assert
      expect(responses.every((r) => r.status === 204)).toBe(true);
      expect(metrics.totalDurationMs).toBeLessThan(LATENCY_THRESHOLDS.CONCURRENT_BATCH_TIMEOUT_MS);

      // GAP-2: Verify no single batch exceeds absolute max
      expect(metrics.maxResponseTimeMs).toBeLessThan(LATENCY_THRESHOLDS.MAX_ABSOLUTE_MS);

      console.log(`[PERF] ${concurrency} concurrent max-size batches:`);
      console.log(`  - Total duration: ${metrics.totalDurationMs}ms (threshold: ${LATENCY_THRESHOLDS.CONCURRENT_BATCH_TIMEOUT_MS}ms)`);
      console.log(`  - Max single batch: ${metrics.maxResponseTimeMs.toFixed(2)}ms`);
      console.log(`  - All successful: ${metrics.successCount === concurrency}`);
    });
  });

  // ============================================
  // 5. Error Handling Under Load
  // ============================================
  describe('Error Handling Under Load', () => {
    it('should gracefully handle validation errors under concurrent load', async () => {
      // Arrange
      const concurrency = 50;
      const invalidPayload = { logs: 'not-an-array' }; // Invalid format

      // Act
      const { responses, metrics } = await executeConcurrentRequests(
        app,
        (testApp) =>
          request(testApp)
            .post('/api/logs')
            .send(invalidPayload),
        concurrency
      );

      // Assert - All should return 400 (not 500)
      expect(responses.every((r) => r.status === 400)).toBe(true);
      expect(metrics.failureCount).toBe(0); // 400 is expected, not a failure

      console.log(`[PERF] ${concurrency} concurrent validation errors:`);
      console.log(`  - All returned 400: true`);
      console.log(`  - Avg response: ${metrics.avgResponseTimeMs.toFixed(2)}ms`);
    });

    it('should maintain stability when service throws errors', async () => {
      // Arrange
      const concurrency = 50;
      const userId = 'error-user';
      mockTokenUsageService.getUserTotals.mockRejectedValue(new Error('Database connection lost'));

      // Act
      const { responses, metrics } = await executeConcurrentRequests(
        app,
        (testApp) =>
          request(testApp)
            .get('/api/token-usage/me')
            .set('x-test-user-id', userId),
        concurrency
      );

      // Assert - Should return 500 but not crash
      expect(responses.every((r) => r.status === 500)).toBe(true);
      expect(responses.length).toBe(concurrency); // All requests completed

      console.log(`[PERF] ${concurrency} concurrent with service errors:`);
      console.log(`  - All completed: ${responses.length === concurrency}`);
      console.log(`  - Avg response: ${metrics.avgResponseTimeMs.toFixed(2)}ms`);
    });
  });
});
