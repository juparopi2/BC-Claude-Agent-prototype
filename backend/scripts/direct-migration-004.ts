#!/usr/bin/env ts-node

import * as sql from 'mssql';
import { getDatabaseConfig } from '../src/config/database';

async function directMigration() {
  const config = getDatabaseConfig();
  console.log('Connecting to:', config.server, '/', config.database);

  const pool = await sql.connect(config);
  console.log('Connected!\n');

  try {
    // Step 1: Drop old constraint
    console.log('Step 1: Dropping old constraint...');
    try {
      await pool.request().query(`
        ALTER TABLE approvals DROP CONSTRAINT chk_approvals_status
      `);
      console.log('✅ Constraint dropped\n');
    } catch (error: any) {
      console.log('⚠️  Constraint might not exist:', error.message, '\n');
    }

    // Step 2: Add new constraint with 4 values
    console.log('Step 2: Adding new constraint...');
    await pool.request().query(`
      ALTER TABLE approvals
      ADD CONSTRAINT chk_approvals_status
      CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
    `);
    console.log('✅ New constraint added\n');

    // Step 3: Add priority column
    console.log('Step 3: Adding priority column...');
    try {
      await pool.request().query(`
        ALTER TABLE approvals
        ADD priority NVARCHAR(20) NOT NULL DEFAULT 'medium'
      `);
      console.log('✅ Priority column added\n');
    } catch (error: any) {
      console.log('⚠️  Priority column might already exist:', error.message, '\n');
    }

    // Step 4: Add priority constraint
    console.log('Step 4: Adding priority constraint...');
    try {
      await pool.request().query(`
        ALTER TABLE approvals
        ADD CONSTRAINT chk_approvals_priority
        CHECK (priority IN ('low', 'medium', 'high'))
      `);
      console.log('✅ Priority constraint added\n');
    } catch (error: any) {
      console.log('⚠️  Priority constraint might already exist:', error.message, '\n');
    }

    console.log('\n✅ Direct migration completed!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
  } finally {
    await pool.close();
  }
}

directMigration().catch(console.error);
