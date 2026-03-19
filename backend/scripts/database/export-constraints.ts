/**
 * Export Database Constraints
 *
 * Queries the live database for CHECK constraints and filtered indexes,
 * then generates constraints.sql content in canonical format.
 *
 * Usage (run from backend/ directory):
 *   npx tsx scripts/database/export-constraints.ts              # Print to stdout
 *   npx tsx scripts/database/export-constraints.ts --write      # Overwrite constraints.sql
 *   npx tsx scripts/database/export-constraints.ts --diff       # Diff against current constraints.sql
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createPrisma } from '../_shared/prisma';
import { hasFlag } from '../_shared/args';
import { normalizeSql, parseValueListConstraint, normalizeComparisonExpr } from './_lib/constraint-parser';

// ============================================================================
// Types for DB query rows
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface CheckConstraintRow {
  name: string;
  table: string;
  definition: string;
}

interface FilteredIndexRow {
  name: string;
  table: string;
  isUnique: boolean | number | bigint;
  columns: string;
  filter: string;
}

// ============================================================================
// DB Queries
// ============================================================================

async function getCheckConstraints(
  prisma: ReturnType<typeof createPrisma>
): Promise<CheckConstraintRow[]> {
  return await prisma.$queryRawUnsafe<Row[]>(`
    SELECT
      cc.name AS name,
      t.name AS [table],
      cc.definition AS definition
    FROM sys.check_constraints cc
    INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
    ORDER BY t.name, cc.name
  `) as CheckConstraintRow[];
}

async function getFilteredIndexes(
  prisma: ReturnType<typeof createPrisma>
): Promise<FilteredIndexRow[]> {
  return await prisma.$queryRawUnsafe<Row[]>(`
    SELECT
      i.name AS name,
      t.name AS [table],
      i.is_unique AS isUnique,
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
    WHERE i.has_filter = 1
    ORDER BY t.name, i.name
  `) as FilteredIndexRow[];
}

// ============================================================================
// Formatting helpers
// ============================================================================

/**
 * Strip a single outer matched pair of parentheses from a normalized SQL string.
 */
function stripOuterParens(sql: string): string {
  if (!sql.startsWith('(') || !sql.endsWith(')')) return sql;

  let depth = 0;
  let isOuterPair = true;
  for (let i = 0; i < sql.length - 1; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') depth--;
    if (depth === 0 && i < sql.length - 1) {
      isOuterPair = false;
      break;
    }
  }

  if (isOuterPair) {
    return sql.slice(1, -1).trim();
  }
  return sql;
}

/**
 * Take the raw SQL Server definition (which wraps everything in outer parens
 * and converts IN to OR chains) and convert it back to canonical form.
 */
function canonicalizeCheckDefinition(rawDefinition: string): string {
  // 1. Normalize (removes brackets, lowercases, collapses whitespace)
  const normalized = normalizeSql(rawDefinition);

  // 2. Strip outer matched parens that SQL Server wraps definitions in
  const stripped = stripOuterParens(normalized);

  // 3. Try to parse as a value list (handles IN-form or OR-chain)
  const parsed = parseValueListConstraint(stripped);
  if (parsed) {
    // Sort values alphabetically
    const sortedValues = Array.from(parsed.values).sort();
    const quotedValues = sortedValues.map(v => `'${v}'`).join(',');
    let result = `[${parsed.column}] IN (${quotedValues})`;
    if (parsed.hasNull) {
      result += `\n    OR [${parsed.column}] IS NULL`;
    }
    return result;
  }

  // 4. Not a value list — handle comparison expressions (e.g., >= 0)
  // Normalize comparison formatting first (strips parens around numbers)
  const normalized2 = normalizeComparisonExpr(stripped);

  // Re-bracket the column name: detect it as the word before the operator
  // Patterns like: column >= 0, column = 'value', column is null
  const withBrackets = normalized2.replace(
    /^(\w+)(\s+(?:>=|<=|<>|!=|>|<|=|is\s+null|is\s+not\s+null))/i,
    (_match, col, rest) => `[${col}]${rest}`
  );

  return withBrackets;
}

/**
 * Re-bracket column references in a filter expression.
 * E.g.: "connection_id is not null and external_id is not null"
 *     → "[connection_id] IS NOT NULL AND [external_id] IS NOT NULL"
 */
function canonicalizeFilterExpression(rawFilter: string): string {
  // Normalize and strip outer parens
  const normalized = normalizeSql(rawFilter);
  const stripped = stripOuterParens(normalized);

  // Capitalize keywords and re-bracket column references
  return stripped
    // Re-bracket column names before IS NULL / IS NOT NULL
    .replace(/(\w+)(\s+is\s+not\s+null)/gi, (_m, col, rest) => `[${col}]${rest.toUpperCase()}`)
    .replace(/(\w+)(\s+is\s+null)/gi, (_m, col, rest) => `[${col}]${rest.toUpperCase()}`)
    // Re-bracket column names before comparison operators
    .replace(/(\w+)(\s*(?:>=|<=|<>|!=|>|<|=))/g, (_m, col, rest) => `[${col}]${rest}`)
    // Capitalize AND, OR
    .replace(/\band\b/gi, 'AND')
    .replace(/\bor\b/gi, 'OR');
}

/**
 * Build the section header line with box-drawing style.
 * Extends to column 65 total.
 *
 * Example: -- ── messages ──────────────────────────────────────────────────
 */
function sectionHeader(tableName: string): string {
  const PREFIX = '-- ── ';
  const SUFFIX = ' ';
  // Total target length: 65 characters
  const TARGET_LENGTH = 65;
  const base = `${PREFIX}${tableName}${SUFFIX}`;
  const remaining = TARGET_LENGTH - base.length;
  const dashes = remaining > 0 ? '─'.repeat(remaining) : '';
  return `${base}${dashes}`;
}

/**
 * Format a filtered index as the canonical multi-line CREATE INDEX statement.
 */
function formatFilteredIndex(index: FilteredIndexRow): string {
  const unique = index.isUnique ? 'UNIQUE ' : '';
  // Columns come from DB as comma-separated names without brackets
  const bracketedColumns = index.columns
    .split(',')
    .map(c => `[${c.trim()}]`)
    .join(', ');
  const filter = canonicalizeFilterExpression(index.filter);
  return (
    `CREATE ${unique}NONCLUSTERED INDEX [${index.name}]\n` +
    `  ON [dbo].[${index.table}] (${bracketedColumns})\n` +
    `  WHERE ${filter};`
  );
}

/**
 * Build the full constraints.sql file content from live DB data.
 */
function formatConstraintsSql(
  checks: CheckConstraintRow[],
  indexes: FilteredIndexRow[]
): string {
  const lines: string[] = [];

  // File header (matches existing constraints.sql exactly)
  lines.push('-- ============================================================');
  lines.push('-- CHECK Constraints & Filtered Indexes Registry');
  lines.push('-- ============================================================');
  lines.push('-- Prisma does NOT support CHECK constraints or filtered indexes.');
  lines.push('-- This file is the source of truth for all constraints that exist');
  lines.push('-- outside Prisma\'s schema DSL.');
  lines.push('--');
  lines.push('-- USAGE:');
  lines.push('--   - When generating a new migration with `prisma migrate dev --create-only`,');
  lines.push('--     append the relevant constraints from this file to the generated SQL.');
  lines.push('--   - When adding a new enum-like value, update the constraint here AND');
  lines.push('--     in the migration SQL.');
  lines.push('--');
  lines.push('-- VERIFY: After any migration, run against the target database:');
  lines.push('--   SELECT name, definition FROM sys.check_constraints ORDER BY name;');
  lines.push('-- ============================================================');

  // Group CHECK constraints by table (preserve DB ordering — already sorted by t.name, cc.name)
  const tableGroups = new Map<string, CheckConstraintRow[]>();
  for (const check of checks) {
    const group = tableGroups.get(check.table) ?? [];
    group.push(check);
    tableGroups.set(check.table, group);
  }

  for (const [table, group] of tableGroups) {
    lines.push('');
    lines.push(sectionHeader(table));
    lines.push('');
    for (const check of group) {
      const definition = canonicalizeCheckDefinition(check.definition);
      lines.push(`ALTER TABLE [dbo].[${check.table}] ADD CONSTRAINT [${check.name}]`);
      lines.push(`  CHECK (${definition});`);
      lines.push('');
    }
    // Remove the trailing blank line added after last constraint — we'll add spacing
    // between sections naturally by the blank line added at the start of each section.
    // But we keep one trailing blank line after each group for readability, so leave it.
  }

  // Remove last trailing blank line before filtered indexes section
  while (lines[lines.length - 1] === '') {
    lines.pop();
  }

  // Filtered indexes section
  lines.push('');
  lines.push('-- ============================================================');
  lines.push('-- Filtered Indexes');
  lines.push('-- ============================================================');

  if (indexes.length > 0) {
    // Group filtered indexes by table
    const indexGroups = new Map<string, FilteredIndexRow[]>();
    for (const idx of indexes) {
      const group = indexGroups.get(idx.table) ?? [];
      group.push(idx);
      indexGroups.set(idx.table, group);
    }

    for (const [_table, group] of indexGroups) {
      lines.push('');
      for (const idx of group) {
        lines.push(formatFilteredIndex(idx));
      }
    }
  }

  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const writeMode = hasFlag('--write');
  const diffMode = hasFlag('--diff');

  const prisma = createPrisma();

  try {
    // Query DB
    const checks = await getCheckConstraints(prisma);
    const indexes = await getFilteredIndexes(prisma);

    // Generate content
    const content = formatConstraintsSql(checks, indexes);

    if (writeMode) {
      const outPath = resolve(__dirname, '../../prisma/constraints.sql');
      writeFileSync(outPath, content, 'utf-8');
      console.log(`✅ Written to ${outPath}`);
      console.log(`   ${checks.length} CHECK constraints, ${indexes.length} filtered indexes`);
    } else if (diffMode) {
      const existingPath = resolve(__dirname, '../../prisma/constraints.sql');
      const existing = readFileSync(existingPath, 'utf-8');
      if (existing.trim() === content.trim()) {
        console.log('✅ constraints.sql is up to date — no diff');
      } else {
        // Show line-by-line diff
        const existingLines = existing.split('\n');
        const generatedLines = content.split('\n');
        let hasDiff = false;
        const maxLines = Math.max(existingLines.length, generatedLines.length);
        for (let i = 0; i < maxLines; i++) {
          const eLine = existingLines[i] ?? '';
          const gLine = generatedLines[i] ?? '';
          if (eLine !== gLine) {
            if (!hasDiff) {
              console.log('❌ constraints.sql is out of date:\n');
              hasDiff = true;
            }
            if (existingLines[i] !== undefined) console.log(`- L${i + 1}: ${eLine}`);
            if (generatedLines[i] !== undefined) console.log(`+ L${i + 1}: ${gLine}`);
          }
        }
        if (hasDiff) process.exit(1);
      }
    } else {
      // Print to stdout
      console.log(content);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nExport failed:', err);
  process.exit(1);
});
