/**
 * Run Migration 001b: Fix Column Naming Mismatches
 *
 * Execute this script to add columns with correct TypeScript-expected names
 * to todos, approvals, and audit_log tables.
 *
 * Usage:
 * ```bash
 * cd backend
 * npx ts-node scripts/run-migration-001b.ts
 * ```
 */

import { initDatabase, getPool, closeDatabase } from '../src/config/database';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration(): Promise<void> {
  console.log('🔄 Starting Migration 001b: Fix Column Naming Mismatches\n');

  try {
    // Initialize database connection
    console.log('📦 Connecting to database...');
    await initDatabase();
    console.log('✅ Connected to database\n');

    const pool = getPool();

    // Read migration SQL file
    console.log('📄 Reading migration script...');
    const migrationPath = path.join(__dirname, 'migrations', '001b_fix_column_names.sql');

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    console.log('✅ Migration script loaded\n');

    // Split SQL by GO statements and execute each batch
    console.log('🔨 Executing migration batches...\n');
    const batches = migrationSQL
      .split(/^\s*GO\s*$/gim)
      .map((batch) => batch.trim())
      .filter((batch) => batch.length > 0);

    console.log(`Found ${batches.length} SQL batches to execute\n`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      // Type guard
      if (!batch) {
        continue;
      }

      // Skip comment-only batches
      if (batch.startsWith('--') || batch.startsWith('/*')) {
        continue;
      }

      try {
        await pool.request().query(batch);
        // Batch messages are handled by PRINT statements in SQL
      } catch (error: unknown) {
        const err = error as { message?: string; number?: number };
        // Ignore info messages (e.g., PRINT output)
        if (err.number === 0 || err.message?.includes('PRINT')) {
          continue;
        }

        console.error(`\n❌ Error in batch ${i + 1}:`, err.message);
        throw error;
      }
    }

    console.log('\n✅ All batches executed successfully\n');

    // Verification queries
    console.log('🔍 Verifying migration results...\n');

    // Check todos table
    console.log('Checking todos table:');
    const todosCheck = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'todos'
        AND COLUMN_NAME IN ('content', 'activeForm', 'order', 'description', 'order_index')
      ORDER BY COLUMN_NAME
    `);

    console.log('  Columns found:');
    todosCheck.recordset.forEach((col) => {
      const icon = ['content', 'activeForm', 'order'].includes(col.COLUMN_NAME) ? '✅' : '📌';
      console.log(`  ${icon} ${col.COLUMN_NAME} (${col.DATA_TYPE}, ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'})`);
    });

    // Check approvals table
    console.log('\nChecking approvals table:');
    const approvalsCheck = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'approvals'
        AND COLUMN_NAME IN ('tool_name', 'tool_args', 'expires_at', 'action_type', 'action_data')
      ORDER BY COLUMN_NAME
    `);

    console.log('  Columns found:');
    approvalsCheck.recordset.forEach((col) => {
      const icon = ['tool_name', 'tool_args', 'expires_at'].includes(col.COLUMN_NAME) ? '✅' : '📌';
      console.log(`  ${icon} ${col.COLUMN_NAME} (${col.DATA_TYPE}, ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'})`);
    });

    // Check audit_log table
    console.log('\nChecking audit_log table:');
    const auditCheck = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'audit_log'
        AND COLUMN_NAME IN ('event_type', 'event_data', 'action', 'details')
      ORDER BY COLUMN_NAME
    `);

    console.log('  Columns found:');
    auditCheck.recordset.forEach((col) => {
      const icon = ['event_type', 'event_data'].includes(col.COLUMN_NAME) ? '✅' : '📌';
      console.log(`  ${icon} ${col.COLUMN_NAME} (${col.DATA_TYPE}, ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'})`);
    });

    // Count records to verify data copy
    console.log('\n📊 Data verification:');

    const todosCount = await pool.request().query(`
      SELECT
        COUNT(*) as total,
        COUNT(content) as has_content,
        COUNT(activeForm) as has_activeForm,
        COUNT([order]) as has_order
      FROM todos
    `);
    if (todosCount.recordset.length > 0) {
      const stats = todosCount.recordset[0];
      console.log(`  todos: ${stats.total} total rows`);
      console.log(`    - content populated: ${stats.has_content} rows`);
      console.log(`    - activeForm populated: ${stats.has_activeForm} rows`);
      console.log(`    - order populated: ${stats.has_order} rows`);
    }

    const approvalsCount = await pool.request().query(`
      SELECT
        COUNT(*) as total,
        COUNT(tool_name) as has_tool_name,
        COUNT(tool_args) as has_tool_args,
        COUNT(expires_at) as has_expires_at
      FROM approvals
    `);
    if (approvalsCount.recordset.length > 0) {
      const stats = approvalsCount.recordset[0];
      console.log(`  approvals: ${stats.total} total rows`);
      console.log(`    - tool_name populated: ${stats.has_tool_name} rows`);
      console.log(`    - tool_args populated: ${stats.has_tool_args} rows`);
      console.log(`    - expires_at populated: ${stats.has_expires_at} rows`);
    }

    const auditCount = await pool.request().query(`
      SELECT
        COUNT(*) as total,
        COUNT(event_type) as has_event_type,
        COUNT(event_data) as has_event_data
      FROM audit_log
    `);
    if (auditCount.recordset.length > 0) {
      const stats = auditCount.recordset[0];
      console.log(`  audit_log: ${stats.total} total rows`);
      console.log(`    - event_type populated: ${stats.has_event_type} rows`);
      console.log(`    - event_data populated: ${stats.has_event_data} rows`);
    }

    console.log('\n✅ Migration 001b completed successfully');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart backend server to use new columns');
    console.log('   2. Run tests to verify functionality');
    console.log('   3. If all tests pass, consider removing old columns');
    console.log('   4. Update TODO.md to reflect migration completion');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\n⚠️  To rollback, run:');
    console.error('   npx ts-node scripts/run-rollback-001b.ts');
    process.exit(1);
  } finally {
    // Close database connection
    await closeDatabase();
    console.log('\n📦 Database connection closed');
  }
}

// Run migration
runMigration();
