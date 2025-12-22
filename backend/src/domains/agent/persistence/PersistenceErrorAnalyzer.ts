/**
 * @module domains/agent/persistence/PersistenceErrorAnalyzer
 *
 * Stateless service that categorizes persistence errors for debugging and retry logic.
 * Extracted from DirectAgentService.analyzePersistenceError() during Phase 5C refactor.
 *
 * @example
 * ```typescript
 * const analyzer = getPersistenceErrorAnalyzer();
 * const causes = analyzer.analyze(error);
 * // ['DUPLICATE_ID: El ID del mensaje ya existe en la base de datos']
 * ```
 */

import type {
  IPersistenceErrorAnalyzer,
  ErrorAnalysis,
  PersistenceErrorCategory,
} from './types';

/**
 * Analyzes persistence errors and categorizes them for debugging.
 * Implements the same logic as DirectAgentService.analyzePersistenceError()
 * but as a standalone, testable service.
 */
export class PersistenceErrorAnalyzer implements IPersistenceErrorAnalyzer {
  /**
   * Analyze an error and return categorized causes.
   * Each cause is prefixed with its category (e.g., 'DUPLICATE_ID: ...')
   *
   * @param error - The error to analyze (Error object or string)
   * @returns Array of cause strings with category prefixes
   */
  analyze(error: unknown): string[] {
    const causes: string[] = [];
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('duplicate key') || errorMsg.includes('PRIMARY KEY')) {
      causes.push('DUPLICATE_ID: El ID del mensaje ya existe en la base de datos');
    }
    if (errorMsg.includes('FOREIGN KEY') || errorMsg.includes('FK_')) {
      causes.push('FK_VIOLATION: Referencia a sesión o usuario que no existe');
    }
    if (errorMsg.includes('sequence_number')) {
      causes.push('SEQUENCE_CONFLICT: Conflicto en el número de secuencia (posible race condition D1)');
    }
    if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
      causes.push('DB_TIMEOUT: La base de datos no respondió a tiempo');
    }
    if (errorMsg.includes('Redis') || errorMsg.includes('redis')) {
      causes.push('REDIS_ERROR: Problema con Redis al obtener sequence number');
    }
    if (errorMsg.includes('connection') || errorMsg.includes('ECONNREFUSED')) {
      causes.push('CONNECTION_ERROR: No se pudo conectar a la base de datos');
    }
    if (errorMsg.includes('Database not available')) {
      causes.push('DB_UNAVAILABLE: El servicio de base de datos no está disponible');
    }

    if (causes.length === 0) {
      causes.push('UNKNOWN: Error no categorizado - revisar logs completos');
    }

    return causes;
  }

  /**
   * Get detailed analysis including retry recommendations.
   *
   * @param error - The error to analyze
   * @returns Full error analysis with retry logic
   */
  getDetailedAnalysis(error: unknown): ErrorAnalysis {
    const causes = this.analyze(error);
    const primaryCategory = this.extractPrimaryCategory(causes);

    return {
      causes,
      primaryCategory,
      shouldRetry: this.shouldRetry(primaryCategory),
      retryDelayMs: this.getRetryDelay(primaryCategory),
      logLevel: this.getLogLevel(primaryCategory),
    };
  }

  /**
   * Extract the primary category from the first cause.
   */
  private extractPrimaryCategory(causes: string[]): PersistenceErrorCategory {
    const firstCause = causes[0] ?? 'UNKNOWN';
    const categoryMatch = firstCause.match(/^([A-Z_]+):/);
    return (categoryMatch?.[1] ?? 'UNKNOWN') as PersistenceErrorCategory;
  }

  /**
   * Determine if error type should trigger retry.
   * Transient errors (timeout, connection) are retryable.
   * Constraint violations (duplicate, FK) are not.
   */
  private shouldRetry(category: PersistenceErrorCategory): boolean {
    switch (category) {
      case 'DB_TIMEOUT':
      case 'CONNECTION_ERROR':
      case 'DB_UNAVAILABLE':
      case 'REDIS_ERROR':
        return true;
      case 'DUPLICATE_ID':
      case 'FK_VIOLATION':
      case 'SEQUENCE_CONFLICT':
      case 'UNKNOWN':
      default:
        return false;
    }
  }

  /**
   * Get suggested retry delay based on error type.
   */
  private getRetryDelay(category: PersistenceErrorCategory): number | undefined {
    switch (category) {
      case 'DB_TIMEOUT':
        return 1000; // 1 second
      case 'CONNECTION_ERROR':
      case 'DB_UNAVAILABLE':
        return 2000; // 2 seconds
      case 'REDIS_ERROR':
        return 500; // 500ms
      default:
        return undefined;
    }
  }

  /**
   * Get appropriate log level for error type.
   */
  private getLogLevel(category: PersistenceErrorCategory): 'error' | 'warn' | 'info' {
    switch (category) {
      case 'DUPLICATE_ID':
        return 'warn'; // May be expected in some cases
      case 'FK_VIOLATION':
      case 'SEQUENCE_CONFLICT':
        return 'error'; // Data integrity issues
      case 'DB_TIMEOUT':
      case 'CONNECTION_ERROR':
      case 'DB_UNAVAILABLE':
      case 'REDIS_ERROR':
        return 'error'; // Infrastructure issues
      case 'UNKNOWN':
      default:
        return 'error';
    }
  }
}

// Singleton instance
let instance: PersistenceErrorAnalyzer | null = null;

/**
 * Get the singleton PersistenceErrorAnalyzer instance.
 * @returns The shared PersistenceErrorAnalyzer instance
 */
export function getPersistenceErrorAnalyzer(): PersistenceErrorAnalyzer {
  if (!instance) {
    instance = new PersistenceErrorAnalyzer();
  }
  return instance;
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetPersistenceErrorAnalyzer(): void {
  instance = null;
}
