#!/usr/bin/env ts-node

import * as sql from 'mssql';
import { getDatabaseConfig } from '../src/config/database';

async function testConstraint() {
  const config = getDatabaseConfig();
  const pool = await sql.connect(config);

  try {
    console.log('Testing if expired status is allowed in database...\n');

    // Try to insert a test approval with status='expired'
    await pool.request().query(`
      INSERT INTO approvals (
        id, user_id, session_id, tool_name, tool_args, status,
        created_at, expires_at, priority
      ) VALUES (
        'test-expired-approval', 'test-user', 'test-session',
        'test_tool', '{}', 'expired',
        GETDATE(), DATEADD(minute, 30, GETDATE()), 'medium'
      )
    `);

    console.log('✅ Successfully inserted approval with status=expired\n');

    // Clean up
    await pool.request().query(`DELETE FROM approvals WHERE id = 'test-expired-approval'`);
    console.log('✅ Test cleanup complete\n');
    console.log('RESULT: Migration 004 worked! Database accepts expired status.');
  } catch (error: any) {
    console.error('❌ Failed to insert with status=expired\n');
    console.error('Error:', error.message);
    console.error('\nRESULT: Migration 004 did NOT work. Constraint still blocks expired status.');
  } finally {
    await pool.close();
  }
}

testConstraint().catch(console.error);
