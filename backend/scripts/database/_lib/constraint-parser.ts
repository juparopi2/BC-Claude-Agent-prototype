/**
 * Constraint Parser Library
 *
 * Pure functions for parsing constraints.sql and comparing
 * expected vs actual database constraints.
 */

// ============================================================================
// Types
// ============================================================================

export interface ExpectedCheckConstraint {
  name: string;
  table: string;
  definition: string;
}

export interface ExpectedFilteredIndex {
  name: string;
  table: string;
  columns: string[];
  filter: string;
}

export interface ActualCheckConstraint {
  name: string;
  table: string;
  definition: string;
}

export interface ActualFilteredIndex {
  name: string;
  table: string;
  columns: string;
  filter: string;
}

export interface ConstraintDrift {
  missing: string[];    // Expected but not in DB
  extra: string[];      // In DB but not expected
  mismatched: Array<{
    name: string;
    expected: string;
    actual: string;
  }>;
}

export interface VerificationResult {
  checkConstraints: ConstraintDrift;
  filteredIndexes: ConstraintDrift;
  isClean: boolean;
}

// ============================================================================
// SQL Normalization
// ============================================================================

/**
 * Normalize SQL for comparison. Removes extra whitespace, normalizes
 * bracket quoting, lowercases keywords while preserving quoted identifiers.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/\(\s+/g, '(')         // Remove space after (
    .replace(/\s+\)/g, ')')         // Remove space before )
    .replace(/\[\s*dbo\s*\]\s*\.\s*/gi, '') // Remove [dbo]. prefix
    .replace(/\[([^\]]+)\]/g, '$1') // Remove square brackets
    .trim()
    .toLowerCase();
}

/**
 * Normalize a CHECK constraint definition returned by SQL Server.
 * SQL Server wraps stored definitions in an extra outer pair of parentheses:
 * e.g., "([role] IN ('a','b'))" — strip that outer pair to match the
 * definition as written in constraints.sql.
 */
export function normalizeActualDefinition(definition: string): string {
  const base = normalizeSql(definition);
  // Strip a single outer matched pair of parentheses if present
  if (base.startsWith('(') && base.endsWith(')')) {
    let depth = 0;
    let isOuterPair = true;
    for (let i = 0; i < base.length - 1; i++) {
      if (base[i] === '(') depth++;
      else if (base[i] === ')') depth--;
      if (depth === 0 && i < base.length - 1) {
        isOuterPair = false;
        break;
      }
    }
    if (isOuterPair) {
      return base.slice(1, -1).trim();
    }
  }
  return base;
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse constraints.sql content and extract CHECK constraints.
 */
export function parseCheckConstraints(sql: string): ExpectedCheckConstraint[] {
  const constraints: ExpectedCheckConstraint[] = [];

  // Strip SQL line comments (-- ...) to avoid matching commented-out statements
  const stripped = sql.replace(/--[^\n]*/g, '');

  // Match: ALTER TABLE [dbo].[table] ADD CONSTRAINT [name] CHECK (definition)
  const pattern = /ALTER\s+TABLE\s+(?:\[dbo\]\.)?\[?(\w+)\]?\s+ADD\s+CONSTRAINT\s+\[?(\w+)\]?\s*\n?\s*CHECK\s*\((.+?)\);/gis;

  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    constraints.push({
      table: match[1],
      name: match[2],
      definition: normalizeSql(match[3]),
    });
  }

  return constraints;
}

/**
 * Parse constraints.sql content and extract filtered unique indexes.
 */
export function parseFilteredIndexes(sql: string): ExpectedFilteredIndex[] {
  const indexes: ExpectedFilteredIndex[] = [];

  // Match: CREATE UNIQUE NONCLUSTERED INDEX [name] ON [dbo].[table] (columns) WHERE filter
  const pattern = /CREATE\s+UNIQUE\s+NONCLUSTERED\s+INDEX\s+\[?(\w+)\]?\s+ON\s+(?:\[dbo\]\.)?\[?(\w+)\]?\s*\(([^)]+)\)\s*WHERE\s+(.+?);/gis;

  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const columns = match[3]
      .split(',')
      .map(c => c.replace(/\[|\]/g, '').trim());

    indexes.push({
      name: match[1],
      table: match[2],
      columns,
      filter: normalizeSql(match[4]),
    });
  }

  return indexes;
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * Compare expected CHECK constraints against actual DB state.
 */
export function compareCheckConstraints(
  expected: ExpectedCheckConstraint[],
  actual: ActualCheckConstraint[]
): ConstraintDrift {
  const missing: string[] = [];
  const extra: string[] = [];
  const mismatched: ConstraintDrift['mismatched'] = [];

  const actualMap = new Map(actual.map(a => [a.name.toLowerCase(), a]));
  const expectedMap = new Map(expected.map(e => [e.name.toLowerCase(), e]));

  // Find missing and mismatched
  for (const exp of expected) {
    const act = actualMap.get(exp.name.toLowerCase());
    if (!act) {
      missing.push(`${exp.table}.${exp.name}`);
    } else {
      const normalizedActual = normalizeActualDefinition(act.definition);
      const normalizedExpected = exp.definition; // Already normalized during parse
      if (normalizedActual !== normalizedExpected) {
        mismatched.push({
          name: `${exp.table}.${exp.name}`,
          expected: normalizedExpected,
          actual: normalizedActual,
        });
      }
    }
  }

  // Find extra
  for (const act of actual) {
    if (!expectedMap.has(act.name.toLowerCase())) {
      extra.push(`${act.table}.${act.name}`);
    }
  }

  return { missing, extra, mismatched };
}

/**
 * Compare expected filtered indexes against actual DB state.
 */
export function compareFilteredIndexes(
  expected: ExpectedFilteredIndex[],
  actual: ActualFilteredIndex[]
): ConstraintDrift {
  const missing: string[] = [];
  const extra: string[] = [];
  const mismatched: ConstraintDrift['mismatched'] = [];

  const actualMap = new Map(actual.map(a => [a.name.toLowerCase(), a]));
  const expectedMap = new Map(expected.map(e => [e.name.toLowerCase(), e]));

  for (const exp of expected) {
    const act = actualMap.get(exp.name.toLowerCase());
    if (!act) {
      missing.push(`${exp.table}.${exp.name}`);
    } else {
      const normalizedActualFilter = normalizeActualDefinition(act.filter);
      const normalizedExpectedFilter = exp.filter; // Already normalized
      if (normalizedActualFilter !== normalizedExpectedFilter) {
        mismatched.push({
          name: `${exp.table}.${exp.name}`,
          expected: normalizedExpectedFilter,
          actual: normalizedActualFilter,
        });
      }
    }
  }

  for (const act of actual) {
    if (!expectedMap.has(act.name.toLowerCase())) {
      extra.push(`${act.table}.${act.name}`);
    }
  }

  return { missing, extra, mismatched };
}

/**
 * Build a complete verification result.
 */
export function buildVerificationResult(
  checkDrift: ConstraintDrift,
  indexDrift: ConstraintDrift
): VerificationResult {
  const isClean =
    checkDrift.missing.length === 0 &&
    checkDrift.extra.length === 0 &&
    checkDrift.mismatched.length === 0 &&
    indexDrift.missing.length === 0 &&
    indexDrift.extra.length === 0 &&
    indexDrift.mismatched.length === 0;

  return {
    checkConstraints: checkDrift,
    filteredIndexes: indexDrift,
    isClean,
  };
}
