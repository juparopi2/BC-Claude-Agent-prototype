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

    // Load .env file with absolute path
    env: {
      // This ensures the .env file is loaded from the backend directory
    },

    // Longer timeouts for real DB operations
    testTimeout: 60000,
    hookTimeout: 60000,

    // Setup file that loads environment variables
    setupFiles: [path.resolve(__dirname, 'src/__tests__/integration/setup.env.ts')],
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
