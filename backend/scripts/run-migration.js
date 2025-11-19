/**
 * Script to run SQL migration: add stop_reason field
 * Run with: node scripts/run-migration.js
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

async function runMigration() {
  console.log('🔄 Starting migration: add stop_reason field...\n');

  // Database configuration from environment
  const config = {
    server: process.env.DATABASE_SERVER,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    }
  };

  let pool;

  try {
    // Connect to database
    console.log('📡 Connecting to Azure SQL Database...');
    pool = await sql.connect(config);
    console.log('✅ Connected to database\n');

    // Execute statements directly (simpler approach for development)
    console.log('\n▶️  Step 1: Adding stop_reason column...');
    try {
      await pool.request().query(`
        ALTER TABLE messages
        ADD stop_reason NVARCHAR(20) NULL;
      `);
      console.log('   ✅ Column added successfully');
    } catch (err) {
      if (err.message.includes('already') || err.message.includes('exists')) {
        console.log('   ⚠️  Column already exists, skipping...');
      } else {
        throw err;
      }
    }

    console.log('\n▶️  Step 2: Adding constraint...');
    try {
      await pool.request().query(`
        ALTER TABLE messages
        ADD CONSTRAINT chk_messages_stop_reason
        CHECK (stop_reason IN ('end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'pause_turn', 'refusal'));
      `);
      console.log('   ✅ Constraint added successfully');
    } catch (err) {
      if (err.message.includes('already') || err.message.includes('exists')) {
        console.log('   ⚠️  Constraint already exists, skipping...');
      } else {
        throw err;
      }
    }

    console.log('\n▶️  Step 3: Creating index...');
    try {
      await pool.request().query(`
        CREATE INDEX idx_messages_stop_reason ON messages(stop_reason)
        WHERE stop_reason IS NOT NULL;
      `);
      console.log('   ✅ Index created successfully');
    } catch (err) {
      if (err.message.includes('already') || err.message.includes('exists')) {
        console.log('   ⚠️  Index already exists, skipping...');
      } else {
        throw err;
      }
    }

    console.log('\n✅ Migration completed successfully!\n');

    // Verify the column was added
    console.log('🔍 Verifying migration...');
    const result = await pool.request().query(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'messages'
      AND COLUMN_NAME = 'stop_reason'
    `);

    if (result.recordset.length > 0) {
      console.log('✅ stop_reason column verified:');
      console.log('   Column:', result.recordset[0].COLUMN_NAME);
      console.log('   Type:', result.recordset[0].DATA_TYPE);
      console.log('   Nullable:', result.recordset[0].IS_NULLABLE);
    } else {
      console.log('⚠️  Warning: stop_reason column not found after migration');
    }

    // Show sample of messages table structure
    console.log('\n📊 Current messages table structure:');
    const columns = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'messages'
      ORDER BY ORDINAL_POSITION
    `);

    console.table(columns.recordset);

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error('\nFull error:', err);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n💥 Unexpected error:', err);
    process.exit(1);
  });
