/**
 * Feature Flags Configuration
 *
 * Centralized feature flag management with environment-based defaults.
 * All feature flags are loaded from environment variables or computed
 * based on runtime environment (dev/prod/test).
 *
 * @module config/feature-flags
 *
 * @example
 * import { featureFlags } from '@config/feature-flags';
 *
 * if (featureFlags.agent.promptCaching) {
 *   // Use prompt caching for better performance
 * }
 *
 * if (featureFlags.testing.skipClaudeTests) {
 *   // Skip expensive Claude API tests in development
 * }
 */

import { isProduction } from './environment-detection';

/**
 * Valid log level values for structured logging
 *
 * Levels (from most to least verbose):
 * - trace: Extremely detailed debugging (function entry/exit, variable values)
 * - debug: Detailed debugging (algorithm steps, state changes)
 * - info: General informational messages (normal operations)
 * - warn: Warning messages (recoverable errors, deprecations)
 * - error: Error messages (failures, exceptions)
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Agent-related feature flags
 *
 * Controls Claude AI agent behavior and optimizations.
 */
export interface AgentFeatureFlags {
  /**
   * Enable prompt caching for Claude API calls
   *
   * **What it does:**
   * Enables Anthropic's prompt caching feature to reuse system prompts
   * and tool definitions across multiple API calls, reducing latency
   * and token usage.
   *
   * **Impact:**
   * - Reduces API latency by 50-80% on subsequent calls
   * - Reduces token costs by reusing cached prompt segments
   * - First call still pays full cost to populate cache
   *
   * **Environment variable:** ENABLE_PROMPT_CACHING
   * **Default:** true
   *
   * **When to enable:**
   * - Production environments (cost optimization)
   * - Long-running chat sessions with consistent system prompts
   *
   * **When to disable:**
   * - Testing scenarios where fresh prompts are needed
   * - Debugging prompt content changes
   *
   * @example
   * // Enable in .env
   * ENABLE_PROMPT_CACHING=true
   *
   * @example
   * // Check in code
   * if (featureFlags.agent.promptCaching) {
   *   // Add cache_control blocks to system messages
   * }
   */
  promptCaching: boolean;

  /**
   * Enable extended thinking mode for Claude
   *
   * **What it does:**
   * Allows Claude to use extended thinking (<thinking> tags) for
   * complex reasoning tasks. The agent shows "thinking" status to
   * users and emits thinking content via WebSocket events.
   *
   * **Impact:**
   * - Improves response quality for complex queries
   * - Increases API latency (thinking time is extra)
   * - Increases token usage (thinking tokens count)
   * - Better transparency (users see reasoning process)
   *
   * **Environment variable:** ENABLE_EXTENDED_THINKING
   * **Default:** true
   *
   * **When to enable:**
   * - Complex Business Central queries requiring multi-step reasoning
   * - Scenarios where transparency is valued over speed
   * - Production environments (better quality responses)
   *
   * **When to disable:**
   * - Speed-critical applications
   * - Simple query/response flows
   * - Cost-sensitive environments
   *
   * @example
   * // Enable in .env
   * ENABLE_EXTENDED_THINKING=true
   *
   * @example
   * // Check in code
   * if (featureFlags.agent.extendedThinking) {
   *   // Emit 'thinking' events via WebSocket
   * }
   */
  extendedThinking: boolean;

  /**
   * Maximum context window tokens for Claude API
   *
   * **What it does:**
   * Sets the maximum number of tokens Claude can use in its context
   * window (system prompt + conversation history + tool results).
   *
   * **Impact:**
   * - Higher values: More conversation history, better context, higher cost
   * - Lower values: Less history, potential context loss, lower cost
   * - Claude Sonnet 4.5 supports up to 200k tokens
   *
   * **Environment variable:** MAX_CONTEXT_TOKENS
   * **Default:** 100000 (100k tokens)
   *
   * **Recommended values:**
   * - Development: 50000 (cost optimization)
   * - Production: 100000 (balance of cost and context)
   * - Enterprise: 200000 (maximum context for complex scenarios)
   *
   * **When to increase:**
   * - Long conversation threads with extensive history
   * - Complex Business Central queries requiring many tool results
   * - Multi-step approval workflows with context preservation
   *
   * **When to decrease:**
   * - Cost-sensitive environments
   * - Short-lived sessions
   * - Simple query/response patterns
   *
   * @example
   * // Set in .env
   * MAX_CONTEXT_TOKENS=100000
   *
   * @example
   * // Check in code
   * const maxTokens = featureFlags.agent.maxContextTokens;
   * if (estimatedTokens > maxTokens) {
   *   // Truncate conversation history
   * }
   */
  maxContextTokens: number;
}

/**
 * Testing-related feature flags
 *
 * Controls which tests are skipped in different environments.
 */
export interface TestingFeatureFlags {
  /**
   * Skip tests that make real Claude API calls
   *
   * **What it does:**
   * Skips integration tests that call Anthropic's Claude API.
   * Prevents unnecessary API costs and latency during development.
   *
   * **Impact:**
   * - Development: Skips expensive API tests (faster test runs)
   * - Production: Runs all tests including API integration tests
   * - CI/CD: Controlled by NODE_ENV setting
   *
   * **Computed from:** !isProduction()
   * **Default:** true in dev/test, false in production
   *
   * **When to skip (true):**
   * - Local development (use FakeAnthropicClient instead)
   * - Unit test runs (mock API responses)
   * - Cost-sensitive test environments
   *
   * **When to run (false):**
   * - Production validation
   * - Pre-deployment integration tests
   * - API contract verification
   *
   * @example
   * // In test file
   * test.skipIf(featureFlags.testing.skipClaudeTests)(
   *   'should stream Claude responses',
   *   async () => {
   *     // Real API call here
   *   }
   * );
   *
   * @example
   * // Check environment
   * NODE_ENV=production npm test  // Runs Claude tests
   * NODE_ENV=development npm test // Skips Claude tests
   */
  skipClaudeTests: boolean;

  /**
   * Skip tests that make real Business Central API calls
   *
   * **What it does:**
   * Always skips integration tests that call Business Central OData API.
   * BC tests require complex setup (tenant, credentials, test data)
   * and are not suitable for CI/CD pipelines.
   *
   * **Impact:**
   * - Always true (hardcoded)
   * - BC integration tests never run automatically
   * - Manual testing required for BC functionality
   *
   * **Hardcoded:** true (always skip)
   * **Default:** true
   *
   * **Why always skip:**
   * - Requires valid BC tenant and credentials
   * - Requires test data setup in BC environment
   * - BC API calls have side effects (create/update/delete)
   * - Not suitable for automated testing
   *
   * **Alternative testing approaches:**
   * - Use MSW (Mock Service Worker) to mock BC API responses
   * - Manual testing against BC sandbox environment
   * - E2E tests with mocked BC backend
   *
   * @example
   * // In test file (always skipped)
   * test.skipIf(featureFlags.testing.skipBCTests)(
   *   'should create customer in Business Central',
   *   async () => {
   *     // Real BC API call here (never runs)
   *   }
   * );
   *
   * @example
   * // Use MSW mocks instead
   * test('should handle BC customer creation', async () => {
   *   // MSW intercepts and mocks the BC API call
   * });
   */
  skipBCTests: boolean;
}

/**
 * Logging-related feature flags
 *
 * Controls logging behavior and output destinations.
 */
export interface LoggingFeatureFlags {
  /**
   * Enable file-based logging in addition to console
   *
   * **What it does:**
   * Writes log messages to rotating log files in addition to console output.
   * Useful for production debugging and audit trails.
   *
   * **Impact:**
   * - Writes logs to ./logs directory (auto-created)
   * - Creates date-based log files (e.g., app-2025-12-07.log)
   * - Rotates logs automatically (daily rotation)
   * - Small I/O overhead for file writes
   *
   * **Environment variable:** ENABLE_FILE_LOGGING
   * **Default:** false
   *
   * **When to enable:**
   * - Production environments (audit trail)
   * - Debugging complex issues (persistent logs)
   * - Compliance requirements (log retention)
   *
   * **When to disable:**
   * - Development (console is sufficient)
   * - Serverless environments (use cloud logging instead)
   * - Docker containers (use stdout/stderr)
   *
   * @example
   * // Enable in .env
   * ENABLE_FILE_LOGGING=true
   *
   * @example
   * // Check in code
   * if (featureFlags.logging.fileLogging) {
   *   // Configure Pino file transport
   * }
   */
  fileLogging: boolean;

  /**
   * Log level for structured logging
   *
   * **What it does:**
   * Sets the minimum log level for Pino structured logger.
   * Only messages at this level or higher are output.
   *
   * **Impact:**
   * - error: Only errors (production, minimal logging)
   * - warn: Errors + warnings (production, normal)
   * - info: Normal operations (production, verbose)
   * - debug: Detailed debugging (development)
   * - trace: Extremely verbose (troubleshooting)
   *
   * **Environment variable:** LOG_LEVEL
   * **Default:** 'info'
   *
   * **Recommended by environment:**
   * - Production: 'warn' or 'info'
   * - Development: 'debug'
   * - Troubleshooting: 'trace'
   * - Testing: 'error' (quiet tests)
   *
   * **Performance impact:**
   * - trace/debug: High overhead (many log calls)
   * - info: Moderate overhead (normal operations)
   * - warn/error: Low overhead (exceptional cases only)
   *
   * @example
   * // Set in .env
   * LOG_LEVEL=debug
   *
   * @example
   * // Check in code
   * logger.setLevel(featureFlags.logging.logLevel);
   */
  logLevel: LogLevel;
}

/**
 * Complete feature flags configuration
 *
 * Single source of truth for all feature flags across the application.
 * Organized by domain (agent, testing, logging) for clarity.
 */
export interface FeatureFlags {
  /** Agent-related feature flags (Claude API behavior) */
  agent: AgentFeatureFlags;
  /** Testing-related feature flags (test skipping logic) */
  testing: TestingFeatureFlags;
  /** Logging-related feature flags (log output and levels) */
  logging: LoggingFeatureFlags;
}

/**
 * Validates and normalizes a log level string
 *
 * @param level - The log level string to validate
 * @returns Validated log level or 'info' as fallback
 *
 * @example
 * validateLogLevel('debug') // returns 'debug'
 * validateLogLevel('invalid') // returns 'info' (fallback)
 * validateLogLevel(undefined) // returns 'info' (fallback)
 */
function validateLogLevel(level: string | undefined): LogLevel {
  const validLevels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
  const normalized = (level ?? '').toLowerCase().trim();

  if (validLevels.includes(normalized as LogLevel)) {
    return normalized as LogLevel;
  }

  // Fallback to 'info' for invalid values
  return 'info';
}

/**
 * Parses a boolean environment variable
 *
 * Accepts common boolean representations:
 * - true: 'true', 'TRUE', 'True', '1', 'yes', 'YES'
 * - false: 'false', 'FALSE', 'False', '0', 'no', 'NO', undefined
 *
 * @param value - The environment variable value
 * @param defaultValue - The default value if undefined or invalid
 * @returns Parsed boolean value
 *
 * @example
 * parseBoolean('true', false) // returns true
 * parseBoolean('1', false) // returns true
 * parseBoolean('yes', false) // returns true
 * parseBoolean(undefined, false) // returns false
 * parseBoolean('invalid', false) // returns false
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();

  // True values
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  // False values
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  // Fallback to default for invalid values
  return defaultValue;
}

/**
 * Parses an integer environment variable
 *
 * @param value - The environment variable value
 * @param defaultValue - The default value if undefined or invalid
 * @returns Parsed integer value
 *
 * @example
 * parseInteger('100000', 50000) // returns 100000
 * parseInteger('invalid', 50000) // returns 50000
 * parseInteger(undefined, 50000) // returns 50000
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);

  // Return parsed value if valid number
  if (!isNaN(parsed)) {
    return parsed;
  }

  // Fallback to default for invalid values
  return defaultValue;
}

/**
 * Loads feature flags from environment variables
 *
 * **Environment variables:**
 * - ENABLE_PROMPT_CACHING: Enable Claude prompt caching (default: true)
 * - ENABLE_EXTENDED_THINKING: Enable Claude extended thinking (default: true)
 * - MAX_CONTEXT_TOKENS: Maximum context tokens for Claude (default: 100000)
 * - ENABLE_FILE_LOGGING: Enable file-based logging (default: false)
 * - LOG_LEVEL: Structured logging level (default: 'info')
 *
 * **Computed flags:**
 * - skipClaudeTests: Computed from !isProduction()
 * - skipBCTests: Hardcoded to true (always skip)
 *
 * @returns Complete feature flags configuration
 *
 * @example
 * // Load flags once at startup
 * const flags = loadFeatureFlags();
 * console.log('Prompt caching:', flags.agent.promptCaching);
 * console.log('Log level:', flags.logging.logLevel);
 */
export function loadFeatureFlags(): FeatureFlags {
  return {
    agent: {
      promptCaching: parseBoolean(process.env.ENABLE_PROMPT_CACHING, true),
      extendedThinking: parseBoolean(process.env.ENABLE_EXTENDED_THINKING, true),
      maxContextTokens: parseInteger(process.env.MAX_CONTEXT_TOKENS, 100000),
    },
    testing: {
      // Skip expensive Claude API tests in development
      // Run them in production for integration validation
      skipClaudeTests: !isProduction(),

      // Always skip BC tests - they require complex tenant setup
      // and have side effects that make them unsuitable for CI/CD
      skipBCTests: true,
    },
    logging: {
      fileLogging: parseBoolean(process.env.ENABLE_FILE_LOGGING, false),
      logLevel: validateLogLevel(process.env.LOG_LEVEL),
    },
  };
}

/**
 * Runtime feature flags (computed once on module load)
 *
 * Single source of truth for feature flags throughout the application.
 * Computed immediately when this module is imported to ensure consistency.
 *
 * **Usage:**
 * Import this constant anywhere in the application to access feature flags.
 * Do not call loadFeatureFlags() directly - always use this constant.
 *
 * @example
 * import { featureFlags } from '@config/feature-flags';
 *
 * // Agent configuration
 * if (featureFlags.agent.promptCaching) {
 *   messages[0].cache_control = { type: 'ephemeral' };
 * }
 *
 * // Test skipping
 * test.skipIf(featureFlags.testing.skipClaudeTests)(
 *   'should call Claude API',
 *   async () => { ... }
 * );
 *
 * // Logging configuration
 * logger.setLevel(featureFlags.logging.logLevel);
 *
 * @example
 * // Check all flags
 * console.log('Feature flags:', {
 *   promptCaching: featureFlags.agent.promptCaching,
 *   extendedThinking: featureFlags.agent.extendedThinking,
 *   maxContextTokens: featureFlags.agent.maxContextTokens,
 *   skipClaudeTests: featureFlags.testing.skipClaudeTests,
 *   skipBCTests: featureFlags.testing.skipBCTests,
 *   fileLogging: featureFlags.logging.fileLogging,
 *   logLevel: featureFlags.logging.logLevel,
 * });
 */
export const featureFlags: FeatureFlags = loadFeatureFlags();
