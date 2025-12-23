import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration Test Configuration
 *
 * Runs tests that require REAL external services (Redis, Azure SQL).
 * These tests connect to actual infrastructure and verify end-to-end behavior.
 *
 * IMPORTANT: Tests that mock infrastructure (database, redis) should NOT be
 * in this suite. Those are functional tests and belong in unit/ or functional/.
 *
 * Usage:
 *   npm run test:integration
 *
 * Prerequisites:
 *   - Docker Redis: docker compose -f docker-compose.test.yml up -d
 *   - Azure SQL: DATABASE_* environment variables configured
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Global setup/teardown for infrastructure lifecycle
    // Runs ONCE before/after ALL test files (not per-file)
    globalSetup: path.resolve(__dirname, 'src/__tests__/integration/globalSetup.ts'),

    // Load .env file for test configuration
    setupFiles: [path.resolve(__dirname, 'src/__tests__/integration/setup.env.ts')],

    // Longer timeouts for real DB/Redis operations
    testTimeout: 60000,
    hookTimeout: 60000,

    // Include only true integration tests (no infrastructure mocks)
    include: ['src/__tests__/integration/**/*.integration.test.ts'],

    // Exclude tests that mock infrastructure - these are NOT integration tests
    exclude: [
      'node_modules',
      'dist',
      'mcp-server',
    ],

    // Run tests sequentially to avoid DB/Redis race conditions
    sequence: {
      shuffle: false,
    },

    // Single fork ensures clean module cache per file
    // This prevents vi.mock contamination between test files
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@config': path.resolve(__dirname, './src/config'),
      '@domains': path.resolve(__dirname, './src/domains'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@infrastructure': path.resolve(__dirname, './src/infrastructure'),
      '@services': path.resolve(__dirname, './src/services'),
      '@models': path.resolve(__dirname, './src/models'),
      '@middleware': path.resolve(__dirname, './src/middleware'),
      '@types': path.resolve(__dirname, './src/types'),
      '@routes': path.resolve(__dirname, './src/routes'),
    },
  },
});
