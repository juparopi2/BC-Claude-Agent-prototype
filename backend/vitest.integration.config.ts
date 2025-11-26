import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration Test Configuration
 *
 * Runs tests that require external services (Redis, Azure SQL).
 * These tests connect to REAL infrastructure and should be run:
 * - In CI/CD with proper service connections
 * - Locally when services are available
 *
 * Usage:
 *   npm run test:integration
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './src/__tests__/setup.integration.ts',
    testTimeout: 30000, // Longer timeout for real DB operations
    hookTimeout: 30000,
    // Only run integration tests from the integration directory
    // Note: Some unit tests have .integration.test.ts naming but use mocks
    // Those should stay in unit/ and run with the normal vitest config
    include: ['src/__tests__/integration/**/*.integration.test.ts'],
    exclude: ['node_modules', 'dist', 'mcp-server'],
    // Sequence tests to avoid conflicts
    sequence: {
      shuffle: false,
    },
    // Pool configuration for integration tests
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run tests serially to avoid DB conflicts
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@config': path.resolve(__dirname, './src/config'),
      '@services': path.resolve(__dirname, './src/services'),
      '@models': path.resolve(__dirname, './src/models'),
      '@middleware': path.resolve(__dirname, './src/middleware'),
      '@types': path.resolve(__dirname, './src/types'),
      '@routes': path.resolve(__dirname, './src/routes'),
    },
  },
});
