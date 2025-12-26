/**
 * Frontend Services
 *
 * Barrel export for remaining frontend services.
 * Note: api.ts and fileApi.ts have been migrated to src/infrastructure/api/.
 *
 * @module lib/services
 */

// Socket service (to be migrated to infrastructure/socket in future sprint)
export {
  SocketService,
  getSocketService,
  resetSocketService,
  type SocketEventHandlers,
} from './socket';
