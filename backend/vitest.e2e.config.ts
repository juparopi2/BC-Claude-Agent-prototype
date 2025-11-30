/**
 * Vitest Configuration for E2E Tests
 *
 * E2E tests require the full server stack running and real infrastructure.
 * They simulate a complete frontend client interacting with the backend.
 *
 * Prerequisites:
 * - Redis running (docker compose -f docker-compose.test.yml up -d)
 * - Database accessible (Azure SQL)
 * - Environment variables configured (.env)
 *
 * Run with: npm run test:e2e
 *
 * @module vitest.e2e.config
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      E2E_TEST: 'true',
    },
    // E2E tests have their own setup file
    setupFiles: './src/__tests__/e2e/setup.e2e.ts',
    // E2E tests need more time (server startup, real API calls)
    testTimeout: 90000,
    hookTimeout: 120000,
    // Only run E2E test files
    include: [
      'src/__tests__/e2e/**/*.test.ts',
      'src/__tests__/e2e/**/*.e2e.test.ts',
    ],
    // Exclude unit and integration tests
    exclude: [
      'node_modules',
      'dist',
      'src/__tests__/unit/**',
      'src/__tests__/integration/**',
      'src/__tests__/fixtures/**',
      'src/__tests__/helpers/**',
      'src/__tests__/mocks/**',
    ],
    // Run tests sequentially to avoid port conflicts
    sequence: {
      shuffle: false,
    },
    // Single thread to avoid server conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // No coverage for E2E tests (they test integration, not code paths)
    coverage: {
      enabled: false,
    },
    // Report test names clearly
    reporters: ['verbose'],
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
