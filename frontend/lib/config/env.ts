/**
 * Frontend Environment Configuration
 *
 * Type-safe environment variables for the frontend.
 * Uses NEXT_PUBLIC_ prefix for client-side access.
 *
 * @module lib/config/env
 */

/**
 * Environment configuration
 */
export const env = {
  /**
   * Backend API URL
   * @default 'http://localhost:3002'
   */
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002',

  /**
   * WebSocket URL (same as API URL by default)
   * @default 'http://localhost:3002'
   */
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002',

  /**
   * Is development mode
   */
  isDev: process.env.NODE_ENV === 'development',

  /**
   * Is production mode
   */
  isProd: process.env.NODE_ENV === 'production',

  /**
   * Enable debug logging
   */
  debug: process.env.NEXT_PUBLIC_DEBUG === 'true',
} as const;

export type Env = typeof env;
