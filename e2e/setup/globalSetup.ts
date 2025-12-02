/**
 * Global Setup for Playwright E2E Tests
 *
 * This runs once before all tests to:
 * 1. Verify backend is running and healthy
 * 2. Inject test user sessions directly into Redis
 * 3. Store session IDs for use in tests
 *
 * IMPORTANT: This uses REAL Redis in DEV environment (redis-bcagent-dev)
 * The test data is pre-seeded in the DEV database via seed-database.sql
 */

import { FullConfig } from '@playwright/test';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

// Redis configuration (DEV environment)
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'redis-bcagent-dev.redis.cache.windows.net',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false }, // Azure Redis requires TLS
};

// Test user data (matches e2e/fixtures/test-data.ts and seed-database.sql)
const TEST_USER = {
  id: 'e2e00001-0000-0000-0000-000000000001',
  email: 'e2e-test@bcagent.test',
  fullName: 'E2E Test User',
  role: 'editor',
  microsoftId: 'e2e-microsoft-id-001',
  microsoftEmail: 'e2e-test@bcagent.test',
  microsoftTenantId: 'e2e-tenant-id',
};

const TEST_ADMIN_USER = {
  id: 'e2e00002-0000-0000-0000-000000000002',
  email: 'e2e-admin@bcagent.test',
  fullName: 'E2E Admin User',
  role: 'admin',
  microsoftId: 'e2e-microsoft-id-002',
  microsoftEmail: 'e2e-admin@bcagent.test',
  microsoftTenantId: 'e2e-tenant-id',
};

// Session IDs for E2E tests (fixed for reproducibility)
const E2E_SESSION_ID = 'e2e-test-session-001';
const E2E_ADMIN_SESSION_ID = 'e2e-admin-session-001';

// File to store session info for tests to use
const SESSION_INFO_FILE = path.join(__dirname, '.e2e-sessions.json');

/**
 * Create a Microsoft OAuth session object for Redis storage
 */
function createMicrosoftOAuthSession(user: typeof TEST_USER) {
  return {
    userId: user.id,
    microsoftId: user.microsoftId,
    displayName: user.fullName,
    email: user.email,
    // Mock access/refresh tokens (not real, but needed for session structure)
    accessToken: 'e2e-mock-access-token-' + user.id,
    refreshToken: 'e2e-mock-refresh-token-' + user.id,
    // Token expires in 24 hours
    tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Create an express-session compatible session object for Redis
 */
function createExpressSession(user: typeof TEST_USER) {
  const microsoftOAuth = createMicrosoftOAuthSession(user);
  return {
    cookie: {
      originalMaxAge: 86400000, // 24 hours
      expires: new Date(Date.now() + 86400000).toISOString(),
      httpOnly: true,
      path: '/',
    },
    microsoftOAuth,
  };
}

async function globalSetup(_config: FullConfig) {
  const startTime = Date.now();
  console.log('\n=====================================================');
  console.log('  E2E Global Setup Starting...');
  console.log('=====================================================\n');

  // Step 1: Verify backend is running
  console.log('1. Checking backend health...');
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    if (!response.ok) {
      throw new Error(`Backend health check failed: ${response.status}`);
    }
    console.log('   ✅ Backend is healthy\n');
  } catch (error) {
    console.error('   ❌ Backend health check failed');
    console.error('   Make sure backend is running: cd backend && npm run dev');
    throw error;
  }

  // Step 2: Connect to Redis and inject test sessions
  console.log('2. Connecting to Redis (DEV)...');
  const redis = new Redis({
    ...REDIS_CONFIG,
    lazyConnect: true,
    retryStrategy: () => null, // Don't retry, fail fast
  });

  try {
    await redis.connect();
    console.log('   ✅ Connected to Redis\n');

    // Step 3: Inject test user sessions
    console.log('3. Injecting test user sessions...');

    // Create session for TEST_USER
    const testUserSession = createExpressSession(TEST_USER);
    const testUserKey = `sess:${E2E_SESSION_ID}`;
    await redis.set(testUserKey, JSON.stringify(testUserSession), 'EX', 86400);
    console.log(`   ✅ Created session: ${testUserKey}`);

    // Create session for TEST_ADMIN_USER
    const adminUserSession = createExpressSession(TEST_ADMIN_USER);
    const adminUserKey = `sess:${E2E_ADMIN_SESSION_ID}`;
    await redis.set(adminUserKey, JSON.stringify(adminUserSession), 'EX', 86400);
    console.log(`   ✅ Created session: ${adminUserKey}`);

    // Step 4: Write session info to file for tests to use
    const sessionInfo = {
      testUser: {
        sessionId: E2E_SESSION_ID,
        userId: TEST_USER.id,
        email: TEST_USER.email,
        cookieValue: `s:${E2E_SESSION_ID}`, // express-session cookie format
      },
      adminUser: {
        sessionId: E2E_ADMIN_SESSION_ID,
        userId: TEST_ADMIN_USER.id,
        email: TEST_ADMIN_USER.email,
        cookieValue: `s:${E2E_ADMIN_SESSION_ID}`,
      },
    };

    fs.writeFileSync(SESSION_INFO_FILE, JSON.stringify(sessionInfo, null, 2));
    console.log(`   ✅ Session info written to: ${SESSION_INFO_FILE}\n`);

  } catch (error) {
    console.error('   ❌ Redis operation failed:', error);
    console.error('\n   Make sure Redis is accessible:');
    console.error(`   Host: ${REDIS_CONFIG.host}`);
    console.error(`   Port: ${REDIS_CONFIG.port}`);
    throw error;
  } finally {
    await redis.quit();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('=====================================================');
  console.log(`  ✅ E2E Global Setup Complete (${duration}s)`);
  console.log('=====================================================\n');
  console.log('Session Info:');
  console.log(`  Test User:  ${TEST_USER.email} (${E2E_SESSION_ID})`);
  console.log(`  Admin User: ${TEST_ADMIN_USER.email} (${E2E_ADMIN_SESSION_ID})`);
  console.log('\nTo use in tests, set cookie: connect.sid=s:<sessionId>');
  console.log('');
}

export default globalSetup;
