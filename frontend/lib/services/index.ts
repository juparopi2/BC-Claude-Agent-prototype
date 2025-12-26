/**
 * Frontend Services (Legacy)
 *
 * All services have been migrated to the infrastructure layer:
 * - api.ts -> src/infrastructure/api/httpClient.ts
 * - fileApi.ts -> src/infrastructure/api/fileApiClient.ts
 * - socket.ts -> src/infrastructure/socket/SocketClient.ts
 *
 * This directory is kept for backwards compatibility.
 * Use the new infrastructure imports instead.
 *
 * @module lib/services
 * @deprecated Use @/src/infrastructure/* instead
 */

// No exports - all services have been migrated
