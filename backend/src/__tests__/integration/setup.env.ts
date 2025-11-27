/**
 * Environment Setup for Integration Tests
 *
 * Loads environment variables from the backend/.env file before tests run.
 * This ensures consistent environment across all test files.
 *
 * @module __tests__/integration/setup.env
 */

import { config } from 'dotenv';
import path from 'path';

// Load .env from the backend directory with absolute path
const envPath = path.resolve(__dirname, '../../../.env');

const result = config({ path: envPath });

if (result.error) {
  console.error(`❌ Failed to load .env file from: ${envPath}`);
  console.error(result.error);
} else {
  const varCount = Object.keys(result.parsed || {}).length;
  console.log(`✅ Loaded ${varCount} environment variables from ${envPath}`);
}
