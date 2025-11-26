import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './src/__tests__/setup.ts',
    testTimeout: 10000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        'dist/',
        'mcp-server/',
        'scripts/',           // Exclude migration/seed scripts from coverage
        'src/types/**',       // Exclude type definitions
        '**/*.config.ts',     // Exclude config files
        '**/*.config.js',     // Exclude config files
        '**/*.config.mjs',    // Exclude config files
      ],
      // F6-006: Coverage threshold set to 59% (current baseline: 59.72%)
      // DirectAgentService: 93.59% (up from 4%)
      // server.ts: 0% (requires integration tests - excluded from unit test coverage)
      // Phase 3 goal: Reach 70% by adding integration tests for server.ts
      // Last updated: 2025-11-25
      thresholds: {
        branches: 59,
        functions: 59,
        lines: 59,
        statements: 59,
      },
    },
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules',
      'dist',
      'mcp-server',
      // Exclude integration tests from default test run
      // Use npm run test:integration to run these
      'src/**/*.integration.test.ts',
      'src/**/*.integration.spec.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
