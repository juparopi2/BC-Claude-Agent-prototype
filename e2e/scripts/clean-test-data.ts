#!/usr/bin/env npx ts-node
/**
 * E2E Test Data Cleanup Script
 *
 * Removes all E2E test data from the database.
 *
 * Usage:
 *   npm run e2e:clean
 *   npx ts-node e2e/scripts/clean-test-data.ts
 *
 * Safety:
 *   - Only deletes data with e2e prefix in IDs
 *   - Only deletes users with @bcagent.test email domain
 *   - Does NOT affect production data
 *
 * @module e2e/scripts/clean-test-data
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment from backend/.env BEFORE importing db-helpers
const envPath = path.resolve(__dirname, '../../backend/.env');
const envExamplePath = path.resolve(__dirname, '../../backend/.env.example');

// Check if .env file exists
if (!fs.existsSync(envPath)) {
  console.error('═══════════════════════════════════════════════════');
  console.error('  ❌ ERROR: backend/.env file not found');
  console.error('═══════════════════════════════════════════════════');
  console.error('');
  console.error('  The E2E scripts require database credentials.');
  console.error('');
  console.error('  To fix this:');
  console.error('  1. Copy backend/.env.example to backend/.env');
  console.error('  2. Fill in the database credentials:');
  console.error('     - DATABASE_SERVER');
  console.error('     - DATABASE_NAME');
  console.error('     - DATABASE_USER');
  console.error('     - DATABASE_PASSWORD');
  console.error('');
  console.error(`  Example path: ${envExamplePath}`);
  console.error(`  Target path:  ${envPath}`);
  console.error('');
  process.exit(1);
}

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('Failed to parse .env file:', result.error.message);
  process.exit(1);
}

// Dynamic import to ensure env is loaded first
async function main(): Promise<void> {
  // Import db-helpers after env is loaded
  const { cleanTestData, closeDb } = await import('../fixtures/db-helpers');

  console.log('═══════════════════════════════════════════════════');
  console.log('  E2E Test Data Cleanup');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Database: ${process.env.DATABASE_SERVER}/${process.env.DATABASE_NAME}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Safety check for production
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Cannot clean test data in production environment!');
    console.error('   This script only runs in development/test environments.');
    process.exit(1);
  }

  try {
    await cleanTestData();

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ✅ Cleanup completed successfully!');
    console.log('═══════════════════════════════════════════════════');
    console.log('\nRemoved:');
    console.log('  - All users with @bcagent.test email');
    console.log('  - All sessions with e2e prefix');
    console.log('  - All messages with e2e/msg_e2e prefix');
    console.log('  - All approvals with e2e prefix');
    console.log('  - Related audit logs and metrics');

  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
