/**
 * Frontend Services
 *
 * Barrel export for all frontend services.
 *
 * @module lib/services
 */

// Socket service
export {
  SocketService,
  getSocketService,
  resetSocketService,
  type SocketEventHandlers,
} from './socket';

// API client
export {
  ApiClient,
  ApiError,
  getApiClient,
  resetApiClient,
  type ApiResponse,
  type Session,
  type Message,
  type UserProfile,
  type TokenUsage,
  type CreateSessionRequest,
  type UpdateSessionRequest,
} from './api';
