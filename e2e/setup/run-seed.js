/**
 * Script to run E2E database seed from Node.js
 * Uses backend database configuration
 */

const fs = require('fs');
const path = require('path');

// Load dotenv from backend
require('dotenv').config({ path: path.join(__dirname, '../../backend/.env') });

// Import backend database utilities
const { initDatabase, closeDatabase, executeQuery } = require('../../backend/dist/config/database');

async function runSeed() {
  try {
    console.log('🔌 Connecting to database...');
    await initDatabase();
    console.log('✅ Connected\n');

    console.log('📄 Reading seed script...');
    const seedSQL = fs.readFileSync(
      path.join(__dirname, 'seed-database.sql'),
      'utf8'
    );

    // Remove PRINT statements and GO statements - execute as one batch
    const cleanSQL = seedSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('PRINT ') && line.trim() !== 'GO')
      .join('\n')
      .trim();

    console.log(`📦 Executing seed script (${cleanSQL.length} characters)\n`);

    try {
      await executeQuery(cleanSQL, []);
      console.log('✅ SQL batch executed successfully');
    } catch (error) {
      console.error('❌ Error executing seed script:', error.message);
      throw error;
    }

    console.log('\n✅ Database seed completed successfully!');

    // Verify the session was created
    console.log('\n🔍 Verifying E2E session...');
    const result = await executeQuery(
      `SELECT id, title, user_id FROM sessions WHERE id = 'e2e10001-0000-0000-0000-000000000001'`,
      []
    );

    if (result.recordset.length > 0) {
      console.log('✅ E2E session found:');
      console.log('   ID:', result.recordset[0].id);
      console.log('   Title:', result.recordset[0].title);
      console.log('   User ID:', result.recordset[0].user_id);
    } else {
      console.log('⚠️  E2E session not found (unexpected)');
    }

    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    await closeDatabase();
    process.exit(1);
  }
}

runSeed();
