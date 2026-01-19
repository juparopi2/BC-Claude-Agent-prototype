/**
 * Auth Constants
 *
 * Constantes compartidas para el sistema de autenticación.
 * Evita magic strings y números mágicos.
 *
 * @module @bc-agent/shared/constants/auth
 */

/** Estados de sesión para health check */
export const AUTH_SESSION_STATUS = {
  AUTHENTICATED: 'authenticated',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
  UNAUTHENTICATED: 'unauthenticated',
} as const;

export type AuthSessionStatus = (typeof AUTH_SESSION_STATUS)[keyof typeof AUTH_SESSION_STATUS];

/** Eventos de WebSocket relacionados con auth */
export const AUTH_WS_EVENTS = {
  EXPIRING: 'auth:expiring',
  REFRESHED: 'auth:refreshed',
  INVALID: 'auth:invalid',
} as const;

export type AuthWsEventType = (typeof AUTH_WS_EVENTS)[keyof typeof AUTH_WS_EVENTS];

/** Tiempos en milisegundos */
export const AUTH_TIME_MS = {
  /** Umbral para mostrar warning (5 minutos) */
  EXPIRY_WARNING_THRESHOLD: 5 * 60 * 1000,
  /** Umbral para refresh proactivo (10 minutos) */
  REFRESH_THRESHOLD: 10 * 60 * 1000,
  /** Intervalo de polling del health check (60 segundos) */
  HEALTH_POLL_INTERVAL: 60 * 1000,
  /** Intervalo de actualización del banner (30 segundos) */
  BANNER_UPDATE_INTERVAL: 30 * 1000,
  /** Sesión por defecto (24 horas) */
  DEFAULT_SESSION_MAX_AGE: 24 * 60 * 60 * 1000,
} as const;

/** Códigos de error específicos de auth */
export const AUTH_ERROR_CODES = {
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOKEN_REFRESH_FAILED: 'TOKEN_REFRESH_FAILED',
  SOCKET_NOT_AUTHENTICATED: 'SOCKET_NOT_AUTHENTICATED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
