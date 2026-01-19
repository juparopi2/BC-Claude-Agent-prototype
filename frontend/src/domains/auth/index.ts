/**
 * Auth Domain
 *
 * Exports for authentication state management.
 *
 * @module domains/auth
 */

// Constants
export * from './constants';

// Hooks
export * from './hooks';

// Stores
export {
  useAuthStore,
  resetAuthStore,
  selectUserDisplayName,
  selectUserInitials,
  type AuthState,
  type AuthActions,
  type AuthStore,
} from './stores/authStore';
