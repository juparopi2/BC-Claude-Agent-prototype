/**
 * Centralized Environment Variable Loader for E2E Tests
 *
 * This module loads environment variables from backend/.env and validates
 * that all required variables for E2E tests are present.
 *
 * SECURITY: No credentials are hardcoded. All values must come from .env file.
 *
 * @module e2e/setup/loadEnv
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Track if environment has been loaded to prevent multiple loads
let envLoaded = false;

/**
 * Required environment variables for E2E tests
 */
const REQUIRED_ENV_VARS = [
  'DATABASE_SERVER',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
] as const;

/**
 * Load and validate environment variables from backend/.env
 *
 * @throws {Error} If .env file doesn't exist or required variables are missing
 */
export function loadEnv(): void {
  // Skip if already loaded
  if (envLoaded) {
    return;
  }

  // Resolve path to backend/.env
  const envPath = path.resolve(__dirname, '../../backend/.env');
  const envExamplePath = path.resolve(__dirname, '../../backend/.env.example');

  // Check if .env file exists
  if (!fs.existsSync(envPath)) {
    console.error('═══════════════════════════════════════════════════');
    console.error('  ❌ ERROR: backend/.env file not found');
    console.error('═══════════════════════════════════════════════════');
    console.error('');
    console.error('  E2E tests require database and Redis credentials.');
    console.error('');
    console.error('  To fix this:');
    console.error('  1. Copy backend/.env.example to backend/.env');
    console.error('  2. Fill in the required credentials:');
    console.error('     - DATABASE_SERVER');
    console.error('     - DATABASE_NAME');
    console.error('     - DATABASE_USER');
    console.error('     - DATABASE_PASSWORD');
    console.error('     - REDIS_HOST');
    console.error('     - REDIS_PORT');
    console.error('     - REDIS_PASSWORD');
    console.error('');
    console.error(`  Example file: ${envExamplePath}`);
    console.error(`  Target file:  ${envPath}`);
    console.error('');
    throw new Error('Missing backend/.env file');
  }

  // Load environment variables
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.error('═══════════════════════════════════════════════════');
    console.error('  ❌ ERROR: Failed to parse backend/.env file');
    console.error('═══════════════════════════════════════════════════');
    console.error('');
    console.error(`  Error: ${result.error.message}`);
    console.error('');
    console.error('  Please check that backend/.env is a valid .env file.');
    console.error('');
    throw new Error(`Failed to parse .env file: ${result.error.message}`);
  }

  // Validate required environment variables
  const missing: string[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error('═══════════════════════════════════════════════════');
    console.error('  ❌ ERROR: Required environment variables are missing');
    console.error('═══════════════════════════════════════════════════');
    console.error('');
    console.error('  The following variables must be set in backend/.env:');
    console.error('');
    for (const varName of missing) {
      console.error(`    - ${varName}`);
    }
    console.error('');
    console.error(`  Please update: ${envPath}`);
    console.error(`  Reference:     ${envExamplePath}`);
    console.error('');
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Mark as loaded
  envLoaded = true;

  // Log success (useful for debugging)
  console.log('✅ Environment variables loaded from backend/.env');
}

/**
 * Get the current loaded status (for testing)
 */
export function isEnvLoaded(): boolean {
  return envLoaded;
}

/**
 * Reset the loaded status (for testing only)
 * @internal
 */
export function resetEnvLoaded(): void {
  envLoaded = false;
}

// Auto-load on import (ensures env is available immediately)
loadEnv();
