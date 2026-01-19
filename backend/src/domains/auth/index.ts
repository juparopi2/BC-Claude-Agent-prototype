/**
 * Auth Domain
 * Microsoft OAuth authentication and authorization
 *
 * @module domains/auth
 */

// OAuth services
export * from './oauth';

// Auth middleware
export * from './middleware';

// Auth routes (import the router directly)
export { default as authRouter } from './auth-oauth';

// Auth health module
export * from './health';

// Auth WebSocket module
export * from './websocket';
