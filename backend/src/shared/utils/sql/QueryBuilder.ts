import type { SqlParams } from '@/infrastructure/database/database';

export type ColumnValue = string | number | boolean | null | undefined;
export type SqlOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

export class WhereClauseBuilder {
  private conditions: string[] = [];
  private params: SqlParams = {};
  private paramCounter = 0;

  /**
   * Add required condition (throws if value is null/undefined)
   */
  addCondition(column: string, value: ColumnValue, operator: SqlOperator = '='): this {
    if (value === null || value === undefined) {
      throw new Error('Required condition cannot be null or undefined. Use addNullableCondition() instead.');
    }

    this.paramCounter++;
    const paramName = this.sanitizeColumnName(column) + '_' + this.paramCounter;

    this.conditions.push(`${column} ${operator} @${paramName}`);
    this.params[paramName] = value;

    return this;
  }

  /**
   * Add nullable condition (automatically handles NULL with IS NULL)
   */
  addNullableCondition(column: string, value: ColumnValue): this {
    if (value === null || value === undefined) {
      this.conditions.push(`${column} IS NULL`);
    } else {
      this.paramCounter++;
      const paramName = this.sanitizeColumnName(column) + '_' + this.paramCounter;

      this.conditions.push(`${column} = @${paramName}`);
      this.params[paramName] = value;
    }

    return this;
  }

  /**
   * Add IN clause condition
   */
  addInCondition(column: string, values: ColumnValue[]): this {
    if (values.length === 0) {
      // Empty IN clause - use 1=0 (always false)
      this.conditions.push('1=0');
      return this;
    }

    this.paramCounter++;
    const baseParamName = this.sanitizeColumnName(column) + '_' + this.paramCounter;

    const paramNames = values.map((value, index) => {
      const paramName = `${baseParamName}_${index}`;
      this.params[paramName] = value;
      return `@${paramName}`;
    });

    this.conditions.push(`${column} IN (${paramNames.join(', ')})`);

    return this;
  }

  /**
   * Add raw SQL condition (bypass safety checks)
   */
  addRawCondition(condition: string): this {
    this.conditions.push(condition);
    return this;
  }

  /**
   * Build final WHERE clause and params
   */
  build(): { whereClause: string; params: SqlParams } {
    const whereClause = this.conditions.length > 0
      ? this.conditions.join(' AND ')
      : '';

    return {
      whereClause,
      params: this.params,
    };
  }

  /**
   * Sanitize column name for param name (remove special chars)
   */
  private sanitizeColumnName(column: string): string {
    return column
      .replace(/\[|\]|\./g, '_')  // Replace brackets and dots with underscore
      .replace(/_+/g, '_')         // Collapse multiple underscores to single
      .replace(/^_+|_+$/g, '');    // Remove leading/trailing underscores
  }
}

/**
 * Factory function to create new builder
 */
export function createWhereClause(): WhereClauseBuilder {
  return new WhereClauseBuilder();
}
