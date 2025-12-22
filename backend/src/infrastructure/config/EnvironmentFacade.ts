/**
 * Environment Configuration Facade
 *
 * Unified API for environment detection, feature flags, and configuration.
 * Single point of import for all environment-related functionality.
 *
 * This facade combines three core configuration modules:
 * - environment-detection: Runtime environment detection (dev/prod/test/e2e)
 * - feature-flags: Feature toggles for agent behavior, testing, and logging
 * - environment: Zod-validated environment variables from .env
 *
 * **Usage:**
 *
 * @example
 * import { Environment } from '@/infrastructure/config/EnvironmentFacade';
 *
 * // Environment checks
 * if (Environment.isDevelopment()) {
 *   console.log('Running in development mode');
 * }
 *
 * // Feature flags
 * if (Environment.features.agent.promptCaching) {
 *   // Enable prompt caching for Claude API
 * }
 *
 * // Environment variables
 * const apiKey = Environment.env.ANTHROPIC_API_KEY;
 * const port = Environment.env.PORT;
 *
 * // Runtime configuration
 * console.log(Environment.runtime.normalized); // 'development'
 * console.log(Environment.runtime.isE2E); // false
 *
 * // Debug information
 * console.log(Environment.info());
 *
 * @module infrastructure/config/EnvironmentFacade
 */

import {
  isDevelopment,
  isProduction,
  isTest,
  isE2E,
  runtimeEnvironment,
  type EnvironmentConfig,
} from './environment-detection';
import { featureFlags, type FeatureFlags } from './feature-flags';
import { env } from './environment';

/**
 * Masks sensitive values in strings
 *
 * Replaces all but the first and last 4 characters with asterisks.
 * Useful for displaying API keys, passwords, and tokens in logs.
 *
 * @param value - The sensitive string to mask
 * @param showChars - Number of characters to show at start/end (default: 4)
 * @returns Masked string
 *
 * @example
 * maskSensitive('sk-ant-api03-1234567890abcdef')
 * // Returns: 'sk-a***************cdef'
 *
 * @example
 * maskSensitive(undefined) // Returns: '[not set]'
 * maskSensitive('short') // Returns: 's***t'
 */
function maskSensitive(value: string | undefined, showChars = 4): string {
  if (!value || value === '') {
    return '[not set]';
  }

  if (value.length <= showChars * 2) {
    // Short values: show first and last char only
    const firstChar = value[0];
    const lastChar = value[value.length - 1];
    return `${firstChar ?? ''}***${lastChar ?? ''}`;
  }

  const start = value.slice(0, showChars);
  const end = value.slice(-showChars);
  const masked = '*'.repeat(Math.min(15, value.length - showChars * 2));

  return `${start}${masked}${end}`;
}

/**
 * Formats a boolean value as enabled/disabled string
 *
 * @param value - The boolean value
 * @returns 'enabled' or 'disabled'
 *
 * @example
 * formatBoolean(true) // Returns: 'enabled'
 * formatBoolean(false) // Returns: 'disabled'
 */
function formatBoolean(value: boolean): string {
  return value ? 'enabled' : 'disabled';
}

/**
 * Generates a formatted configuration summary
 *
 * Creates a human-readable summary of the current environment configuration
 * including environment detection, feature flags, and key environment variables.
 * Sensitive values (API keys, passwords) are masked for security.
 *
 * **Output includes:**
 * - Current normalized environment (development/production/test)
 * - E2E mode status
 * - All feature flags grouped by category (agent, testing, logging)
 * - Key environment variables (with sensitive values masked)
 *
 * **Security:**
 * - API keys are masked (show first/last 4 chars only)
 * - Passwords are masked
 * - Connection strings are masked
 * - Public values (ports, URLs, booleans) are shown in full
 *
 * @returns Formatted configuration summary as multi-line string
 *
 * @example
 * console.log(Environment.info());
 * // Output:
 * // Environment Configuration:
 * // - Environment: development
 * // - E2E Mode: disabled
 * //
 * // Feature Flags:
 * //   Agent:
 * //     - Prompt Caching: enabled
 * //     - Extended Thinking: enabled
 * //     - Max Context Tokens: 100000
 * //   Testing:
 * //     - Skip Claude Tests: enabled
 * //     - Skip BC Tests: enabled
 * //   Logging:
 * //     - File Logging: disabled
 * //     - Log Level: info
 * //
 * // Environment Variables:
 * //   - PORT: 3001
 * //   - Anthropic API Key: sk-a***************cdef
 * //   - Database Server: sqlsrv-bcagent-dev.database.windows.net
 * //   - Redis Host: redis-bcagent-dev.redis.cache.windows.net
 */
function info(): string {
  const lines: string[] = [];

  // Environment detection
  lines.push('Environment Configuration:');
  lines.push(`- Environment: ${runtimeEnvironment.normalized}`);
  lines.push(`- E2E Mode: ${formatBoolean(runtimeEnvironment.isE2E)}`);
  lines.push('');

  // Feature flags
  lines.push('Feature Flags:');
  lines.push('  Agent:');
  lines.push(`    - Prompt Caching: ${formatBoolean(featureFlags.agent.promptCaching)}`);
  lines.push(`    - Extended Thinking: ${formatBoolean(featureFlags.agent.extendedThinking)}`);
  lines.push(`    - Max Context Tokens: ${featureFlags.agent.maxContextTokens}`);
  lines.push('  Testing:');
  lines.push(`    - Skip Claude Tests: ${formatBoolean(featureFlags.testing.skipClaudeTests)}`);
  lines.push(`    - Skip BC Tests: ${formatBoolean(featureFlags.testing.skipBCTests)}`);
  lines.push('  Logging:');
  lines.push(`    - File Logging: ${formatBoolean(featureFlags.logging.fileLogging)}`);
  lines.push(`    - Log Level: ${featureFlags.logging.logLevel}`);
  lines.push('');

  // Environment variables (key ones only, with masking)
  lines.push('Environment Variables:');
  lines.push(`  - PORT: ${env.PORT}`);
  lines.push(`  - Anthropic API Key: ${maskSensitive(env.ANTHROPIC_API_KEY)}`);
  lines.push(`  - Anthropic Model: ${env.ANTHROPIC_MODEL}`);
  lines.push(`  - Database Server: ${env.DATABASE_SERVER ?? '[not set]'}`);
  lines.push(`  - Database Name: ${env.DATABASE_NAME ?? '[not set]'}`);
  lines.push(`  - Database User: ${env.DATABASE_USER ?? '[not set]'}`);
  lines.push(`  - Database Password: ${maskSensitive(env.DATABASE_PASSWORD)}`);
  lines.push(`  - Redis Host: ${env.REDIS_HOST ?? '[not set]'}`);
  lines.push(`  - Redis Port: ${env.REDIS_PORT ?? '[not set]'}`);
  lines.push(`  - Redis Password: ${maskSensitive(env.REDIS_PASSWORD)}`);
  lines.push(`  - BC API URL: ${env.BC_API_URL}`);
  lines.push(`  - BC Environment: ${env.BC_ENVIRONMENT}`);
  lines.push(`  - BC Tenant ID: ${maskSensitive(env.BC_TENANT_ID)}`);
  lines.push(`  - BC Client ID: ${maskSensitive(env.BC_CLIENT_ID)}`);
  lines.push(`  - BC Client Secret: ${maskSensitive(env.BC_CLIENT_SECRET)}`);
  lines.push(`  - Microsoft Client ID: ${maskSensitive(env.MICROSOFT_CLIENT_ID)}`);
  lines.push(`  - Microsoft Client Secret: ${maskSensitive(env.MICROSOFT_CLIENT_SECRET)}`);
  lines.push(`  - Microsoft Tenant ID: ${env.MICROSOFT_TENANT_ID}`);
  lines.push(`  - Session Secret: ${maskSensitive(env.SESSION_SECRET)}`);
  lines.push(`  - Session Max Age: ${env.SESSION_MAX_AGE}ms`);
  lines.push(`  - Encryption Key: ${maskSensitive(env.ENCRYPTION_KEY)}`);
  lines.push(`  - Frontend URL: ${env.FRONTEND_URL}`);
  lines.push(`  - CORS Origin: ${env.CORS_ORIGIN}`);

  return lines.join('\n');
}

/**
 * Unified Environment Configuration API
 *
 * Single point of import for all environment-related functionality.
 * Combines environment detection, feature flags, and validated configuration.
 *
 * **Structure:**
 *
 * ```typescript
 * Environment = {
 *   // Environment detection helpers
 *   isDevelopment: () => boolean,
 *   isProduction: () => boolean,
 *   isTest: () => boolean,
 *   isE2E: () => boolean,
 *
 *   // Runtime environment config
 *   runtime: EnvironmentConfig,
 *
 *   // Feature flags
 *   features: FeatureFlags,
 *
 *   // Validated environment variables
 *   env: typeof env,
 *
 *   // Debug helper
 *   info: () => string,
 * }
 * ```
 *
 * **Usage Examples:**
 *
 * @example
 * // Environment checks
 * if (Environment.isDevelopment()) {
 *   console.log('Dev mode: verbose logging enabled');
 * }
 *
 * if (Environment.isE2E()) {
 *   console.log('E2E mode: using Playwright test database');
 * }
 *
 * @example
 * // Feature flags
 * if (Environment.features.agent.promptCaching) {
 *   messages[0].cache_control = { type: 'ephemeral' };
 * }
 *
 * const maxTokens = Environment.features.agent.maxContextTokens;
 *
 * @example
 * // Environment variables
 * const apiKey = Environment.env.ANTHROPIC_API_KEY;
 * const dbServer = Environment.env.DATABASE_SERVER;
 * const port = Environment.env.PORT;
 *
 * @example
 * // Runtime configuration
 * console.log(Environment.runtime.normalized); // 'development'
 * console.log(Environment.runtime.raw); // 'dev'
 *
 * @example
 * // Debug information (startup logging)
 * console.log(Environment.info());
 * // Prints formatted configuration summary with masked secrets
 *
 * @example
 * // Complete service initialization
 * import { Environment } from '@/infrastructure/config/EnvironmentFacade';
 *
 * class MyService {
 *   constructor() {
 *     // Use environment detection
 *     if (Environment.isDevelopment()) {
 *       this.enableDebugMode();
 *     }
 *
 *     // Use feature flags
 *     this.useCaching = Environment.features.agent.promptCaching;
 *
 *     // Use environment variables
 *     this.apiKey = Environment.env.ANTHROPIC_API_KEY;
 *   }
 * }
 */
export const Environment = {
  /**
   * Check if the current environment is development
   *
   * @returns True if normalized environment is 'development'
   *
   * @example
   * if (Environment.isDevelopment()) {
   *   console.log('Development mode: debug logging enabled');
   * }
   */
  isDevelopment,

  /**
   * Check if the current environment is production
   *
   * @returns True if normalized environment is 'production'
   *
   * @example
   * if (Environment.isProduction()) {
   *   console.log('Production mode: optimizations enabled');
   * }
   */
  isProduction,

  /**
   * Check if the current environment is test
   *
   * @returns True if normalized environment is 'test'
   *
   * @example
   * if (Environment.isTest()) {
   *   console.log('Test mode: using test database');
   * }
   */
  isTest,

  /**
   * Check if the current environment is E2E testing
   *
   * @returns True if NODE_ENV contains 'e2e'
   *
   * @example
   * if (Environment.isE2E()) {
   *   console.log('E2E mode: using Playwright test database');
   * }
   */
  isE2E,

  /**
   * Runtime environment configuration
   *
   * Contains raw NODE_ENV value, normalized environment, and all detection flags.
   *
   * @type {EnvironmentConfig}
   *
   * @example
   * console.log(Environment.runtime.normalized); // 'development'
   * console.log(Environment.runtime.raw); // 'dev'
   * console.log(Environment.runtime.isDevelopment); // true
   * console.log(Environment.runtime.isE2E); // false
   */
  runtime: runtimeEnvironment,

  /**
   * Feature flags configuration
   *
   * Contains all feature toggles organized by domain (agent, testing, logging).
   *
   * @type {FeatureFlags}
   *
   * @example
   * // Agent flags
   * const useCaching = Environment.features.agent.promptCaching;
   * const maxTokens = Environment.features.agent.maxContextTokens;
   *
   * // Testing flags
   * const skipClaude = Environment.features.testing.skipClaudeTests;
   *
   * // Logging flags
   * const logLevel = Environment.features.logging.logLevel;
   */
  features: featureFlags,

  /**
   * Validated environment variables
   *
   * Zod-validated environment variables from .env file or Azure Key Vault.
   * All values are type-safe and validated against schema.
   *
   * @type {typeof env}
   *
   * @example
   * // Server configuration
   * const port = Environment.env.PORT; // number
   * const corsOrigin = Environment.env.CORS_ORIGIN; // string
   *
   * // API keys
   * const anthropicKey = Environment.env.ANTHROPIC_API_KEY; // string | undefined
   *
   * // Database configuration
   * const dbServer = Environment.env.DATABASE_SERVER; // string | undefined
   * const dbName = Environment.env.DATABASE_NAME; // string | undefined
   *
   * // Feature toggles (deprecated - use features instead)
   * const promptCaching = Environment.env.ENABLE_PROMPT_CACHING; // boolean
   */
  env,

  /**
   * Generate formatted configuration summary
   *
   * Creates a human-readable summary of the current environment configuration
   * including environment detection, feature flags, and key environment variables.
   * Sensitive values are masked for security.
   *
   * **Useful for:**
   * - Startup logging (print on server initialization)
   * - Debugging configuration issues
   * - Verifying environment setup in logs
   * - Generating configuration reports
   *
   * **Security:**
   * - API keys are masked
   * - Passwords are masked
   * - Connection strings are masked
   * - Only first/last 4 characters shown for secrets
   *
   * @returns Formatted configuration summary as multi-line string
   *
   * @example
   * // Startup logging
   * console.log(Environment.info());
   *
   * @example
   * // Write to log file
   * import { logger } from '@/shared/utils/logger';
   * logger.info(Environment.info(), 'Environment configuration loaded');
   *
   * @example
   * // Debug endpoint
   * app.get('/api/debug/config', (req, res) => {
   *   res.type('text/plain').send(Environment.info());
   * });
   */
  info,
} as const;

/**
 * Type export for Environment configuration
 */
export type { EnvironmentConfig, FeatureFlags };
