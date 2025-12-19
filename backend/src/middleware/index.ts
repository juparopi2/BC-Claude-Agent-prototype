/**
 * Middleware exports
 *
 * NOTE: logging.ts moved to @/shared/middleware
 * auth-oauth.ts will move to @/domains/auth/middleware in next migration phase
 */

// Re-export shared middleware for backwards compatibility
export * from '../shared/middleware/logging';

// Domain-specific middleware (to be migrated to domains/auth/)
export * from './auth-oauth';
