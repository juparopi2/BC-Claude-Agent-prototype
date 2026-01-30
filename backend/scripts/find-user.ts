/**
 * Find User by Name
 *
 * Searches for users by name (partial match) in the database.
 *
 * Usage:
 *   npx tsx scripts/find-user.ts "Juan Pablo"
 *   npx tsx scripts/find-user.ts "romero" --exact
 */

import 'dotenv/config';
import sql from 'mssql';

// ============================================================================
// Configuration
// ============================================================================

const SQL_CONFIG: sql.config = {
  server: process.env.DATABASE_SERVER || '',
  database: process.env.DATABASE_NAME || '',
  user: process.env.DATABASE_USER || '',
  password: process.env.DATABASE_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

interface UserRecord {
  id: string;
  email: string;
  full_name: string | null;
  created_at: Date;
  last_microsoft_login: Date | null;
}

interface UserStats {
  total_sessions: number;
  total_files: number;
  total_folders: number;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): { searchTerm: string; exactMatch: boolean } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Find User Script

Usage:
  npx tsx scripts/find-user.ts "<search term>" [--exact]

Arguments:
  <search term>  Name or email to search for (partial match by default)
  --exact        Use exact match instead of partial match

Examples:
  npx tsx scripts/find-user.ts "Juan Pablo"
  npx tsx scripts/find-user.ts "juan.pablo@example.com" --exact
  npx tsx scripts/find-user.ts "romero"
`);
    process.exit(0);
  }

  const exactMatch = args.includes('--exact');
  const searchTerm = args.filter((arg) => !arg.startsWith('--'))[0] || '';

  return { searchTerm, exactMatch };
}

// ============================================================================
// Database Queries
// ============================================================================

async function findUsers(
  pool: sql.ConnectionPool,
  searchTerm: string,
  exactMatch: boolean
): Promise<UserRecord[]> {
  const request = pool.request();

  let query: string;
  if (exactMatch) {
    query = `
      SELECT id, email, full_name, created_at, last_microsoft_login
      FROM users
      WHERE full_name = @searchTerm OR email = @searchTerm
      ORDER BY full_name, created_at DESC
    `;
    request.input('searchTerm', sql.NVarChar(255), searchTerm);
  } else {
    query = `
      SELECT id, email, full_name, created_at, last_microsoft_login
      FROM users
      WHERE full_name LIKE @searchPattern OR email LIKE @searchPattern
      ORDER BY full_name, created_at DESC
    `;
    request.input('searchPattern', sql.NVarChar(255), `%${searchTerm}%`);
  }

  const result = await request.query<UserRecord>(query);
  return result.recordset;
}

async function getUserStats(pool: sql.ConnectionPool, userId: string): Promise<UserStats> {
  const request = pool.request();
  request.input('userId', sql.UniqueIdentifier, userId);

  const [sessionsResult, filesResult] = await Promise.all([
    request.query<{ count: number }>(`
      SELECT COUNT(*) as count FROM sessions WHERE user_id = @userId
    `),
    pool.request().input('userId', sql.UniqueIdentifier, userId).query<{
      total_files: number;
      total_folders: number;
    }>(`
      SELECT
        SUM(CASE WHEN is_folder = 0 THEN 1 ELSE 0 END) as total_files,
        SUM(CASE WHEN is_folder = 1 THEN 1 ELSE 0 END) as total_folders
      FROM files
      WHERE user_id = @userId
    `),
  ]);

  return {
    total_sessions: sessionsResult.recordset[0]?.count || 0,
    total_files: filesResult.recordset[0]?.total_files || 0,
    total_folders: filesResult.recordset[0]?.total_folders || 0,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { searchTerm, exactMatch } = parseArgs();

  console.log('=== FIND USER ===\n');
  console.log(`Search term: "${searchTerm}"`);
  console.log(`Match type: ${exactMatch ? 'exact' : 'partial'}\n`);

  if (!SQL_CONFIG.server) {
    console.error('ERROR: DATABASE_SERVER environment variable not set');
    process.exit(1);
  }

  const pool = await sql.connect(SQL_CONFIG);

  try {
    const users = await findUsers(pool, searchTerm, exactMatch);

    if (users.length === 0) {
      console.log('No users found matching the search criteria.');
      return;
    }

    console.log(`Found ${users.length} user(s):\n`);
    console.log('-'.repeat(80));

    for (const user of users) {
      const stats = await getUserStats(pool, user.id);

      console.log(`
User ID:      ${user.id}
Name:         ${user.full_name || '(not set)'}
Email:        ${user.email}
Created:      ${user.created_at.toISOString()}
Last Login:   ${user.last_microsoft_login?.toISOString() || '(never)'}
Sessions:     ${stats.total_sessions}
Files:        ${stats.total_files}
Folders:      ${stats.total_folders}
`);
      console.log('-'.repeat(80));
    }

    // If only one user found, show copy-pasteable commands
    if (users.length === 1) {
      const userId = users[0].id;
      console.log('\nQuick commands for this user:\n');
      console.log(`  # Verify file integrity`);
      console.log(`  npx tsx scripts/verify-file-integrity.ts --userId ${userId}\n`);
      console.log(`  # Check queue status`);
      console.log(`  npx tsx scripts/queue-status.ts\n`);
      console.log(`  # Run orphan cleanup`);
      console.log(`  npx tsx scripts/run-orphan-cleanup.ts --userId ${userId}\n`);
      console.log(`  # Verify blob storage`);
      console.log(`  npx tsx scripts/verify-blob-storage.ts ${userId}\n`);
    }
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error('\nScript failed:', error);
  process.exit(1);
});
