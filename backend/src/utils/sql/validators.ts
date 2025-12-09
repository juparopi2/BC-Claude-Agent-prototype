import type { SqlParams } from '@/config/database';

/**
 * Validate SQL query and parameters for common anti-patterns
 *
 * This validator runs ONLY in development/test environments to catch
 * SQL NULL comparison bugs early. In production, this is a no-op.
 *
 * @param query - SQL query string
 * @param params - Query parameters
 * @throws Error if validation fails (development/test only)
 */
export function validateQuery(query: string, params?: SqlParams): void {
  // Skip validation in production (zero overhead)
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    return;
  }

  // Initialize params if undefined
  const actualParams = params || {};
  const errors: string[] = [];

  // Check 1: NULL parameters with = operator
  for (const [paramName, value] of Object.entries(actualParams)) {
    if (value === null || value === undefined) {
      // Look for "= @paramName" pattern in query
      const equalPattern = new RegExp(`=\\s*@${paramName}\\b`, 'i');
      if (equalPattern.test(query)) {
        // Check if there's also an "IS NULL" for this column
        const columnName = paramName.replace(/_\d+$/, ''); // Remove counter suffix
        const isNullPattern = new RegExp(`${columnName}\\s+IS\\s+NULL`, 'i');

        if (!isNullPattern.test(query)) {
          errors.push(
            `Parameter '${paramName}' is null/undefined but query uses '= @${paramName}'. ` +
            `SQL: column = NULL always returns FALSE. ` +
            `Use 'column IS NULL' or QueryBuilder.addNullableCondition(). ` +
            `See docs/backend/sql-best-practices.md for details.`
          );
        }
      }
    }
  }

  // Check 2: Missing parameters (query references @param but not in params object)
  const queryParams = extractParamNames(query);
  for (const paramName of queryParams) {
    if (!Object.prototype.hasOwnProperty.call(actualParams, paramName)) {
      errors.push(
        `Query references '@${paramName}' but it's not in params object. ` +
        `This will cause SQL execution error.`
      );
    }
  }

  // Check 3: Extra parameters (params has key not referenced in query) - WARNING only
  const usedParams = new Set(queryParams);
  for (const paramName of Object.keys(actualParams)) {
    if (!usedParams.has(paramName)) {
      // This is just a warning, not an error
      console.warn(
        `[SQL Validator] Parameter '${paramName}' provided but not used in query. ` +
        `This may indicate a bug.`
      );
    }
  }

  // Throw aggregated errors
  if (errors.length > 0) {
    const errorMessage =
      `\n${'='.repeat(80)}\n` +
      `❌ SQL Query Validation Failed (${errors.length} error${errors.length > 1 ? 's' : ''}):\n\n` +
      errors.map((err, i) => `${i + 1}. ${err}`).join('\n\n') +
      `\n\nQuery:\n${query}\n\n` +
      `Params:\n${JSON.stringify(actualParams, null, 2)}\n` +
      `\n💡 Tip: Use QueryBuilder from @/utils/sql/QueryBuilder for automatic NULL handling.\n` +
      `${'='.repeat(80)}\n`;

    throw new Error(errorMessage);
  }
}

/**
 * Extract all @paramName references from SQL query
 * IGNORES @params inside string literals to avoid false positives
 * (e.g., 'user@example.com' should NOT match @example)
 */
function extractParamNames(query: string): string[] {
  // Remove string literals first to avoid false positives
  // Handles both 'single quotes' and "double quotes"
  const queryWithoutStrings = query
    .replace(/'[^']*'/g, "''")  // Replace 'string' with ''
    .replace(/"[^"]*"/g, '""'); // Replace "string" with ""

  // Now extract @params only from the query without string literals
  const paramPattern = /@(\w+)/g;
  const matches = queryWithoutStrings.matchAll(paramPattern);
  const params = new Set<string>();

  for (const match of matches) {
    if (match[1]) {
      params.add(match[1]);
    }
  }

  return Array.from(params);
}

/**
 * Check if query construction is using QueryBuilder
 * (heuristic: looks for typical QueryBuilder patterns)
 */
export function isUsingQueryBuilder(query: string): boolean {
  // QueryBuilder generates consistent patterns
  return query.includes('IS NULL') || /\w+_\d+/.test(query);
}
