import { defineConfig, devices } from '@playwright/test';

// Load environment variables BEFORE config export
import './e2e/setup/loadEnv';

/**
 * Playwright Configuration for BC Claude Agent E2E Tests
 *
 * Key decisions:
 * - Single worker (sessions are stateful, avoid conflicts)
 * - Auto-start webServers (backend + frontend)
 * - Chromium + Firefox (cross-browser testing)
 * - Retries in CI only (local debugging is faster without retries)
 */
export default defineConfig({
  globalSetup: require.resolve('./e2e/setup/globalSetup.ts'),
  testDir: './e2e',
  fullyParallel: false,  // Sessions are stateful, disable parallel execution
  workers: 1,            // Single worker to avoid session conflicts
  retries: process.env.CI ? 2 : 0,  // Retry only in CI
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list'],  // Console output for CI
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',           // Debug traces only when retrying
    screenshot: 'only-on-failure',     // Save screenshots on failures
    video: 'retain-on-failure',        // Save videos on failures
    actionTimeout: 10000,              // 10s timeout for actions (click, type, etc.)
    navigationTimeout: 30000,          // 30s timeout for page navigation
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  // Auto-start backend and frontend servers before tests
  webServer: [
    {
      command: 'cd backend && npm run dev',
      port: 3002,
      timeout: 120000,  // 2 minutes to start backend
      reuseExistingServer: !process.env.CI,  // Reuse local servers, fresh in CI
    },
    {
      command: process.platform === 'win32'
        ? 'cd frontend && set PORT=3000&& npm run dev'  // Windows: set PORT before command
        : 'cd frontend && PORT=3000 npm run dev',        // Unix: inline environment variable
      port: 3000,
      timeout: 120000,  // 2 minutes to start frontend
      reuseExistingServer: !process.env.CI,
    },
  ],
});
