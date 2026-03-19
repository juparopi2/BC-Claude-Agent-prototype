/**
 * DB Schema Diagnostic
 *
 * Inspects the actual database schema and Prisma migration state.
 * Use this to detect computed columns, applied migrations, and
 * schema drift between dev and prod.
 *
 * Usage (run from backend/ directory):
 *   npx tsx scripts/database/diagnose-db-schema.ts
 *   npx tsx scripts/database/diagnose-db-schema.ts --table messages
 *
 * Set env vars before running:
 *   DATABASE_SERVER=sqlsrv-bcagent-dev.database.windows.net
 *   DATABASE_NAME=sqldb-bcagent-dev
 *   DATABASE_USER=bcagentadmin
 *   DATABASE_PASSWORD=<from Key Vault: Database-Password>
 */

import { createPrisma } from '../_shared/prisma';
import { getFlag } from '../_shared/args';

// ============================================================================
// Types
// ============================================================================

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_computed: number;
  computed_definition: string | null;
  is_identity: number;
  column_default: string | null;
}

interface MigrationRecord {
  id: string;
  migration_name: string;
  started_at: Date;
  finished_at: Date | null;
  applied_steps_count: number;
  logs: string | null;
  rolled_back_at: Date | null;
}

interface ComputedColumn {
  table_name: string;
  column_name: string;
  definition: string;
  is_persisted: boolean;
}

// ============================================================================
// Query Helpers
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ============================================================================
// Main diagnostic queries
// ============================================================================

async function getServerInfo(prisma: ReturnType<typeof createPrisma>): Promise<string> {
  const result = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT @@SERVERNAME AS server_name, DB_NAME() AS db_name, @@VERSION AS version`
  );
  const row = result[0];
  return `${row.server_name} / ${row.db_name}`;
}

async function getAllComputedColumns(
  prisma: ReturnType<typeof createPrisma>
): Promise<ComputedColumn[]> {
  return await prisma.$queryRawUnsafe<ComputedColumn[]>(`
    SELECT
      t.name AS table_name,
      c.name AS column_name,
      cc.definition AS definition,
      cc.is_persisted AS is_persisted
    FROM sys.computed_columns cc
    INNER JOIN sys.columns c ON cc.object_id = c.object_id AND cc.column_id = c.column_id
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    ORDER BY t.name, c.name
  `);
}

async function getTableColumns(
  prisma: ReturnType<typeof createPrisma>,
  tableName: string
): Promise<ColumnInfo[]> {
  // Note: tableName is controlled (not user input), safe to interpolate
  return await prisma.$queryRawUnsafe<ColumnInfo[]>(`
    SELECT
      c.name AS column_name,
      tp.name AS data_type,
      CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS is_nullable,
      CASE WHEN cc.definition IS NOT NULL THEN 1 ELSE 0 END AS is_computed,
      cc.definition AS computed_definition,
      c.is_identity AS is_identity,
      dc.definition AS column_default
    FROM sys.columns c
    INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
    INNER JOIN sys.objects o ON c.object_id = o.object_id
    LEFT JOIN sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id
    LEFT JOIN sys.default_constraints dc ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE o.name = '${tableName}' AND o.type = 'U'
    ORDER BY c.column_id
  `);
}

async function getMigrations(
  prisma: ReturnType<typeof createPrisma>
): Promise<{ exists: boolean; migrations: MigrationRecord[] }> {
  // Check if table exists first
  const tableCheck = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = '_prisma_migrations'
  `);
  const exists = Number(tableCheck[0].cnt) > 0;
  if (!exists) return { exists: false, migrations: [] };

  const migrations = await prisma.$queryRawUnsafe<MigrationRecord[]>(`
    SELECT
      id, migration_name, started_at, finished_at,
      applied_steps_count, logs, rolled_back_at
    FROM _prisma_migrations
    ORDER BY finished_at ASC
  `);
  return { exists: true, migrations };
}

// ============================================================================
// Display
// ============================================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function ok(msg: string) { console.log(`${GREEN}✅ ${msg}${RESET}`); }
function warn(msg: string) { console.log(`${YELLOW}⚠️  ${msg}${RESET}`); }
function fail(msg: string) { console.log(`${RED}❌ ${msg}${RESET}`); }
function info(msg: string) { console.log(`${CYAN}ℹ️  ${msg}${RESET}`); }
function header(msg: string) { console.log(`\n${BOLD}${msg}${RESET}`); }

// ============================================================================
// Main
// ============================================================================

async function main() {
  const targetTable = getFlag('--table') ?? 'messages';

  console.log('='.repeat(60));
  console.log('   DB SCHEMA DIAGNOSTIC');
  console.log('='.repeat(60));

  const server = process.env.DATABASE_SERVER ?? '(not set)';
  const database = process.env.DATABASE_NAME ?? '(not set)';
  console.log(`\nTarget database: ${server} / ${database}\n`);

  const prisma = createPrisma();

  try {
    // ── 1. Server Identity ──────────────────────────────────────
    header('1. Database Connection');
    try {
      const identity = await getServerInfo(prisma);
      ok(`Connected: ${identity}`);
    } catch (err) {
      fail(`Cannot connect: ${(err as Error).message}`);
      return;
    }

    // ── 2. All Computed Columns ─────────────────────────────────
    header('2. All Computed Columns in Schema');
    const computedCols = await getAllComputedColumns(prisma);
    if (computedCols.length === 0) {
      ok('No computed columns found (schema is plain)');
    } else {
      warn(`Found ${computedCols.length} computed column(s):`);
      for (const col of computedCols) {
        const persisted = col.is_persisted ? ' PERSISTED' : '';
        console.log(
          `   ${BOLD}${col.table_name}.${col.column_name}${RESET}  →  ${col.definition}${persisted}`
        );
      }
    }

    // ── 3. Target Table Column Definitions ─────────────────────
    header(`3. Column Definitions for [${targetTable}]`);
    const columns = await getTableColumns(prisma, targetTable);
    if (columns.length === 0) {
      fail(`Table '${targetTable}' not found in database`);
    } else {
      info(`${columns.length} columns found:`);
      for (const col of columns) {
        const computed = col.is_computed
          ? ` ${YELLOW}COMPUTED: ${col.computed_definition}${RESET}`
          : '';
        const nullable = col.is_nullable === 'YES' ? ' NULL' : ' NOT NULL';
        const identity = col.is_identity ? ' IDENTITY' : '';
        const def = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        console.log(
          `   ${col.is_computed ? YELLOW : ''}${col.column_name}${RESET}  ${col.data_type}${nullable}${identity}${def}${computed}`
        );
      }

      // Highlight token columns specifically
      const tokenCols = ['input_tokens', 'output_tokens', 'total_tokens'];
      header(`   Token Columns Summary:`);
      for (const colName of tokenCols) {
        const col = columns.find((c) => c.column_name === colName);
        if (!col) {
          fail(`${colName}: NOT FOUND`);
        } else if (col.is_computed) {
          warn(`${colName}: COMPUTED (${col.computed_definition}) — INSERT will be rejected by SQL Server`);
        } else {
          ok(`${colName}: plain ${col.data_type} — writable via INSERT/UPDATE`);
        }
      }
    }

    // ── 4. Prisma Migrations ────────────────────────────────────
    header('4. Prisma Migration State');
    const { exists, migrations } = await getMigrations(prisma);
    if (!exists) {
      fail('_prisma_migrations table does not exist');
      warn('This database has no Prisma migration history');
      info('Run: prisma migrate resolve --applied 20260317162456_initial_schema');
      info('Then: prisma migrate deploy (to apply any pending migrations)');
    } else if (migrations.length === 0) {
      warn('_prisma_migrations table exists but is empty');
    } else {
      ok(`${migrations.length} migration(s) applied:`);
      for (const m of migrations) {
        const status = m.rolled_back_at
          ? `${RED}ROLLED BACK${RESET}`
          : m.applied_steps_count > 0
          ? `${GREEN}applied (${m.applied_steps_count} steps)${RESET}`
          : `${YELLOW}pending${RESET}`;
        const when = m.finished_at ? m.finished_at.toISOString() : 'in progress';
        console.log(`   ${m.migration_name}  [${status}]  ${when}`);
        if (m.logs) {
          console.log(`     Logs: ${m.logs.slice(0, 200)}`);
        }
      }
    }

    // ── 5. Diagnosis Summary ────────────────────────────────────
    header('5. Diagnosis Summary');
    const totalTokensCol = columns.find((c) => c.column_name === 'total_tokens');
    if (!totalTokensCol) {
      fail('total_tokens column not found in messages table');
    } else if (totalTokensCol.is_computed) {
      fail(
        'total_tokens is a COMPUTED column — this is the root cause of CI failures.\n' +
        '   A new migration must convert it to a plain INT column.\n' +
        '   Fix: create migration with IF EXISTS guard (drop computed, add INT NULL)'
      );
    } else {
      ok('total_tokens is a plain INT column — no schema issue');
    }

    if (!exists) {
      warn('No migration history — P3005 baseline will be needed on next CI run');
    } else {
      const pendingMigrations = migrations.filter((m) => m.applied_steps_count === 0);
      if (pendingMigrations.length > 0) {
        warn(`${pendingMigrations.length} migration(s) applied with 0 steps (baselined, DDL not executed)`);
        for (const m of pendingMigrations) {
          info(`  - ${m.migration_name} (baselined — DDL skipped)`);
        }
      }
    }

  } finally {
    await prisma.$disconnect();
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main().catch((err) => {
  console.error('\nDiagnostic failed:', err);
  process.exit(1);
});
