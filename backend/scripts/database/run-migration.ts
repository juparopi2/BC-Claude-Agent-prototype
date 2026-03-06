/**
 * Database Migration Runner
 *
 * Runs SQL migration files against the Azure SQL database.
 * Usage: npx tsx scripts/run-migration.ts [migration-file]
 *
 * Example: npx tsx scripts/run-migration.ts 007-create-image-embeddings.sql
 */

import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

// Load environment variables
config();

const dbConfig: sql.config = {
  server: process.env.DATABASE_SERVER || '',
  database: process.env.DATABASE_NAME || '',
  user: process.env.DATABASE_USER || '',
  password: process.env.DATABASE_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

async function runMigration(migrationFile: string): Promise<void> {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const filePath = path.join(migrationsDir, migrationFile);

  if (!fs.existsSync(filePath)) {
    console.error(`Migration file not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`\n🚀 Running migration: ${migrationFile}`);
  console.log(`   Server: ${dbConfig.server}`);
  console.log(`   Database: ${dbConfig.database}\n`);

  let pool: sql.ConnectionPool | null = null;

  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    pool = await sql.connect(dbConfig);
    console.log('✅ Connected successfully\n');

    // Read SQL file
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    // Split by GO statements (SQL Server batch separator)
    const batches = sqlContent
      .split(/^\s*GO\s*$/gim)
      .map((batch) => batch.trim())
      .filter((batch) => batch.length > 0);

    console.log(`📝 Found ${batches.length} SQL batch(es) to execute\n`);

    // Execute each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   Executing batch ${i + 1}/${batches.length}...`);

      try {
        const result = await pool.request().query(batch);
        console.log(`   ✅ Batch ${i + 1} completed`);

        // Show any PRINT messages
        if (result.recordset && result.recordset.length > 0) {
          console.log(`      Rows affected: ${result.rowsAffected}`);
        }
      } catch (batchError: unknown) {
        const error = batchError as Error;
        console.error(`   ❌ Batch ${i + 1} failed: ${error.message}`);
        throw batchError;
      }
    }

    console.log(`\n✅ Migration ${migrationFile} completed successfully!\n`);
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`\n❌ Migration failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('📡 Database connection closed');
    }
  }
}

// Main entry point
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.log('Usage: npx tsx scripts/run-migration.ts <migration-file>');
  console.log('Example: npx tsx scripts/run-migration.ts 007-create-image-embeddings.sql');
  console.log('\nAvailable migrations:');

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  files.forEach((f) => console.log(`  - ${f}`));

  process.exit(1);
}

runMigration(migrationFile);
