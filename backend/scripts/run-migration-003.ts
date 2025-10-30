/**
 * Run Migration 003: Add User Roles
 *
 * Execute this script to add the 'role' column to the users table.
 *
 * Usage:
 * ```bash
 * cd backend
 * npx ts-node scripts/run-migration-003.ts
 * ```
 */

import { initDatabase, getPool, closeDatabase } from '../src/config/database';

async function runMigration(): Promise<void> {
  console.log('🔄 Starting Migration 003: Add User Roles\n');

  try {
    // Initialize database connection
    console.log('📦 Connecting to database...');
    await initDatabase();
    console.log('✅ Connected to database\n');

    // Execute migration in steps
    console.log('🔨 Executing migration...\n');
    const pool = getPool();

    // Step 1: Check if role column exists
    console.log('Step 1: Checking if role column exists...');
    const checkResult = await pool.request().query(`
      SELECT COUNT(*) as col_exists
      FROM sys.columns
      WHERE object_id = OBJECT_ID('users') AND name = 'role'
    `);

    const columnExists = checkResult.recordset[0].col_exists > 0;

    if (columnExists) {
      console.log('✅ Role column already exists, skipping migration');
    } else {
      // Step 2: Add role column
      console.log('Step 2: Adding role column...');
      await pool.request().query(`
        ALTER TABLE users
        ADD role NVARCHAR(50) NOT NULL DEFAULT 'viewer'
        CONSTRAINT chk_users_role CHECK (role IN ('admin', 'editor', 'viewer'))
      `);
      console.log('✅ Role column added');

      // Step 3: Update existing users
      console.log('Step 3: Updating existing users...');
      await pool.request().query(`
        UPDATE users SET role = 'admin' WHERE is_admin = 1
      `);
      await pool.request().query(`
        UPDATE users SET role = 'editor' WHERE is_admin = 0
      `);
      console.log('✅ Existing users updated');
    }

    // Step 4: Verify migration
    console.log('Step 4: Verifying migration...');
    const result = await pool.request().query(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
        SUM(CASE WHEN role = 'editor' THEN 1 ELSE 0 END) as editors,
        SUM(CASE WHEN role = 'viewer' THEN 1 ELSE 0 END) as viewers
      FROM users
    `);

    console.log('\n✅ Migration executed successfully');

    // Display results
    if (result.recordset && result.recordset.length > 0) {
      console.log('\n📊 User Role Summary:');
      const summary = result.recordset[0];
      console.log(`   Total Users: ${summary.total_users}`);
      console.log(`   Admins: ${summary.admins}`);
      console.log(`   Editors: ${summary.editors}`);
      console.log(`   Viewers: ${summary.viewers}`);
    }

    console.log('\n✅ Migration 003 completed successfully');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await closeDatabase();
    console.log('\n📦 Database connection closed');
  }
}

// Run migration
runMigration();
