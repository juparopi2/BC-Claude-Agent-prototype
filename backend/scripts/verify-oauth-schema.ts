/**
 * Verify OAuth schema - Check if migrations 005 and 006 are applied
 */

import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const env = process.env;

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 OAuth Schema Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Build connection config from individual parameters
    const config: sql.config = {
      server: env.DATABASE_SERVER || '',
      database: env.DATABASE_NAME || '',
      user: env.DATABASE_USER || '',
      password: env.DATABASE_PASSWORD || '',
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

    console.log('🔌 Connecting to Azure SQL Database...');
    const pool = await sql.connect(config);
    console.log('✅ Connected to Azure SQL Database\n');

    // Check if OAuth columns exist
    console.log('📋 Checking Migration 005 (OAuth columns):\n');

    const oauthColumns = [
      'microsoft_id',
      'microsoft_email',
      'microsoft_tenant_id',
      'last_microsoft_login',
      'bc_access_token_encrypted',
      'bc_refresh_token_encrypted',
      'bc_token_expires_at'
    ];

    for (const column of oauthColumns) {
      const result = await pool.request()
        .input('tableName', sql.NVarChar, 'users')
        .input('columnName', sql.NVarChar, column)
        .query(`
          SELECT COUNT(*) as count
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @tableName AND COLUMN_NAME = @columnName
        `);

      const exists = result.recordset[0].count > 0;
      console.log(`   ${column}: ${exists ? '✅' : '❌'}`);
    }

    // Check password_hash is nullable
    const passwordHashResult = await pool.request()
      .query(`
        SELECT IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'
      `);

    if (passwordHashResult.recordset.length > 0) {
      const isNullable = passwordHashResult.recordset[0].IS_NULLABLE === 'YES';
      console.log(`   password_hash nullable: ${isNullable ? '✅' : '❌'}\n`);
    }

    // Check if refresh_tokens table exists
    console.log('📋 Checking Migration 006 (drop refresh_tokens table):\n');
    const refreshTokensResult = await pool.request()
      .query(`
        SELECT COUNT(*) as count
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = 'refresh_tokens'
      `);

    const refreshTokensExists = refreshTokensResult.recordset[0].count > 0;
    console.log(`   refresh_tokens table dropped: ${!refreshTokensExists ? '✅' : '❌ (still exists)'}\n`);

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const allOAuthColumnsExist = (await Promise.all(
      oauthColumns.map(async col => {
        const r = await pool.request()
          .input('columnName', sql.NVarChar, col)
          .query('SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = \'users\' AND COLUMN_NAME = @columnName');
        return r.recordset[0].count > 0;
      })
    )).every(exists => exists);

    if (allOAuthColumnsExist && !refreshTokensExists) {
      console.log('✅ OAuth schema is fully applied (migrations 005 and 006)\n');
    } else {
      console.log('⚠️  OAuth schema is incomplete. Run migrations:\n');
      console.log('   cd backend');
      console.log('   npm run migrate-oauth\n');
    }

    await pool.close();
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
