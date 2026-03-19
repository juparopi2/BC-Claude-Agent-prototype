/**
 * Constraint Verification Script
 *
 * Compares expected CHECK constraints and filtered indexes (from constraints.sql)
 * against the actual database state. Reports drift.
 *
 * Usage (run from backend/ directory):
 *   npx tsx scripts/database/verify-constraints.ts
 *   npx tsx scripts/database/verify-constraints.ts --table messages
 *   npx tsx scripts/database/verify-constraints.ts --json
 *   npx tsx scripts/database/verify-constraints.ts --strict
 *
 * Set env vars before running:
 *   DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createPrisma } from '../_shared/prisma';
import { getFlag, hasFlag } from '../_shared/args';
import {
  parseCheckConstraints,
  parseFilteredIndexes,
  compareCheckConstraints,
  compareFilteredIndexes,
  buildVerificationResult,
  type ActualCheckConstraint,
  type ActualFilteredIndex,
  type VerificationResult,
} from './_lib/constraint-parser';

// ============================================================================
// Types for DB queries
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ============================================================================
// DB Queries
// ============================================================================

async function getActualCheckConstraints(
  prisma: ReturnType<typeof createPrisma>,
  table?: string
): Promise<ActualCheckConstraint[]> {
  const whereClause = table
    ? `AND t.name = '${table}'`
    : '';

  return await prisma.$queryRawUnsafe<Row[]>(`
    SELECT
      cc.name AS name,
      t.name AS [table],
      cc.definition AS definition
    FROM sys.check_constraints cc
    INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
    WHERE 1=1 ${whereClause}
    ORDER BY t.name, cc.name
  `) as ActualCheckConstraint[];
}

async function getActualFilteredIndexes(
  prisma: ReturnType<typeof createPrisma>,
  table?: string
): Promise<ActualFilteredIndex[]> {
  const whereClause = table
    ? `AND t.name = '${table}'`
    : '';

  return await prisma.$queryRawUnsafe<Row[]>(`
    SELECT
      i.name AS name,
      t.name AS [table],
      STUFF((
        SELECT ', ' + c.name
        FROM sys.index_columns ic
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
        ORDER BY ic.key_ordinal
        FOR XML PATH(''), TYPE
      ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS columns,
      i.filter_definition AS filter
    FROM sys.indexes i
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    WHERE i.has_filter = 1 ${whereClause}
    ORDER BY t.name, i.name
  `) as ActualFilteredIndex[];
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
function header(msg: string) { console.log(`\n${BOLD}${msg}${RESET}`); }

function printDrift(label: string, drift: VerificationResult['checkConstraints']) {
  header(label);

  if (drift.missing.length === 0 && drift.extra.length === 0 && drift.mismatched.length === 0) {
    ok('All match');
    return;
  }

  for (const name of drift.missing) {
    fail(`MISSING: ${name}`);
  }

  for (const name of drift.extra) {
    warn(`EXTRA (not in constraints.sql): ${name}`);
  }

  for (const m of drift.mismatched) {
    fail(`MISMATCH: ${m.name}`);
    console.log(`  ${CYAN}Expected:${RESET} ${m.expected}`);
    console.log(`  ${RED}Actual:  ${RESET} ${m.actual}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const targetTable = getFlag('--table') ?? undefined;
  const jsonOutput = hasFlag('--json');
  const strict = hasFlag('--strict');

  // Read constraints.sql
  const constraintsPath = resolve(__dirname, '../../prisma/constraints.sql');
  const constraintsSql = readFileSync(constraintsPath, 'utf-8');

  // Parse expected constraints
  const expectedChecks = parseCheckConstraints(constraintsSql);
  const expectedIndexes = parseFilteredIndexes(constraintsSql);

  // Filter by table if specified
  const filteredChecks = targetTable
    ? expectedChecks.filter(c => c.table === targetTable)
    : expectedChecks;
  const filteredIndexes = targetTable
    ? expectedIndexes.filter(i => i.table === targetTable)
    : expectedIndexes;

  if (!jsonOutput) {
    console.log('='.repeat(60));
    console.log('   CONSTRAINT VERIFICATION');
    console.log('='.repeat(60));
    console.log(`\nExpected: ${filteredChecks.length} CHECK constraints, ${filteredIndexes.length} filtered indexes`);
    if (targetTable) console.log(`Filtered to table: ${targetTable}`);
  }

  const prisma = createPrisma();

  try {
    // Query actual state
    const actualChecks = await getActualCheckConstraints(prisma, targetTable);
    const actualIndexes = await getActualFilteredIndexes(prisma, targetTable);

    if (!jsonOutput) {
      console.log(`Actual:   ${actualChecks.length} CHECK constraints, ${actualIndexes.length} filtered indexes`);
    }

    // Compare
    const checkDrift = compareCheckConstraints(filteredChecks, actualChecks);
    const indexDrift = compareFilteredIndexes(filteredIndexes, actualIndexes);
    const result = buildVerificationResult(checkDrift, indexDrift);

    // Output
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printDrift('CHECK Constraints', result.checkConstraints);
      printDrift('Filtered Indexes', result.filteredIndexes);

      header('Summary');
      if (result.isClean) {
        ok('All constraints match — no drift detected');
      } else {
        const total =
          checkDrift.missing.length + checkDrift.extra.length + checkDrift.mismatched.length +
          indexDrift.missing.length + indexDrift.extra.length + indexDrift.mismatched.length;
        fail(`${total} issue(s) detected`);
      }

      console.log('\n' + '='.repeat(60) + '\n');
    }

    // Exit code
    if (strict && !result.isClean) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nConstraint verification failed:', err);
  process.exit(1);
});
