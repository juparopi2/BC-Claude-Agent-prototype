/**
 * Integration Test Setup
 *
 * This setup is for tests that connect to REAL external services:
 * - Azure SQL Database
 * - Redis Cache
 *
 * Environment variables must be configured in .env or CI/CD secrets.
 */

import { beforeAll, afterAll, beforeEach } from 'vitest';
import { initDatabase, closeDatabase } from '@/config/database';
import { initRedis, closeRedis, getRedis } from '@/config/redis';

// Load real environment variables (not mocks)
import dotenv from 'dotenv';
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_SERVER',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'REDIS_HOST',
  'REDIS_PORT',
];

const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error(
    `\n❌ Missing required environment variables for integration tests:\n   ${missingVars.join(', ')}\n`
  );
  console.error('   Please configure .env file or set environment variables.\n');
  process.exit(1);
}

// Global setup
beforeAll(async () => {
  console.log('\n🔌 Connecting to external services for integration tests...');

  try {
    // Initialize database connection
    await initDatabase();
    console.log('   ✅ Azure SQL Database connected');

    // Initialize Redis connection
    await initRedis();
    console.log('   ✅ Redis connected');

    console.log('   🚀 Integration test environment ready\n');
  } catch (error) {
    console.error('\n❌ Failed to connect to external services:', error);
    console.error('   Make sure Azure SQL and Redis are accessible.\n');
    process.exit(1);
  }
}, 60000); // 60 second timeout for initial connection

// Cleanup between tests (optional - depends on test isolation needs)
beforeEach(async () => {
  // Clear Redis test keys if needed
  const redis = getRedis();
  if (redis) {
    // Only clear keys with 'test:' prefix to avoid affecting other data
    const testKeys = await redis.keys('test:*');
    if (testKeys.length > 0) {
      for (const key of testKeys) {
        await redis.del(key);
      }
    }
  }
});

// Global teardown
afterAll(async () => {
  console.log('\n🔌 Disconnecting from external services...');

  try {
    await closeRedis();
    console.log('   ✅ Redis disconnected');

    await closeDatabase();
    console.log('   ✅ Azure SQL Database disconnected');

    console.log('   ✅ Integration test cleanup complete\n');
  } catch (error) {
    console.error('   ⚠️ Error during cleanup:', error);
  }
}, 30000);

// Export test utilities
export const testConfig = {
  // Use a test-specific prefix for any data created during tests
  testPrefix: 'test_integration_',

  // Generate unique test session ID
  generateTestSessionId: () => `test_${Date.now()}_${Math.random().toString(36).substring(7)}`,

  // Generate unique test user ID
  generateTestUserId: () => `user_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
};
