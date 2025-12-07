/**
 * E2E Test Configuration - Environment-Based Test Gating
 *
 * This module controls which E2E tests run based on the environment.
 * Claude API tests only run when deploying to production to minimize token usage.
 *
 * Environment Detection:
 * - NODE_ENV starting with "dev" (DEV, dev, DEVELOPMENT, development) → dev environment (skip Claude tests)
 * - NODE_ENV starting with "prod" (PROD, prod, PRODUCTION, production) → prod environment (run Claude tests)
 * - Default: dev environment
 *
 * Usage in tests:
 * ```typescript
 * import { E2E_CONFIG, shouldRunClaudeTests } from './setup/testConfig';
 *
 * test.describe('Claude API Tests', () => {
 *   test.skip(!shouldRunClaudeTests(), 'Claude tests only run in production environment');
 *
 *   test('should handle Claude API call', async () => {
 *     // Test that requires real Claude API
 *   });
 * });
 * ```
 *
 * @module e2e/setup/testConfig
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from backend/.env
dotenv.config({ path: path.join(__dirname, '../../backend/.env') });

/**
 * E2E Test Configuration
 *
 * Determines which tests to run based on NODE_ENV value.
 * Uses case-insensitive detection for flexibility.
 */
export const E2E_CONFIG = {
  /**
   * Detected environment ('dev' or 'prod')
   *
   * Logic:
   * 1. Read NODE_ENV from .env (or use 'development' as default)
   * 2. Convert to lowercase
   * 3. Check if starts with 'dev' → return 'dev'
   * 4. Check if starts with 'prod' → return 'prod'
   * 5. Default to 'dev' if neither matches
   */
  ENVIRONMENT: (() => {
    const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
    if (nodeEnv.startsWith('dev')) return 'dev';
    if (nodeEnv.startsWith('prod')) return 'prod';
    return 'dev'; // Default to dev for safety
  })(),

  /**
   * Whether to run Claude API tests
   *
   * Only runs when NODE_ENV starts with 'prod' (case-insensitive)
   * This minimizes Claude API token usage in dev/CI environments.
   */
  RUN_CLAUDE_TESTS: (() => {
    const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
    return nodeEnv.startsWith('prod');
  })(),

  /**
   * Original NODE_ENV value (for debugging)
   */
  RAW_NODE_ENV: process.env.NODE_ENV || 'development',

  /**
   * Azure resource suffix (for reference)
   * Used to verify we're targeting correct Azure resources
   */
  AZURE_SUFFIX: process.env.AZURE_SUFFIX || 'dev',
};

/**
 * Check if Claude API tests should run
 *
 * Returns true only when NODE_ENV starts with 'prod'.
 * This function is the primary gate for expensive tests.
 *
 * @returns {boolean} - true if Claude tests should run
 *
 * @example
 * ```typescript
 * test.describe('Expensive Tests', () => {
 *   test.skip(!shouldRunClaudeTests(), 'Only runs in production environment');
 *   // ... tests
 * });
 * ```
 */
export function shouldRunClaudeTests(): boolean {
  return E2E_CONFIG.RUN_CLAUDE_TESTS;
}

/**
 * Check if running in development environment
 *
 * @returns {boolean} - true if NODE_ENV starts with 'dev'
 */
export function isDevEnvironment(): boolean {
  return E2E_CONFIG.ENVIRONMENT === 'dev';
}

/**
 * Check if running in production environment
 *
 * @returns {boolean} - true if NODE_ENV starts with 'prod'
 */
export function isProdEnvironment(): boolean {
  return E2E_CONFIG.ENVIRONMENT === 'prod';
}

/**
 * Get human-readable environment description
 *
 * @returns {string} - Description of current environment and test mode
 */
export function getEnvironmentDescription(): string {
  const env = E2E_CONFIG.ENVIRONMENT.toUpperCase();
  const claudeMode = E2E_CONFIG.RUN_CLAUDE_TESTS ? 'ENABLED' : 'DISABLED';
  return `Environment: ${env} (NODE_ENV=${E2E_CONFIG.RAW_NODE_ENV}) | Claude API Tests: ${claudeMode}`;
}

// Log configuration on import (for visibility in test runs)
console.log('\n========================================');
console.log('  E2E Test Configuration');
console.log('========================================');
console.log(getEnvironmentDescription());
console.log(`Azure Suffix: ${E2E_CONFIG.AZURE_SUFFIX}`);
console.log('========================================\n');
