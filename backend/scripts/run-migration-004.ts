#!/usr/bin/env ts-node

/**
 * Migration 004: Fix Approvals Constraints
 *
 * Ejecuta la migration SQL que arregla:
 * 1. chk_approvals_status constraint (agregar 'expired')
 * 2. Agregar columna 'priority' con constraint
 *
 * Usage:
 *   npx ts-node scripts/run-migration-004.ts
 *   npx ts-node scripts/run-migration-004.ts --rollback
 */

import * as fs from 'fs';
import * as path from 'path';
import * as sql from 'mssql';
import { getDatabaseConfig } from '../src/config/database';

const MIGRATION_FILE = path.join(__dirname, 'migrations', '004_fix_approvals_constraints.sql');
const ROLLBACK_FILE = path.join(__dirname, 'migrations', '004_rollback_approvals_constraints.sql');

/**
 * Ejecuta un archivo SQL con GO statements
 */
async function executeSqlFile(pool: sql.ConnectionPool, filePath: string): Promise<void> {
  console.log(`\n📄 Reading SQL file: ${path.basename(filePath)}`);

  const sqlContent = fs.readFileSync(filePath, 'utf-8');

  // Split by GO statement (case-insensitive)
  const batches = sqlContent
    .split(/^\s*GO\s*$/gim)
    .map(batch => batch.trim())
    .filter(batch => batch.length > 0);

  console.log(`\n🔄 Executing ${batches.length} SQL batches...\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    // Skip undefined or empty batches
    if (!batch) {
      continue;
    }

    // Skip comments-only batches
    if (batch.startsWith('--') || batch.startsWith('/*')) {
      continue;
    }

    try {
      const result = await pool.request().query(batch);

      // Print PRINT statements from SQL
      if (result.recordset && result.recordset.length > 0) {
        result.recordset.forEach((row: Record<string, unknown>) => {
          console.log(row);
        });
      }
    } catch (error) {
      console.error(`\n❌ Error in batch ${i + 1}:`);
      console.error(batch.substring(0, 200) + '...');
      throw error;
    }
  }

  console.log(`\n✅ All batches executed successfully\n`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const isRollback = args.includes('--rollback');

  const actionName = isRollback ? 'ROLLBACK' : 'MIGRATION';
  const sqlFile = isRollback ? ROLLBACK_FILE : MIGRATION_FILE;

  console.log('='.repeat(80));
  console.log(`Migration 004: Fix Approvals Constraints - ${actionName}`);
  console.log('='.repeat(80));

  // Check file exists
  if (!fs.existsSync(sqlFile)) {
    console.error(`\n❌ SQL file not found: ${sqlFile}`);
    process.exit(1);
  }

  // Get database config
  console.log('\n🔧 Loading database configuration...');
  const config = getDatabaseConfig();

  console.log(`\n📡 Connecting to: ${config.server}/${config.database}`);

  let pool: sql.ConnectionPool | null = null;

  try {
    // Connect to database
    pool = await sql.connect(config);
    console.log('✅ Connected to Azure SQL Database');

    // Execute migration or rollback
    await executeSqlFile(pool, sqlFile);

    console.log('='.repeat(80));
    console.log(`✅ ${actionName} COMPLETED SUCCESSFULLY`);
    console.log('='.repeat(80));

    if (isRollback) {
      console.log('\n⚠️  Rollback completed. Priority data has been lost.');
      console.log('    Check temp table #approvals_priority_backup for backup data.');
    } else {
      console.log('\n✅ Migration 004 completed!');
      console.log('    - approvals.status now allows: pending, approved, rejected, expired');
      console.log('    - approvals.priority added (low, medium, high)');
    }

    console.log('\n💡 Next steps:');
    if (!isRollback) {
      console.log('    1. Verify schema in Azure Portal or Azure Data Studio');
      console.log('    2. Run backend tests: npm run dev');
      console.log('    3. Test ApprovalManager.expireOldApprovals()');
      console.log('\n    To rollback: npx ts-node scripts/run-migration-004.ts --rollback');
    } else {
      console.log('    1. Re-run migration if needed: npx ts-node scripts/run-migration-004.ts');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR:', error);

    if (error instanceof Error) {
      console.error('\nDetails:', error.message);
      if ('originalError' in error) {
        console.error('SQL Error:', (error as any).originalError);
      }
    }

    console.log('\n💡 Troubleshooting:');
    console.log('    1. Verify database connection string in .env');
    console.log('    2. Check Azure SQL firewall rules');
    console.log('    3. Verify SQL syntax in migration file');
    console.log('    4. Check for existing data conflicts (e.g., status=expired records before rollback)');

    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
