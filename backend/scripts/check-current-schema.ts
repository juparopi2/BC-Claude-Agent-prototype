/**
 * Check Current Database Schema
 *
 * Quick script to see what columns exist in todos, approvals, and audit_log tables.
 */

import { initDatabase, getPool, closeDatabase } from '../src/config/database';

async function checkSchema(): Promise<void> {
  console.log('🔍 Checking current database schema...\n');

  try {
    await initDatabase();
    const pool = getPool();

    // Check todos
    console.log('📋 todos table columns:');
    const todosResult = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'todos'
      ORDER BY ORDINAL_POSITION
    `);
    todosResult.recordset.forEach((col) => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE}, ${col.IS_NULLABLE})`);
    });

    // Check approvals
    console.log('\n📋 approvals table columns:');
    const approvalsResult = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'approvals'
      ORDER BY ORDINAL_POSITION
    `);
    approvalsResult.recordset.forEach((col) => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE}, ${col.IS_NULLABLE})`);
    });

    // Check audit_log
    console.log('\n📋 audit_log table columns:');
    const auditResult = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'audit_log'
      ORDER BY ORDINAL_POSITION
    `);
    auditResult.recordset.forEach((col) => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE}, ${col.IS_NULLABLE})`);
    });

    console.log('\n✅ Schema check complete');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await closeDatabase();
  }
}

checkSchema();
