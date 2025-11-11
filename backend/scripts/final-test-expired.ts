#!/usr/bin/env ts-node

import * as sql from 'mssql';
import { getDatabaseConfig } from '../src/config/database';

async function testExpiredStatus() {
  const config = getDatabaseConfig();
  const pool = await sql.connect(config);

  try {
    // Insert a test approval with status='pending'
    await pool.request().query(`
      INSERT INTO approvals (
        session_id, action_type, action_description, tool_name, status, expires_at
      ) VALUES (
        NEWID(), 'test', 'test approval', 'test_tool', 'pending', DATEADD(minute, -10, GETUTCDATE())
      )
    `);

    const testId = (await pool.request().query(`SELECT TOP 1 id FROM approvals WHERE action_type = 'test' ORDER BY created_at DESC`)).recordset[0].id;

    console.log('✅ Inserted test approval with status=pending\n');

    // Try to UPDATE to status='expired' (this is what expireOldApprovals does)
    await pool.request().query(`
      UPDATE approvals
      SET status = 'expired'
      WHERE id = '${testId}'
    `);

    console.log('✅ Successfully updated approval to status=expired\n');
    console.log('🎉 MIGRATION 004 WORKED! Database now accepts expired status.');

    // Clean up
    await pool.request().query(`DELETE FROM approvals WHERE id = '${testId}'`);

  } catch (error: any) {
    console.error('❌ Failed:', error.message);
    console.error('\nMigration did NOT work properly.');
  } finally {
    await pool.close();
  }
}

testExpiredStatus().catch(console.error);
