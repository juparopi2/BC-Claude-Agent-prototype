/**
 * Auth Health Module
 *
 * Exports for the auth health functionality.
 *
 * @module domains/auth/health
 */

export { default as authHealthRouter } from './auth-health.routes';
export {
  createAuthHealthService,
  getAuthHealthService,
  type AuthHealthService,
  type SessionHealthInput,
} from './auth-health.service';
