#!/usr/bin/env npx ts-node
/**
 * E2E Test Data Seeding Script
 *
 * Seeds the database with test data for E2E tests.
 *
 * Usage:
 *   npm run e2e:seed
 *   npx ts-node e2e/scripts/seed-test-data.ts
 *
 * Prerequisites:
 *   - Database connection configured in backend/.env
 *   - Database schema already applied
 *
 * @module e2e/scripts/seed-test-data
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
  const { seedTestData, verifyTestData, closeDb } = await import('../fixtures/db-helpers');

  console.log('═══════════════════════════════════════════════════');
  console.log('  E2E Test Data Seeding');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Database: ${process.env.DATABASE_SERVER}/${process.env.DATABASE_NAME}`);
  console.log('═══════════════════════════════════════════════════\n');

  try {
    // Seed the data
    await seedTestData();

    // Verify it was created
    const verified = await verifyTestData();

    if (!verified) {
      console.error('\n❌ Verification failed. Test data may be incomplete.');
      process.exit(1);
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ✅ Seeding completed successfully!');
    console.log('═══════════════════════════════════════════════════');
    console.log('\nTest data created:');
    console.log('  - 2 test users (e2e-test@bcagent.test, e2e-admin@bcagent.test)');
    console.log('  - 6 test sessions (empty, with history, with tools, with approval, deleted, admin)');
    console.log('  - 8 test messages (conversation history and tool use examples)');
    console.log('  - 3 test approvals (pending, approved, rejected)');
    console.log('\nYou can now run E2E tests with: npm run test:e2e');

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
