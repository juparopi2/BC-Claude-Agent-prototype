import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // Integration tests need DOM for React hooks
    include: ['__tests__/integration/**/*.test.ts'],
    setupFiles: ['__tests__/setup/integrationSetup.ts'],
    testTimeout: 30000, // Longer timeout for integration tests
    alias: {
      '@': path.resolve(__dirname, './lib'),
    },
  },
});
