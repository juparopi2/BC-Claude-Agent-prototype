/**
 * Environment Detection Utilities
 *
 * Provides case-insensitive NODE_ENV detection with normalized values.
 * Handles variants: dev/DEV/development, prod/PROD/production, test/TEST
 *
 * @module config/environment-detection
 */

/**
 * Normalized environment values
 */
export type NormalizedEnvironment = 'development' | 'production' | 'test';

/**
 * Environment configuration with raw and normalized values
 */
export interface EnvironmentConfig {
  /** Original NODE_ENV value from process.env */
  readonly raw: string;
  /** Normalized environment value */
  readonly normalized: NormalizedEnvironment;
  /** True if environment is development */
  readonly isDevelopment: boolean;
  /** True if environment is production */
  readonly isProduction: boolean;
  /** True if environment is test */
  readonly isTest: boolean;
  /** True if environment is E2E testing */
  readonly isE2E: boolean;
}

/**
 * Detects and normalizes the current environment from NODE_ENV
 *
 * Normalization rules:
 * - dev, DEV, development, DEVELOPMENT → 'development'
 * - prod, PROD, production, PRODUCTION → 'production'
 * - test, TEST → 'test'
 * - Default: 'development'
 *
 * @param nodeEnv - The NODE_ENV value to normalize (defaults to process.env.NODE_ENV)
 * @returns Normalized environment value
 *
 * @example
 * detectEnvironment('DEV') // returns 'development'
 * detectEnvironment('production') // returns 'production'
 * detectEnvironment('test') // returns 'test'
 * detectEnvironment(undefined) // returns 'development' (default)
 */
export function detectEnvironment(nodeEnv?: string): NormalizedEnvironment {
  // Get NODE_ENV, default to empty string for easier processing
  const env = (nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase().trim();

  // Handle empty/undefined - default to development
  if (!env) {
    return 'development';
  }

  // Check for production variants
  if (env.startsWith('prod')) {
    return 'production';
  }

  // Check for test variants
  if (env.startsWith('test')) {
    return 'test';
  }

  // Check for development variants (including 'dev')
  if (env.startsWith('dev')) {
    return 'development';
  }

  // Default to development for any unrecognized value
  return 'development';
}

/**
 * Detects if the environment is E2E testing mode
 *
 * E2E mode is detected when NODE_ENV contains 'e2e' (case-insensitive)
 * Examples: 'e2e', 'E2E', 'test-e2e', 'e2e-local'
 *
 * @param nodeEnv - The NODE_ENV value to check (defaults to process.env.NODE_ENV)
 * @returns True if environment contains 'e2e'
 *
 * @example
 * detectE2E('e2e') // returns true
 * detectE2E('test-e2e') // returns true
 * detectE2E('test') // returns false
 */
export function detectE2E(nodeEnv?: string): boolean {
  const env = (nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase().trim();
  return env.includes('e2e');
}

/**
 * Creates a complete environment configuration object
 *
 * @param nodeEnv - The NODE_ENV value to process (defaults to process.env.NODE_ENV)
 * @returns Complete environment configuration with all flags
 *
 * @example
 * const config = createEnvironmentConfig('production');
 * // Returns: {
 * //   raw: 'production',
 * //   normalized: 'production',
 * //   isDevelopment: false,
 * //   isProduction: true,
 * //   isTest: false,
 * //   isE2E: false
 * // }
 */
export function createEnvironmentConfig(nodeEnv?: string): EnvironmentConfig {
  const raw = nodeEnv ?? process.env.NODE_ENV ?? '';
  const normalized = detectEnvironment(raw);
  const isE2E = detectE2E(raw);

  return {
    raw,
    normalized,
    isDevelopment: normalized === 'development',
    isProduction: normalized === 'production',
    isTest: normalized === 'test',
    isE2E,
  };
}

/**
 * Runtime environment configuration (computed once on module load)
 *
 * Single source of truth for environment detection throughout the application.
 * Computed immediately when this module is imported to ensure consistency.
 *
 * @example
 * import { runtimeEnvironment } from '@config/environment-detection';
 *
 * if (runtimeEnvironment.isDevelopment) {
 *   console.log('Running in development mode');
 * }
 *
 * console.log(`Environment: ${runtimeEnvironment.normalized}`);
 */
export const runtimeEnvironment: EnvironmentConfig = createEnvironmentConfig();

/**
 * Checks if the current environment is development
 *
 * @returns True if normalized environment is 'development'
 *
 * @example
 * if (isDevelopment()) {
 *   console.log('Development mode enabled');
 * }
 */
export function isDevelopment(): boolean {
  return runtimeEnvironment.isDevelopment;
}

/**
 * Checks if the current environment is production
 *
 * @returns True if normalized environment is 'production'
 *
 * @example
 * if (isProduction()) {
 *   console.log('Production mode - optimizations enabled');
 * }
 */
export function isProduction(): boolean {
  return runtimeEnvironment.isProduction;
}

/**
 * Checks if the current environment is test
 *
 * @returns True if normalized environment is 'test'
 *
 * @example
 * if (isTest()) {
 *   console.log('Test mode - using test database');
 * }
 */
export function isTest(): boolean {
  return runtimeEnvironment.isTest;
}

/**
 * Checks if the current environment is E2E testing
 *
 * @returns True if NODE_ENV contains 'e2e'
 *
 * @example
 * if (isE2E()) {
 *   console.log('E2E mode - using Playwright test database');
 * }
 */
export function isE2E(): boolean {
  return runtimeEnvironment.isE2E;
}
