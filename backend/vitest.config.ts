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
      // F6-006: Only include files that should count toward coverage
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'src/__tests__/**',
        '**/*.d.ts',
        'dist/**',
        'mcp-server/**',
        'scripts/**',
        'src/types/**',
        '**/*.config.ts',
        '**/*.config.js',
        '**/*.config.mjs',
        // F6-006: Infrastructure/Integration exclusions (not unit-testable)
        'src/server.ts',
        'src/config/keyvault.ts',
        'src/config/redis.ts',
        'src/config/database.ts',
        'src/config/index.ts',
        'src/routes/auth-mock.ts',
        'src/services/mcp/testMCPConnection.ts',
        'src/services/mcp/index.ts',
        'src/services/bc/index.ts',
        'src/services/auth/index.ts',
        'src/services/token-usage/index.ts',
        'src/services/agent/index.ts',
        'src/services/agent/IAnthropicClient.ts',
        'src/services/agent/IBCDataStore.ts',
        'src/services/agent/AnthropicClient.ts',
        'src/services/agent/FakeAnthropicClient.ts',
        'src/services/agent/FileSystemBCDataStore.ts',
        'src/services/agent/InMemoryBCDataStore.ts',
        'src/utils/databaseKeepalive.ts',
        'src/constants/queue.ts',
        'src/services/cache/ToolUseTracker.ts',
        'src/schemas/request.schemas.ts',
        'src/services/todo/TodoManager.ts',  // Will be heavily refactored - skip tests
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
      // Exclude integration tests - they require real Redis/SQL connections
      // and conflict with MSW mocking. Run separately with: npm run test:integration
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
