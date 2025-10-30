/**
 * BC Claude Agent - Migration Runner
 *
 * Executes SQL migration scripts against Azure SQL Database
 * Uses the existing database configuration from src/config/database.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

// Load environment variables
dotenv.config();

const env = process.env;

interface MigrationScript {
  name: string;
  path: string;
  executed: boolean;
}

async function loadSecretsFromKeyVault(): Promise<{
  sqlConnectionString: string;
}> {
  const keyVaultName = env.AZURE_KEY_VAULT_NAME || 'kv-bcagent-dev';
  const keyVaultUrl = `https://${keyVaultName}.vault.azure.net`;

  console.log(`🔐 Loading secrets from Azure Key Vault: ${keyVaultUrl}`);

  const credential = new DefaultAzureCredential();
  const client = new SecretClient(keyVaultUrl, credential);

  try {
    const sqlConnectionStringSecret = await client.getSecret('SqlDb-ConnectionString');
    const sqlConnectionString = sqlConnectionStringSecret.value;

    if (!sqlConnectionString) {
      throw new Error('SQL connection string not found in Key Vault');
    }

    console.log('✅ Secrets loaded successfully from Key Vault');

    return {
      sqlConnectionString,
    };
  } catch (error: any) {
    console.error('❌ Failed to load secrets from Key Vault:', error.message);
    throw error;
  }
}

async function executeSQLFile(pool: sql.ConnectionPool, filePath: string): Promise<void> {
  console.log(`\n📄 Executing: ${path.basename(filePath)}`);

  const sqlContent = fs.readFileSync(filePath, 'utf-8');

  // Split by GO statements (SQL Server batch separator)
  const batches = sqlContent
    .split(/^\s*GO\s*$/gim)
    .map(batch => batch.trim())
    .filter(batch => batch.length > 0);

  console.log(`   Found ${batches.length} batches to execute`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch) continue;

    try {
      const result = await pool.request().query(batch);

      // Print any messages from SQL Server (PRINT statements)
      if (result.recordset && result.recordset.length > 0) {
        result.recordset.forEach((row: any) => {
          const firstKey = Object.keys(row)[0];
          if (firstKey) {
            console.log(`   ${row[firstKey]}`);
          }
        });
      }
    } catch (error: any) {
      console.error(`   ❌ Error in batch ${i + 1}:`, error.message);
      console.error(`   Batch content (first 500 chars):`);
      console.error(`   ${batch.substring(0, 500)}...`);
      throw error;
    }
  }

  console.log(`✅ Successfully executed: ${path.basename(filePath)}`);
}

async function checkIfTableExists(pool: sql.ConnectionPool, tableName: string): Promise<boolean> {
  const result = await pool.request()
    .input('tableName', sql.NVarChar, tableName)
    .query(`
      SELECT COUNT(*) as count
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = @tableName
    `);

  return result.recordset[0].count > 0;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 BC Claude Agent - Migration Runner');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Load secrets from Key Vault
    const secrets = await loadSecretsFromKeyVault();

    if (!secrets.sqlConnectionString) {
      throw new Error('SQL connection string is undefined');
    }

    // Connect to database
    console.log('\n🔌 Connecting to Azure SQL Database...');
    const pool = await sql.connect(secrets.sqlConnectionString);
    console.log('✅ Connected to Azure SQL Database\n');

    // Check if base schema exists
    console.log('🔍 Checking current database state...');
    const usersTableExists = await checkIfTableExists(pool, 'users');
    const todosTableExists = await checkIfTableExists(pool, 'todos');
    const agentExecutionsTableExists = await checkIfTableExists(pool, 'agent_executions');

    console.log(`   users table: ${usersTableExists ? '✅' : '❌'}`);
    console.log(`   todos table: ${todosTableExists ? '✅' : '❌'}`);
    console.log(`   agent_executions table: ${agentExecutionsTableExists ? '✅' : '❌'}`);

    // Determine which scripts to run
    const scriptsToRun: MigrationScript[] = [];

    if (!usersTableExists) {
      scriptsToRun.push({
        name: 'init-db.sql',
        path: path.join(__dirname, 'init-db.sql'),
        executed: false,
      });
    }

    if (usersTableExists && !todosTableExists) {
      scriptsToRun.push({
        name: '001_add_todos_and_permissions.sql',
        path: path.join(__dirname, 'migrations', '001_add_todos_and_permissions.sql'),
        executed: false,
      });
    }

    if (todosTableExists && !agentExecutionsTableExists) {
      scriptsToRun.push({
        name: '002_add_observability_tables.sql',
        path: path.join(__dirname, 'migrations', '002_add_observability_tables.sql'),
        executed: false,
      });
    }

    // Execute migrations
    if (scriptsToRun.length === 0) {
      console.log('\n✅ All migrations are already applied!');
      console.log('   Database schema is up to date.\n');
    } else {
      console.log(`\n📋 Will execute ${scriptsToRun.length} migration(s):\n`);
      scriptsToRun.forEach(script => {
        console.log(`   - ${script.name}`);
      });

      console.log('\n⏳ Executing migrations...\n');

      for (const script of scriptsToRun) {
        await executeSQLFile(pool, script.path);
        script.executed = true;
      }

      console.log('\n✅ All migrations executed successfully!\n');
    }

    // Ask about seed data
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Seed Data');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check if users exist
    const userCountResult = await pool.request().query('SELECT COUNT(*) as count FROM users');
    const userCount = userCountResult.recordset[0].count;

    if (userCount === 0) {
      console.log('⚠️  No users found in database');
      console.log('   Consider running seed-data.sql for test data:\n');
      console.log('   cd backend/scripts');
      console.log('   ts-node run-migrations.ts --seed\n');
    } else {
      console.log(`✅ Database has ${userCount} user(s)\n`);
    }

    // Run seed data if --seed flag is provided
    if (process.argv.includes('--seed')) {
      console.log('🌱 Running seed data...\n');
      await executeSQLFile(pool, path.join(__dirname, 'seed-data.sql'));
      console.log('\n✅ Seed data executed successfully!\n');
    }

    // Run verification
    if (process.argv.includes('--verify')) {
      console.log('🔍 Running schema verification...\n');
      await executeSQLFile(pool, path.join(__dirname, 'utilities', 'verify-schema.sql'));
    }

    // Close connection
    await pool.close();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Migration runner completed successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run migrations
main();
